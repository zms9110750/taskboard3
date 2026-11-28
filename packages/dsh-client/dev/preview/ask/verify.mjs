/**
 * `ask-shape` 预览的**网页级 DOM 测试**（真 Edge + CDP）。
 *
 * ```
 * node dev/preview/ask/verify.mjs
 * ```
 *
 * ⚠ 故意不放进 `packages/dsh-client/test/`：
 *   - 那边是纯逻辑测试（`node --test`，不碰 DOM）
 *   - 这里测的是**真渲染出来的 DOM + 真点击**，需要浏览器
 *   - 用户 2026-11-21：「跟着这个预览里面写在一起，不参与那外面的 src 的测试。
 *     直接做网页级别的 dom 的测试。」
 *
 * 每条断言对应一条裁定：
 *   ① 单选组点自填框 ⇒ 自填选中，其他选项全部失去（互斥）
 *   ② 点别的选项 ⇒ 自填框失去选中
 *   ③ 多选组点自填框 ⇒ 和选项**共存**（不是互斥）
 *   ④ 点「未选择」⇒ 整组回到未选择，按钮亮起
 *   ⑤ 冻结态 ⇒ 选中行 is-readonly + is-picked + 左侧 3px 竖线
 *   ⑥ 自填框输入文字 ⇒ 保持选中
 *   ⑦ 聚焦 / 输入自填框 ⇒ **同一帧**里就选中（issue #61：不靠失焦）
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((one) => existsSync(one));
if (EDGE === undefined) {
	console.error('找不到 Edge，无法跑 DOM 测试');
	process.exit(2);
}

const HERE = import.meta.dirname;
const PAGE = nodePath.join(HERE, 'index.html');
const PORT = 9422;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 起浏览器 ────────────────────────────────────────────── */

const ud = mkdtempSync(nodePath.join(tmpdir(), 'ask-'));
const proc = spawn(
	EDGE,
	[
		'--headless=new',
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${ud}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'--window-size=1600,1200',
		'about:blank',
	],
	{ stdio: 'ignore' },
);

const waitFor = async (fn, ms = 20000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const value = await fn();
			if (value) return value;
		} catch {
			/* 还没起来 */
		}
		await sleep(150);
	}
	throw new Error('timeout');
};

await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok);

const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const target = await (
	await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.onopen = resolve;
	ws.onerror = reject;
});

let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id !== undefined && pending.has(msg.id)) {
		pending.get(msg.id)(msg);
		pending.delete(msg.id);
	}
};

/** 发一条 CDP 命令。 */
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = ++seq;
		pending.set(id, (msg) => {
			if (msg.error) reject(new Error(JSON.stringify(msg.error)));
			else resolve(msg.result);
		});
		ws.send(JSON.stringify({ id, method, params }));
	});

/** 在页面里求值，返回 JSON 值。 */
const evalJs = async (expression) => {
	const result = await send('Runtime.evaluate', {
		expression,
		returnByValue: true,
		awaitPromise: true,
	});
	if (result.exceptionDetails) {
		throw new Error(`页面报错: ${JSON.stringify(result.exceptionDetails)}`);
	}
	return result.result.value;
};

/* ── 等 React 挂载 ──────────────────────────────────────── */

await waitFor(async () => (await evalJs('document.querySelectorAll(".as-grid .as-col").length')) === 3);
await sleep(300);

/* ── 断言工具 ───────────────────────────────────────────── */

let pass = 0;
const failures = [];

/**
 * @param {string} name 断言名
 * @param {unknown} actual 实测
 * @param {unknown} expected 期望
 */
function check(name, actual, expected) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		pass += 1;
		console.log(`  ✓ ${name}`);
		return;
	}
	failures.push(`${name}\n      期望 ${e}\n      实测 ${a}`);
	console.log(`  ✗ ${name}\n      期望 ${e}\n      实测 ${a}`);
}

/* ── 选择器 ─────────────────────────────────────────────── */

/** active 栏（第 2 个 .as-col）。 */
const ACTIVE = '.as-grid .as-col:nth-child(2)';
/** active 栏第 gi 组（1-based）的 DOM 表达式。 */
const G = (gi) => `document.querySelectorAll('${ACTIVE} .tb3-ask__group')[${gi - 1}]`;
/** 某一组每一行的选中状态。 */
const rowsOf = (gi) =>
	`[...(${G(gi)}).querySelectorAll('.tb3-ask__option')].map(function(row){return {kind: row.dataset.rowKind, picked: row.classList.contains('is-picked')}})`;
