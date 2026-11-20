/**
 * `text` 组件预览的网页级 DOM 测试（真 Edge + CDP）。
 *
 * ```
 * node dev/preview/text/verify.mjs
 * ```
 *
 * 重点验证**真组件的数据联动**，不是「看起来像」：
 *   ① create 折叠区的 summary 文字 ←→ 里面的 input 同步
 *   ② create 改正文 ⇒ active / ended 跟着变
 *   ③ create 改灰字 ⇒ active 的 placeholder 跟着变
 *   ④ ended 只读（textarea 不能编辑）
 *
 * 用户 2026-11-21：
 * > 「我要看到正确的行为而不是写死的不可交互的文字的演示。
 * >   例如 text · create 候选 3，那个折叠栏上面是有字的，但是没有跟下面的输入框同步文字。
 * >   这个肯定不是预期行为。」
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

const HERE = 'X:/temp/dsh/开发/taskboard3/packages/dsh-client/dev/preview/text';
const PAGE = nodePath.join(HERE, 'index.html');
const PORT = 9611;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ud = mkdtempSync(nodePath.join(tmpdir(), 'tx-'));
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

await waitFor(async () => (await evalJs('document.querySelectorAll(".tx-col").length')) === 3);
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

/** 给受控 input / textarea 赋值（绕过 React 的 value tracker）。 */
const setValue = (selector, value, index = 0) => `(function(){
	const el = document.querySelectorAll('${selector}')[${index}];
	const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
	desc.set.call(el, ${JSON.stringify(value)});
	el.dispatchEvent(new Event('input', { bubbles: true }));
	return true;
})()`;

/* ══════════════════════════════════════════════════════════
   ① 折叠区：summary 文字 ←→ input 同步
   ══════════════════════════════════════════════════════════ */

console.log('\n① create 折叠区：summary 和 input 同步');

const summaryText = `document.querySelector('${CREATE} summary').textContent`;
check(
	'展开前 summary 里有灰字',
	(await evalJs(summaryText)).includes('这一章写什么由你定'),
	true,
);

/* 改折叠区里的 input ⇒ summary 必须跟着变 */
await evalJs(setValue(`${CREATE} .section-block__decl-input`, '改过的灰字 ABC'));
await sleep(200);
check(
	'改 input 后 summary 跟着变',
	(await evalJs(summaryText)).includes('改过的灰字 ABC'),
	true,
);
check(
	'改 input 后 input 自己也是新值',
	await evalJs(`document.querySelector('${CREATE} .section-block__decl-input').value`),
	'改过的灰字 ABC',
);

/* ══════════════════════════════════════════════════════════
   ② 改正文 ⇒ 三栏同步
   ══════════════════════════════════════════════════════════ */

console.log('\n② create 改正文 ⇒ active / ended 同步');

await evalJs(setValue(`${CREATE} .section-block__textarea`, 'create 里写的新正文'));
await sleep(250);

check(
	'active 的正文跟着变',
	await evalJs(`document.querySelector('${ACTIVE} .section-block__textarea').value`),
	'create 里写的新正文',
);
check(
	'active 的灰字（placeholder）也跟着变',
	await evalJs(`document.querySelector('${ACTIVE} .section-block__textarea').getAttribute('placeholder')`),
	'改过的灰字 ABC',
);
check(
	'ended 的正文跟着变',
	await evalJs(`document.querySelector('${ENDED} .section-block__textarea').value`),
	'create 里写的新正文',
);

/* ══════════════════════════════════════════════════════════
   ③ ended 只读
   ══════════════════════════════════════════════════════════ */

console.log('\n③ ended 只读');

check(
	'ended 的 textarea 是 readonly',
	await evalJs(`document.querySelector('${ENDED} .section-block__textarea').readOnly`),
	true,
);
check(
	'create / active 的 textarea 可写',
	await evalJs(`[document.querySelector('${CREATE} .section-block__textarea').readOnly, document.querySelector('${ACTIVE} .section-block__textarea').readOnly]`),
	[false, false],
);

/* ══════════════════════════════════════════════════════════
   ④ active 改正文 ⇒ create / ended 同步（反向验证）
   ══════════════════════════════════════════════════════════ */

console.log('\n④ active 改正文 ⇒ create / ended 同步');

await evalJs(setValue(`${ACTIVE} .section-block__textarea`, 'active 改的正文'));
await sleep(250);
check(
	'create 的正文跟着变',
	await evalJs(`document.querySelector('${CREATE} .section-block__textarea').value`),
	'active 改的正文',
);
check(
	'ended 的正文跟着变',
	await evalJs(`document.querySelector('${ENDED} .section-block__textarea').value`),
	'active 改的正文',
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
