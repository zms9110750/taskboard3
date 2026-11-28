/**
 * `markdown` action 三相位预览的网页级 DOM 测试（真 Edge + CDP）。
 *
 * ```
 * node dev/preview/markdown-phase/verify.mjs
 * ```
 *
 * 验证：
 *   ① create 有「查看预览」按钮，点开切到渲染
 *   ② 改源码 ⇒ active / ended 的渲染内容跟着变
 *   ③ active / ended 是只读渲染（没有源码框 / 没有按钮）
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
	console.error('找不到 Edge');
	process.exit(2);
}

const HERE = import.meta.dirname;
const PAGE = nodePath.join(HERE, 'index.html');
const PORT = 9622;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ud = mkdtempSync(nodePath.join(tmpdir(), 'mdp-'));
const proc = spawn(
	EDGE,
	['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${ud}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1700,1200', 'about:blank'],
	{ stdio: 'ignore' },
);

const waitFor = async (fn, ms = 20000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const value = await fn();
			if (value) return value;
		} catch {
			/* not ready */
		}
		await sleep(150);
	}
	throw new Error('timeout');
};

await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok);
const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
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
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = ++seq;
		pending.set(id, (msg) => {
			if (msg.error) reject(new Error(JSON.stringify(msg.error)));
			else resolve(msg.result);
		});
		ws.send(JSON.stringify({ id, method, params }));
	});
const evalJs = async (expression) => {
	const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) throw new Error(`页面报错: ${JSON.stringify(result.exceptionDetails)}`);
	return result.result.value;
};

await waitFor(async () => (await evalJs('document.querySelectorAll(".mdp-col").length')) === 3);
await sleep(400);

let pass = 0;
const failures = [];
const check = (name, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		pass += 1;
		console.log(`  ✓ ${name}`);
		return;
	}
	failures.push(`${name}\n      期望 ${e}\n      实测 ${a}`);
	console.log(`  ✗ ${name}\n      期望 ${e}\n      实测 ${a}`);
};

const CREATE = '[data-phase="create"]';
const ACTIVE = '[data-phase="active"]';
const ENDED = '[data-phase="ended"]';

const setValue = (selector, value) => `(function(){
	const el = document.querySelector('${selector}');
	const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
	desc.set.call(el, ${JSON.stringify(value)});
	el.dispatchEvent(new Event('input', { bubbles: true }));
	return true;
})()`;

/* ══════════════════════════════════════════════════════════
   ① create：源码框 + 查看预览按钮
   ══════════════════════════════════════════════════════════ */

console.log('\n① create：源码框 + 「查看预览」');

check(
	'create 有源码框',
	await evalJs(`document.querySelectorAll('${CREATE} .tb3-sec__textarea').length`),
	1,
);
check(
	'create 有「查看预览」按钮',
	await evalJs(`document.querySelector('${CREATE} .tb3-sec__actions button').textContent.trim()`),
	'查看预览',
);

await evalJs(`(document.querySelector('${CREATE} .tb3-sec__actions button').click(), true)`);
await sleep(250);
check(
	'点开后源码框消失',
	await evalJs(`document.querySelectorAll('${CREATE} .tb3-sec__textarea').length`),
	0,
);
check(
	'点开后出现渲染的 h2',
	await evalJs(`document.querySelectorAll('${CREATE} .md h2').length`),
	1,
);
check(
	'按钮文案变成「回源码」',
	await evalJs(`document.querySelector('${CREATE} .tb3-sec__actions button').textContent.trim()`),
	'← 回源码',
);

await evalJs(`(document.querySelector('${CREATE} .tb3-sec__actions button').click(), true)`);
await sleep(250);

/* ══════════════════════════════════════════════════════════
   ② 改源码 ⇒ active / ended 渲染同步
   ══════════════════════════════════════════════════════════ */

console.log('\n② 改源码 ⇒ active / ended 同步');

await evalJs(setValue(`${CREATE} .tb3-sec__textarea`, '## 新标题 AAA\n\n正文一段。'));
await sleep(300);

check(
	'active 渲染出新标题',
	await evalJs(`document.querySelector('${ACTIVE} .md h2').textContent`),
	'新标题 AAA',
);
check(
	'ended 渲染出新标题',
	await evalJs(`document.querySelector('${ENDED} .md h2').textContent`),
	'新标题 AAA',
);

/* ══════════════════════════════════════════════════════════
   ③ active / ended 是只读渲染
   ══════════════════════════════════════════════════════════ */

console.log('\n③ active / ended 只读');

check(
	'active 没有源码框',
	await evalJs(`document.querySelectorAll('${ACTIVE} .tb3-sec__textarea').length`),
	0,
);
check(
	'ended 没有源码框',
	await evalJs(`document.querySelectorAll('${ENDED} .tb3-sec__textarea').length`),
	0,
);
check(
	'active / ended 没有「查看预览」按钮',
	await evalJs(`document.querySelectorAll('${ACTIVE} .tb3-sec__actions button, ${ENDED} .tb3-sec__actions button').length`),
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
