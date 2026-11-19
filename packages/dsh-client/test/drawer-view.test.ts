/**
 * `pure/drawer-view.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * 抽屉 V5（`2026-11-20` 重做）覆盖七块：
 *
 * | 块 | 断言什么 |
 * |---|---|
 * | 候选形态表 | 3 个组合齐全、id 与键一致、维度确实互不相同（用户要「全部过目」）|
 * | 高度公式 | `min(50vh, 480px)` / `50vh` 的数值版与 CSS 版**出自同一份公式** |
 * | 面板几何 | 底边 = 上边缘 + gap、圆角 / 阴影 / 动画由形态表插值 |
 * | 入口几何 | `left:-32px`（右边缘贴输入框左边缘）、`bottom:4px`（和 28px 的 + 居中）|
 * | 共享 store | 开合、订阅、幂等；两个 session 各一份 |
 * | 关闭条件 | Esc（组字中不关）/ 点外部三例外 |
 * | CSS 硬约束 | 表里的数都出现在 `DRAWER_CSS` 里；面板不用 fixed；压缩间距来自表 |
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	DRAWER_CLOSED,
	DRAWER_COMPACT_SPACING,
	DRAWER_DEFAULT_VARIANT_ID,
	DRAWER_ENTRY_BOTTOM_PX,
	DRAWER_ENTRY_SIZE_PX,
	DRAWER_HEIGHT_CAP_PX,
	DRAWER_HEIGHT_RATIO,
	DRAWER_OPEN,
	DRAWER_TOOL_ROW_BUTTON_PX,
	DRAWER_TOOL_ROW_PAD_BOTTOM_PX,
	DRAWER_VARIANTS,
	DRAWER_VARIANT_IDS,
	closesDrawerOn,
	createDrawerStore,
	drawerEntryCssOf,
	drawerHeightCssOf,
	drawerHeightPxOf,
	drawerMaskCssOf,
	drawerPanelCssOf,
	drawerShadowCssOf,
	drawerVariantOf,
	isDrawerCloseKey,
} from '../src/pure/drawer-view.ts';
import { DRAWER_CSS } from '../src/styles.ts';

/* ══════════════════════════════════════════════════════════ */
/* ① 三个候选形态（用户要「全部过目」，不是替用户选）          */
/* ══════════════════════════════════════════════════════════ */