/** 点某一组第 ri 行。 */
const clickRow = (gi, ri) => `((${G(gi)}).querySelectorAll('.tb3-ask__option')[${ri}].click(), true)`;
/** 点某一组的「未选择」。 */
const clickClear = (gi) => `((${G(gi)}).querySelector('.tb3-ask__state-btn').click(), true)`;

/* ══════════════════════════════════════════════════════════
   ① 单选组：点自填框
   ══════════════════════════════════════════════════════════ */

console.log('\n单选组 · 点自填框');

/*
 * 夹具：单选组预填「方案 B」。行序 = 选项 A / B / C / 自填。
 * 点自填（索引 3）⇒ **只有自填**选中。
 */
await evalJs(clickRow(1, 3));
check('点自填后只有自填选中', await evalJs(rowsOf(1)), [
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: true },
]);

/* ② 再点普通选项 ⇒ 自填失去选中 */
await evalJs(clickRow(1, 0));
check('点选项 A 后只有 A 选中', await evalJs(rowsOf(1)), [
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: false },
]);

/* 再点自填 ⇒ 又回到自填（证明可来回切） */
await evalJs(clickRow(1, 3));
check('再点自填后回到自填选中', await evalJs(rowsOf(1)), [
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: true },
]);

/* ══════════════════════════════════════════════════════════
   ② 多选组：自填和选项共存
   ══════════════════════════════════════════════════════════ */

console.log('\n多选组 · 自填与选项共存');

/*
 * 多选组夹具预填「筛选行」。行序 = 选项 1/2/3 + 自填。
 * 点自填 ⇒ 自填 + 筛选行**同时**选中。
 */
await evalJs(clickRow(2, 3));
check('多选：自填和已选选项共存', await evalJs(rowsOf(2)), [
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: true },
]);

/* 再点另一个选项 ⇒ 三个都选中 */
await evalJs(clickRow(2, 1));
check('多选：再点选项 2 ⇒ 三者共存', await evalJs(rowsOf(2)), [
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: true },
]);

/* 再点自填 ⇒ 只取消自填，选项保留 */
await evalJs(clickRow(2, 3));
check('多选：再点自填 ⇒ 只取消自填', await evalJs(rowsOf(2)), [
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: false },
]);

/* ══════════════════════════════════════════════════════════
   ③ 未选择按钮
   ══════════════════════════════════════════════════════════ */

console.log('\n未选择按钮');

await evalJs(clickClear(2));
check('点未选择 ⇒ 整组清空', await evalJs(rowsOf(2)), [
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: false },
]);
check(
	'点未选择后按钮亮起（.is-on）',
	await evalJs(`(${G(2)}).querySelector('.tb3-ask__state-btn').classList.contains('is-on')`),
	true,
);

/* ══════════════════════════════════════════════════════════
   ③b 「自己填：」标签 + 点输入框不 toggle
   ══════════════════════════════════════════════════════════ */

console.log('\n自填行的「自己填：」入口');

/* 先清空单选组，保证下面从「未选择」开始。 */
await evalJs(clickClear(1));
check(
	'「自己填：」标签存在',
	await evalJs(`(${G(1)}).querySelectorAll('[data-ask-custom-label]').length`),
	1,
);

/*
 * 用户 2026-11-21 第 3 条：「点他，就不是未选择，而是选了 0 个了」——
 * 「点输入框不是选择（可能只是想刮取/看文字）」。
 *
 * ⚠ 这条被 lead 2026-11-28 的裁定钉死了：**显示选中 = 会保存的选中**。
 *   只聚焦 / 没打字 ⇒ 既不是 toggle、也不显示选中、也不写库（选中只发生在
 *   打上字之后，见 ⑦ 段）。这里从「未选择」开始，钉「点一下什么都不发生」。
 */
await evalJs(`((${G(1)}).querySelector('[data-ask-custom]').click(), true)`);
check(
	'点输入框不选中自填行（也不是 toggle）',
	await evalJs(`(${G(1)}).querySelector('[data-row-kind="custom"]').classList.contains('is-picked')`),
	false,
);

