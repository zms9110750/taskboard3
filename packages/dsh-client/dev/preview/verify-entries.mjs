// 可复用验收探针：验证**三处入口**都在
// 用法：node dev/preview/verify-entries.mjs "http://127.0.0.1:PORT/?token=..."
//
// 判据：
//   ① 左侧栏有任务板图标（sidebar.panellist）⇒ 点了主区域出现面板
//   ② 输入框附近有抽屉入口（conversation.input.overlay）⇒ 点了抽屉滑出
//   ③ 右侧工作区有任务板标签页（sidebar.right.pane.tab）⇒ 点了面板出现
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
const PORT = 9541;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ud = mkdtempSync(nodePath.join(tmpdir(), 'entries-'));
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
		logs.push((d.exception?.description ?? d.text ?? '').slice(0, 300));
	}
	if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
		logs.push((m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
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

await send(ws, 'Page.navigate', { url: process.argv[2] });
await sleep(12000);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
await sleep(1500);

/* ═══ ① 左侧栏入口 ═══ */
const leftIcon = await ev(`(function(){
  /* 左侧栏的 panellist 条目：label 是「任务板」的可点元素 */
  const cands=[...document.querySelectorAll('button,[role="button"],[role="tab"],a')].filter(e=>{
    const r=e.getBoundingClientRect();
    const label=(e.getAttribute('aria-label')||e.getAttribute('title')||(e.textContent||'').trim());
    return r.width>0 && r.height>0 && r.x<120 && label.includes('任务板');
  });
  if(!cands.length) return { found:false };
  const el=cands[0]; const r=el.getBoundingClientRect();
  return { found:true, w:Math.round(r.width), h:Math.round(r.height), x:Math.round(r.x), y:Math.round(r.y) };
})()`);
check(
	'① 左侧栏有任务板入口',
	leftIcon?.found === true,
	leftIcon?.found ? `${String(leftIcon.w)}×${String(leftIcon.h)} @ (${String(leftIcon.x)},${String(leftIcon.y)})` : '找不到',
);

/* 点它 */
if (leftIcon?.found === true) {
	const clicked = await ev(`(function(){
    const cands=[...document.querySelectorAll('button,[role="button"],[role="tab"],a')].filter(e=>{
      const r=e.getBoundingClientRect();
      const label=(e.getAttribute('aria-label')||e.getAttribute('title')||(e.textContent||'').trim());
      return r.width>0 && r.height>0 && r.x<120 && label.includes('任务板');
    });
    if(!cands.length) return 'not found';
    cands[0].click(); return 'clicked';
  })()`);
	await sleep(3500);
	const mainPanel = await ev(`(function(){
    const roots=[...document.querySelectorAll('[class*="tb3w-root"]')];
    const st=document.getElementById('taskboard3-styles');
    const r=roots[0]?.getBoundingClientRect();
    return { count:roots.length, styleLen:st?(st.textContent||'').length:0, rect:r?{w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x)}:null };
  })()`);
	check(
		'① 点左侧栏后主区域出现面板',
		(mainPanel?.count ?? 0) > 0 && (mainPanel?.styleLen ?? 0) > 1000,
		`roots=${String(mainPanel?.count)} styleLen=${String(mainPanel?.styleLen)} rect=${JSON.stringify(mainPanel?.rect)}`,
	);
	await shot('entries-1-left');
}

/* 刷新回初始（关掉主区域面板） */
await send(ws, 'Page.reload');
await sleep(11000);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
await sleep(1500);

/* ═══ ② 抽屉入口 ═══ */
const drawerBtn = await ev(`(function(){
  /* 抽屉入口在 composer 附近：找 tb3d- 前缀的按钮 */
  const cands=[...document.querySelectorAll('button,[role="button"]')].filter(e=>{
    const r=e.getBoundingClientRect();
    const cls=(e.className||'').toString();
    /* ⚠ 只认抽屉自己的入口：.tb3d-entry。左侧栏的 .wtg9ga_panelRow 也含「任务板」，会误点。 */
    return r.width>0 && r.height>0 && cls.includes('tb3d-entry');
  });
  if(!cands.length) return { found:false };
  return { found:true, items:cands.map(e=>{ const r=e.getBoundingClientRect(); return { cls:(e.className||'').toString().slice(0,40), w:Math.round(r.width), h:Math.round(r.height), x:Math.round(r.x), y:Math.round(r.y) } }) };
})()`);
check('② 输入框附近有抽屉入口', drawerBtn?.found === true, drawerBtn?.found ? `找到 ${String(drawerBtn.items?.length)} 个` : '找不到');

if (drawerBtn?.found === true) {
	const clicked = await ev(`(function(){
    const cands=[...document.querySelectorAll('button,[role="button"]')].filter(e=>{
      const r=e.getBoundingClientRect();
      const cls=(e.className||'').toString();
      return r.width>0 && r.height>0 && cls.includes('tb3d-entry');
    });
    if(!cands.length) return 'not found';
    cands[0].click(); return 'clicked';
  })()`);
	await sleep(3000);
	const drawer = await ev(`(function(){
    const panel=document.getElementById('tb3d-drawer-panel') || [...document.querySelectorAll('[class*="tb3d"][class*="panel"],[id*="tb3d"]')][0];
    const roots=[...document.querySelectorAll('[class*="tb3w-root"]')];
    const r=panel?.getBoundingClientRect();
    return { panelFound:!!panel, roots:roots.length, rect:r?{w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)}:null };
  })()`);
	check(
		'② 点抽屉入口后面板滑出',
		drawer?.panelFound === true && (drawer?.roots ?? 0) > 0,
		`panel=${String(drawer?.panelFound)} roots=${String(drawer?.roots)} rect=${JSON.stringify(drawer?.rect)}`,
	);
	await shot('entries-2-drawer');
}

/* ═══ ③ 右侧工作区 ═══ */
await send(ws, 'Page.reload');
await sleep(11000);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续');if(b)b.click()})()`);
await sleep(1200);
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='打开右侧边栏');if(b)b.click()})()`);
await sleep(2200);
const tabEntry = await ev(`(function(){
  const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('任务板')&&x.className&&x.className.includes('entry'));
  return { found:!!b };
})()`);
check('③ 右侧工作区有任务板标签页', tabEntry?.found === true);
if (tabEntry?.found === true) {
	await ev(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('任务板')&&x.className&&x.className.includes('entry')); if(b) b.click() })()`);
	await sleep(4000);
	const panel = await ev(`(function(){
    const roots=[...document.querySelectorAll('[class*="tb3w-root"]')];
    const st=document.getElementById('taskboard3-styles');
    return { roots:roots.length, styleLen:st?(st.textContent||'').length:0 };
  })()`);
	check('③ 点右侧栏后出现面板', (panel?.roots ?? 0) > 0 && (panel?.styleLen ?? 0) > 1000, `roots=${String(panel?.roots)} styleLen=${String(panel?.styleLen)}`);
	await shot('entries-3-right');
}

console.log(`\n${results.every((r) => r.ok) ? '✅ 三处入口全部可用' : '❌ 有失败'}`);
if (logs.length > 0) {
	console.log('\n=== 页面异常 ===');
	for (const one of logs.slice(0, 8)) console.log('  ' + one);
}

ws.close();
proc.kill();
process.exit(results.every((r) => r.ok) ? 0 : 1);
