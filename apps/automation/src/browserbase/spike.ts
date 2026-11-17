import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { browserbase, Stagehand } from '@browserbasehq/stagehand';
import type { Action, Page, StagehandBrowser } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { browserbaseSettings, type BrowserbaseConfig } from './config.js';
import { getHostedSessionStatus } from './provider.js';
import { assertFreshObservation, ControlConflict, SpikeControl } from './spike-control.js';
import { actionSchema, assertTarget, clickTarget, parameterizeFill, readFixture, targets, targetNames, verifiedBalance, waitForFixture } from './fixture-ui.js';
import type { Target } from './fixture-ui.js';

type Event = { at: string; event: string; revision: number; actor?: string; target?: string };
type Observation = {
  id: string; revision: number; createdAt: number; fingerprint: string;
  controls: { id: Target; label: string; kind: 'fill' | 'click' }[];
};
export const manualRequestSchema = z.strictObject({
  revision: z.number().int(), observationId: z.uuid(),
  target: z.enum(['member', 'find', 'savings', 'checking', 'back']),
  value: z.enum(['M1001', 'M1002']).optional(),
});
export class SdkSpike {
  readonly gate = new SpikeControl();
  phase = 'idle';
  readonly events: Event[] = [];
  readonly result: Record<string, unknown> = { task: 'INT-003', success: false };
  observation: Observation | undefined;
  image: Uint8Array | undefined;
  private browser: StagehandBrowser | undefined;
  private stagehand: Stagehand | undefined;
  private page: Page | undefined;
  private finishHuman: (() => void) | undefined;
  private rejectHuman: ((error: Error) => void) | undefined;
  private inferenceAttempts = 0;
  private deterministicBaseline = 0;
  private humanRevision: number | undefined;
  private manualActions = 0;
  private abort = new AbortController();
  private running: Promise<void> | undefined;
  constructor(private config: BrowserbaseConfig, readonly directory: string) {}
  state() {
    return {
      phase: this.phase, sessionId: this.browser?.sessionId,
      control: this.gate.snapshot(), observation: this.observation,
      events: this.events.slice(-40), result: this.result,
    };
  }
  private event(event: string, actor?: string, target?: string) {
    this.events.push({ at: new Date().toISOString(), event, revision: this.gate.snapshot().revision,
      ...(actor ? { actor } : {}), ...(target ? { target } : {}) });
  }
  start() {
    if (this.phase !== 'idle') throw new ControlConflict();
    this.phase = 'starting';
    this.running = this.run();
  }
  async stop() {
    this.abort.abort();
    this.gate.close();
    this.rejectHuman?.(new Error('Spike stopped.'));
    await this.running;
  }
  private currentPage() {
    if (!this.page) throw new ControlConflict();
    return this.page;
  }
  private async automated<T>(target: string, operation: () => Promise<T>) {
    return this.gate.dispatch('automation', this.gate.snapshot().revision, async () => {
      this.event('dispatch', 'automation', target);
      return operation();
    });
  }
  private async act(action: Action, target: Target) {
    await assertTarget(this.currentPage(), action, target);
    const result = await this.automated(target, () => this.stagehand!.act(action, { page: this.currentPage(), timeout: 10_000 }));
    if (!result.data.success || result.metadata.usage.inputTokens || result.metadata.usage.outputTokens) throw new Error('Action failed or used inference.');
    return result.metadata;
  }
  async refresh() {
    if (this.phase !== 'waiting_for_human' || this.gate.snapshot().busy) throw new ControlConflict();
    const page = this.currentPage();
    const state = await readFixture(page);
    const possible: Target[] = state.heading === 'Member servicing' ? ['member', 'find', 'savings', 'checking'] : ['back'];
    const controls: Observation['controls'] = [];
    for (const id of possible) {
      if (await page.locator(targets[id]).count({ timeout: 3000 }) === 1) {
        controls.push({ id, label: targetNames[id], kind: id === 'member' ? 'fill' : 'click' });
      }
    }
    this.image = await page.screenshot({ type: 'png' });
    this.observation = {
      id: randomUUID(), revision: this.gate.snapshot().revision, createdAt: Date.now(),
      fingerprint: JSON.stringify(state), controls,
    };
  }
  async claim(revision: number) {
    if (this.phase !== 'waiting_for_human') throw new ControlConflict();
    this.gate.claim(revision);
    this.humanRevision = this.gate.snapshot().revision;
    this.event('human_claimed', 'human');
    // A real attempted automation dispatch must be rejected without executing its callback.
    let dispatched = false;
    try { await this.gate.dispatch('automation', this.gate.snapshot().revision, async () => { dispatched = true; }); }
    catch (error) { if (!(error instanceof ControlConflict)) throw error; }
    if (dispatched) throw new Error('Automation dispatched during human ownership.');
    this.result.automationBlockedDuringHumanControl = true;
    await this.refresh();
  }
  async manual(input: z.infer<typeof manualRequestSchema>) {
    if (this.phase !== 'waiting_for_human') throw new ControlConflict();
    const observation = this.observation;
    if (!observation || !observation.controls.some((control) => control.id === input.target)) throw new ControlConflict();
    await this.gate.dispatch('human', input.revision, async () => {
      assertFreshObservation(observation, input, JSON.stringify(await readFixture(this.currentPage())));
      this.observation = undefined;
      this.event('dispatch', 'human', input.target); // Never retain typed text in events.
      if (input.target === 'member') {
        if (!input.value) throw new ControlConflict();
        await this.currentPage().locator(targets.member).fill(input.value, { timeout: 5000 });
      } else {
        const before = await readFixture(this.currentPage());
        await clickTarget(this.currentPage(), input.target);
        const member = input.target === 'find' ? before.input : before.memberId;
        await waitForFixture(this.currentPage(), ['savings', 'checking'].includes(input.target) ? 'Account Details' : 'Member servicing', member);
      }
      this.manualActions++;
      this.event('manual_action_completed', 'human', input.target);
    });
    await this.refresh();
  }
  async resume(revision: number) {
    if (this.phase !== 'waiting_for_human') throw new ControlConflict();
    this.observation = undefined;
    await this.gate.resume(revision, async () => {
      try {
        const actual = verifiedBalance(await readFixture(this.currentPage()), 'M1001', 'S2001');
        if (actual.currentBalanceMinor !== 125034 || actual.availableBalanceMinor !== 120034) return false;
        this.result.humanVerifiedBalance = actual;
        return this.manualActions >= 3;
      } catch { return false; }
    });
    this.event('human_handed_back', 'human');
    this.finishHuman?.();
  }
  private async run() {
    this.result.startedAt = new Date().toISOString();
    this.result.modelName = browserbaseSettings.modelName;
    this.result.selfHeal = false;
    this.result.providerRecording = false;
    this.result.providerLogging = false;
    let passed = false;
    try {
      await mkdir(this.directory, { recursive: true });
      this.browser = await browserbase.launch({
        apiKey: this.config.apiKey, projectId: this.config.projectId, region: browserbaseSettings.region,
        api_timeout: 900, keepAlive: false,
        browserSettings: { allowedDomains: [new URL(this.config.fixtureUrl).hostname], logSession: false, recordSession: false, solveCaptchas: false, viewport: { width: 1440, height: 1100 } },
        clientOptions: { timeout: 30_000, maxRetries: 0 },
      });
      this.result.sessionId = z.uuid().parse(this.browser.sessionId);
      this.event('session_created');
      this.stagehand = await Stagehand.create({ browser: this.browser, model: { modelName: browserbaseSettings.modelName }, selfHeal: false, cache: false, logging: { level: 'off' } });
      this.page = await this.browser.context.newPage();
      const response = await this.automated('fixture', () => this.currentPage().goto(this.config.fixtureUrl, { timeout: 20_000, waitUntil: 'domcontentloaded' }));
      if (!response?.ok() || await this.page.url() !== this.config.fixtureUrl) throw new Error('Fixture navigation failed.');
      await waitForFixture(this.page, 'Member servicing', 'M1001');
      this.phase = 'observe_fill';
      const before = JSON.stringify(await readFixture(this.page));
      const fill = await this.stagehand.observe('Fill the Member ID textbox with M1001 in the Member servicing workspace iframe. Return only the fill action; do not submit.', { page: this.page, timeout: 45_000 });
      this.result.fillProposal = fill;
      this.phase = 'inspect_fill';
      if (fill.data.length !== 1 || before !== JSON.stringify(await readFixture(this.page))) throw new Error('Proposal was ambiguous or changed the UI.');
      const fillAction = actionSchema.parse(fill.data[0]);
      if (fillAction.method !== 'fill' || fillAction.arguments?.[0] !== 'M1001') throw new Error('Unexpected fill proposal.');
      await assertTarget(this.page, fillAction, 'member');
      this.event('proposal_validated_before_dispatch', 'automation', 'member');
      await writeFile(resolve(this.directory, 'fill-action.json'), JSON.stringify(fillAction, null, 2) + '\n', { mode: 0o600 });
      const serializedFill = actionSchema.parse(JSON.parse(await readFile(resolve(this.directory, 'fill-action.json'), 'utf8')));
      this.result.fillAction = serializedFill;
      this.result.discoveryFillExecution = await this.act(serializedFill, 'member');
      await this.automated('find', () => clickTarget(this.currentPage(), 'find'));
      await waitForFixture(this.page, 'Member servicing', 'M1001');
      const beforeOpen = JSON.stringify(await readFixture(this.page));
      this.phase = 'observe_open';
      const open = await this.stagehand.observe('Click Open in the Primary Savings, Primary, S2001 account row in the Member servicing workspace iframe. Return only that click; do not open Checking.', { page: this.page, timeout: 45_000 });
      this.result.openProposal = open;
      this.phase = 'inspect_open';
      if (open.data.length !== 1 || beforeOpen !== JSON.stringify(await readFixture(this.page))) throw new Error('Open proposal was ambiguous or changed the UI.');
      const openAction = actionSchema.parse(open.data[0]);
      if (openAction.method !== 'click' || (openAction.arguments?.length ?? 0) !== 0) throw new Error('Unexpected open proposal.');
      await assertTarget(this.page, openAction, 'savings');
      this.event('proposal_validated_before_dispatch', 'automation', 'savings');
      this.result.openAction = openAction;
      this.result.discoveryOpenExecution = await this.act(openAction, 'savings');
      this.result.discoveryBalance = verifiedBalance(await waitForFixture(this.page, 'Account Details', 'M1001'), 'M1001', 'S2001');
      this.result.discoveryUsage = { fill: fill.metadata, open: open.metadata, metrics: await this.stagehand.metrics() };
      if (fill.metadata.usage.inputTokens <= 0 || open.metadata.usage.inputTokens <= 0) throw new Error('No genuine inference usage was recorded.');
      await this.automated('back', () => clickTarget(this.currentPage(), 'back'));
      await waitForFixture(this.page, 'Member servicing', 'M1001');

      this.phase = 'inference_forbidden';
      const pageId = this.page.pageId;
      await this.stagehand.close();
      this.stagehand = await Stagehand.create({
        browser: this.browser, selfHeal: false, cache: false, logging: { level: 'off' },
        model: { generate: async () => { this.inferenceAttempts++; throw new Error('INFERENCE_FORBIDDEN'); } },
      });
      this.page = (await this.browser.context.pages()).find((page) => page.pageId === pageId);
      if (!this.page) throw new Error('Original page was lost.');
      let guardRejected = false;
      try { await this.stagehand.observe('Find the Member ID textbox.', { page: this.page, timeout: 10_000 }); }
      catch { guardRejected = true; }
      if (!guardRejected || this.inferenceAttempts < 1) throw new Error('Inference guard did not reject an actual model request.');
      this.result.inferenceGuardProbe = { rejected: true, interceptedRequests: this.inferenceAttempts };
      this.deterministicBaseline = this.inferenceAttempts;
      this.phase = 'deterministic_replay';
      const changedFill = parameterizeFill(serializedFill, 'M1002');
      this.result.replayFillExecution = await this.act(changedFill, 'member');
      await this.automated('find', () => clickTarget(this.currentPage(), 'find'));
      const changed = await waitForFixture(this.page, 'Member servicing', 'M1002');
      this.result.reorderedRows = changed.rows.map((row) => row[1]);
      let rawTargetReusable = false;
      try { await assertTarget(this.page, openAction, 'savings'); rawTargetReusable = true; }
      catch { this.event('recorded_target_rejected_after_row_reorder', 'automation', 'savings'); }
      this.result.rawOpenTargetReusable = rawTargetReusable;
      // The fixture adapter binds semantic row scope independently of the model's positional selector.
      await this.automated('savings', () => clickTarget(this.currentPage(), 'savings'));
      const replayBalance = verifiedBalance(await waitForFixture(this.page, 'Account Details', 'M1002'), 'M1002', 'S2002');
      if (replayBalance.currentBalanceMinor !== 8765 || replayBalance.availableBalanceMinor !== 7600) throw new Error('Changed-input output did not match rendered fixture.');
      this.result.replayBalance = replayBalance;

      this.phase = 'failure_capture';
      const missing = 'button[data-nonexistent-compatibility-control]';
      let waitRejected = false;
      try {
        if (await this.page.waitForSelector(missing, { timeout: 500 })) throw new Error('Missing-target test unexpectedly resolved.');
      } catch {
        // The installed runtime throws on an expired wait rather than returning false.
        // Confirm the session still responds and the target is absent before treating it as expected.
        if (await this.page.locator(missing).count({ timeout: 1000 }) !== 0) throw new Error('Missing-target test unexpectedly resolved.');
        waitRejected = true;
      }
      this.phase = 'screenshot_capture';
      await writeFile(resolve(this.directory, 'failure.png'), await this.page.screenshot({ type: 'png' }), { mode: 0o600 });
      this.phase = 'snapshot_capture';
      const snapshot = await this.page.snapshot({ includeIframes: true, timeout: 10_000 });
      await writeFile(resolve(this.directory, 'failure-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
      this.result.failureCapture = { reason: 'MISSING_TARGET', waitBudgetMs: 500, waitRejected, screenshot: 'failure.png', snapshot: 'failure-snapshot.json', snapshotCharacters: snapshot.formattedTree.length };
      await this.automated('back', () => clickTarget(this.currentPage(), 'back'));
      await waitForFixture(this.page, 'Member servicing', 'M1002');

      this.gate.pause(this.gate.snapshot().revision);
      if (this.abort.signal.aborted) throw new Error('Spike stopped.');
      this.phase = 'waiting_for_human';
      this.event('paused_for_human');
      await this.refresh();
      const handBack = new Promise<void>((resolve, reject) => { this.finishHuman = resolve; this.rejectHuman = reject; });
      const timeout = setTimeout(() => this.rejectHuman?.(new Error('Human intervention expired.')), 600_000);
      try { await handBack; }
      finally { clearTimeout(timeout); }
      this.phase = 'resuming';
      let staleDispatched = false;
      try { await this.gate.dispatch('human', this.humanRevision!, async () => { staleDispatched = true; }); }
      catch (error) { if (!(error instanceof ControlConflict)) throw error; }
      if (staleDispatched) throw new Error('Stale human input dispatched after hand-back.');
      this.result.staleHumanInputBlocked = true;
      this.result.manualActions = this.manualActions;
      await this.automated('back', () => clickTarget(this.currentPage(), 'back'));
      await waitForFixture(this.page, 'Member servicing', 'M1001');
      this.result.sameSessionResumed = this.browser.sessionId === this.result.sessionId;
      this.result.finalFixtureState = await readFixture(this.page);
      this.result.replayMetrics = await this.stagehand.metrics();
      this.result.replayInferenceAttempts = this.inferenceAttempts - this.deterministicBaseline;
      if (this.result.replayInferenceAttempts !== 0 || Object.values(await this.stagehand.metrics()).some((value) => value !== 0)) throw new Error('Deterministic phase invoked inference.');
      passed = true;
    } catch (error) {
      this.result.failurePhase = this.phase;
      const knownReasons = ['Proposal was ambiguous or changed the UI.', 'Unexpected fill proposal.', 'Open proposal was ambiguous or changed the UI.', 'Unexpected open proposal.', 'Target is absent, hidden, or ambiguous.', 'Proposed target differs from the independently scoped fixture control.', 'Inference guard did not reject an actual model request.', 'No genuine inference usage was recorded.'];
      this.result.failureReason = error instanceof Error && knownReasons.includes(error.message) ? error.message : 'SDK_OR_CHECK_FAILURE';
      if (error instanceof z.ZodError) this.result.validationIssues = error.issues.map((issue) => ({ path: issue.path, code: issue.code }));
      this.event('check_failed');
    } finally {
      this.phase = 'cleanup';
      this.gate.close();
      this.observation = undefined;
      this.image = undefined;
      let cleanup = true;
      try { await this.stagehand?.close(); } catch { cleanup = false; }
      try { await this.browser?.close(); } catch { cleanup = false; }
      let status = 'UNKNOWN';
      if (this.browser?.sessionId) {
        try {
          for (let attempt = 0; attempt < 8; attempt++) {
            status = await getHostedSessionStatus(this.config, this.browser.sessionId);
            if (['COMPLETED', 'ERROR', 'TIMED_OUT'].includes(status)) break;
            await delay(500, undefined, { signal: this.abort.signal }).catch(() => {});
          }
        } catch { cleanup = false; }
      }
      this.result.finalStatus = status;
      this.result.cleanupSucceeded = cleanup;
      this.result.success = passed && cleanup && status === 'COMPLETED';
      this.result.finishedAt = new Date().toISOString();
      this.result.events = this.events;
      this.phase = this.result.success ? 'complete' : 'failed';
      await writeFile(resolve(this.directory, 'result.json'), JSON.stringify(this.result, null, 2) + '\n', { mode: 0o600 });
    }
  }
}
