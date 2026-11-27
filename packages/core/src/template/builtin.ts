/**
 * 内置模板 —— **随 `@taskboard/core` 包发布的配置**，启动时加载一次。
 *
 * ## 用户裁决（`2026-11-23`，逐字）
 *
 * > 「模板的读取不是 io。而是配置。跟随包的。只在包里面。换句话说这些 yaml 字符串
 * >   相当于启动时就要加载。因为他们还有 json 到 string 的文本渲染器和 ui 渲染器。
 * >   不是一个 yaml 结束就可以了的。所谓的留接口是留注册接口。
 * >   给别人以包的形式接入。不是以文本 yaml 的形式接入。」
 *
 * > 「2 的跟随包，只在包里。意思是。插件肯定能拿到插件路径。然后这个分发出去的
 * >   包里的 yaml，在包里的相对路径是常量。所以用这个路径加载包里的 yaml。
 * >   也就是说，外来的包原则上不该挤进去这个放配置的地方。」
 *
 * ⇒ 五条落成代码：
 *
 * 1. **不是「持久化 IO」那一类** —— 它是包自带的配置，和磁盘上的用户数据无关
 * 2. **只在包里** —— YAML 在 `packages/core/templates/`，随包发布（`files` 带 `templates`）
 * 3. **启动时加载一次** —— 第一次 `builtinTemplates()` 调用时读完并缓存，之后全在内存
 *    （首次调用发生在 `createTaskboard()` 的装配里；不在模块求值时就碰磁盘，
 *    否则与 `package.json` 的 `"sideEffects": false` 冲突，打包器可能误裁）
 * 4. **包自己的路径** —— 用本文件的 `import.meta.url` 反推包根。
 *    ⚠ **不是**由 `@taskboard/dsh` 替 core 解析（那会让 dsh 知道 core 的目录布局，
 *    依赖方向反了 —— 上一版就是这么错的）。
 * 5. **外部不许挤进来** —— 没有 `loadDirectory(dir)`、没有 `config.templateDir`。
 *    别人要加模板，走 `TemplateRegistry.register(TemplateDef)`（以**包**的形式接入）。
 *
 * ## 为什么是「读一次」而不是「构建时打成 .ts 常量」
 *
 * 曾考虑过构建时把 YAML 生成 `.ts`（连启动时的文件读都省掉）。否决理由：
 *   · YAML 里有反引号（`demo` / `lowLevel` / `verify`），生成 TS 字符串要转义，
 *     每次构建都是一次「转义对不对」的赌博；
 *   · 生成的文件会和源 YAML 双份存在，改一处不同步另一处 —— 本仓已经踩过这类漂移；
 *   · 收益只是省掉 18 次 `readFileSync`（实测 < 2ms），不值。
 *
 * ⇒ **YAML 文件是唯一真值，本模块只负责「按包内常量路径读一次」。**
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import { fromRaw } from './loader.ts';
import type { TemplateDef } from './types.ts';

/**
 * 模板目录在包内的**相对路径常量**。
 *
 * 它相对的是**包根**（`packages/core/`），不是本文件。
 */
const TEMPLATES_SUBDIR = 'templates';

/**
 * 从本模块的位置反推包根。
 *
 * ## 为什么 `..` 是两级
 *
 * | 运行时 | 本文件真实路径 | `../..` |
 * |---|---|---|
 * | 源码（`node --test` 直接跑 `.ts`） | `packages/core/src/template/builtin.ts` | `packages/core` ✅ |
 * | 产物（`tsc -b` 后） | `packages/core/lib/template/builtin.js` | `packages/core` ✅ |
 *
 * 两者深度相同（`<pkg>/<src|lib>/template/`）⇒ 同一句 `../..` 两边都对。
 */

/** 包根目录（绝对路径）。 */
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * 模板目录（绝对路径）。
 *
 * **不导出** —— 外部不该知道 core 把模板放哪。要加模板请走 `TemplateRegistry.register`。
 */