/* 点「自己填：」标签：**是选择** */
await evalJs(`((${G(1)}).querySelector('[data-ask-custom-label]').click(), true)`);
check(
	'点「自己填：」标签会选中自填行',
	await evalJs(`(${G(1)}).querySelector('[data-row-kind="custom"]').classList.contains('is-picked')`),
	true,
);

/* 已选中时再点输入框：仍然选中（不 toggle 掉）。 */
await evalJs(`((${G(1)}).querySelector('[data-ask-custom]').click(), true)`);
check(
	'已选中时点输入框 ⇒ 仍然选中（不会取消）',
	await evalJs(`(${G(1)}).querySelector('[data-row-kind="custom"]').classList.contains('is-picked')`),
	true,
);

/* ══════════════════════════════════════════════════════════
   ③c 多选：空文字点自填不改状态
   ══════════════════════════════════════════════════════════ */

console.log('\n多选 · 空文字点自填不改状态');

/*
 * 多选组夹具带自填文字「还有配色」—— 先输入清空，再点「未选择」回到 unset，
 * 然后点自填行（空文字）⇒ **必须还是 unset**（用户第 4 条：
 * 「点他，就不是未选择，而是选了 0 个了。这个逻辑不对」）。
 */
await evalJs(`(function(){
	const input = (${G(2)}).querySelector('[data-ask-custom]');
	input.focus();
	const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
	desc.set.call(input, '');
	input.dispatchEvent(new Event('input', { bubbles: true }));
	/* 产品是「失焦才提交」：清空后必须 blur 才会回写 custom/picked。 */
	setTimeout(() => input.blur(), 0);
	return true;
})()`);
await sleep(150);
await evalJs(clickClear(2));
await evalJs(clickRow(2, 3));
check('多选：空文字点自填 ⇒ 仍是未选择（没有变「已选 0 个」）', await evalJs(rowsOf(2)), [
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: false },
]);
check(
	'多选：空文字点自填后「未选择」按钮仍亮着',
	await evalJs(`(${G(2)}).querySelector('.tb3-ask__state-btn').classList.contains('is-on')`),
	true,
);

/* ══════════════════════════════════════════════════════════
   ③d 未选择按钮是蓝色边框（不是黑底）
   ══════════════════════════════════════════════════════════ */

console.log('\n未选择按钮样式');

/* 重新点一次，确保按钮处于 is-on（前面的用例会改状态）。 */
await evalJs(clickClear(2));
await sleep(120);
check('按钮确实带着 is-on', await evalJs(`(${G(2)}).querySelector('.tb3-ask__state-btn').className`), 'ghost-btn tb3-ask__state-btn is-on');

check(
	'未选择按钮亮起 = 蓝边框（inset box-shadow 里有 brand 蓝）',
	await evalJs(`getComputedStyle((${G(2)}).querySelector('.tb3-ask__state-btn')).boxShadow.indexOf('rgb(37, 99, 235)') >= 0`),
	true,
);
/* 蓝字：只要求是蓝色系（品牌蓝在预览里可能被主题变量覆写成 #2e63d9）。 */
check(
	'未选择按钮亮起 = 蓝字',
	await evalJs(`(function(){
		const m = getComputedStyle((${G(2)}).querySelector('.tb3-ask__state-btn')).color.match(/\\d+/g).map(Number);
		return m[2] > 150 && m[0] < 120;
	})()`),
	true,
);
check(
	'未选择按钮不是蓝底（背景透明）',
	await evalJs(`getComputedStyle((${G(2)}).querySelector('.tb3-ask__state-btn')).backgroundColor`),
	'rgba(0, 0, 0, 0)',
);
/* ══════════════════════════════════════════════════════════
   ④ 自填框输入文字
   ══════════════════════════════════════════════════════════ */

console.log('\n自填框输入');

/*
 * 给受控 input 赋值不会触发 React 的 onChange ⇒
 * 用原型 setter + 派发 input 事件。
 */
await evalJs(`(function(){
	const input = (${G(1)}).querySelector('[data-ask-custom]');
	input.focus();
	/* React 的受控输入：用原型 setter 绕过 value tracker，再派发 input 事件。 */
	const proto = Object.getPrototypeOf(input);
	const desc = Object.getOwnPropertyDescriptor(proto, 'value');
	desc.set.call(input, '自己写的答案');
	input.dispatchEvent(new Event('input', { bubbles: true }));
	/* 产品是「失焦才提交」：输入完要 blur 才把 custom/picked 写回。 */
	setTimeout(() => input.blur(), 0);
	return true;
})()`);
await sleep(200);
check(
	'输入文字后自填行仍选中',
	await evalJs(`(${G(1)}).querySelector('[data-row-kind="custom"]').classList.contains('is-picked')`),
	true,
);
check('输入的文字进了 input', await evalJs(`(${G(1)}).querySelector('[data-ask-custom]').value`), '自己写的答案');

