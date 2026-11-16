/**
 * 组件预览的交互验证 —— CDP 点一遍，断言 DOM 状态。
 *
 * 每条断言对应一条用户规则（`2026-11-16`）。
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

const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
const target = await res.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });

let seq = 0; const pending = new Map();
const errors = [];
const failures = [];
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
await sleep(2200);

const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(OUT, name), Buffer.from(data, 'base64'));
	console.log('  shot', name);
};
const ev = async (expr) => {
	const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 200));
	return r.result?.value;
};

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

/** 第 n 个方框（0 基）的完整快照 */
const boxInfo = (n) => ev(`(() => {
  const box = document.querySelectorAll('.filter-box')[${n}];
  if (!box) return null;
  const collapsed = box.querySelector('.filter-box__face--collapsed');
  const expanded = box.querySelector('.filter-box__face--expanded');
  const rows = [...expanded.children].filter(c => c.classList.contains('filter-box__items'));
  return {
    open: box.classList.contains('is-open'),
    w: Math.round(box.getBoundingClientRect().width),
    collapsedText: collapsed.textContent.trim(),
    zones: collapsed.querySelectorAll('.filter-box__zone').length,
    rows: rows.map(r => [...r.querySelectorAll('.filter-box__item')].map(i => ({
      t: i.textContent.replace('›',''),
      picked: i.classList.contains('is-picked'),
      branch: i.classList.contains('is-branch'),
    }))),
    vlins: box.querySelectorAll('.filter-box__vline').length,
    seps: [...expanded.querySelectorAll('.filter-box__sep')].map(s => s.textContent),
  };
})()`);

const expect = (label, actual, want) => {
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok) {
		failures.push(`${label}\n    期望 ${JSON.stringify(want)}\n    实际 ${JSON.stringify(actual)}`);
		console.log(`  ${ok ? '✓' : '✗'} ${label}`);
	} else {
		console.log(`  ✓ ${label}`);
	}
};

console.log('\n=== 1. 初始：三个方框都收起 ===');
const s0 = await ev(`[...document.querySelectorAll('.filter-box')].slice(0,3).map(b => ({
  t: b.querySelector('.filter-box__title').textContent,
  open: b.classList.contains('is-open'),
  zones: b.querySelector('.filter-box__face--collapsed').querySelectorAll('.filter-box__zone').length
}))`);
console.log(' ', JSON.stringify(s0));
expect('三个都收起、都只有一个可点区', s0.map((x) => x.open), [false, false, false]);
await shot('01-initial.png');

console.log('\n=== 2. 点状态 → 展开，一行四个组 ===');
await clickAt(`document.querySelectorAll('.filter-box')[0]`);
await sleep(450);
const b1 = await boxInfo(0);
console.log(' ', JSON.stringify(b1));
expect('展开后只有一行', b1.rows.length, 1);
expect('一行是四个组', b1.rows[0].map((x) => x.t), ['草稿', '进行', '搁置', '完成']);
expect('组名之间用 |', b1.seps, ['|', '|', '|']);
expect('组不算选中', b1.rows[0].every((x) => x.picked === false), true);
await shot('02-status-open.png');

console.log('\n=== 3. 点组「完成」→ 清空选择 + 展开子 ===');
await clickAt(`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent.startsWith('完成'))`);
await sleep(450);
const b2 = await boxInfo(0);
console.log(' ', JSON.stringify(b2));
expect('出两行', b2.rows.length, 2);
expect('第二行是完成的子', b2.rows[1].map((x) => x.t), ['成功', '失败', '取消', '拒绝']);
expect('⚠ 点组 = 清空选择（子全未选）', b2.rows[1].every((x) => x.picked === false), true);
expect('「完成」标 branch（子行属于它）', b2.rows[0].find((x) => x.t === '完成')?.branch, true);
expect('一条贯通竖线', b2.vlins, 1);
await shot('03-group-opened.png');

console.log('\n=== 4. 点「失败」→ 选中它 ===');
await clickAt(`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent.startsWith('失败'))`);
await sleep(450);
const b3 = await boxInfo(0);
expect('失败 picked', b3.rows[1].find((x) => x.t === '失败')?.picked, true);
expect('其它未选', b3.rows[1].filter((x) => x.picked).length, 1);
await shot('04-failed-picked.png');

console.log('\n=== 5. ⚠ 再点「失败」→ 幂等，不取消 ===');
await clickAt(`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent.startsWith('失败'))`);
await sleep(450);
const b4 = await boxInfo(0);
expect('仍然是选中（用户：点选中的就是展开到他）', b4.rows[1].find((x) => x.t === '失败')?.picked, true);
expect('子级仍然展开', b4.rows.length, 2);
await shot('05-failed-again-idempotent.png');

console.log('\n=== 6. 点外面 → 收起，收起态显示 状态：完成/失败 ===');
await clickAt(`document.querySelector('.pv-head h1')`);
await sleep(450);
const b5 = await boxInfo(0);
expect('已收起', b5.open, false);
expect('收起态文字', b5.collapsedText, '状态：完成/失败▾');
expect('拆成两个可点区', b5.zones, 2);
await shot('06-collapsed.png');

console.log('\n=== 7. 点 ▾ 只展开，不清空 ===');
await clickAt(`document.querySelectorAll('.filter-box')[0].querySelector('.filter-box__caret')`);
await sleep(450);
const b6 = await boxInfo(0);
expect('展开了', b6.open, true);
expect('失败仍选中（没被清空）', b6.rows[1]?.find((x) => x.t === '失败')?.picked, true);
await shot('07-caret-opens-only.png');

