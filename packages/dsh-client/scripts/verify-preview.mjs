/**
 * 组件预览的交互验证 —— CDP 点一遍，断言 DOM 状态。
 *
 * 上一轮只看截图，看不出「展开后二级到底对不对」。
 * 这轮每步都 dump 真实 DOM + 量宽度。
 *
 * node packages/dsh-client/scripts/verify-preview.mjs
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
const OUT = nodePath.join(PKG, 'preview', 'shots');
mkdirSync(OUT, { recursive: true });
const PAGE = nodePath.join(PKG, 'preview', 'filter-box.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9260;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'fbp-'));
const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`,
	'--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

async function waitHttp(url, ms = 20000) {
	const end = Date.now() + ms;
	while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(200); }
	throw new Error('timeout');
}
await waitHttp(`http://127.0.0.1:${port}/json/version`);

/* file:// 路径要 URL 编码（仓库路径含中文） */
const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
const target = await res.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });

let seq = 0; const pending = new Map();
const errors = [];
let send;
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		const p = pending.get(m.id); pending.delete(m.id);
		m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
		return;
	}
	if (m.method === 'Runtime.exceptionThrown') {
		errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
	}
};
send = (method, params = {}) => new Promise((resolve, reject) => {
	const id = ++seq; pending.set(id, { resolve, reject });
	ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(2000);

const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(OUT, name), Buffer.from(data, 'base64'));
	console.log('  shot', name);
};
const ev = async (expr) => {
	const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) {
		console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 200));
	}
	return r.result?.value;
};

/** 点一个元素（真实坐标） */
const clickAt = async (selExpr) => {
	const box = await ev(`(() => {
    const el = ${selExpr};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
	if (!box) return false;
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
	return true;
};

/** 第一个方框（状态）的当前样子 */
const stateBox = () => ev(`(() => {
  const box = document.querySelector('.filter-box');
  if (!box) return null;
  const collapsed = box.querySelector('.filter-box__face--collapsed');
  const expanded = box.querySelector('.filter-box__face--expanded');
  const items = (face) => [...face.querySelectorAll('.filter-box__item')];
  const sepOf = (face) => [...face.querySelectorAll('.filter-box__sep')].map(s => s.textContent);
  return {
    open: box.classList.contains('is-open'),
    w: Math.round(box.getBoundingClientRect().width),
    collapsedText: collapsed.textContent.trim(),
    collapsedW: Math.round(collapsed.getBoundingClientRect().width),
    expandedText: expanded.textContent.trim(),
    expandedW: Math.round(expanded.getBoundingClientRect().width),
    picked: items(box).filter(i => i.classList.contains('is-picked')).map(i => i.textContent),
    sep1: sepOf(expanded),
    vline: !!box.querySelector('.filter-box__vline'),
    zones: collapsed.querySelectorAll('.filter-box__zone').length,
  };
})()`);

console.log('\n=== 1. 初始：三个方框都收起 ===');
const s0 = await ev(`[...document.querySelectorAll('.filter-box')].map(b => ({
  t: b.querySelector('.filter-box__title').textContent,
  w: Math.round(b.getBoundingClientRect().width),
  open: b.classList.contains('is-open'),
  zones: b.querySelector('.filter-box__face--collapsed').querySelectorAll('.filter-box__zone').length
}))`);
console.log(' ', JSON.stringify(s0));
await shot('01-initial.png');

console.log('\n=== 2. 点状态方框 → 展开 ===');
await clickAt(`document.querySelectorAll('.filter-box')[0]`);
await sleep(500);
const s1 = await stateBox();
console.log(' ', JSON.stringify(s1));
await shot('02-status-open.png');

console.log('\n=== 3. 点「完成」组 → 选中整组 + 出二级 ===');
await clickAt(`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent === '完成')`);
await sleep(500);
const s2 = await stateBox();
console.log(' ', JSON.stringify(s2));
await shot('03-group-picked.png');

console.log('\n=== 4. 点二级「失败」→ 收窄成单项 ===');
await clickAt(`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent === '失败')`);
await sleep(500);
const s3 = await stateBox();
console.log(' ', JSON.stringify(s3));
await shot('04-level2-failed.png');

console.log('\n=== 5. 点外面 → 收起，看收起态显示 ===');
await clickAt(`document.querySelector('.pv-head h1')`);
await sleep(500);
const s4 = await stateBox();
console.log(' ', JSON.stringify(s4));
await shot('05-collapsed-with-value.png');

console.log('\n=== 6. 再点开（点 ▾ 只展开不取消）===');
await clickAt(`document.querySelectorAll('.filter-box')[0].querySelector('.filter-box__caret')`);
await sleep(500);
const s5 = await stateBox();
console.log(' ', JSON.stringify(s5));
await shot('06-caret-open.png');

console.log('\n=== 7. 点左边区（取消筛选并展开）===');
await clickAt(`document.querySelectorAll('.filter-box__caret') && document.querySelector('.filter-box__face--collapsed .filter-box__zone')`);
await sleep(500);
const s6 = await stateBox();
console.log(' ', JSON.stringify(s6));
await shot('07-cancelled.png');

console.log('\n=== 8. 一次只展开一个：点类别方框 ===');
await clickAt(`[...document.querySelectorAll('.filter-box')][1]`);
await sleep(500);
const s7 = await ev(`[...document.querySelectorAll('.filter-box')].map(b => ({
  t: b.querySelector('.filter-box__title').textContent,
  open: b.classList.contains('is-open'),
  w: Math.round(b.getBoundingClientRect().width)
}))`);
console.log(' ', JSON.stringify(s7));
await shot('08-only-one-open.png');

console.log('\n=== 9. 类别（无组）展开：不该出现竖线 / 二级 ===');
const kindInfo = await ev(`(() => {
  const box = [...document.querySelectorAll('.filter-box')][1];
  return {
    open: box.classList.contains('is-open'),
    vline: !!box.querySelector('.filter-box__vline'),
    items: [...box.querySelectorAll('.filter-box__face--expanded .filter-box__item')].map(i => i.textContent),
    seps: [...box.querySelectorAll('.filter-box__face--expanded .filter-box__sep')].map(s => s.textContent)
  };
})()`);
console.log(' ', JSON.stringify(kindInfo));
await shot('09-kind-no-level2.png');

console.log('\n=== 10. 边界用例的收起态 ===');
const boundary = await ev(`(() => {
  const blocks = [...document.querySelectorAll('.pv-block')];
  const last = blocks[blocks.length - 1];
  return [...last.querySelectorAll('.filter-box')].map(b => ({
    text: b.querySelector('.filter-box__face--collapsed').textContent.trim(),
    w: Math.round(b.getBoundingClientRect().width)
  }));
})()`);
console.log(' ', JSON.stringify(boundary));

console.log('\n=== JS 错误 ===');
console.log(errors.length ? errors.join('\n') : '  没有');

proc.kill();
console.log('\n完成 →', OUT);
process.exit(0);
