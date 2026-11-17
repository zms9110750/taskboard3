/**
 * 验证 CardDetail（卡片详情面板）。
 *
 * `node packages/dsh-client/dev/preview/carddetail/verify.mjs`
 *
 * ## 断言分七块，前四块就是任务描述点名要的
 *
 * ① **标题独占一行** —— 用 `getBoundingClientRect()` 量标题和 meta 行：
 *    **纵向不重叠** + 标题在上一行。同时断言标题文字**不在** meta 里。
 *    （这是几何断言，不是「读 CSS 猜的」。）
 * ② **备注常驻** —— 六个场景 + 活面板，**每一个**都有 `[data-detail-note]`；
 *    其中 `empty-history`（空备注、0 历史、0 章节）也必须有。
 * ③ **没有「正文」二字** —— 全页 `document.body.innerText` 不含「正文」，
 *    且不存在 `.detail-body` / `[data-detail-body]` 这种容器节点。
 * ④ **历史可折叠** —— 0 条整块不出现；1 条直接展开且**没有**折叠按钮；
 *    3 条初始折叠、点表头能展开并出现 3 条。
 * ⑤ 动作行：关系按钮 `emphasis=primary` + 计算样式是 accent 实底；
 *    点它派发 `add-relation`，点派生子任务派发 `derive`；墓碑时两个都禁用。
 * ⑥ 备注交互：失焦提交一次、值没变不提交；墓碑时 textarea disabled 且只读提示在。
 * ⑦ 章节：平铺（label 顺序 = 卡上的键顺序）、空内容显示「（空）」。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';

const EDGE = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((one) => existsSync(one));
const HERE = import.meta.dirname;
/** 截图放本组件自己的子目录 ⇒ 不跟别的组件抢文件名。 */
const OUT = nodePath.join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });
const PAGE = nodePath.join(HERE, 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9311;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'cd-'));
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
	width: 1000,
	height: 1800,
	deviceScaleFactor: 1,
	mobile: false,
});
await sleep(2200);

