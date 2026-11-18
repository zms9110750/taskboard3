/**
 * 左栏变体展厅的 CDP 验证 + 截图。
 *
 * `node packages/dsh-client/dev/preview/gallery/verify.mjs`
 *
 * ## 它断言什么
 *
 * ① **六块都在**，而且每块都有自己的标题（用户要「一个变体一张图」）。
 * ② **①和②的排法真的不同** —— 量几何，不读代码：
 *    ①里模板和父任务**顶边相同**（同一行）；②里模板在父任务**上面**（分行）。
 * ③ **③和④是两个不同组件** —— ③有 `<select>`、④没有；④点开有**三列**。
 * ④ **④的三列真的能递进** —— 点「代码」领域，类别列变成代码的 4 个；点「工作」，模板列变成代码的工作模板。
 * ⑤ **⑤和⑥互斥**（同一时间只有一个面板开着），且**面板内容一致**（同一套 DOM 结构）。
 * ⑥ **弹层点外面会关、点里面不会关**（这是旧版踩过的坑，不能只看代码）。
 * ⑦ 没有 JS 错误。
 *
 * ## 截图
 *
 * 每个变体一张，存到 `X:\temp\leftvar-*.png`（展厅外面的目录，方便用户直接看）。
 * 用 `Page.captureScreenshot` 的 `clip`，**只截那一块**，不截整页 ——
 * 用户抱怨过「给的是整页，看不出差别」。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((one) => existsSync(one));
if (EDGE === undefined) {
	console.error('找不到 Edge —— 无法跑 CDP 验证');
	process.exit(1);
}

const HERE = import.meta.dirname;
/** 截图**不**放仓库里（`.gitignore` 忽略 png），放用户能直接打开的目录。 */
const SHOTS = 'X:\\temp';
mkdirSync(SHOTS, { recursive: true });

const PAGE = nodePath.join(HERE, 'index.html');
if (!existsSync(PAGE)) {
	console.error(`找不到 ${PAGE} —— 先跑 node packages/dsh-client/dev/preview/build.mjs gallery`);
	process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9341;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'gal-'));
const proc = spawn(
	EDGE,
	[
		'--headless=new',
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${ud}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'about:blank',
	],
	{ stdio: 'ignore' },
);

const wait = async (u, ms = 20000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const r = await fetch(u);
			if (r.ok) return;
		} catch {}
		await sleep(200);
	}
	throw new Error('timeout');
};
await wait(`http://127.0.0.1:${port}/json/version`);

const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const t = await (
	await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((o, n) => {
	ws.onopen = o;
	ws.onerror = n;
});

let i = 0;
const p = new Map();
const errors = [];
const failures = [];
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && p.has(m.id)) {
		const q = p.get(m.id);
		p.delete(m.id);
		m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
		return;
	}
	if (m.method === 'Runtime.exceptionThrown') {
		errors.push(
			(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split(
				'\n',
			)[0],
		);
	}
	if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
		errors.push(
			`console.error: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`,
		);
	}
};
const send = (method, params = {}) =>
	new Promise((res, rej) => {
		const id = ++i;
		p.set(id, { resolve: res, reject: rej });
		ws.send(JSON.stringify({ id, method, params }));
	});

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
	width: 1280,
	height: 1000,
	deviceScaleFactor: 2,
	mobile: false,
});
await sleep(2500);

/*
 * 截图期间把吸附导航条取消吸附 —— 否则它会盖在每张截图的顶部
 * （`captureBeyondViewport` 仍按当前滚动位置渲染，吸附元素永远在视口顶）。
 * CSS 里那个规则只在这个 class 存在时生效，用户看页面时导航照常吸附。
 */
await send('Runtime.evaluate', { expression: `document.body.classList.add('is-shooting')` });

