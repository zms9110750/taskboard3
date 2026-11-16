/**
 * 复现用户报的两个 bug。
 *
 * bug 1：进入组但没选叶子，收起态不显示组名（应该显示「状态：完成」）
 * bug 2：点开另一个按钮时，前一个不收起
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((one) => existsSync(one));
const HERE = import.meta.dirname;
const PKG = nodePath.join(HERE, '..');
const OUT = nodePath.join(PKG, 'preview', 'repro');
mkdirSync(OUT, { recursive: true });
const PAGE = nodePath.join(PKG, 'preview', 'filter-box.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9265;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'rep-'));
const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`,
	'--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

const wait = async (u, ms = 20000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) { try { const r = await fetch(u); if (r.ok) return; } catch {} await sleep(200); }
	throw new Error('timeout');
};
await wait(`http://127.0.0.1:${port}/json/version`);

const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((o, n) => { ws.onopen = o; ws.onerror = n; });

let i = 0; const p = new Map();
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && p.has(m.id)) {
		const q = p.get(m.id); p.delete(m.id);
		m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
	}
};
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++i; p.set(id, { resolve: res, reject: rej });
	ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
await sleep(2200);

const ev = async (x) => {
	const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) console.log('ERR', (r.exceptionDetails.exception?.description || '').slice(0, 200));
	return r.result?.value;
};
const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(OUT, name), Buffer.from(data, 'base64'));
	console.log('  shot', name);
};

/** 模拟真人点击：完整 pointer + mouse 序列 */
const realClick = async (selExpr) => {
	const box = await ev(`(() => {
    const el = ${selExpr};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
	if (!box) { console.log('  ⚠ 找不到元素:', selExpr.slice(0, 60)); return false; }
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
	return true;
};

const boxes = () => ev(`[...document.querySelectorAll('.filter-box')].slice(0,3).map(b => ({
  t: b.querySelector('.filter-box__title').textContent,
  open: b.classList.contains('is-open'),
  collapsed: b.querySelector('.filter-box__face--collapsed').textContent.trim(),
  w: Math.round(b.getBoundingClientRect().width)
}))`);

const item = (label) => `[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent.startsWith(${JSON.stringify(label)}))`;

console.log('\n=== bug 1: 进入组「完成」但没选叶子，收起后显示什么 ===');
await realClick(`document.querySelectorAll('.filter-box')[0]`);
await sleep(400);
await realClick(item('完成'));
await sleep(400);
console.log('  展开中:', JSON.stringify(await boxes()));
await realClick(`document.querySelector('.pv-head h1')`);
await sleep(400);
const afterCollapse = await boxes();
console.log('  收起后:', JSON.stringify(afterCollapse));
console.log('  👉 期望 状态：完成 / 实际:', JSON.stringify(afterCollapse[0]?.collapsed));
await shot('repro-01-group-only-collapsed.png');

console.log('\n=== bug 2: 状态开着，点类别 ===');
await realClick(`document.querySelectorAll('.filter-box')[0]`);   // 重新展开状态
await sleep(400);
console.log('  点类别前:', JSON.stringify(await boxes()));
await realClick(`document.querySelectorAll('.filter-box')[1]`);   // 点类别
await sleep(500);
const afterSecond = await boxes();
console.log('  点类别后:', JSON.stringify(afterSecond));
console.log('  👉 期望 状态收起 / 实际:', JSON.stringify(afterSecond.map((x) => x.open)));
await shot('repro-02-two-open.png');

console.log('\n=== bug 2b: 类别已展开，点类别里的某一项（Item 有 stopPropagation）===');
await realClick(`document.querySelector('.pv-head h1')`);
await sleep(300);
await realClick(`document.querySelectorAll('.filter-box')[0]`);   // 展开状态
await sleep(400);
await realClick(`document.querySelectorAll('.filter-box')[1]`);   // 展开类别（状态应收起）
await sleep(400);
console.log('  类别展开后:', JSON.stringify(await boxes()));
await realClick(`document.querySelectorAll('.filter-box')[0]`);   // 再展开状态
await sleep(400);
console.log('  两个开关后:', JSON.stringify(await boxes()));

console.log('\n=== bug 2c: 点另一个方框里的 Item ===');
await realClick(`document.querySelector('.pv-head h1')`);
await sleep(300);
await realClick(`document.querySelectorAll('.filter-box')[1]`);   // 类别开
await sleep(400);
await realClick(`document.querySelectorAll('.filter-box')[0]`);   // 状态开（类别应收）
await sleep(400);
console.log('  状态开、类别?', JSON.stringify(await boxes()));
/* 现在点名——点的是状态方框里的 Item，测试的是「点别人内部」 */
await realClick(item('进行'));
await sleep(400);
console.log('  点状态的「进行」后:', JSON.stringify(await boxes()));

proc.kill();
console.log('\n完成 →', OUT);
process.exit(0);
