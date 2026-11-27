import { defineConfig } from 'tsdown';

/**
 * `lib/client.js` 的构建配置 —— 形状与 `@taskboard/dsh-client` 的 tsdown 完全一致
 * （浏览器半 = `window.__ModuleLoader__.load` 的 CJS 工厂；Host 半 = Node ESM）。
 *
 * ## 本包没有 workspace 依赖
 *
 * 被搬进来的 pure / renderers 模块只依赖 `react`（宿主提供，neverBundle），
 * 不 import `@taskboard/protocol`（工具清单的词表来自 `/api/tools` 的返回，不是本地词表）。
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
