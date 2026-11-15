/**
 * 把组件预览打成**一个自包含 HTML** —— 双击即可打开，不需要服务器。
 *
 * ## 为什么用 rolldown 而不是 tsdown
 *
 * `tsdown` 是**产品**的打包器（产出 `window.__ModuleLoader__.load({...})`，
 * react 留 external 由宿主提供）。预览页是**完全相反的需求**：
 * react 必须打进来，产物必须是普通 `<script>`。
 *
 * 两个需求用同一套配置会互相污染（改预览配置动到产品产物 = 灾难）。
 * ⇒ 预览单独用一个最小 rolldown 配置。
 *
 * ## 产出
 *
 * `preview/out/<组件名>.html` —— 单文件，含 CSS + JS + 全部依赖。
 *
 * 用法：
 * ```powershell
 * node packages/dsh-client/scripts/build-preview.mjs
 * ```
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { rolldown } from 'rolldown';

const HERE = import.meta.dirname;
const PKG = nodePath.join(HERE, '..');
const OUT = nodePath.join(PKG, 'preview');
const ENTRY = nodePath.join(PKG, 'src', 'preview', 'main.tsx');
const CSS = nodePath.join(PKG, 'src', 'preview', 'preview.css');

mkdirSync(OUT, { recursive: true });

/* ── 1. 取预览页的 CSS ── */

/*
 * ⚠ 用 `readFileSync` 读真 `.css`，不要 `import` 一个导出模板字符串的 `.ts`。
 *   第一版就是后者：CSS 里的反引号和模板字符串互相干扰，
 *   Node 的 TS 剥离器报 `Expected a semicolon`。
 */
const css = readFileSync(CSS, 'utf8');

/* ── 2. 打包 ── */

const bundle = await rolldown({
	input: ENTRY,
	platform: 'browser',
	/* 预览页要能在普通浏览器里跑 ⇒ 尽量新但别太激进（Edge 稳定版）。 */
	target: 'es2022',
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

await bundle.close();

/* ── 3. 拼 HTML ── */

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>任务板 3 · 组件预览 · FilterBox</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>`;

const target = nodePath.join(OUT, 'filter-box.html');
writeFileSync(target, html, 'utf8');
console.log('written:', target);
console.log('size:', html.length, 'chars');