describe('① 三个候选形态', () => {
	it('恰好 3 个 id：a / b / c', () => {
		assert.deepEqual([...DRAWER_VARIANT_IDS], ['a', 'b', 'c']);
	});

	it('表里三个键都在，且每个 id 与键一致', () => {
		for (const id of DRAWER_VARIANT_IDS) {
			const variant = DRAWER_VARIANTS[id];
			assert.equal(variant.id, id);
		}
	});

	it('⭐ 三个入口图标互不相同（▣ / ▲ / ⋯）', () => {
		const icons = DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].icon);
		assert.equal(icons.length, 3);
		assert.equal(new Set(icons).size, 3);
	});

	it('间距候选覆盖 0 / 6 / 12', () => {
		assert.deepEqual(
			DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].gapPx),
			[0, 6, 12],
		);
	});

	it('圆角候选覆盖 0 / 12 / 16', () => {
		assert.deepEqual(
			DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].radiusPx),
			[0, 12, 16],
		);
	});

	it('高度候选：a/b = min(50vh,480px)，c = 50vh', () => {
		assert.deepEqual(
			DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].heightMode),
			['capped-half', 'capped-half', 'half'],
		);
	});

	it('遮罩只有 c；动画是 b / c', () => {
		assert.deepEqual(
			DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].mask),
			[false, false, true],
		);
		assert.deepEqual(
			DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].animated),
			[false, true, true],
		);
	});

	it('阴影三档：无 / 轻 / 强', () => {
		assert.deepEqual(
			DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].shadow),
			['none', 'soft', 'strong'],
		);
	});

	it('形态表是冻结的（不能被运行期改掉）', () => {
		assert.equal(Object.isFrozen(DRAWER_VARIANTS), true);
		for (const id of DRAWER_VARIANT_IDS) {
			assert.equal(Object.isFrozen(DRAWER_VARIANTS[id]), true);
		}
	});

	it('默认形态是「占位」而不是裁定 —— 必须是合法 id', () => {
		assert.equal(DRAWER_VARIANT_IDS.includes(DRAWER_DEFAULT_VARIANT_ID), true);
		assert.equal(drawerVariantOf(DRAWER_DEFAULT_VARIANT_ID), DRAWER_VARIANTS.a);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ② 高度公式：高度 ≈ 屏幕一半                                */
/* ══════════════════════════════════════════════════════════ */

describe('② 高度公式（用户原话「高度 ≈ 屏幕一半」）', () => {
	it('比例 0.5、上限 480px', () => {
		assert.equal(DRAWER_HEIGHT_RATIO, 0.5);
		assert.equal(DRAWER_HEIGHT_CAP_PX, 480);
	});

	it('⭐ capped-half：屏高一半、但不超过 480', () => {
		const a = DRAWER_VARIANTS.a;
		assert.equal(drawerHeightPxOf(a, 900), 450);
		assert.equal(drawerHeightPxOf(a, 960), 480);
		assert.equal(drawerHeightPxOf(a, 1200), 480);
		assert.equal(drawerHeightPxOf(a, 1400), 480);
	});

	it('⭐ half：永远是屏高一半（高屏时比 capped 高）', () => {
		const c = DRAWER_VARIANTS.c;
		assert.equal(drawerHeightPxOf(c, 900), 450);
		assert.equal(drawerHeightPxOf(c, 960), 480);
		assert.equal(drawerHeightPxOf(c, 1200), 600);
	});

	it('capped 与 half 在 960 以下没有差别（如实：高度维度只在高屏可见）', () => {
		assert.equal(drawerHeightPxOf(DRAWER_VARIANTS.a, 900), drawerHeightPxOf(DRAWER_VARIANTS.c, 900));
		assert.equal(drawerHeightPxOf(DRAWER_VARIANTS.a, 1200), 480);
		assert.notEqual(drawerHeightPxOf(DRAWER_VARIANTS.a, 1200), drawerHeightPxOf(DRAWER_VARIANTS.c, 1200));
	});

	it('CSS 版与数值版同一公式：a 是 min(calc(var(--tb3d-vh,100vh) * 0.5), 480px)', () => {
		assert.equal(
			drawerHeightCssOf(DRAWER_VARIANTS.a),
			'min(calc(var(--tb3d-vh,100vh) * 0.5), 480px)',
		);
	});

	it('CSS 版：c 是 calc(var(--tb3d-vh,100vh) * 0.5)，不再套 min', () => {
		assert.equal(drawerHeightCssOf(DRAWER_VARIANTS.c), 'calc(var(--tb3d-vh,100vh) * 0.5)');
		assert.equal(drawerHeightCssOf(DRAWER_VARIANTS.c).includes('min('), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ③ 面板 / 入口 / 遮罩的几何声明                             */
/* ══════════════════════════════════════════════════════════ */

describe('③ 几何声明（宽松：只是声明串，落不落地看 CSS）', () => {
	it('⭐ 面板底边 = 100% + 形态间距（结构保证「贴输入框上边缘」）', () => {
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.a).includes('bottom:calc(100% + 0px)'), true);
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.b).includes('bottom:calc(100% + 6px)'), true);
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.c).includes('bottom:calc(100% + 12px)'), true);
	});

	it('圆角 / 阴影 / 高度逐形态不同', () => {
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.a).includes('border-radius:0px'), true);
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.a).includes('box-shadow:none'), true);
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.b).includes('border-radius:12px'), true);
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.b).includes('box-shadow:0 10px 24px'), true);
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.c).includes('border-radius:16px'), true);
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.c).includes('box-shadow:0 22px 48px'), true);
	});

	it('只有动画形态带 animation（180ms）', () => {
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.a).includes('animation:'), false);
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.b).includes('animation:tb3d-rise .18s ease-out'), true);
		assert.equal(drawerPanelCssOf(DRAWER_VARIANTS.c).includes('animation:tb3d-rise .18s ease-out'), true);
	});

	it('阴影档 → CSS 值：none / soft / strong 三个不同值', () => {
		const values = [drawerShadowCssOf('none'), drawerShadowCssOf('soft'), drawerShadowCssOf('strong')];
		assert.equal(new Set(values).size, 3);
		assert.equal(values[0], 'none');
	});

	it('⭐ 入口：left:-32px（右边缘贴输入框左边缘）、bottom:4px（和 + 居中）', () => {
		const css = drawerEntryCssOf();
		assert.equal(css.includes(`left:${String(-DRAWER_ENTRY_SIZE_PX)}px`), true);
		assert.equal(css.includes(`bottom:${String(DRAWER_ENTRY_BOTTOM_PX)}px`), true);
		assert.equal(css.includes('width:32px'), true);
		assert.equal(css.includes('height:32px'), true);
	});

	it('⭐ 入口居中是人算的：6 + (28 - 32) / 2 = 4', () => {
		assert.equal(DRAWER_TOOL_ROW_PAD_BOTTOM_PX, 6);
		assert.equal(DRAWER_TOOL_ROW_BUTTON_PX, 28);
		assert.equal(DRAWER_ENTRY_BOTTOM_PX, 4);
	});

	it('遮罩是 fixed 铺满 + 半透明（只有 c 渲染它）', () => {
		const css = drawerMaskCssOf();
		assert.equal(css.includes('position:fixed'), true);
		assert.equal(css.includes('inset:0'), true);
		assert.equal(css.includes('rgb(15 23 42 / 28%)'), true);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ④ 共享 store（两个槽靠它看到同一个 open）                  */
/* ══════════════════════════════════════════════════════════ */

describe('④ 共享 store', () => {
	it('初始默认关；传 true 则开；快照是冻结对象', () => {
		const closed = createDrawerStore('a');
		assert.equal(closed.getSnapshot(), DRAWER_CLOSED);
		const open = createDrawerStore('a', true);
		assert.equal(open.getSnapshot(), DRAWER_OPEN);
		assert.equal(Object.isFrozen(DRAWER_CLOSED), true);
		assert.equal(Object.isFrozen(DRAWER_OPEN), true);
	});

	it('toggle 翻面两次回到原点（且同一状态是同一对象）', () => {
		const store = createDrawerStore('a');
		const first = store.getSnapshot();
		store.toggle();
		assert.equal(store.getSnapshot(), DRAWER_OPEN);
		store.toggle();
		assert.equal(store.getSnapshot(), first);
	});

	it('⭐ 订阅者在状态真变化时被通知；无变化不空转', () => {
		const store = createDrawerStore('a');
		let calls = 0;
		const unsubscribe = store.subscribe(() => {
			calls += 1;
		});
		store.open(); /* 关 → 开 */
		assert.equal(calls, 1);
		store.open(); /* 已经开着 ⇒ 不通知 */
		assert.equal(calls, 1);
		store.close(); /* 开 → 关 */
		assert.equal(calls, 2);
		store.close(); /* 已经关着 ⇒ 不通知 */
		assert.equal(calls, 2);
		unsubscribe();
		store.toggle();
		assert.equal(calls, 2);
	});

	it('取消订阅之后不再收到通知', () => {
		const store = createDrawerStore('a');
		let calls = 0;
		const unsubscribe = store.subscribe(() => {
			calls += 1;
		});
		unsubscribe();
		store.toggle();
		assert.equal(calls, 0);
	});

	it('两个 session 两个 store，互不影响（形态相同、状态独立）', () => {
		const one = createDrawerStore('b');
		const two = createDrawerStore('b');
		one.toggle();
		assert.equal(one.getSnapshot().open, true);
		assert.equal(two.getSnapshot().open, false);
		assert.equal(one.variant, 'b');
		assert.equal(two.variant, 'b');
	});

	it('store 本身冻结（不能换掉 getSnapshot / subscribe）', () => {
		assert.equal(Object.isFrozen(createDrawerStore('a')), true);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ⑤ 关闭条件                                                 */
/* ══════════════════════════════════════════════════════════ */

describe('⑤ 关闭条件', () => {
	it('Escape 关；组字中不关；别的键不关', () => {
		assert.equal(isDrawerCloseKey('Escape'), true);
		assert.equal(isDrawerCloseKey('Escape', true), false);
		for (const key of ['Enter', 'Esc', 'e', 'Tab']) {
			assert.equal(isDrawerCloseKey(key), false);
		}
	});

	it('点外面 ⇒ 关', () => {
		assert.equal(closesDrawerOn({ inPanel: false, inTrigger: false, inStatusMenu: false }), true);
	});

	it('⭐ 三个例外都不关：面板内 / 入口按钮 / 状态菜单', () => {
		assert.equal(closesDrawerOn({ inPanel: true, inTrigger: false, inStatusMenu: false }), false);
		assert.equal(closesDrawerOn({ inPanel: false, inTrigger: true, inStatusMenu: false }), false);
		assert.equal(closesDrawerOn({ inPanel: false, inTrigger: false, inStatusMenu: true }), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ⑥ CSS 由表插值生成（表改 CSS 跟着变）                      */
/* ══════════════════════════════════════════════════════════ */

describe('⑥ CSS 由表插值生成', () => {
	it('⭐ 三个形态的几何声明都出现在 DRAWER_CSS 里', () => {
		for (const id of DRAWER_VARIANT_IDS) {
			assert.equal(
				DRAWER_CSS.includes(`.tb3d-panel[data-drawer-variant="${id}"]{${drawerPanelCssOf(DRAWER_VARIANTS[id])}}`),
				true,
				`CSS 里缺形态 ${id} 的规则`,
			);
		}
	});

	it('入口定位与遮罩声明由函数插值（不是 CSS 里另写一份）', () => {
		assert.equal(DRAWER_CSS.includes(`.tb3d-entry{\n  position:absolute;${drawerEntryCssOf()};`), true);
		assert.equal(DRAWER_CSS.includes(`.tb3d-mask{${drawerMaskCssOf()};`), true);
	});

	it('⭐ 面板不用 position:fixed —— 全 CSS 里 fixed 只出现在遮罩那一条', () => {
		const fixedCount = DRAWER_CSS.split('position:fixed').length - 1;
		assert.equal(fixedCount, 1);
		const panelBase = DRAWER_CSS.slice(
			DRAWER_CSS.indexOf('.tb3d-panel{'),
			DRAWER_CSS.indexOf('/* 候选 B / C'),
		);
		assert.equal(panelBase.includes('position:fixed'), false);
	});

	it('压缩间距数值来自 DRAWER_COMPACT_SPACING（表改 CSS 跟着变）', () => {
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

	it('压缩间距表每个数都对（改一个数这里就红）', () => {
		assert.deepEqual(DRAWER_COMPACT_SPACING, {
			headerHeight: 36,
			pagePadY: 6,
			pagePadX: 12,
			toolbarGap: 0,
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
		assert.equal(Object.isFrozen(DRAWER_COMPACT_SPACING), true);
	});

	it('面板自己不滚，两栏各自滚（overflow 只在两栏里）', () => {
		assert.equal(DRAWER_CSS.includes('.tb3d-body{flex:1 1 auto;display:flex;min-height:0;overflow:hidden}'), true);
	});

	it('筛选行 / 图例 / 列名行在抽屉里被收掉', () => {
		assert.equal(DRAWER_CSS.includes('.tb3d-panel .tb3w-filters{display:none}'), true);
		assert.equal(DRAWER_CSS.includes('.tb3d-panel .tb3w-toolbar__legend{display:none}'), true);
		assert.equal(DRAWER_CSS.includes('.tb3d-panel .tb3w-list__cols{display:none}'), true);
	});

	it('有上滑动画 keyframes + 尊重 prefers-reduced-motion', () => {
		assert.equal(DRAWER_CSS.includes('@keyframes tb3d-rise'), true);
		assert.equal(DRAWER_CSS.includes('prefers-reduced-motion:reduce'), true);
	});
});
