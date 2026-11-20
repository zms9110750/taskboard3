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
const G = (gi) => `document.querySelectorAll('${ACTIVE} .ask-group')[${gi - 1}]`;
/** 某一组每一行的选中状态。 */
const rowsOf = (gi) =>
	`[...(${G(gi)}).querySelectorAll('.ask-option')].map(function(row){return {kind: row.dataset.rowKind, picked: row.classList.contains('is-picked')}})`;
/** 点某一组第 ri 行。 */
const clickRow = (gi, ri) => `((${G(gi)}).querySelectorAll('.ask-option')[${ri}].click(), true)`;
/** 点某一组的「未选择」。 */
const clickClear = (gi) => `((${G(gi)}).querySelector('.ask-group__state-btn').click(), true)`;

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
	await evalJs(`(${G(2)}).querySelector('.ask-group__state-btn').classList.contains('is-on')`),
	true,
);

/* ══════════════════════════════════════════════════════════
   ③b 「自己填：」标签 + 点输入框不选中
   ══════════════════════════════════════════════════════════ */

console.log('\n自填行的「自己填：」入口');

/* 先清空单选组，保证下面从「未选择」开始。 */
await evalJs(clickClear(1));
check(
	'「自己填：」标签存在',
	await evalJs(`(${G(1)}).querySelectorAll('[data-ask-custom-label]').length`),
	1,
);

/* 点 input：**不是选择**（用户第 3 条：可能只是想刮取文字） */
await evalJs(`((${G(1)}).querySelector('[data-ask-custom]').click(), true)`);
check(
	'点输入框不会选中自填行',
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
	const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
	desc.set.call(input, '');
	input.dispatchEvent(new Event('input', { bubbles: true }));
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
	await evalJs(`(${G(2)}).querySelector('.ask-group__state-btn').classList.contains('is-on')`),
	true,
);

/* ══════════════════════════════════════════════════════════
   ③d 未选择按钮是蓝色边框（不是黑底）
   ══════════════════════════════════════════════════════════ */

console.log('\n未选择按钮样式');

/* 重新点一次，确保按钮处于 is-on（前面的用例会改状态）。 */
await evalJs(clickClear(2));
await sleep(120);
check('按钮确实带着 is-on', await evalJs(`(${G(2)}).querySelector('.ask-group__state-btn').className`), 'ghost-btn ask-group__state-btn is-on');

check(
	'未选择按钮亮起 = 蓝边框（inset box-shadow 里有 brand 蓝）',
	await evalJs(`getComputedStyle((${G(2)}).querySelector('.ask-group__state-btn')).boxShadow.indexOf('rgb(37, 99, 235)') >= 0`),
	true,
);
/* 蓝字：只要求是蓝色系（品牌蓝在预览里可能被主题变量覆写成 #2e63d9）。 */
check(
	'未选择按钮亮起 = 蓝字',
	await evalJs(`(function(){
		const m = getComputedStyle((${G(2)}).querySelector('.ask-group__state-btn')).color.match(/\\d+/g).map(Number);
		return m[2] > 150 && m[0] < 120;
	})()`),
	true,
);
check(
	'未选择按钮不是蓝底（背景透明）',
	await evalJs(`getComputedStyle((${G(2)}).querySelector('.ask-group__state-btn')).backgroundColor`),
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
	await evalJs(`document.querySelector('${ENDED} .ask-option.is-picked').classList.contains('is-readonly')`),
	true,
);
check(
	'冻结态选中行有左侧竖线（::before 宽 3px）',
	await evalJs(`getComputedStyle(document.querySelector('${ENDED} .ask-option.is-picked'), '::before').width`),
	'3px',
);
check(
	'冻结态没有可点的未选择按钮',
	await evalJs(`document.querySelectorAll('${ENDED} .ask-group__state-btn').length`),
	0,
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
