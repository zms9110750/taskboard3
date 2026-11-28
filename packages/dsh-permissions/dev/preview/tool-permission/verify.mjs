/**
 * 工具权限页的**验收**：SSR 结构断言 + 预览产物自检。
 *
 * ```
 * node packages/dsh-permissions/dev/preview/tool-permission/verify.mjs
 * ```
 *
 * ## 它证明什么（对应 issue #53–#58）
 *
 * | 断言组 | 对应 issue |
 * |---|---|
 * | 页面不再有「暂不持久化」黄条；工具来源行写「共 53 个 / 来自宿主」 | #58 / #55 |
 * | 白底工具节点 = 只读（data-readonly / aria-disabled / title / 无 role） | #53 |
 * | 组节点可点（role=button + tabindex），成环节点置红且不可点 | #53 |
 * | 保存状态条三种结局（保存中 / 已保存 / 失败带 code + 重试） | #58 |
 * | 档位 / 模板 / 领域块都是 FoldPill + FoldRect，收起时矩形不在 DOM | #56 |
 * | 选中态（data-picked + is-picked 竖条样式），互斥单选 | #57 |
 * | 编辑器：BASE 行禁用并写明原因；勾选 → 保存 / 取消；保存状态 | #57 |
 * | 不能编辑时给出原因 | #57 |
 *
 * ## 它不证明什么（不假装）
 *
 * 点击是否真的触发 → 要 DOM 事件；折叠动画 / 竖条像素颜色 → 要截图；
 * 保存是否真的落库 → 要真服务端（`docs/交付.md` 里的一次性探针 / curl）。
 * ⇒ 决策逻辑由 `test/*.test.ts` 钉住，交互由 `index.html` 人工点一遍。
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

/** 断言：相等。 */
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok) failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

