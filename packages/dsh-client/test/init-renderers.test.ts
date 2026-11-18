/**
 * `initRenderers()` 与内置渲染器的单测。
 *
 * ## 为什么这个文件只测「注册了什么」
 *
 * 三个内置渲染器是 React 组件（`.tsx`），`node --test` 加载不了 JSX。
 * 但它们**注册进去的是函数引用** —— 注册表这一侧完全可测：
 *
 * | 测什么 | 为什么值得测 |
 * |---|---|
 * | `registeredTypes()` 恰好三个 | 少一个 ⇒ 那类章节全进兜底；多一个 ⇒ 注册表与模板不符 |
 * | 重复调幂等 | `apply()` 会被调多次，第二次崩 = 面板打不开 |
 * | 封盘后再调不炸也不重复注册 | 同上 |
 *
 * ## ⚠ 这个测试**不 import `init-renderers.ts`**
 *
 * 因为那个文件 import 了 `.tsx`（`builtin-renderers.tsx`）⇒ Node 加载不了 JSX。
 *
 * ⇒ 这里**模拟**同样的注册序列（三个 key + 封盘），断言注册表的可观测行为。
 *   真正的 `initRenderers()` 由 `tsc -b` 保证类型正确，由 CDP / 预览页保证运行时正确。
 *
 * ⚠ **这是真实的局限，不是偷懒。** `node --test` 在 v24 里能剥离类型，
 *   但不能转译 JSX。要测包装组件本身，需要 vitest + 转换器 —— 那要引依赖。
 *
 * 将来组件拆干净（`Section` 拆成 Shell + 三种 Content，且 Content 是纯函数）之后，
 * 可以把「按 kind 选组件」那段纯逻辑抽出来再测。现在抽不出来 ——
 * 选组件的逻辑写在 JSX 里。
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
	__resetRegistryForTest,
	isSealed,
	registerRenderer,
	registeredTypes,
	rendererOf,
	sealRegistry,
	type RendererComponent,
} from '../src/render-registry.ts';

/** 假渲染器（真组件是 `.tsx`，Node 加载不了）。 */
function fake(): RendererComponent {
	return () => null;
}

/**
 * 模拟 `initRenderers()`。
 *
 * ⚠ **必须和 `src/init-renderers.ts` 的注册顺序/内容一致** ——
 *   这里多写一个 key，测试绿了而产品是另一个样。
 *
 * 一致性靠 `src/init-renderers.ts` 的 `registerRenderer` 调用每个字都列在这里，
 * 而 `tsc` 保证那边的 import 是对的。**唯一的漂移风险是「那边加了第四个 key」** ——
 * 那时这里的 `deepEqual([...])` 不会红（它是独立的一份）。
 *
 * ⇒ 缓解：`init-renderers.ts` 里那条注释写明「改这里要同步 test」。
 *   （这类重复只能靠人；除非把注册表内容导出成一个常量 —— 见下方 `BUILTIN_TYPES`。）
 */
const BUILTIN_TYPES: readonly string[] = Object.freeze(['text', 'markdown', 'ask']);

/** 模拟 `initRenderers()` 的行为。 */
function simulateInit(): void {
	if (isSealed()) return;
	for (const type of BUILTIN_TYPES) registerRenderer(type, fake());
	sealRegistry();
}

beforeEach(() => {
	__resetRegistryForTest();
});

describe('initRenderers 的效果 —— 注册三个内置渲染器', () => {
	it('⚠ 恰好注册 text / markdown / ask 三个', () => {
		simulateInit();
		assert.deepEqual(registeredTypes(), ['ask', 'markdown', 'text']);
	});

	it('每个都能查到组件', () => {
		simulateInit();
		for (const type of ['text', 'markdown', 'ask']) {
			assert.notEqual(rendererOf(type), undefined, `${type} 应该有渲染器`);
		}
	});

	it('⚠ 注册完就封盘（不允许再偷偷加）', () => {
		simulateInit();
		assert.equal(isSealed(), true);
	});

	it('不认识的 type 仍然查不到（注册表没被污染）', () => {
		simulateInit();
		assert.equal(rendererOf('text2'), undefined);
		assert.equal(rendererOf(''), undefined);
	});
});

describe('⚠ 重复调用 initRenderers —— 幂等', () => {
	it('第二次调用什么都不做（不抛）', () => {
		simulateInit();
		assert.doesNotThrow(() => {
			simulateInit();
		});
	});

	it('第二次调用后注册表**没变**（不是又注册了一遍）', () => {
		simulateInit();
		const first = registeredTypes();
		simulateInit();
		assert.deepEqual(registeredTypes(), first);
	});

	it('第二次调用后 `rendererOf` 拿到的是**同一个**组件引用', () => {
		simulateInit();
		const before = rendererOf('ask');
		simulateInit();
		assert.equal(rendererOf('ask'), before);
	});

	it('调很多次也不炸（模拟面板反复折叠/展开）', () => {
		assert.doesNotThrow(() => {
			for (let i = 0; i < 10; i += 1) simulateInit();
		});
		assert.deepEqual(registeredTypes(), ['ask', 'markdown', 'text']);
	});
});

describe('⚠ 幂等的判据是「已封盘」', () => {
	/*
	 * 这条是设计的关键：`isSealed()` 同时表达两件事 ——
	 * 「注册完了」和「别再注册了」。
	 *
	 * 如果改成「用一个单独的 initialized 布尔量」，那就多了一个可能与
	 * isSealed 不一致的状态（比如有人手动 sealRegistry 但没初始化）。
	 */
	it('已封盘但没有渲染器 ⇒ init 认为「已初始化过」⇒ 什么都不做', () => {
		/* 模拟「有人手动封了盘」这个非常规状态。 */
		sealRegistry();
		simulateInit();
		/* ⚠ 注册表仍然是空的 —— 这是幂等判据的**已知副作用**，
		 *   正常路径下不会出现（封盘只由 simulateInit 造成）。 */
		assert.deepEqual(registeredTypes(), []);
	});

	it('封盘后调 init 不抛（`apply()` 里不能有会炸的路径）', () => {
		sealRegistry();
		assert.doesNotThrow(() => {
			simulateInit();
		});
	});
});
