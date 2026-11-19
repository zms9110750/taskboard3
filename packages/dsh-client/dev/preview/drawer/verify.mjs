/**
 * 验证抽屉（V4）—— **SSR 结构断言**。
 *
 * `node dev/preview/drawer/verify.mjs`（在 `packages/dsh-client` 目录下跑）
 *
 * ## 为什么不用 CDP
 *
 * 这个沙箱起不来 Chromium：DSH 沙箱禁命名管道，mojo IPC 必然失败（多人验证过）。
 * ⇒ 用 `react-dom/server` 的 `renderToStaticMarkup` 断言 **DOM 结构 + CSS 文本**。
 *
 * ## 三层证据
 *
 * 1. **结构**（本文件 ①–⑤）：抽屉层/面板/顶栏/触发器、第二个 Workspace 实例；
 * 2. **判决**（`test/drawer-view.test.ts`，35 条 `node --test`）：开合、三个入口同动作、
 *    Esc / 点外部、间距档位 —— 直接测同一份纯函数源码；
 * 3. **产物**（本文件 ⑧）：双击 `index.html` 能自包含打开。
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
const PREVIEW_HTML = nodePath.join(HERE, 'index.html');

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

const renderDrawer = mod.renderDrawer;
const renderTwoInstances = mod.renderTwoInstances;
const renderToggle = mod.renderToggle;
const DRAWER_CSS = mod.DRAWER_CSS;
const WORKSPACE_CSS = mod.WORKSPACE_CSS;

/* ══════════════════════════════════════════════════════════
   ② 纯逻辑速查（完整 35 条在 test/drawer-view.test.ts）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ② 纯逻辑速查（同一份模块；完整 35 条在 test/drawer-view.test.ts）═══');
{
	expect('设计尺寸 1200 × 400', [mod.DRAWER_WIDTH, mod.DRAWER_HEIGHT], [1200, 400]);
	expect('compact 阈值 560', mod.DRAWER_COMPACT_MAX_HEIGHT, 560);
	expect('400 高 ⇒ compact 档', mod.drawerTierOf(400), 'compact');
	expect('561 高 ⇒ regular 档', mod.drawerTierOf(561), 'regular');
	expect(
		'⭐ 三个入口（chevron / toolbar / detail-expand）恒派发同一个 toggle 事件',
		mod.DRAWER_TRIGGER_SOURCES.map((source) => mod.triggerEventOf(source) === mod.DRAWER_TOGGLE_EVENT),
		[true, true, true],
	);
	expect(
		'⭐ 三个入口从关到开、从开到关完全一致',
		mod.DRAWER_TRIGGER_SOURCES.map((source) => [
			mod.triggeredDrawerState(source, mod.DRAWER_CLOSED) === mod.DRAWER_OPEN,
			mod.triggeredDrawerState(source, mod.DRAWER_OPEN) === mod.DRAWER_CLOSED,
		]),
		[
			[true, true],
			[true, true],
			[true, true],
		],
	);
	expect('toggle 翻面两次回到原点', mod.reduceDrawer(mod.reduceDrawer(mod.DRAWER_CLOSED, mod.DRAWER_TOGGLE_EVENT), mod.DRAWER_TOGGLE_EVENT), mod.DRAWER_CLOSED);
	expect('Esc ⇒ 关；组字中的 Esc 不关', [mod.isDrawerCloseKey('Escape'), mod.isDrawerCloseKey('Escape', true)], [true, false]);
	expect(
		'点外部三例外：面板内 / 触发器 / 状态菜单都不关',
		[
			mod.closesDrawerOn({ inPanel: false, inTrigger: false, inStatusMenu: false }),
			mod.closesDrawerOn({ inPanel: true, inTrigger: false, inStatusMenu: false }),
			mod.closesDrawerOn({ inPanel: false, inTrigger: true, inStatusMenu: false }),
			mod.closesDrawerOn({ inPanel: false, inTrigger: false, inStatusMenu: true }),
		],
		[true, false, false, false],
	);
	expect(
		'⭐ 400 高收掉三块 chrome：筛选 / 图例 / 列名',
		mod.drawerChromeOf(400),
		{ showFilters: false, showLegend: false, showListCols: false },
	);
	expect('夹具：5 张卡 / 5 个工作区（含 1 个归档）', [mod.CARDS.length, mod.WORKSPACES.length, mod.WORKSPACES.filter((one) => one.archived).length], [5, 5, 1]);
}

/* ══════════════════════════════════════════════════════════
   ③ 关闭态：什么都不渲染
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ③ 关闭态 ═══');
{
	const closed = renderDrawer(false);
	expect('关着时 HTML 是空串（不占位、不拦截事件）', closed, '');
	expect('关着时没有抽屉面板', countOf(closed, 'data-drawer="1"'), 0);
}

/* ══════════════════════════════════════════════════════════
   ④ 打开态：层 / 面板 / 顶栏 / 尺寸
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ④ 打开态：壳（设计图 ① / ②）═══');
const open = renderDrawer(true);
{
	expect('⭐ 有帧级 overlay 层', countOf(open, 'data-drawer-layer="1"'), 1);
	expect('⭐ 有抽屉面板', countOf(open, 'data-drawer="1"'), 1);
	expect('面板是 dialog', open.includes('role="dialog"'), true);
	expect('⭐ 非模态（aria-modal="false"；不锁焦点）', open.includes('aria-modal="false"'), true);
	expect('无障碍名 = 任务板', open.includes('aria-label="任务板"'), true);
	expect('面板 id（触发器 aria-controls 指向它）', open.includes(`id="${mod.DRAWER_PANEL_ID}"`), true);
	expect('⭐ 尺寸标注 1200 × 400', [
		open.includes('data-drawer-width="1200"'),
		open.includes('data-drawer-height="400"'),
	], [true, true]);
	expect('⭐ 400 高 ⇒ compact 档标注', open.includes('data-drawer-tier="compact"'), true);
	expect('顶栏标题是「任务板」', countOf(open, 'data-drawer-title'), 1);
	expect('有关闭按钮', countOf(open, 'data-drawer-close="1"'), 1);
	expect('默认没有刷新按钮（不知道刷什么就不假装有）', countOf(open, 'data-drawer-refresh="1"'), 0);
	expect('默认不写 style（底边距走 CSS 默认 16）', open.includes('--tb3d-bottom'), false);

	const withRefresh = renderDrawer(true, { title: '抽屉标题', onRefresh: true, bottomOffset: 136 });
	expect('传 onRefresh ⇒ 顶栏出现刷新按钮', countOf(withRefresh, 'data-drawer-refresh="1"'), 1);
	expect('标题可由 props 覆盖', withRefresh.includes('>抽屉标题</span>'), true);
	expect('⭐ 传 bottomOffset ⇒ 写进 CSS 变量（设计图 136）', withRefresh.includes('--tb3d-bottom:136px'), true);
}

/* ══════════════════════════════════════════════════════════
   ⑤ 内部 = 第二个 Workspace（复用，不是复制）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑤ 内部：第二个 Workspace 实例（设计图 ③ / ④）═══');
{
	const body = sliceOf(open, 'data-drawer-body="1"');
	expect('⭐ 面板里有 Workspace 根（.tb3w-root）', body.includes('class="tb3w-root"'), true);
	expect('列表视图', body.includes('data-view="list"'), true);
	expect('详情打开（选中卡 GU-02）', body.includes('data-detail="open"'), true);
	{
		/* 只数列 list body 里的卡（详情里也有 data-card-id，不能混着数） */
		const listBody = sliceOf(body, 'data-list-body="true"');
		const ids = [...listBody.matchAll(/data-card-id="(GU-\d\d)"/g)].map((one) => one[1]);
		expect(
			'⭐ 抽屉里画的是 5 张卡（按最后动过倒序）',
			ids.slice(0, 5),
			['GU-03', 'GU-02', 'GU-01', 'GU-04', 'GU-05'],
		);
		expect('第 6 个 data-card-id 是详情那张卡（同一张 GU-02）', ids[5], 'GU-02');
	}
	expect('选中卡是 GU-02（抽屉实例自己的选择）', body.includes('data-card-detail="true" data-card-id="GU-02"'), true);
	expect('空间 chip 行在（默认工作区）', body.includes('data-chip-id="default"'), true);
	expect('「显示已归档」开关在', body.includes('data-archived-toggle="1"'), true);
	expect('视图切换（科技树 / 列表）在', body.includes('data-view-btn="tree"'), true);
	expect('新建按钮在', body.includes('data-create-card'), true);
	expect('筛选框仍在 DOM 里（收起是 CSS 的事，不是删功能）', body.includes('data-box-id="status"'), true);
}

