export function operatorPage(token: string, nonce: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>INT-003 compatibility check</title>
  <style>body{font:16px system-ui,sans-serif;margin:24px;background:#f4f7fa;color:#142d40}main{max-width:1400px;margin:auto}h1{font-size:25px}button,input{font:inherit;padding:9px;margin:4px}button{background:#174e70;color:white;border:0;border-radius:4px;cursor:pointer}button:disabled{background:#b8c3cc;cursor:default}.panel{background:white;border:1px solid #cbd5dd;padding:18px;margin:16px 0}#status{font-weight:bold}#error{color:#9d1d1d}img{width:100%;border:1px solid #b4c4d0}pre{white-space:pre-wrap;font-size:13px;overflow-wrap:anywhere}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:4px}</style></head><body><main>
  <h1>INT-003 — Browserbase / Stagehand compatibility check</h1>
  <p>This temporary local tool operates synthetic data in one hosted browser session.</p>
  <section class="panel"><p id="status">Loading…</p><p id="session"></p><button id="start">Start live check</button><p id="error" role="alert"></p></section>
  <section class="panel" id="manual" hidden><h2>Manual takeover</h2><ol><li>Claim control.</li><li>Enter <strong>M1001</strong> below and click <strong>Set Member ID</strong>.</li><li>Click <strong>Find member</strong>, then <strong>Open Primary Savings</strong>.</li><li>Confirm the screen shows M1001 / S2001, then click <strong>Hand back to automation</strong>.</li></ol>
  <div class="controls"><button id="claim">Claim control</button><label>Member ID <input id="member" value="M1001" maxlength="5" autocomplete="off"></label><span id="controls"></span><button id="refresh">Refresh session view</button><button id="resume">Hand back to automation</button></div>
  <p>All buttons operate the hosted session shown below. Keep the check open until it reports complete.</p><img id="view" alt="Current hosted staff portal session"></section>
  <details class="panel"><summary>Check results and action history</summary><pre id="details"></pre></details>
  </main><script nonce="${nonce}">
  const token=${JSON.stringify(token)}; let state; let busy=false; let lastView='';
  const el=id=>document.getElementById(id);
  async function call(path, body) {
    if(busy) return; busy=true; el('error').textContent='';
    try {
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Spike-Token':token},body:JSON.stringify(body)});
      const result=await response.json(); if(!response.ok) throw new Error(result.error ?? 'Request failed.');
    } catch(error) {el('error').textContent=error.message;} finally {busy=false; await poll();}
  }
  async function poll() {
    try {
      const response=await fetch('/state'); if(!response.ok) throw new Error('Local check is unavailable.'); state=await response.json();
      el('status').textContent='Phase: '+state.phase+' · Controller: '+state.control.owner+' · Revision: '+state.control.revision;
      el('session').textContent=state.sessionId ? 'Hosted session: '+state.sessionId : 'No hosted session created yet.';
      el('start').hidden=state.phase!=='idle'; el('manual').hidden=state.phase!=='waiting_for_human';
      el('claim').disabled=busy || state.control.busy || state.control.owner!=='none';
      el('resume').disabled=busy || state.control.busy || state.control.owner!=='human';
      el('refresh').disabled=busy || state.control.busy;
      const observation=state.observation;
      const signature=(observation?.id ?? '')+state.control.owner;
      if(signature!==lastView) {
        lastView=signature; el('controls').replaceChildren();
        for(const control of observation?.controls ?? []) {
          const button=document.createElement('button'); button.textContent=control.kind==='fill' ? 'Set Member ID' : control.label;
          button.disabled=state.control.owner!=='human';
          button.onclick=()=>call('/manual',{revision:state.control.revision, observationId:observation.id, target:control.id,...(control.kind==='fill'?{value:el('member').value}:{})});
          el('controls').append(button);
        }
        if(observation) el('view').src='/observation.png?id='+encodeURIComponent(observation.id);
      }
      el('details').textContent=JSON.stringify({result:state.result,events:state.events},null,2);
    } catch(error) {el('error').textContent=error.message;}
  }
  el('start').onclick=()=>call('/start',{});
  el('claim').onclick=()=>call('/claim',{revision:state.control.revision});
  el('resume').onclick=()=>call('/resume',{revision:state.control.revision});
  el('refresh').onclick=()=>call('/refresh',{});
  poll(); setInterval(()=>{if(!busy) poll();},1000);
  </script></body></html>`;
}
