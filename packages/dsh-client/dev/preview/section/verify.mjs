/**
 * 验证 Section（卡片正文的一章）。
 *
 * `node packages/dsh-client/dev/preview/section/verify.mjs`
 *
 * ## 断言分五块
 *
 * ① **章节名**：用模板给的 `label`；label 为空时**不画标题行**，也不编「正文」。
 * ② **三种 payload 形状**：text（pre-wrap）/ markdown（只有 strong + code，
 *    HTML 当文字）/ ask（真实 6 选项，`options: []` 也能画）。
 * ③ **ask 的 picked 三态**：不存在 / `[]` / `[label]` 三种必须**显示得不一样**。
 * ④ **交互**：真点选项 / 「都不要」/ 自填 —— 读回调日志 + 读父层状态。
 * ⑤ **只读 vs 可编辑**：只读时选项是 div、没有自填框、点了不发 onEdit。
 * ⑥ **降级**：未知 $type 展开原始 JSON；脏数据（null / 数字）不炸、无 JS 错误。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((one) => existsSync(one));
if (EDGE === undefined) {
	console.error('找不到 Edge —— 无法跑 CDP 验证');
	process.exit(1);
}

const HERE = import.meta.dirname;
/** 截图放本组件自己的子目录 ⇒ 不跟别的组件抢文件名。 */
const OUT = nodePath.join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });
const PAGE = nodePath.join(HERE, 'index.html');
if (!existsSync(PAGE)) {
	console.error(`找不到 ${PAGE} —— 先跑 node packages/dsh-client/dev/preview/build.mjs section`);
	process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9320;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'sec-'));
const proc = spawn(
	EDGE,
	[
		'--headless=new',
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${ud}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'about:blank',
	],
	{ stdio: 'ignore' },
);

const wait = async (u, ms = 20000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const r = await fetch(u);
			if (r.ok) return;
		} catch {}
		await sleep(200);
	}
	throw new Error('timeout');
};
await wait(`http://127.0.0.1:${port}/json/version`);

const url = new URL(`file:///${PAGE.replace(/\\/g, '/')}`).href;
const t = await (
	await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((o, n) => {
	ws.onopen = o;
	ws.onerror = n;
});

let i = 0;
const p = new Map();
const errors = [];
const failures = [];
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && p.has(m.id)) {
		const q = p.get(m.id);
		p.delete(m.id);
		m.error ? q.reject(new Error(JSON.stringify(m.error))) : q.resolve(m.result);
		return;
	}
	if (m.method === 'Runtime.exceptionThrown') {
		errors.push(
			(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split(
				'\n',
			)[0],
		);
	}
	if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
		errors.push(
			`console.error: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`,
		);
	}
};
const send = (method, params = {}) =>
	new Promise((res, rej) => {
		const id = ++i;
		p.set(id, { resolve: res, reject: rej });
		ws.send(JSON.stringify({ id, method, params }));
	});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
	width: 1300,
	height: 2200,
	deviceScaleFactor: 1,
	mobile: false,
});
await sleep(2200);

const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(OUT, name), Buffer.from(data, 'base64'));
};
/**
 * 把某个元素滚到视口顶部再截 —— 页面有 19 个章节，不滚的话每张截图都是同一个页头
 * （实测：01~06 六张截图的 sha256 完全相同，等于没截）。
 */
