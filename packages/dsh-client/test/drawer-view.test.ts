/**
 * `pure/drawer-view.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * 覆盖四块（对应任务报告里要回答的问题）：
 *
 * | 块 | 断言什么 |
 * |---|---|
 * | 开合状态机 | toggle 翻面、其余事件幂等、无变化返回原对象 |
 * | 三个入口 | Chevron / 工具栏 / 详情 ⧉ **恒**派发同一个事件（结构级保证）|
 * | 关闭条件 | Esc（组字中不关）/ 点外部三例外（面板内 / 触发器 / 状态菜单）|
 * | 400 高压缩 | 档位阈值 560、间距表数值、以及 **CSS 真的由这张表生成** |
 *
 * ⚠ 最后一块特别重要：`styles.ts` 的 `DRAWER_CSS` 用 `DRAWER_COMPACT_SPACING`
 *   插值生成。这里断言「表里的数出现在 CSS 里」—— 表改了 CSS 没跟着变，
 *   或 CSS 写死了第二份数，测试都会红。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	DRAWER_CLOSED,
	DRAWER_CLOSE_EVENT,
	DRAWER_COMPACT_MAX_HEIGHT,
	DRAWER_COMPACT_SPACING,
	DRAWER_HEIGHT,
	DRAWER_OPEN,
	DRAWER_OPEN_EVENT,
	DRAWER_TOGGLE_EVENT,
	DRAWER_TRIGGER_SOURCES,
	DRAWER_WIDTH,
	closesDrawerOn,
	drawerChromeOf,
	drawerSpacingOf,
	drawerTierOf,
	initialDrawerState,
	isDrawerCloseKey,
	isDrawerOpen,
	reduceDrawer,
	triggerEventOf,
	triggeredDrawerState,
} from '../src/pure/drawer-view.ts';
import { DRAWER_CSS } from '../src/styles.ts';

/* ══════════════════════════════════════════════════════════ */
/* ① 设计尺寸                                                 */
/* ══════════════════════════════════════════════════════════ */

