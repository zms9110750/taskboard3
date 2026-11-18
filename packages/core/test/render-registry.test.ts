/**
 * `render/registry.ts` 的测试 —— ① 的比对 + ④ 的 JSON 兜底。
 *
 * 这两条是**纯函数**，所以这里不用起浏览器、不用建任务板实例。
 *
 * ## 覆盖重点（设计文档要求的边界）
 *
 * `missingRenderers`：全齐 / 缺一个 / 缺多个 / 重复 / 空列表
 * `jsonPreviewOf`：普通值 / 对象 / 数组 / 嵌套 / 空 / **函数** /
 *                 **循环引用** / **Symbol** / `undefined` / `NaN` /
 *                 超深嵌套 / 坏 getter / `Date` / `Map` / `bigint`
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	JSON_PREVIEW_MAX_DEPTH,
	JSON_PREVIEW_MAX_ITEMS,
	missingRenderers,
	jsonPreviewOf,
	type JsonPreview,
} from '../src/render/registry.ts';

/* ══════════════════════════════════════════════════════════
   ① 接通检查
   ══════════════════════════════════════════════════════════ */

describe('missingRenderers —— 模板要的 vs UI 注册的', () => {
	it('全齐 ⇒ 空', () => {
		assert.deepEqual(missingRenderers(['text', 'markdown'], ['text', 'markdown']), []);
	});

	it('UI 注册多了不算缺（模板没用到就不用渲染器）', () => {
		assert.deepEqual(missingRenderers(['text'], ['text', 'markdown', 'ask']), []);
	});

	it('缺一个 ⇒ 只有那一个', () => {
		assert.deepEqual(missingRenderers(['text', 'markdown'], ['text']), ['markdown']);
	});

	it('缺多个 ⇒ 排序输出（顺序稳定才能逐行 diff）', () => {
		assert.deepEqual(missingRenderers(['zebra', 'ask', 'text'], ['text']), ['ask', 'zebra']);
	});

	it('required 有重复 ⇒ 输出不重复', () => {
		assert.deepEqual(missingRenderers(['ask', 'ask', 'ask'], []), ['ask']);
	});

	it('registered 有重复 ⇒ 照样认', () => {
		assert.deepEqual(missingRenderers(['ask'], ['ask', 'ask']), []);
	});

	it('required 空 ⇒ 空（没有模板时不该报警）', () => {
		assert.deepEqual(missingRenderers([], []), []);
	});

	it('没有任何注册 ⇒ 全缺', () => {
		assert.deepEqual(missingRenderers(['text', 'markdown', 'ask'], []), ['ask', 'markdown', 'text']);
	});

	it('⚠ 只算，不打日志、不抛 —— 返回普通数组', () => {
		const out = missingRenderers(['x'], []);
		assert.equal(Array.isArray(out), true);
		assert.equal(out.length, 1);
	});
});

/* ══════════════════════════════════════════════════════════
   ④ JSON 兜底
   ══════════════════════════════════════════════════════════ */

/** 取一个描述，断言它必须是某一个 kind（顺便给 TS 窄化）。 */
function asKind<K extends JsonPreview['kind']>(
	preview: JsonPreview,
	kind: K,
): Extract<JsonPreview, { kind: K }> {
	assert.equal(preview.kind, kind, `期望 kind=${kind}，实际 ${preview.kind}`);
	return preview as Extract<JsonPreview, { kind: K }>;
}

describe('jsonPreviewOf —— 普通值', () => {
	it('null ⇒ null', () => {
		assert.deepEqual(jsonPreviewOf(null), { kind: 'null' });
	});

	it('⚠ undefined ⇒ undefined（**和 null 分开**）', () => {
		/* JSON 里 `null` 是「有值且是空」，`undefined` 是「没有」—— 不能混。 */
		assert.deepEqual(jsonPreviewOf(undefined), { kind: 'undefined' });
	});

	it('字符串', () => {
		assert.deepEqual(jsonPreviewOf('hi'), { kind: 'string', value: 'hi', truncated: false });
	});

	it('空字符串也能表示', () => {
		assert.deepEqual(jsonPreviewOf(''), { kind: 'string', value: '', truncated: false });
	});

	it('布尔', () => {
		assert.deepEqual(jsonPreviewOf(true), { kind: 'boolean', value: true });
		assert.deepEqual(jsonPreviewOf(false), { kind: 'boolean', value: false });
	});

	it('数字转字符串（这样 NaN/Infinity 有地方放）', () => {
		assert.deepEqual(jsonPreviewOf(42), { kind: 'number', value: '42' });
		assert.deepEqual(jsonPreviewOf(-0.5), { kind: 'number', value: '-0.5' });
	});

	it('⚠ NaN ⇒ kind=number，value="NaN"（不是 null）', () => {
		assert.deepEqual(jsonPreviewOf(Number.NaN), { kind: 'number', value: 'NaN' });
	});

	it('⚠ Infinity / -Infinity 同理', () => {
		assert.deepEqual(jsonPreviewOf(Number.POSITIVE_INFINITY), { kind: 'number', value: 'Infinity' });
		assert.deepEqual(jsonPreviewOf(Number.NEGATIVE_INFINITY), {
			kind: 'number',
			value: '-Infinity',
		});
	});
});

