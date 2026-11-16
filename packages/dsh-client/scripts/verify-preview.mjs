/**
 * 验证：**点任何东西 = 选中它 + 展开**，一个操作，无分支。
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

const port = 9290;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'v5-'));
const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`,
	'--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

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
const errors = [];
const failures = [];
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && p.has(m.id)) {
		const q = p.get(m.id); p.delete(m.id);
		m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
		return;
	}
	if (m.method === 'Runtime.exceptionThrown') {
		errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
	}
};
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++i; p.set(id, { resolve: res, reject: rej });
	ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 1300, deviceScaleFactor: 1, mobile: false });
await sleep(2200);

const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(OUT, name), Buffer.from(data, 'base64'));
};
const ev = async (x) => {
	const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 200));
	return r.result?.value;
};
const click = async (sel) => {
	const b = await ev(`(() => { const el = ${sel}; if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
	if (b === null || b === undefined) return false;
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', buttons: 1, clickCount: 1 });
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
	return true;
};

/**
 * 读第一个方框。
 *
 * 段用 `:scope > .filter-box__items` 取直接子容器；竖线用直接子 `.filter-box__vline` 数。
 */
const readBox = () => ev(`(() => {
  const box = document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0];
  if (!box) return null;
  const ex = box.querySelector('.filter-box__face--expanded');
  const segs = [...ex.querySelectorAll(':scope > .filter-box__items')];
  const txt = (el) => [...el.querySelectorAll('.filter-box__item')].map(b => ({
    t: b.textContent.replace('›',''),
    picked: b.classList.contains('is-picked'),
  }));
  const face = box.querySelector('.filter-box__face--collapsed');
  const cwrap = face.querySelector('.filter-box__crumbs');
  const citems = cwrap ? [...cwrap.querySelectorAll('.filter-box__item')] : [];
  return {
    open: box.classList.contains('is-open'),
    segments: segs.map(txt),
    vlines: [...ex.children].filter(c => c.classList.contains('filter-box__vline')).length,
    collapsed: citems.map(b => b.textContent ?? ''),
    hasCaret: face.querySelector('.filter-box__caret') !== null,
    hasClear: face.querySelector('.filter-box__clear') !== null,
    hasTitleBtn: box.querySelector('.filter-box__title')?.tagName === 'BUTTON',
  };
})()`);

const expect = (label, actual, want) => {
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok) failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};
const labels = (arr) => (arr ?? []).map((x) => x.t);
const picked = (arr) => (arr ?? []).filter((x) => x.picked).map((x) => x.t);

/* 段内点击器 */
const clickSeg = (si, label) => click(`(() => {
  const box = document.querySelector('.filter-box.is-open');
  if (!box) return null;
  const segs = box.querySelectorAll('.filter-box__face--expanded > .filter-box__items');
  const seg = segs[${si}];
  if (!seg) return null;
  return [...seg.querySelectorAll('.filter-box__item')].find(b => b.textContent.replace('›','') === ${JSON.stringify(label)}) ?? null;
})()`);
const clickCrumb = (label) => click(`(() => {
  const box = document.querySelector('.filter-box.is-open');
  const cw = box?.querySelector('.filter-box__crumbs');
  if (!cw) return null;
  return [...cw.querySelectorAll('.filter-box__item')].find(b => b.textContent === ${JSON.stringify(label)}) ?? null;
})()`);
const clickTitle = () => click(`document.querySelector('.filter-box.is-open .filter-box__title')`);
const clickOutside = () => click(`document.querySelector('.pv-head h1')`);
const firstBox = `document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0]`;

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ① 没选：一段，没 ▾ 没 ✕，标题是按钮 ═══');
await click(firstBox);
await sleep(400);
const a0 = await readBox();
expect('展开', a0.open, true);
expect('一段（根）', labels(a0.segments[0]), ['草稿', '进行', '搁置', '完成']);
expect('没有竖线', a0.vlines, 0);
expect('没有 ▾', a0.hasCaret, false);
expect('没有 ✕', a0.hasClear, false);
expect('标题是 button', a0.hasTitleBtn, true);
await shot('01-empty-open.png');

console.log('\n═══ ② 点「进行」→ 选中它 + 展开它的子（两段）═══');
await clickSeg(0, '进行');
await sleep(450);
const a1 = await readBox();
expect('两段', a1.segments.length, 2);
expect('②当前层里「进行」选中', picked(a1.segments[0]), ['进行']);
expect('③子层是进行的子', labels(a1.segments[1]), ['提交', '处理中']);
expect('一条竖线', a1.vlines, 1);
console.log('  → 点它的效果就是选中它，既然选中了它就展开 ✅');
await shot('02-pick-active.png');

console.log('\n═══ ③ 点子层「提交」→ 选中它 + 展开（三段）═══');
await clickSeg(1, '提交');
await sleep(450);
const a2 = await readBox();
expect('两段（提交没子，所以没有第三段）', a2.segments.length, 2);
expect('①面包屑 = 进行', labels(a2.segments[0]), ['进行']);
expect('②当前层里「提交」选中', picked(a2.segments[1]), ['提交']);
await shot('03-pick-submitted.png');

console.log('\n═══ ④ 收起态面包屑：进行 / 提交（两段，独立可点）═══');
await clickOutside();
await sleep(500);
const a3 = await readBox();
expect('收起', a3.open, false);
/*
 * ⚠ 面包屑的 textContent 是「进行/提交」连起来的（斜杠是独立 span），
 *   要按**每个 button** 取，不能整块取 textContent。
 */