/* ══════════════════════════════════════════════════════════
   ⑤ 冻结态（ended 栏）
   ══════════════════════════════════════════════════════════ */

console.log('\n冻结态');

const ENDED = '.as-grid .as-col:nth-child(3)';
check(
	'冻结态选中行有 is-readonly',
	await evalJs(`document.querySelector('${ENDED} .tb3-ask__option.is-picked').classList.contains('is-readonly')`),
	true,
);
check(
	'冻结态选中行有左侧竖线（::before 宽 3px）',
	await evalJs(`getComputedStyle(document.querySelector('${ENDED} .tb3-ask__option.is-picked'), '::before').width`),
	'3px',
);
check(
	'冻结态没有可点的未选择按钮',
	await evalJs(`document.querySelectorAll('${ENDED} .tb3-ask__state-btn').length`),
	0,
);

/* ══════════════════════════════════════════════════════════
   ⑦ 自填框：**打上字** ⇒ 立刻选中（issue #61 + lead 2026-11-28 的裁定）

   裁定：**显示选中 = 会保存的选中**（没有例外）。
   ⇒ 只聚焦 / 没打字 ⇒ 界面不许显示选中；打上字 ⇒ 同一帧显示，失焦后落库。
   ══════════════════════════════════════════════════════════ */

console.log('\n自填框 · 输入即选中（issue #61）');

/** 某一组整组的选中快照（行 / 三态 / 徽章 / 输入框文字）。 */
const snapshotOf = (gi) => `(function(){
	const group = ${G(gi)};
	const badge = group.querySelector('.tb3-ask__state-btn');
	return {
		rows: [...group.querySelectorAll('.tb3-ask__option')].map(function(row){
			return { kind: row.dataset.rowKind, picked: row.classList.contains('is-picked') };
		}),
		state: group.dataset.askState,
		badgeOn: badge.classList.contains('is-on'),
		value: group.querySelector('[data-ask-custom]').value,
	};
})()`;

/**
 * 聚焦（可选再输入一段文字），**全程不失焦**；每次事件之后在绘制之前读一次快照。
 *
 * ⚠ 为什么读在 `requestAnimationFrame` 里，而不是「同一个 JS 栈」：
 *   React 19 把离散事件的更新放到**微任务**里刷（同一个 task 里读还是旧 DOM），
 *   但微任务在浏览器绘制之前一定跑完 ⇒ 用户看到的是**一次渲染**里三件事同时发生
 *   （自填选中 / 同组其它选项取消 / 「未选择」熄灭）。
 *   这里要钉的正是这一点：**不靠失焦**，也不靠任何定时器等它。
 *
 * @param {number} gi 组号（1-based）
 * @param {string | null} text 要打进去的文字；`null` = 只聚焦不输入
 */
const focusIn = (gi, text) => `(async function(){
	const group = ${G(gi)};
	const input = group.querySelector('[data-ask-custom]');
	const snap = function(){
		const badge = group.querySelector('.tb3-ask__state-btn');
		return {
			rows: [...group.querySelectorAll('.tb3-ask__option')].map(function(row){
				return { kind: row.dataset.rowKind, picked: row.classList.contains('is-picked') };
			}),
			state: group.dataset.askState,
			badgeOn: badge.classList.contains('is-on'),
			value: input.value,
		};
	};
	const beforePaint = function(){
		return new Promise(function(resolve){ requestAnimationFrame(function(){ resolve(null) }) });
	};
	input.focus();
	await beforePaint();
	const afterFocus = snap();
	${text === null ? '' : `
	const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
	desc.set.call(input, ${JSON.stringify(text)});
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await beforePaint();
	`}
	return { afterFocus: afterFocus, afterInput: snap() };
})()`;

/**
 * 恢复到「空框 + 未选择」：聚焦清空文字 → 失焦提交 → 点「未选择」。
 *
 * @param {number} gi 组号（1-based）
 */
