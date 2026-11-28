/**
 * 验证 PermissionPanel —— **SSR 结构断言**。
 *
 * `node packages/dsh-permissions/dev/preview/permission/verify.mjs`
 *
 * ## 为什么不用 CDP（和 searchbox 一样）
 *
 * 这个沙箱起不来 Chromium：DSH 沙箱禁止命名管道，mojo IPC 必然失败。
 * ⇒ 用 `react-dom/server` 的 `renderToStaticMarkup` 断言 **DOM 结构**。
 *
 * ## 断言的「三层证据」
 *
 * 1. **结构**（本文件）：两条轴、六个原生 radio、checked / disabled / 文案挂载在哪；
 * 2. **行为**（`test/permission-view.test.ts`，53 条 `node --test`）：要不要发请求、
 *    乐观更新、失败只回滚失败的那条轴、PATCH body 只带一个字段；
 * 3. **产物**（本文件最后一段）：双击 `index.html` 能自包含打开。
 *
 * 不假装测了像素 / 点击 / 截图 —— 那些在最后「没测到的」清单里写明。
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

/** 取一条轴的 HTML 片段（从它的开始标签到下一个轴开始标签）。 */
const axisSliceOf = (html, key) => {
	const start = html.indexOf(`data-axis="${key}"`);
	if (start < 0) return '';
	const next = html.indexOf('data-axis="', start + 1);
	return html.slice(start, next < 0 ? html.length : next);
};

/** 所有档位 radio 的标签串（用于逐个看 checked / disabled）。 */
const radioTagsOf = (html) => [...html.matchAll(/<input[^>]*data-option-radio="1"[^>]*>/g)].map((one) => one[0]);

/** 被选中的 radio 的 value 列表。 */
const checkedValuesOf = (html) =>
	radioTagsOf(html)
		.filter((tag) => tag.includes('checked'))
		.map((tag) => /value="([^"]*)"/.exec(tag)?.[1] ?? '?');

/** disabled 的 radio 数。 */
const disabledRadiosOf = (html) => radioTagsOf(html).filter((tag) => tag.includes('disabled')).length;

