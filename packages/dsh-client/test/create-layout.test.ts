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

	it('页面本体是 fixed inset:0（满屏，不是弹窗）', () => {
		const page = ruleOf(CREATE_CSS, '.tb3cc-page').replace(/\s+/g, '');
		assert.ok(page.includes('position:fixed'), page);
		assert.ok(page.includes('inset:0'), page);
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
		const selectors = [...CREATE_CSS.matchAll(/\.([a-zA-Z][\w-]*)[\s,:{]/g)].map((one) => one[1]);
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