console.log('\n=== 8. 收起后点左边区 → 清空并展开 ===');
/*
 * ⚠ 必须先收起再点。
 * 展开时两张脸叠在同一位置，收起那张是 `pointer-events: none`
 * ⇒ 直接点它的坐标会**穿透到展开那张脸**上，点到别的组 —— 那是测试写错了，不是组件错。
 */
await clickAt(`document.querySelector('.pv-head h1')`);
await sleep(400);
const beforeLeft = await boxInfo(0);
expect('先确认已收起且仍有选中', [beforeLeft.open, beforeLeft.collapsedText], [false, '状态：完成/失败▾']);

await clickAt(`document.querySelectorAll('.filter-box')[0].querySelector('.filter-box__face--collapsed .filter-box__zone')`);
await sleep(450);
const b7 = await boxInfo(0);
expect('展开了', b7.open, true);
expect('选择已清空', b7.rows[1]?.every((x) => x.picked === false), true);
expect('组还留着（仍展开完成）', b7.rows[0].find((x) => x.t === '完成')?.branch, true);
await shot('08-cleared.png');

console.log('\n=== 9. ⚠ 点另一个组「进行」→ 清空 + 换组 ===');
await clickAt(`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent.startsWith('进行'))`);
await sleep(450);
const b8 = await boxInfo(0);
expect('换成进行的子', b8.rows[1].map((x) => x.t), ['提交', '处理中']);
expect('选择清空', b8.rows[1].every((x) => x.picked === false), true);
await shot('09-switch-group.png');

console.log('\n=== 10. ⚠ 点第二个按钮 → 第一个自动收起（外面=按钮外面）===');
await clickAt(`document.querySelectorAll('.filter-box')[1]`);
await sleep(450);
const both = await ev(`[...document.querySelectorAll('.filter-box')].slice(0,3).map(b => ({
  t: b.querySelector('.filter-box__title').textContent,
  open: b.classList.contains('is-open')
}))`);
console.log(' ', JSON.stringify(both));
expect('状态收起', both[0].open, false);
expect('类别展开', both[1].open, true);
await shot('10-second-opens-first-closes.png');

console.log('\n=== 11. 类别（无组）→ 只有一行 ===');
const kindBox = await boxInfo(1);
expect('一行', kindBox.rows.length, 1);
expect('四项', kindBox.rows[0].map((x) => x.t), ['目标', '设计', '工作', '记录']);
expect('没有竖线', kindBox.vlins, 0);
await shot('11-kind-flat.png');

console.log('\n=== 12. 点完类别 → 点同一行的空白处 → 是否收起（外面=按钮外面）===');
/*
 * 用户明确：「外面」说的是按钮外面，不是放按钮的这一行。
 * ⇒ 点这一行的空白处**应该**让方框收起。
 * 这条以前实现错了（点行内空白不算外面），现在必须在预览页上验证。
 */
const emptySpot = await ev(`(() => {
  const box = document.querySelectorAll('.filter-box')[1];
  const r = box.getBoundingClientRect();
  /* 方框右侧 200px 处的同一行 */
  return { x: Math.round(r.right + 200), y: Math.round(r.y + r.height/2) };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: emptySpot.x, y: emptySpot.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: emptySpot.x, y: emptySpot.y, button: 'left', clickCount: 1 });
await sleep(450);
const afterRow = await ev(`document.querySelectorAll('.filter-box')[1].classList.contains('is-open')`);
expect('⚠ 点同一行空白 ⇒ 收起', afterRow, false);
await shot('12-row-blank-closes.png');

console.log('\n=== 13. 三级：点「甲」→ 选中 + 展开它的子 ===');
/* 三级方框在第三个 block 里，索引是 3（前三个是 status/kind/domain，第 4 个是 deep） */
const deepIdx = await ev(`(() => {
  const boxes = [...document.querySelectorAll('.filter-box')];
  return boxes.findIndex(b => b.querySelector('.filter-box__title').textContent === '深层');
})()`);
console.log('  深层方框索引:', deepIdx);
await clickAt(`document.querySelectorAll('.filter-box')[${deepIdx}]`);
await sleep(400);
await clickAt(`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent.startsWith('组一'))`);
await sleep(400);
const d1 = await boxInfo(deepIdx);
expect('进入组一：两行', d1.rows.length, 2);
expect('第二行是 甲/乙', d1.rows[1].map((x) => x.t), ['甲', '乙']);
await shot('13-deep-group.png');

await clickAt(`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent.startsWith('甲'))`);
await sleep(400);
const d2 = await boxInfo(deepIdx);
console.log(' ', JSON.stringify(d2));
expect('⚠ 点「甲」→ 三行（展开它的子）', d2.rows.length, 3);
expect('第三行是 甲一/甲二', d2.rows[2].map((x) => x.t), ['甲一', '甲二']);
expect('「甲」既选中又是分支', [d2.rows[1].find((x) => x.t === '甲')?.picked, d2.rows[1].find((x) => x.t === '甲')?.branch], [true, true]);
expect('两条竖线', d2.vlins, 2);
await shot('14-deep-level3.png');

await clickAt(`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent.startsWith('甲二'))`);
await sleep(400);
await clickAt(`document.querySelector('.pv-head h1')`);
await sleep(400);
const d3 = await boxInfo(deepIdx);
expect('收起态显示 深层：组一/甲/甲二', d3.collapsedText, '深层：组一/甲/甲二▾');
await shot('15-deep-collapsed.png');

console.log('\n=== JS 错误 ===');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n=== 断言失败 ===');
console.log(failures.length ? failures.join('\n') : '  全部通过');

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
