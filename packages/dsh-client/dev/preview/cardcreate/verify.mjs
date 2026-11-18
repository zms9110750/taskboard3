/**
 * 建卡页预览的 CDP 验证 + 截图。
 *
 * `node packages/dsh-client/dev/preview/cardcreate/verify.mjs`
 *
 * ## 断言分六块
 *
 * ① **左栏顺序**：标题 → 模板 → 父任务 → [关系][高级设置]（用户 `2026-11-18` 列的顺序）。
 *    量 **top 坐标**，不查 DOM 顺序 —— DOM 顺序对了但 CSS 乱序也是错的。
 * ② **模板选择是三级联选弹层**（不是 select）：点触发器 → 三列出现；
 *    点「代码」→ 类别列变 3 个；点类别 → 模板列变。
 * ③ **⚠ 选完模板弹层不关**（旧版实测行为，见 `TemplatePickerPopover.tsx` 文件头）。
 * ④ **关系 | 高级设置互斥**：点关系展开、点高级切过去、再点收起。
 * ⑤ **窄栏不溢出**：左栏 320px，里面没有元素宽过它（组合里最容易出的毛病）。
 * ⑥ **错误挂到左栏字段下面**（点提交后标题为空 ⇒ `/title` 错误出现在标题框下）。
 *
 * ## 截图
 *
 * 三张，存 `X:\temp\final-create-*.png`：整页 / 弹层展开 / 关系面板展开。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const SHOTS = 'X:\\temp';
const PAGE = nodePath.join(HERE, 'index.html');
if (!existsSync(PAGE)) {
	console.error(`找不到 ${PAGE} —— 先跑 node dev/preview/build.mjs cardcreate`);
	process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9361;
const ud = mkdtempSync(nodePath.join(tmpdir(), 'cc-'));
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
	width: 1280,
	height: 860,
	deviceScaleFactor: 2,
	mobile: false,
});
await sleep(2500);

const ev = async (x) => {
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

let total = 0;
const expect = (label, actual, want) => {
	total += 1;
	const ok = JSON.stringify(actual) === JSON.stringify(want);
	if (!ok)
		failures.push(`${label}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(actual)}`);
	console.log(`  ${ok ? '✓' : '✗'} ${label}`);
};

const shot = async (name) => {
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(nodePath.join(SHOTS, name), Buffer.from(data, 'base64'));
	console.log(`  📷 ${name}`);
};

/* ══════════════════════════════════════════════════════════ */
console.log('\n═══ ① 整页骨架（满屏 + 左右分栏 + 固定顶底栏）═══');
{
	const page = await ev(`(() => {
    const el = document.querySelector('.tb3cc-page');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      fixed: getComputedStyle(el).position === 'fixed',
      w: Math.round(r.width), h: Math.round(r.height),
      leftW: Math.round(document.querySelector('.tb3cc-page__left').getBoundingClientRect().width),
      hasRight: document.querySelector('.tb3cc-page__right') !== null,
      hasTop: document.querySelector('.tb3cc-page__top') !== null,
      hasFoot: document.querySelector('.tb3cc-page__foot') !== null,
    };
  })()`);
	expect('满屏 page 存在且是 fixed', page !== null && page.fixed, true);
	expect('page 铺满视口（1280×860）', [page.w, page.h], [1280, 860]);
	expect('左栏 320px', page.leftW, 320);
	expect('右栏 / 顶栏 / 底栏都在', [page.hasRight, page.hasTop, page.hasFoot], [true, true, true]);

	expect(
		'⭐ 右栏有章节（真模板生成的，不是空的）',
		await ev(`document.querySelectorAll('.tb3cc-sec').length`),
		6,
	);
	expect(
		'顶栏标题是「新建事项」',
		await ev(`document.querySelector('.tb3cc-page__title').textContent`),
		'新建事项',
	);
	await shot('final-create-1-page.png');
}

