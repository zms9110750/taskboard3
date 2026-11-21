/**
 * 验证 SearchBox —— **SSR 结构断言**。
 *
 * `node dev/preview/searchbox/verify.mjs`
 *
 * ## 为什么不用 CDP（和别的组件预览不一样）
 *
 * 原计划照 `spacebar/verify.mjs` 用 headless Edge + CDP：
 * 真排版量几何、真派发 `keydown` / `click`、真截图。
 *
 * **但这个沙箱起不来 Chromium**：DSH 沙箱禁止进程创建命名管道，
 * Chromium 的 mojo IPC 必然失败（`platform_channel.cc:187 Check failed: 拒绝访问 (0x5)`），
 * `--headless=new` / `--single-process` / `--no-sandbox` / `--disable-crashpad` 全部同一处 FATAL。
 * ⇒ 改用 `react-dom/server` 的 `renderToStaticMarkup` 断言 **DOM 结构**。
 *
 * | 能断言（本文件 ✓）| 不能断言（需要真浏览器，本文件不假装测了）|
 * |---|---|
 * | 图标在 `.search-box__field` 内部、input 之前 | 图标的 `getBoundingClientRect` 落在 input 框内 |
 * | `disabled` 是否挂在按钮 / input 上 | 输入框与按钮是否同一行（`rect.top` 接近）|
 * | 占位文字 / aria / SVG 形状 | 回车 / 点击是否真的触发 `onSubmit` |
 * | 预览产物把组件打进去了 | 三张截图 |
 *
 * ⚠ 交互行为（trim / 空值 / disabled 判决）在 `packages/dsh-client/test/searchbox.test.ts`
 *   用 `node --test` 直接测**纯函数**源码 —— 那是真断言，不是「间接证明」。
 *   组件里调的就是同一份函数（见 `src/pure/search-box.ts`）。
 */

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

import { rolldown } from 'rolldown';

const HERE = import.meta.dirname;
const ENTRY = nodePath.join(HERE, 'ssr-entry.tsx');
/** 临时产物：必须落在包目录内，否则 `import 'react'` 解析不到 node_modules。 */
const BUNDLE = nodePath.join(HERE, '.verify-ssr.mjs');
const PREVIEW_HTML = nodePath.join(HERE, 'index.html');

let total = 0;
const failures = [];

/** 断言：JSON 相等。 */
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok)
		failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

/* ══════════════════════════════════════════════════════════
   ① 打包 SSR 入口（rolldown，跟 build.mjs 同一套工具）
   ══════════════════════════════════════════════════════════ */

console.log('打包 SSR 入口…');
const bundle = await rolldown({
	input: ENTRY,
	platform: 'node',
	jsx: 'react-jsx',
	external: ['react', 'react/jsx-runtime', 'react-dom/server'],
	define: {
		'process.env.NODE_ENV': '"development"',
	},
});
const { output } = await bundle.generate({ format: 'esm', sourcemap: false });
await bundle.close();
const code = output
	.filter((one) => one.type === 'chunk')
	.map((one) => one.code)
	.join('\n');
writeFileSync(BUNDLE, code, 'utf8');

let mod;
try {
	mod = await import(pathToFileURL(BUNDLE).href);
} finally {
	unlinkSync(BUNDLE);
}

const render = mod.renderSearchBox;

/* ══════════════════════════════════════════════════════════
   ② 结构：图标在框内、在 input 之前
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ① 结构：框内图标（SSR 渲染，DOM 层级）═══');
const empty = render({ value: '' });
{
	expect('根节点是 .search-box', empty.startsWith('<div class="search-box"'), true);
	expect('根节点带 data-search-box="1"', empty.includes('data-search-box="1"'), true);
	expect('空态根节点 data-search-disabled="false"', empty.includes('data-search-disabled="false"'), true);

	/*
	 * ⭐ 核心结构断言：图标和 input 都在**带边框的 field** 里，
	 *   且 field 的结束标签紧挨着按钮 ⇒ 按钮是根的第 2 个子节点、图标不是「框外 label」。
	 *   （`<input>` 是 void 元素，SVG 不可能真是 input 的子节点 —— 主流框架的
	 *     「框内图标」也都是 field 内的 adornment。）
	 */
	const fieldStart = empty.indexOf('<div class="search-box__field">');
	const iconIdx = empty.indexOf('data-search-icon="1"');
	const inputIdx = empty.indexOf('<input');
	const fieldEnd = empty.indexOf('</div>', fieldStart);

	expect('存在带边框的 .search-box__field', fieldStart >= 0, true);
	expect('⭐ 图标在 .search-box__field 内部（start 之后）', iconIdx > fieldStart, true);
	expect('⭐ 图标在 field 结束标签之前（真的在框里）', iconIdx < fieldEnd, true);
	expect('⭐ input 也在同一个 field 内部', inputIdx > fieldStart && inputIdx < fieldEnd, true);
	expect('⭐ SVG 里 circle / path 各一个（放大镜 = 圆 + 斜柄）', {
		circle: (empty.match(/<circle /g) ?? []).length,
		path: (empty.match(/<path /g) ?? []).length,
	}, { circle: 1, path: 1 });
	expect('⭐ 图形本体：circle cx=11 cy=11 r=8', empty.includes('cx="11" cy="11" r="8"'), true);
	expect('⭐ 图形本体：path d="M21 21l-4.35-4.35"（手柄）', empty.includes('d="M21 21l-4.35-4.35"'), true);
	expect('图标是 inline SVG（viewBox 0 0 24 24）', empty.includes('viewBox="0 0 24 24"'), true);
	expect('图标 14×14', empty.includes('width="14" height="14"'), true);
	expect('图标颜色跟随文字色（stroke="currentColor"）', empty.includes('stroke="currentColor"'), true);
	expect('图标 aria-hidden（装饰性，读屏不念）', empty.includes('aria-hidden="true"'), true);
	expect(
		'占位文字 = 默认那句',
		empty.includes('placeholder="搜标题，或输入完整编号后回车…"'),
		true,
	);
	expect('输入框有 aria-label', empty.includes('aria-label="搜索任务板"'), true);
}