const crumbLabels = await ev(`(() => {
  const box = document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0];
  const cw = box.querySelector('.filter-box__face--collapsed .filter-box__crumbs');
  return cw ? [...cw.querySelectorAll('.filter-box__item')].map(b => (b.textContent ?? '').replace('›','')) : [];
})()`);
expect('面包屑两段（每个是独立 button）', crumbLabels, ['进行', '提交']);
await shot('04-collapsed.png');

console.log('\n═══ ⑤ ⚠ 点收起态第一段「进行」→ 选中进行 + 展开（提交被取消）═══');
await click(`(() => {
  const box = document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0];
  const cw = box.querySelector('.filter-box__face--collapsed .filter-box__crumbs');
  return cw ? cw.querySelectorAll('.filter-box__item')[0] : null;
})()`);
await sleep(500);
const a4 = await readBox();
expect('⚠ 点了就展开', a4.open, true);
const crumbAfter = await ev(`(() => {
  const box = document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0];
  const cw = box.querySelector('.filter-box__face--collapsed .filter-box__crumbs');
  return cw ? [...cw.querySelectorAll('.filter-box__item')].map(b => (b.textContent ?? '').replace('›','')) : [];
})()`);
expect('面包屑只剩「进行」', crumbAfter, ['进行']);
expect('当前层「进行」选中', picked(a4.segments[0]), ['进行']);
expect('子层是进行的子', labels(a4.segments[1]), ['提交', '处理中']);
console.log('  → 用户要的：「进行」点了就选中进行，取消「提交」✅');
await shot('05-crumb-click-opens.png');

console.log('\n═══ ⑥ ⚠ 点标题 → 清空 + 展开（选中第 0 级）═══');
await clickTitle();
await sleep(500);
const a5 = await readBox();
const crumbCleared = await ev(`(() => {
  const box = document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0];
  const cw = box.querySelector('.filter-box__face--collapsed .filter-box__crumbs');
  return cw ? [...cw.querySelectorAll('.filter-box__item')].map(b => (b.textContent ?? '').replace('›','')) : [];
})()`);
expect('清空面包屑', crumbCleared, []);
expect('展开', a5.open, true);
expect('一段（根），都没选中', picked(a5.segments[0]), []);
console.log('  → 标题 = 第 0 级，点了就是清空并展开第 1 级 ✅');
await shot('06-title-clears.png');

console.log('\n═══ ⑦ 互斥 ═══');
await click(`document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[1]`);
await sleep(450);
const both = await ev(`[...document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')].map(b => b.classList.contains('is-open'))`);
expect('只有第二个开着', both, [false, true, false]);
await clickOutside();
await sleep(350);

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑧ 四级：逐层点，每层都是「选中 + 展开」═══');
const deepRow = await ev(`(() => {
  const rows = [...document.querySelectorAll('.filter-row')];
  return rows.findIndex(r => r.querySelector('.filter-box__title')?.textContent === '编号');
})()`);
console.log('  四级方框 row:', deepRow);
const deepBox = `document.querySelectorAll('.filter-row')[${deepRow}].querySelectorAll('.filter-box')[0]`;
const readDeep = () => ev(`(() => {
  const box = document.querySelectorAll('.filter-row')[${deepRow}].querySelectorAll('.filter-box')[0];
  const ex = box.querySelector('.filter-box__face--expanded');
  const segs = [...ex.querySelectorAll(':scope > .filter-box__items')];
  const txt = (el) => [...el.querySelectorAll('.filter-box__item')].map(b => ({
    t: b.textContent.replace('›',''),
    picked: b.classList.contains('is-picked'),
  }));
  return { segments: segs.map(txt), vlines: [...ex.children].filter(c => c.classList.contains('filter-box__vline')).length };
})()`);

await click(deepBox);
await sleep(450);
const d0 = await readDeep();
expect('L0：一段 1/9', labels(d0.segments[0]), ['1', '9']);

await clickSeg(0, '1');
await sleep(450);
const d1 = await readDeep();
expect('点 1：两段（1/9 中 1 选中 | 2/8）', [
	labels(d1.segments[0]), picked(d1.segments[0]), labels(d1.segments[1]),
], [['1', '9'], ['1'], ['2', '8']]);

await clickSeg(1, '2');
await sleep(450);
const d2 = await readDeep();
expect('点 2：三段（面包屑1 | 2/8 中 2 选中 | 3/7）', [
	labels(d2.segments[0]), labels(d2.segments[1]), picked(d2.segments[1]), labels(d2.segments[2]),
], [['1'], ['2', '8'], ['2'], ['3', '7']]);
expect('两条竖线', d2.vlines, 2);
await shot('07-deep-2.png');

await clickSeg(2, '3');
await sleep(450);
const d3 = await readDeep();
expect('点 3：三段（面包屑1/2 | 3/7 中 3 选中 | 2/6）', [
	labels(d3.segments[0]), labels(d3.segments[1]), picked(d3.segments[1]), labels(d3.segments[2]),
], [['1', '2'], ['3', '7'], ['3'], ['2', '6']]);
await shot('08-deep-3.png');

console.log('\n═══ ⑨ ⚠「只展示两个可点层」═══');
expect('面包屑 2 段（只用于跳回）', d3.segments[0].length, 2);
expect('可点层 = 当前层 + 子层', d3.segments.length, 3);

console.log('\n═══ ⑩ 点面包屑第 1 段「1」→ 选中 1 + 展开 ═══');
await clickSeg(0, '1');
await sleep(450);
const d4 = await readDeep();
expect('回到 1：两段（1/9 中 1 选中 | 2/8）', [
	labels(d4.segments[0]), picked(d4.segments[0]), labels(d4.segments[1]),
], [['1', '9'], ['1'], ['2', '8']]);
await shot('09-back-to-1.png');

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);