console.log('\n═══ ② 左栏顺序：标题 → 模板 → 父任务 → [关系][高级设置] ═══');
{
	/*
	 * ⚠ 量 **top 坐标**，不查 DOM 顺序：DOM 顺序对了但 CSS 用 order/flex 乱序也是错的。
	 */
	const tops = await ev(`(() => {
    const top = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().top) : -1; };
    return {
      title: top('.tb3cc-leftcol .tb3cc-field'),
      tpl: top('.tb3cc-tfield'),
      meta: top('.tb3cc-meta'),
      leftLabel: document.querySelector('.tb3cc-leftcol .tb3cc-label').textContent.trim(),
      cells: [...document.querySelectorAll('.tb3cc-tfield__cell .tb3cc-label')].map(e => e.textContent.trim()),
      hasSelect: document.querySelector('.tb3cc-leftcol select') !== null,
    };
  })()`);
	expect('第一块是标题（label 带 *）', tops.leftLabel.startsWith('标题'), true);
	expect('模板块在父任务块**上面**（分行 = ②，不是同行 ①）', tops.cells, ['模板', '父任务']);

	const tplTop = await ev(
		`Math.round(document.querySelector('.tb3cc-tfield__cell').getBoundingClientRect().top)`,
	);
	const parentTop = await ev(
		`Math.round(document.querySelectorAll('.tb3cc-tfield__cell')[1].getBoundingClientRect().top)`,
	);
	expect('⭐ 模板和父任务**顶边不同**（真分行，不是并排）', tplTop !== parentTop, true);
	expect(
		'⭐ 模板和父任务**左边相同**（同一列）',
		await ev(`(() => {
      const a = document.querySelectorAll('.tb3cc-tfield__cell')[0].getBoundingClientRect();
      const b = document.querySelectorAll('.tb3cc-tfield__cell')[1].getBoundingClientRect();
      return Math.round(a.left) === Math.round(b.left);
    })()`),
		true,
	);
	expect('⚠ 左栏里没有 <select>（模板不是普通下拉）', tops.hasSelect, false);
	expect('⚠ 顺序：模板块 top < 关系/高级块 top', tops.tpl < tops.meta, true);
}

console.log('\n═══ ③ 模板：三级联选弹层（点开三列 —— 用户选的 ④）═══');
{
	expect(
		'弹层初始是关的',
		await ev(`document.querySelector('[data-picker-pop]') === null`),
		true,
	);

	await click(`document.querySelector('[data-picker-trigger]')`);
	await sleep(350);

	const pop = await ev(`(() => {
    const el = document.querySelector('[data-picker-pop]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      cols: [...el.querySelectorAll('[data-col]')].map(c => c.dataset.col),
      w: Math.round(r.width),
      domains: [...el.querySelectorAll('[data-col="domain"] .tb3cc-tpick__name')].map(e => e.textContent),
      kinds: [...el.querySelectorAll('[data-col="kind"] .tb3cc-tpick__name')].map(e => e.textContent),
      letters: [...el.querySelectorAll('[data-col="kind"] .tb3cc-tpick__prefix')].map(e => e.textContent),
      templates: [...el.querySelectorAll('[data-col="template"] .tb3cc-tpick__name')].map(e => e.textContent),
    };
  })()`);
	expect('⭐ 点触发器 ⇒ 三列弹层出现', pop !== null, true);
	expect('三列顺序 = 领域 / 类别 / 模板', pop.cols, ['domain', 'kind', 'template']);
	expect('领域列 = 核心 / 代码（核心在前）', pop.domains, ['核心', '代码']);
	/*
	 * ⚠ 初始定位在**已选模板所在的分组**（`expectedMismatch` = 代码 · 目标），
	 *   所以类别列是**代码领域**的 3 个类别（代码没有「记录」）。
	 *   第一版这里按「核心」写了 4 个 —— 断言当场红，是断言写错不是组件坏。
	 */
	expect('⭐ 类别列前面是**字母**不是圆圈', pop.letters, ['G', 'D', 'W']);
	expect('类别列 = 代码领域的 目标 / 设计 / 工作', pop.kinds, ['目标', '设计', '工作']);
	expect('模板列 = 代码领域 目标 类别的 4 个（初始定位到已选的预期不符）', pop.templates, [
		'预期不符',
		'新增功能',
		'项目优化',
		'编写测试',
	]);
	expect('弹层宽于左栏（三列塞不下 320px，会往右伸）', pop.w > 320, true);
	await shot('final-create-2-picker.png');
}

console.log('\n═══ ④ 三级联选真的能递进 ═══');
{
	await click(`document.querySelector('[data-col="domain"] [data-domain="代码"]')`);
	await sleep(320);
	expect(
		'点「代码」⇒ 类别列 = 目标 / 设计 / 工作（代码没有记录）',
		await ev(`[...document.querySelectorAll('[data-col="kind"] .tb3cc-tpick__name')].map(e => e.textContent)`),
		['目标', '设计', '工作'],
	);
	expect(
		'点「代码」⇒ 类别自动落到第一项「目标」',
		await ev(`document.querySelector('[data-col="kind"] [data-kind="goal"]').classList.contains('is-picked')`),
		true,
	);

	await click(`document.querySelector('[data-col="kind"] [data-kind="work"]')`);
	await sleep(320);
	expect(
		'点「工作」⇒ 模板列 = 代码的 工作 模板（只有「编写代码」）',
		await ev(`[...document.querySelectorAll('[data-col="template"] .tb3cc-tpick__name')].map(e => e.textContent)`),
		['编写代码'],
	);
}

