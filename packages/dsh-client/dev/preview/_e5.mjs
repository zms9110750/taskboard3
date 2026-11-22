import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
const EDGE=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const PORT=9481; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const ud=mkdtempSync(nodePath.join(tmpdir(),'e5-'));
const proc=spawn(EDGE,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${ud}`,'--no-first-run','--no-default-browser-check','--disable-gpu','about:blank'],{stdio:'ignore'});
const waitFor=async(fn,ms=25000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const v=await fn();if(v)return v}catch{}await sleep(150)}throw new Error('timeout')};
await waitFor(async()=>(await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok);
let seq=0;const pending=new Map();
const send=(ws,method,params={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,(m)=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result));ws.send(JSON.stringify({id,method,params}))});
const target=await(await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((o,n)=>{ws.onopen=o;ws.onerror=n});
ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id!==undefined&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};
await send(ws,'Runtime.enable');await send(ws,'Page.enable');
const ev=async(expr)=>{const r=await send(ws,'Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{error:JSON.stringify(r.exceptionDetails).slice(0,400)};return r.result.value};
await send(ws,'Page.navigate',{url:process.argv[2]});await sleep(11000);
console.log(JSON.stringify(await ev(`(async()=>{
  const out={};
  const get=async(p)=>{const r=await fetch(p); return {status:r.status, json:await r.json().catch(()=>null)}};
  const post=async(p,b)=>{const r=await fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}); return {status:r.status, json:await r.json().catch(()=>null)}};

  /* 1. 列空间 */
  out.workspaces=(await get('taskboard3/api/workspaces')).json?.data;

  /* 2. 建卡到 ws2 并立即读回 */
  const created=await post('taskboard3/api/cards',{workspaceId:'ws2',templateRef:'writeCode',title:'验收卡A'});
  out.created={status:created.status, code:created.json?.code, message:created.json?.message, cardId:created.json?.data?.card?.id, wsOfCard:created.json?.data?.card?.workspaceId};

  /* 3. 立刻查 state */
  const st=await get('taskboard3/api/state');
  out.stateAfter={status:st.status, cards:(st.json?.data?.cards??[]).map(c=>({id:c.id,ws:c.workspaceId,title:c.title}))};

  /* 4. 显式按 workspace 查 */
  const byWs=await get('taskboard3/api/state?workspace=ws2');
  out.stateWs2={status:byWs.status, cards:(byWs.json?.data?.cards??[]).length};

  /* 5. 查卡列表端点 */
  const cards=await get('taskboard3/api/cards?workspace=ws2');
  out.cardsEndpoint={status:cards.status, n:(cards.json?.data?.cards??[]).length, code:cards.json?.code};

  return out;
})()`),null,2));
ws.close();proc.kill();
