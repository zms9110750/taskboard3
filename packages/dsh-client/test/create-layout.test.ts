/**
 * 建卡整页的**布局不变量**测试。
 *
 * ## 为什么用「读 CSS 字符串」而不是渲染
 *
 * 这个文件测的不是「组件画得对不对」（那要 CDP），而是**那条必须存在的 CSS 规则还在不在**。
 *
 * 具体只测一条：
 *
 * ```css
 * .tb3cc-page__body { min-height: 0 }
 * ```
 *
 * ## ⚠ 为什么这条值得单独测
 *
 * flex 子元素默认 `min-height: auto` —— 会被内容撑高。
 * 一旦 `min-height: 0` 被删掉（这在「优化 CSS」时很容易发生，因为它看起来像多余的一行）：
 *
 * - 中间层的 `overflow-y: auto` **静默失效**
 * - **整页变成滚动区**，顶栏和底栏跟着内容一起滚走
 * - 界面上「看起来还行」（只是顶栏会滚出去），**没有任何报错**
 *
 * ⇒ 单测钉住它。删了这条 CSS 就变红。
 *
 * 同样地，`overflow-y: auto` 必须**只在** `__right` 和 `__left` 上，
 * **不能**在 `.tb3cc-page` / `.tb3cc-page__body` 上 —— 那会把「唯一滚动区」变成「整页滚动」。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CREATE_CSS } from '../src/styles.ts';

/** 取某条选择器的规则体（粗提取，够用）。 */
function ruleOf(css: string, selector: string): string {
	const start = css.indexOf(`${selector}{`);
	if (start < 0) return '';
	const bodyStart = start + selector.length + 1;
	const end = css.indexOf('}', bodyStart);
	if (end < 0) return '';
	return css.slice(bodyStart, end);
}

/**
 * 取某条 `@container` 查询的**整块**内容（含嵌套规则）。
 *
 * 粗提取：从 `@container …` 找到下一个同名缩进层级的 `}`。够用 ——
 * `CREATE_CSS` 是两个空格缩进的，块内没有其它顶层条目。
 *
 * @param css 整段 CSS
 * @param condition 条件片段（如 `max-width: 700px`）
 */
function containerBlockOf(css: string, condition: string): string {
	const at = css.indexOf(`@container tb3cc (${condition})`);
	if (at < 0) return '';
	/* 从 `{` 开始按花括号配对，配到 0 就是块尾。 */
	const open = css.indexOf('{', at);
	if (open < 0) return '';
	let depth = 0;
	for (let i = open; i < css.length; i += 1) {
		const ch = css[i];
		if (ch === '{') depth += 1;
		else if (ch === '}') {
			depth -= 1;
			if (depth === 0) return css.slice(open + 1, i);
		}
	}
	return '';
}

