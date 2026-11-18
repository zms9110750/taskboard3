/**
 * `pure/markdown-tokens.ts` 的测试 —— **纯 token 化那层，零 DOM、零 React**。
 *
 * 这层之所以要先做，是因为「安全白名单」是**唯一可能静默错**的部分：
 * 它不报错、不崩，只是把不该活的标签放过去了。用 `node --test` 直接测，
 * 比起浏览器点 20 秒一次快得多，也不会因为「预览页没重跑」而假绿。
 *
 * ⚠ XSS 用例不是「顺手加几条」，是本文件的主体。每条都断言**产物里没有那个东西**，
 *   而不是断言「产物长这样」—— 后者改个类名就红，前者才是安全断言。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	MD_PROP_KEYS,
	MD_TAGS,
	decodeEntities,
	isSafeHref,
	renderMarkdownNodes,
	type MdElement,
	type MdNode,
} from '../src/pure/markdown-tokens.ts';

/* ══════════════════════════════════════════════════════════
   断言小工具
   ══════════════════════════════════════════════════════════ */

/** 深度优先收集所有元素。 */
function elements(nodes: readonly MdNode[]): MdElement[] {
	const out: MdElement[] = [];
	const walk = (list: readonly MdNode[]): void => {
		for (const node of list) {
			if (node.kind !== 'element') continue;
			out.push(node);
			walk(node.children);
		}
	};
	walk(nodes);
	return out;
}

/** 所有标签名（小写）。 */
function tags(nodes: readonly MdNode[]): string[] {
	return elements(nodes).map((one) => one.tag);
}

/** 所有文本（拼接）。 */
function text(nodes: readonly MdNode[]): string {
	let out = '';
	const walk = (list: readonly MdNode[]): void => {
		for (const node of list) {
			if (node.kind === 'text') out += node.value;
			else walk(node.children);
		}
	};
	walk(nodes);
	return out;
}

/** 找第一个指定标签。 */
function first(nodes: readonly MdNode[], tag: string): MdElement | undefined {
	return elements(nodes).find((one) => one.tag === tag);
}

/** 空元素（没有闭合标签）。 */
const VOID = new Set(['br', 'hr']);

/**
 * 收敛成一个字符串的「源码视图」—— 把树打印成 `<tag k=v>text</tag>`。
 *
 * 用来做「整体形状」断言；安全断言一律用 `tags()` / `propKeys()`。
 * 空元素打印成 `<br>`（不是 `<br></br>`）—— 与 HTML 序列化一致。
 */
function dump(nodes: readonly MdNode[]): string {
	return nodes
		.map((node) => {
			if (node.kind === 'text') return node.value;
			const props = Object.entries(node.props)
				.map(([key, value]) => ` ${key}="${value}"`)
				.join('');
			if (VOID.has(node.tag) && node.children.length === 0) return `<${node.tag}${props}>`;
			const inner = dump(node.children);
			return `<${node.tag}${props}>${inner}</${node.tag}>`;
		})
		.join('');
}

/** 产物里出现过的所有属性名（安全断言用：不允许 `on*` 之类冒出来）。 */
function propKeys(nodes: readonly MdNode[]): string[] {
	return elements(nodes).flatMap((one) => Object.keys(one.props));
}

/* ══════════════════════════════════════════════════════════
   ⚠ XSS —— 本文件的主体
   ══════════════════════════════════════════════════════════ */

