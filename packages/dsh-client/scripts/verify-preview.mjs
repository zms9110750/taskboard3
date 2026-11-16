/**
 * 面包屑版验证 —— 一次跑完，不中途改断言。
 *
 * 用户 `2026-11-16` 的语义：
 *   · 点到谁就选中谁（点组 = 选中组，不是清空）
 *   · 选中某节点 ⇒ 它下面的选中全丢掉
 *   · 列出选中项的子
 *   · 只展示两个可点层（②当前层 ③子层），①面包屑只用于跳回
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

const port = 9270;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'bc-'));
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
	if (r.exceptionDetails) console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 220));
	return r.result?.value;
};

/** 真人点击：完整 mouse 序列。 */
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
 * 读一个方框的三段（第 `row` 个 .filter-row 的第 `idx` 个方框）。
 *
 * ⚠ 段用 `:scope > .filter-box__items`（直接子元素）取，
 *   不能用「全框 querySelectorAll」—— 否则面包屑里的项会混进当前层。
 */
const readBox = (idx, row = 0) => ev(`(() => {
  const box = document.querySelectorAll('.filter-row')[${row}].querySelectorAll('.filter-box')[${idx}];
  if (!box) return null;
  const ex = box.querySelector('.filter-box__face--expanded');
  const crumbs = ex.querySelector('.filter-box__crumbs');
  const segs = [...ex.querySelectorAll(':scope > .filter-box__items')];
  const txt = (el) => [...el.querySelectorAll('.filter-box__item')].map(b => ({
    t: b.textContent.replace('›',''),
    picked: b.classList.contains('is-picked'),
  }));
  const face = box.querySelector('.filter-box__face--collapsed');
  const zone = face.querySelector('.filter-box__zone');
  return {
    open: box.classList.contains('is-open'),
    crumbs: crumbs ? txt(crumbs) : [],
    current: segs[0] ? txt(segs[0]) : [],
    child: segs[1] ? txt(segs[1]) : [],
    vlines: ex.querySelectorAll('.filter-box__vline').length,
    collapsed: zone ? [...zone.children]
      .filter(c => !c.classList.contains('filter-box__caret'))
      .map(c => c.textContent).join('') : '',
    hasClear: face.querySelector('.filter-box__clear') !== null,
  };
})()`);

const expect = (label, actual, want) => {
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok) failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

const labels = (arr) => (arr ?? []).map((x) => x.t);
const pickedLabels = (arr) => (arr ?? []).filter((x) => x.picked).map((x) => x.t);

/* ── 定位器：永远走「当前开着的那个方框」 ── */

/**
 * 点某一「段」里的项。
 *
 * ⚠ 段索引：0 = 当前层，1 = 子层。
 * ⚠ 必须用 `:scope >` 直接子选择器，否则面包屑里的同名项会被误选中。
 * ⚠ 表达式整体是 IIFE 并且返回**元素本身** —— 不要在外面拼 `.find(...)`，
 *   上一版就是括号拼错，`NodeList.find` 不存在 ⇒ 静默返回 undefined ⇒ 点击没发生。
 */
const clickSegment = (segIndex, label) =>
	click(`(() => {
    const box = document.querySelector('.filter-box.is-open');
    if (!box) return null;
    const segs = box.querySelectorAll('.filter-box__face--expanded > .filter-box__items');
    const seg = segs[${segIndex}];
    if (!seg) return null;
    return [...seg.querySelectorAll('.filter-box__item')]
      .find(b => b.textContent.replace('›','') === ${JSON.stringify(label)}) ?? null;
  })()`);

const clickCurrent = (label) => clickSegment(0, label);
const clickChild = (label) => clickSegment(1, label);

/** 点面包屑里的段。 */
const clickCrumb = (label) =>
	click(`(() => {
    const box = document.querySelector('.filter-box.is-open');
    if (!box) return null;
    return [...box.querySelectorAll('.filter-box__crumbs .filter-box__item')]
      .find(b => b.textContent === ${JSON.stringify(label)}) ?? null;
  })()`);

/** 点标题（= 外面），收起所有。 */
const clickOutside = () => click(`document.querySelector('.pv-head h1')`);

const firstBox = `document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0]`;
const secondBox = `document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[1]`;

/* ═══════════════════════════════════════════════════════════ */
console.log('\n═══ ① 未选中：一段，列出根 ═══');
await click(firstBox);
await sleep(350);
const a0 = await readBox(0);
expect('没有面包屑', a0.crumbs.length, 0);
expect('当前层是四个状态组', labels(a0.current), ['草稿', '进行', '搁置', '完成']);
expect('没有子层', a0.child.length, 0);
expect('0 条竖线', a0.vlines, 0);
await shot('01-no-selection.png');

console.log('\n═══ ② 点「完成」→ 选中完成，列出它的子 ═══');
await clickCurrent('完成');
await sleep(400);
const a1 = await readBox(0);
expect('没有面包屑（完成是第 1 级）', a1.crumbs.length, 0);
expect('当前层不变，完成被选中', pickedLabels(a1.current), ['完成']);
expect('子层是完成的四个子', labels(a1.child), ['成功', '失败', '取消', '拒绝']);
expect('一条竖线（当前层 | 子层）', a1.vlines, 1);
console.log('  → 「点到完成就选中完成，列出完成的子项」✅');
await shot('02-pick-ended.png');

