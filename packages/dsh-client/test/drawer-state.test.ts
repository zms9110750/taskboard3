/**
 * `pure/drawer-state.ts` 的测试 —— **模块级抽屉开合状态**。
 *
 * ## 为什么这个测试重要
 *
 * 入口按钮和抽屉面板是**两个独立的槽条目**，渲染在不同位置（composer 工具行
 * 左侧 vs composer 卡片内的浮层）。它们只能靠「一份共享的开合状态」同步。
 *
 * 这份状态写错会怎样：
 *
 * | 错法 | 症状 |
 * |---|---|
 * | 两处各持一份 state | 点入口开了，面板不知道 ⇒ **点了什么都不出现** |
 * | 变了不广播 | 状态对了但组件不重渲染 ⇒ 同样什么都不出现 |
 * | 退订没生效 | 组件卸载后还持有 listener ⇒ 泄漏 + 潜在「幽灵重渲染」 |
 *
 * ## 为什么是模块级（而不是 `inject(sessionId)`）
 *
 * 2026-11-23 实测：用 `inject: (sessionId) => ({ hooks: { drawer } })` 让 DSH
 * 注入 store，组件拿到 `props.hooks === undefined`：
 *
 * ```
 * TypeError: Cannot read properties of undefined (reading 'drawer')
 * slot entry crashed in 'conversation.input.left'
 * ```
 *
 * ⇒ 改成模块级变量 + `useSyncExternalStore`，抄 `taskboard2`
 *   （`packages/ui/client.js:27-39`，那份代码在 desktop profile 里跑着）。
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
	closeDrawer,
	isDrawerOpen,
	setDrawerOpen,
	subscribeDrawer,
	toggleDrawer,
} from '../src/pure/drawer-state.ts';

/**
 * 每个测试开始前归零。
 *
 * ⚠ 模块状态跨测试残留（ESM 模块只求值一次）⇒ 必须显式重置。
 */
beforeEach(() => {
	closeDrawer();
});

describe('抽屉的模块级开合状态', () => {
	it('初始是关着的', () => {
		assert.equal(isDrawerOpen(), false);
	});

	it('setDrawerOpen(true) 之后是开着', () => {
		setDrawerOpen(true);
		assert.equal(isDrawerOpen(), true);
	});

	it('toggleDrawer 来回翻', () => {
		toggleDrawer();
		assert.equal(isDrawerOpen(), true, '第一次 toggle 应该打开');
		toggleDrawer();
		assert.equal(isDrawerOpen(), false, '第二次 toggle 应该关上');
	});

	it('closeDrawer 归零（Esc / 点外部 / × 都走它）', () => {
		setDrawerOpen(true);
		closeDrawer();
		assert.equal(isDrawerOpen(), false);
	});

	it('⭐ 设成同一个值不重复广播（避免无意义 re-render）', () => {
		let count = 0;
		const unsubscribe = subscribeDrawer(() => {
			count += 1;
		});
		try {
			setDrawerOpen(false);
			assert.equal(count, 0, '本来就是 false，设 false 不该广播');
			setDrawerOpen(true);
			assert.equal(count, 1, 'false → true 该广播一次');
			setDrawerOpen(true);
			assert.equal(count, 1, 'true → true 不该再广播');
			setDrawerOpen(false);
			assert.equal(count, 2, 'true → false 该广播一次');
		} finally {
			unsubscribe();
		}
	});

	it('⭐ 退订之后不再收到广播', () => {
		let count = 0;
		const unsubscribe = subscribeDrawer(() => {
			count += 1;
		});
		unsubscribe();
		setDrawerOpen(true);
		assert.equal(count, 0, '退订后不该再收到');
	});

	it('⭐ 多个订阅者都收到（入口 + 面板两个槽各一个）', () => {
		let entry = 0;
		let panel = 0;
		const u1 = subscribeDrawer(() => {
			entry += 1;
		});
		const u2 = subscribeDrawer(() => {
			panel += 1;
		});
		try {
			setDrawerOpen(true);
			assert.equal(entry, 1, '入口槽应该收到');
			assert.equal(panel, 1, '面板槽应该收到');
		} finally {
			u1();
			u2();
		}
	});

	it('⭐ 退订一个不影响另一个', () => {
		let a = 0;
		let b = 0;
		const u1 = subscribeDrawer(() => {
			a += 1;
		});
		const u2 = subscribeDrawer(() => {
			b += 1;
		});
		try {
			u1();
			setDrawerOpen(true);
			assert.equal(a, 0, '退订的那个不该收到');
			assert.equal(b, 1, '没退订的那个应该收到');
		} finally {
			u2();
		}
	});
});