describe('XSS —— script / iframe / img onerror', () => {
	it('<script>alert(1)</script> ⇒ 连文字都不留（整棵丢弃）', () => {
		const nodes = renderMarkdownNodes('<script>alert(1)</script>');
		assert.deepEqual(tags(nodes), []);
		assert.equal(text(nodes), '');
	});

	it('行内 <script> ⇒ 标签与脚本内容都不留，句子其余部分正常', () => {
		const nodes = renderMarkdownNodes('before <script>alert(1)</script> after');
		assert.deepEqual(tags(nodes), ['p']);
		assert.equal(text(nodes), 'before  after');
	});

	it('<script> 跨块 ⇒ 中间的内容也被吞掉（不是只丢标签）', () => {
		const nodes = renderMarkdownNodes('<script>\n\nalert(1)\n\n</script>\n\nafter');
		assert.equal(text(nodes), 'after');
	});

	it('<img src=x onerror=alert(1)> ⇒ 整棵丢弃，不留 alt/文字', () => {
		const nodes = renderMarkdownNodes('x <img src=x onerror=alert(1)> y');
		assert.deepEqual(tags(nodes), ['p']);
		assert.equal(text(nodes), 'x  y');
		assert.ok(!propKeys(nodes).includes('onerror'));
	});

	it('markdown 图片 ![alt](https://x/y.png) ⇒ 整棵丢弃（旧版同样）', () => {
		const nodes = renderMarkdownNodes('![alt](https://x/y.png)');
		/* 整段只剩一个空 `<p>` ⇒ 连 `<p>` 都不留（别占一行空高）。 */
		assert.deepEqual(tags(nodes), []);
		assert.equal(text(nodes), '');
	});

	it('<iframe src=…> ⇒ 整棵丢弃', () => {
		const nodes = renderMarkdownNodes('<iframe src="https://evil"></iframe>');
		assert.deepEqual(tags(nodes), []);
		assert.equal(text(nodes), '');
	});

	it('<style> 与 <svg onload> ⇒ 整棵丢弃', () => {
		assert.deepEqual(tags(renderMarkdownNodes('<style>body{display:none}</style>')), []);
		assert.deepEqual(tags(renderMarkdownNodes('<svg onload=alert(1)><circle/></svg>')), []);
	});

	it('<input> / <link> / <meta> / <base> ⇒ 空元素丢弃', () => {
		for (const one of ['<input value=x>', '<link rel=stylesheet href=x>', '<meta http-equiv=refresh>', '<base href=x>']) {
			const nodes = renderMarkdownNodes(one);
			assert.deepEqual(tags(nodes), [], one);
		}
	});

	it('原始 HTML 的 on* 事件属性一个都进不来（属性是白名单不是黑名单）', () => {
		const nodes = renderMarkdownNodes('<p onmouseover="alert(1)">hi</p><a href="/x" onclick="alert(1)">l</a>');
		assert.deepEqual(
			propKeys(nodes).filter((one) => one.startsWith('on')),
			[],
		);
		assert.equal(dump(nodes), '<p>hi</p><a href="/x" target="_blank" rel="noopener noreferrer">l</a>');
	});

	it('只有白名单属性键能出现在产物里', () => {
		const source = [
			'# h',
			'<p class="c" align="center" id="i" style="x" data-evil="1">p</p>',
			'<a href="/a" title="t" rel="opener">a</a>',
			'| a |\n|:-:|\n| 1 |',
		].join('\n\n');
		for (const key of propKeys(renderMarkdownNodes(source))) {
			assert.ok((MD_PROP_KEYS as readonly string[]).includes(key), `属性 ${key} 不在白名单里`);
		}
	});
});