const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(OUT, name), Buffer.from(data, 'base64'));
};
const ev = async (x) => {
	const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails)
		console.log('  ERR', (r.exceptionDetails.exception?.description || '').slice(0, 300));
	return r.result?.value;
};
const click = async (sel) => {
	/*
	 * ⚠ 先 `scrollIntoView`：页面有 7 个详情面板，靠后的面板在视口外，
	 *   直接按 `getBoundingClientRect()` 的坐标点会点到空白（y > 视口高）。
	 *   这个坑在第一次跑的时候让「展开历史」三条断言全红。
	 */
	const b = await ev(`(() => { const el = ${sel}; if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
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

let total = 0;
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok)
		failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

/** 读一个场景的详情面板全貌。 */
const readPanel = (key) =>
	ev(`(() => {
  const box = document.querySelector('[data-scenario="${key}"] .detail');
  if (!box) return null;
  const q = (sel) => box.querySelector(sel);
  const note = q('[data-detail-note]');
  const hist = q('[data-detail-history]');
  return {
    hasPanel: true,
    title: q('[data-detail-title]') ? q('[data-detail-title]').textContent : null,
    metaKinds: [...box.querySelectorAll('[data-meta]')].map(n => n.dataset.meta),
    metaText: [...box.querySelectorAll('[data-meta]')].map(n => n.textContent.trim()),
    actions: [...box.querySelectorAll('[data-action-kind]')].map(b => ({
      kind: b.dataset.actionKind,
      emphasis: b.dataset.emphasis,
      label: b.querySelector('.detail-action__label').textContent,
      badge: b.querySelector('.detail-action__badge') ? b.querySelector('.detail-action__badge').textContent : null,
      disabled: b.disabled,
      bg: getComputedStyle(b).backgroundColor,
      color: getComputedStyle(b).color,
    })),
    sectionLabels: [...box.querySelectorAll('[data-section-id]')].map(n => ({
      id: n.dataset.sectionId,
      label: n.querySelector('.detail-section__label').textContent,
      body: n.querySelector('.detail-section__body').textContent,
    })),
    hasSectionsEmpty: q('[data-sections-empty]') !== null,
    note: note === null ? null : {
      label: note.querySelector('.detail-note__label').textContent,
      value: note.querySelector('[data-note-input]').value,
      disabled: note.querySelector('[data-note-input]').disabled,
      readonlyHint: note.querySelector('[data-note-readonly]') !== null,
      visible: getComputedStyle(note).display !== 'none' && note.getBoundingClientRect().height > 0,
    },
    history: hist === null ? null : {
      count: hist.dataset.historyCount,
      hasToggle: hist.querySelector('[data-history-toggle]') !== null,
      toggleLabel: hist.querySelector('[data-history-toggle]') ? hist.querySelector('[data-history-toggle] .detail-history__label').textContent : null,
      headLabel: hist.querySelector('.detail-history__head .detail-history__label') ? hist.querySelector('.detail-history__head .detail-history__label').textContent : null,
      expandedAttr: hist.querySelector('[data-history-toggle]') ? hist.querySelector('[data-history-toggle]').getAttribute('aria-expanded') : null,
      hasList: hist.querySelector('[data-history-list]') !== null,
      items: [...hist.querySelectorAll('[data-history-action]')].map(n => ({
        action: n.dataset.historyAction,
        text: n.querySelector('.detail-history__text').textContent,
        time: n.querySelector('.detail-history__time').textContent,
      })),
    },
    hasBanner: q('[data-detail-banner]') !== null,
    banner: q('[data-detail-banner]') ? q('[data-detail-banner]').textContent : null,
    iconBtns: [...box.querySelectorAll('.icon-btn')].map(b => b.dataset.detailClose !== undefined ? 'close' : (b.dataset.detailExpand !== undefined ? 'expand' : '?')),
    hasBodyContainer: box.querySelector('.detail-body, [data-detail-body]') !== null,
    rects: (() => {
      const title = q('[data-detail-title]');
      const meta = q('[data-detail-meta]');
      if (title === null || meta === null) return null;
      const a = title.getBoundingClientRect();
      const b = meta.getBoundingClientRect();
      return {
        title: { top: Math.round(a.top), bottom: Math.round(a.bottom) },
        meta: { top: Math.round(b.top), bottom: Math.round(b.bottom) },
        overlapY: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
      };
    })(),
  };
})()`);

const readEvents = () =>
	ev(`[...document.querySelectorAll('[data-event]')].map(li => li.dataset.event)`);
const clearEvents = () => ev(`document.querySelector('[data-clear-log]').click()`);

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ① ⭐ 标题独占一行 ═══');
{
	const panes = await ev(`document.querySelectorAll('.detail').length`);
	expect('七个详情面板都渲染了（1 活 + 6 场景）', panes, 7);

	const many = await readPanel('many-history');
	expect('标题文字正确', many.title, '把详情面板重做成「标题独占一行、备注常驻」');
	expect(
		'meta 五格顺序 = 编号/类别/领域/模板/状态',
		many.metaKinds,
		['id', 'kind', 'domain', 'template', 'status'],
	);
	expect('⭐ 标题**不在** meta 里', many.metaText.includes(many.title), false);
	expect(
		'⭐ meta 里没有一格包含标题（不出现「重做」子串）',
		many.metaText.some((x) => x.includes('重做')),
		false,
	);
	expect('⭐ 标题和 meta 的矩形**纵向不重叠**', many.rects.overlapY, 0);
	expect(
		'⭐ 标题整体在 meta 上方（不是一个 flex-wrap 换行出来的巧合）',
		many.rects.title.bottom <= many.rects.meta.top,
		true,
	);
	await shot('01-overview.png');
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ② ⭐ 备注常驻（每个场景都有）═══');
{
	const keys = ['empty-history', 'one-history', 'many-history', 'deleted', 'no-sections', 'no-close'];
	const notes = [];
	for (const key of keys) {
		const one = await readPanel(key);
		notes.push({ key, has: one.note !== null, visible: one.note !== null && one.note.visible });
	}
	expect(
		'⭐ 六个场景都有备注节点且**真的可见**',
		notes.map((one) => one.has && one.visible),
		[true, true, true, true, true, true],
	);

	const empty = await readPanel('empty-history');
	expect('⭐ 备注为空字符串时**依然在**（不是「有才显示」）', empty.note.value, '');
	expect('⭐ 空备注也在且可见', empty.note.visible, true);
	expect('备注文案照旧版', empty.note.label, '备注 / 搁置理由（随时写）');

	const deleted = await readPanel('deleted');
	expect('⭐ 墓碑 ⇒ 备注仍在', deleted.note !== null, true);
	expect('墓碑 ⇒ 备注只读（disabled）', deleted.note.disabled, true);
	expect('墓碑 ⇒ 有「只读」提示', deleted.note.readonlyHint, true);

	const liveNote = await ev(`(() => {
    const box = document.querySelector('[data-live] .detail');
    const n = box.querySelector('[data-detail-note]');
    return n === null ? null : { value: n.querySelector('[data-note-input]').value };
  })()`);
	expect('⭐ 活面板也有备注，且带当前值', liveNote.value, '等用户确认「历史默认折叠」这一条。');
	expect('活面板备注**没有**折叠按钮（不存在 + 备注 这种东西）', await ev(
		`(() => {
      const box = document.querySelector('[data-live] .detail');
      return [...box.querySelectorAll('button')].filter(b => /备注/.test(b.textContent)).length;
    })()`,
	), 0);
	await shot('02-note-always.png');
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ③ ⭐ 没有「正文」二字 ═══');
{
	const bodyText = await ev('document.body.innerText');
	expect('⭐ 全页 innerText 不含「正文」', bodyText.includes('正文'), false);
	expect(
		'⭐ 也没有 .detail-body 这种包住所有章节的容器节点',
		await ev(`document.querySelectorAll('.detail-body, [data-detail-body]').length`),
		0,
	);
	/* 反向校验：断言本身有效（页面里确实有「历史」「备注」这些词）*/
	expect('（对照）页面确实含「备注」二字 ⇒ 上面的断言不是空跑', bodyText.includes('备注'), true);
	expect('（对照）页面确实含「历史」二字', bodyText.includes('历史'), true);

	const sections = await readPanel('many-history');
	expect(
		'⭐ 章节平铺：label 顺序 = 卡上的键顺序（goal → design → record）',
		sections.sectionLabels.map((one) => one.label),
		['目标', '设计', '记录'],
	);
	expect('空内容的章节显示「（空）」', sections.sectionLabels[2].body.trim(), '（空）');
	const noSec = await readPanel('no-sections');
	expect('没有章节 ⇒ 显示占位（不是空白）', noSec.hasSectionsEmpty, true);
	expect('没有章节 ⇒ 占位文案说明原因', await ev(
		`document.querySelector('[data-scenario="no-sections"] [data-sections-empty]').textContent`,
	), '这张卡的模板没有章节。');
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ④ ⭐ 历史可折叠 ═══');
{
	const none = await readPanel('empty-history');
	expect('⭐ 0 条 ⇒ 整块历史不出现', none.history, null);

	const one = await readPanel('one-history');
	expect('⭐ 1 条 ⇒ 显示', one.history !== null, true);
	expect('⭐ 1 条 ⇒ **没有**折叠按钮（不给点了没反应的按钮）', one.history.hasToggle, false);
	expect('⭐ 1 条 ⇒ 列表直接展开', one.history.hasList, true);
	expect('1 条的内容', one.history.items.map((x) => x.action), ['create']);
	expect('表头带计数（不可折叠时是 div，不是 button）', one.history.headLabel, '历史（1）');

	const many = await readPanel('many-history');
	expect('⭐ 3 条 ⇒ 有折叠按钮', many.history.hasToggle, true);
	expect('⭐ 3 条 ⇒ 初始 `aria-expanded=false`', many.history.expandedAttr, 'false');
	expect('⭐ 3 条 ⇒ 初始**不渲染**列表', many.history.hasList, false);
	expect('⭐ 3 条 ⇒ 初始一条 item 都没有', many.history.items, []);
	expect('表头文字 = 历史（3）', many.history.toggleLabel, '历史（3）');

	await shot('03-history-collapsed.png');

	/* 点开 */
	await clearEvents();
	await click(`document.querySelector('[data-scenario="many-history"] [data-history-toggle]')`);
	await sleep(320);
	const opened = await readPanel('many-history');
	expect('⭐ 点表头 ⇒ 展开，出现 3 条', opened.history.items.length, 3);
	expect('⭐ 展开后 `aria-expanded=true`', opened.history.expandedAttr, 'true');
	expect(
		'⭐ 最新在上（update → transition → create）',
		opened.history.items.map((one) => one.action),
		['update', 'transition', 'create'],
	);
	expect(
		'人话：AI 那条说「AI 把状态从…」',
		opened.history.items[1].text,
		'AI 把状态从「提交」改成「处理中」',
	);
	expect('每条都带时间', opened.history.items.every((one) => /^\d\d-\d\d \d\d:\d\d$/.test(one.time)), true);
	expect('点表头**不**派发业务回调（只是 UI 开合）', await readEvents(), []);
	await shot('04-history-expanded.png');

	/* 再点收起 */
	await click(`document.querySelector('[data-scenario="many-history"] [data-history-toggle]')`);
	await sleep(320);
	const closed = await readPanel('many-history');
	expect('⭐ 再点一次 ⇒ 又收起（列表消失）', closed.history.hasList, false);
	expect('收起后 `aria-expanded=false`', closed.history.expandedAttr, 'false');
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑤ ⭐ 关系按钮显眼 + 动作派发 ═══');
{
	const many = await readPanel('many-history');
	expect(
		'动作行顺序 = 关系 → 派生子任务',
		many.actions.map((one) => one.kind),
		['relations', 'derive'],
	);
	const rel = many.actions[0];
	const derive = many.actions[1];
	expect('⭐ 关系按钮 emphasis = primary', rel.emphasis, 'primary');
	expect('派生子任务 emphasis = normal', derive.emphasis, 'normal');
	expect('⭐ 关系按钮是 accent **实底**（rgb(37, 99, 235)）', rel.bg, 'rgb(37, 99, 235)');
	expect('⭐ 关系按钮文字是白色（反白，够显眼）', rel.color, 'rgb(255, 255, 255)');
	expect('关系计数 = 父任务 1 + links 2 = 3', rel.badge, '3');
	expect('关系按钮文案', rel.label, '关系');
	expect('派生子任务文案', derive.label, '+ 派生子任务');
	expect('派生子任务**没有**计数徽标', derive.badge, null);

	await clearEvents();
	await click(`document.querySelector('[data-scenario="many-history"] [data-action-kind="relations"]')`);
	await sleep(300);
	expect('⭐ 点关系 ⇒ 派发 add-relation', await readEvents(), ['many-history/add-relation']);

	await clearEvents();
	await click(`document.querySelector('[data-scenario="many-history"] [data-action-kind="derive"]')`);
	await sleep(300);
	expect('⭐ 点派生子任务 ⇒ 派发 derive', await readEvents(), ['many-history/derive']);

	const deleted = await readPanel('deleted');
	expect('墓碑 ⇒ 两个动作都禁用', deleted.actions.map((one) => one.disabled), [true, true]);
	expect('墓碑 ⇒ 有横幅', deleted.hasBanner, true);
	expect('横幅说明只能查看', deleted.banner.includes('只能查看'), true);
	await clearEvents();
	await click(`document.querySelector('[data-scenario="deleted"] [data-action-kind="relations"]')`);
	await sleep(280);
	expect('墓碑 ⇒ 点禁用按钮什么都不派发', await readEvents(), []);
	await shot('05-deleted.png');
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑥ 备注交互：失焦提交、值没变不提交 ═══');
{
	await clearEvents();
	/* 改活面板的备注，再点别处触发 blur */
	await ev(`(() => {
    const el = document.querySelector('[data-live] [data-note-input]');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, '新备注内容');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
	await sleep(120);
	expect('输入过程中**不**提交（不是每敲一个字都写库）', await readEvents(), []);
	await ev(`document.querySelector('[data-live] [data-detail-title]').focus()`);
	await ev(`document.querySelector('[data-live] [data-note-input]').blur()`);
	await sleep(320);
	expect('⭐ 失焦 ⇒ 提交一次 note:新备注内容', await readEvents(), ['note:新备注内容']);

	await clearEvents();
	await ev(`(() => {
    const el = document.querySelector('[data-live] [data-note-input]');
    el.focus(); el.blur();
  })()`);
	await sleep(280);
	expect('⭐ 值没变 ⇒ 失焦**不**提交（不白发 PATCH）', await readEvents(), []);
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑦ 图标按钮 / 关闭 / 切卡 ═══');
{
	const many = await readPanel('many-history');
	expect('有 ⧉ 和 × 两个图标按钮', many.iconBtns.sort(), ['close', 'expand']);

	const none = await readPanel('no-close');
	expect('⭐ 不传 onClose/onExpand ⇒ 一个图标按钮都没有', none.iconBtns, []);

	await clearEvents();
	await click(`document.querySelector('[data-scenario="many-history"] [data-detail-expand]')`);
	await sleep(250);
	expect('点 ⧉ ⇒ 派发 expand', await readEvents(), ['many-history/expand']);

	await clearEvents();
	await click(`document.querySelector('[data-live] [data-detail-close]')`);
	await sleep(300);
	expect('点 × ⇒ 派发 close', await readEvents(), ['close']);
	expect('点 × ⇒ 详情面板消失（显示空白提示）', await ev(
		`document.querySelector('[data-live] [data-live-closed]') !== null`,
	), true);

	/* 切到第二张卡（1 条历史）：历史应该**展开**、且备注跟着换 */
	await ev(`document.querySelector('[data-clear-log]').click()`);
	await click(`document.querySelector('[data-live-bar] [data-pick-card="DE-04"]')`);
	await sleep(350);
	expect('切卡按钮真的点到了', await ev(
		`document.querySelector('[data-live-bar] [data-pick-card="DE-04"]').classList.contains('is-active')`,
	), true);
	const second = await ev(`(() => {
    const box = document.querySelector('[data-live] .detail');
    const hist = box.querySelector('[data-detail-history]');
    return {
      cardId: box.dataset.cardId,
      title: box.querySelector('[data-detail-title]').textContent,
      hasToggle: hist.querySelector('[data-history-toggle]') !== null,
      hasList: hist.querySelector('[data-history-list]') !== null,
      note: box.querySelector('[data-note-input]').value,
      metaText: [...box.querySelectorAll('[data-meta]')].map(n => n.textContent.trim()),
    };
  })()`);
	expect('⭐ 切卡 ⇒ 卡 id 跟着换', second.cardId, 'DE-04');
	expect('标题跟着换', second.title, '第二张卡（历史只有一条）');
	expect(
		'⭐ 切卡后历史折叠态不串（第二张只有 1 条 ⇒ 无折叠按钮、直接展开）',
		[second.hasToggle, second.hasList],
		[false, true],
	);
	expect('⭐ 切卡后备注值是**这张卡的**（空）', second.note, '');
	await shot('06-second-card.png');
}

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ⑧ DOM 契约（别的组件/测试要依赖的钩子）═══');
{
	const hooks = await ev(`(() => {
    const box = document.querySelector('[data-scenario="many-history"] .detail');
    return {
      root: box.classList.contains('detail'),
      hasHead: box.querySelector('.detail-head') !== null,
      hasTitleRow: box.querySelector('.detail-title-row') !== null,
      hasMeta: box.querySelector('[data-detail-meta]') !== null,
      hasActions: box.querySelector('[data-detail-actions]') !== null,
      hasSections: box.querySelector('[data-detail-sections]') !== null,
      hasNote: box.querySelector('[data-detail-note]') !== null,
      hasHistory: box.querySelector('[data-detail-history]') !== null,
      cardId: box.dataset.cardId,
    };
  })()`);
	expect('根 class = detail + data-card-id', [hooks.root, hooks.cardId], [true, 'DE-03']);
	expect('六个区块都在', [
		hooks.hasHead,
		hooks.hasTitleRow,
		hooks.hasMeta,
		hooks.hasActions,
		hooks.hasSections,
		hooks.hasNote,
		hooks.hasHistory,
	], [true, true, true, true, true, true, true]);

	/* 面板顺序：head → sections → note → history（备注在历史之上，旧版顺序） */
	const order = await ev(`(() => {
    const box = document.querySelector('[data-scenario="many-history"] .detail');
    const marks = ['.detail-head', '[data-detail-sections]', '[data-detail-note]', '[data-detail-history]'];
    return marks.map(m => { const el = box.querySelector(m); return el === null ? -1 : [...box.children].indexOf(el); });
  })()`);
	expect('⭐ 顺序：head → 章节 → 备注 → 历史（备注在历史上方）', order, [0, 1, 2, 3]);
}

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  断言数 ${total}（失败 ${failures.length}）`);

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