const ev = async (x) => {
	const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails)
		console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 300));
	return r.result?.value;
};
const click = async (sel) => {
	const b = await ev(`(() => { const el = ${sel}; if (!el) return null;
    el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
	if (b === null || b === undefined) return false;
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
	await send('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x: b.x,
		y: b.y,
		button: 'left',
		buttons: 1,
		clickCount: 1,
	});
	await send('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x: b.x,
		y: b.y,
		button: 'left',
		buttons: 0,
		clickCount: 1,
	});
	return true;
};

let total = 0;
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok)
		failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

/**
 * 截**一个变体卡片**那一块。
 *
 * ⚠ 先 `scrollIntoView` 再用**视口坐标**算 clip：`captureScreenshot` 的 `clip`
 *   用的是页面坐标，滚过之后两者不一致 ⇒ 会截到别的地方（实测过）。
 */
const shotOf = async (sel, name) => {
	const box = await ev(`(() => {
    const el = ${sel};
    if (!el) return null;
    el.scrollIntoView({ block: 'start' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
  })()`);
	if (box === null) {
		failures.push(`截图 ${name}：找不到 ${sel}`);
		return;
	}
	await sleep(280);
	const { data } = await send('Page.captureScreenshot', {
		format: 'png',
		clip: { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.w + 12, height: box.h + 12, scale: 2 },
		captureBeyondViewport: true,
	});
	writeFileSync(nodePath.join(SHOTS, name), Buffer.from(data, 'base64'));
	console.log(`  📷 ${name}  ${Math.round(box.w)}×${Math.round(box.h)}`);
};

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ① 六块都在，标题都是对的 ═══');
{
	const cards = await ev(`[...document.querySelectorAll('.g-card')].map(el => ({
    id: el.id,
    tag: el.querySelector('.g-tag').textContent,
    title: el.querySelector('.g-title').textContent,
    note: el.querySelector('.g-note').textContent.length,
  }))`);
	expect('六块变体', cards.length, 6);
	expect(
		'编号 ①~⑥ 各一',
		cards.map((one) => one.tag),
		['①', '②', '③', '④', '⑤', '⑥'],
	);
	expect(
		'每块都有标题',
		cards.every((one) => one.title.length > 4),
		true,
	);
	expect(
		'每块都有一句话说明',
		cards.every((one) => one.note > 20),
		true,
	);
	expect(
		'不再有「居中 / 三段」布局对比（用户明确否掉）',
		/*
		 * ⚠ 只查**渲染出来的文字**，不能查 `document.body.textContent` ——
		 *   打包产物把整个 JS 内联在 `<body>` 的 `<script>` 里，`textContent`
		 *   会把源码注释（含用户原话里的「居中」「三段」）一起读进来 ⇒ 恒为 true。
		 */
		await ev(`/居中|三段/.test(document.querySelector('.g-intro').textContent)`),
		false,
	);
	expect(
		'展厅里只有一个完整对照（左右分栏）',
		await ev(`document.querySelectorAll('.create--final').length`),
		1,
	);
}

console.log('\n═══ ② ①同一行 vs ②分行 —— 量几何 ═══');
{
	/* ① 里模板块和父任务块的顶边应当相同（同一行） */
	const inlineGeom = await ev(`(() => {
    const box = document.querySelector('#v1 .leftcol');
    if (!box) return null;
    const cells = [...box.querySelectorAll('.tv__grid > .tv__cell')];
    const r = cells.map(c => c.getBoundingClientRect());
    return { count: r.length, tops: r.map(x => Math.round(x.top)), lefts: r.map(x => Math.round(x.left)) };
  })()`);
	expect('① 是两个 cell', inlineGeom.count, 2);
	expect('① 两块**顶边相同**（同一行）', inlineGeom.tops[0] === inlineGeom.tops[1], true);
	expect('① 两块**左边不同**（并排，不是叠着）', inlineGeom.lefts[0] !== inlineGeom.lefts[1], true);

	/* ② 里模板块和父任务块是竖着两个 cell，顶边不同、左边相同 */
	const stackedGeom = await ev(`(() => {
    const box = document.querySelector('#v2 .leftcol');
    if (!box) return null;
    const cells = [...box.querySelectorAll('.tv--stacked > .tv__cell')];
    const r = cells.map(c => c.getBoundingClientRect());
    return { count: r.length, tops: r.map(x => Math.round(x.top)), lefts: r.map(x => Math.round(x.left)) };
  })()`);
	expect('② 有两个 cell', stackedGeom.count, 2);
	expect('② 两块**顶边不同**（分行）', stackedGeom.tops[0] !== stackedGeom.tops[1], true);
	expect('② 两块**左边相同**（同一列）', stackedGeom.lefts[0] === stackedGeom.lefts[1], true);

	/* 说明块的段数显示的是模板真段数（3） */
	expect(
		'①②的说明块都显示「共 3 段」',
		await ev(
			`[...document.querySelectorAll('#v1 .tpl__segs, #v2 .tpl__segs')].map(e => e.textContent.trim())`,
		),
		['共 3 段', '共 3 段'],
	);
	expect(
		'①②的父任务都是 combobox（输入即筛选），不是 select',
		await ev(`[...document.querySelectorAll('#v1 .picker__display, #v2 .picker__display')].length`),
		2,
	);

	await shotOf(`document.querySelector('#v1')`, 'leftvar-1-inline.png');
	await shotOf(`document.querySelector('#v2')`, 'leftvar-2-stacked.png');
}

console.log('\n═══ ③ 普通下拉 vs ④ 三级联选弹层 —— 是两个组件 ═══');
{
	expect('③ 用的是原生 select', await ev(`document.querySelector('#v3 select.tpl__select') !== null`), true);
	expect('③ 没有弹层', await ev(`document.querySelector('#v3 [data-picker-pop]') === null`), true);

	/* ④ 初始就是展开的（不展开截图里看不出三列） */
	const pop = await ev(`(() => {
    const el = document.querySelector('#v4 [data-picker-pop]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cols = [...el.querySelectorAll('.tpick__col')].map(c => c.dataset.col);
    return { w: Math.round(r.width), h: Math.round(r.height), cols };
  })()`);
	expect('④ 弹层默认展开', pop !== null, true);
	expect('④ 三列顺序 = 领域 / 类别 / 模板', pop.cols, ['domain', 'kind', 'template']);
	expect('④ 弹层有实际宽度（不是 0）', pop.w > 400, true);
	expect('④ 弹层在 320px 左栏里会往外伸（宽度 > 左栏）', pop.w > 320, true);

	expect(
		'④ 领域列有 ● 和 ○',
		await ev(`[...document.querySelectorAll('#v4 [data-col="domain"] .tpick__radio')].map(e => e.textContent)`),
		['●', '○'],
	);
	expect(
		'④ 类别列前面是**字母**不是圆圈',
		await ev(`[...document.querySelectorAll('#v4 [data-col="kind"] .tpick__prefix')].map(e => e.textContent)`),
		['G', 'D', 'W', 'R'],
	);
	expect(
		'④ 模板列前面是编号前缀',
		await ev(`[...document.querySelectorAll('#v4 [data-col="template"] .tpick__prefix')].map(e => e.textContent)`),
		['U'],
	);
	expect(
		'④ 选中项高亮（● 在「核心」上，用户任务被标出）',
		await ev(`document.querySelector('#v4 [data-template="userNeed"]').classList.contains('is-picked')`),
		true,
	);

	await shotOf(`document.querySelector('#v3')`, 'leftvar-3-select.png');
	await shotOf(`document.querySelector('#v4')`, 'leftvar-4-popover.png');
}

console.log('\n═══ ④ 三级联选真的能递进（点「代码」→ 类别变；点「工作」→ 模板变）═══');
{
	await click(`document.querySelector('#v4 [data-domain="代码"]')`);
	await sleep(320);
	expect(
		'点「代码」⇒ 类别列变成 目标/设计/工作（代码没有记录）',
		await ev(`[...document.querySelectorAll('#v4 [data-col="kind"] .tpick__name')].map(e => e.textContent)`),
		['目标', '设计', '工作'],
	);
	expect(
		'点「代码」⇒ 类别自动落到第一项「目标」',
		await ev(`document.querySelector('#v4 [data-kind="goal"]').classList.contains('is-picked')`),
		true,
	);
	expect(
		'点「代码」⇒ 模板列跟着变成代码的目标模板',
		await ev(`[...document.querySelectorAll('#v4 [data-col="template"] .tpick__name')].map(e => e.textContent)`),
		['预期不符', '新增功能', '项目优化', '编写测试'],
	);

	await click(`document.querySelector('#v4 [data-kind="work"]')`);
	await sleep(320);
	expect(
		'点「工作」⇒ 模板列 = 代码的工作模板',
		await ev(`[...document.querySelectorAll('#v4 [data-col="template"] .tpick__name')].map(e => e.textContent)`),
		['编写代码'],
	);

	await click(`document.querySelector('#v4 [data-template="writeCode"]')`);
	await sleep(320);
	expect(
		'⭐ 选模板后**弹层不关**（用户 2026-11-09 要求：要看说明）',
		await ev(`document.querySelector('#v4 [data-picker-pop]') !== null`),
		true,
	);
	expect(
		'选中后触发器文字跟着变',
		await ev(`document.querySelector('#v4 .tpick__value').textContent`),
		'代码 · 编写代码',
	);
	expect(
		'底部说明跟着变（段数 = 2）',
		await ev(`document.querySelector('#v4 [data-picker-foot] [data-foot-segs]').dataset.footSegs`),
		'2',
	);

	await shotOf(`document.querySelector('#v4')`, 'leftvar-4b-popover-picked.png');

	/* 点外面关 */
	await click(`document.querySelector('.g-intro h1')`);
	await sleep(320);
	expect(
		'⭐ 点面板**外面**才关',
		await ev(`document.querySelector('#v4 [data-picker-pop]') === null`),
		true,
	);
}

console.log('\n═══ ⑤ 按钮+折叠区 vs ⑥ 手风琴 ═══');
{
	/* 两块初始都展开「关系」（演示用） */
	expect(
		'⑤ 关系面板开着',
		await ev(`document.querySelector('#v5 [data-panel="rel"]') !== null`),
		true,
	);
	expect(
		'⑤ 两个按钮，关系那个高亮',
		await ev(`[...document.querySelectorAll('#v5 .meta__tab')].map(b => b.classList.contains('is-on'))`),
		[true, false],
	);

	expect(
		'⑥ 关系面板开着',
		await ev(`document.querySelector('#v6 [data-panel="rel"]') !== null`),
		true,
	);
	expect(
		'⑥ 标题变成「▾ 关系 1」',
		await ev(`document.querySelector('#v6 [data-acc-head="rel"]').textContent.trim()`),
		'▾关系1',
	);

	/* 点 ⑤ 的「高级设置」⇒ 关系面板关掉、高级面板打开（互斥 + 共用一块位置） */
	await click(`[...document.querySelectorAll('#v5 .meta__tab')][1]`);
	await sleep(320);
	expect(
		'⑤ 点高级 ⇒ 关系面板**关掉**（互斥）',
		await ev(`document.querySelector('#v5 [data-panel="rel"]') === null`),
		true,
	);
	expect(
		'⑤ 点高级 ⇒ 高级面板打开',
		await ev(`document.querySelector('#v5 [data-panel="adv"]') !== null`),
		true,
	);
	expect(
		'⑤ 按钮高亮跟着换',
		await ev(`[...document.querySelectorAll('#v5 .meta__tab')].map(b => b.classList.contains('is-on'))`),
		[false, true],
	);
	/* 再点一次 ⇒ 收起 */
	await click(`[...document.querySelectorAll('#v5 .meta__tab')][1]`);
	await sleep(320);
	expect(
		'⑤ 再点已开的 ⇒ 收起',
		await ev(`document.querySelector('#v5 [data-panel="adv"]') === null`),
		true,
	);

	/* 点 ⑥ 的「高级设置」⇒ 手风琴行为一样互斥 */
	await click(`document.querySelector('#v6 [data-acc-head="adv"]')`);
	await sleep(320);
	expect(
		'⑥ 点高级 ⇒ 关系段收起',
		await ev(`document.querySelector('#v6 [data-panel="rel"]') === null`),
		true,
	);
	expect(
		'⑥ 高级段打开',
		await ev(`document.querySelector('#v6 [data-panel="adv"]') !== null`),
		true,
	);
	expect(
		'⑥ 高级段的标题变成「▾ 高级设置」',
		await ev(`document.querySelector('#v6 [data-acc-head="adv"]').textContent.trim()`),
		'▾高级设置',
	);
	expect(
		'⑥ 关系段标题回到「▸ 关系 1」',
		await ev(`document.querySelector('#v6 [data-acc-head="rel"]').textContent.trim()`),
		'▸关系1',
	);

	/* 两块的关系面板 DOM 结构必须一致（同一套内容组件） */
	/*
	 * ⚠ 先把**两块都切到「关系」**再比：上一步 ⑥ 已经切到高级设置 =>
	 *   直接比会拿「有 rel 面板」和「没有 rel 面板」比，恒不相等（实测踩过）。
	 */
	await click(`document.querySelector('#v5 .meta__tab')`);
	await sleep(300);
	await click(`document.querySelector('#v6 [data-acc-head="rel"]')`);
	await sleep(300);
	const cls5 = await ev(`[...document.querySelectorAll('#v5 [data-panel="rel"] *')].map(e => e.className).join('|')`);
	const cls6 = await ev(`[...document.querySelectorAll('#v6 [data-panel="rel"] *')].map(e => e.className).join('|')`);
	expect('两块都开着关系面板', cls5.length > 0 && cls6.length > 0, true);
	expect('⭐ ⑤ 和 ⑥ 的关系面板是**同一套 DOM**（内容没写两遍）', cls5 === cls6, true);
	expect(
		'关系计数 = 已选目标的行数（预置 1 条 ⇒ 1）',
		await ev(`document.querySelector('#v5 .meta__count').textContent`),
		'1',
	);

	await shotOf(`document.querySelector('#v5')`, 'leftvar-5-metatabs.png');
	await shotOf(`document.querySelector('#v6')`, 'leftvar-6-accordion.png');
}

console.log('\n═══ ⑦ 窄栏是真的窄（320px）═══');
{
	const widths = await ev(`[...document.querySelectorAll('.leftcol')].map(e => Math.round(e.getBoundingClientRect().width))`);
	expect('①②的完整左栏都是 320px', widths, [320, 320]);
	expect(
		'③④⑤⑥的聚焦演示位也是 320px',
		await ev(`[...document.querySelectorAll('#v3 .g-focus, #v4 .g-focus, #v5 .g-focus, #v6 .g-focus')].map(e => Math.round(e.getBoundingClientRect().width))`),
		[320, 320, 320, 320],
	);
	/* 横向不溢出（窄栏里最容易出的毛病） */
	expect(
		'页面没有横向滚动条',
		await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`),
		true,
	);
}

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  断言数 ${total}（失败 ${failures.length}）`);
console.log(`  截图目录 ${SHOTS}`);

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