describe('XSS —— 链接协议', () => {
	it('[x](javascript:alert(1)) ⇒ 拆标签留文字', () => {
		const nodes = renderMarkdownNodes('[x](javascript:alert(1))');
		assert.deepEqual(tags(nodes), ['p']);
		assert.equal(text(nodes), 'x');
	});

	it('实体混淆的 javascript: 也拦（jav&#x61;script:）', () => {
		const nodes = renderMarkdownNodes('[x](jav&#x61;script:alert(1))');
		assert.deepEqual(tags(nodes), ['p']);
		assert.equal(text(nodes), 'x');
	});

	it('大小写混写 / 前置空白 / 控制字符 都不能绕过', () => {
		for (const href of ['JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
			assert.equal(isSafeHref(href), false, href);
		}
	});

	it('协议相对 //evil.com 不放行（那是外站，不是站内相对路径）', () => {
		assert.equal(isSafeHref('//evil.com/x'), false);
		const nodes = renderMarkdownNodes('[x](//evil.com/x)');
		assert.deepEqual(tags(nodes), ['p']);
		assert.equal(text(nodes), 'x');
	});

	it('http / https / mailto / 站内 /x 放行，统一加 _blank + noopener', () => {
		for (const href of ['http://a.b', 'https://a.b', 'HTTPS://a.b', 'mailto:a@b.c', '/rel/path']) {
			assert.equal(isSafeHref(href), true, href);
		}
		const nodes = renderMarkdownNodes('[a](https://a.b)');
		assert.equal(dump(nodes), '<p><a href="https://a.b" target="_blank" rel="noopener noreferrer">a</a></p>');
	});

	it('带有害协议的原始 <a> 也拆标签', () => {
		const nodes = renderMarkdownNodes('<a href="javascript:alert(1)">click</a>');
		assert.deepEqual(tags(nodes), ['p']);
		assert.equal(text(nodes), 'click');
	});
});

/* ══════════════════════════════════════════════════════════
   GFM / CommonMark 正常语法
   ══════════════════════════════════════════════════════════ */

describe('基本功 —— 白名单标签', () => {
	it('**粗体** ⇒ strong', () => {
		assert.equal(dump(renderMarkdownNodes('**粗体**')), '<p><strong>粗体</strong></p>');
	});

	it('*斜体* / ~~删除~~', () => {
		assert.equal(dump(renderMarkdownNodes('*斜*')), '<p><em>斜</em></p>');
		assert.equal(dump(renderMarkdownNodes('~~删~~')), '<p><del>删</del></p>');
	});

	it('`行内代码` ⇒ code', () => {
		assert.equal(dump(renderMarkdownNodes('`a<b>`')), '<p><code>a<b></code></p>');
	});

	it('标题 h1..h6（# 与 setext 两种写法）', () => {
		assert.equal(dump(renderMarkdownNodes('# T')), '<h1>T</h1>');
		assert.equal(dump(renderMarkdownNodes('###### T')), '<h6>T</h6>');
		assert.equal(dump(renderMarkdownNodes('A\n===')), '<h1>A</h1>');
		assert.equal(dump(renderMarkdownNodes('B\n---')), '<h2>B</h2>');
	});

	it('硬换行 ⇒ br（breaks:false 时 两个空格 才有）', () => {
		assert.equal(dump(renderMarkdownNodes('a  \nb')), '<p>a<br>b</p>');
	});

	it('无序 / 有序 / 嵌套列表', () => {
		assert.equal(dump(renderMarkdownNodes('- a\n- b')), '<ul><li>a</li><li>b</li></ul>');
		assert.equal(dump(renderMarkdownNodes('1. a\n2. b')), '<ol><li>a</li><li>b</li></ol>');
		assert.equal(dump(renderMarkdownNodes('- a\n  - b')), '<ul><li>a<ul><li>b</li></ul></li></ul>');
	});

	it('引用块', () => {
		assert.equal(dump(renderMarkdownNodes('> q')), '<blockquote><p>q</p></blockquote>');
	});

	it('分隔线 ⇒ hr', () => {
		assert.equal(dump(renderMarkdownNodes('---')), '<hr>');
	});

	it('⚠ 代码块 ⇒ pre.md-code[data-lang] > code.md-code__body', () => {
		const nodes = renderMarkdownNodes('```ts\nconst x = 1;\n```');
		assert.equal(dump(nodes), '<pre class="md-code" data-lang="ts"><code class="md-code__body">const x = 1;</code></pre>');
	});

	it('无语言代码块 ⇒ 不带 data-lang', () => {
		assert.equal(dump(renderMarkdownNodes('```\nx\n```')), '<pre class="md-code"><code class="md-code__body">x</code></pre>');
	});

	it('⚠ 表格 ⇒ table.md-table + thead/tbody + align', () => {
		const nodes = renderMarkdownNodes('| a | b |\n|:--|--:|\n| 1 | 2 |');
		assert.equal(
			dump(nodes),
			'<table class="md-table"><thead><tr><th align="left">a</th><th align="right">b</th></tr></thead>' +
				'<tbody><tr><td align="left">1</td><td align="right">2</td></tr></tbody></table>',
		);
	});

	it('⚠ 任务列表 ⇒ li.md-task（完成加 is-done）+ span.md-task__box', () => {
		const nodes = renderMarkdownNodes('- [ ] todo\n- [x] done');
		assert.equal(
			dump(nodes),
			'<ul><li class="md-task"><span class="md-task__box">☐</span>todo</li>' +
				'<li class="md-task is-done"><span class="md-task__box">☑</span>done</li></ul>',
		);
	});

	it('GFM 自动链接（裸 URL）⇒ a', () => {
		const nodes = renderMarkdownNodes('see https://example.com/x');
		assert.equal(dump(nodes), '<p>see <a href="https://example.com/x" target="_blank" rel="noopener noreferrer">https://example.com/x</a></p>');
	});
});

/* ══════════════════════════════════════════════════════════
   白名单外的标签 —— 拆标签留文字
   ══════════════════════════════════════════════════════════ */

describe('白名单外 —— 拆标签留文字', () => {
	it('<b>x</b> ⇒ 只剩文字（b 不是白名单，语义强调该用 strong）', () => {
		assert.equal(dump(renderMarkdownNodes('a <b>x</b> c')), '<p>a x c</p>');
	});

	it('<div> 块级 ⇒ 拆掉，内部段落照常', () => {
		assert.equal(dump(renderMarkdownNodes('<div>\n\npara\n\n</div>')), '<p>para</p>');
	});

	it('<details> 之类未知标签 ⇒ 只留文字（与旧版 DOMParser 拆标签的结果一致）', () => {
		/*
		 * `marked` 把 `<details><summary>s</summary>` 给成**一个**块级 html token，
		 * 旧版 DOMParser 会解析成 `details > summary > "s"`，再逐层拆标签
		 * ⇒ 根上留一个裸文本节点 `s`。这里行为相同。
		 */
		assert.equal(dump(renderMarkdownNodes('<details><summary>s</summary>\n\nbody\n\n</details>')), 's<p>body</p>');
	});

	it('白名单里的 <span class> 保留（只留合法 class）', () => {
		assert.equal(dump(renderMarkdownNodes('a <span class="x">s</span> c')), '<p>a <span class="x">s</span> c</p>');
	});

	it('危险 class（含引号/尖括号以外符号）被丢弃但元素保留', () => {
		assert.equal(dump(renderMarkdownNodes('a <span class="x{background:red}">s</span>')), '<p>a <span>s</span></p>');
	});
});

/* ══════════════════════════════════════════════════════════
   实体 / 边角
   ══════════════════════════════════════════════════════════ */

describe('实体解码', () => {
	it('命名实体', () => {
		assert.equal(decodeEntities('a &amp; b &lt;i&gt; &copy;'), 'a & b <i> ©');
	});

	it('数字实体（十/十六进制）', () => {
		assert.equal(decodeEntities('&#65;&#x42;&#x4e2d;'), 'AB中');
	});

	it('未知实体原样保留（浏览器同样原样显示）', () => {
		assert.equal(decodeEntities('&notanentity;'), '&notanentity;');
	});

	it('裸 & 不动', () => {
		assert.equal(decodeEntities('a & b'), 'a & b');
	});

	it('正文里的实体在产物里被解开（与旧版 DOMParser 行为一致）', () => {
		assert.equal(dump(renderMarkdownNodes('a &amp; b')), '<p>a & b</p>');
	});

	it('代码里的实体不解（代码要原样）', () => {
		assert.equal(dump(renderMarkdownNodes('`&amp;`')), '<p><code>&amp;</code></p>');
	});
});

describe('边角输入', () => {
	it('空串 / 纯空白 / 非字符串 ⇒ 空数组', () => {
		assert.deepEqual(renderMarkdownNodes(''), []);
		assert.deepEqual(renderMarkdownNodes('   \n\n  '), []);
		assert.deepEqual(renderMarkdownNodes(undefined as unknown as string), []);
	});

	it('未闭合的原始标签不会吞掉后面的内容', () => {
		assert.equal(dump(renderMarkdownNodes('<span>open')), '<p><span>open</span></p>');
	});

	it('未闭合的丢弃标签：吞到结尾（宁可少显示，不可漏出来）', () => {
		const nodes = renderMarkdownNodes('<script>never closed');
		assert.deepEqual(tags(nodes), []);
		assert.equal(text(nodes), '');
	});

	it('注释 / doctype 不产生节点也不产生文字', () => {
		assert.deepEqual(renderMarkdownNodes('<!-- c -->'), []);
		assert.deepEqual(renderMarkdownNodes('<!doctype html>'), []);
	});

	it('产物标签 100% 落在白名单内（模糊测试式总断言）', () => {
		const source = [
			'# 标题',
			'**粗** *斜* ~~删~~ `码` [链](https://a.b)',
			'- 列\n  - 嵌套\n\n- [x] 任务',
			'> 引',
			'```js\nlet a = 1;\n```',
			'| a |\n|---|\n| 1 |',
			'---',
			'<div><b>b</b><script>s</script><img src=x></div>',
			'<a href="javascript:1">bad</a>',
		].join('\n\n');
		for (const tag of tags(renderMarkdownNodes(source))) {
			assert.ok((MD_TAGS as readonly string[]).includes(tag), `标签 ${tag} 不在白名单里`);
		}
	});

	it('同一个输入两次结果相同（无隐藏状态）', () => {
		const source = '<span>a</span> **b**\n\n<script>x</script>\n\nc';
		assert.deepEqual(renderMarkdownNodes(source), renderMarkdownNodes(source));
	});
});
