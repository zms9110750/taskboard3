/**
 * 验证两个 bug 修好了，并回归全部语义。
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1200, deviceScaleFactor: 1, mobile: false });
await sleep(2200);

const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(OUT, name), Buffer.from(data, 'base64'));
	console.log('  shot', name);
};
const ev = async (expr) => {
	const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 220));
	return r.result?.value;
};

/*
 * ⚠ 用完整 pointer + mouse 序列模拟真人。
 * 上一版只发 mousePressed/Released，有些浏览器行为（focus / 事件顺序）不完整。
 */
const realClick = async (selExpr) => {
	const box = await ev(`(() => {
    const el = ${selExpr};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`);
	if (!box) { console.log('  ⚠ 找不到:', selExpr.slice(0, 70)); return false; }
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
	return true;
};

/** 第 1 个 FilterRow（真实用法那一排）里的三个方框 */
const rowBoxes = () => ev(`(() => {
  const row = document.querySelectorAll('.filter-row')[0];
  return [...row.querySelectorAll('.filter-box')].map(b => {
    const face = b.querySelector('.filter-box__face--collapsed');
    /* 收起态文字 = 标题 + 冒号 + 值（**不含** ✕ 按钮，它是独立控件）。 */
    const zone = face.querySelector('.filter-box__zone');
    const text = zone ? [...zone.children]
      .filter(c => !c.classList.contains('filter-box__caret'))
      .map(c => c.textContent).join('') : '';
    return {
      t: b.querySelector('.filter-box__title').textContent,
      open: b.classList.contains('is-open'),
      collapsed: text.trim(),
      hasClear: face.querySelector('.filter-box__clear') !== null,
      zones: face.querySelectorAll('.filter-box__zone').length,
      w: Math.round(b.getBoundingClientRect().width),
      rows: (() => {
        const ex = b.querySelector('.filter-box__face--expanded');
        const rs = [...ex.children].filter(c => c.classList.contains('filter-box__items'));
        return rs.map(r => [...r.querySelectorAll('.filter-box__item')].map(i => i.textContent.replace('›','')));
      })(),
      vlins: b.querySelectorAll('.filter-box__vline').length,
    };
  });
})()`);

/** 点当前开着的方框里的某一项 */
const openItem = (label) =>
	`[...document.querySelector('.filter-box.is-open').querySelectorAll('.filter-box__face--expanded .filter-box__item')].find(b => b.textContent.startsWith(${JSON.stringify(label)}))`;

const firstBox = `document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0]`;
const secondBox = `document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[1]`;
const thirdBox = `document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[2]`;

const expect = (label, actual, want) => {
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok) failures.push(`${label}\n    期望 ${JSON.stringify(want)}\n    实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

console.log('\n═══ bug 1：只进组不选叶子 → 收起态要显示组名 ═══');
await realClick(firstBox);
await sleep(400);
await realClick(openItem('完成'));
await sleep(400);
await realClick(`document.querySelector('.pv-head h1')`);
await sleep(450);
const b1 = await rowBoxes();
console.log('  ', JSON.stringify(b1[0]));
expect('⚠ 收起态显示「状态：完成」', b1[0].collapsed, '状态：完成');
expect('有独立的 ✕ 清空按钮', b1[0].hasClear, true);
await shot('bug1-fixed-group-shown.png');

console.log('\n═══ bug 2：点开另一个按钮，前一个必须收起 ═══');
/* 清干净：点 ✕ */
await realClick(`document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0].querySelector('.filter-box__clear')`);
await sleep(400);

await realClick(firstBox);
await sleep(400);
console.log('  状态开着:', JSON.stringify((await rowBoxes()).map((x) => x.open)));
await realClick(secondBox);
await sleep(500);
const b2 = await rowBoxes();
console.log('  点类别后:', JSON.stringify(b2.map((x) => ({ t: x.t, open: x.open }))));
expect('⚠ 状态已收起', b2[0].open, false);
expect('类别已展开', b2[1].open, true);
expect('领域仍收起', b2[2].open, false);
await shot('bug2-fixed-mutual-exclusive.png');

console.log('\n═══ bug 2b：连着开三个，永远只有一个开 ═══');
await realClick(thirdBox);
await sleep(450);
const b3 = await rowBoxes();
expect('只有领域开', b3.map((x) => x.open), [false, false, true]);
await realClick(firstBox);
await sleep(450);
const b4 = await rowBoxes();
expect('只有状态开', b4.map((x) => x.open), [true, false, false]);
await shot('bug2b-only-one.png');

console.log('\n═══ 回归：点组 → 选叶子 → 收起态 ═══');
/* 先清干净：点收起态里的 ✕ */
await realClick(`document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0].querySelector('.filter-box__clear')`);
await sleep(400);
await realClick(firstBox);
await sleep(400);
await realClick(openItem('进行'));
await sleep(400);
const r1 = await rowBoxes();
expect('「进行」的子行出现', r1[0].rows[1], ['提交', '处理中']);
await realClick(openItem('处理中'));
await sleep(400);
await realClick(`document.querySelector('.pv-head h1')`);
await sleep(400);
const r2 = await rowBoxes();
expect('收起态 状态：进行/处理中', r2[0].collapsed, '状态：进行/处理中');
await shot('regress-group-leaf.png');

console.log('\n═══ 回归：再点已选中的项 → 幂等（不取消）═══');
await realClick(firstBox);
await sleep(500);
await realClick(openItem('处理中'));
await sleep(400);
await realClick(openItem('处理中'));
await sleep(450);
const piped = await ev(`(() => {
  const box = document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0];
  return [...box.querySelectorAll('.filter-box__item.is-picked')].map(i => i.textContent.replace('›',''));
})()`);
expect('处理中仍然选中', piped, ['处理中']);
await shot('regress-idempotent.png');

console.log('\n═══ 回归：点同行空白 → 收起（外面=按钮外面）═══');
const blank = await ev(`(() => {
  const box = document.querySelectorAll('.filter-row')[0].querySelectorAll('.filter-box')[0];
  const r = box.getBoundingClientRect();
  return { x: Math.round(r.right + 260), y: Math.round(r.y + r.height/2) };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: blank.x, y: blank.y });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: blank.x, y: blank.y, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: blank.x, y: blank.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(450);
