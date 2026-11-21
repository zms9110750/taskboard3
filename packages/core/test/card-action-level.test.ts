/**
 * UI 轴（`cardActionLevel`）对「领卡类动作」的判定测试（第二轮 ④）。
 *
 * 用户原话：
 * > 这个有权限拦截。必须在 ui 侧用户手开这个权限才能让 ai 领取。
 *
 * v2 把采纳/领取/释放合并成一个工具后，判定按**动作**走（不再按工具名）。
 * 这里钉住旧的档位矩阵 + 「默认关闭」。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTaskboard } from '../src/index.ts';
import { createMemoryStore } from './memory-store.ts';

describe('judgeCardAction（UI 轴）', () => {
	it('默认档位 = no-claim：采纳/领取被拒，释放永远放行', () => {
		const tb = createTaskboard({ store: createMemoryStore() });
		assert.equal(tb.getCardActionLevel(), 'no-claim', '默认必须关闭 AI 领卡/采纳');

		const adopt = tb.judgeCardAction('adopt');
		assert.equal(adopt.ok, false);
		if (!adopt.ok) {
			assert.equal(adopt.reason, 'CARD_ACTION_LEVEL');
			assert.equal(adopt.requiredLevel, 'adopt');
			assert.equal(adopt.current, 'no-claim');
			assert.ok(adopt.message.includes('采纳草稿'), adopt.message);
		}

		const claim = tb.judgeCardAction('claim');
		assert.equal(claim.ok, false);
		if (!claim.ok) {
			assert.equal(claim.requiredLevel, 'claim');
			assert.ok(claim.message.includes('领取'), claim.message);
		}

		assert.equal(tb.judgeCardAction('release').ok, true, '放手永远允许');
	});

	it('claim 档：可领卡、不可采纳', async () => {
		const tb = createTaskboard({ store: createMemoryStore() });
		await tb.setCardActionLevel('claim');
		assert.equal(tb.judgeCardAction('claim').ok, true);
		const adopt = tb.judgeCardAction('adopt');
		assert.equal(adopt.ok, false);
		if (!adopt.ok) assert.equal(adopt.requiredLevel, 'adopt');
		assert.equal(tb.judgeCardAction('release').ok, true);
	});

	it('adopt 档：可领卡、可采纳', async () => {
		const tb = createTaskboard({ store: createMemoryStore() });
		await tb.setCardActionLevel('adopt');
		assert.equal(tb.judgeCardAction('claim').ok, true);
		assert.equal(tb.judgeCardAction('adopt').ok, true);
		assert.equal(tb.judgeCardAction('release').ok, true);
	});

	it('档位落 kv：换一个实例（同一 store）仍读到同一档位', async () => {
		const store = createMemoryStore();
		const first = createTaskboard({ store });
		await first.setCardActionLevel('claim');
		/* 不关第一个实例（关 store 会清空内存）；直接用同一个 store 再建一个实例。 */
		const second = createTaskboard({ store });
		assert.equal(second.getCardActionLevel(), 'claim');
	});
});