console.log('\n═══ ③ 点子层「失败」→ 下探一层，面包屑出现 ═══');
await clickChild('失败');
await sleep(400);
const a2 = await readBox(0);
expect('面包屑 = 完成', labels(a2.crumbs), ['完成']);
expect(
	'当前层 = 完成的四个子，失败被选中',
	[labels(a2.current), pickedLabels(a2.current)],
	[['成功', '失败', '取消', '拒绝'], ['失败']],
);
expect('子层空（失败没子）', a2.child.length, 0);
expect('一条竖线', a2.vlines, 1);
await shot('03-pick-failed.png');

console.log('\n═══ ④ 点面包屑「完成」→ 跳回上层 ═══');
await clickCrumb('完成');
await sleep(400);
const a3 = await readBox(0);
expect('面包屑消失', a3.crumbs.length, 0);
expect('当前层完成被选中', pickedLabels(a3.current), ['完成']);
expect('子层又出现', labels(a3.child), ['成功', '失败', '取消', '拒绝']);
console.log('  → 跳回后「失败」的选中被取消了 ✅');
await shot('04-crumb-back.png');

console.log('\n═══ ⑤ ⚠ 点另一个组「进行」→ 替换，不叠加 ═══');
await clickCurrent('进行');
await sleep(400);
const a4 = await readBox(0);
expect('当前层进行被选中', pickedLabels(a4.current), ['进行']);
expect('子层换成进行的子', labels(a4.child), ['提交', '处理中']);
await shot('05-switch-group.png');

console.log('\n═══ ⑥ 收起态显示完整路径 ═══');
await clickChild('处理中');
await sleep(400);
await clickOutside();
await sleep(450);
const a5 = await readBox(0);
expect('已收起', a5.open, false);
expect('收起态 = 状态：进行/处理中', a5.collapsed, '状态：进行/处理中');
expect('有独立 ✕', a5.hasClear, true);
await shot('06-collapsed-path.png');

console.log('\n═══ ⑦ 点 ✕ → 全清 ═══');
await click(`document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0].querySelector('.filter-box__clear')`);
await sleep(450);
const a6 = await readBox(0);
expect('清空后只剩标题', a6.collapsed, '状态');
expect('没有 ✕ 了', a6.hasClear, false);
await shot('07-cleared.png');

console.log('\n═══ ⑧ 互斥：开第二个，第一个收起 ═══');
await click(firstBox);
await sleep(350);
await click(secondBox);
await sleep(450);
const both = await ev(`[...document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')].map(b => b.classList.contains('is-open'))`);
expect('只有第二个开着', both, [false, true, false]);
await shot('08-mutex.png');

/* ═══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑨ 四级树：逐层下探（用户举的 1/2/3/2/4）═══');
const deepRow = await ev(`(() => {
  const rows = [...document.querySelectorAll('.filter-row')];
  return rows.findIndex(r => r.querySelector('.filter-box__title')?.textContent === '编号');
})()`);
console.log('  四级方框所在 row:', deepRow);
const deepBox = `document.querySelectorAll('.filter-row')[${deepRow}].querySelector('.filter-box')`;
const readDeep = () => readBox(0, deepRow);

await clickOutside();
await sleep(350);
await click(deepBox);
await sleep(450);

const d0 = await readDeep();
expect('L0 未选：列出 1/9', labels(d0.current), ['1', '9']);
await clickCurrent('1');
await sleep(400);
const d1 = await readDeep();
expect('点 1：当前层仍 1/9（1 选中），子层 2/8',
	[pickedLabels(d1.current), labels(d1.child)], [['1'], ['2', '8']]);

await clickChild('2');
await sleep(400);
const d2 = await readDeep();
expect('点 2：面包屑 1 | 当前层 2/8（2 选中）| 子层 3/7',
	[labels(d2.crumbs), pickedLabels(d2.current), labels(d2.child)],
	[['1'], ['2'], ['3', '7']]);
await shot('09-deep-level2.png');

await clickChild('3');
await sleep(400);
const d3 = await readDeep();
expect('点 3：面包屑 1/2 | 当前层 3/7（3 选中）| 子层 2/6',
	[labels(d3.crumbs), pickedLabels(d3.current), labels(d3.child)],
	[['1', '2'], ['3'], ['2', '6']]);
expect('两条竖线（面包屑|当前层|子层）', d3.vlines, 2);
await shot('10-deep-level3.png');

await clickChild('2');
await sleep(400);
const d4 = await readDeep();
expect('点子层的 2：面包屑 1/2/3 | 当前层 2/6（2 选中）| 子层 4/5',
	[labels(d4.crumbs), pickedLabels(d4.current), labels(d4.child)],
	[['1', '2', '3'], ['2'], ['4', '5']]);
await shot('11-deep-level4.png');

console.log('\n═══ ⑩ ⚠ 关键：永远只有两个可点层 ═══');
expect('面包屑有 3 段（但不可展开，只用于跳回）', d4.crumbs.length, 3);
expect('可点层只有 2 个', [d4.current.length > 0, d4.child.length > 0], [true, true]);

console.log('\n═══ ⑪ 点面包屑第 1 段「1」→ 跳回根 ═══');
await clickCrumb('1');
await sleep(400);
const d5 = await readDeep();
expect('跳回 1：无面包屑，当前层 1/9，子 2/8',
	[labels(d5.crumbs), pickedLabels(d5.current), labels(d5.child)],
	[[], ['1'], ['2', '8']]);
await shot('12-crumb-jump.png');

console.log('\n═══ ⑫ 收起态路径：深层 ═══');
await clickOutside();
await sleep(450);
const d6 = await readDeep();
expect('收起态 = 编号：1', d6.collapsed, '编号：1');
await shot('13-deep-collapsed.png');

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
