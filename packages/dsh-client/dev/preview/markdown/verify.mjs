/**
 * markdown 组件的 CDP 验证 —— 断言**真实 DOM**。
 *
 * ## 为什么单测之外还要这个
 *
 * `dev/test/markdown.test.ts` 测的是**虚拟节点树**（`MdNode[]`）。
 * 从树到 DOM 中间还有一层 `components/Markdown.tsx` 的 `createElement` 映射 ——
 * 那一层单测覆盖不到。这里的断言补的就是这一层：
 *
 * - 类名契约（`md-code` / `md-table` / `md-task` / `md-task.is-done`）
 * - 链接的 `target` / `rel` 真的落在 DOM 上
 * - **XSS 全部没进 DOM**（页面上查不到那些元素，全局变量也没被赋值）
 *
 * 用法：
 *
 * ```powershell
 * node dev/preview/build.mjs markdown
 * node dev/preview/markdown/verify.mjs
 * ```
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
	console.error('找不到 Edge');
	process.exit(1);
}

const HERE = import.meta.dirname;
const DEV = nodePath.join(HERE, '..', '..');
const OUT = nodePath.join(DEV, 'shots');
mkdirSync(OUT, { recursive: true });

const PAGE = nodePath.join(HERE, 'index.html');
if (!existsSync(PAGE)) {
	console.error(`先跑构建: node dev/preview/build.mjs markdown（缺 ${PAGE}）`);
	process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9333;
const profile = mkdtempSync(nodePath.join(tmpdir(), 'md-'));
const proc = spawn(
	EDGE,
	[
		'--headless=new',
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${profile}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'about:blank',
	],
	{ stdio: 'ignore' },
);

const waitFor = async (url, ms = 20000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			/* 还没起来 */
		}
		await sleep(200);
	}
	throw new Error(`等待超时: ${url}`);
};

const failures = [];
const errors = [];