describe('jsonPreviewOf —— 对象 / 数组', () => {
	it('普通对象按 keys 顺序', () => {
		const got = asKind(jsonPreviewOf({ b: 1, a: 2 }), 'object');
		assert.deepEqual(
			got.entries.map((one) => one.key),
			['b', 'a'],
		);
		assert.equal(got.truncated, 0);
	});

	it('空对象', () => {
		assert.deepEqual(jsonPreviewOf({}), { kind: 'object', entries: [], truncated: 0 });
	});

	it('数组', () => {
		const got = asKind(jsonPreviewOf([1, 'x', null]), 'array');
		assert.equal(got.items.length, 3);
		assert.equal(got.truncated, 0);
		assert.equal(got.items[0]?.kind, 'number');
		assert.equal(got.items[1]?.kind, 'string');
		assert.equal(got.items[2]?.kind, 'null');
	});

	it('空数组', () => {
		assert.deepEqual(jsonPreviewOf([]), { kind: 'array', items: [], truncated: 0 });
	});

	it('嵌套结构', () => {
		const got = asKind(jsonPreviewOf({ items: [{ options: [] }] }), 'object');
		const items = asKind(got.entries[0]!.value, 'array');
		const first = asKind(items.items[0]!, 'object');
		assert.equal(first.entries[0]!.value.kind, 'array');
	});

	it('真实 ask payload 的形状能画', () => {
		const got = asKind(
			jsonPreviewOf({ $type: 'ask', items: [{ options: [{ label: '望文生义' }] }] }),
			'object',
		);
		assert.deepEqual(
			got.entries.map((one) => one.key),
			['$type', 'items'],
		);
	});
});

describe('jsonPreviewOf —— ⚠ 怪东西必须画出来（不能静默变 null）', () => {
	it('函数 ⇒ opaque 带名字', () => {
		const got = asKind(jsonPreviewOf(() => undefined), 'opaque');
		assert.match(got.note, /function/);
	});

	it('匿名函数也能表示', () => {
		const fn = (() => (): void => undefined)();
		const got = asKind(jsonPreviewOf(fn), 'opaque');
		assert.match(got.note, /function/);
	});

	it('对象里夹函数 ⇒ 那个字段是 opaque，其它字段正常', () => {
		const got = asKind(jsonPreviewOf({ ok: 1, fn: (): void => undefined }), 'object');
		assert.equal(got.entries[0]!.value.kind, 'number');
		assert.equal(got.entries[1]!.value.kind, 'opaque');
	});

	it('Symbol ⇒ opaque', () => {
		const got = asKind(jsonPreviewOf(Symbol('secret')), 'opaque');
		assert.match(got.note, /secret/);
	});

	it('bigint ⇒ opaque（JSON.stringify 会抛 TypeError，这里不能抛）', () => {
		const got = asKind(jsonPreviewOf(10n), 'opaque');
		assert.match(got.note, /bigint/);
	});

	it('⚠ 循环引用 ⇒ opaque `<循环引用>`（不能抛、不能无限递归）', () => {
		const loop: Record<string, unknown> = { name: 'x' };
		loop['self'] = loop;
		const got = asKind(jsonPreviewOf(loop), 'object');
		assert.equal(got.entries[0]!.value.kind, 'string');
		const self = asKind(got.entries[1]!.value, 'opaque');
		assert.match(self.note, /循环引用/);
	});

	it('⚠ 数组里的循环引用', () => {
		const arr: unknown[] = [1];
		arr.push(arr);
		const got = asKind(jsonPreviewOf(arr), 'array');
		assert.equal(got.items[0]?.kind, 'number');
		assert.equal(got.items[1]?.kind, 'opaque');
	});

	it('⚠ 兄弟节点重复引用同一对象**不算**循环（DAG 不是环）', () => {
		const shared = { v: 1 };
		const got = asKind(jsonPreviewOf({ a: shared, b: shared }), 'object');
		/* 两个都该正常展开，不是 opaque。 */
		assert.equal(got.entries[0]!.value.kind, 'object');
		assert.equal(got.entries[1]!.value.kind, 'object');
	});

	it('⚠ getter 抛错 ⇒ 那个字段 opaque，其它字段照常', () => {
		const bad = {};
		Object.defineProperty(bad, 'boom', {
			enumerable: true,
			get(): never {
				throw new Error('不许读我');
			},
		});
		Object.defineProperty(bad, 'ok', { enumerable: true, value: 1 });

		const got = asKind(jsonPreviewOf(bad), 'object');
		const byKey = new Map(got.entries.map((one) => [one.key, one.value]));
		assert.equal(byKey.get('boom')?.kind, 'opaque');
		assert.equal(byKey.get('ok')?.kind, 'number');
	});
});

