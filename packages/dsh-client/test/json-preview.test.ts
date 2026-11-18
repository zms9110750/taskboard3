/**
 * `json-preview` 的对照测试 —— **保证本地副本和 core 的实现不漂**。
 *
 * ## 为什么需要这个文件
 *
 * `src/pure/json-preview.ts` 是 `packages/core/src/render/registry.ts` 里
 * `jsonPreviewOf()` 的**重复实现**（原因见那个文件的头部：
 * dsh-client 不能 import core，因为 core 会 import `node:sqlite`）。
 *
 * 重复代码最怕的是**改一边不改另一边** —— 而这里的表现是「兜底块显示的东西
 * 和 core 算出来的不一样」，**不报错，只是看着不对**。
 *
 * ⇒ 用一份共享的输入集，跑两边的实现，**逐字段比对**。
 *   任何人改了一边没改另一边 ⇒ 这个测试变红。
 *
 * 这是 AGENTS 3.6 说的「白名单 + 差集断言」：靠测试逼齐，不靠注释。
 *
 * ## 为什么这个测试能 import core
 *
 * `@taskboard/core` 是 **devDependency**（只在这个测试里用）。
 * 它的模块图里有 `node:sqlite` —— 但测试跑在 **Node** 里，能加载。
 * 产品代码不 import core（浏览器里会炸），这条测试不改变那个事实。
 *
 * ⚠ `node --test` 跑这个文件前必须先 `tsc -b packages/core`（跨包走包名 → lib 产物）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { jsonPreviewOf as coreJsonPreviewOf } from '@taskboard/core';

import { jsonPreviewOf as ourJsonPreviewOf } from '../src/pure/json-preview.ts';

/**
 * 共享输入集。
 *
 * ⚠ 每一类都要有 —— 少一类就少一条保护。
 */
const CASES: readonly { readonly label: string; readonly value: () => unknown }[] = [
	{ label: '字符串', value: () => 'hello' },
	{ label: '空字符串', value: () => '' },
	{ label: '数字', value: () => 42 },
	{ label: 'NaN', value: () => Number.NaN },
	{ label: 'Infinity', value: () => Number.POSITIVE_INFINITY },
	{ label: '负零', value: () => -0 },
	{ label: 'true', value: () => true },
	{ label: 'false', value: () => false },
	{ label: 'null', value: () => null },
	{ label: 'undefined', value: () => undefined },
	{ label: 'bigint', value: () => 1n },
	{ label: 'symbol', value: () => Symbol('x') },
	{ label: '具名函数', value: () => function namedFn() {} },
	{ label: '匿名函数', value: () => () => undefined },
	{ label: '空对象', value: () => ({}) },
	{ label: '空数组', value: () => [] },
	{ label: '平面对象', value: () => ({ a: 1, b: 'x', c: null }) },
	{ label: '嵌套两层', value: () => ({ a: { b: { c: 1 } } }) },
	{ label: '混数组', value: () => [1, 'two', null, undefined, { x: true }] },
	{ label: 'Date', value: () => new Date('2026-11-18T12:00:00.000Z') },
	{ label: 'Invalid Date', value: () => new Date(Number.NaN) },
	{ label: 'Map', value: () => new Map([['a', 1]]) },
	{ label: 'Set', value: () => new Set([1, 2]) },
	{ label: 'RegExp', value: () => /ab+c/gi },
	{
		label: '循环引用',
		value: () => {
			const one: Record<string, unknown> = { name: 'self' };
			one['me'] = one;
			return one;
		},
	},
	{
		label: 'DAG（兄弟共享同一对象，不是环）',
		value: () => {
			const shared = { v: 1 };
			return { left: shared, right: shared };
		},
	},
	{
		label: 'getter 抛错',
		value: () => {
			const bad: Record<string, unknown> = { ok: 1 };
			Object.defineProperty(bad, 'boom', {
				enumerable: true,
				get() {
					throw new Error('炸了');
				},
			});
			return bad;
		},
	},
	{
		label: '超深嵌套（14 层）',
		value: () => {
			let node: unknown = 'leaf';
			for (let i = 0; i < 14; i += 1) node = { down: node };
			return node;
		},
	},
	{
		label: '长字符串（2500 字符，会被截断）',
		value: () => 'x'.repeat(2500),
	},
	{
		label: '大数组（205 项，会被截断）',
		value: () => Array.from({ length: 205 }, (_one, i) => i),
	},
	{
		label: '大对象（205 个键，会被截断）',
		value: () => {
			const obj: Record<string, number> = {};
			for (let i = 0; i < 205; i += 1) obj[`k${String(i)}`] = i;
			return obj;
		},
	},
];

describe('⚠ 本地 jsonPreviewOf 与 core 的实现逐字段一致', () => {
	for (const one of CASES) {
		it(one.label, () => {
			const core = coreJsonPreviewOf(one.value());
			const ours = ourJsonPreviewOf(one.value());
			assert.deepEqual(ours, core);
		});
	}

	it('⚠ 覆盖了全部八种节点 kind', () => {
		const kinds = new Set<string>();
		for (const one of CASES) kinds.add(ourJsonPreviewOf(one.value()).kind);
		/* 顶层出现的 kind 集合 —— 至少要有这些（object 的深层 value 也算）。 */
		for (const must of ['string', 'number', 'boolean', 'null', 'undefined', 'opaque', 'array', 'object']) {
			assert.equal(kinds.has(must), true, `输入集缺少覆盖 kind「${must}」`);
		}
	});

	it('永远不抛（任意脏数据都给一个能画的东西）', () => {
		const nasty = [undefined, null, Number.NaN, Symbol('s'), 1n, () => undefined];
		for (const one of nasty) {
			assert.doesNotThrow(() => {
				ourJsonPreviewOf(one);
			});
		}
	});
});
