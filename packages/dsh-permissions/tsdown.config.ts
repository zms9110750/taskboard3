import { defineConfig } from 'tsdown';

/**
 * `lib/client.js` 的构建配置 —— 形状与 `@taskboard/dsh-client` 的 tsdown 完全一致
 * （浏览器半 = `window.__ModuleLoader__.load` 的 CJS 工厂；Host 半 = Node ESM）。
 *
 * ## 本包唯一的 workspace 依赖：`@taskboard/core`
 *
 * 被搬进来的 pure / renderers 模块只依赖 `react`（宿主提供，neverBundle）
 * 和 `@taskboard/core/tool-graph`（**纯逻辑、零依赖**，issue #66 把组图
 * 收敛成一份实现后从 core 引用）。
 *
 * ⚠ **必须 `alwaysBundle`**：tsdown 默认把 workspace 依赖当 external，
 *   留 external 时浏览器里会 `require("@taskboard/core/tool-graph")` ——
 *   宿主冻结模块表里没有它，打开「工具权限」页才炸。
 *
 * ⚠ 走**子路径**而不是包根：包根的 `index.ts` 会拉进 `yaml` / `node:fs`
 *   （模板加载），打进浏览器包既没必要也过不了 `platform: 'browser'`。
 */
const browserConfig = defineConfig({
	entry: { client: 'src/client.tsx' },
	outDir: 'lib',
	outExtensions: () => ({ js: '.js' }),
	format: 'cjs',
	platform: 'browser',
	target: 'es2022',
	sourcemap: true,
	clean: false,
	dts: false,
	deps: {
		neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
		/**
		 * 组图纯逻辑必须打进产物（宿主模块表里没有 workspace 包）。
		 * 同时列子路径：按包名匹配 external 的实现不一定认子路径。
		 */
		alwaysBundle: ['@taskboard/core', '@taskboard/core/tool-graph'],
	},
	banner: [
		"window.__ModuleLoader__.load({",
		"  id: '@taskboard/dsh-permissions',",
		'  factory: (require) => {',
		'    var module = { exports: {} };',
		'    var exports = module.exports;',
	].join('\n'),
	footer: ['    return module.exports;', '  },', '});'].join('\n'),
});

const hostConfig = defineConfig({
	entry: { index: 'src/index.ts' },
	outDir: 'lib',
	outExtensions: () => ({ js: '.js' }),
	format: 'esm',
	platform: 'node',
	target: 'es2022',
	sourcemap: true,
	clean: false,
	dts: false,
});

export default [browserConfig, hostConfig];
