/**
 * 折叠偏好的单测（issue #56）。
 *
 * 偏好是「记住用户展开/收起了哪一块」。它有三种环境，三种真实存在：
 * 浏览器有 `localStorage`、SSR / `node --test` 没有、隐私模式下读写会抛。
 * ⇒ 这里用注入的假存储把三条都走一遍 —— 坏环境下**回落默认值**，不许崩。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	FOLD_PREF_PREFIX,
	browserFoldStorage,
	foldPrefKeyOf,
	readFoldPref,
	writeFoldPref,
} from '../src/pure/fold-pref.ts';
import type { FoldPrefStorage } from '../src/pure/fold-pref.ts';

/** 内存存储（模拟 localStorage）。 */
function memoryStorage(initial: Record<string, string> = {}): FoldPrefStorage & { readonly dump: () => Record<string, string> } {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value);
		},
		dump: () => Object.fromEntries(map),
	};
}

describe('foldPrefKeyOf', () => {
	it('统一前缀，作用域原样接在后面', () => {
		assert.equal(FOLD_PREF_PREFIX, 'tb3-fold:');
		assert.equal(foldPrefKeyOf('auth:tiers'), 'tb3-fold:auth:tiers');
		assert.equal(foldPrefKeyOf('auth:domain:代码'), 'tb3-fold:auth:domain:代码');
	});
});

describe('readFoldPref', () => {
	it('没有记录 ⇒ 用默认值', () => {
		assert.equal(readFoldPref(memoryStorage(), 'k', true), true);
		assert.equal(readFoldPref(memoryStorage(), 'k', false), false);
	});

	it('"1" / "0" 是唯一的两种真值', () => {
		assert.equal(readFoldPref(memoryStorage({ k: '1' }), 'k', false), true);
		assert.equal(readFoldPref(memoryStorage({ k: '0' }), 'k', true), false);
	});

	it('坏值 / 别的写法 ⇒ 回落默认值（不做模糊解释）', () => {
		for (const raw of ['true', 'yes', '', '2', 'open']) {
			assert.equal(readFoldPref(memoryStorage({ k: raw }), 'k', true), true);
			assert.equal(readFoldPref(memoryStorage({ k: raw }), 'k', false), false);
		}
	});

	it('存储不存在 / 读取抛异常 ⇒ 默认值（偏好不是数据，不许崩）', () => {
		assert.equal(readFoldPref(undefined, 'k', true), true);
		const throwing: FoldPrefStorage = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {},
		};
		assert.equal(readFoldPref(throwing, 'k', false), false);
	});
});

describe('writeFoldPref', () => {
	it('写 "1" / "0"', () => {
		const storage = memoryStorage();
		writeFoldPref(storage, 'k', true);
		assert.equal(storage.dump()['k'], '1');
		writeFoldPref(storage, 'k', false);
		assert.equal(storage.dump()['k'], '0');
	});

	it('写入抛异常（配额满 / 隐私模式）⇒ 静默吞掉', () => {
		const throwing: FoldPrefStorage = {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			},
		};
		assert.doesNotThrow(() => {
			writeFoldPref(throwing, 'k', true);
		});
	});

	it('没有存储 ⇒ 什么都不做', () => {
		assert.doesNotThrow(() => {
			writeFoldPref(undefined, 'k', true);
		});
	});
});

describe('browserFoldStorage', () => {
	it('Node 里没有 localStorage ⇒ undefined（不是抛异常）', () => {
		// 不假设宿主有没有 --experimental-webstorage：只要求「要么是端口、要么是 undefined」。
		const storage = browserFoldStorage();
		assert.ok(storage === undefined || typeof storage.getItem === 'function');
	});
});
