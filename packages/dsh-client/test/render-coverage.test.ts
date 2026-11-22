/**
 * **第 7 步的核心测试**：模板需要的 action 必须都有 UI 渲染器。
 *
 * ## 这个文件解决的结构难题
 *
 * 「模板需要什么」（`core.requiredActions()`，Host 侧）和
 * 「UI 能画什么」（`registeredTypes()`，浏览器侧）分在两边，差集在哪里算？
 *
 * ### 四个候选方案，以及为什么排除了三个
 *
 * | 方案 | 为什么不用 |
 * |---|---|
 * | A. 测试里调真的 `initRenderers()` | 它 import 了 `.tsx`，`node --test` **不能转译 JSX**（上一轮踩过） |
 * | C. `core` 和 `dsh-client` 共享一个常量 | 那会把 ① 的检查变成**恒真** —— 两份清单本来就该独立（设计文档 8.2 节） |
 * | D. 起 Host 走 HTTP | 最真实但重；那属于第 8 步的 e2e，不该是唯一的防线 |
 * | **B. 两边各自断言** ✅ | 轻，且两份真值保持独立 |
 *
 * ### ⚠ B 的洞，以及这里怎么堵上
 *
 * B 的洞：**如果期望清单是手写字面量，那「模板加了一个 action、两边都加了字面量」
 * 时测试照样绿，但实际没注册。**
 *
 * 堵法：**测试里不许出现手写字面量。** 两份清单都从真实代码读：
 *
 * ```
 * 需要什么   ← core.requiredActions()      ← 真的 createTaskboard() + 真的加载 18 个模板 YAML
 * 能画什么   ← BUILTIN_TYPES               ← initRenderers() 用的**同一个常量**
 * ```
 *
 * 于是「清单和实现对不上」的三种情形各自会红：
 *
 * | 情形 | 谁红 |
 * |---|---|
 * | `BUILTIN_TYPES` 加了第四个 type，但没写组件 | **`tsc` 红**（`Record<BuiltinType, …>` 缺键） |
 * | `BUILTIN_TYPES` 加了第四个 type 且有组件，但没有模板用它 | 测试绿（**这是对的** —— 多一个渲染器不是 bug） |
 * | **模板开始用一个没注册的 action** | **本测试红**（`requiredActions()` 有它、`BUILTIN_TYPES` 没有） |
 * | 组件写了但忘了进 `BUILTIN_TYPES` | **`tsc` 红**（键不在 `BuiltinType` 联合里） |
 *
 * ⇒ 手写字面量这个洞被彻底消掉：**测试里没有任何一处手抄的 type 清单。**
 *
 * ## 为什么能调 `createTaskboard()`
 *
 * `@taskboard/core` 是 devDependency（第 6 步加的）。测试跑在 **Node** 里，
 * 能加载 `node:sqlite`。产品代码不 import core（浏览器里会炸），这条测试不改变那个事实。
 *
 * ⚠ 跑之前必须先 `tsc -b packages/core`（跨包走包名 → `lib/` 产物）。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { createTaskboard, missingRenderers, type Taskboard } from '@taskboard/core';

import {
	__resetRegistryForTest,
	registerRenderer,
	registeredTypes,
	type RendererComponent,
} from '../src/render-registry.ts';
import { BUILTIN_TYPES } from '../src/renderers/builtin-types.ts';

/* ══════════════════════════════════════════════════════════
   夹具：真的 core + 真的模板
   ══════════════════════════════════════════════════════════ */

/** 数据目录（临时，测试后删）。 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'tb-render-check-'));

/**
 * 造一个**加载了全部真实模板**的 Taskboard。
 *
 * ## 模板不需要这里手动加载（`2026-11-23` 改）
 *
 * 用户：
 * > 「模板的读取不是 io。而是配置。跟随包的。只在包里面。」
 *
 * ⇒ `createTaskboard()` 内部已经注册好包内自带的 18 个模板
 *   （见 `@taskboard/core` 的 `template/builtin.ts`）。
 *
 * `dataDir` 用临时目录 —— 不碰任何真实数据。
 */
function realTaskboard(): Taskboard {
	return createTaskboard({ dataDir: DATA_DIR });
}

/** 假渲染器（真组件是 `.tsx`，Node 加载不了）。 */
function fake(): RendererComponent {
	return () => null;
}

/**
 * 模拟 `initRenderers()`。
 *
 * ⚠ **遍历 `BUILTIN_TYPES`**，不是手写三行 —— 和 `initRenderers()` 同一个数据源。
 *   手写的话「常量里有第四个但这里漏了」又能发生。
 */
function simulateInit(): void {
	__resetRegistryForTest();
	for (const type of BUILTIN_TYPES) registerRenderer(type, fake());
}

