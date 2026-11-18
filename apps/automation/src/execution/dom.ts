/// <reference lib="dom" />
import type { ResolvedTarget, SurfacePolicy, TargetState } from './surface.js';

// This fixed function is serialized by the adapter. Descriptors/values are JSON arguments,
// never executable selectors or script. Same-origin frames only; unsupported scopes fail closed.
export function operateDom(request: { target: ResolvedTarget; policy: SurfacePolicy; mode: 'inspect' | 'click' | 'fill'; value?: string }): TargetState | { error: string } {
  const fail = (error: string) => ({ error });
  const empty: TargetState = { count: 0, visible: false, enabled: false, editable: false, text: '', value: '', checked: false, tag: '', name: '', inputType: '' };
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const text = (element: Element) => normalize(element.textContent);
  const visible = (element: Element) => {
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !element.closest('[hidden],[inert],[aria-hidden="true"]');
  };
  const name = (element: Element) => {
    const label = element.getAttribute('aria-label'); if (label) return normalize(label);
    const by = element.getAttribute('aria-labelledby');
    if (by) return normalize(by.split(/\s+/).map(id => element.ownerDocument.getElementById(id)?.textContent ?? '').join(' '));
    const input = element as HTMLInputElement;
    if (input.labels?.length) return normalize([...input.labels].map(label => label.textContent).join(' '));
    if (element.tagName === 'TABLE') return normalize(element.querySelector(':scope > caption')?.textContent);
    return text(element);
  };
  const role = (element: Element) => element.getAttribute('role') ?? ({ BUTTON: 'button', A: element.hasAttribute('href') ? 'link' : '',
    INPUT: (element as HTMLInputElement).type === 'checkbox' ? 'checkbox' : 'textbox', TEXTAREA: 'textbox', TABLE: 'table',
    FORM: 'form', SECTION: 'region', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', DIALOG: 'dialog' }[element.tagName] ?? '');
  let doc: Document = document;
  const allowed = (value: Document) => request.policy.allowedOrigins.includes(value.location.origin);
  if (!allowed(doc)) return fail('POLICY_BLOCKED');
  if (request.target.scope.kind === 'frame') for (const frame of request.target.scope.frames) {
    const frames = [...doc.querySelectorAll('iframe,frame')].filter(el => el.getAttribute(frame.attribute) === frame.value);
    if (!frames.length) return empty;
    if (frames.length !== 1) return fail('AMBIGUOUS_TARGET');
    if (!visible(frames[0]!)) return empty;
    const element = frames[0] as HTMLIFrameElement;
    const source = element.getAttribute('src');
    if (!source || !request.policy.allowedOrigins.includes(new URL(source, doc.location.href).origin)) return fail('POLICY_BLOCKED');
    try { const next = element.contentDocument; if (!next) return fail('UNSUPPORTED_SURFACE'); if (next.location.href === 'about:blank') return empty; doc = next; }
    catch { return fail('UNSUPPORTED_SURFACE'); }
    if (!allowed(doc)) return fail('POLICY_BLOCKED');
  }
  type Root = Document | Element;
  const locate = (root: Root, locator: ResolvedTarget['locator']): Element[] => {
    const all = [...root.querySelectorAll('*')];
    switch (locator.kind) {
      case 'role': return all.filter(el => role(el) === locator.role && name(el) === normalize(locator.name));
      case 'attribute': return all.filter(el => el.getAttribute(locator.name) === locator.value);
      case 'label': return all.filter(el => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && name(el) === normalize(locator.text));
      case 'caption': return all.filter(el => el.tagName === 'TABLE' && normalize(el.querySelector(':scope > caption')?.textContent) === normalize(locator.text));
      case 'field': return all.filter(el => el.tagName === 'DT' && text(el) === normalize(locator.label)).flatMap(el => el.nextElementSibling?.tagName === 'DD' ? [el.nextElementSibling] : []);
      case 'cell': {
        if (root.nodeType !== 1 || (root as Element).tagName !== 'TR') return [];
        const table = (root as Element).closest('table'); const headers = [...(table?.querySelectorAll('thead tr') ?? [])];
        if (headers.length !== 1) throw new Error('UNSUPPORTED_SURFACE');
        const columns = [...headers[0]!.querySelectorAll('th')];
        const indexes = columns.flatMap((el, index) => text(el) === normalize(locator.columnHeader) ? [index] : []);
        if (indexes.length !== 1 || table?.querySelector('[colspan],[rowspan]')) throw new Error('AMBIGUOUS_TARGET');
        return [...(root as Element).children].filter(el => ['TD', 'TH'].includes(el.tagName)).filter((_el, index) => index === indexes[0]);
      }
      case 'text': {
        const tags = locator.element === 'button' ? ['BUTTON'] : locator.element === 'link' ? ['A'] : locator.element === 'heading' ? ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] : null;
        const matches = all.filter(el => (!tags || tags.includes(el.tagName)) && text(el) === normalize(locator.text));
        // Text wrappers do not multiply a single leaf match. Independent duplicate leaves remain ambiguous.
        return matches.filter(el => !matches.some(other => other !== el && el.contains(other)));
      }
    }
  };
  let root: Root = doc;
  let mutationStarted = false;
  try {
    for (const scope of request.target.within) {
      if (scope.kind === 'container') {
        const candidates = locate(root, scope.locator); if (!candidates.length) return empty;
        if (candidates.length !== 1) return fail('AMBIGUOUS_TARGET'); root = candidates[0]!;
      } else {
        const tables = locate(root, { kind: 'caption', text: scope.tableCaption, exact: true });
        if (!tables.length) return empty; if (tables.length !== 1) return fail('AMBIGUOUS_TARGET');
        const rows = [...tables[0]!.querySelectorAll(':scope > tbody > tr')].filter(row => scope.cells.every(cell => {
          const cells = locate(row, { kind: 'cell', columnHeader: cell.columnHeader });
          return cells.length === 1 && text(cells[0]!) === normalize(cell.equals);
        }));
        if (!rows.length) return empty; if (rows.length !== 1) return fail('AMBIGUOUS_TARGET'); root = rows[0]!;
      }
    }
    const elements = locate(root, request.target.locator);
    if (elements.length !== 1) return { ...empty, count: elements.length };
    const element = elements[0]!; const input = element as HTMLInputElement;
    const enabled = !element.matches(':disabled,[aria-disabled="true"]') && !element.closest('[inert]');
    const editable = ['INPUT', 'TEXTAREA'].includes(element.tagName) && !input.readOnly && enabled && !['password', 'hidden', 'file', 'checkbox', 'radio', 'submit', 'button'].includes(input.type);
    const state = { count: 1, visible: visible(element), enabled, editable, text: normalize((element as HTMLElement).innerText ?? element.textContent),
      value: input.type !== 'password' && typeof input.value === 'string' ? input.value : '', checked: input.checked === true, tag: element.tagName.toLowerCase(), name: name(element), inputType: input.type ?? '' };
    if (request.mode === 'inspect') return state;
    const dialogs = [...doc.querySelectorAll('dialog[open],[role=\"dialog\"][aria-modal=\"true\"]')].filter(visible);
    if (dialogs.some(dialog => !dialog.contains(element))) return fail('TARGET_NOT_ACTIONABLE');
    if (!state.visible || !state.enabled || (request.mode === 'fill' && !state.editable)) return fail('TARGET_NOT_ACTIONABLE');
    // These checks and dispatch share one browser turn: no first-match/ordinal fallback or DOM mutation to tag targets.
    if (request.mode === 'click') {
      if (!request.policy.allowedClickNames.includes(state.name) || !['button', 'link', 'checkbox'].includes(role(element))) return fail('POLICY_BLOCKED');
      const anchor = element.closest('a[href]');
      if (anchor && !request.policy.allowedOrigins.includes(new URL((anchor as HTMLAnchorElement).href, doc.location.href).origin)) return fail('POLICY_BLOCKED');
      if (element.hasAttribute('download') || (element.getAttribute('target') && element.getAttribute('target') !== '_self')) return fail('POLICY_BLOCKED');
      if (element.hasAttribute('formaction') && !request.policy.allowedOrigins.includes(new URL(element.getAttribute('formaction')!, doc.location.href).origin)) return fail('POLICY_BLOCKED');
      const form = element.closest('form');
      if (form && !request.policy.allowedOrigins.includes(new URL(form.action, doc.location.href).origin)) return fail('POLICY_BLOCKED');
      mutationStarted = true; (element as HTMLElement).click();
    } else {
      if (!request.policy.allowedFillNames.includes(state.name) || typeof request.value !== 'string' || request.value.length > 4096) return fail('POLICY_BLOCKED');
      const prototype = element.tagName === 'TEXTAREA' ? doc.defaultView!.HTMLTextAreaElement.prototype : doc.defaultView!.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set; if (!setter) return fail('UNSUPPORTED_SURFACE');
      mutationStarted = true; setter.call(element, request.value);
      element.dispatchEvent(new doc.defaultView!.Event('input', { bubbles: true }));
      element.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
    }
    // Do not return typed input or changed page content from a mutation.
    return { ...empty, count: 1, visible: true, enabled: true };
  } catch { return fail(mutationStarted ? 'ACTION_OUTCOME_UNKNOWN' : 'UNSUPPORTED_SURFACE'); }
}

// A structural failure artifact: useful screen/control/table context, no arbitrary text,
// IDs, values, URLs, attributes, or hidden DOM. Unknown text is omitted, not regex-redacted.
export function snapshotDom(policy: SurfacePolicy) {
  const labels = ['Staff workspace', 'Member Search', 'Member Overview', 'Account Inquiry', 'Account Details', 'No matching member', 'No primary savings account', 'Access denied',
    'Unable to continue', 'Member ID', 'Account ID', 'Account Type', 'Designation', 'Status', 'Current Balance', 'Available Balance', 'Currency', 'Action', 'Member Name', 'Membership Status',
    ...policy.allowedClickNames, ...policy.allowedFillNames];
  const safe = (value: string | null) => labels.find(label => label === (value ?? '').replace(/\s+/g, ' ').trim()) ?? null;
  let omittedFrames = 0;
  const documents: unknown[] = [];
  const visit = (doc: Document, depth: number) => {
    if (!policy.allowedOrigins.includes(doc.location.origin) || depth > 4 || documents.length >= 8) { omittedFrames++; return; }
    const visible = (el: Element) => el.getClientRects().length > 0 && !el.closest('[hidden],[inert],[aria-hidden="true"]');
    documents.push({ depth,
      headings: [...doc.querySelectorAll('h1,h2,h3,[role="alert"]')].filter(visible).slice(0, 30).map(el => ({ kind: el.tagName.toLowerCase(), label: safe(el.textContent) })),
      controls: [...doc.querySelectorAll('button,input,textarea,select,a[href]')].filter(visible).slice(0, 80).map(el => ({ kind: el.tagName.toLowerCase(),
        label: safe(el.getAttribute('aria-label') ?? el.textContent), enabled: !el.matches(':disabled,[aria-disabled="true"]') })),
      tables: [...doc.querySelectorAll('table')].filter(visible).slice(0, 8).map(el => ({ columns: [...el.querySelectorAll('thead th')].slice(0, 16).map(cell => safe(cell.textContent)), rowCount: Math.min(el.querySelectorAll('tbody tr').length, 1000) })),
    });
    for (const frame of [...doc.querySelectorAll('iframe')].slice(0, 8)) {
      try { if (!frame.contentDocument) omittedFrames++; else visit(frame.contentDocument, depth + 1); } catch { omittedFrames++; }
    }
  };
  visit(document, 0); return { schemaVersion: 1, kind: 'structural-snapshot', redactedValues: true, documents, omittedFrames };
}