/** 断言：包含。 */
const expectIn = (label, haystack, needle, want = true) => {
	total += 1;
	const ok = haystack.includes(needle) === want;
	if (!ok) failures.push(`${label}\n      期望${want ? '' : '不'}包含 ${JSON.stringify(needle)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

/** 出现次数。 */
const countOf = (html, needle) => html.split(needle).length - 1;

/** 取一个元素的开始标签（用于读它的属性）。 */
const tagOf = (html, needle) => {
	const at = html.indexOf(needle);
	if (at < 0) return '';
	const start = html.lastIndexOf('<', at);
	const end = html.indexOf('>', at);
	return html.slice(start, end + 1);
};

/** 取一个 `<label data-tool-name="…">…</label>` 的整段（读它内部的 input 属性）。 */
const editorRowOf = (html, name) => {
	const at = html.indexOf(`data-tool-name="${name}"`);
	if (at < 0) return '';
	const start = html.lastIndexOf('<label', at);
	const end = html.indexOf('</label>', at);
	return html.slice(start, end < 0 ? html.length : end);
};

/* ══════════════════════════════════════════════════════════
   ① 打包 SSR 入口
   ══════════════════════════════════════════════════════════ */

console.log('打包 SSR 入口…');
const bundle = await rolldown({
	input: ENTRY,
	platform: 'node',
	jsx: 'react-jsx',
	external: ['react', 'react/jsx-runtime', 'react-dom/server', '@taskboard/dsh-client/fold-pill'],
	define: { 'process.env.NODE_ENV': '"development"' },
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

/* ══════════════════════════════════════════════════════════
   ② 页面外壳：没有「暂不持久化」，有工具来源（#58 / #55）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ② 页面外壳（#58 摘黄条 / #55 来源说明）═══');
{
	const host = mod.renderShell({ origin: 'host' });
	expectIn('外壳根节点 data-testid="tool-permission-page"', host, 'data-testid="tool-permission-page"');
	expectIn('⭐ 不再有「暂不持久化」', host, '暂不持久化', false);
	expectIn('⭐ 不再有「后端存储待实现」', host, '后端存储待实现', false);
	expectIn('⭐ 工具来源行 = 共 53 个，来自宿主 /api/tools', host, 'data-origin="host"');
	expectIn('来源行说「来自宿主 /api/tools」', host, '来自宿主 /api/tools');
	expect('来源行的数字就是清单长度（53）', /<b data-testid="tools-total">53<\/b>/.test(host), true);
	expectIn('没有降级时不出红条', host, 'data-testid="tools-fallback-notice"', false);

	const fallback = mod.renderShell({ origin: 'fallback', fallbackReason: '服务返回 HTTP 502' });
	expectIn('降级时出红条', fallback, 'data-testid="tools-fallback-notice"');
	expectIn('降级红条带原因', fallback, '服务返回 HTTP 502');
	expectIn('降级红条说「不是宿主全量」', fallback, '不是');
	expectIn('降级时来源行改成内置示例', fallback, '来自内置示例（宿主接口没读到）');
}

/* ══════════════════════════════════════════════════════════
   ③ 节点：工具只读（#53）/ 组可点 / 宽度由同一套 CSS 兜底（#54）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ③ 画布节点（#53 只读成员位 / #54 统一宽度）═══');
{
	const tool = mod.renderNode({ kind: 'tool', label: 'write' });
	const toolTag = tagOf(tool, 'data-node-kind="tool"');
	expectIn('工具节点标了 data-readonly="1"', toolTag, 'data-readonly="1"');
	expectIn('工具节点 class 含 is-readonly', toolTag, 'is-readonly');
	expectIn('工具节点 aria-disabled', toolTag, 'aria-disabled="true"');
	expectIn('⭐ 悬停说明「这是成员位…」', toolTag, '这是成员位');
	expectIn('⭐ 工具节点没有 role=button（点了也不该像按钮）', toolTag, 'role="button"', false);
	expectIn('⭐ 工具节点没有 tabindex（键盘也进不去）', toolTag, 'tabindex', false);
	expectIn('工具节点字节里没有 onClick', tool, 'onClick', false);
	expectIn('工具节点元信息写「只读」', tool, '· 只读');
	expectIn('普通工具不显示「已失效」', tool, '已失效', false);

	const invalid = mod.renderNode({ kind: 'tool', label: 'gone_tool', invalid: true });
	expectIn('失效工具 data-invalid="1"', tagOf(invalid, 'data-node-kind="tool"'), 'data-invalid="1"');
	expectIn('⭐ 失效工具在名字后面标「已失效」', invalid, '（已失效）');
	expectIn('失效工具元信息写「宿主已无此工具」', invalid, '宿主已无此工具');

	const group = mod.renderNode({ kind: 'group', label: '编码工具', clickable: true });
	const groupTag = tagOf(group, 'data-node-kind="group"');
	expectIn('组节点可点：role=button', groupTag, 'role="button"');
	expectIn('组节点可点：tabindex="0"', groupTag, 'tabindex="0"');
	expectIn('组节点不标 data-readonly', groupTag, 'data-readonly="0"');
	expectIn('组节点不带 is-readonly', groupTag, 'is-readonly', false);
	expectIn('组节点标题是「# 名字」', group, '# 编码工具');

	const blocked = mod.renderNode({ kind: 'group', label: '文件类', blocked: true, clickable: true, cycleText: '文件类 → 编码工具 → 文件类' });
	const blockedTag = tagOf(blocked, 'data-node-kind="group"');
	expectIn('成环节点 data-blocked="1"', blockedTag, 'data-blocked="1"');
	expectIn('成环节点 class 含 is-blocked', blockedTag, 'is-blocked');
	expectIn('⭐ 成环节点不可点（没有 role=button）', blockedTag, 'role="button"', false);
	expectIn('⭐ 成环节点 title 写出环路径', blockedTag, '会成环：文件类 → 编码工具 → 文件类');
}

/* ══════════════════════════════════════════════════════════
   ④ 保存状态条（#58）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ④ 保存状态（#58：保存中 / 已保存 / 失败可重试）═══');
{
	const idle = mod.renderSave('idle');
	expectIn('空闲：data-save-state="idle"', idle, 'data-save-state="idle"');
	expectIn('空闲：说明会自动保存', idle, '改动会自动保存');

	const saving = mod.renderSave('saving');
	expectIn('保存中：data-save-state="saving"', saving, 'data-save-state="saving"');
	expectIn('保存中：有转圈', saving, 'tb3g-save__spinner');
	expectIn('保存中：文案「保存中…」', saving, '保存中…');
	expectIn('保存中：aria-live=polite', saving, 'aria-live="polite"');

	const saved = mod.renderSave('saved');
	expectIn('已保存：勾 + 文案', saved, '✓ 已保存');
	expectIn('已保存：title 记着时间', tagOf(saved, 'data-save-state="saved"'), 'title="19:00:00"');

	const failed = mod.renderSave('failed');
	const failedTag = tagOf(failed, 'data-save-state="failed"');
	expectIn('失败：role=alert', failedTag, 'role="alert"');
	expectIn('⭐ 失败：显示判定码 CYCLE', failed, '>CYCLE<');
	expectIn('⭐ 失败：显示环路径', failed, '会成环：文件类 → 编码工具 → 文件类');
	expectIn('⭐ 失败：有重试按钮', failed, 'data-action="retry-save"');
	expectIn('失败：按钮文字「重试」', failed, '>重试</button>');
}

/* ══════════════════════════════════════════════════════════
   ⑤ 授权页左栏：折叠（#56）+ 选中（#57）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑤ 授权左栏（#56 折叠 / #57 选中）═══');
{
	const open = mod.renderSidebar({ selection: { kind: 'tier', key: 'common' } });
	expect('⭐ 5 个 FoldPill（档位 / 模板 / 3 个领域）', countOf(open, 'data-fold-pill="open"'), 5);
	expect('⭐ 全部展开 ⇒ 5 个 FoldRect', countOf(open, 'data-fold-rect'), 5);
	expectIn('档位胶囊的计数 = 2', tagOf(open, 'data-fold-pill="open"'), 'aria-expanded="true"');
	expectIn('档位一节有 tier-list', open, 'data-testid="tier-list"');
	expectIn('模板一节有 template-rows', open, 'data-testid="template-rows"');
	expect('6 个模板行（3 领域）', countOf(open, 'data-template-ref="'), 6);
	expect('3 个领域块', countOf(open, 'data-fold="domain:'), 3);

	/* 选中态 */
	expectIn('⭐ 选中的档位 data-picked="1"', tagOf(open, 'data-tier-key="common"'), 'data-picked="1"');
	expectIn('⭐ 选中的档位 class 含 is-picked', tagOf(open, 'data-tier-key="common"'), 'is-picked');
	expectIn('未选中的档位 data-picked="0"', tagOf(open, 'data-tier-key="unclaimed"'), 'data-picked="0"');
	expect('⭐ 选中是互斥的（恰好 1 个 data-picked="1"）', countOf(open, 'data-picked="1"'), 1);
	expectIn('选中项带 aria-pressed', tagOf(open, 'data-tier-key="common"'), 'aria-pressed="true"');

	const pickedTemplate = mod.renderSidebar({ selection: { kind: 'template', ref: 'tpl-bug' } });
	expectIn('⭐ 选中的模板 data-picked="1"', tagOf(pickedTemplate, 'data-template-ref="tpl-bug"'), 'data-picked="1"');
	expectIn('选中的模板 class 含 is-picked', tagOf(pickedTemplate, 'data-template-ref="tpl-bug"'), 'is-picked');
	expect('选模板时档位都不选中', countOf(pickedTemplate, 'data-picked="1"'), 1);

	/* 折叠：收起的块矩形不在 DOM（issue #52 的硬约束） */
	const folded = mod.renderSidebar({
		selection: { kind: 'tier', key: 'unclaimed' },
		folds: { 'auth:tiers': false, 'auth:templates': true, 'auth:domain:代码': false },
	});
	expect('⭐ 收起档位 / 收起「代码」领域 ⇒ 只剩 3 个矩形', countOf(folded, 'data-fold-rect'), 3);
	expect('收起的胶囊还在（两态都在）', countOf(folded, 'data-fold-pill="closed"'), 2);
	expectIn('收起的档位：tier-list 不在 DOM', folded, 'data-testid="tier-list"', false);
	expectIn('收起的领域：domain 容器不在 DOM', folded, 'data-domain="代码"', false);
	expectIn('没收起的领域仍在', folded, 'data-domain="核心"');
	expectIn('收起态的胶囊 aria-expanded=false', tagOf(folded, 'data-fold-pill="closed"'), 'aria-expanded="false"');
}

/* ══════════════════════════════════════════════════════════
   ⑥ 编辑器（#57）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑥ 授权编辑器（#57 勾选 → 保存）═══');
{
	const editor = mod.renderEditor({ title: '未领卡档', picked: ['taskboard_card', 'read', 'bash'] });
	expectIn('编辑器根节点', editor, 'data-testid="policy-editor"');
	expectIn('标题写清在编辑谁', editor, '编辑「未领卡档」的授权工具');
	expect('候选工具 9 行', countOf(editor, 'data-tool-name="'), 9);
	expect('⭐ BASE 3 行 data-locked="1"', countOf(editor, 'data-locked="1"'), 3);
	expectIn('⭐ BASE 行禁用 + 说明「BASE 恒可用」', editor, 'BASE 恒可用');
	expectIn('BASE 行 title 说明不能移除', editor, '不能移除');
	expectIn('⭐ BASE 行 checkbox 是 disabled', editorRowOf(editor, 'read'), 'disabled');
	expectIn('⭐ BASE 行是 checked（恒可用）', editorRowOf(editor, 'read'), 'checked');
	expectIn('未勾选的非 BASE 行没有 checked', editorRowOf(editor, 'write'), 'checked', false);
	expectIn('非 BASE 行不是 disabled', editorRowOf(editor, 'write'), 'disabled', false);
	expectIn('保存按钮', editor, 'data-action="auth-save"');
	expectIn('取消按钮', editor, 'data-action="auth-cancel"');
	expectIn('没有改动时状态条说「改动还没保存」', editor, '改动还没保存');

	const saving = mod.renderEditor({ title: '通用档', picked: ['taskboard_card'], saveState: 'saving' });
	expectIn('保存中：状态条显示「保存中…」', saving, '保存中…');
	const failed = mod.renderEditor({ title: '通用档', picked: ['taskboard_card'], saveState: 'failed' });
	expectIn('保存失败：状态条显示原因', failed, '权限策略写不进去（403）');

	const filtered = mod.renderEditor({ title: '通用档', picked: [], query: 'glob' });
	expect('搜索过滤后只剩 1 行', countOf(filtered, 'data-tool-name="'), 1);
	expectIn('过滤后是 glob', filtered, 'data-tool-name="glob"');
}

/* ══════════════════════════════════════════════════════════
   ⑦ 编辑入口 / 不可编辑原因（#57）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑦ 编辑入口（#57：不能编辑必须说原因）═══');
{
	const ok = mod.renderEditEntry({ kind: 'template', ref: 'tpl-bug', inTemplates: true });
	expectIn('可编辑：按钮 data-editable="1"', ok, 'data-editable="1"');
	expectIn('可编辑：按钮不 disabled', tagOf(ok, 'data-action="auth-edit"'), 'disabled', false);
	expectIn('可编辑：不显示「不能编辑」', ok, '不能编辑', false);
	expectIn('可编辑：不出现原因元素', ok, 'data-testid="edit-blocked-reason"', false);

	const gone = mod.renderEditEntry({ kind: 'template', ref: 'tpl-gone', inTemplates: false });
	expectIn('不可编辑：按钮 data-editable="0"', gone, 'data-editable="0"');
	expectIn('⭐ 不可编辑：按钮 disabled', tagOf(gone, 'data-action="auth-edit"'), 'disabled');
	expectIn('⭐ 不可编辑：按钮 title 写原因', gone, '已经不在模板清单里');
	expectIn('⭐ 不可编辑：页面写出「不能编辑：…」', gone, '不能编辑：');
	expectIn('⭐ 原因里点名是哪个模板', gone, 'tpl-gone');
}

/* ══════════════════════════════════════════════════════════
   ⑧ 预览产物（用户双击的就是它）
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ ⑧ 预览产物（双击 index.html 能点一遍）═══');
{
	let html = '';
	try {
		html = readFileSync(PREVIEW_HTML, 'utf8');
	} catch {
		html = '';
	}
	expect('index.html 已构建', html.length > 0, true);
	if (html.length > 0) {
		expectIn('产物含折叠胶囊样式（.tb3-fold-pill）', html, '.tb3-fold-pill');
		expectIn('产物含折叠矩形样式（.tb3-fold-rect）', html, '.tb3-fold-rect');
		expectIn('产物含选中态样式（.tb3ta-tpl.is-picked）', html, '.tb3ta-tpl.is-picked');
		expectIn('产物含保存状态样式（.tb3g-save）', html, '.tb3g-save');
		expectIn('产物含只读成员位样式（is-readonly）', html, 'is-readonly');
		/*
		 * 注释会原样进产物（rolldown 保留注释），所以这里断言的是**渲染文案**：
		 * 旧黄条那句话不该再出现在任何地方。
		 */
		expectIn('产物里没有旧黄条的渲染文案', html, '关闭或刷新页面后恢复示例分组', false);
		expect('产物是自包含的（无外链 script / stylesheet）', /<script src=|<link rel="stylesheet"/.test(html), false);
		const start = html.indexOf('<script>');
		const end = html.indexOf('</script>', start);
		const js = html.slice(start + '<script>'.length, end);
		let syntaxOk = true;
		try {
			new vm.Script(js);
		} catch {
			syntaxOk = false;
		}
		expect('内联脚本能被 V8 编译', syntaxOk, true);
	}
}

/* ══════════════════════════════════════════════════════════
   ⑨ 结果 + 诚实清单
   ══════════════════════════════════════════════════════════ */

console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  SSR 断言数 ${total}（失败 ${failures.length}）`);

console.log('\n═══ ⚠ 没测到的（需要真浏览器 / 真服务端，这里不假装）═══');
console.log('  ✗ 点击节点 / 勾选工具 / 点保存是否真的触发 —— 要 DOM 事件');
console.log('  ✗ 竖条位置、胶囊与矩形是否真的同宽 —— 要 getBoundingClientRect / 截图');
console.log('  ✗ 防抖 400ms 是否真的合并了连点 —— 要真计时（逻辑见 SAVE_DEBOUNCE_MS）');
console.log('  ✗ 改组 → 刷新 → 还在 —— 要真服务端（一次性探针跑 PUT → 重建 → GET）');
console.log('  ⇒ 决策逻辑的可信度来自 test/tool-graph-sync.test.ts / tool-policy-edit.test.ts');
console.log('  ⇒ 交互请双击 dev/preview/tool-permission/index.html（数据存 localStorage，刷新仍在）');

process.exit(failures.length > 0 ? 1 : 0);
