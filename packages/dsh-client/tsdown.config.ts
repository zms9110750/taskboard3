import { defineConfig } from 'tsdown';

/**
 * `lib/client.js` 的构建配置。
 *
 * ## 产出形状必须与 DSH 的加载器一致
 *
 * 浏览器半由宿主用 `window.__ModuleLoader__.load({ id, factory })` 加载。
 * 参考产品包的产物（`dsh-client-ui-sidebar-files/lib/client.js`）：
 *
 * ```js
 * window.__ModuleLoader__.load({id:`…`,factory:require=>{var module={exports:{}};
 *   var exports=module.exports; … return module.exports }})
 * ```
 *
 * 关键点：`factory` 收到一个**同步的 `require`**（只认宿主冻结模块表里的键），
 * 且返回 CommonJS 的 `module.exports`。
 *
 * ⇒ 用 `cjs` 格式（外部模块会编译成 `require("react")`），
 *   banner/footer 把整段包进 `factory` 并返回 `module.exports`。
 *   **不要用 `iife`** —— 它把外部模块编译成读全局变量（`window.react`），
 *   而宿主只提供 `require`。
 *
 * ## 什么必须打进来、什么必须留 external
 *
 * | 模块 | 处理 | 理由 |
 * |---|---|---|
 * | `react` / `react/jsx-runtime` | **external** | 宿主冻结模块表提供；打进来会有两份 React，hooks 直接崩 |
 * | `@taskboard/protocol` | **打进产物** | 它是纯 TS 词表，不在宿主模块表里。留 external 会 `require` 失败 |
 *
 * ⚠ tsdown 默认会把 workspace 依赖当 external。必须显式 `alwaysBundle`。
 */
export default defineConfig({
	entry: { client: 'src/client.tsx' },
	outDir: 'lib',
	outExtensions: () => ({ js: '.js' }),
	format: 'cjs',
	platform: 'browser',
	target: 'es2022',
	sourcemap: true,
	clean: false,
	dts: false,

	/**
	 * 依赖处理（tsdown 0.23 的新写法；旧的 `external` 已废弃）。
	 *
	 * `neverBundle` = 不进产物（宿主提供）。
	 * `alwaysBundle` = 强制打进产物（即使是 workspace 依赖）。
	 */
	deps: {
		neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
		alwaysBundle: ['@taskboard/protocol'],
	},

	/**
	 * 把 CJS 产物包成宿主要求的 `__ModuleLoader__.load({...})` 形状。
	 *
	 * `module` / `exports` 在 banner 里手工造 —— CJS 产物本身假设它们存在。
	 */
	banner: [
		"window.__ModuleLoader__.load({",
		"  id: '@taskboard/dsh-client',",
		'  factory: (require) => {',
		'    var module = { exports: {} };',
		'    var exports = module.exports;',
	].join('\n'),
	footer: ['    return module.exports;', '  },', '});'].join('\n'),
});