/** 某个档位行的开始标签串（读 data-selected / data-saving / data-disabled）。 */
const optionTagOf = (html, axis, value) => {
	const needle = `data-option-axis="${axis}" data-option-value="${value}"`;
	const at = html.indexOf(needle);
	if (at < 0) return '';
	const start = html.lastIndexOf('<label', at);
	return html.slice(start, html.indexOf('>', at) + 1);
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

const render = mod.renderPermissionPanel;
const { NO_PENDING, beginSave, commitSave, failSave, dismissSaveError } = mod;

/* ── 夹具：真实选项表（core 源码）+ 一个自定义文案版本 ── */
const CARD_OPTIONS = mod.CARD_ACTION_OPTIONS;
const TOOL_OPTIONS = mod.TOOL_GUARD_OPTIONS;

const snapshotOf = (cardLevel, toolLevel, cardOptions = CARD_OPTIONS, toolOptions = TOOL_OPTIONS) => ({
	cardActionLevel: cardLevel,
	toolGuardLevel: toolLevel,
	cardActionOptions: cardOptions,
	toolGuardOptions: toolOptions,
});

const READY = {
	phase: 'ready',
	snapshot: snapshotOf('claim', 'manage'),
	pending: NO_PENDING,
	saveError: null,
};
const LOADING = { phase: 'loading' };
const LOAD_ERROR = {
	phase: 'load-error',
	message: '无法连接任务板服务：fetch failed（演示）',
};

const CUSTOM_SNAPSHOT = snapshotOf(
	'claim',
	'off',
	CARD_OPTIONS.map((one) => ({
		...one,
		label: `【接口】${one.label}`,
		description: `【接口】${one.description}`,
	})),
	TOOL_OPTIONS.map((one) => ({
		...one,
		label: `【接口】${one.label}`,
		description: `【接口】${one.description}`,
	})),
);
const CUSTOM_READY = {
	phase: 'ready',
	snapshot: CUSTOM_SNAPSHOT,
	pending: NO_PENDING,
	saveError: null,
};

/* ══════════════════════════════════════════════════════════
   ① 加载中
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ① 加载中（骨架，没有可点的东西）═══');
const loadingHtml = render(LOADING);
{
	expect('根节点是 <section class="tb3perm"', loadingHtml.startsWith('<section class="tb3perm"'), true);
	expect('根节点带 data-panel="permission"', loadingHtml.includes('data-panel="permission"'), true);
	expect('data-phase="loading"', loadingHtml.includes('data-phase="loading"'), true);
	expect('⭐ 骨架容器 aria-busy="true"（读屏知道在加载）', loadingHtml.includes('data-loading="1" aria-busy="true"'), true);
	expect('⭐ 两条轴各一块骨架', countOf(loadingHtml, 'data-skeleton="'), 2);
	expect('骨架 = 2 块 × 3 行选项', countOf(loadingHtml, 'data-skeleton-row="1"'), 6);
	expect('⭐ 加载中没有 radio（不能点任何档位）', countOf(loadingHtml, 'type="radio"'), 0);
	expect('加载中没有「重试」按钮（还没失败）', countOf(loadingHtml, 'data-retry="1"'), 0);
	expect('加载中没有底部正交说明（等数据回来才画）', countOf(loadingHtml, 'data-foot="1"'), 0);
	expect('标题就是「任务板权限」', loadingHtml.includes('>任务板权限</h2>'), true);
	expect('简介提到「两条互相独立的轴」', loadingHtml.includes('两条互相独立的轴'), true);
}

/* ══════════════════════════════════════════════════════════
   ② 加载失败
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ② 加载失败（说清原因 + 重试）═══');
const loadErrorHtml = render(LOAD_ERROR);
{
	expect('data-phase="load-error"', loadErrorHtml.includes('data-phase="load-error"'), true);
	expect('⭐ 错误块 role="alert"', loadErrorHtml.includes('data-load-error="1" role="alert"'), true);
	expect('错误标题', loadErrorHtml.includes('权限设置加载失败'), true);
	expect('⭐ 失败原因原样显示（不是一句「出错了」）', loadErrorHtml.includes(LOAD_ERROR.message), true);
	expect('⭐ 有「重试」按钮', loadErrorHtml.includes('data-retry="1"') && loadErrorHtml.includes('>重试</button>'), true);
	expect('加载失败没有 radio', countOf(loadErrorHtml, 'type="radio"'), 0);
	expect('加载失败没有骨架', countOf(loadErrorHtml, 'data-skeleton="'), 0);
}

/* ══════════════════════════════════════════════════════════
   ③ 已加载：两条轴 / 六个 radio / 真文案
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ③ 已加载（真实 core 选项表）═══');
const readyHtml = render(READY);
const readyRadios = radioTagsOf(readyHtml);
{
	expect('data-phase="ready"', readyHtml.includes('data-phase="ready"'), true);

	/* ── 两条轴 ── */
	expect('⭐ 两条轴：data-axis="card" / "tool" 各一', {
		card: countOf(readyHtml, 'data-axis="card"'),
		tool: countOf(readyHtml, 'data-axis="tool"'),
	}, { card: 1, tool: 1 });
	expect('轴标题：卡片动作档位', readyHtml.includes('卡片动作档位'), true);
	expect('轴标题：工具管控档位', readyHtml.includes('工具管控档位'), true);
	expect('⭐ 每条轴一个 radiogroup', countOf(readyHtml, 'role="radiogroup"'), 2);

	/* ── 六个 radio ── */
	expect('⭐ 恰好 6 个档位 radio（3 + 3）', readyRadios.length, 6);
	expect('UI 轴 radio 的 name 是 tb3perm-card（3 个）', countOf(readyHtml, 'name="tb3perm-card"'), 3);
	expect('宿主轴 radio 的 name 是 tb3perm-tool（3 个）', countOf(readyHtml, 'name="tb3perm-tool"'), 3);
	expect('⭐ 恰好两个 checked（每条轴一个当前档）', checkedValuesOf(readyHtml), ['claim', 'manage']);
	expect('⭐ 选中行 data-selected="true" 恰好两个', countOf(readyHtml, 'data-selected="true"'), 2);
	expect('非选中行 4 个', countOf(readyHtml, 'data-selected="false"'), 4);
	expect('没有 pending 时没有 disabled 的 radio', disabledRadiosOf(readyHtml), 0);
	expect('没有 pending 时没有转圈', countOf(readyHtml, 'data-spinner="1"'), 0);

	/* ── 文案来自接口的 options（真实 core 常量）── */
	const labels = CARD_OPTIONS.map((one) => one.label).concat(TOOL_OPTIONS.map((one) => one.label));
	expect('⭐ 六档 label 全部来自接口选项表', labels.every((one) => readyHtml.includes(`>${one}</span>`)), true);
	const descriptions = CARD_OPTIONS.map((one) => one.description).concat(
		TOOL_OPTIONS.map((one) => one.description),
	);
	expect('⭐ 六档 description 也全部渲染（不是只有 label）', descriptions.every((one) => readyHtml.includes(one)), true);
	expect('⭐ 每档都有一个 data-option-desc', countOf(readyHtml, 'data-option-desc="1"'), 6);
	expect('「不允许领卡」那档的说明', readyHtml.includes('AI 不能领取工作卡，也不能采纳草稿。'), true);

	/* ── 当前标记 ── */
	expect('⭐ 轴头「当前：<label>」各一个', countOf(readyHtml, 'data-axis-current-label="1"'), 2);
	expect('UI 轴当前 = claim（data 属性）', readyHtml.includes('data-axis-current="claim"'), true);
	expect('宿主轴当前 = manage（data 属性）', readyHtml.includes('data-axis-current="manage"'), true);
	expect('⭐ 选中行有「当前」胶囊（两个）', countOf(readyHtml, 'data-current-badge="1"'), 2);
	expect('UI 轴轴头写「允许领卡」', axisSliceOf(readyHtml, 'card').includes('允许领卡'), true);
	expect('宿主轴轴头写「任务板管理权限」', axisSliceOf(readyHtml, 'tool').includes('任务板管理权限'), true);

	/* ── 底部正交说明 ── */
	expect('⭐ 底部有正交说明块', countOf(readyHtml, 'data-foot="1"'), 1);
	expect('⭐ 正交说明写「两条轴互不覆盖」', readyHtml.includes('两条轴互不覆盖'), true);
	expect('⭐ 正交说明写「3 × 3 = 9 种结果」', readyHtml.includes('3 × 3 = 9 种结果'), true);
	expect('正交说明写「领卡仍然受卡片动作档位管」', readyHtml.includes('领卡仍然受卡片动作档位管'), true);

	/* ── 没有错误 / pending 的残留 ── */
	expect('已加载没有保存失败横幅', countOf(readyHtml, 'data-save-error="1"'), 0);
	expect('已加载没有「保存中」标记', countOf(readyHtml, 'data-saving-label="1"'), 0);
}