const TEMPLATES_DIR = join(PACKAGE_ROOT, TEMPLATES_SUBDIR);

/** 一个内置模板加载失败的原因。 */
export interface BuiltinTemplateError {
	/** 出问题的文件（绝对路径，只为报错可读）。 */
	readonly file: string;
	/** 人话原因。 */
	readonly message: string;
}

/** 一次性加载的结果。 */
export interface BuiltinTemplates {
	/** 加载成功的模板（顺序 = 文件名排序，稳定 ⇒ `list()` 可复现）。 */
	readonly templates: readonly TemplateDef[];
	/** 加载失败的（一个坏文件不影响其它 —— 用户：「如果他出错了，core 可以继续开」）。 */
	readonly errors: readonly BuiltinTemplateError[];
}

/**
 * 同步读一遍包内的 `templates/`。
 *
 * 逐文件容错：坏文件记进 `errors`，继续下一个。
 *
 * @returns 模板 + 错误
 */
function readBuiltinTemplates(): BuiltinTemplates {
	const templates: TemplateDef[] = [];
	const errors: BuiltinTemplateError[] = [];

	let names: string[];
	try {
		names = readdirSync(TEMPLATES_DIR);
	} catch (error) {
		/*
		 * 目录都读不到 ⇒ 整个模板体系为空。
		 * 这是**装配错误**（包不完整），但按用户的「core 可以继续开」仍然不抛：
		 * 记一条错误，UI 那边会看到空模板清单。
		 */
		return {
			templates,
			errors: [
				{
					file: TEMPLATES_DIR,
					message: `读不了模板目录：${error instanceof Error ? error.message : String(error)}`,
				},
			],
		};
	}

	/* 排序后再读：注册顺序稳定 ⇒ `list()` / `summaries()` 的顺序可复现。 */
	for (const name of [...names].sort()) {
		const ext = extname(name).toLowerCase();
		if (ext !== '.yaml' && ext !== '.yml') continue;

		const file = join(TEMPLATES_DIR, name);
		const ref = name.slice(0, -ext.length);

		let text: string;
		try {
			text = readFileSync(file, 'utf8');
		} catch (error) {
			errors.push({
				file,
				message: `读不了文件：${error instanceof Error ? error.message : String(error)}`,
			});
			continue;
		}

		let parsed: unknown;
		try {
			parsed = parseYaml(text);
		} catch (error) {
			errors.push({
				file,
				message: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
			});
			continue;
		}

		const result = fromRaw(ref, parsed);
		if ('error' in result) {
			errors.push({ file, message: result.error });
			continue;
		}
		templates.push(result.template);
	}

	return { templates, errors };
}

/**
 * 惰性缓存：**第一次调用时读盘**，之后全在内存。
 *
 * 为什么不在模块求值时就读：`package.json` 声明了 `"sideEffects": false`，
 * 模块求值即读盘会让打包器把它当「可裁掉 / 可重排」的副作用（顺序问题），
 * 而「加载一次」的语义用首次调用 memo 同样成立 —— 首次调用发生在
 * `createTaskboard()` 的装配里，之后行为完全等价。
 */
let cached: BuiltinTemplates | undefined;

/** 取（或首次读盘并缓存）内置模板加载结果。 */
function builtin(): BuiltinTemplates {
	cached ??= readBuiltinTemplates();
	return cached;
}

/**
 * 取内置模板。
 *
 * @returns 加载成功的模板（`readonly`，可直接 for 循环注册）
 */
export function builtinTemplates(): readonly TemplateDef[] {
	return builtin().templates;
}

/**
 * 取内置模板的加载错误。
 *
 * @returns 一个坏文件一条；正常情况下为空
 */
export function builtinTemplateErrors(): readonly BuiltinTemplateError[] {
	return builtin().errors;
}
