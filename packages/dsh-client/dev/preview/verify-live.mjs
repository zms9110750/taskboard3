// 可复用验收探针：在隔离 profile 里跑完整用户流程
// 用法：node dev/preview/verify-live.mjs "http://127.0.0.1:PORT/?token=..."
//
// 判据（全部必须是「能看到/能点到」的产品事实，不是代码事实）：
//   1. 面板渲染且有样式（tb3w-root display=flex、styleLen > 1000）
//   2. 建空间 201，空间条上出现
//   3. 切空间真的换数据（count 变化 + 卡片编号变化）
//   4. 建卡 201，卡片出现在列表里
//
// ⚠ **每次都用唯一名字**：数据目录复用 taskboard2 的地址后，库里会累积历史空间；
//   写死名字第二次跑就撞 `WORKSPACE_EXISTS` ⇒ 探针会假红。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
const PORT = 9501;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = String(Date.now()).slice(-6);
const SPACE_NAME = `验收空间${stamp}`;
const CARD_TITLE = `验收卡${stamp}`;

const ud = mkdtempSync(nodePath.join(tmpdir(), 'verify-'));
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
	if (m.method === 'Runtime.exceptionThrown') {
		const d = m.params.exceptionDetails;
		logs.push((d.exception?.description ?? d.text ?? '').slice(0, 400));
	}
};

await send(ws, 'Runtime.enable');
await send(ws, 'Page.enable');

const ev = async (expr) => {
	const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
	if (r.exceptionDetails) return { error: JSON.stringify(r.exceptionDetails).slice(0, 300) };
	return r.result.value;
};
const shot = async (name) => {
	const s = await send(ws, 'Page.captureScreenshot', { format: 'png' });
	if (s.data) writeFileSync(`X:/temp/dsh/${name}.png`, Buffer.from(s.data, 'base64'));
};

const results = [];
const check = (name, ok, detail) => {
	results.push({ name, ok, detail });
	console.log(`${ok ? '✅' : '❌'} ${name}${detail === undefined ? '' : `  —  ${detail}`}`);
};

/** 关预览弹窗 + 开右栏 + 点任务板。 */
const openPanel = async () => {
	await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
	await sleep(1200);
	await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='打开右侧边栏');if(b)b.click()})()`);
	await sleep(2200);
	await ev(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('任务板')&&x.className&&x.className.includes('entry')); if(b) b.click() })()`);
	await sleep(4000);
};

await send(ws, 'Page.navigate', { url: process.argv[2] });
await sleep(12000);
await openPanel();

/* ① 面板 + 样式 */
const panel = await ev(`(function(){
  const st=document.getElementById('taskboard3-styles');
  const root=document.querySelector('[class*="tb3w-root"]');
  const out={ styleLen: st?(st.textContent||'').length:0 };
  if(root){ const cs=getComputedStyle(root); out.display=cs.display }
  return out;
})()`);
check('面板渲染且有样式', (panel?.styleLen ?? 0) > 1000 && panel?.display === 'flex', `styleLen=${String(panel?.styleLen)} display=${String(panel?.display)}`);

/* ② 建空间（唯一名字） */
const space = await ev(`(async()=>{
  const r=await fetch('taskboard3/api/workspaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'${SPACE_NAME}'})});
  const j=await r.json().catch(()=>null);
  return { status:r.status, id:j?.data?.workspace?.id, code:j?.code, message:j?.message };
})()`);
check('建空间 201', space?.status === 201, `id=${String(space?.id)}${space?.code === undefined ? '' : ` code=${String(space.code)}`}`);

/* ③ 建卡到那个空间 */
const card = await ev(`(async()=>{
  const r=await fetch('taskboard3/api/cards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId:'${String(space?.id)}',templateRef:'writeCode',title:'${CARD_TITLE}'})});
  const j=await r.json().catch(()=>null);
  return { status:r.status, id:j?.data?.card?.id, code:j?.code, message:j?.message };
})()`);
check('建卡 201', card?.status === 201, `id=${String(card?.id)}${card?.code === undefined ? '' : ` code=${String(card.code)}`}`);

/* ④ 刷新 + 切空间，看卡片真出现 */
await send(ws, 'Page.reload');
await sleep(11000);
await openPanel();

const before = await ev(`[...document.querySelectorAll('[class*="tb3w-toolbar__count"]')].map(e=>(e.textContent||'').trim())`);

const clicked = await ev(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('${SPACE_NAME}')); if(!b) return 'not found'; b.click(); return 'clicked' })()`);
check('能点到新空间', clicked === 'clicked', String(clicked));
await sleep(3500);

const after = await ev(`(function(){
  const counts=[...document.querySelectorAll('[class*="tb3w-toolbar__count"]')].map(e=>(e.textContent||'').trim());
  const ids=[...document.querySelectorAll('[class*="card-id"]')].map(e=>(e.textContent||'').trim()).filter(Boolean);
  const titles=[...document.querySelectorAll('[class*="tb3w-card"],[class*="tb3t-card"]')].map(e=>(e.textContent||'').trim()).slice(0,4);
  return { counts, ids, titles };
})()`);
check('切空间后卡片真的显示', (after?.ids ?? []).includes(String(card?.id)), `ids=${JSON.stringify(after?.ids)}`);
check('切空间前后条数变了', JSON.stringify(before) !== JSON.stringify(after?.counts), `${JSON.stringify(before)} → ${JSON.stringify(after?.counts)}`);

await shot('verify-live');

console.log(`\n${results.every((r) => r.ok) ? '✅ 全部通过' : '❌ 有失败'}`);
if (logs.length > 0) {
	console.log('\n=== 页面异常 ===');
	for (const one of logs.slice(0, 8)) console.log('  ' + one);
}

ws.close();
proc.kill();
process.exit(results.every((r) => r.ok) ? 0 : 1);