/* ══════════════════════════════════════════════════════════
   ④ 文案来源：换一份 label/description，组件画新的
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ④ 文案确实来自 props（不是内置第二份）═══');
const customHtml = render(CUSTOM_READY);
{
	expect('⭐ 自定义 label 被渲染', customHtml.includes('【接口】不允许领卡'), true);
	expect('⭐ 自定义 description 被渲染', customHtml.includes('【接口】AI 不能领取工作卡'), true);
	expect('⭐ 组件里没有内置那份文案（不带前缀的不出现）', customHtml.includes('>不允许领卡</span>'), false);
	expect('自定义文案也仍是 6 档', radioTagsOf(customHtml).length, 6);
	expect('自定义档位值不变（value 仍是 no-claim）', customHtml.includes('value="no-claim"'), true);
}

/* ══════════════════════════════════════════════════════════
   ⑤ 保存中：乐观选中 + 只锁那条轴
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑤ UI 轴保存中（乐观选中 + 转圈，宿主轴照常可点）═══');
const pendingCardState = beginSave(READY, 'card', 'adopt');
const pendingCardHtml = render(pendingCardState);
{
	expect('⭐ 被点的那档已乐观选中（checked = adopt）', checkedValuesOf(pendingCardHtml), ['adopt', 'manage']);
	expect('⭐ 这一档同时有 data-saving="true"', optionTagOf(pendingCardHtml, 'card', 'adopt').includes('data-saving="true"'), true);
	expect('⭐ 有转圈（1 个）', countOf(pendingCardHtml, 'data-spinner="1"'), 1);
	expect('⭐ 有「保存中…」文案', pendingCardHtml.includes('保存中…'), true);
	expect('保存中的档位不再显示「当前」胶囊（只剩另一轴一个）', countOf(pendingCardHtml, 'data-current-badge="1"'), 1);
	expect('⭐ UI 轴挂 aria-busy', pendingCardHtml.includes('data-axis="card"') && pendingCardHtml.includes('aria-busy="true"'), true);

	const cardSlice = axisSliceOf(pendingCardHtml, 'card');
	const toolSlice = axisSliceOf(pendingCardHtml, 'tool');
	expect('⭐ UI 轴三个 radio 全部 disabled（本轴串行）', disabledRadiosOf(cardSlice), 3);
	expect('⭐ 宿主轴一个都没 disabled（另一条轴不受影响）', disabledRadiosOf(toolSlice), 0);
	expect('⭐ 宿主轴的当前档仍是 manage（没被 UI 轴带着变）', pendingCardHtml.includes('data-axis-current="manage"'), true);
	expect('UI 轴轴头「当前」已经是乐观值 adopt', pendingCardHtml.includes('data-axis-current="adopt"'), true);
	expect('保存中不显示「保存失败」横幅', countOf(pendingCardHtml, 'data-save-error="1"'), 0);
}

console.log('\n═══ ⑤b 宿主轴保存中（反向：UI 轴照常可点）═══');
const pendingToolHtml = render(beginSave(READY, 'tool', 'manage-edit'));
{
	expect('宿主轴三个 radio 全 disabled', disabledRadiosOf(axisSliceOf(pendingToolHtml, 'tool')), 3);
	expect('⭐ UI 轴一个都没 disabled', disabledRadiosOf(axisSliceOf(pendingToolHtml, 'card')), 0);
	expect('宿主轴乐观选中 manage-edit', checkedValuesOf(pendingToolHtml), ['claim', 'manage-edit']);
	expect('转圈只出现在宿主轴', countOf(axisSliceOf(pendingToolHtml, 'tool'), 'data-spinner="1"'), 1);
	expect('UI 轴没有转圈', countOf(axisSliceOf(pendingToolHtml, 'card'), 'data-spinner="1"'), 0);
}

/* ══════════════════════════════════════════════════════════
   ⑥ 保存失败：只有失败的轴回滚 + 错误横幅
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑥ UI 轴保存失败（回滚 + 横幅）═══');
const failedState = failSave(
	beginSave(READY, 'card', 'adopt'),
	'card',
	'任务板服务返回了非 JSON 内容（HTTP 502）',
);
const failedHtml = render(failedState);
{
	expect('⭐ 有保存失败横幅', countOf(failedHtml, 'data-save-error="1"'), 1);
	expect('横幅 role="alert"', failedHtml.includes('role="alert"'), true);
	expect('⭐ 横幅记着回滚到哪个值（claim）', failedHtml.includes('data-rolled-back="claim"'), true);
	expect('横幅记着哪条轴失败', failedHtml.includes('data-save-error-axis="card"'), true);
	expect('⭐ 消息含失败原因', failedHtml.includes('任务板服务返回了非 JSON 内容（HTTP 502）'), true);
	expect('⭐ 消息含「已回滚到「允许领卡」」', failedHtml.includes('已回滚到「允许领卡」'), true);
	expect('⭐ 选中回滚到 claim（不是刚才点的 adopt）', checkedValuesOf(failedHtml), ['claim', 'manage']);
	expect('回滚后 UI 轴轴头也是 claim', failedHtml.includes('data-axis-current="claim"'), true);
	expect('⭐ 回滚后没有转圈 / 没有 disabled', {
		spinner: countOf(failedHtml, 'data-spinner="1"'),
		disabled: disabledRadiosOf(failedHtml),
	}, { spinner: 0, disabled: 0 });
	expect('⭐ 有 × 关闭按钮', countOf(failedHtml, 'data-dismiss-error="1"'), 1);
	expect('点 × 后横幅消失（同一份纯函数）', countOf(render(dismissSaveError(failedState)), 'data-save-error="1"'), 0);
}

/* ══════════════════════════════════════════════════════════
   ⑦ 纯逻辑速查（完整 53 条在 test/permission-view.test.ts）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑦ 纯逻辑（同一份模块，完整断言见 test/permission-view.test.ts）═══');
{
	expect('axisLevelOf 取两条轴', [mod.axisLevelOf(READY.snapshot, 'card'), mod.axisLevelOf(READY.snapshot, 'tool')], ['claim', 'manage']);
	expect('levelLabelOf 未知档位回落原值', mod.levelLabelOf(READY.snapshot, 'card', 'weird'), 'weird');
	expect('⭐ requestBodyOf 只带一条轴（PATCH）', Object.keys(mod.requestBodyOf('card', 'adopt')), ['cardActionLevel']);
	expect('同值不重发', mod.shouldSaveOnSelect(READY, 'card', 'claim'), false);
	expect('换档要发', mod.shouldSaveOnSelect(READY, 'card', 'adopt'), true);
	expect('⭐ 一条轴 pending 时另一条轴仍可发（正交）', mod.shouldSaveOnSelect(pendingCardState, 'tool', 'off'), true);
	expect('⭐ 失败只回滚失败的那条轴', (() => {
		const both = beginSave(beginSave(READY, 'card', 'adopt'), 'tool', 'off');
		const partial = failSave(both, 'tool', '网络断了');
		return [mod.axisLevelOf(partial.snapshot, 'card'), mod.axisLevelOf(partial.snapshot, 'tool'), partial.pending.card !== null];
	})(), ['adopt', 'manage', true]);
	expect('commit 只清这条轴的 pending', (() => {
		const both = beginSave(beginSave(READY, 'card', 'adopt'), 'tool', 'off');
		const done = commitSave(both, 'card', { cardActionLevel: 'adopt', toolGuardLevel: 'off' });
		return [done.pending.card, done.pending.tool !== null, done.saveError];
	})(), [null, true, null]);
}

/* ══════════════════════════════════════════════════════════
   ⑧ 预览产物（用户双击的就是它）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑧ 预览产物（双击 index.html 能看）═══');
{
	let html = '';
	try {
		html = readFileSync(PREVIEW_HTML, 'utf8');
	} catch {
		html = '';
	}
	expect('index.html 已构建', html.length > 0, true);
	/*
	 * 预览页的状态矩阵是**运行时**渲染的，SSR 断言看不到 DOM ⇒ 只能证明
	 * 「产物里的 JS 含这 7 个场景的 key」。真正画出来要靠用户双击。
	 */
	for (const key of [
		'loading',
		'load-error',
		'ready',
		'pending-card',
		'pending-tool',
		'save-error',
		'custom-labels',
	]) {
		expect(`产物含状态场景 key：${key}`, html.includes(`key: "${key}"`), true);
	}
	expect('产物含 data-scenario 挂载点（矩阵卡片）', html.includes('data-scenario'), true);
	expect('组件样式被打进 <style>（.tb3perm__axis）', html.includes('.tb3perm__axis'), true);
	expect('选中态样式（.tb3perm__opt.is-selected）', html.includes('.tb3perm__opt.is-selected'), true);
	expect('转圈动画 keyframes', html.includes('tb3perm-spin'), true);
	expect('骨架呼吸动画 keyframes', html.includes('tb3perm-shimmer'), true);
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
   ⑨ 结果 + 诚实清单
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  SSR 断言数 ${total}（失败 ${failures.length}）`);

console.log('\n═══ ⚠ 没测到的（需要真浏览器，这里不假装）═══');
console.log('  ✗ 点一档是否真的触发 onSelect —— 要 DOM 事件');
console.log('  ✗ 圆点 / 描述 / 胶囊的像素位置与配色 —— 要 getBoundingClientRect / 截图');
console.log('  ✗ 转圈动画、骨架呼吸动画是否真的在动 —— 要真渲染');
console.log('  ✗ 570 宽工作区 / 1600 全屏下的换行与裁切 —— 要真排版');
console.log('  ✗ 键盘方向键切换 radio —— 原生 radio 行为，没在沙箱里驱动');
console.log('  ⇒ 交互判决的可信度来自 test/permission-view.test.ts（node --test，53 条）');
console.log('  ⇒ 视觉请用户双击 dev/preview/permission/index.html 看');

process.exit(failures.length > 0 ? 1 : 0);