const shotOf = async (sel, name) => {
	const ok = await ev(`(() => { const el = ${sel}; if (!el) return false;
    el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -16); return true; })()`);
	if (ok !== true) {
		failures.push(`截图 ${name}：找不到 ${sel}`);
		return;
	}
	await sleep(250);
	await shot(name);
};const ev = async (x) => {
	const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails)
		console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 300));
	return r.result?.value;
};
const click = async (sel) => {
	const b = await ev(`(() => { const el = ${sel}; if (!el) return null;
    el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
	if (b === null || b === undefined) return false;
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
	await send('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x: b.x,
		y: b.y,
		button: 'left',
		buttons: 1,
		clickCount: 1,
	});
	await send('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x: b.x,
		y: b.y,
		button: 'left',
		buttons: 0,
		clickCount: 1,
	});
	return true;
};
/** 聚焦一个输入框并打字（真键盘事件，不是直接改 value）。 */
const typeInto = async (sel, text) => {
	const ok = await ev(`(() => { const el = ${sel}; if (!el) return false; el.focus(); return true; })()`);
	if (ok !== true) return false;
	for (const char of text) {
		await send('Input.dispatchKeyEvent', { type: 'char', text: char });
	}
	return true;
};
const pressEnter = async () => {
	await send('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key: 'Enter',
		code: 'Enter',
		windowsVirtualKeyCode: 13,
		nativeVirtualKeyCode: 13,
	});
	await send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key: 'Enter',
		code: 'Enter',
		windowsVirtualKeyCode: 13,
		nativeVirtualKeyCode: 13,
	});
};

let total = 0;
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok)
		failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

const readEvents = () => ev(`[...document.querySelectorAll('[data-event]')].map(li => li.dataset.event)`);
const clearEvents = () => ev(`document.querySelector('[data-clear-log]').click()`);
const readLive = () =>
	ev(`(() => ({
    readonly: document.querySelector('[data-live-readonly]').textContent,
    picked: document.querySelector('[data-live-picked]').textContent,
    custom: document.querySelector('[data-live-custom]').textContent,
  }))()`);

/** 读某个静态场景的 DOM 全貌。 */
const readScenario = (key) =>
	ev(`(() => {
  const box = document.querySelector('[data-scenario="${key}"] .tb3-sec');
  if (!box) return null;
  const labelEl = box.querySelector('.tb3-sec__head');
  const options = [...box.querySelectorAll('[data-ask-option]')];
  const textarea = box.querySelector('.tb3-sec__textarea');
  const textEl = box.querySelector('.tb3-sec__text');
  const placeholderEl = box.querySelector('.tb3-sec__placeholder');
  return {
    kind: box.dataset.sectionKind,
    readonly: box.dataset.sectionReadonly === 'true',
    sectionId: box.dataset.sectionId,
    hasLabelRow: labelEl !== null,
    label: labelEl ? labelEl.querySelector('.tb3-sec__title').textContent : null,
    /* text 在只读态是 <textarea>（保留框形状）⇒ 正文读 value，不是 textContent。 */
    text: textarea !== null ? textarea.value : (textEl === null ? null : textEl.textContent),
    placeholder: placeholderEl !== null
      ? placeholderEl.textContent
      : (textarea === null ? null : textarea.placeholder),
    mdStrong: [...box.querySelectorAll('.md strong')].map(e => e.textContent),
    mdCode: [...box.querySelectorAll('.md code')].map(e => e.textContent),
    mdBoldTags: box.querySelectorAll('.md b, .md img, .md script').length,
    mdText: box.querySelector('.md') ? box.querySelector('.md').textContent : null,
    askState: box.querySelector('[data-ask-state-label]') ? box.querySelector('[data-ask-state-label]').dataset.askStateLabel : null,
    askStateText: box.querySelector('.tb3-ask__state-text') ? box.querySelector('.tb3-ask__state-text').textContent : null,
    askOptionCount: options.length,
    askOptions: options.map(o => ({ label: o.dataset.askOption, picked: o.dataset.picked === 'true', tag: o.tagName })),
    askOptionTags: [...new Set(options.map(o => o.tagName))],
    hasNoneBtn: box.querySelector('[data-ask-none]') !== null,
    hasCustomInput: box.querySelector('[data-ask-custom]') !== null,
    askEmpty: box.querySelector('[data-ask-empty]') !== null,
    askGroupEmpty: box.querySelector('[data-ask-group-empty]') !== null,
    hasJsonToggle: box.querySelector('[data-json-toggle]') !== null,
    jsonVisible: box.querySelector('.payload-box') !== null,
    jsonToggleText: box.querySelector('[data-json-toggle]') ? box.querySelector('[data-json-toggle]').textContent.trim() : null,
    isEmpty: box.children.length > 0,
  };
})()`);

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ① 章节名用模板给的 label（不编容器词）═══');
{
	const boxes = await ev(`document.querySelectorAll('.tb3-sec').length`);
	/* 1 个活的 + 18 个场景 = 19 */
	expect('十九个 Section 都渲染了（1 活 + 18 场景）', boxes, 19);

	const filled = await readScenario('text-filled-readonly');
	expect('⭐ 章节名 = 模板 label「选择什么架构」', filled.label, '选择什么架构');
	expect('⭐ 章节名行存在', filled.hasLabelRow, true);
	expect('⭐ 章节名里没有「正文」这种容器词', /正文/u.test(filled.label), false);

	const noLabel = await readScenario('empty-label');
	expect('⭐ label 为空 ⇒ **不画**标题行', noLabel.hasLabelRow, false);
	expect('label 为空时 sectionId 仍是 key', noLabel.sectionId, 'empty-label');
	await shot('01-overview.png');
}
console.log('\n═══ ② text：保留换行，空态用 placeholder ═══');
{
	const filled = await readScenario('text-filled-readonly');
	expect('kind = text', filled.kind, 'text');
	expect('⭐ 正文保留换行（含 \\n 与 \\t）', filled.text.includes('\n第二行'), true);
	expect('缩进保留', filled.text.includes('\t缩进'), true);

	const emptyReadonly = await readScenario('text-empty-readonly');
	expect('⭐ 只读空态：框里没有内容', emptyReadonly.text, '');
	expect('⭐ 只读空态：灰字仍是模板给的', emptyReadonly.placeholder, '选什么架构，为什么');

	const emptyEditable = await readScenario('text-empty-editable');
	expect(
		'⭐ 可编辑空态 = 模板作者写的 placeholder',
		emptyEditable.placeholder,
		'选什么架构，为什么',
	);
	await shotOf(`document.querySelector('[data-scenario="text-empty-editable"] .tb3-sec')`, '02-text.png');
}

console.log('\n═══ ③ markdown：只有 strong + code，HTML 当文字 ═══');
{
	const md = await readScenario('markdown-filled');
	expect('kind = markdown', md.kind, 'markdown');
	expect('⭐ **粗体** 变 <strong>', md.mdStrong, ['粗体', '多个 粗体']);
	expect('⭐ `代码` 变 <code>', md.mdCode, ['内联代码']);
	expect('⭐ HTML 标签不解析（没有 b / img / script 元素）', md.mdBoldTags, 0);
	expect('⭐ HTML 标签原样显示成文字', md.mdText.includes('<b>不该变粗</b>'), true);
	expect(
		'⭐ 不闭合的 ** 保持字面（2 ** 3 没被切开）',
		md.mdText.includes('2 ** 3 = 8'),
		true,
	);
	expect('⭐ 标题 # 原样显示（现在不支持）', md.mdText.includes('标题 # 不支持'), true);
	expect('空行渲染了 <br>', await ev(`document.querySelector('[data-scenario="markdown-filled"] .md br') !== null`), true);

	const mdEmpty = await readScenario('markdown-empty');
	expect('markdown 空态 = placeholder', mdEmpty.placeholder, '把要保留的资料放在这里');
	await shotOf(`document.querySelector('[data-scenario="markdown-filled"] .tb3-sec')`, '03-markdown.png');
}

console.log('\n═══ ④ ask：真实 6 选项 + picked 三态 ═══');
{
	const unset = await readScenario('ask-unset');
	expect('kind = ask', unset.kind, 'ask');
	expect('⭐ 6 个选项都在（真实 expectedMismatch.yaml 的形状）', unset.askOptionCount, 6);
	expect(
		'⭐ 选项顺序保留',
		unset.askOptions.map((o) => o.label),
		['望文生义', '同类产品', '附随文档', '社区传阅', '历史惯性', '官方暗示'],
	);
	expect('⭐ picked 不存在 ⇒ 徽标「未选择」', unset.askStateText, '未选择');
	expect('⭐ picked 不存在 ⇒ state = unset', unset.askState, 'unset');
	expect(
		'⭐ 没有任何选项高亮',
		unset.askOptions.map((o) => o.picked),
		[false, false, false, false, false, false],
	);

	const picked = await readScenario('ask-picked');
	expect('⭐ picked=["望文生义"] ⇒ 徽标「单选·已选 1」', picked.askStateText, '单选·已选 1');
	expect('⭐ 只有那一个选项高亮', picked.askOptions.map((o) => o.picked), [
		true,
		false,
		false,
		false,
		false,
		false,
	]);

	const none = await readScenario('ask-none');
	expect('⭐ picked=[] ⇒ 徽标「都不要」', none.askStateText, '都不要');
	expect('⭐ picked=[] ⇒ state = none', none.askState, 'none');
	expect(
		'⚠ 「都不要」与「未选择」必须能区分（两种回答）',
		none.askStateText === unset.askStateText,
		false,
	);

	const multi = await readScenario('ask-multi');
	expect('⭐ 多选 picked 两个 ⇒ 徽标「多选·已答 2」', multi.askStateText, '多选·已答 2');
	expect('两个选项都高亮', multi.askOptions.map((o) => o.picked), [true, false, true]);
	await shot('04-ask-states.png');
}

console.log('\n═══ ⑤ ask：options 为空也要能画 ═══');
{
	const headerOnly = await readScenario('ask-header-only');
	expect('⭐ header 在、options 空 ⇒ 不是空章', headerOnly.askEmpty, false);
	expect('⭐ 徽标仍是「未选择」', headerOnly.askStateText, '未选择');
	expect('选项数 0', headerOnly.askOptionCount, 0);
	/* header 用 de-dup：readScenario 没读 header，这里单独读 */
	expect(
		'header 文字画出来了',
		await ev(
			`document.querySelector('[data-scenario="ask-header-only"] .tb3-ask__header').textContent`,
		),
		'要问的问题',
	);

	const shell = await readScenario('ask-empty-shell');
	expect(
		'⭐ core 的 defaultPayload（items:[{options:[]}]）⇒ 画「还没有选项」',
		shell.askGroupEmpty,
		true,
	);
	expect(
		'⭐ 不白屏（有 DOM，不是空 box）',
		await ev(
			`document.querySelector('[data-scenario="ask-empty-shell"] .tb3-sec__body').children.length > 0`,
		),
		true,
	);
	await shot('05-ask-empty.png');
}

console.log('\n═══ ⑥ ask 只读 vs 可编辑 ═══');
{
	const ro = await readScenario('ask-readonly');
	expect('⭐ 只读 ⇒ 选项是 <div> 不是 <button>', ro.askOptionTags, ['DIV']);
	expect('⭐ 只读 ⇒ 没有自填框', ro.hasCustomInput, false);
	expect('⭐ 只读 ⇒ 没有「都不要」按钮', ro.hasNoneBtn, false);
	expect('只读仍显示已选状态', ro.askStateText, '单选·已选 1');

	const rw = await readScenario('ask-unset');
	expect('⭐ 可编辑 ⇒ 选项是 <button>', rw.askOptionTags, ['BUTTON']);
	expect('⭐ 可编辑 ⇒ 有自填框', rw.hasCustomInput, true);
	expect('⭐ 可编辑 ⇒ 有「都不要」按钮', rw.hasNoneBtn, true);
	await shot('06-ask-readonly.png');
}

console.log('\n═══ ⑦ ⭐ 真点选项：回调 + 父层改 payload + 界面跟着变 ═══');
{
	await clearEvents();
	const before = await readLive();
	expect('起点 picked = null（未选择）', before.picked, 'null');
	expect('起点徽标 = 未选择', await ev(
		`document.querySelector('[data-live] [data-ask-state-label]').dataset.askStateLabel`,
	), 'unset');

	await click(`document.querySelector('[data-live] [data-ask-option="望文生义"]')`);
	await sleep(400);
	expect('⭐ 回调发出 answer:whyThis="望文生义"', await readEvents(), [
		'answer:whyThis="望文生义"',
	]);
	expect('⭐ 父层 payload 的 picked 变成 ["望文生义"]', (await readLive()).picked, '["望文生义"]');
	expect(
		'⭐ 徽标变成「单选·已选 1」',
		await ev(`document.querySelector('[data-live] .tb3-ask__state-text').textContent`),
		'单选·已选 1',
	);
	expect(
		'⭐ 选项高亮跟着变',
		await ev(
			`document.querySelector('[data-live] [data-ask-option="望文生义"]').dataset.picked`,
		),
		'true',
	);

	/* 换选另一个：单选 ⇒ 只留新的 */
	await clearEvents();
	await click(`document.querySelector('[data-live] [data-ask-option="同类产品"]')`);
	await sleep(400);
	expect('⭐ 单选换选 ⇒ picked 只剩新的', (await readLive()).picked, '["同类产品"]');
	expect(
		'旧的那个不再高亮',
		await ev(
			`document.querySelector('[data-live] [data-ask-option="望文生义"]').dataset.picked`,
		),
		'false',
	);
	await shot('07-live-picked.png');
}

console.log('\n═══ ⑧ ⭐ 点「都不要」：picked 变 []（不是删掉 picked）═══');
{
	await clearEvents();
	await click(`document.querySelector('[data-live] [data-ask-none]')`);
	await sleep(400);
	expect('⭐ 回调的 value 是空串（NO_ANSWER）', await readEvents(), ['answer:whyThis=""']);
	expect('⭐ picked 变成 [] —— 不是 null（两种回答要分得开）', (await readLive()).picked, '[]');
	expect(
		'⭐ 徽标变成「都不要」',
		await ev(`document.querySelector('[data-live] .tb3-ask__state-text').textContent`),
		'都不要',
	);
	await shot('08-live-none.png');
}

console.log('\n═══ ⑨ ⭐ 自填：回车提交，进 custom 不进 picked ═══');
{
	await clearEvents();
	await typeInto(`document.querySelector('[data-live] [data-ask-custom]')`, '我说的是一种感觉');
	await sleep(120);
	await pressEnter();
	await sleep(400);
	const events = await readEvents();
	expect('⭐ 自填提交回调一次', events.length, 1);
	expect('⭐ value 是输入的文字', events[0].endsWith('"我说的是一种感觉"'), true);
	const live = await readLive();
	expect('⭐ 进了 custom', live.custom, '["我说的是一种感觉"]');
	expect('⭐ 没进 picked（未选择仍是 [] 之后的状态，不是自填值）', live.picked.includes('感觉'), false);
	expect('自填框提交后清空', await ev(
		`document.querySelector('[data-live] [data-ask-custom]').value`,
	), '');
	await shot('09-live-custom.png');
}

console.log('\n═══ ⑩ ⭐ 只读：点了什么都不发 ═══');
{
	await clearEvents();
	await click(`document.querySelector('[data-toggle-readonly]')`);
	await sleep(350);
	await clearEvents();
	expect('已切到只读', (await readLive()).readonly, 'true');
	expect(
		'只读 ⇒ 选项不再是 button',
		await ev(`[...document.querySelectorAll('[data-live] [data-ask-option]')].every(el => el.tagName === 'DIV')`),
		true,
	);
	expect(
		'只读 ⇒ 自填框消失',
		await ev(`document.querySelector('[data-live] [data-ask-custom]') === null`),
		true,
	);

	/* 点整章（只读）、点选项（已变成 div）—— 都不该派发任何东西 */
	await click(`document.querySelector('[data-live] .tb3-sec')`);
	await sleep(250);
	await click(`document.querySelector('[data-live] [data-ask-option="望文生义"]')`);
	await sleep(250);
	expect('⭐ 只读时点章节 / 点选项 ⇒ 零派发', await readEvents(), []);

	/* 切回来 */
	await click(`document.querySelector('[data-toggle-readonly]')`);
	await sleep(350);
	await clearEvents();
	expect('切回可编辑', (await readLive()).readonly, 'false');
}

console.log('\n═══ ⑪ ⭐ 点章节上报 onEdit（组件不判能不能编辑）═══');
{
	await clearEvents();
	await click(`document.querySelector('[data-scenario="text-empty-editable"] .tb3-sec')`);
	await sleep(300);
	expect('⭐ 可编辑 text ⇒ 派发 edit:<sectionId>', await readEvents(), [
		'text-empty-editable/edit:text-empty-editable',
	]);

	await clearEvents();
	await click(`document.querySelector('[data-scenario="text-filled-readonly"] .tb3-sec')`);
	await sleep(300);
	expect('⭐ 只读 ⇒ 点它不派发 edit', await readEvents(), []);

	await clearEvents();
	await click(`document.querySelector('[data-scenario="text-nocb"] .tb3-sec')`);
	await sleep(300);
	expect('⭐ 可编辑但父层没接 onEdit ⇒ 也不派发（不假装能编辑）', await readEvents(), []);
}

console.log('\n═══ ⑫ 未知 $type / 脏数据降级 ═══');
{
	const unknown = await readScenario('unknown-type');
	expect('kind = unknown', unknown.kind, 'unknown');
	expect('⭐ 有「展开原始 JSON」按钮', unknown.hasJsonToggle, true);
	expect('⭐ JSON 默认收起', unknown.jsonVisible, false);
	expect('⭐ 按钮文案带 $type', unknown.jsonToggleText.includes('未注册的动作「table」'), true);

	await clearEvents();
	await click(`document.querySelector('[data-scenario="unknown-type"] [data-json-toggle]')`);
	await sleep(300);
	expect(
		'⭐ 点开 ⇒ pre 出现',
		await ev(`document.querySelector('[data-scenario="unknown-type"] .payload-box') !== null`),
		true,
	);
	expect(
		'JSON 里能看到原始字段',
		await ev(`document.querySelector('[data-scenario="unknown-type"] .payload-box').textContent.includes('"rows"')`),
		true,
	);

	const none = await readScenario('unknown-none');
	expect('⭐ 没有 $type ⇒ 标题「无法识别的数据」', none.jsonToggleText.includes('无法识别的数据'), true);

	const dirtyNull = await readScenario('dirty-null');
	expect('⭐ payload=null 不炸，有 DOM', dirtyNull.isEmpty, true);
	expect('payload=null ⇒ kind = unknown', dirtyNull.kind, 'unknown');

	const dirtyNumber = await readScenario('dirty-number');
	expect('⭐ payload=42 不炸，有 DOM', dirtyNumber.isEmpty, true);
	await shot('10-unknown.png');
}

console.log('\n═══ ⑬ DOM 契约（其他组件要依赖的钩子）═══');
{
	const hooks = await ev(`(() => {
    const box = document.querySelector('[data-scenario="ask-unset"] .tb3-sec');
    return {
      block: box.classList.contains('tb3-sec'),
      hasContent: box.querySelector('.tb3-sec__body') !== null,
      hasLabel: box.querySelector('.tb3-sec__head') !== null,
      kindAttr: box.dataset.sectionKind,
      readonlyAttr: box.dataset.sectionReadonly,
      sectionIdAttr: box.dataset.sectionId,
      optionAttrs: box.querySelector('[data-ask-option]').dataset.askOption,
      stateAttr: box.querySelector('[data-ask-state-label]').dataset.askStateLabel,
    };
  })()`);
	expect('根 class = tb3-sec', hooks.block, true);
	expect('内容容器存在', hooks.hasContent, true);
	expect('标题容器存在', hooks.hasLabel, true);
	expect('data-section-kind 可读', hooks.kindAttr, 'ask');
	expect('data-section-readonly 可读', hooks.readonlyAttr, 'false');
	expect('data-section-id 可读', hooks.sectionIdAttr, 'ask-unset');
	expect('data-ask-option 可读', hooks.optionAttrs, '望文生义');
	expect('data-ask-state-label 可读', hooks.stateAttr, 'unset');
}

console.log('\n═══ ⑭ 空态 / 重置 ═══');
{
	await click(`document.querySelector('[data-reset-live]')`);
	await sleep(350);
	expect('⭐ 重置后回到「未选择」', (await readLive()).picked, 'null');
	expect(
		'徽标回到「未选择」',
		await ev(`document.querySelector('[data-live] .tb3-ask__state-text').textContent`),
		'未选择',
	);
	await shot('11-reset.png');
}

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  断言数 ${total}（失败 ${failures.length}）`);

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