console.log('\n═══ ⑤ ⭐ 选完模板：弹层**不关**（旧版实测行为），只重画 ═══');
{
	await click(`document.querySelector('[data-template="writeCode"]')`);
	await sleep(350);

	expect(
		'⭐ 选完弹层**还在**（旧版 pickTemplate 里是 renderPicker() 不是 close()）',
		await ev(`document.querySelector('[data-picker-pop]') !== null`),
		true,
	);
	expect(
		'触发器文字跟着变（代码 · 编写代码）',
		await ev(`document.querySelector('[data-picker-trigger] .tb3cc-tpick__value').textContent`),
		'代码 · 编写代码',
	);
	expect(
		'⭐ 模板列的高亮移到选中项（重画的效果）',
		await ev(`document.querySelector('[data-template="writeCode"]').classList.contains('is-picked')`),
		true,
	);
	expect(
		'底部说明跟着变（段数 = 2）',
		await ev(`document.querySelector('[data-picker-foot] [data-foot-segs]').dataset.footSegs`),
		'2',
	);

	/* 点面板外面才关 */
	await click(`document.querySelector('.tb3cc-page__title')`);
	await sleep(350);
	expect(
		'点外面才关',
		await ev(`document.querySelector('[data-picker-pop]') === null`),
		true,
	);

	/*
	 * ⚠ 右栏章节数必须跟着换（expectedMismatch 6 章 ⇒ writeCode 2 章）。
	 *   这条测的是**预览把「换模板重建章节」接上了** —— 左栏只改 templateRef，
	 *   重建是调用方的事（见 `CreateLeftColumn` 文件头）。
	 */
	expect(
		'⭐ 换模板后右栏章节跟着变（6 → 2 章）',
		await ev(`document.querySelectorAll('.tb3cc-sec').length`),
		2,
	);
	expect(
		'左栏说明块显示新模板的段数',
		await ev(`document.querySelector('.tb3cc-tpl-hint__meta').textContent.includes('共 2 段')`),
		true,
	);

	/* 换回来，后面截图用章节多的那个 */
	await click(`document.querySelector('[data-picker-trigger]')`);
	await sleep(320);
	await click(`document.querySelector('[data-col="domain"] [data-domain="代码"]')`);
	await sleep(280);
	await click(`document.querySelector('[data-col="kind"] [data-kind="goal"]')`);
	await sleep(280);
	await click(`document.querySelector('[data-template="expectedMismatch"]')`);
	await sleep(320);
	await click(`document.querySelector('.tb3cc-page__title')`);
	await sleep(320);
	expect('换回「预期不符」⇒ 右栏回到 6 章', await ev(`document.querySelectorAll('.tb3cc-sec').length`), 6);
}