/* ══════════════════════════════════════════════════════════
   ③ disabled 判决（SSR 三板）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ② disabled 与受控值（SSR）═══');
{
	const inputTagOf = (html) => {
		const start = html.indexOf('<input');
		return html.slice(start, html.indexOf('>', start) + 1);
	};

	expect('空输入 ⇒ input 本身**不** disabled（只有整框禁用才禁）', inputTagOf(empty).includes('disabled'), false);

	const typed = render({ value: 'K-1024' });
	expect('有内容 ⇒ 值渲染进 input', typed.includes('value="K-1024"'), true);

	const off = render({ value: 'K-1024', disabled: true });
	expect('整框禁用 ⇒ 根节点 data-search-disabled="true"', off.includes('data-search-disabled="true"'), true);
	expect('⭐ 整框禁用 ⇒ input disabled', inputTagOf(off).includes('disabled'), true);

	const custom = render({ value: '', placeholder: '找卡…' });
	expect('placeholder 可被覆盖', custom.includes('placeholder="找卡…"'), true);
}

/* ══════════════════════════════════════════════════════════
   ④ 纯逻辑：和 node --test 同一份模块
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ③ 提交判决（同一份纯函数的速查；完整单测见 test/searchbox.test.ts）═══');
{
	expect('submitQueryOf 去两端空格', mod.submitQueryOf('  K-1024  '), 'K-1024');
	expect('submitQueryOf 纯空格 ⇒ null', mod.submitQueryOf('   '), null);
	expect('submitQueryOf 空串 ⇒ null', mod.submitQueryOf(''), null);
	expect('canSubmitOf 有内容 ⇒ true', mod.canSubmitOf('K-1024', false), true);
	expect('⭐ canSubmitOf 禁用压过内容 ⇒ false', mod.canSubmitOf('K-1024', true), false);
	expect('默认占位文字提到「回车」', /回车/.test(mod.DEFAULT_SEARCH_PLACEHOLDER), true);
}

/* ══════════════════════════════════════════════════════════
   ⑤ 预览产物（用户双击的就是它）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ④ 预览产物（双击 index.html 能看）═══');
{
	let html = '';
	try {
		html = readFileSync(PREVIEW_HTML, 'utf8');
	} catch {
		html = '';
	}
	expect('index.html 已构建', html.length > 0, true);
	expect('产物把 SearchBox 打进去了（有 .search-box__field）', html.includes('search-box__field'), true);
	/*
	 * ⚠ 不能简单搜 `<link `：React DOM 开发版的报错文案里就有
	 *   `` `<link rel=\"preload\" …>` ``（转义双引号，在 JS 字符串里）。
	 *   真正的「外链」特征是**未转义**的 `<link rel="stylesheet"` / `<script src=`。
	 */
	expect(
		'产物是自包含的（无 <script src= / <link rel="stylesheet">，file:// 直开）',
		/<script src=|<link rel="stylesheet"/.test(html),
		false,
	);
	expect('组件样式被打进 <style>（.search-box__field）', html.includes('.search-box__field'), true);
	expect('组件样式里没有 .search-box__go（按钮已删）', html.includes('.search-box__go'), false);
	/*
	 * 语法自检：把内联 `<script>` 的源码交给 V8 编译（**只编译不执行**）——
	 * 抓「构建产物是坏语法 ⇒ 双击白屏」这类错。真运行还是要用户开浏览器。
	 */
	{
		const start = html.indexOf('<script>');
		const end = html.indexOf('</script>', start);
		const js = html.slice(start + '<script>'.length, end);
		let syntaxOk = true;
		try {
			new vm.Script(js);
		} catch {
			syntaxOk = false;
		}
		expect('内联脚本能被 V8 编译（不是坏语法）', syntaxOk, true);
		expect('内联脚本非空', js.length > 1000, true);
	}
}

/* ══════════════════════════════════════════════════════════
   ⑥ 结果 + 诚实清单
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  SSR 断言数 ${total}（失败 ${failures.length}）`);

console.log('\n═══ ⚠ 没测到的（需要真浏览器，这里不假装）═══');
console.log('  ✗ 图标矩形是否落在 input 框内 / 距左边多少 px —— 要 getBoundingClientRect');
console.log('  ✗ input 与按钮是否同一行（rect.top 差）—— 要真排版');
console.log('  ✗ 回车 / 点「前往」是否真的触发 onSubmit —— 要 DOM 事件');
console.log('  ✗ 三张截图 —— headless Chromium 在这个沙箱起不来');
console.log('  ⇒ 交互判决的可信度来自 test/searchbox.test.ts（node --test，真断言）');

process.exit(failures.length > 0 ? 1 : 0);