/* ══════════════════════════════════════════════════════════
   ⑥ 两个实例并存 ⇒ 状态独立
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑥ 两个实例：同一套组件，状态各自独立（设计图 ④）═══');
{
	const two = renderTwoInstances(true);
	expect('⭐ 页签 + 抽屉 = 两个 Workspace 实例', countOf(two, 'class="tb3w-root"'), 2);
	expect('抽屉只有一个', countOf(two, 'data-drawer="1"'), 1);
	expect('页签实例详情选中的卡是 GU-01', two.includes('data-card-detail="true" data-card-id="GU-01"'), true);

	/* 抽两个 detail 的 id，证明两个实例画的是不同的选中卡 */
	const detailIds = [...two.matchAll(/data-card-detail="true" data-card-id="([^"]+)"/g)].map(
		(one) => one[1],
	);
	expect('⭐ 两个实例的详情各画各的卡：页签 GU-01 / 抽屉 GU-02', detailIds, ['GU-01', 'GU-02']);

	const one = renderTwoInstances(false);
	expect('抽屉关着 ⇒ 只剩页签那一个实例', countOf(one, 'class="tb3w-root"'), 1);
}

/* ══════════════════════════════════════════════════════════
   ⑦ 触发器（输入框左侧 Chevron）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑦ 触发器：Chevron（设计图 ②）═══');
{
	const closedToggle = renderToggle(false);
	const openToggle = renderToggle(true);
	expect('关态 aria-expanded=false', closedToggle.includes('aria-expanded="false"'), true);
	expect('开态 aria-expanded=true', openToggle.includes('aria-expanded="true"'), true);
	expect('aria-controls 指向抽屉面板', closedToggle.includes(`aria-controls="${mod.DRAWER_PANEL_ID}"`), true);
	expect('关态是「朝上」的 chevron（可展开）', closedToggle.includes('M5 12.5 L10 7.5 L15 12.5'), true);
	expect('开态是「朝下」的 chevron（可收起）', openToggle.includes('M5 7.5 L10 12.5 L15 7.5'), true);
	expect('触发器带 data-drawer-trigger（点外部判决要跳过它）', countOf(closedToggle, 'data-drawer-trigger="chevron"'), 1);
}

/* ══════════════════════════════════════════════════════════
   ⑧ CSS 硬约束（数值 / 无 fixed / 谁在滚）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑧ CSS 硬约束（用户三条设计硬约束）═══');
{
	expect('⭐ 没有 position:fixed（会逃出父容器，旧版踩过）', [DRAWER_CSS.includes('position:fixed'), DRAWER_CSS.includes('position: fixed')], [false, false]);
	expect('层是 absolute 撑满（= shell.overlay 的约定）', DRAWER_CSS.includes('.tb3d-layer{position:absolute;inset:0'), true);
	expect('⭐ 面板贴底居中、尺寸 1200 × 400', [
		DRAWER_CSS.includes('left:50%;bottom:var(--tb3d-bottom,16px)'),
		DRAWER_CSS.includes('width:min(1200px,calc(100% - 32px))'),
		DRAWER_CSS.includes('height:400px'),
	], [true, true, true]);
	expect('窄父容器时 max-height 兜底（不溢出）', DRAWER_CSS.includes('max-height:calc(100% - var(--tb3d-bottom,16px) - 12px)'), true);

	const s = mod.DRAWER_COMPACT_SPACING;
	expect(
		'⭐ 纵向间距数值由 pure 表插值生成（表改 CSS 跟着变）',
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
	expect('宽版左列固定 320（设计图 316）、容器 <700 时让位给堆叠', [
		DRAWER_CSS.includes('@container tb3w (min-width: 700px)'),
		DRAWER_CSS.includes('.tb3d-panel .tb3w-list{flex:0 0 320px}'),
	], [true, true]);

	/* 「两栏各自滚」：面板自己不滚；滚动在列表 body / 详情面板里（V3 已有） */
	expect('⭐ 面板主体不自滚（overflow:hidden）', DRAWER_CSS.includes('.tb3d-body{flex:1 1 auto;display:flex;min-height:0;overflow:hidden}'), true);
	expect('列表栏自己滚', WORKSPACE_CSS.includes('.tb3w-list__body{flex:1 1 auto;min-height:0;overflow-y:auto'), true);
	expect('详情栏自己滚', WORKSPACE_CSS.includes('.tb3w-detail > .detail{flex:1 1 auto;min-height:0;overflow-y:auto}'), true);

	expect('抽屉升起动画 + 尊重 prefers-reduced-motion', [
		DRAWER_CSS.includes('@keyframes tb3d-rise'),
		DRAWER_CSS.includes('prefers-reduced-motion:reduce'),
	], [true, true]);
}