expect('点了同行空白 ⇒ 收起', (await rowBoxes())[0].open, false);
await shot('regress-row-blank.png');

console.log('\n═══ 回归：三级 ═══');
/*
 * ⚠ 深层是**第 3 个 .filter-row**（0=真实那一排 1=单组件演示 2=三级 3=已选态）。
 *   上一版写成 [1]，点到单组件那个去了 —— 测试下标错，不是组件错。
 */
await realClick(`document.querySelector('.pv-head h1')`);
await sleep(350);
const deepBox = `document.querySelectorAll('.filter-row')[2].querySelector('.filter-box')`;
await realClick(deepBox);
await sleep(500);
console.log('  深层开后 items:', JSON.stringify(await ev(`[...document.querySelectorAll('.filter-box.is-open .filter-box__item')].map(i => i.textContent)`)));
await realClick(openItem('组一'));
await sleep(450);
await realClick(openItem('甲'));
await sleep(450);
const d = await ev(`(() => {
  const box = document.querySelectorAll('.filter-row')[2].querySelector('.filter-box');
  const ex = box.querySelector('.filter-box__face--expanded');
  const rs = [...ex.children].filter(c => c.classList.contains('filter-box__items'));
  return {
    rows: rs.map(r => [...r.querySelectorAll('.filter-box__item')].map(i => ({
      t: i.textContent.replace('›',''),
      picked: i.classList.contains('is-picked'),
      branch: i.classList.contains('is-branch'),
    }))),
    vlins: box.querySelectorAll('.filter-box__vline').length
  };
})()`);
console.log('  ', JSON.stringify(d));
expect('三行', d.rows.length, 3);
expect('第三行 甲一/甲二', d.rows[2].map((x) => x.t), ['甲一', '甲二']);
expect('甲 既选中又是分支', [d.rows[1][0].picked, d.rows[1][0].branch], [true, true]);
expect('两条竖线', d.vlins, 2);
await realClick(openItem('甲二'));
await sleep(400);
await realClick(`document.querySelector('.pv-head h1')`);
await sleep(400);
const dcZone = await ev(`(() => {
  const face = document.querySelectorAll('.filter-row')[2].querySelector('.filter-box__face--collapsed');
  const zone = face.querySelector('.filter-box__zone');
  return [...zone.children].filter(c => !c.classList.contains('filter-box__caret')).map(c => c.textContent).join('').trim();
})()`);
expect('收起态 深层：组一/甲/甲二', dcZone, '深层：组一/甲/甲二');
await shot('regress-deep3.png');

console.log('\n═══ 回归：单组件受控演示（② 那一块）═══');
const soloBefore = await ev(`document.querySelectorAll('.filter-row')[2].querySelector('.filter-box').classList.contains('is-open')`);
await realClick(`document.querySelectorAll('.filter-row')[2].querySelector('.filter-box')`);
await sleep(400);
const soloAfter = await ev(`document.querySelectorAll('.filter-row')[2].querySelector('.filter-box').classList.contains('is-open')`);
expect('单盒子能自己开（open 由外部灌）', [soloBefore, soloAfter], [false, true]);
await shot('regress-solo.png');

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言失败 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
