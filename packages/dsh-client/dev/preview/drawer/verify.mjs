/**
 * 验证抽屉（V5 重做）—— **SSR 结构断言**。
 *
 * `node dev/preview/drawer/verify.mjs`（在 `packages/dsh-client` 目录下跑）
 *
 * ## 为什么不用 CDP
 *
 * 这个沙箱起不来 Chromium：DSH 沙箱禁命名管道，mojo IPC 必然失败（多人验证过）。
 * ⇒ 用 `react-dom/server` 的 `renderToStaticMarkup` 断言 **DOM 结构 + CSS 文本**，
 *   **截图放弃** —— 视觉请用户双击两个 `index.html` 看（报告里给绝对路径）。
 *
 * ## 七层证据
 *
 * 1. **纯逻辑速查**：3 个形态 / 高度公式 / 几何声明（完整单测在 `test/drawer-view.test.ts`）；
 * 2. **入口**：三个形态的 DOM（图标不同、aria、`data-drawer-trigger`）；
 * 3. **面板**：关=空串；开=层/面板/顶栏/压缩版 Workspace；
 * 4. **mock composer 结构**：入口在工具行里、`+` 在它左边、overlay anchor 在卡片顶部；
 * 5. **两个槽注册**：假 ctx 驱动 `registerDrawerSlots`，证明两个槽拿到**同一个 store**；
 * 6. **CSS 硬约束**：无 fixed 面板 / 遮罩才有 fixed / 数值来自形态表；
 * 7. **两个预览产物**：自包含、脚本能编译、关键标记在。
 *
 * 不假装测了像素 / 点击 / 滚动 / 截图 —— 最后「没测到的」清单里写明。
 */

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

import { rolldown } from 'rolldown';

const HERE = import.meta.dirname;
const ENTRY = nodePath.join(HERE, 'ssr-entry.tsx');
/** 临时产物：必须落在包目录内，否则 `import 'react'` 解析不到 node_modules。 */
const BUNDLE = nodePath.join(HERE, '.verify-ssr.mjs');
const PREVIEW_COMPARE_HTML = nodePath.join(HERE, 'index.html');
const PREVIEW_COMPOSER_HTML = nodePath.join(HERE, '..', 'drawer-composer', 'index.html');

let total = 0;
const failures = [];

/** 断言：JSON 相等。 */
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok)
		failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

/** 出现次数。 */
const countOf = (html, needle) => html.split(needle).length - 1;

/** 取一段 HTML（从 `startNeedle` 到下一个 `endNeedle`；找不到时给空串）。 */
const sliceOf = (html, startNeedle, endNeedle) => {
	const start = html.indexOf(startNeedle);
	if (start < 0) return '';
	const end = endNeedle === undefined ? -1 : html.indexOf(endNeedle, start + 1);
	return html.slice(start, end < 0 ? html.length : end);
};

/* ══════════════════════════════════════════════════════════
   ① 打包 SSR 入口（rolldown，和 build.mjs 同一套工具）
   ══════════════════════════════════════════════════════════ */

console.log('打包 SSR 入口…');
const bundle = await rolldown({
	input: ENTRY,
	platform: 'node',
	jsx: 'react-jsx',
	external: ['react', 'react/jsx-runtime', 'react-dom/server'],
	define: {
		'process.env.NODE_ENV': '"development"',
	},
});
const { output } = await bundle.generate({ format: 'esm', sourcemap: false });
await bundle.close();
const code = output
	.filter((one) => one.type === 'chunk')
	.map((one) => one.code)
	.join('\n');
writeFileSync(BUNDLE, code, 'utf8');

let mod;
try {
	mod = await import(pathToFileURL(BUNDLE).href);
} finally {
	unlinkSync(BUNDLE);
}

const { DRAWER_CSS, WORKSPACE_CSS, DRAWER_VARIANTS, DRAWER_VARIANT_IDS } = mod;