after(() => {
	/*
	 * ⚠ SQLite 连接没关时删目录会 `EPERM`（Windows 上文件被占用）。
	 * 这是**测试清理**的问题，不是被测代码的问题 —— 但不能让它把测试打成失败。
	 *
	 * `rmSync` 的 `force: true` 只忽略「不存在」，不忽略「被占用」。
	 * ⇒ try/catch 吞掉：临时目录留给系统清理，测试结果不受影响。
	 */
	try {
		rmSync(DATA_DIR, { recursive: true, force: true });
	} catch {
		/* 留个临时目录无害（在 os.tmpdir() 下）。 */
	}
});

/* ══════════════════════════════════════════════════════════
   ⚠ 核心差集断言
   ══════════════════════════════════════════════════════════ */

describe('⚠ 模板需要的 action 全部有渲染器（差集必须为空）', () => {
	it('真实模板清单 vs 真实注册清单 ⇒ 差集为空', () => {
		const taskboard = realTaskboard();
		const required = taskboard.requiredActions();
		simulateInit();
		const registered = registeredTypes();

		const missing = missingRenderers(required, registered);

		assert.deepEqual(
			missing,
			[],
			`模板需要 ${JSON.stringify(required)}，UI 注册了 ${JSON.stringify(registered)}，` +
				`缺 ${JSON.stringify(missing)}。` +
				'加一个 action 必须同时在 packages/dsh-client/src/renderers/builtin-types.ts 里登记。',
		);
	});

	it('⚠ 两边都非空（防空跑：两个都是 [] 时差集自然也空）', () => {
		/*
		 * 这条防的是「模板没加载成功」这种假绿：
		 * `requiredActions()` 返回 `[]`、`registeredTypes()` 也是 `[]` ⇒
		 * 上一条断言「差集为空」照样通过，但它什么也没验证。
		 */
		const taskboard = realTaskboard();
		assert.equal(taskboard.listTemplates().length > 0, true, '模板没加载成功，测试是假绿');
		assert.equal(taskboard.requiredActions().length > 0, true);
		assert.equal(BUILTIN_TYPES.length > 0, true);
	});

	it('注册清单 = BUILTIN_TYPES 的字母序（幂等模拟的副作用不能多也不能少）', () => {
		simulateInit();
		assert.deepEqual(registeredTypes(), [...BUILTIN_TYPES].sort());
	});

	it('⚠ 反向也成立：UI 注册的每个 type 都有模板在用（多注册不是错，但要可见）', () => {
		/*
		 * 多注册一个没人用的渲染器**不是 bug** —— 所以这条不断言「空集」，
		 * 而是断言「多出来的东西能被列出来」，让 review 时看得到。
		 *
		 * 现在应该是空的（三个内置 action 都有模板用）。
		 */
		const taskboard = realTaskboard();
		const required = new Set(taskboard.requiredActions());
		const extra = BUILTIN_TYPES.filter((one) => !required.has(one));
		assert.deepEqual(
			extra,
			[],
			`这些 type 注册了渲染器但没有模板用：${JSON.stringify(extra)}。不是 bug，但值得知道。`,
		);
	});
});

/* ══════════════════════════════════════════════════════════
   ⚠ 变红验证：故意缺一个必须被抓到
   ══════════════════════════════════════════════════════════ */

describe('⚠ 差集断言真的能抓到缺失（不是恒真的装饰）', () => {
	it('少注册一个 ⇒ missing 里有它', () => {
		/*
		 * 这条**故意制造缺失**，验证上一条断言的有效性。
		 *
		 * ⚠ 这不是「测两次同一个东西」：上一条断言「真实配置下差集为空」，
		 *   这一条断言「配错时差集非空」。少了任何一条，另一条都可能是恒真的装饰。
		 */
		const taskboard = realTaskboard();
		const required = taskboard.requiredActions();

		/* 故意只注册前 N-1 个。 */
		__resetRegistryForTest();
		const dropped = BUILTIN_TYPES[BUILTIN_TYPES.length - 1] as string;
		for (const type of BUILTIN_TYPES) {
			if (type !== dropped) registerRenderer(type, fake());
		}

		const missing = missingRenderers(required, registeredTypes());
		assert.deepEqual(missing, [dropped]);
	});

	it('全都不注册 ⇒ missing 等于全部 required', () => {
		const taskboard = realTaskboard();
		const required = taskboard.requiredActions();
		__resetRegistryForTest();
		assert.deepEqual(missingRenderers(required, []), required);
	});

	it('多注册不存在的 type ⇒ 不影响差集（差集只看 required 里缺的）', () => {
		const taskboard = realTaskboard();
		const required = taskboard.requiredActions();
		simulateInit();
		registerRenderer('nobody-uses-this', fake());
		assert.deepEqual(missingRenderers(required, registeredTypes()), []);
	});
});
