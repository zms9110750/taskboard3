/**
 * 组件预览构建 —— **一个组件一个目录，互不干扰**。
 *
 * ## 为什么改成参数化
 *
 * 原来只有一个 `main.tsx` + `preview.css`，两个成员同时加组件就会**抢同一批文件**
 * （都是往 `main.tsx` 里塞一个 section、往 `preview.css` 里塞一段样式）。
 * 合并时必然冲突。
 *
 * ⇒ 现在每个组件在自己的子目录里：
 *
 * ```
 * dev/preview/
 * ├─ build.mjs                 ← 本文件（参数化）
 * ├─ preview.css               ← 共享变量 + 公共部分
 * ├─ main.tsx                  ← FilterBox + CardRow（已定稿的，不动）
 * ├─ index.html                ← 上面那个的产物
 * ├─ verify.mjs                ← 上面那个的验证
 * └─ <组件名>/
 *    ├─ main.tsx               该组件的入口（自己写，不碰根 main.tsx）
 *    ├─ style.css              该组件的样式（自己写，不碰根 preview.css）
 *    ├─ index.html             产物
 *    └─ verify.mjs             该组件的 CDP 验证
 * ```
 *
 * ## 用法
 *
 * ```powershell
 * # 构建根（FilterBox + CardRow）
 * node dev/preview/build.mjs
 *
 * # 构建某个组件子目录
 * node dev/preview/build.mjs spacebar
 * ```
 *
 * ⚠ 子目录的 `style.css` 会在**共享样式之后**注入 ⇒ 可以覆盖，
 *   但**不要改共享的类名**（那是别的组件的）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { rolldown } from 'rolldown';

const HERE = import.meta.dirname;
const DEV = nodePath.join(HERE, '..');
const PKG = nodePath.join(DEV, '..');

/* ── 参数：要构建哪个目录（默认根） ── */

const which = process.argv[2] ?? '.';
const DIR = which === '.' ? HERE : nodePath.join(HERE, which);

if (!existsSync(DIR)) {
	console.error(`目录不存在: ${DIR}`);
	process.exit(1);
}

const ENTRY = nodePath.join(DIR, 'main.tsx');
if (!existsSync(ENTRY)) {
	console.error(`找不到入口: ${ENTRY}`);
	process.exit(1);
}

const OUT = nodePath.join(DIR, 'index.html');

/* ── CSS：共享 + 组件自己的 ── */

/*
 * ⚠ 用 `readFileSync` 读真 `.css`，不要 `import` 一个导出模板字符串的 `.ts`。
 *   第一版就是后者：CSS 里的反引号和模板字符串互相干扰，
 *   Node 的 TS 剥离器报 `Expected a semicolon`。
 */
const sharedCss = readFileSync(nodePath.join(HERE, 'preview.css'), 'utf8');
const ownCssPath = nodePath.join(DIR, 'style.css');
const ownCss = existsSync(ownCssPath) ? readFileSync(ownCssPath, 'utf8') : '';
const css = sharedCss + '\n' + ownCss;

/* ── 打包 ── */

const bundle = await rolldown({
	input: ENTRY,
	platform: 'browser',
	jsx: 'react-jsx',
	/*
	 * ⚠ 开发版 React：报错信息完整（生产版会把错误压成 #310 这种码）。
	 *   预览是给人调试组件用的，出错信息比体积重要。
	 */
	define: {
		'process.env.NODE_ENV': '"development"',
	},
	/*
	 * React 必须打进来 —— 产品那边它是 external（宿主提供），预览没宿主。
	 * ⚠ 这里**不要**图省事复用产品配置：那个配置里 react 是 external，
	 *   照抄会产出 `require("react")` 在浏览器里直接炸。
	 */
	external: [],
	resolve: {
		/* `dev/` 下的组件要能 import `src/types.ts` 之类的产品类型。 */
		alias: {
			'@pkg': nodePath.join(PKG, 'src'),
		},
	},
});

const { output } = await bundle.generate({
	format: 'iife',
	name: 'TaskboardPreview',
	sourcemap: false,
});

const js = output
	.filter((one) => one.type === 'chunk')
	.map((one) => one.code)
	.join('\n');

/*
 * ⚠ 产物要内联进 `<script>…</script>` ⇒ **必须**转义两个序列，缺一个都会坏。
 *
 * 1. `</script` → `<\/script`
 * 2. `<!--`    → `<\!--`
 *
 * 只做第 1 条**不够**：HTML 的 script 数据有「escaped / double-escaped」状态，
 * `<!--` 会把 tokenizer 推进 escaped 状态，之后真正的 `</script>` 就不再关标签了。
 *
 * **实测症状**（本仓库第一次跑 markdown 预览时撞上的）：`document.scripts[0]`
 * 的 `textContent` 一直延伸到 `</html>`，页面白屏、控制台**零报错** ——
 * 因为它根本没报错，只是整段脚本都被当成了文本。
 *
 * 两个替换都不改变 JS 语义：`\!` 在字符串和正则里都等价于 `!`，`\/` 等价于 `/`。
 */
const inlineJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

await bundle.close();

/* ── 拼 HTML ── */

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>任务板 3 · 组件预览</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${inlineJs}</script>
</body>
</html>`;

writeFileSync(OUT, html, 'utf8');
console.log('written:', OUT);
console.log('size:', html.length, 'chars');