/* ══════════════════════════════════════════════════════════
   ② 纯逻辑速查（完整单测在 test/drawer-view.test.ts）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ② 纯逻辑速查（同一份模块；完整单测在 test/drawer-view.test.ts）═══');
{
	expect('恰好 3 个候选形态', [...DRAWER_VARIANT_IDS], ['a', 'b', 'c']);
	expect(
		'⭐ 三个入口图标互不相同（▣ / ▲ / ⋯）',
		new Set(DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].icon)).size,
		3,
	);
	expect(
		'⭐ 间距候选 0 / 6 / 12',
		DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].gapPx),
		[0, 6, 12],
	);
	expect(
		'⭐ 圆角候选 0 / 12 / 16',
		DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].radiusPx),
		[0, 12, 16],
	);
	expect(
		'高度候选：a/b 为 min(50vh,480px)，c 为 50vh',
		DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].heightMode),
		['capped-half', 'capped-half', 'half'],
	);
	expect('遮罩只有 c；动画 b / c', [
		DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].mask),
		DRAWER_VARIANT_IDS.map((id) => DRAWER_VARIANTS[id].animated),
	], [
		[false, false, true],
		[false, true, true],
	]);
	expect(
		'⭐ 高度公式（数值版）：900 屏高 450 / 1200 屏高 a=480、c=600',
		[
			mod.drawerHeightPxOf(DRAWER_VARIANTS.a, 900),
			mod.drawerHeightPxOf(DRAWER_VARIANTS.c, 900),
			mod.drawerHeightPxOf(DRAWER_VARIANTS.a, 1200),
			mod.drawerHeightPxOf(DRAWER_VARIANTS.c, 1200),
		],
		[450, 450, 480, 600],
	);
	expect('入口几何：left:-32px、bottom:4px', [
		mod.drawerEntryCssOf().includes('left:-32px'),
		mod.drawerEntryCssOf().includes('bottom:4px'),
	], [true, true]);
	expect('默认形态是 a（占位，等用户裁定）', mod.DRAWER_DEFAULT_VARIANT_ID, 'a');
}

/* ══════════════════════════════════════════════════════════
   ③ 入口按钮（conversation.input.left）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ③ 入口按钮（正方形，输入框左外侧）═══');
{
	const entries = Object.fromEntries(
		DRAWER_VARIANT_IDS.map((id) => [id, mod.renderEntry(id, true)]),
	);
	expect(
		'⭐ 三个形态各自的入口图标不同（square / arrow-up / dots）',
		DRAWER_VARIANT_IDS.map((id) => drawEntryIconOf(entries[id])),
		['square', 'arrow-up', 'dots'],
	);
	expect('入口是 button + 正方形样式类 .tb3d-entry', [
		countOf(entries.a, 'class="tb3d-entry"'),
		countOf(entries.a, 'data-drawer-entry="1"'),
	], [1, 1]);
	expect('入口带 data-drawer-trigger（点外部判决要跳过它）', countOf(entries.a, 'data-drawer-trigger="entry"'), 1);
	expect('打开态 aria-expanded=true', entries.a.includes('aria-expanded="true"'), true);
	expect('关闭态 aria-expanded=false', mod.renderEntry('a', false).includes('aria-expanded="false"'), true);
	expect('aria-controls 指向面板 id', [
		entries.a.includes(`aria-controls="${mod.DRAWER_PANEL_ID}"`),
		mod.DRAWER_PANEL_ID,
	], [true, 'tb3d-drawer-panel']);
	expect('入口带形态标注 data-drawer-variant', [
		entries.a.includes('data-drawer-variant="a"'),
		entries.b.includes('data-drawer-variant="b"'),
		entries.c.includes('data-drawer-variant="c"'),
	], [true, true, true]);
	expect('入口无障碍名明确（关=打开 / 开=收起）', [
		mod.renderEntry('a', false).includes('aria-label="打开任务板抽屉"'),
		entries.a.includes('aria-label="收起任务板抽屉"'),
	], [true, true]);
}

/** 从入口 HTML 里读图标标注。 */
function drawEntryIconOf(html) {
	const match = /data-drawer-entry-icon="([^"]+)"/.exec(html);
	return match === null ? null : match[1];
}

