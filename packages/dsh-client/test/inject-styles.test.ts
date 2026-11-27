/**
 * `injectStyles()` 的**副作用契约** —— 它必须把样式表真的挂进 DOM。
 *
 * ## 这个测试存在的理由（2026-11-23 在隔离 profile 里实测到的真 bug）
 *
 * `injectStyles()` 原来只做了三件事：
 *
 * ```ts
 * const element = document.createElement('style');
 * element.id = STYLE_ID;
 * element.textContent = `${CREATE_CSS}\n${WORKSPACE_CSS}\n...`;
 * ```
 *
 * **没有 `appendChild`。** `createElement` + 设 `textContent` 只是造了一个
 * **游离节点**，样式表根本不存在于文档里。
 *
 * ### 症状（CDP 实测数字）
 *
 * ```
 * 选中 taskboard tab 后：
 *   document.querySelectorAll('[class*="tb3"]')  = 39 个元素   ← 结构全对
 *   document.querySelectorAll('style')           = 162 个
 *   style.textContent.includes('tb3w-')          = 0 个        ← 我们的样式表压根没进 DOM
 *   document.getElementById('taskboard3-styles') = null
 *   getComputedStyle(root).display               = 'block'     ← 应该是 flex
 *   getComputedStyle(title).fontSize             = '16px'      ← 应该是 12.5px
 * ```
 *
 * **⇒ 面板渲染出来了，但一点样式都没有，全屏散成一行行文字。**
 *
 * ### 为什么一直没被发现
 *
 * 预览（`dev/preview/`）的 CSS 走的是 `build.mjs` 里 `readFileSync` 真 `.css`
 * 再插 `<style>` 的路子 —— **不经过 `injectStyles()`**。
 * ⇒ 预览全绿，产品白板。
 *
 * 挂上 `document.head.appendChild(element)` 之后：
 *
 * ```
 * styleExists = true   styleLen = 82225
 * root.display = 'flex'   title.fontSize = '12.5px'   bar.display = 'flex'
 * ```
 *
 * ## 断言什么
 *
 * 1. `injectStyles()` 之后 `document.getElementById(STYLE_ID)` **能找到**
 * 2. 那个 `<style>` 的 `textContent` **非空**且含我们的类名
 * 3. 幂等：调两次只有一个 `<style>`
 *
 * 用 jsdom 之类的重依赖不值得 —— 这里造一个最小的假 `document`，
 * 只实现被测代码用到的那几个方法（`getElementById` / `createElement` /
 * `head.appendChild`）。**假 document 的 `appendChild` 会真的记录**，
 * 所以「忘了挂」这个 bug 一定红。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STYLE_ID, STYLE_SEGMENTS, injectStyles } from '../src/styles.ts';

/** 一个最简假节点：记下 `id` / `textContent` / 子节点。 */
interface FakeNode {
	id: string;
	textContent: string;
	readonly children: FakeNode[];
	tagName: string;
}

/**
 * 造一个只实现 `injectStyles()` 用到的那几个方法的假 `document`。
 *
 * @returns 假 document + 挂进去的节点列表
 */
function fakeDocument(): { document: Record<string, unknown>; mounted: FakeNode[] } {
	const mounted: FakeNode[] = [];

	const makeNode = (tagName: string): FakeNode => ({
		id: '',
		textContent: '',
		children: [],
		tagName,
	});

	/**
	 * 深度遍历已挂载的树 —— 模拟 `getElementById` 真实语义（含子孙）。
	 *
	 * ⚠ **找不到时必须返回 `null`，不是 `undefined`。**
	 *   被测代码写的是 `if (document.getElementById(STYLE_ID) !== null) return;`
	 *   —— 返回 `undefined` 会让 `undefined !== null` 成立 ⇒ 提前返回，永远不插样式。
	 *   真实 DOM 的 `getElementById` 返回 `null`，假 document 必须一致，
	 *   否则测的不是产品行为。
	 */
	const findById = (nodes: readonly FakeNode[], id: string): FakeNode | null => {
		for (const node of nodes) {
			if (node.id === id) return node;
			const hit = findById(node.children, id);
			if (hit !== null) return hit;
		}
		return null;
	};

	const head = makeNode('head');
	/* `appendChild` 是唯一记录挂载的入口 —— 被测代码忘了它，mounted 就是空。 */
	(head as unknown as { appendChild: (child: FakeNode) => FakeNode }).appendChild = (
		child: FakeNode,
	): FakeNode => {
		mounted.push(child);
		head.children.push(child);
		return child;
	};

	const document = {
		head,
		getElementById: (id: string): FakeNode | null => findById(mounted, id),
		createElement: (tagName: string): FakeNode => makeNode(tagName),
	};

	return { document, mounted };
}

/**
 * 在假 document 下跑一次 `injectStyles()`。
 *
 * @returns 挂进去的节点列表
 */
function run(): FakeNode[] {
	const { document, mounted } = fakeDocument();
	(globalThis as { document?: unknown }).document = document;
	try {
		injectStyles();
	} finally {
		delete (globalThis as { document?: unknown }).document;
	}
	return mounted;
}