console.log('\n═══ ⑥ 关系 | 高级设置：两个按钮 + 共用折叠区（用户选的 ⑤）═══');
{
	expect(
		'两个标签按钮',
		await ev(`[...document.querySelectorAll('[data-meta-tab]')].map(b => b.dataset.metaTab)`),
		['rel', 'adv'],
	);
	expect(
		'初始都收起（没有面板）',
		await ev(`document.querySelectorAll('.tb3cc-meta__panel').length`),
		0,
	);
	expect('计数初始 = 0', await ev(`document.querySelector('[data-rel-count]').textContent`), '0');

	await click(`document.querySelector('[data-meta-tab="rel"]')`);
	await sleep(320);
	expect('点「关系」⇒ 关系面板出现', await ev(`document.querySelector('[data-panel="rel"]') !== null`), true);
	expect(
		'「关系」按钮高亮',
		await ev(`document.querySelector('[data-meta-tab="rel"]').classList.contains('is-on')`),
		true,
	);
	expect(
		'⭐ 点「添加关联」⇒ 计数**不变**（空行不算一条关系）',
		await (async () => {
			await click(`document.querySelector('.tb3cc-meta__rel-add')`);
			await sleep(300);
			return ev(`document.querySelector('[data-rel-count]').textContent`);
		})(),
		'0',
	);
	expect(
		'空行有一行（类型默认依赖）',
		await ev(`[...document.querySelectorAll('.tb3cc-meta__rel-kind')].map(s => s.value)`),
		['dependsOn'],
	);

	await click(`document.querySelector('[data-meta-tab="adv"]')`);
	await sleep(320);
	expect(
		'⭐ 点「高级设置」⇒ 关系面板**关掉**（互斥 + 共用一块位置）',
		await ev(`document.querySelector('[data-panel="rel"]') === null`),
		true,
	);
	expect('高级面板打开', await ev(`document.querySelector('[data-panel="adv"]') !== null`), true);
	expect(
		'按钮高亮跟着换',
		await ev(`[...document.querySelectorAll('[data-meta-tab]')].map(b => b.classList.contains('is-on'))`),
		[false, true],
	);
	expect(
		'高级设置明说「暂无设置项」（不装作能点）',
		await ev(`document.querySelector('[data-panel="adv"]').textContent.includes('暂无设置项')`),
		true,
	);

	/* 关系目标真的能选（CardPicker 过滤生效） */
	await click(`document.querySelector('[data-meta-tab="rel"]')`);
	await sleep(320);
	await click(`document.querySelector('[data-meta-tab="rel"]')`);
	await sleep(200);
	await click(`document.querySelector('[data-meta-tab="rel"]')`);
	await sleep(320);
	await click(`document.querySelectorAll('.tb3cc-meta__rel-row .tb3cc-picker__display')[0]`);
	await sleep(320);
	const ids = await ev(
		`[...document.querySelectorAll('.tb3cc-meta__rel-row .tb3cc-picker__item')].filter(e => e.dataset.cardId).map(e => e.dataset.cardId)`,
	);
	expect('⭐ 关系目标列表滤掉了草稿 GU-01 和墓碑 RB-99', ids.includes('GU-01') || ids.includes('RB-99'), false);
	expect('正常卡还在（DM-01）', ids.includes('DM-01'), true);
	await click(`document.querySelectorAll('.tb3cc-meta__rel-row .tb3cc-picker__item')[0]`);
	await sleep(320);
	expect(
		'选完目标 ⇒ 计数变 1（现在算一条关系了）',
		await ev(`document.querySelector('[data-rel-count]').textContent`),
		'1',
	);

	await shot('final-create-3-meta.png');
}

console.log('\n═══ ⑦ 错误挂在左栏字段下面（render prop 的 errorOf 接对了）═══');
{
	/* 清空标题 ⇒ 点提交 ⇒ `/title` 错误出现在标题框下面 */
	await ev(`(() => {
    const input = document.querySelector('.tb3cc-leftcol .tb3cc-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
	await sleep(250);
	await click(`[...document.querySelectorAll('.tb3cc-btn')].find(b => b.textContent.trim() === '提交')`);
	await sleep(400);

	expect(
		'⭐ 标题错误出现在左栏标题框下面',
		await ev(`(() => {
      const el = document.querySelector('[data-field-err="title"]');
      return el === null ? null : el.textContent.trim();
    })()`),
		'卡标题不能为空。',
	);
	expect(
		'⭐ 错误在**左栏**（不是右栏 / 不是 toast）',
		await ev(`(() => {
      const err = document.querySelector('[data-field-err="title"]');
      const left = document.querySelector('.tb3cc-page__left');
      return err !== null && left.contains(err);
    })()`),
		true,
	);
	expect(
		'底栏报错误数',
		await ev(`document.querySelector('.tb3cc-actions__err') !== null`),
		true,
	);
}

console.log('\n═══ ⑧ 窄栏不溢出（320px 里最容易出的毛病）═══');
{
	const overflow = await ev(`(() => {
    const left = document.querySelector('.tb3cc-page__left');
    const lr = left.getBoundingClientRect();
    const bad = [];
    for (const el of left.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      /* 弹层是 absolute 且故意比左栏宽 ⇒ 跳过它和它的子树。 */
      if (el.closest('[data-picker-pop]') !== null) continue;
      if (r.width > 0 && (r.right > lr.right + 1 || r.left < lr.left - 1)) {
        bad.push(\`\${el.className || el.tagName}:\${Math.round(r.left)}-\${Math.round(r.right)} vs \${Math.round(lr.left)}-\${Math.round(lr.right)}\`);
      }
    }
    return { bad: bad.slice(0, 4), count: bad.length, leftW: Math.round(lr.width) };
  })()`);
	expect('左栏宽 320px', overflow.leftW, 320);
	expect('⚠ 左栏内容没有横向溢出（弹层之外）', overflow.bad, []);
	expect(
		'页面没有横向滚动条',
		await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`),
		true,
	);
}

console.log('\n═══ JS 错误 ═══');
console.log(errors.length ? errors.join('\n') : '  没有');
console.log('\n═══ 断言结果 ═══');
console.log(failures.length ? failures.join('\n') : '  全部通过');
console.log(`  断言数 ${total}（失败 ${failures.length}）`);
console.log(`  截图目录 ${SHOTS}`);

proc.kill();
process.exit(failures.length > 0 || errors.length > 0 ? 1 : 0);