/* ══════════════════════════════════════════════════════════
   ④ 面板（conversation.input.overlay）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ④ 面板：关=空串；开=层/面板/顶栏/Workspace ═══');
{
	const closed = mod.renderDrawer('a', { open: false });
	expect('⭐ 关着时 HTML 是空串（不占位、不拦截事件）', closed, '');
	expect('关着时没有面板', countOf(closed, 'data-drawer="1"'), 0);

	const open = mod.renderDrawer('a');
	expect('有零高 overlay 层（长在 DSH 的 overlayAnchor 里）', countOf(open, 'data-drawer-layer="1"'), 1);
	expect('有面板', countOf(open, 'data-drawer="1"'), 1);
	expect('面板是 dialog', open.includes('role="dialog"'), true);
	expect('无遮罩形态 aria-modal=false（不锁焦点）', open.includes('aria-modal="false"'), true);
	expect('无障碍名 = 任务板', open.includes('aria-label="任务板"'), true);
	expect('面板 id（入口 aria-controls 指向它）', open.includes(`id="${mod.DRAWER_PANEL_ID}"`), true);
	expect('顶栏标题在', countOf(open, 'data-drawer-title'), 1);
	expect('有关闭按钮', countOf(open, 'data-drawer-close="1"'), 1);
	expect('默认没有刷新按钮（不知道刷什么就不假装有）', countOf(open, 'data-drawer-refresh="1"'), 0);

	const withRefresh = mod.renderDrawer('a', { title: '抽屉标题', onRefresh: true });
	expect('传 onRefresh ⇒ 顶栏出现刷新按钮', countOf(withRefresh, 'data-drawer-refresh="1"'), 1);
	expect('标题可由 props 覆盖', withRefresh.includes('data-drawer-title="true">抽屉标题<'), true);
}

/* ══════════════════════════════════════════════════════════
   ⑤ 形态差异落到 DOM（用户要「全部过目」的三个）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑤ 三个形态的 DOM 差异 ═══');
{
	const panels = Object.fromEntries(
		DRAWER_VARIANT_IDS.map((id) => [id, mod.renderDrawer(id)]),
	);

	expect(
		'⭐ 形态标注 + 间距/圆角/高度档逐形态正确',
		DRAWER_VARIANT_IDS.map((id) => {
			const html = panels[id];
			return [
				html.includes(`data-drawer-variant="${id}"`),
				html.includes(`data-drawer-gap="${String(DRAWER_VARIANTS[id].gapPx)}"`),
				html.includes(`data-drawer-radius="${String(DRAWER_VARIANTS[id].radiusPx)}"`),
				html.includes(`data-drawer-height="${DRAWER_VARIANTS[id].heightMode}"`),
			];
		}),
		[
			[true, true, true, true],
			[true, true, true, true],
			[true, true, true, true],
		],
	);
	expect(
		'⭐ 遮罩只有候选 C 有（data-drawer-mask）',
		DRAWER_VARIANT_IDS.map((id) => countOf(panels[id], 'data-drawer-mask="1"')),
		[0, 0, 1],
	);
	expect('有遮罩的候选 C 是模态（aria-modal=true）', panels.c.includes('aria-modal="true"'), true);
	expect(
		'⭐ 面板里有压缩版 Workspace（真组件，不是复制）',
		[
			panels.a.includes('data-drawer-body="1"'),
			panels.a.includes('class="tb3w-root"'),
			panels.a.includes('data-view="list"'),
		],
		[true, true, true],
	);
	{
		const body = sliceOf(panels.a, 'data-drawer-body="1"');
		const listBody = sliceOf(body, 'data-list-body="true"');
		const ids = [...listBody.matchAll(/data-card-id="(GU-\d\d)"/g)].map((one) => one[1]);
		expect(
			'⭐ 抽屉里画的是 5 张卡（按最后动过倒序）',
			ids.slice(0, 5),
			['GU-03', 'GU-02', 'GU-01', 'GU-04', 'GU-05'],
		);
		expect('选中卡是 GU-02', body.includes('data-card-detail="true" data-card-id="GU-02"'), true);
		expect('空间 chip 行在', body.includes('data-chip-id="default"'), true);
		expect('「显示已归档」开关在', body.includes('data-archived-toggle="1"'), true);
		expect('视图切换（科技树 / 列表）在', body.includes('data-view-btn="tree"'), true);
		expect('新建按钮在', body.includes('data-create-card'), true);
		expect('筛选框仍在 DOM 里（收起是 CSS 的事，不是删功能）', body.includes('data-box-id="status"'), true);
	}
}

/* ══════════════════════════════════════════════════════════
   ⑥ mock composer 结构（预览「照真结构」的证据）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑥ mock composer：位置关系照真结构 ═══');
{
	const mock = mod.renderMockComposer('a', true);
	expect('mock 有 composer 根 / 卡片 / overlay anchor / 工具行', [
		countOf(mock, 'data-mock-composer-root="1"'),
		countOf(mock, 'data-mock-composer-card="1"'),
		countOf(mock, 'data-mock-overlay-anchor="1"'),
		countOf(mock, 'data-mock-tool-row="1"'),
	], [1, 1, 1, 1]);
	expect('⭐ overlay anchor 在卡片里、编辑区之前（面板从卡片顶部向上长）', [
		mock.indexOf('data-mock-overlay-anchor') < mock.indexOf('data-mock-editor'),
		mock.indexOf('data-mock-overlay-anchor') > mock.indexOf('data-mock-composer-card'),
	], [true, true]);
	expect('⭐ 入口在工具行里、`+` 之后、trailing 之前（= conversation.input.left 的真实位置）', [
		mock.indexOf('data-mock-tools') < mock.indexOf('data-drawer-entry'),
		mock.indexOf('data-mock-add') < mock.indexOf('data-drawer-entry'),
		mock.indexOf('data-drawer-entry') < mock.indexOf('data-mock-trailing'),
	], [true, true, true]);
	{
		const tools = sliceOf(mock, 'data-mock-tools="1"', 'data-mock-trailing="1"');
		expect('入口确实在工具行 HTML 段里（不是挂在别处）', tools.includes('data-drawer-entry="1"'), true);
		expect('工具行里有 + 和权限控件（真 composer 那张行的内容）', [
			tools.includes('data-mock-add="1"'),
			tools.includes('完全权限'),
		], [true, true]);
	}
	{
		/* 面板 section 的 class 在 data-drawer 之前，不能从 data-drawer 起切片。 */
		expect('mock 里抽屉面板是真的（同一份 Drawer）', [
			countOf(mock, 'class="tb3d-panel"'),
			countOf(mock, `id="${mod.DRAWER_PANEL_ID}"`),
		], [1, 1]);
		const body = sliceOf(mock, 'data-drawer-body="1"');
		expect('mock 里面板内容是真的 Workspace', body.includes('class="tb3w-root"'), true);
	}
	expect('mock 里没有手搓的假抽屉（不该出现二次实现）', countOf(mock, 'data-drawer="1"'), 1);
}