describe('injectStyles() 的副作用契约', () => {
	it('⭐ 样式表必须真的挂进 DOM（不是只 createElement 就丢掉）', () => {
		const mounted = run();

		assert.equal(
			mounted.length,
			1,
			`⚠ injectStyles() 必须 appendChild 到 document.head —— ` +
				`实际挂载 ${String(mounted.length)} 个节点。` +
				'不挂上去的话样式表不存在于文档里，面板会渲染成无样式的裸文字。',
		);
		assert.equal(mounted[0]?.tagName, 'style');
	});

	it('⭐ 挂上去的那个 style 的 id 是 STYLE_ID', () => {
		const mounted = run();
		assert.equal(mounted[0]?.id, STYLE_ID);
	});

	it('⭐ 挂上去的 style 的 textContent 非空且含我们的类名', () => {
		const mounted = run();
		const css = mounted[0]?.textContent ?? '';

		assert.ok(css.length > 1000, `样式内容太短（${String(css.length)} 字符），可能拼错了`);
		/* 用 `.tb3w-root` —— 它是工作区根节点，任何一段 CSS 缺失时最可能先掉这个。 */
		assert.ok(css.includes('.tb3w-root'), '样式内容里找不到 .tb3w-root（工作区根节点样式丢了）');
	});

	it('⭐ 幂等：调两次只挂一个 style', () => {
		const { document, mounted } = fakeDocument();
		(globalThis as { document?: unknown }).document = document;
		try {
			injectStyles();
			injectStyles();
		} finally {
			delete (globalThis as { document?: unknown }).document;
		}

		assert.equal(mounted.length, 1, '重复调用不该插出第二个 <style>');
	});

	it('⚠ 没有 document 时（SSR / node 环境）不抛错', () => {
		assert.doesNotThrow(() => {
			injectStyles();
		});
	});
});

/**
 * 逐段哨兵 —— **拦住「漏注入一段」**。
 *
 * ## 为什么需要
 *
 * 注入曾经是手写模板字符串 `${A}\n${B}\n…`。少写一段（例如新增了
 * `CARD_ACTION_CSS` 但忘了拼进去）**不会报错**：产品照常渲染，只是那部分
 * 控件没样式 —— 而且往往只在某个入口/某种状态下才看得出来。
 *
 * 现在 `injectStyles()` 由 `STYLE_SEGMENTS` 表驱动；这里逐段钉两件事：
 *
 * 1. **表覆盖了预期的全部段**（独立于表的名单 —— 删表项时这条会红）
 * 2. 每段的 `sentinel` 真的进入了注入结果（空串 / 拼错 / 漏 join 时红）
 */
describe('injectStyles() 逐段哨兵', () => {
	/** 独立名单（不从表里推）—— 表少一段时这里会红。 */
	const EXPECTED_SEGMENTS = [
		'CREATE_CSS',
		'WORKSPACE_CSS',
		'SECTION_CSS',
		'SEARCHBOX_CSS',
		'DRAWER_CSS',
		'CREATE_SHELL_CSS',
		'TECHTREE_CSS',
		'FALLBACK_CSS',
		'DERIVE_MENU_CSS',
		'CARD_ACTION_CSS',
		'SIBLING_GROUPS_CSS',
	];

	it('⭐ 注入表覆盖全部预期段（顺序不变）', () => {
		assert.deepEqual(
			STYLE_SEGMENTS.map((segment) => segment.name),
			EXPECTED_SEGMENTS,
			'STYLE_SEGMENTS 少了一段 / 顺序变了 —— 漏注入一段不会报错，只会少一截样式',
		);
	});

	it('⭐ 每一段的 sentinel 都在自己的 CSS 里（哨兵本身没拼错）', () => {
		for (const segment of STYLE_SEGMENTS) {
			assert.ok(
				segment.css.includes(segment.sentinel),
				`${segment.name} 的哨兵 ${JSON.stringify(segment.sentinel)} 不在这段 CSS 里`,
			);
		}
	});

	it('⭐ 每一个 sentinel 都出现在注入结果里（没有哪段被漏拼）', () => {
		const css = run()[0]?.textContent ?? '';
		for (const segment of STYLE_SEGMENTS) {
			assert.ok(
				css.includes(segment.sentinel),
				`注入结果缺少 ${segment.name}（哨兵 ${JSON.stringify(segment.sentinel)}）—— 这段样式没进 DOM`,
			);
		}
	});

	it('TECHTREE_CSS 在 WORKSPACE_CSS 之后（同特异度规则靠后写赢）', () => {
		const names = STYLE_SEGMENTS.map((segment) => segment.name);
		assert.ok(
			names.indexOf('TECHTREE_CSS') > names.indexOf('WORKSPACE_CSS'),
			'顺序有约束：TECHTREE_CSS 必须靠后，见 STYLE_SEGMENTS 的注释',
		);
	});
});

/**
 * 关系图例的那句「（只在科技树视图显示）」已删（`2026-11-23`）。
 *
 * 用户原话：
 *
 * > 「图例上面不需要"（仅科技树）"这几个字。在列表模式下这个图例和字都有。
 * > 就不要说什么仅科技树了。这字还占文档流。」
 *
 * ⇒ 图例在列表模式下**也显示**（CDP 实测：两种模式 `display` 都是 `flex`、
 *   6 个关系项都在），所以那句话本身是假的；它还白占 60–110px 宽度。
 *
 * 这条测试守的是**不许把 hint 的样式加回来** —— 加回来一定伴随着把字塞回 DOM。
 */
describe('关系图例不带「仅科技树」说明', () => {
	it('⭐ 样式表里没有任何 legend__hint 规则', () => {
		const css = run()[0]?.textContent ?? '';
		assert.equal(
			css.includes('legend__hint'),
			false,
			'`.tb3w-legend__hint*` 又出现了 —— 那串「（只在科技树视图显示）」不该回来',
		);
	});
});
