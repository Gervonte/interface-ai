import express from 'express';

// Deliberately tiny, synthetic UI for SDK compatibility checks, not INT-006's portal.
const members = {
  M1001: { name: 'Jordan Ellis', savings: 'S2001', current: '$1,250.34', available: '$1,200.34' },
  M1002: { name: 'Taylor Morgan', savings: 'S2002', current: '$87.65', available: '$76.00' },
} as const;
type MemberId = keyof typeof members;
function memberId(value: unknown): MemberId | undefined {
  return value === 'M1001' || value === 'M1002' ? value : undefined;
}
function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/compatibility/styles.css"></head><body>${body}</body></html>`;
}
const styles = `:root{font:16px system-ui,sans-serif;color:#182b3c;background:#f4f6f8}body{margin:0}header{background:#163a52;color:white;padding:20px 28px}header p{margin:6px 0}main{padding:24px;max-width:1100px;margin:auto}h1{font-size:24px}h2{font-size:21px}.notice{padding:12px 16px;background:#fff0bd;border:1px solid #dfc578}.context{padding:16px;background:white;border:1px solid #ccd5dd}iframe{width:100%;height:640px;border:1px solid #b4c4d0;background:white}form{display:inline}input,button{font:inherit;padding:8px 12px}button{cursor:pointer;background:#164e70;color:white;border:1px solid #164e70;border-radius:4px}label{margin-right:8px}table{border-collapse:collapse;width:100%;margin-top:24px;background:white}caption{text-align:left;font-weight:bold;padding:10px 0}th,td{padding:14px 10px;text-align:left;border-bottom:1px solid #d5dfe6}thead{background:#e8eff4}dt{font-weight:bold;margin-top:16px}dd{margin:4px 0 0}a{color:#164e70}`;

export function createCompatibilityFixture() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.set({
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; frame-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    next();
  });
  app.get('/healthz', (_request, response) => response.json({ status: 'ok', service: 'compatibility-fixture' }));
  app.get('/compatibility/styles.css', (_request, response) => response.type('css').send(styles));
  app.get('/compatibility', (_request, response) => response.send(page('Demo Credit Union — Staff Services', `
    <header><strong>Demo Credit Union — Staff Services</strong><p>Operator: Alex Chen · Branch: Training · Role: Member Services</p></header>
    <main><h1>Staff workspace</h1><p class="notice">Synthetic compatibility fixture — INT-002/INT-003. This is not the finished staff portal.</p>
    <iframe title="Member servicing workspace" src="/compatibility/workspace"></iframe></main>`)));
  app.get('/compatibility/workspace', (request, response) => {
    const id = request.query.memberId === undefined ? 'M1001' : memberId(request.query.memberId);
    const form = `<form action="/compatibility/workspace" method="get"><label for="memberId">Member ID</label><input id="memberId" name="memberId" value="${id ?? ''}" required pattern="M[0-9]{4}"><button type="submit">Find member</button></form>`;
    if (!id) {
      response.status(200).send(page('Member servicing', `<main><h1>Member servicing</h1>${form}<p role="status">No matching synthetic member. Try M1001 or M1002.</p></main>`));
      return;
    }
    const member = members[id];
    const savings = `<tr><td>${member.savings}</td><td>Primary Savings</td><td>Primary</td><td>Active</td><td>${member.current}</td><td>${member.available}</td><td><form action="/compatibility/account"><input type="hidden" name="memberId" value="${id}"><button name="accountId" value="${member.savings}">Open</button></form></td></tr>`;
    const checking = `<tr><td>C3001</td><td>Checking</td><td>Secondary</td><td>Active</td><td>$540.00</td><td>$500.00</td><td><form action="/compatibility/account"><input type="hidden" name="memberId" value="${id}"><button name="accountId" value="C3001">Open</button></form></td></tr>`;
    response.send(page('Member servicing', `<main><h1>Member servicing</h1>${form}
      <p class="context">Active member: ${member.name} · Member ID: <strong>${id}</strong> · Status: Active</p>
      <h2>Account Inquiry</h2><table><caption>Member accounts</caption><thead><tr><th scope="col">Account ID</th><th scope="col">Account Type</th><th scope="col">Designation</th><th scope="col">Status</th><th scope="col">Current Balance</th><th scope="col">Available Balance</th><th scope="col">Action</th></tr></thead><tbody>${id === 'M1001' ? checking + savings : savings + checking}</tbody></table></main>`));
  });
  app.get('/compatibility/account', (request, response) => {
    const id = memberId(request.query.memberId);
    const member = id ? members[id] : undefined;
    const savings = member && request.query.accountId === member.savings;
    const checking = member && request.query.accountId === 'C3001';
    if (!id || !member || (!savings && !checking)) {
      response.status(404).send(page('Account unavailable', '<main><h1>Account unavailable</h1><a href="/compatibility/workspace">Back to member servicing</a></main>'));
      return;
    }
    response.send(page('Account Details', `<main><h1>Account Details</h1><p class="context">Active member: ${member.name} · Member ID: <strong>${id}</strong></p>
      <dl><dt>Account ID</dt><dd>${savings ? member.savings : 'C3001'}</dd><dt>Account Type</dt><dd>${savings ? 'Primary Savings' : 'Checking'}</dd><dt>Status</dt><dd>Active</dd><dt>Current Balance</dt><dd>${savings ? member.current : '$540.00'}</dd><dt>Available Balance</dt><dd>${savings ? member.available : '$500.00'}</dd></dl>
      <p><a href="/compatibility/workspace?memberId=${id}">Back to Account Inquiry</a></p></main>`));
  });
  // No static directory, development server, business-data endpoint, or arbitrary proxy.
  app.use((_request, response) => response.status(404).type('text').send('Route not found.'));
  return app;
}