/* ══════════════════════════════════════════════════════════
   ⑦ 两个槽的注册（假 ctx 驱动真 registerDrawerSlots）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑦ 两个槽的注册：照斜杠菜单的写法 + 同一 store ═══');
{
	/** 造一个记录调用的假 ctx（只实现 registerDrawerSlots 用到的两个方法）。 */
	const makeCtx = () => {
		const calls = [];
		const ctx = {
			slots: {
				inject(name, factory) {
					calls.push({ type: 'inject', name });
					return factory();
				},
				register(options, component) {
					calls.push({ type: 'register', options, component });
					return () => {};
				},
			},
		};
		return { ctx, calls };
	};

	const first = makeCtx();
	const workspace = mod.sampleWorkspaceProps();
	mod.registerDrawerSlots(first.ctx, { workspace, variant: 'b', title: '任务板' });

	const injects = first.calls.filter((one) => one.type === 'inject');
	const regs = first.calls.filter((one) => one.type === 'register');

	expect(
		'⭐ 注入两个槽：conversation.input.left / conversation.input.overlay',
		injects.map((one) => one.name),
		['conversation.input.left', 'conversation.input.overlay'],
	);
	expect(
		'⭐ 两个注册的 name / id / order 与斜杠菜单同形状',
		regs.map((one) => [one.options.name, one.options.id, one.options.order]),
		[
			['conversation.input.left', 'taskboard3-drawer-entry', 100],
			['conversation.input.overlay', 'taskboard3-drawer-panel', 50],
		],
	);
	expect('注册的组件就是入口 / 面板 slot 组件', [
		regs[0].component === mod.DrawerEntrySlot,
		regs[1].component === mod.DrawerPanelSlot,
	], [true, true]);
	expect('两个注册都带 label（list 槽的显示名）', [
		typeof regs[0].options.label === 'string',
		typeof regs[1].options.label === 'string',
	], [true, true]);

	const entryInjected = regs[0].options.inject('session-1');
	const panelInjected = regs[1].options.inject('session-1');
	expect(
		'⭐ 同一 session：入口与面板拿到**同一个 store 对象**（否则开合会不同步）',
		entryInjected.hooks.drawer === panelInjected.hooks.drawer,
		true,
	);
	expect('形态 b 传到了 store', entryInjected.hooks.drawer.variant, 'b');
	expect('面板注入里有 Workspace 数据（5 个空间）', panelInjected.workspace.workspaces.length, 5);
	expect('面板注入里的标题是调用方给的', panelInjected.title, '任务板');

	entryInjected.hooks.drawer.toggle();
	expect('⭐ 入口 toggle ⇒ 面板那个 store 也开了（共享状态真的连通）', [
		entryInjected.hooks.drawer.getSnapshot().open,
		panelInjected.hooks.drawer.getSnapshot().open,
	], [true, true]);

	const otherInjected = regs[1].options.inject('session-2');
	expect(
		'不同 session：各一份 store，互不影响',
		[
			otherInjected.hooks.drawer === panelInjected.hooks.drawer,
			otherInjected.hooks.drawer.getSnapshot().open,
		],
		[false, false],
	);

	/* 不传 variant ⇒ 默认占位形态 a */
	const second = makeCtx();
	mod.registerDrawerSlots(second.ctx, { workspace: mod.sampleWorkspaceProps() });
	const secondRegs = second.calls.filter((one) => one.type === 'register');
	expect(
		'不传 variant ⇒ 默认形态 a（占位，等用户裁定）',
		secondRegs[0].options.inject('s').hooks.drawer.variant,
		'a',
	);
}