try {
	await waitFor(`http://127.0.0.1:${port}/json/version`);

	const pageUrl = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
	const target = await (
		await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })
	).json();

	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});

	let seq = 0;
	const pending = new Map();
	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (message.id !== undefined && pending.has(message.id)) {
			const handler = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
			else handler.resolve(message.result);
			return;
		}
		if (message.method === 'Runtime.exceptionThrown') {
			const detail = message.params.exceptionDetails;
			errors.push((detail.exception?.description ?? detail.text ?? '').split('\n')[0]);
		}
	};

	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify({ id, method, params }));
		});

	await send('Runtime.enable');
	await send('Page.enable');
	await send('Emulation.setDeviceMetricsOverride', {
		width: 1000,
		height: 1400,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await sleep(1500);

	const evaluate = async (expression) => {
		const result = await send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails) {
			const detail = result.exceptionDetails;
			throw new Error(detail.exception?.description ?? detail.text ?? 'evaluate 失败');
		}
		return result.result?.value;
	};

	const check = (label, ok, detail) => {
		if (!ok) failures.push(`${label}${detail === undefined ? '' : ` —— ${detail}`}`);
		console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || detail === undefined ? '' : ` —— ${detail}`}`);
	};

	console.log('\n进程内错误：');
	console.log(`  ${errors.length === 0 ? '✓ 0 条' : `✗ ${errors.length} 条：${errors.join(' | ')}`}`);
	if (errors.length > 0) failures.push(`页面抛了 ${errors.length} 个异常`);

	/* ══════════════════════════════════════════════════════
	   一、XSS：DOM 里必须查不到
	   ══════════════════════════════════════════════════════ */

	console.log('\nXSS —— 危险元素不进 DOM：');
	const forbidden = await evaluate(`(() => {
		const scope = document.querySelector('#xss');
		if (!scope) return { missing: true };
		const names = ['script', 'iframe', 'svg', 'style', 'input', 'textarea', 'object', 'embed'];
		const counts = {};
		for (const name of names) counts[name] = scope.querySelectorAll(name).length;
		const events = [...scope.querySelectorAll('*')].flatMap((el) =>
			[...el.attributes].map((a) => a.name).filter((n) => n.startsWith('on'))
		);
		const badHrefs = [...scope.querySelectorAll('a')]
			.map((a) => a.getAttribute('href') ?? '')
			.filter((href) => !/^(https?:\\/\\/|mailto:|\\/)/i.test(href));
		return { missing: false, counts, events, badHrefs, html: scope.innerHTML.length };
	})()`);

	check('预览页有 #xss 区块', forbidden.missing === false);
	for (const name of ['script', 'iframe', 'svg', 'style', 'input', 'textarea', 'object', 'embed']) {
		check(`#xss 里没有 <${name}>`, forbidden.counts[name] === 0, `有 ${forbidden.counts[name]} 个`);
	}
	check('#xss 里没有任何 on* 事件属性', forbidden.events.length === 0, forbidden.events.join(','));
	check('#xss 里所有 <a> 的 href 都过白名单', forbidden.badHrefs.length === 0, forbidden.badHrefs.join(','));

	console.log('\nXSS —— 脚本没有执行：');
	const globals = await evaluate(`(() => {
		const names = ['__xss_script','__xss_img','__xss_link','__xss_svg','__xss_a','__xss_click','__xss_input','__xss_ta'];
		return names.filter((one) => window[one] !== undefined);
	})()`);
	check('没有任何 window.__xss_* 被赋值', globals.length === 0, globals.join(','));

	console.log('\nXSS —— 危险内容没有作为纯文本漏出来：');
	const leaked = await evaluate(`(() => {
		const scope = document.querySelector('#xss');
		const text = scope ? scope.textContent ?? '' : '';
		return {
			hasScriptBody: text.includes('window.__xss_') && text.includes('alert'),
			hasJsHref: text.includes('javascript:'),
			sample: text.slice(0, 160),
		};
	})()`);
	check('正文里没有未净化的脚本源码', leaked.hasScriptBody === false, leaked.sample);
	check('正文里没有 javascript: 链接文本', leaked.hasJsHref === false, leaked.sample);

	/* ══════════════════════════════════════════════════════
	   二、正常语法：结构与类名
	   ══════════════════════════════════════════════════════ */

	console.log('\n正常语法 —— 结构：');
	const shape = await evaluate(`(() => {
		const scope = document.querySelector('#normal');
		const pick = (selector) => scope.querySelectorAll(selector).length;
		const code = scope.querySelector('pre.md-code');
		const table = scope.querySelector('table.md-table');
		const link = scope.querySelector('a[href^="https://example.com"]');
		const rel = scope.querySelector('a[href^="/x"]');
		return {
			h1: pick('h1'), h2: pick('h2'), strong: pick('strong'), em: pick('em'), del: pick('del'),
			code: pick(':not(pre) > code'), ul: pick('ul'), ol: pick('ol'), blockquote: pick('blockquote'),
			hr: pick('hr'), table: table !== null, th: pick('th'), td: pick('td'),
			codeBlock: code !== null,
			codeLang: code?.getAttribute('data-lang') ?? null,
			codeBody: code?.querySelector('code.md-code__body')?.textContent ?? null,
			external: link === null ? null : { target: link.getAttribute('target'), rel: link.getAttribute('rel') },
			internal: rel === null ? null : { target: rel.getAttribute('target'), rel: rel.getAttribute('rel') },
		};
	})()`);

	for (const [label, actual] of [
		['h1', 1],
		['h2', 1],
		['ul ≥ 2（含任务列表）', 2],
		['ol', 1],
		['blockquote', 1],
	]) {
		if (label === 'ul ≥ 2（含任务列表）') check(label, shape.ul >= actual, `实际 ${shape.ul}`);
		else check(label, shape[label] === actual, `实际 ${shape[label]}`);
	}
	check('strong / em / del / 行内 code 都在', shape.strong > 0 && shape.em > 0 && shape.del > 0 && shape.code > 0);
	check('hr', shape.hr === 1, `实际 ${shape.hr}`);
	check('table.md-table', shape.table);
	check('th / td', shape.th > 0 && shape.td > 0);
	check('代码块 pre.md-code[data-lang="ts"]', shape.codeBlock && shape.codeLang === 'ts', String(shape.codeLang));
	check('代码块内容正确', shape.codeBody?.includes('const answer: number = 42;') === true, String(shape.codeBody));
	check(
		'外链 target=_blank rel=noopener noreferrer',
		shape.external?.target === '_blank' && shape.external?.rel === 'noopener noreferrer',
		JSON.stringify(shape.external),
	);
	check(
		'站内链接 /x 也加 target/rel',
		shape.internal?.target === '_blank' && shape.internal?.rel === 'noopener noreferrer',
		JSON.stringify(shape.internal),
	);

	console.log('\n正常语法 —— 任务项：');
	const tasks = await evaluate(`(() => {
		const scope = document.querySelector('#normal');
		const items = [...scope.querySelectorAll('li.md-task')];
		return items.map((one) => ({
			done: one.classList.contains('is-done'),
			box: one.querySelector('.md-task__box')?.textContent ?? null,
			text: one.textContent ?? '',
		}));
	})()`);
	check('任务项 2 条', tasks.length === 2, `实际 ${tasks.length}`);
	check('第一条未完成（☐）', tasks[0]?.done === false && tasks[0]?.box === '☐', JSON.stringify(tasks[0]));
	check('第二条已完成（is-done + ☑）', tasks[1]?.done === true && tasks[1]?.box === '☑', JSON.stringify(tasks[1]));
	check(
		'任务项文字里没有残留 checkbox 标记',
		tasks.every((one) => !one.text.includes('[x]') && !one.text.includes('[ ]')),
		JSON.stringify(tasks.map((one) => one.text)),
	);

	console.log('\n正常语法 —— 实体与换行：');
	const extras = await evaluate(`(() => {
		const scope = document.querySelector('#normal');
		const text = scope.textContent ?? '';
		return {
			entity: text.includes('a & b <i> ©'),
			doubleEncoded: text.includes('&amp;') || text.includes('&lt;'),
			br: scope.querySelectorAll('br').length,
		};
	})()`);
	check('实体被解开（a & b <i> ©）', extras.entity === true);
	check('没有双重转义（&amp; 字面量）', extras.doubleEncoded === false);
	check('硬换行产生 br', extras.br >= 1, `实际 ${extras.br}`);

	console.log('\n边角输入：');
	const edge = await evaluate(`(() => {
		const scope = document.querySelector('#edge');
		return {
			blocks: scope.querySelectorAll('.md').length,
			childNodes: [...scope.querySelectorAll('.md')].map((one) => one.childNodes.length),
			text: (scope.textContent ?? '').trim(),
		};
	})()`);
	check('三个空/半成品输入都渲染出 .md 容器', edge.blocks === 3, `实际 ${edge.blocks}`);
	check('空输入不产生子节点', edge.childNodes[0] === 0 && edge.childNodes[1] === 0, JSON.stringify(edge.childNodes));
	check('未闭合 <span> 的文字保留', edge.text.includes('未闭合的 span'), edge.text);

	/* ══════════════════════════════════════════════════════
	   三、截图
	   ══════════════════════════════════════════════════════ */

	const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
	writeFileSync(nodePath.join(OUT, 'markdown.png'), Buffer.from(shot.data, 'base64'));
	console.log(`\n截图: ${nodePath.join(OUT, 'markdown.png')}`);

	ws.close();
} finally {
	proc.kill();
	await sleep(300);
}

if (failures.length > 0) {
	console.log(`\n✗ ${failures.length} 条失败：`);
	for (const one of failures) console.log(`  · ${one}`);
	process.exit(1);
}
console.log('\n✓ 全部通过');
