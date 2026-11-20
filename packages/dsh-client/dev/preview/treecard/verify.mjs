/**
 * `TreeCard` **SSR 断言**的运行器 —— 本机没有可用的浏览器（headless Edge 在沙箱里
 * 起不来，mojo IPC 被拒，已多次验证），所以验收不靠 CDP，靠「渲染成 HTML 再断言」。
 *
 * ## 为什么要先打包再跑
 *
 * `ssr.tsx` 里有 JSX，Node 的运行时类型剥离**不处理 JSX** ⇒ 不能直接 `node ssr.tsx`。
 * 所以这里用 rolldown 把它（连同 React / 组件 / 纯函数）打成一个 ESM 临时文件再 import。
 *
 * ## 用法
 *
 * ```powershell
 * node dev/preview/treecard/verify.mjs
 * ```
 *
 * 退出码 0 = 全部断言通过；1 = 有失败（失败清单在最后）。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { rolldown } from 'rolldown';

const HERE = import.meta.dirname;

/* ── ① 打包（react / react-dom / 组件 / 纯函数全部打进来） ── */
const bundle = await rolldown({
	input: join(HERE, 'ssr.tsx'),
	platform: 'node',
	/*
	 * ⚠ 不传 `define` / `jsx`：这个 rolldown 版本的输入选项里没有它们
	 *   （传了会打 "Invalid input options" 警告且不生效）。
	 *   `.tsx` 的 JSX 由 rolldown 内建的 oxc 转换处理。
	 */
	external: [],
});

const { output } = await bundle.generate({
	format: 'esm',
	sourcemap: false,
});

const code = output
	.filter((one) => one.type === 'chunk')
	.map((one) => one.code)
	.join('\n');

await bundle.close();

/* ── ② 写临时文件 → ③ import → ④ 清理 ── */
const dir = mkdtempSync(join(tmpdir(), 'tb3-treecard-ssr-'));
const file = join(dir, 'check.mjs');
writeFileSync(file, code, 'utf8');

try {
	await import(pathToFileURL(file).href);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
