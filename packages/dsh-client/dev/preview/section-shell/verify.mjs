/**
 * `SectionShell` 的验收 —— **SSR 结构断言**。
 *
 * `node packages/dsh-client/dev/preview/section-shell/verify.mjs`
 *
 * ## 为什么是 SSR 而不是 CDP
 *
 * 这个组件要证明的是「**三种 mode 的 head 结构完全相同，只有可交互属性不同**」。
 * 那是 DOM 结构问题，不是像素问题 ⇒ `renderToStaticMarkup` 就够，
 * 而且不需要起浏览器（快、无 flake）。
 *
 * 真实浏览器里的**计算样式**（padding / border-radius / font-size / margin
 * 在三处相等）由 `dev/preview/carddetail/verify.mjs` 的 ⑨ 块断言 —— 两个文件分工不同：
 *
 * | 文件 | 证明什么 |
 * |---|---|
 * | 本文件 | 三 mode 的 head / body **结构**相同；readonly 只加可交互属性 |
 * | `carddetail/verify.mjs` | 建卡 / 草稿 / 终结**三处计算值**逐项相等 |
 *
 * ## 还能断言「唯一一套 CSS」
 *
 * `SECTION_SHELL_CSS` 是纯 `.ts`，Node 能直接 import ⇒ 顺手断言：
 *
 * - `.tb3-sec--readonly` 那条规则里**没有** padding / margin / border-radius /
 *   font-size / background / color（mode 不许改视觉）
 * - 旧的 `.section-block` / `.ask-option` 类族**不在**这套 CSS 里
 */

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { pathToFileURL } from 'node:url';

import { rolldown } from 'rolldown';

/* 纯 .ts（无 JSX）⇒ Node 的类型剥离能直接加载。 */
import { SECTION_SHELL_CSS } from '../../../src/renderers/section-shell-css.ts';

const HERE = import.meta.dirname;
const ENTRY = nodePath.join(HERE, 'ssr-entry.tsx');
/** 临时产物必须落在包目录内，否则 `import 'react'` 解析不到 node_modules。 */
const BUNDLE = nodePath.join(HERE, '.verify-ssr.mjs');

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
   ① 打包 SSR 入口
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

const renderShell = mod.renderShell;

/** 取开始标签（到第一个 `>`，含）。 */
const openTagOf = (html) => html.slice(0, html.indexOf('>') + 1);
/** 取 `</section>` 之前的内容（= head + hint + body + error 的序列化）。 */
const innerOf = (html) => html.slice(html.indexOf('>') + 1);
/** 取 `<header …>…</header>`。 */
const headOf = (html) => {
	const start = html.indexOf('<header ');
	const end = html.indexOf('</header>');
	return start < 0 || end < 0 ? null : html.slice(start, end + '</header>'.length);
};

const edit = renderShell('edit');
const interactive = renderShell('interactive');
const readonly = renderShell('readonly');

/* ══════════════════════════════════════════════════════════
   ② 根节点：class / mode 属性
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ① 根节点：三种 mode 只差可交互属性 ═══');
{
	expect('edit 的根 class 只有 tb3-sec', openTagOf(edit).startsWith('<section class="tb3-sec"'), true);
	expect(
		'interactive 的根 class 也只有 tb3-sec',
		openTagOf(interactive).startsWith('<section class="tb3-sec"'),
		true,
	);
	expect(
		'readonly 额外带 tb3-sec--readonly（唯一的 class 差异）',
		openTagOf(readonly).startsWith('<section class="tb3-sec tb3-sec--readonly"'),
		true,
	);

	expect(
		'data-section-mode 三值',
		[openTagOf(edit).includes('data-section-mode="edit"'), openTagOf(interactive).includes('data-section-mode="interactive"'), openTagOf(readonly).includes('data-section-mode="readonly"')],
		[true, true, true],
	);
	expect(
		'data-section-readonly 只由 mode 决定',
		[
			openTagOf(edit).includes('data-section-readonly="false"'),
			openTagOf(interactive).includes('data-section-readonly="false"'),
			openTagOf(readonly).includes('data-section-readonly="true"'),
		],
		[true, true, true],
	);

	/*
	 * 把 mode / readonly 这两个**必然不同**的属性归一化之后，开始标签必须逐字相同。
	 * ⇒ 除它们以外没有任何属性随 mode 变化（没有 aria-hidden、没有额外 class）。
	 */
	const normalizeRoot = (html, mode) =>
		openTagOf(html)
			.replace(' tb3-sec--readonly', '')
			.replace(`data-section-mode="${mode}"`, 'data-section-mode="MODE"')
			.replace(/data-section-readonly="(?:true|false)"/, 'data-section-readonly="RO"');
	expect(
		'⭐ 归一化后三个开始标签完全相同（只有 mode / readonly 属性不同）',
		[
			normalizeRoot(edit, 'edit') === normalizeRoot(interactive, 'interactive'),
			normalizeRoot(interactive, 'interactive') === normalizeRoot(readonly, 'readonly'),
		],
		[true, true],
	);
}