async function resetGroup(gi) {
	await evalJs(`(function(){
		const input = (${G(gi)}).querySelector('[data-ask-custom]');
		input.focus();
		const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
		desc.set.call(input, '');
		input.dispatchEvent(new Event('input', { bubbles: true }));
		/* 产品是「失焦才提交」：清空后必须 blur 才回写 custom/picked。 */
		setTimeout(function(){ input.blur() }, 0);
		return true;
	})()`);
	await sleep(200);
	await evalJs(clickClear(gi));
	await sleep(120);
}

/* ── ⑦-a 只聚焦、不输入 ⇒ **不选中**（显示选中 = 会保存的选中） ── */

await resetGroup(1);
check('前置：单选组整组未选择、徽章亮着', await evalJs(snapshotOf(1)), {
	rows: [
		{ kind: 'option', picked: false },
		{ kind: 'option', picked: false },
		{ kind: 'option', picked: false },
		{ kind: 'custom', picked: false },
	],
	state: 'unset',
	badgeOn: true,
	value: '',
});

const focusOnly = await evalJs(focusIn(1, null));
check('单选 · 只聚焦（不输入）⇒ 自填行不选中', focusOnly.afterFocus.rows, [
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: false },
]);
check('单选 · 只聚焦 ⇒ 「未选择」徽章照旧亮着', [focusOnly.afterFocus.state, focusOnly.afterFocus.badgeOn], [
	'unset',
	true,
]);

/* 失焦：**只聚焦不打字不算作答**（用户 2026-11-21 第 3 条「点输入框不是选择」）
 * ⇒ 屏幕上本来就什么都没显示，失焦后自然也不该写库。 */
await evalJs(`((${G(1)}).querySelector('[data-ask-custom]').blur(), true)`);
await sleep(200);
check('单选 · 只聚焦后失焦 ⇒ 什么都没变（不落库）', await evalJs(snapshotOf(1)), {
	rows: [
		{ kind: 'option', picked: false },
		{ kind: 'option', picked: false },
		{ kind: 'option', picked: false },
		{ kind: 'custom', picked: false },
	],
	state: 'unset',
	badgeOn: true,
	value: '',
});
check(
	'单选 · 只聚焦没打字 ⇒ payload 一个字节都没动（冻结栏没有选中行）',
	await evalJs(`document.querySelectorAll('${ENDED} .tb3-ask__group')[0].querySelectorAll('.tb3-ask__option.is-picked').length`),
	0,
);

/* ── ⑦-a2 A 已选时只聚焦 ⇒「其它选项保持原样」 ── */

await evalJs(clickRow(1, 0));
check('前置：选项 A 已选中', await evalJs(snapshotOf(1)), {
	rows: [
		{ kind: 'option', picked: true },
		{ kind: 'option', picked: false },
		{ kind: 'option', picked: false },
		{ kind: 'custom', picked: false },
	],
	state: 'picked',
	badgeOn: false,
	value: '',
});

const focusKeep = await evalJs(focusIn(1, null));
check('单选 · A 已选时只聚焦 ⇒ A 保持选中、自填仍不选中', focusKeep.afterFocus.rows, [
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: false },
]);
await evalJs(`((${G(1)}).querySelector('[data-ask-custom]').blur(), true)`);
await sleep(150);

/* ── ⑦-b 用户截图 11 的原场景：已选 A，然后在框里打 444 ── */

/*
 * ⚠ 用户原话：「输入内容的时候没有自动立刻选择自填框，而是失去焦点以后才选中。」
 * ⇒ **输入那一刻**（不是聚焦那一刻）就要切到自填并让 A 让位。
 */
const typed = await evalJs(focusIn(1, '444'));
check('单选 · 聚焦那一刻还没打字 ⇒ 仍不选中（显示=会保存）', typed.afterFocus.rows, [
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: false },
]);
check('单选 · 输入 444（不失焦）⇒ 自填行立刻选中、A 让位', typed.afterInput.rows, [
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: true },
]);
check('单选 · 输入的文字立刻在框里', typed.afterInput.value, '444');