describe('① 设计尺寸（view-4-drawer-only.svg 1:1 标注）', () => {
	it('宽 1200、高 400', () => {
		assert.equal(DRAWER_WIDTH, 1200);
		assert.equal(DRAWER_HEIGHT, 400);
	});

	it('compact 档的阈值是设计图注的 560', () => {
		assert.equal(DRAWER_COMPACT_MAX_HEIGHT, 560);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ② 开合状态机                                               */
/* ══════════════════════════════════════════════════════════ */

describe('② 开合状态机', () => {
	it('初始默认关；传 true 则开', () => {
		assert.deepEqual(initialDrawerState(), { open: false });
		assert.deepEqual(initialDrawerState(true), { open: true });
	});

	it('toggle 从关到开、从开到关（翻面）', () => {
		assert.equal(reduceDrawer(DRAWER_CLOSED, DRAWER_TOGGLE_EVENT), DRAWER_OPEN);
		assert.equal(reduceDrawer(DRAWER_OPEN, DRAWER_TOGGLE_EVENT), DRAWER_CLOSED);
	});

	it('toggle 两次回到原点', () => {
		const twice = reduceDrawer(reduceDrawer(DRAWER_CLOSED, DRAWER_TOGGLE_EVENT), DRAWER_TOGGLE_EVENT);
		assert.equal(twice, DRAWER_CLOSED);
	});

	it('open 幂等：已经开着时返回**原对象**（React 跳过重渲染）', () => {
		assert.equal(reduceDrawer(DRAWER_OPEN, DRAWER_OPEN_EVENT), DRAWER_OPEN);
	});

	it('open 从关变开', () => {
		assert.equal(reduceDrawer(DRAWER_CLOSED, DRAWER_OPEN_EVENT), DRAWER_OPEN);
	});

	it('close / escape / outside 都关；已经关着时返回原对象', () => {
		for (const event of [
			DRAWER_CLOSE_EVENT,
			{ type: 'escape' as const },
			{ type: 'outside' as const },
		]) {
			assert.equal(reduceDrawer(DRAWER_OPEN, event), DRAWER_CLOSED);
			assert.equal(reduceDrawer(DRAWER_CLOSED, event), DRAWER_CLOSED);
		}
	});

	it('状态对象是冻结的 —— 状态机不靠就地改', () => {
		assert.equal(Object.isFrozen(DRAWER_OPEN), true);
		assert.equal(Object.isFrozen(DRAWER_CLOSED), true);
	});

	it('isDrawerOpen 只读 open 那一位', () => {
		assert.equal(isDrawerOpen(DRAWER_OPEN), true);
		assert.equal(isDrawerOpen(DRAWER_CLOSED), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ③ 三个入口 = 同一个动作（设计图 ②）                        */
/* ══════════════════════════════════════════════════════════ */

describe('③ 三个入口派发同一个动作（设计图 ②）', () => {
	it('入口清单就是设计图列举的三处', () => {
		assert.deepEqual([...DRAWER_TRIGGER_SOURCES], ['chevron', 'toolbar', 'detail-expand']);
	});

	it('⭐ 三个入口恒返回**同一个** toggle 事件对象（写不出第二套开合逻辑）', () => {
		for (const source of DRAWER_TRIGGER_SOURCES) {
			assert.equal(triggerEventOf(source), DRAWER_TOGGLE_EVENT);
		}
	});

	it('⭐ 三个入口在关态下都开、开态下都关', () => {
		for (const source of DRAWER_TRIGGER_SOURCES) {
			assert.equal(triggeredDrawerState(source, DRAWER_CLOSED), DRAWER_OPEN);
			assert.equal(triggeredDrawerState(source, DRAWER_OPEN), DRAWER_CLOSED);
		}
	});

	it('入口动作和直接 toggle 完全等价（不是「长得像」）', () => {
		for (const source of DRAWER_TRIGGER_SOURCES) {
			assert.equal(
				triggeredDrawerState(source, DRAWER_CLOSED),
				reduceDrawer(DRAWER_CLOSED, DRAWER_TOGGLE_EVENT),
			);
		}
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ④ Esc 关闭条件（设计图 ②：Esc ⇒ 关）                       */
/* ══════════════════════════════════════════════════════════ */

describe('④ Esc 关闭条件', () => {
	it('Escape 关', () => {
		assert.equal(isDrawerCloseKey('Escape'), true);
	});

	it('别的键不关（Enter / Esc 拼写 / e）', () => {
		for (const key of ['Enter', 'Esc', 'e', 'Tab']) {
			assert.equal(isDrawerCloseKey(key), false);
		}
	});

	it('⭐ 输入法组字中不关（中文输入法 Esc 是取消候选词）', () => {
		assert.equal(isDrawerCloseKey('Escape', true), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ⑤ 点外部关闭条件（设计图 ②：点外部 ⇒ 关）                  */
/* ══════════════════════════════════════════════════════════ */

describe('⑤ 点外部关闭条件', () => {
	it('点在外面 ⇒ 关', () => {
		assert.equal(closesDrawerOn({ inPanel: false, inTrigger: false, inStatusMenu: false }), true);
	});

	it('点在面板里 ⇒ 不关', () => {
		assert.equal(closesDrawerOn({ inPanel: true, inTrigger: false, inStatusMenu: false }), false);
	});

	it('⭐ 点在触发器上 ⇒ 不关（它自己 toggle，不能被抢先关一次）', () => {
		assert.equal(closesDrawerOn({ inPanel: false, inTrigger: true, inStatusMenu: false }), false);
	});

	it('⭐ 点在工作区状态菜单里 ⇒ 不关（菜单 portal 到 body，但在面板外）', () => {
		assert.equal(closesDrawerOn({ inPanel: false, inTrigger: false, inStatusMenu: true }), false);
	});

	it('面板 + 触发器同时命中 ⇒ 仍不关', () => {
		assert.equal(closesDrawerOn({ inPanel: true, inTrigger: true, inStatusMenu: false }), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ⑥ 400 高的纵向间距档位（设计图 ③）                         */
/* ══════════════════════════════════════════════════════════ */

describe('⑥ 400 高的纵向间距档位', () => {
	it('400 高 ⇒ compact；560 仍是 compact；561 起 regular', () => {
		assert.equal(drawerTierOf(DRAWER_HEIGHT), 'compact');
		assert.equal(drawerTierOf(DRAWER_COMPACT_MAX_HEIGHT), 'compact');
		assert.equal(drawerTierOf(DRAWER_COMPACT_MAX_HEIGHT + 1), 'regular');
	});

	it('drawerSpacingOf(400) 就是那张表；regular 档返回 null（不抄第二份数）', () => {
		assert.equal(drawerSpacingOf(DRAWER_HEIGHT), DRAWER_COMPACT_SPACING);
		assert.equal(drawerSpacingOf(900), null);
	});

	it('⭐ 间距表的每个数（改一个数这里就红 —— 防「报告和实现漂了」）', () => {
		assert.deepEqual(DRAWER_COMPACT_SPACING, {
			headerHeight: 36,
			pagePadY: 6,
			pagePadX: 12,
			toolbarGap: 0,
			filtersGap: 4,
			mainGap: 6,
			listHeadPadTop: 6,
			listHeadPadBottom: 4,
			listBodyPadTop: 4,
			listBodyPadBottom: 8,
			listBodyPadX: 12,
			cardGap: 4,
			cardPadY: 6,
			detailPadY: 8,
			detailPadX: 12,
			detailGap: 7,
			sectionGap: 8,
			listWidth: 320,
		});
	});

	it('⭐ 收掉的 chrome：筛选行 / 图例 / 列名行（设计图的 400 抽屉里都没有）', () => {
		assert.deepEqual(drawerChromeOf(DRAWER_HEIGHT), {
			showFilters: false,
			showLegend: false,
			showListCols: false,
		});
	});

	it('regular 档三块 chrome 都在', () => {
		assert.deepEqual(drawerChromeOf(900), {
			showFilters: true,
			showLegend: true,
			showListCols: true,
		});
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ⑦ 硬约束：CSS 必须是「表插值生成」的，并且不用 fixed       */
/* ══════════════════════════════════════════════════════════ */

describe('⑦ 抽屉 CSS（硬约束）', () => {
	it('⭐ 没有 position:fixed（用户 2026-11-19 否掉：会逃出父容器）', () => {
		assert.equal(DRAWER_CSS.includes('position:fixed'), false);
		assert.equal(DRAWER_CSS.includes('position: fixed'), false);
	});

	it('层和面板都是 absolute 贴底', () => {
		assert.equal(DRAWER_CSS.includes('.tb3d-layer{position:absolute;inset:0'), true);
		assert.equal(DRAWER_CSS.includes('position:absolute;left:50%'), true);
	});

	it('⭐ 面板 1200 × 400（宽度 min() 兜窄容器）', () => {
		assert.equal(DRAWER_CSS.includes('width:min(1200px,calc(100% - 32px))'), true);
		assert.equal(DRAWER_CSS.includes('height:400px'), true);
	});

	it('⭐ 间距数值来自 DRAWER_COMPACT_SPACING（表改 CSS 跟着变）', () => {
		const s = DRAWER_COMPACT_SPACING;
		for (const needle of [
			`padding:${String(s.pagePadY)}px ${String(s.pagePadX)}px`,
			`margin-top:${String(s.mainGap)}px`,
			`margin-bottom:${String(s.cardGap)}px`,
			`padding:${String(s.cardPadY)}px 10px`,
			`gap:${String(s.detailGap)}px`,
			`gap:${String(s.sectionGap)}px`,
			`height:${String(s.headerHeight)}px`,
			`flex:0 0 ${String(s.listWidth)}px`,
		]) {
			assert.equal(DRAWER_CSS.includes(needle), true, `CSS 里缺：${needle}`);
		}
	});

	it('⭐ 面板自己不滚，两栏各自滚（overflow 只在两栏里）', () => {
		assert.equal(DRAWER_CSS.includes('.tb3d-body{flex:1 1 auto;display:flex;min-height:0;overflow:hidden}'), true);
		assert.equal(DRAWER_CSS.includes('.tb3d-panel{animation:none'), true);
	});

	it('筛选行 / 图例 / 列名行在抽屉里被收掉', () => {
		assert.equal(DRAWER_CSS.includes('.tb3d-panel .tb3w-filters{display:none}'), true);
		assert.equal(DRAWER_CSS.includes('.tb3d-panel .tb3w-toolbar__legend{display:none}'), true);
		assert.equal(DRAWER_CSS.includes('.tb3d-panel .tb3w-list__cols{display:none}'), true);
	});

	it('宽版左列固定 320、详情吃剩余（只在容器 ≥700 时）', () => {
		assert.equal(DRAWER_CSS.includes('@container tb3w (min-width: 700px)'), true);
		assert.equal(DRAWER_CSS.includes('.tb3d-panel .tb3w-list{flex:0 0 320px}'), true);
		assert.equal(DRAWER_CSS.includes('.tb3d-panel .tb3w-detail{flex:1 1 0;min-width:0;max-width:none}'), true);
	});

	it('抽屉进出有升起动画，并且 respects prefers-reduced-motion', () => {
		assert.equal(DRAWER_CSS.includes('@keyframes tb3d-rise'), true);
		assert.equal(DRAWER_CSS.includes('prefers-reduced-motion:reduce'), true);
	});
});