/* ══════════════════════════════════════════════════════════
   ⑨ 预览产物（用户双击的就是它）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑨ 预览产物（双击 index.html 能看）═══');
{
	let html = '';
	try {
		html = readFileSync(PREVIEW_HTML, 'utf8');
	} catch {
		html = '';
	}
	expect('index.html 已构建', html.length > 0, true);
	for (const needle of ['.tb3d-panel', '.tb3d-trigger', 'tb3d-rise', 'data-drawer-toggle', 'V4 Drawer']) {
		expect(`产物含：${needle}`, html.includes(needle), true);
	}
	for (const stage of ['full', 'panel', 'narrow']) {
		expect(`产物含舞台：${stage}`, html.includes(`"${stage}"`), true);
	}
	expect(
		'产物是自包含的（无 <script src= / <link rel="stylesheet">，file:// 直开）',
		/<script src=|<link rel="stylesheet"/.test(html),
		false,
	);
	{
		const start = html.indexOf('<script>');
		const end = html.indexOf('</script>', start);
		const js = html.slice(start + '<script>'.length, end);
		let syntaxOk = true;
		try {
			new vm.Script(js);
		} catch {
			syntaxOk = false;
		}
		expect('内联脚本能被 V8 编译（不是坏语法）', syntaxOk, true);
		expect('内联脚本非空', js.length > 100000, true);
	}
}

/* ══════════════════════════════════════════════════════════
   ⑩ 结果 + 诚实清单
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  SSR 断言数 ${total}（失败 ${failures.length}）`);

console.log('\n═══ ⚠ 没测到的（需要真浏览器，这里不假装）═══');
console.log('  ✗ 面板是否真的贴父容器底边 / 居中 —— 要布局（getBoundingClientRect）');
console.log('  ✗ Esc / 点外部 / 触发器点击是否真的开合 —— 要 DOM 事件');
console.log('  ✗ 两栏是否真的各自滚、面板是否真的不滚 —— 要 scrollHeight / clientHeight');
console.log('  ✗ 400 高里列表露几行、详情露到第几章 —— 要真排版');
console.log('  ✗ 升起动画、圆角、阴影、颜色 —— 要截图');
console.log('  ⇒ 交互判决的可信度来自 test/drawer-view.test.ts（node --test，35 条）');
console.log('  ⇒ 视觉请用户双击 dev/preview/drawer/index.html 看');

process.exit(failures.length > 0 ? 1 : 0);
