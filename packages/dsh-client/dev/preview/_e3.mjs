import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
const EDGE=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const PORT=9461; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const ud=mkdtempSync(nodePath.join(tmpdir(),'e3-'));
const proc=spawn(EDGE,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${ud}`,'--no-first-run','--no-default-browser-check','--disable-gpu','--window-size=1920,1080','about:blank'],{stdio:'ignore'});
const waitFor=async(fn,ms=25000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const v=await fn();if(v)return v}catch{}await sleep(150)}throw new Error('timeout')};
await waitFor(async()=>(await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok);
let seq=0;const pending=new Map();const logs=[];
const send=(ws,method,params={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,(m)=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result));ws.send(JSON.stringify({id,method,params}))});
const target=await(await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((o,n)=>{ws.onopen=o;ws.onerror=n});
ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id!==undefined&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);return}if(m.method==='Runtime.consoleAPICalled'){logs.push({t:m.params.type,x:(m.params.args??[]).map(a=>a.value??a.description??'').join(' ').slice(0,300)})}if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;logs.push({t:'exception',x:(d.exception?.description??d.text??'').slice(0,400)})}};
await send(ws,'Runtime.enable');await send(ws,'Page.enable');
const ev=async(expr)=>{const r=await send(ws,'Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{error:JSON.stringify(r.exceptionDetails).slice(0,300)};return r.result.value};
await send(ws,'Page.navigate',{url:process.argv[2]});await sleep(12000);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`); await sleep(1200);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='打开右侧边栏');if(b)b.click()})()`); await sleep(2200);
await ev(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('任务板')&&x.className&&x.className.includes('entry')); if(b) b.click() })()`); await sleep(4000);
console.log('=== state（几个空间 / 几张卡）===');
console.log(JSON.stringify(await ev(`(async()=>{
  const r=await fetch('taskboard3/api/state');
  const j=await r.json();
  return { status:r.status, workspaces:(j.data?.workspaces??[]).map(w=>({id:w.id,name:w.displayName})), cards:(j.data?.cards??[]).length, templates:(j.data?.templates??[]).length, activeWorkspace:j.data?.activeWorkspaceId ?? j.data?.currentWorkspaceId ?? 'n/a' };
})()`),null,2));
console.log('\n=== 面板上的空间条元素 ===');
console.log(JSON.stringify(await ev(`(function(){
  const out={};
  out.barCandidates=[...document.querySelectorAll('[class*="tb3w-bar"],[class*="tb3w-space"],[class*="tb3w-fold"],[class*="tb3w-chip"]')].map(e=>({cls:(e.className||'').toString().slice(0,45), txt:(e.textContent||'').trim().slice(0,25)})).slice(0,12);
  out.buttons=[...document.querySelectorAll('button')].filter(b=>{const r=b.getBoundingClientRect();return r.y>40&&r.y<220&&r.x>1000}).map(b=>({t:(b.textContent||'').trim().slice(0,18), aria:b.getAttribute('aria-label')||'', x:Math.round(b.getBoundingClientRect().x), y:Math.round(b.getBoundingClientRect().y)})).slice(0,15);
  return out;
})()`),null,2));
const s=await send(ws,'Page.captureScreenshot',{format:'png'});
if(s.data){writeFileSync('X:/temp/dsh/e2e-3-state.png',Buffer.from(s.data,'base64'));console.log('\n截图 e2e-3-state.png')}
ws.close();proc.kill();
