/// <reference lib="dom" />
import type { Values } from '@interface-ai/contracts';
import type { SurfacePolicy } from '../execution/surface.js';
import type { safeLabels, staticValues } from './contracts.js';

// Observes rendered UI only. Input/record values stay in this browser function; the
// model sees binding matches, static business labels, and opaque control references.
export async function observeDom(inputs: Values, policy: SurfacePolicy, labels: typeof safeLabels, constants: typeof staticValues) {
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const safe = (value: string | null | undefined) => labels.find(label => label === normalize(value));
  const constant = (value: string | null | undefined) => constants.find(label => label === normalize(value)) ?? null;
  const visible = (el: Element) => el.getClientRects().length > 0 && el.ownerDocument.defaultView!.getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert],[aria-hidden="true"]');
  const match = (value: string) => Object.keys(inputs).filter(key => typeof inputs[key] === 'string' && inputs[key] === value);
  const controls: unknown[] = []; const fields: unknown[] = []; const headings: unknown[] = []; const signature: string[] = [];
  let ready = true; let controlIndex = 0; let fieldIndex = 0; let frameCount = 0;
  const docs: Array<{ doc: Document; scope: { kind: string; frames?: Array<{ attribute: string; value: string }> } }> = [{ doc: document, scope: { kind: 'document' } }];
  for (const frame of [...document.querySelectorAll('iframe')].filter(visible)) {
    if (frameCount++ >= 4) throw new Error('UNSUPPORTED_SURFACE');
    const title = safe(frame.getAttribute('title')); const source = frame.getAttribute('src');
    if (!title || !source || !policy.allowedOrigins.includes(new URL(source, document.location.href).origin)) throw new Error('POLICY_BLOCKED');
    const doc = frame.contentDocument;
    if (!doc || doc.location.href === 'about:blank' || doc.readyState !== 'complete') { ready = false; continue; }
    if (!policy.allowedOrigins.includes(doc.location.origin)) throw new Error('POLICY_BLOCKED');
    docs.push({ doc, scope: { kind: 'frame', frames: [{ attribute: 'title', value: title }] } });
  }
  if (!frameCount) ready = false;
  for (const { doc, scope } of docs) {
    if (!policy.allowedOrigins.includes(doc.location.origin)) throw new Error('POLICY_BLOCKED');
    signature.push(doc.location.href);
    if ([...doc.querySelectorAll('[role="status"]')].filter(visible).some(el => normalize(el.textContent).startsWith('Loading ') || normalize(el.textContent).startsWith('Opening '))) ready = false;
    for (const el of [...doc.querySelectorAll('h1')].filter(visible)) {
      const label = safe(el.textContent); if (label) headings.push({ label, target: { scope, within: [], locator: { kind: 'role', role: 'heading', name: label, exact: true }, expectedMatches: 1 } });
    }
    for (const el of [...doc.querySelectorAll('button,input,textarea,a[href]')].filter(visible).slice(0, 80)) {
      const input = el as HTMLInputElement;
      const fill = ['INPUT', 'TEXTAREA'].includes(el.tagName);
      if (fill && ['password', 'hidden', 'file', 'checkbox', 'radio', 'submit'].includes(input.type)) continue;
      const label = safe(el.getAttribute('aria-label') ?? (fill ? [...(input.labels ?? [])].map(item => item.textContent).join(' ') : el.textContent));
      if (!label || !(fill ? policy.allowedFillNames : policy.allowedClickNames).includes(label)) continue;
      const within: unknown[] = []; const row: Record<string, string> = {}; let matchesInputs: string[] = []; let accountIdTarget: unknown;
      const tableRow = el.closest('tbody tr');
      if (tableRow) {
        const table = tableRow.closest('table')!; const caption = safe(table.querySelector(':scope > caption')?.textContent);
        const columns = [...table.querySelectorAll('thead th')].map(item => normalize(item.textContent));
        const cells = [...tableRow.children].filter(item => ['TD', 'TH'].includes(item.tagName));
        if (!caption || table.querySelector('[rowspan],[colspan]') || columns.length !== cells.length || new Set(columns).size !== columns.length) throw new Error('UNSUPPORTED_SURFACE');
        const predicates: unknown[] = [];
        for (const [index, column] of columns.entries()) {
          const value = normalize(cells[index]!.textContent); signature.push(column + ':' + value);
          if (column === 'Member ID') {
            const names = match(value); matchesInputs = names;
            if (names.length === 1) predicates.push({ columnHeader: column, equals: { kind: 'input', name: names[0] } });
          } else if (['Account Type', 'Designation', 'Status', 'Currency', 'Membership Status'].includes(column)) {
            const label = constant(value); if (label) { row[column] = label; predicates.push({ columnHeader: column, equals: { kind: 'literal', value: label } }); }
          }
        }
        if (columns.includes('Member ID') && matchesInputs.length !== 1) continue;
        if (!predicates.length) continue;
        const descriptor = { kind: 'tableRow', tableCaption: caption, cells: predicates };
        within.push(descriptor);
        if (columns.includes('Account ID')) accountIdTarget = { scope, within: [descriptor], locator: { kind: 'cell', columnHeader: 'Account ID' }, expectedMatches: 1 };
      } else {
        const form = el.closest('form[aria-label]'); const formName = safe(form?.getAttribute('aria-label'));
        if (formName) within.push({ kind: 'container', locator: { kind: 'role', role: 'form', name: formName, exact: true } });
      }
      const enabled = !el.matches(':disabled,[aria-disabled="true"]') && (!fill || !input.readOnly);
      if (fill) signature.push(label + ':' + input.value);
      controls.push({ ref: 'c' + ++controlIndex, kind: fill ? 'fill' : 'click', label,
        target: { scope, within, locator: fill ? { kind: 'label', text: label, exact: true } : { kind: 'role', role: el.tagName === 'A' ? 'link' : 'button', name: label, exact: true }, expectedMatches: 1 },
        enabled, filled: fill && match(input.value).length === 1, row, matchesInputs, ...(accountIdTarget ? { accountIdTarget } : {}) });
    }
    for (const term of [...doc.querySelectorAll('dt')].filter(visible).slice(0, 64)) {
      const label = safe(term.textContent); const value = term.nextElementSibling;
      const section = term.closest('section[aria-label]'); const region = safe(section?.getAttribute('aria-label'));
      if (!label || !value || value.tagName !== 'DD' || !region) continue;
      const content = normalize(value.textContent); signature.push(label + ':' + content);
      fields.push({ ref: 'f' + ++fieldIndex, label, region, matchesInputs: match(content), constant: constant(content),
        target: { scope, within: [{ kind: 'container', locator: { kind: 'role', role: 'region', name: region, exact: true } }], locator: { kind: 'field', label }, expectedMatches: 1 } });
    }
  }
  // No raw values cross this boundary. The digest is local freshness data, not model context.
  signature.push(JSON.stringify({headings,controls,fields}));
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(signature)));
  const fingerprint = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { observationId: crypto.randomUUID(), fingerprint, ready: ready && headings.length > 0, headings, controls, fields };
}