/* ══════════════════════════════════════════════════════════
   ⑧ CSS 硬约束
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑧ CSS 硬约束（用户设计硬约束）═══');
{
	expect(
		'⭐ 面板不用 position:fixed —— 全 CSS 里 fixed 只出现在遮罩那一条',
		DRAWER_CSS.split('position:fixed').length - 1,
		1,
	);
	expect('遮罩本身是 fixed 铺满 + 半透明', [
		DRAWER_CSS.includes('.tb3d-mask{position:fixed;inset:0;background:rgb(15 23 42 / 28%)'),
	], [true]);
	expect(
		'⭐ 面板底边 = 100% + 形态间距（结构保证「贴输入框上边缘」）',
		DRAWER_VARIANT_IDS.map((id) => DRAWER_CSS.includes(`bottom:calc(100% + ${String(DRAWER_VARIANTS[id].gapPx)}px)`)),
		[true, true, true],
	);
	expect(
		'⭐ 面板高度按形态插值（min / half 都在 CSS 里）',
		[
			DRAWER_CSS.includes('height:min(calc(var(--tb3d-vh,100vh) * 0.5), 480px)'),
			DRAWER_CSS.includes('height:calc(var(--tb3d-vh,100vh) * 0.5)'),
		],
		[true, true],
	);
	expect(
		'⭐ 入口定位由表插值：left:-32px / bottom:4px',
		[
			DRAWER_CSS.includes('left:-32px;bottom:4px;width:32px;height:32px'),
		],
		[true],
	);
	expect(
		'⭐ 阴影逐形态不同（none / soft / strong）',
		DRAWER_VARIANT_IDS.map((id) => DRAWER_CSS.includes(`box-shadow:${mod.drawerShadowCssOf(DRAWER_VARIANTS[id].shadow)}`)),
		[true, true, true],
	);
	expect('动画形态带 animation、无动画形态不带', [
		DRAWER_CSS.includes('.tb3d-panel[data-drawer-variant="b"]{bottom:calc(100% + 6px);border-radius:12px;height:min(calc(var(--tb3d-vh,100vh) * 0.5), 480px);box-shadow:0 10px 24px rgb(15 23 42 / 16%);animation:tb3d-rise .18s ease-out}'),
		DRAWER_CSS.includes('.tb3d-panel[data-drawer-variant="a"]{bottom:calc(100% + 0px);border-radius:0px;height:min(calc(var(--tb3d-vh,100vh) * 0.5), 480px);box-shadow:none}'),
	], [true, true]);

	const s = mod.DRAWER_COMPACT_SPACING;
	expect(
		'⭐ 压缩间距数值由 pure 表插值生成（表改 CSS 跟着变）',
		[
			DRAWER_CSS.includes(`padding:${s.pagePadY}px ${s.pagePadX}px`),
			DRAWER_CSS.includes(`margin-top:${s.mainGap}px`),
			DRAWER_CSS.includes(`margin-bottom:${s.cardGap}px`),
			DRAWER_CSS.includes(`padding:${s.cardPadY}px 10px`),
			DRAWER_CSS.includes(`gap:${s.detailGap}px`),
			DRAWER_CSS.includes(`height:${s.headerHeight}px`),
		],
		[true, true, true, true, true, true],
	);
	expect(
		'⭐ 只收纵向：三块 chrome 收掉（筛选 / 图例 / 列名）',
		[
			DRAWER_CSS.includes('.tb3d-panel .tb3w-filters{display:none}'),
			DRAWER_CSS.includes('.tb3d-panel .tb3w-toolbar__legend{display:none}'),
			DRAWER_CSS.includes('.tb3d-panel .tb3w-list__cols{display:none}'),
		],
		[true, true, true],
	);
	expect('宽版左列固定 320、容器 <700 时让位给堆叠', [
		DRAWER_CSS.includes('@container tb3w (min-width: 700px)'),
		DRAWER_CSS.includes('.tb3d-panel .tb3w-list{flex:0 0 320px}'),
	], [true, true]);
	expect('两栏各自滚，面板主体不自滚', [
		DRAWER_CSS.includes('.tb3d-body{flex:1 1 auto;display:flex;min-height:0;overflow:hidden}'),
		WORKSPACE_CSS.includes('.tb3w-list__body{flex:1 1 auto;min-height:0;overflow-y:auto'),
	], [true, true]);
	expect('上滑动画 + 尊重 prefers-reduced-motion', [
		DRAWER_CSS.includes('@keyframes tb3d-rise'),
		DRAWER_CSS.includes('prefers-reduced-motion:reduce'),
	], [true, true]);
}

/* ══════════════════════════════════════════════════════════
   ⑨ 两个预览产物（用户双击的就是它们）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑨ 两个预览产物（双击 index.html 能看）═══');

/** 读一个构建产物；没构建时给空串（断言会红）。 */
const readPreview = (path) => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return '';
	}
};

