import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsdown';

/*
 * 模块 id —— **从 `package.json` 的 `name` 读**，不在构建配置里手抄。
 *
 * 原来 banner 里硬编码 `'@taskboard/dsh-client'`，和 `package.json` 的
 * `name`、`client.tsx` 的 `TAB_ID` 是三份重复；改包名时漏改 banner 不会
 * 报错，只会在宿主加载器里报「模块 id 对不上」。
 * ⇒ 这里只留一份真值（package.json）；`TAB_ID` 是实现身份，仍是显式常量。
 */
const packageName = (
	JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
		readonly name: string;
	}
).name;

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

	/**
	 * 依赖处理（tsdown 0.23 的新写法；旧的 `external` 已废弃）。
	 *
	 * `neverBundle` = 不进产物（宿主提供）。
	 * `alwaysBundle` = 强制打进产物（即使是 workspace 依赖）。
	 */
	deps: {
		neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
		/**
		 * `marked` **必须打进来**：宿主冻结模块表里没有它，留 external 会
		 * 在浏览器里 `require("marked")` 直接抛 —— 而且是**运行到 markdown 才炸**，
		 * 面板打开时不报错。所以它和 `@taskboard/protocol` 一样属于 `alwaysBundle`。
		 */
		alwaysBundle: ['@taskboard/protocol', 'marked'],
	},

	/**
	 * 把 CJS 产物包成宿主要求的 `__ModuleLoader__.load({...})` 形状。
	 *
	 * `module` / `exports` 在 banner 里手工造 —— CJS 产物本身假设它们存在。
	 */
	banner: [
		'window.__ModuleLoader__.load({',
		`  id: '${packageName}',`,
		'  factory: (require) => {',
		'    var module = { exports: {} };',
		'    var exports = module.exports;',
	].join('\n'),
	footer: ['    return module.exports;', '  },', '});'].join('\n'),
});

/**
 * ## Host 半的入口（第二个构建）
 *
 * `package.json` 的 `main` 指向 `./lib/index.js`，`cordis.patch.yml` 又让
 * DSH 加载本包 —— **这个文件必须存在**，否则 Host 侧 loader 加载那一行时
 * 会找不到入口，整个 bundle 装不上。
 *
 * ## 为什么不能用上面那个配置顺带产出
 *
 * 上面那份的 `banner` / `footer` 把产物包进 `window.__ModuleLoader__.load`，
 * 那是**浏览器半**的加载协议。Host 半是 Node 侧 ESM 模块，被 DSH 的
 * loader 直接 `import` —— 套上那一层会立刻在 Node 里炸（`window` 不存在）。
 *
 * ## 为什么 tsc 不产出它
 *
 * `tsconfig.json` 开了 `emitDeclarationOnly: true`（tsc 只出 `.d.ts`，
 * JS 交给 tsdown）。所以 `lib/index.js` 只能由 tsdown 出 ⇒ 就是这里。
 *
 * ⚠ 顺序要求：这一项**必须在浏览器半之后**（同一个 `outDir`，
 *   `clean: false` 不会互相删；反过来的话浏览器半的 `clean` 行为
 *   可能把刚写好的 `index.js` 带走）。
 */
export const hostConfig = defineConfig({
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

/**
 * ## 折叠组件的共享产物（issue #56）
 *
 * 权限链（`@taskboard/dsh-permissions`）要复用 `FoldPill` / `FoldRect`，
 * 而浏览器半的 `lib/client.js` 是宿主的 IIFE 加载协议，**不能被别的包 import**。
 * ⇒ 单独出一个纯 ESM 的 `lib/fold-pill.js`：
 *
 * - 不带 `__ModuleLoader__` banner（它是给 bundler 吃的模块，不是给宿主加载的插件）；
 * - `react` / `react/jsx-runtime` 仍 external（消费方的 tsdown 照样 external，
 *   最终由宿主提供，绝不会出现两份 React）；
 * - 类型不走这里（tsdown 的 `dts: false` 是既有约定），而是 `tsc -b` 产出的
 *   `lib/renderers/fold-pill-public.d.ts`，见 package.json 的 exports。
 */
export const foldPillConfig = defineConfig({
	entry: { 'fold-pill': 'src/renderers/fold-pill-public.ts' },
	outDir: 'lib',
	outExtensions: () => ({ js: '.js' }),
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	sourcemap: true,
	clean: false,
	dts: false,
	deps: {
		neverBundle: ['react', 'react/jsx-runtime'],
	},
});

/** 三个构建：浏览器半（ModuleLoader CJS）+ Host 半（Node ESM）+ 折叠组件共享产物。 */
export default [browserConfig, hostConfig, foldPillConfig];