describe('CREATE_CSS —— 满屏布局的不变量', () => {
	it('⚠ `.tb3cc-page__body` 必须有 `min-height:0`（否则子元素 overflow 失效、整页滚动）', () => {
		const body = ruleOf(CREATE_CSS, '.tb3cc-page__body');
		assert.notEqual(body, '', '.tb3cc-page__body 规则不存在');
		assert.ok(
			body.replace(/\s+/g, '').includes('min-height:0'),
			`⚠ .tb3cc-page__body 缺 min-height:0 —— 这会让中间层的 overflow-y:auto 静默失效、` +
				`整页变成滚动区（顶栏底栏跟着滚走）。实际规则：${body}`,
		);
	});

	it('⚠ 页面本体**填满父容器**（height:100%），不是铺满浏览器', () => {
		const page = ruleOf(CREATE_CSS, '.tb3cc-page').replace(/\s+/g, '');
		assert.ok(page.includes('height:100%'), `页面必须撑满父容器。实际：${page}`);
		assert.ok(page.includes('min-height:0'), `撑满 + 可收缩，缺 min-height:0 会撑破父容器。实际：${page}`);
	});

	it('⚠⚠ 页面本体**不许有 position:fixed**（会脱离父容器、按浏览器窗口铺开）', () => {
		/*
		 * 这条以前是**正向**断言「满屏不是弹窗」：
		 *
		 * ```ts
		 * assert.ok(page.includes('position:fixed'));
		 * assert.ok(page.includes('inset:0'));
		 * ```
		 *
		 * 用户 `2026-11-19` 给了三个真实尺寸后，那个断言的原意（「满屏」）是对的，
		 * **但它的手段正是 bug**：
		 *
		 * > `position: fixed` 会脱离父容器 —— 挂在 570×920 的工作区 tab 里，
		 * > 它也按整个浏览器窗口铺开 ⇒ 左右两栏被挤扁。
		 *
		 * ⇒ 断言反过来：
		 *   · ✅ `height:100%`（撑满父容器，见上一条）
		 *   · ❌ **不许有 `position:fixed`**（那会逃离父容器）
		 *   · ❌ 也不许有 `position:absolute`（同样脱离文档流，父容器撑不住）
		 *
		 * 「满屏」这个诉求现在由 `container-type:size` + 父容器高度保证，
		 * 不再靠 fixed。CDP 的三个尺寸断言（`cardcreate/verify.mjs`）钉住实际效果。
		 */
		const page = ruleOf(CREATE_CSS, '.tb3cc-page').replace(/\s+/g, '');
		assert.equal(
			page.includes('position:fixed'),
			false,
			`⚠ .tb3cc-page 不能 position:fixed —— 它会脱离父容器，` +
				`在 570×920 的工作区里按整个浏览器窗口铺开。实际规则：${page}`,
		);
		assert.equal(
			page.includes('position:absolute'),
			false,
			`⚠ .tb3cc-page 不能 position:absolute —— 同样脱离文档流。实际规则：${page}`,
		);
		assert.equal(
			page.includes('inset:0'),
			false,
			`⚠ 不要用 inset:0 铺满浏览器。实际规则：${page}`,
		);
	});

	it('⭐ 页面是容器查询的宿主（container-type:size + container-name）', () => {
		/*
		 * `container-type: size` 是响应式的前提：两条 `@container` 都查这个容器。
		 *
		 * ⚠ **`size` 而不是 `inline-size`** —— 要同时查宽和高：
		 *   宽度决定「堆不堆叠」，高度决定「收不收间距」。两个维度是两件事。
		 * ⚠ 代价：`container-type:size` 让元素**不再由内容撑开** ⇒ 必须给它高度
		 *   （`height:100%`），父层没高度时页会塌成 0。这一条由预览的三个尺寸舞台实证。
		 */
		const page = ruleOf(CREATE_CSS, '.tb3cc-page').replace(/\s+/g, '');
		assert.ok(
			page.includes('container-type:size'),
			`⚠ 缺 container-type:size ⇒ 两条 @container 全部失效、响应式静默不生效。实际：${page}`,
		);
		/* `container-name` 可以省略（匿名容器也能查），但查的时候得写对名字。 */
		assert.ok(page.includes('container-name:tb3cc'), `缺 container-name。实际：${page}`);
	});

	it('⚠ 两条容器查询都在：宽 <700 堆叠、高 <560 收紧', () => {
		/*
		 * 这两条是三个真实尺寸的全部响应式逻辑。
		 *
		 * ⚠ **判断依据必须分开**：宽的门槛管**结构**（堆叠），高的门槛管**间距**。
		 *   抽屉是 1200 **宽** × 400 高 —— 宽得能横排，只是矮。
		 *   若把两个门槛合成「面积 / 小 ⇒ 堆叠」，1200×400 会被误判成堆叠，400 高竖着塞两栏必死。
		 */
		assert.ok(
			/@container\s+tb3cc\s*\(max-width:\s*700px\)/.test(CREATE_CSS),
			'缺宽度容器查询 `@container tb3cc (max-width: 700px)` —— 570 宽的工作区不会堆叠',
		);
		assert.ok(
			/@container\s+tb3cc\s*\(max-height:\s*560px\)/.test(CREATE_CSS),
			'缺高度容器查询 `@container tb3cc (max-height: 560px)` —— 400 高的抽屉不会收紧',
		);
	});

	it('⭐ 宽度查询**只改结构**（body 变 column + 左栏改尺寸/边框）', () => {
		const block = containerBlockOf(CREATE_CSS, 'max-width: 700px');
		assert.ok(block.includes('flex-direction:column'), `缺「堆叠」这一条。实际：${block}`);
		/*
		 * ⚠ 左栏必须有 max-height：570×920 里左栏内容能到 500px+，
		 *   不给上限会把右栏挤到只剩一条缝。
		 */
		assert.match(block, /max-height:/, `左栏要有 max-height 上限。实际：${block}`);
		assert.ok(
			block.includes('border-bottom'),
			`堆叠后左右栏之间要有一条水平分隔线（原来的 border-right 要撤掉）。实际：${block}`,
		);
	});

	it('⚠⚠ 窄容器里左栏上限必须够大（≥65%），否则关系一展开就出滚动条', () => {
		/*
		 * 用户 `2026-11-19`：
		 * > 「抽屉打滚动无所谓。**但是工作区打滚动就不行。**」
		 *
		 * 实测 570×920（左栏内容自然高，含 padding）：
		 *
		 * | 左栏状态 | 自然高 |
		 * |---|---|
		 * | 关系收起 | 341px |
		 * | 关系展开（空）| 457px |
		 * | 关系展开 + 1 行关联 | 471px |
		 *
		 * 第一版给 46%（≈376px）⇒ **关系一展开左栏就滚**，正是用户否掉的行为。
		 * ⇒ 上限必须 ≥ 65%，让「关系展开 + 几行关联」这个典型状态装得下。
		 *
		 * ⚠ 这条不是「越大越好」：到 100% 右栏就没了。70% 是「典型状态不滚 + 右栏还露一截」的平衡。
		 */
		const block = containerBlockOf(CREATE_CSS, 'max-width: 700px');
		const hit = /\.tb3cc-page__left\{[^}]*max-height:(\d+)%/.exec(block);
		assert.notEqual(hit, null, `左栏的 max-height 应该是百分比（相对容器高）。实际：${block}`);
		const percent = Number(hit?.[1]);
		assert.ok(
			percent >= 65,
			`⚠ 左栏 max-height 只有 ${String(percent)}% —— 570×920 下关系一展开就会出滚动条` +
				`（用户明确否掉「工作区打滚动」）。至少要 65%，现在是 70%。`,
		);
		assert.ok(percent <= 85, `左栏 max-height ${String(percent)}% 太大 —— 右栏会被挤没。`);
	});

	it('⭐ 高度查询**只改间距**（不改 flex-direction，否则等于偷偷堆叠）', () => {
		const block = containerBlockOf(CREATE_CSS, 'max-height: 560px');
		assert.equal(
			block.includes('flex-direction'),
			false,
			`⚠ 高度查询**不许**改 flex-direction —— 那等于按高度决定堆叠，` +
				`抽屉 1200×400 会变成竖排（实测会死）。实际：${block}`,
		);
		assert.ok(block.length > 0, '高度查询块是空的');
	});

	it('⚠ 滚动只加在左右两栏，不加在 page / body 上', () => {
		for (const selector of ['.tb3cc-page', '.tb3cc-page__body']) {
			const rule = ruleOf(CREATE_CSS, selector).replace(/\s+/g, '');
			assert.equal(
				rule.includes('overflow-y:auto') || rule.includes('overflow:auto'),
				false,
				`${selector} 不该自己滚动 —— 滚动区只能是 .tb3cc-page__left / .tb3cc-page__right。实际：${rule}`,
			);
		}
		for (const selector of ['.tb3cc-page__left', '.tb3cc-page__right']) {
			const rule = ruleOf(CREATE_CSS, selector).replace(/\s+/g, '');
			assert.ok(rule.includes('overflow-y:auto'), `${selector} 应该是滚动区。实际：${rule}`);
		}
	});

	it('顶栏/底栏不参与 flex 伸缩（flex:0 0 auto）', () => {
		for (const selector of ['.tb3cc-page__top', '.tb3cc-page__foot']) {
			/*
			 * ⚠ **不能先 `replace(/\s+/g,'')` 再比对 `flex:0 0 auto`** ——
			 *   那会把值里的空格也吃掉（变成 `flex:00auto`），断言永远匹配不上。
			 *   这里只在**选择器匹配**时容忍空白，值用宽松正则。
			 */
			const rule = ruleOf(CREATE_CSS, selector);
			assert.match(rule, /flex:\s*0\s+0\s+auto/, `${selector} 必须固定高度。实际：${rule}`);
		}
	});

	it('中间层是唯一伸缩区（flex:1 1 auto）', () => {
		const body = ruleOf(CREATE_CSS, '.tb3cc-page__body');
		assert.match(body, /flex:\s*1\s+1\s+auto/, body);
	});

	it('⚠ ask 的占位**不用红色**（是「待实现」不是「出错」）', () => {
		const pending = ruleOf(CREATE_CSS, '.tb3cc-sec__pending').toLowerCase();
		assert.equal(
			pending.includes('danger') || pending.includes('red'),
			false,
			`ask 占位不该用危险色 —— 它是「还没做」，不是「出错」。实际：${pending}`,
		);
	});

	it('全部类名带 tb3cc- 前缀（避免和面板内的 tb3-* 相撞）', () => {
		/*
		 * ⚠ **只扫「行首的 `.`」**（= 真正的规则选择器），不要扫全文里的 `\.\w+`。
		 *
		 * 全文扫会把**注释里的文件名**当成类名：注释写「见 `test/create-layout.test.ts`
		 * 的反向断言」时，`.ts ` 后面跟着空格 ⇒ 正则抓到类名 `ts` ⇒ 报一条
		 * 「类名 ts 没有 tb3cc- 前缀」的假错误（实测踩过）。
		 *
		 * 行首匹配同时能跳过注释行（注释行以 ` *` 开头，`.` 不在行首）。
		 */
		/*
		 * `noUncheckedIndexedAccess` 让 `one[1]` 的类型是 `string | undefined`
		 * —— 正则**一定**有一个捕获组，所以这里用**显式判断**收窄（不是 `!`）：
		 * 真出现没有捕获组的情况（正则写错），下面那条断言会直接报出来。
		 */
		const selectors = [...CREATE_CSS.matchAll(/^\s*\.([a-zA-Z][\w-]*)/gm)]
			.map((one) => one[1])
			.filter((one): one is string => one !== undefined);
		assert.ok(selectors.length > 10, `只找到 ${selectors.length} 个选择器，提取可能有问题`);
		for (const name of selectors) {
			/*
			 * ⚠ **状态修饰符例外**：`.tb3cc-sec.has-error` 里的 `has-error` 是状态，
			 *   不是本组件的独立类名 —— 它故意跟随宿主/通行 BEM 习惯。
			 */
			if (/^(has|is)-/.test(name)) continue;
			assert.ok(
				name.startsWith('tb3cc-'),
				`类名「${name}」没有 tb3cc- 前缀 —— 会和面板内的 tb3-* 混淆`,
			);
		}
	});

	it('⚠ 组件里用的每个类名都能在 CREATE_CSS 里找到规则（防「改了类名忘了改 CSS」）', async () => {
		/*
		 * 这条防的是**类名漂移**：组件里写 `tb3cc-page__left`、CSS 里还是
		 * `tb3cc-left` ⇒ 样式静默失效，界面上只是「看着不对」，**不报错**。
		 *
		 * 做法：读组件源码文本，抽出所有 `className="…"`，逐个查 CSS。
		 * ⚠ 不用渲染（那要 CDP）；文本扫描够用，而且跑得快。
		 */
		const { readFileSync } = await import('node:fs');
		const { join, dirname } = await import('node:path');
		const { fileURLToPath } = await import('node:url');

		const here = dirname(fileURLToPath(import.meta.url));
		const dir = join(here, '..', 'src', 'renderers', 'create');
		const files = [
			'CardCreate.tsx',
			'SectionFormList.tsx',
			'SectionFormItem.tsx',
			'CreateActions.tsx',
			'TemplateHint.tsx',
			/* 左栏定稿（用户 2026-11-19「用 245」）—— 这一组是新加的，必须一起查 */
			'CreateLeftColumn.tsx',
			'TemplateField.tsx',
			'TemplatePickerPopover.tsx',
			'MetaTabs.tsx',
			'MetaPanelContent.tsx',
			'CardPicker.tsx',
		];

		const used = new Set<string>();
		for (const file of files) {
			const text = readFileSync(join(dir, file), 'utf8');
			for (const match of text.matchAll(/className="([^"]+)"/g)) {
				for (const one of (match[1] ?? '').split(/\s+/)) {
					if (one.startsWith('tb3cc-')) used.add(one);
				}
			}
			/* 动态拼的（模板字符串）只取静态前缀部分，照样能查。 */
			for (const match of text.matchAll(/className=\{`([^`$]+)/g)) {
				for (const one of (match[1] ?? '').split(/\s+/)) {
					if (one.startsWith('tb3cc-')) used.add(one);
				}
			}
		}

		assert.ok(used.size > 8, `只抽出 ${used.size} 个类名，扫描可能有问题`);

		const missing = [...used].filter((one) => !CREATE_CSS.includes(`.${one}`));
		assert.deepEqual(
			missing,
			[],
			`这些类名在组件里用了但 CSS 里没有规则（样式会静默失效）：${missing.join('、')}`,
		);
	});
});