/** 产物通用检查：自包含 + 内联脚本能编译。 */
const checkArtifact = (label, path, needles) => {
	const html = readPreview(path);
	expect(`${label}：index.html 已构建`, html.length > 0, true);
	for (const needle of needles) {
		expect(`${label} 产物含：${needle}`, html.includes(needle), true);
	}
	expect(
		`${label} 是自包含的（无 <script src= / <link rel="stylesheet">，file:// 直开）`,
		/<script src=|<link rel="stylesheet"/.test(html),
		false,
	);
	const start = html.indexOf('<script>');
	const end = html.indexOf('</script>', start);
	const js = html.slice(start + '<script>'.length, end);
	let syntaxOk = true;
	try {
		new vm.Script(js);
	} catch {
		syntaxOk = false;
	}
	expect(`${label} 内联脚本能被 V8 编译（不是坏语法）`, syntaxOk, true);
	expect(`${label} 内联脚本非空`, js.length > 50000, true);
};

checkArtifact('候选对比页', PREVIEW_COMPARE_HTML, [
	'抽屉 V5 · 候选形态对比',
	'.tb3d-entry',
	'.tb3d-panel',
	'data-variant-column',
	'data-screen-btn',
	'任务板',
]);
checkArtifact('单栏模拟页', PREVIEW_COMPOSER_HTML, [
	'抽屉 V5 · 单栏模拟',
	'.tb3d-entry',
	'.tb3d-panel',
	'data-single-column',
	'data-variant-btn',
	'data-mock-composer-card',
]);

/* ══════════════════════════════════════════════════════════
   ⑩ 结果 + 诚实清单
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  SSR 断言数 ${total}（失败 ${failures.length}）`);

console.log('\n═══ ⚠ 没测到的（需要真浏览器，这里不假装）═══');
console.log('  ✗ 面板是否真的贴在输入框上边缘 / 宽度是否真的等于输入框 —— 要布局（getBoundingClientRect）');
console.log('  ✗ 入口正方形是否真的在卡片左外侧、和 + 垂直居中 —— 要真实 composer 的 side-clearance');
console.log('  ✗ Esc / 点外部 / 点遮罩是否真的关 —— 要 DOM 事件');
console.log('  ✗ 两栏是否真的各自滚、面板是否真的不滚 —— 要 scrollHeight / clientHeight');
console.log('  ✗ 50vh / min(50vh,480px) 是否真的算出那个像素 —— 要真排版（当前只有公式数值版）');
console.log('  ✗ 上滑动画、圆角、阴影、遮罩透明度 —— 要截图');
console.log('  ⇒ 交互判决的可信度来自 test/drawer-view.test.ts（node --test，纯函数）');
console.log('  ⇒ 视觉请用户双击 dev/preview/drawer/index.html 和 dev/preview/drawer-composer/index.html 看');

process.exit(failures.length > 0 ? 1 : 0);
