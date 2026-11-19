/**
 * 科技树 **SSR 断言**的运行器 —— 本机没有可用的浏览器（headless Edge 在沙箱里起不来，
 * mojo IPC 被拒，已多次验证），所以验收不靠 CDP，靠「把真组件渲染成 HTML 再断言」。
 *
 * ## 为什么要先打包再跑
 *
 * `ssr.tsx` 里有 JSX，Node 的运行时类型剥离**不处理 JSX** ⇒ 不能直接
 * `node ssr.tsx`。所以这里：
 *
 * ```
 * ① rolldown 把 ssr.tsx（连同 React / 组件 / 纯函数）打成**一个 ESM 文件**
 * ② 写进临时目录
 * ③ 动态 import 它 —— 断言在模块顶层跑，失败置 process.exitCode = 1
 * ④ 删临时目录
 * ```
 *
 * 好处：**不依赖构建产物、不依赖浏览器、不依赖 cwd**（相对路径都从本文件解析）。
 *
 * ## 用法
 *
 * ```powershell
 * node dev/preview/techtree/verify.mjs
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

/* ── ① 打包（react / react-dom / 组件 / 纯函数全部打进来，运行时不需要 node_modules） ── */
const bundle = await rolldown({
	input: join(HERE, 'ssr.tsx'),
	platform: 'node',
	/*
	 * ⚠ 不传 `define` / `jsx`：这个 rolldown 版本的输入选项里没有它们
	 *   （传了会打一行 "Invalid input options" 警告，而且不生效）。
	 *   `.tsx` 的 JSX 由 rolldown 内建的 oxc 转换处理；React 的
	 *   development/production 分支由 Node 的 `process.env.NODE_ENV` 决定
	 *   （没设就是 development，报错信息完整）。
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
const dir = mkdtempSync(join(tmpdir(), 'tb3-techtree-ssr-'));
const file = join(dir, 'check.mjs');
writeFileSync(file, code, 'utf8');

try {
	await import(pathToFileURL(file).href);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
