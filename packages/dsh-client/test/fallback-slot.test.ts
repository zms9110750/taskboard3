/**
 * 降级渲染器的**槽位**语义 —— 「查不到渲染器时画什么」也是一个渲染器。
 *
 * 用户 2026-11-22：
 * > 「分发器写了逻辑。但是找不到注册的渲染器，降级的降级渲染器应该是组件。
 * >   UI 和 tool 的两边都应该如此。」
 *
 * ⇒ 降级走注册表（`setFallbackRenderer` / `fallbackRenderer`），
 *   和普通渲染器同等待遇：能设一次、能被替换、封盘后不能改。
 *
 * ## 和 `registerRenderer` 的差别
 *
 * | | `registerRenderer` | `setFallbackRenderer` |
 * |---|---|---|
 * | 键 | `$type` 字符串 | **没有键**（全局只有一个槽位）|
 * | 重复 | 抛「重复注册」 | 抛「已经设过了」 |
 * | 封盘后 | 抛 | 抛 |
 *
 * 为什么只有一个槽位而不是 `registerRenderer('__fallback__', …)`：
 * 用 `$type` = `'__fallback__'` 会**污染 `$type` 命名空间** ——
 * 第三方注册一个真的叫 `__fallback__` 的 action 就撞了。
 * 槽位是另一种东西，给它自己的 API。
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
	__resetRegistryForTest,
	fallbackRenderer,
	isSealed,
	registerRenderer,
	rendererOf,
	sealRegistry,
	setFallbackRenderer,
	type RendererComponent,
} from '../src/render-registry.ts';

/** 造一个假渲染器。 */
function fake(): RendererComponent {
	return () => null;
}

beforeEach(() => {
	__resetRegistryForTest();
});

describe('fallbackRenderer —— 默认没有', () => {
	it('⚠ 刚清空时是 undefined（不是"猜到某个组件"）', () => {
		/*
		 * 为什么必须是 undefined 而不是"默认给一个"：
		 * 降级块画什么取决于哪个插件在用（UI 有自己的 ⚠ 块，
		 * tool 侧根本没有 UI）。注册表不该替调用方决定。
		 */
		assert.equal(fallbackRenderer(), undefined);
	});
});

describe('setFallbackRenderer —— 设一次', () => {
	it('设完能查回来（同一个函数引用）', () => {
		const Comp = fake();
		setFallbackRenderer(Comp);
		assert.equal(fallbackRenderer(), Comp);
	});

	it('⚠ 重复设置必须抛（两个模块抢同一槽位 = 不可预测）', () => {
		setFallbackRenderer(fake());
		assert.throws(
			() => {
				setFallbackRenderer(fake());
			},
			/已经设过了|重复/u,
		);
	});

	it('⚠ 抛错后原来的还在（没被覆盖）', () => {
		const First = fake();
		setFallbackRenderer(First);
		assert.throws(() => {
			setFallbackRenderer(fake());
		});
		assert.equal(fallbackRenderer(), First, '第一次设的那个必须还在');
	});

	it('⚠ 封盘后设置必须抛', () => {
		sealRegistry();
		assert.equal(isSealed(), true);
		assert.throws(
			() => {
				setFallbackRenderer(fake());
			},
			/封盘/u,
		);
		assert.equal(fallbackRenderer(), undefined);
	});

	it('封盘前设过、封盘后仍能查到（封盘不擦除）', () => {
		const Comp = fake();
		setFallbackRenderer(Comp);
		sealRegistry();
		assert.equal(fallbackRenderer(), Comp);
	});
});

describe('fallback 和普通渲染器互不干扰', () => {
	it('设 fallback 不影响 registeredTypes / rendererOf', () => {
		const Text = fake();
		registerRenderer('text', Text);
		setFallbackRenderer(fake());

		assert.equal(rendererOf('text'), Text, '普通渲染器不受影响');
		assert.equal(rendererOf('__fallback__'), undefined, '槽位不占用 $type 命名空间');
	});

	it('⚠ 特殊 type 名不撞槽位（防"用 __fallback__ 当键"的写法回潮）', () => {
		const Comp = fake();
		registerRenderer('__fallback__', Comp);
		assert.equal(rendererOf('__fallback__'), Comp);
		assert.equal(fallbackRenderer(), undefined, '槽位仍空 —— 它是另一种东西');
	});
});

describe('__resetRegistryForTest 也清 fallback', () => {
	it('清完 fallback 变回 undefined、且能重新设', () => {
		setFallbackRenderer(fake());
		__resetRegistryForTest();
		assert.equal(fallbackRenderer(), undefined);
		const Again = fake();
		setFallbackRenderer(Again);
		assert.equal(fallbackRenderer(), Again);
	});
});
