// 一次性探针：在隔离 profile 里跑完整用户流程并截图
// ① 开 GUI ② 关预览弹窗 ③ 开右侧栏 ④ 点任务板入口 ⑤ 建空间 ⑥ 建卡 ⑦ 截图
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
const PORT = 9451;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ud = mkdtempSync(nodePath.join(tmpdir(), 'e2e2-'));
const proc = spawn(
	EDGE,
	[
		'--headless=new',
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${ud}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'--window-size=1920,1080',
		'about:blank',
	],
	{ stdio: 'ignore' },
);

const waitFor = async (fn, ms = 25000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const v = await fn();
			if (v) return v;
		} catch {}
		await sleep(150);
	}
	throw new Error('timeout');
};
await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok);

let seq = 0;
const pending = new Map();
const logs = [];
const send = (ws, method, params = {}) =>
	new Promise((res, rej) => {
		const id = ++seq;
		pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
		ws.send(JSON.stringify({ id, method, params }));
	});

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((o, n) => {
	ws.onopen = o;
	ws.onerror = n;
});
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
		return;
	}
	if (m.method === 'Runtime.consoleAPICalled') {
		logs.push({ t: m.params.type, x: (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
	}
	if (m.method === 'Runtime.exceptionThrown') {
		const d = m.params.exceptionDetails;
		logs.push({ t: 'exception', x: (d.exception?.description ?? d.text ?? '').slice(0, 400) });
	}
};

await send(ws, 'Runtime.enable');
await send(ws, 'Page.enable');

const ev = async (expr) => {
	const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
	if (r.exceptionDetails) return { error: JSON.stringify(r.exceptionDetails).slice(0, 250) };
	return r.result.value;
};

const shot = async (name) => {
	const s = await send(ws, 'Page.captureScreenshot', { format: 'png' });
	if (s.data) writeFileSync(`X:/temp/dsh/${name}.png`, Buffer.from(s.data, 'base64'));
	return `${name}.png`;
};

await send(ws, 'Page.navigate', { url: process.argv[2] });
await sleep(12000);

/* ① 关预览弹窗 */
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
await sleep(1200);

/* ② 开右侧栏 */
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='打开右侧边栏');if(b)b.click()})()`);
await sleep(2500);

/* ③ 点任务板入口 */
await ev(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('任务板')&&x.className&&x.className.includes('entry')); if(b) b.click() })()`);
await sleep(4000);

console.log('=== ① 面板状态 ===');
console.log(
	JSON.stringify(
		await ev(`(function(){
  const root=document.querySelector('[class*="tb3w-root"]');
  const st=document.getElementById('taskboard3-styles');
  const out={ styleOk: !!st && (st.textContent||'').length>1000 };
  if(root){ const cs=getComputedStyle(root); const r=root.getBoundingClientRect(); out.root={ display:cs.display, w:Math.round(r.width), h:Math.round(r.height) } }
  out.toolbar=document.querySelectorAll('[class*="tb3w-chrome"]').length;
  out.texts=[...document.querySelectorAll('[class*="tb3w-"]')].map(e=>(e.textContent||'').trim()).filter(t=>t&&t.length<24).slice(0,10);
  return out;
})()`),
		null,
		2,
	),
);
await shot('e2e-1-panel');

/* ④ 用 API 建空间（UI 建空间按钮需要更多步骤，这里先用 API 验数据链路，再用 UI 验渲染） */
console.log('\n=== ② 建空间 + 建卡（走真 API，带浏览器 cookie）===');
console.log(
	JSON.stringify(
		await ev(`(async()=>{
  const post=async(p,b)=>{ const r=await fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}); return { status:r.status, json:await r.json().catch(()=>null) } };
  const ws1=await post('taskboard3/api/workspaces',{name:'验收空间'});
  const wsId=ws1.json?.data?.workspace?.id;
  const card=await post('taskboard3/api/cards',{workspaceId:wsId,templateRef:'writeCode',title:'验收用卡'});
  return { workspace:{status:ws1.status,id:wsId}, card:{status:card.status,id:card.json?.data?.card?.id,code:card.json?.code} };
})()`),
		null,
		2,
	),
);
await sleep(2500);

/* ⑤ 刷新页面看数据是否渲染出来 */
await send(ws, 'Page.reload');
await sleep(11000);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
await sleep(1200);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='打开右侧边栏');if(b)b.click()})()`);
await sleep(2000);
await ev(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('任务板')&&x.className&&x.className.includes('entry')); if(b) b.click() })()`);
await sleep(4000);

console.log('\n=== ③ 刷新后卡片渲染 ===');
console.log(
	JSON.stringify(
		await ev(`(function(){
  const cards=[...document.querySelectorAll('[class*="tb3w-card"],[class*="tb3t-card"]')];
  const ids=[...document.querySelectorAll('[class*="card-id"]')];
  const out={ cardEls:cards.length, idEls:ids.length, idTexts:ids.map(e=>(e.textContent||'').trim()).slice(0,5) };
  out.toolbarCount=[...document.querySelectorAll('[class*="tb3w-toolbar__count"]')].map(e=>(e.textContent||'').trim());
  out.spaceTab=[...document.querySelectorAll('[class*="tb3w-space"]')].map(e=>(e.textContent||'').trim()).filter(Boolean).slice(0,6);
  return out;
})()`),
		null,
		2,
	),
);
await shot('e2e-2-cards');

console.log('\n=== console 相关 ===');
const rel = logs.filter((o) => /taskboard|slot|inject|cannot|failed|error|crash|tb3/i.test(o.x));
if (!rel.length) console.log('（无）');
else rel.slice(0, 12).forEach((o) => console.log(`[${o.t}] ${o.x}`));

ws.close();
proc.kill();