/* ══════════════════════════════════════════════════════════
   ③ head / body 结构三 mode 完全相同
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ② head / body 结构三 mode 完全相同 ═══');
{
	const head = headOf(edit);
	expect('head 存在', head !== null, true);
	expect(
		'⭐ head 是 index + title + type 三个 span（结构唯一）',
		head,
		'<header class="tb3-sec__head"><span class="tb3-sec__index" aria-hidden="true">1</span><span class="tb3-sec__title">需要回答的问题</span><span class="tb3-sec__type">选项</span></header>',
	);
	expect(
		'⭐ 三种 mode 的 head 逐字相同',
		[headOf(interactive) === head, headOf(readonly) === head],
		[true, true],
	);

	const inner = innerOf(edit);
	expect(
		'⭐ 三种 mode 的 head + hint + body 序列化逐字相同',
		[innerOf(interactive) === inner, innerOf(readonly) === inner],
		[true, true],
	);
	expect(
		'body 里是调用方给的 children（外壳不偷改内容）',
		inner.includes('<div class="tb3-sec__body"><div class="tb3-ssr-body">正文</div></div>'),
		true,
	);
}

/* ══════════════════════════════════════════════════════════
   ④ hint 也三 mode 相同（它是内容，不是 mode 的视觉分支）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ③ hint 三 mode 相同 ═══');
{
	const withHint = {
		edit: renderShell('edit', { hint: '模板给的提示' }),
		interactive: renderShell('interactive', { hint: '模板给的提示' }),
		readonly: renderShell('readonly', { hint: '模板给的提示' }),
	};
	expect(
		'hint 节点在',
		[withHint.edit.includes('<div class="tb3-sec__hint">模板给的提示</div>'), withHint.readonly.includes('<div class="tb3-sec__hint">模板给的提示</div>')],
		[true, true],
	);
	expect(
		'⭐ hint 的序列化三 mode 逐字相同',
		[innerOf(withHint.interactive) === innerOf(withHint.edit), innerOf(withHint.readonly) === innerOf(withHint.edit)],
		[true, true],
	);
}

/* ══════════════════════════════════════════════════════════
   ⑤ CSS：唯一一套 + readonly 不改视觉
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ④ CSS：唯一一套，readonly 不改视觉 ═══');
{
	expect('SECTION_SHELL_CSS 非空', SECTION_SHELL_CSS.length > 4000, true);

	const required = [
		'.tb3-sec{',
		'.tb3-sec__head{',
		'.tb3-sec__index{',
		'.tb3-sec__title{',
		'.tb3-sec__type{',
		'.tb3-sec__body{',
		'.tb3-sec--readonly{',
		'.tb3-ask__option{',
	];
	expect(
		'⭐ 三处共用的类都在同一份 CSS 里',
		required.filter((rule) => !SECTION_SHELL_CSS.includes(rule)),
		[],
	);

	/* 旧类族（两套样式的遗迹）必须彻底不在 */
	expect(
		'⭐ 旧的 .section-block / .ask-option / .tb3cc-sec 类族已不在',
		['.section-block', '.ask-option', '.tb3cc-sec'].filter((old) => SECTION_SHELL_CSS.includes(old)),
		[],
	);

	const start = SECTION_SHELL_CSS.indexOf('.tb3-sec--readonly{');
	const end = SECTION_SHELL_CSS.indexOf('}', start);
	const readonlyRule = SECTION_SHELL_CSS.slice(start, end + 1);
	expect('readonly 规则存在', start >= 0 && end > start, true);
	expect(
		'⭐ readonly 只写可交互属性（cursor / user-select）',
		['cursor', 'user-select'].filter((one) => !readonlyRule.includes(one)),
		[],
	);
	expect(
		'⭐ readonly 不写任何视觉属性',
		['padding', 'margin', 'border-radius', 'font-size', 'background', 'color'].filter((one) =>
			readonlyRule.includes(one),
		),
		[],
	);
	expect('readonly 规则原文', readonlyRule, '.tb3-sec--readonly{cursor:default;user-select:text}');
}

/* ══════════════════════════════════════════════════════════
   ⑥ 预览产物里也真的注入了这段 CSS（防「CSS 写了但没拼进 injectStyles」）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑤ 注入表（styles.ts）真的拼了这段 CSS ═══');
{
	const stylesSource = readFileSync(
		nodePath.join(HERE, '..', '..', '..', 'src', 'styles.ts'),
		'utf8',
	);
	expect('SECTION_SHELL_CSS 被 import', stylesSource.includes('SECTION_SHELL_CSS'), true);
	expect(
		'STYLE_SEGMENTS 里有它',
		/\{\s*name:\s*'SECTION_SHELL_CSS'/.test(stylesSource),
		true,
	);
}

console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  SSR 断言数 ${total}（失败 ${failures.length}）`);
process.exit(failures.length > 0 ? 1 : 0);