/* 失焦：既有节奏不变（一次编辑一次 PATCH），界面不能闪回。 */
await evalJs(`((${G(1)}).querySelector('[data-ask-custom]').blur(), true)`);
await sleep(200);
check('单选 · 失焦后选中仍在（不闪回）', await evalJs(snapshotOf(1)), {
	rows: [
		{ kind: 'option', picked: false },
		{ kind: 'option', picked: false },
		{ kind: 'option', picked: false },
		{ kind: 'custom', picked: true },
	],
	state: 'picked',
	badgeOn: false,
	value: '444',
});
check(
	'单选 · 失焦后文字真的进了 payload（冻结栏显示 444）',
	await evalJs(`(function(){
		const group = document.querySelectorAll('${ENDED} .tb3-ask__group')[0];
		const row = group.querySelector('.tb3-ask__option.is-picked');
		return row === null ? null : row.querySelector('.tb3-ask__option-label').textContent;
	})()`),
	'444',
);

/* ── ⑦-c 多选：共存语义按现状 ── */

await resetGroup(2);
await evalJs(clickRow(2, 0));
const multi = await evalJs(focusIn(2, '补充'));

/*
 * 多选 + **空框**聚焦：按现状不动（`askPatchOf` 的 custom-toggle 就写着
 * 「没输入文字时什么都不改」——用户 2026-11-21：「点他，就不是未选择，
 * 而是选了 0 个了。这个逻辑不对」）。多选只有**真输入了文字**才算选中。
 */
check('多选 · 空框聚焦 ⇒ 什么都不变（不自创「空自填也算选中」）', multi.afterFocus.rows, [
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: false },
]);
check('多选 · 输入「补充」（不失焦）⇒ 自填选中 + 已选选项保留', multi.afterInput.rows, [
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: true },
]);

await evalJs(`((${G(2)}).querySelector('[data-ask-custom]').blur(), true)`);
await sleep(200);
check('多选 · 失焦后共存仍在（不闪回）', await evalJs(snapshotOf(2)), {
	rows: [
		{ kind: 'option', picked: true },
		{ kind: 'option', picked: false },
		{ kind: 'option', picked: false },
		{ kind: 'custom', picked: true },
	],
	state: 'picked',
	badgeOn: false,
	value: '补充',
});
check(
	'多选 · 落库后计数 = 2（选项 1 + 自填）',
	await evalJs(`(function(){
		const group = document.querySelectorAll('${ENDED} .tb3-ask__group')[1];
		return group.querySelector('.tb3-ask__state-text').textContent;
	})()`),
	'已选 2',
);

/* 已经有文字、但**没选中**时只聚焦 ⇒ 仍不显示选中（等价性的关键一条）。
 * ⇒ 这条钉住「聚焦不是选择」（用户 2026-11-21 第 3 条），也钉住
 *   「有草稿文字 ≠ 显示选中」—— 显示的判据是「会保存」。 */
await evalJs(clickRow(2, 3));
await sleep(150);
check('前置：自填文字还在、但没选中', await evalJs(snapshotOf(2)), {
	rows: [
		{ kind: 'option', picked: true },
		{ kind: 'option', picked: false },
		{ kind: 'option', picked: false },
		{ kind: 'custom', picked: false },
	],
	state: 'picked',
	badgeOn: false,
	value: '补充',
});

const keepText = await evalJs(focusIn(2, null));
check('多选 · 有文字但没选中时只聚焦 ⇒ 仍不显示选中', keepText.afterFocus.rows, [
	{ kind: 'option', picked: true },
	{ kind: 'option', picked: false },
	{ kind: 'option', picked: false },
	{ kind: 'custom', picked: false },
]);
await evalJs(`((${G(2)}).querySelector('[data-ask-custom]').blur(), true)`);
await sleep(150);

/* ── ⑦-d 回归：多选空框聚焦**不算选中**（不能从「未选择」变「已选 0 个」） ── */

await resetGroup(2);
const emptyMulti = await evalJs(focusIn(2, null));
check(
	'多选 · 空框聚焦 ⇒ 自填不选中、仍是未选择',
	[emptyMulti.afterFocus.rows[3].picked, emptyMulti.afterFocus.state, emptyMulti.afterFocus.badgeOn],
	[false, 'unset', true],
);

/* ── 收尾 ───────────────────────────────────────────────── */

console.log(`\n${pass} 通过 / ${failures.length} 失败`);
ws.close();
proc.kill();
if (failures.length > 0) {
	console.log('\n失败明细：');
	for (const one of failures) console.log(`  · ${one}`);
	process.exit(1);
}