describe('jsonPreviewOf —— 内建对象', () => {
	it('Date ⇒ opaque 带 ISO（比 `<Date>` 有用）', () => {
		const got = asKind(jsonPreviewOf(new Date('2026-11-18T00:00:00Z')), 'opaque');
		assert.match(got.note, /2026-11-18/);
	});

	it('Invalid Date ⇒ 仍能表示', () => {
		const got = asKind(jsonPreviewOf(new Date('nope')), 'opaque');
		assert.match(got.note, /Date/);
	});

	it('⚠ Map ⇒ 标出来，不能显示成空对象 {}', () => {
		const got = asKind(jsonPreviewOf(new Map([['a', 1]])), 'opaque');
		assert.match(got.note, /Map/);
	});

	it('Set / RegExp 同理', () => {
		assert.match(asKind(jsonPreviewOf(new Set([1])), 'opaque').note, /Set/);
		assert.match(asKind(jsonPreviewOf(/x/g), 'opaque').note, /RegExp/);
	});
});

describe('jsonPreviewOf —— 截断与深度上限', () => {
	it('超长字符串被截断并标 truncated', () => {
		const got = asKind(jsonPreviewOf('x'.repeat(9999)), 'string');
		assert.equal(got.truncated, true);
		assert.equal(got.value.length < 9999, true);
	});

	it('大数组截断，truncated = 丢掉的个数', () => {
		const big = Array.from({ length: JSON_PREVIEW_MAX_ITEMS + 5 }, (_, i) => i);
		const got = asKind(jsonPreviewOf(big), 'array');
		assert.equal(got.items.length, JSON_PREVIEW_MAX_ITEMS);
		assert.equal(got.truncated, 5);
	});

	it('大对象截断', () => {
		const big: Record<string, number> = {};
		for (let i = 0; i < JSON_PREVIEW_MAX_ITEMS + 3; i += 1) big[`k${i}`] = i;
		const got = asKind(jsonPreviewOf(big), 'object');
		assert.equal(got.entries.length, JSON_PREVIEW_MAX_ITEMS);
		assert.equal(got.truncated, 3);
	});

	it('⚠ 超深嵌套不栈溢出（500 层）', () => {
		let deep: Record<string, unknown> = { leaf: true };
		for (let i = 0; i < 500; i += 1) deep = { next: deep };
		/* 不抛、不爆栈就算过 —— 超深的部分会变成 opaque。 */
		const got = jsonPreviewOf(deep);
		assert.equal(got.kind, 'object');
	});

	it('⚠ 深度上限处是 opaque，不是一个看起来正常的空对象', () => {
		let deep: Record<string, unknown> = {};
		for (let i = 0; i <= JSON_PREVIEW_MAX_DEPTH + 2; i += 1) deep = { next: deep };

		let cursor: JsonPreview = jsonPreviewOf(deep);
		let hitOpaque = false;
		for (let i = 0; i < 100; i += 1) {
			if (cursor.kind === 'opaque') {
				hitOpaque = true;
				break;
			}
			if (cursor.kind !== 'object') break;
			const next: JsonPreview | undefined = cursor.entries[0]?.value;
			if (next === undefined) break;
			cursor = next;
		}
		assert.equal(hitOpaque, true, '超深的地方必须是 opaque，不能静默截断成 {}');
	});
});

describe('jsonPreviewOf —— 输出是 JSON 安全的（要过 HTTP）', () => {
	/** 递归找一个描述里有没有函数 / undefined / symbol。 */
	function assertJsonSafe(node: JsonPreview): void {
		/* 走一遍 JSON.stringify —— 它是「能不能过线」的判据。 */
		assert.doesNotThrow(() => JSON.stringify(node));
	}

	it('普通 payload 的描述能 stringify', () => {
		assertJsonSafe(jsonPreviewOf({ a: 1, b: ['x', null, true] }));
	});

	it('带函数的 payload 的描述也能 stringify（函数已被转成 note 字符串）', () => {
		assertJsonSafe(jsonPreviewOf({ fn: (): void => undefined, sym: Symbol('s') }));
	});

	it('循环引用的描述也能 stringify', () => {
		const loop: Record<string, unknown> = {};
		loop['self'] = loop;
		assertJsonSafe(jsonPreviewOf(loop));
	});
});
