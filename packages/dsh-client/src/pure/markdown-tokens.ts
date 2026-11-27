/**
 * markdown 源码 → **白名单虚拟节点树** —— 零 DOM、零 React、纯函数。
 *
 * ## 为什么用正规库（用户原话）
 *
 * 用户 `2026-11-10`：「你他妈的直接出去拉个js包啊……找正规的md渲染器啊」
 *
 * ⇒ 解析交给 `marked`（CommonMark + GFM：表格、任务列表、删除线、自动链接…），
 *   本文件只负责**安全**和**建树**。手写解析器那条路已经走错了，别再回去。
 *
 * ## 安全模型（照旧版 `taskboard2/.../lib/markdown.js` 的四层，但更彻底）
 *
 * | 旧版 | 本文件 |
 * |---|---|
 * | 1. 绝不 `innerHTML` | **连 HTML 字符串都不产生** —— 不 `marked.parse()`、不 `DOMParser` |
 * | 2. `DOMParser` 惰性文档解析 | 直接读 `marked.lexer()` 的 **token 流**（结构化，不是字符串） |
 * | 3. 白名单重建节点（`createElement`/`textContent`）| 白名单建树（`MdElement` / `MdText`，只从 token 里取值） |
 * | 4. 拆标签留文字 / 危险元素整棵丢弃 / 链接白名单 | 同一套判决，见下 |
 *
 * ⚠ **旧版第 2 层是「把字符串重新解析成 DOM」，本文件把它删掉了** ——
 *   不是省略，是**升级**：token 流本身就是结构化的，不需要先序列化成 HTML 再解析回来。
 *   这样「HTML 字符串」这个中间态根本不存在，`innerHTML` / `DOMParser` 都没有可乘之机。
 *
 * 判决规则（与旧版逐条对齐）：
 *
 * - 白名单外的标签：**拆标签留文字**（`<b>x</b>` ⇒ 文本 `x`；
 *   `b` 不在白名单，因为它不是语义标签 —— 强调用 `strong`/`em`）。
 * - `script` / `style` / `iframe` / `img` / `input` **整棵丢弃**（连内部文字都不留）。
 *   另外把 `object`/`embed`/`svg`/`math`/`template`/`noscript`/`textarea`/`select`/
 *   `video`/`audio`/`canvas`/`form` 等**同样处理** —— 理由见 `DROP_SUBTREE`。
 * - 链接只放行 `http(s)://` / `mailto:` / **站内**相对路径（`/x`）。
 *   `javascript:` / `data:` / `#hash` / `//evil.com` 一律拆掉标签、只留文字。
 *   放行的链接统一 `target=_blank rel=noopener noreferrer`。
 * - 属性只放行 `class`（字符集受限）/ `align`（left|center|right）/ `a` 的 `href`。
 *   **任何 `on*` 属性都不可能进入产物** —— 属性表是白名单，不是黑名单。
 *
 * ## 输出结构（CSS 与 E2E 依赖这些类名，别改）
 *
 * - 代码块 → `pre.md-code[data-lang]` > `code.md-code__body`
 * - 表格 → `table.md-table`
 * - 任务项 → `li.md-task`（完成时 `md-task is-done`）+ `span.md-task__box`（☐/☑）
 *
 * ## 分两层的原因
 *
 * 本文件是**可单测的那层**（`node --test` 直接跑，不需要浏览器）。
 * `dev/components/Markdown.tsx` 只做 `MdNode → ReactNode` 的机械映射，薄到不需要单测。
 */

import { marked } from 'marked';
import type { Token, Tokens } from 'marked';

/* ══════════════════════════════════════════════════════════
   节点类型
   ══════════════════════════════════════════════════════════ */

/** 白名单标签 —— **唯一允许出现在产物里的标签集合**。 */
export const MD_TAGS = [
	'p',
	'br',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'ul',
	'ol',
	'li',
	'strong',
	'em',
	'del',
	'code',
	'pre',
	'blockquote',
	'hr',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'a',
	'span',
] as const;

/** 白名单标签之一。 */
export type MdTag = (typeof MD_TAGS)[number];

/** 允许出现在产物里的**属性名**（白名单，不是黑名单）。 */
export const MD_PROP_KEYS = ['class', 'align', 'href', 'target', 'rel', 'data-lang'] as const;

/** 属性名之一。 */
export type MdPropKey = (typeof MD_PROP_KEYS)[number];

/** 节点属性（只可能有上面那几个键）。 */
export type MdProps = Readonly<Partial<Record<MdPropKey, string>>>;

/** 纯文本节点。 */
export interface MdText {
	readonly kind: 'text';
	readonly value: string;
}

/** 元素节点。 */
export interface MdElement {
	readonly kind: 'element';
	readonly tag: MdTag;
	readonly props: MdProps;
	readonly children: readonly MdNode[];
}

/** 产物节点。 */
export type MdNode = MdText | MdElement;

/** 建树期的可变元素（对外只暴露 `readonly` 视图）。 */
interface DraftElement {
	kind: 'element';
	tag: MdTag;
	props: Record<string, string>;
	children: MdNode[];
}

/* ══════════════════════════════════════════════════════════
   白名单 / 丢弃表
   ══════════════════════════════════════════════════════════ */

const WHITELIST: ReadonlySet<string> = new Set<string>(MD_TAGS);

/** 空元素（没有闭合标签，不压栈）。 */
const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr']);

/**
 * **整棵丢弃**的容器标签 —— 连同内部文字一起丢。
 *
 * 旧版只列了 `script/style/iframe/img/input`。这里扩了一档，理由分三类：
 *
 * | 类 | 标签 | 理由 |
 * |---|---|---|
 * | 能执行 / 能加载 | `script` `iframe` `object` `embed` `applet` `frame` `frameset` | 旧版已列前两个；后几个同类 |
 * | 会静默吞掉后续内容 | `textarea` `select` `title` `xmp` `plaintext` `noembed` `noframes` `noscript` | 内容按原始文本处理，拆标签会把源码当正文露出来 |
 * | 自带脚本上下文 | `svg` `math` `template` `canvas` `video` `audio` `form` | 拆标签留文字没意义，整棵丢弃更干净 |
 *
 * ⚠ **这一档不是安全下限，是「别把垃圾露出来」**：产物全靠白名单建树，
 *   就算不丢、拆成文字也不会执行。别把它当唯一防线。
 */
const DROP_SUBTREE: ReadonlySet<string> = new Set([
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'applet',
	'frame',
	'frameset',
	'textarea',
	'select',
	'title',
	'xmp',
	'plaintext',
	'noembed',
	'noframes',
	'noscript',
	'svg',
	'math',
	'template',
	'canvas',
	'video',
	'audio',
	'form',
]);

/** 空元素里**直接丢弃**的（旧版 `img` / `input` 就属于这一档）。 */
const DROP_VOID: ReadonlySet<string> = new Set(['img', 'input', 'link', 'meta', 'base', 'param', 'source', 'track']);

/**
 * 链接白名单。
 *
 * ⚠ `//evil.com`（协议相对）**不放行** —— 旧版正则 `/^(...|\/)/` 会放它过去，
 *   但那是「外站」不是「站内相对路径」。用户说的是站内。
 */
const SAFE_URL = /^(?:https?:\/\/|mailto:|\/)/i;

/* ══════════════════════════════════════════════════════════
   实体解码
   ══════════════════════════════════════════════════════════ */

/**
 * 常用命名实体表。
 *
 * ## 为什么需要它
 *
 * `marked` 的 token 里 `text` 保留**源码形态**的实体（`a &amp; b`），
 * 而旧版走 `DOMParser` 时浏览器会把实体解成字符。要行为一致就得自己解。
 *
 * ## 为什么不是完整的 2231 条表
 *
 * 卡片正文里出现的实体 99% 是 `&amp; &lt; &gt; &quot; &nbsp;` 这几个。
 * 完整表要 ~40KB 源码、对 bundle 不划算，而**未知实体原样保留**（浏览器对未知实体
 * 也是原样显示），所以漏掉的后果只是「显示成 `&hellip;`」而不是「显示错」。
 *
 * 数字实体（`&#65;` / `&#x41;`）**全支持**。
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00a0',
	iexcl: '¡',
	cent: '¢',
	pound: '£',
	curren: '¤',
	yen: '¥',
	brvbar: '¦',
	sect: '§',
	uml: '¨',
	copy: '©',
	ordf: 'ª',
	laquo: '«',
	not: '¬',
	shy: '\u00ad',
	reg: '®',
	macr: '¯',
	deg: '°',
	plusmn: '±',
	sup2: '²',
	sup3: '³',
	acute: '´',
	micro: 'µ',
	para: '¶',
	middot: '·',
	cedil: '¸',
	sup1: '¹',
	ordm: 'º',
	raquo: '»',
	frac14: '¼',
	frac12: '½',
	frac34: '¾',
	iquest: '¿',
	times: '×',
	divide: '÷',
	hellip: '…',
	ndash: '–',
	mdash: '—',
	lsquo: '\u2018',
	rsquo: '\u2019',
	sbquo: '‚',
	ldquo: '\u201c',
	rdquo: '\u201d',
	bdquo: '„',
	dagger: '†',
	Dagger: '‡',
	bull: '•',
	permil: '‰',
	prime: '′',
	Prime: '″',
	larr: '←',
	uarr: '↑',
	rarr: '→',
	darr: '↓',
	harr: '↔',
	lArr: '⇐',
	uArr: '⇑',
	rArr: '⇒',
	dArr: '⇓',
	hArr: '⇔',
	forall: '∀',
	part: '∂',
	exist: '∃',
	empty: '∅',
	nabla: '∇',
	isin: '∈',
	notin: '∉',
	ni: '∋',
	prod: '∏',
	sum: '∑',
	minus: '−',
	lowast: '∗',
	radic: '√',
	prop: '∝',
	infin: '∞',
	ang: '∠',
	and: '∧',
	or: '∨',
	cap: '∩',
	cup: '∪',
	int: '∫',
	there4: '∴',
	sim: '∼',
	cong: '≅',
	asymp: '≈',
	ne: '≠',
	equiv: '≡',
	le: '≤',
	ge: '≥',
	sub: '⊂',
	sup: '⊃',
	nsub: '⊄',
	sube: '⊆',
	supe: '⊇',
	oplus: '⊕',
	otimes: '⊗',
	perp: '⊥',
	sdot: '⋅',
	lceil: '⌈',
	rceil: '⌉',
	lfloor: '⌊',
	rfloor: '⌋',
	loz: '◊',
	spades: '♠',
	clubs: '♣',
	hearts: '♥',
	diams: '♦',
	alpha: 'α',
	beta: 'β',
	gamma: 'γ',
	delta: 'δ',
	epsilon: 'ε',
	zeta: 'ζ',
	eta: 'η',
	theta: 'θ',
	iota: 'ι',
	kappa: 'κ',
	lambda: 'λ',
	mu: 'μ',
	nu: 'ν',
	xi: 'ξ',
	omicron: 'ο',
	pi: 'π',
	rho: 'ρ',
	sigmaf: 'ς',
	sigma: 'σ',
	tau: 'τ',
	upsilon: 'υ',
	phi: 'φ',
	chi: 'χ',
	psi: 'ψ',
	omega: 'ω',
	Alpha: 'Α',
	Beta: 'Β',
	Gamma: 'Γ',
	Delta: 'Δ',
	Theta: 'Θ',
	Lambda: 'Λ',
	Pi: 'Π',
	Sigma: 'Σ',
	Phi: 'Φ',
	Psi: 'Ψ',
	Omega: 'Ω',
	ensp: '\u2002',
	emsp: '\u2003',
	thinsp: '\u2009',
	zwnj: '\u200c',
	zwj: '\u200d',
	lrm: '\u200e',
	rlm: '\u200f',
	euro: '€',
	trade: '™',
};

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;

/**
 * 解 HTML 实体（数字全支持，命名查表，未知原样保留）。
 *
 * @param value 可能含实体的字符串
 */
export function decodeEntities(value: string): string {
	if (!value.includes('&')) return value;

	return value.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
		if (name !== undefined) return NAMED_ENTITIES[name] ?? whole;

		const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16);
		if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD';
		if (code === 38) return '&';
		return String.fromCodePoint(code);
	});
}

/* ══════════════════════════════════════════════════════════
   小工具
   ══════════════════════════════════════════════════════════ */

/** 建一个可变元素。 */
function draft(tag: MdTag): DraftElement {
	return { kind: 'element', tag, props: {}, children: [] };
}

/** 追加文本（空串不建节点 —— 旧版 `appendSanitized` 同样跳过空文本）。 */
function pushText(out: MdNode[], value: string): void {
	if (value === '') return;
	out.push({ kind: 'text', value });
}

/** 取 token 的子 token（没有就返回 `null`）。 */
function subTokens(token: Token): readonly Token[] | null {
	const value = (token as { tokens?: unknown }).tokens;
	return Array.isArray(value) ? (value as Token[]) : null;
}

/** 令牌是不是「块级」（决定走 `renderBlocks` 还是攒成一段行内流）。 */
function isBlockToken(token: Token): boolean {
	if (token.type === 'html') return (token as Tokens.HTML).block === true;
	return BLOCK_TYPES.has(token.type);
}

const BLOCK_TYPES: ReadonlySet<string> = new Set([
	'heading',
	'paragraph',
	'blockquote',
	'list',
	'list_item',
	'code',
	'table',
	'hr',
	'space',
	'def',
]);

/* ══════════════════════════════════════════════════════════
   净化上下文
   ══════════════════════════════════════════════════════════ */

/**
 * 跨 token 的丢弃状态。
 *
 * `<script>` 可能在一个块里开始、好几个块之后才闭合（marked 对跨行原始 HTML
 * 不保证只给一个 token），所以「丢弃中」必须是**整棵树共享的状态**，
 * 不能是某个函数的局部变量。
 */
interface Ctx {
	dropTag: string | null;
	dropDepth: number;
}

/* ══════════════════════════════════════════════════════════
   原始 HTML 标签的处理
   ══════════════════════════════════════════════════════════ */

const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const CLASS_OK = /^[A-Za-z0-9_\- ]{1,200}$/;
const ALIGNS: ReadonlySet<string> = new Set(['left', 'center', 'right']);

/** 从属性串里取一个属性的值（没有就是 `null`）。 */
function attrValue(source: string, wanted: string): string | null {
	ATTR.lastIndex = 0;
	let match: RegExpExecArray | null = ATTR.exec(source);
	while (match !== null) {
		if ((match[1] ?? '').toLowerCase() === wanted) {
			const [, , double, single, bare] = match;
			return double ?? single ?? bare ?? '';
		}
		match = ATTR.exec(source);
	}
	return null;
}

/** 链接是否放行（先解实体、再去掉控制字符与空白，最后比对白名单前缀）。 */
export function isSafeHref(raw: string): boolean {
	const href = decodeEntities(raw).replace(/[\u0000-\u001f\u007f\s]/g, '');
	if (href === '') return false;
	/* 协议相对 `//host` 是外站，不是站内相对路径。 */
	if (href.startsWith('//')) return false;
	return SAFE_URL.test(href);
}

/**
 * 建一个 `<a>` 草稿 —— `handleTag` 的 `a` 分支与 `renderInline` 的 `link` case
 * **殊途同归**（都建同三个属性的链接元素）⇒ 收敛为一个 helper（逻辑级化简）。
 *
 * ⚠ 只收敛「形状」：href 解码 + `target=_blank` + `rel=noopener noreferrer`。
 *   **不安全 href 的裁决留在两处原地**（一处整体丢弃、一处拆标签留文字）——
 *   那是语义差异，调用方各自先 `isSafeHref` 再来。
 */
function draftLink(rawHref: string): DraftElement {
	const link = draft('a');
	link.props.href = decodeEntities(rawHref);
	link.props.target = '_blank';
	link.props.rel = 'noopener noreferrer';
	return link;
}

/** 追一个标签的当前挂载点：栈顶元素的 children，栈空就是根数组。 */
function targetOf(stack: DraftElement[], base: MdNode[]): MdNode[] {
	const top = stack.at(-1);
	return top === undefined ? base : top.children;
}

/** 处理一段原始 HTML 里的文字（丢弃中就不留）。 */
function appendHtmlText(text: string, ctx: Ctx, stack: DraftElement[], base: MdNode[]): void {
	if (ctx.dropTag !== null || text === '') return;
	pushText(targetOf(stack, base), decodeEntities(text));
}

/** 闭合标签：从栈顶往下找同名标签，找到就把栈截断到它。 */
function closeTag(stack: DraftElement[], name: string): void {
	for (let index = stack.length - 1; index >= 0; index -= 1) {
		if (stack[index]?.tag === name) {
			stack.length = index;
			return;
		}
	}
}

/**
 * 处理一个原始 HTML 标签。
 *
 * @param raw 形如 `<b>` / `</b>` / `<img src=x>` 的片段
 */
function handleTag(raw: string, ctx: Ctx, stack: DraftElement[], base: MdNode[]): void {
	/* 注释、doctype、CDATA、处理指令：直接丢（不留文字，旧版 DOM 里也不是文本）。 */
	if (raw.startsWith('<!--') || /^<[!?]/.test(raw)) return;

	const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/?)>$/.exec(raw);
	if (match === null) {
		/* 长得不像标签（比如 `< 3`）⇒ 当普通文字。 */
		appendHtmlText(raw, ctx, stack, base);
		return;
	}

	const closing = match[1] === '/';
	const name = (match[2] ?? '').toLowerCase();
	const attrs = match[3] ?? '';
	const selfClosing = match[4] === '/';

	/* 丢弃中：只关心同名开闭标签的配对。 */
	if (ctx.dropTag !== null) {
		if (name !== ctx.dropTag) return;
		if (closing) ctx.dropDepth -= 1;
		else if (!selfClosing) ctx.dropDepth += 1;
		if (ctx.dropDepth <= 0) {
			ctx.dropTag = null;
			ctx.dropDepth = 0;
		}
		return;
	}

	if (!closing && !selfClosing && DROP_SUBTREE.has(name)) {
		ctx.dropTag = name;
		ctx.dropDepth = 1;
		return;
	}
	if (closing) {
		closeTag(stack, name);
		return;
	}
	if (DROP_VOID.has(name)) return;

	/* `a` 单独判：href 不合法时**拆标签**（不留一个没有 href 的空壳）。 */
	if (name === 'a') {
		const rawHref = attrValue(attrs, 'href');
		if (rawHref === null || !isSafeHref(rawHref)) return;
		const link = draftLink(rawHref);
		targetOf(stack, base).push(link);
		if (!selfClosing) stack.push(link);
		return;
	}

	if (!WHITELIST.has(name)) return; /* 白名单外：拆标签、留内容。 */

	const element = draft(name as MdTag);
	if (VOID_TAGS.has(name)) {
		targetOf(stack, base).push(element);
		return;
	}

	const className = attrValue(attrs, 'class');
	if (className !== null && CLASS_OK.test(className)) element.props.class = className;

	const align = attrValue(attrs, 'align');
	if (align !== null && ALIGNS.has(align.toLowerCase())) element.props.align = align.toLowerCase();

	targetOf(stack, base).push(element);
	if (!selfClosing) stack.push(element);
}

/**
 * 把一段原始 HTML 片段喂进树里。
 *
 * @param fragment 原始 HTML（marked 的 `html` token 的 `text`）
 * @param stack 标签栈（块级用「跨块的开放元素栈」，行内用本次序列的局部栈）
 * @param base 栈空时的挂载点
 */
function feedHtml(fragment: string, ctx: Ctx, stack: DraftElement[], base: MdNode[]): void {
	let cursor = 0;
	while (cursor < fragment.length) {
		const open = fragment.indexOf('<', cursor);
		if (open === -1) {
			appendHtmlText(fragment.slice(cursor), ctx, stack, base);
			return;
		}
		if (open > cursor) appendHtmlText(fragment.slice(cursor, open), ctx, stack, base);

		const close = fragment.indexOf('>', open);
		if (close === -1) {
			appendHtmlText(fragment.slice(open), ctx, stack, base);
			return;
		}
		handleTag(fragment.slice(open, close + 1), ctx, stack, base);
		cursor = close + 1;
	}
}

/* ══════════════════════════════════════════════════════════
   行内渲染
   ══════════════════════════════════════════════════════════ */

/**
 * 行内 token → 节点，追加到 `out`。
 *
 * 上下文（`marked` 的结构化 token）用**递归**表达嵌套；
 * 原始 HTML 的 `<b>`…`</b>` 是**扁平 token**，只能靠 `stack` 跨 token 配对。
 */
function renderInline(tokens: readonly Token[], out: MdNode[], ctx: Ctx): void {
	const stack: DraftElement[] = [];
	const target = (): MdNode[] => targetOf(stack, out);

	for (const token of tokens) {
		/*
		 * 丢弃中：只有 `html` token 还能进来（可能是闭合标签），
		 * 其它 token 一律跳过 —— 否则 `<script>alert(1)</script>` 里的
		 * `alert(1)` 会作为**独立 text token** 从旁边漏出去。
		 */
		if (ctx.dropTag !== null && token.type !== 'html') continue;

		switch (token.type) {
			case 'text': {
				pushText(target(), decodeEntities((token as Tokens.Text).text));
				break;
			}
			case 'escape': {
				/* `\*` 里的 `*` 是字面量，不再解实体。 */
				pushText(target(), (token as Tokens.Escape).text);
				break;
			}
			case 'codespan': {
				const code = draft('code');
				pushText(code.children, (token as Tokens.Codespan).text);
				target().push(code);
				break;
			}
			case 'br': {
				target().push(draft('br'));
				break;
			}
			case 'strong':
			case 'em':
			case 'del': {
				const element = draft(token.type);
				target().push(element);
				renderInline(subTokens(token) ?? [], element.children, ctx);
				break;
			}
			case 'link': {
				const link = token as Tokens.Link;
				const children: MdNode[] = [];
				renderInline(subTokens(token) ?? [], children, ctx);
				if (!isSafeHref(link.href)) {
					/* 不安全：拆标签，只留文字（旧版同款）。 */
					for (const child of children) target().push(child);
					break;
				}
				const element = draftLink(link.href);
				element.children.push(...children);
				target().push(element);
				break;
			}
			case 'image': {
				/* 旧版把 `img` 整棵丢弃 ⇒ `![alt](src)` 连 alt 都不显示。保持。 */
				break;
			}
			case 'html': {
				feedHtml((token as Tokens.HTML).text, ctx, stack, out);
				break;
			}
			case 'checkbox': {
				/* 任务项复选框由 `li.md-task` 的 `span.md-task__box` 表达。 */
				break;
			}
			default: {
				const nested = subTokens(token);
				if (nested !== null) renderInline(nested, target(), ctx);
				break;
			}
		}
	}
}

/* ══════════════════════════════════════════════════════════
   块级渲染
   ══════════════════════════════════════════════════════════ */

/** 标题深度夹到 1..6（marked 只给 1..6，这里仍夹一次，防脏数据）。 */
function headingTag(depth: number): MdTag {
	const level = Number.isFinite(depth) ? Math.min(6, Math.max(1, Math.trunc(depth))) : 1;
	return `h${level}` as MdTag;
}

/** 代码块语言名：只留 `[\w+#.-]`，超长/带引号的一律不带 `data-lang`。 */
function safeLang(lang: string | undefined): string | null {
	if (lang === undefined) return null;
	const value = lang.trim();
	return /^[\w+#.-]{1,32}$/.test(value) ? value : null;
}

/** 渲染一个列表项。 */
function renderListItem(item: Tokens.ListItem, ctx: Ctx, out: MdNode[]): void {
	const element = draft('li');
	if (item.task) {
		element.props.class = item.checked === true ? 'md-task is-done' : 'md-task';
		const box = draft('span');
		box.props.class = 'md-task__box';
		pushText(box.children, item.checked === true ? '☑' : '☐');
		element.children.push(box);
	}
	renderBlocks(item.tokens, element.children, ctx);
	out.push(element);
}

/** 渲染一个块级 token。 */
function renderBlockToken(token: Token, out: MdNode[], ctx: Ctx): void {
	/*
	 * 丢弃中：只有 html token 还可能闭合它。
	 * 不设这个判断的话，`<svg>` 后面如果跟着一个**块级** token（列表/表格），
	 * 那个块会照常渲染出来 —— 等于「丢弃」只丢了半边。
	 */
	if (ctx.dropTag !== null && token.type !== 'html') return;

	switch (token.type) {
		case 'space':
		case 'def': {
			/* 空白与链接定义不产生节点（旧版 DOM 里也没有）。 */
			break;
		}
		case 'heading': {
			const one = token as Tokens.Heading;
			const element = draft(headingTag(one.depth));
			renderInline(one.tokens, element.children, ctx);
			/*
			 * 净化后可能一个子节点都不剩（比如标题里只有一个 `<img>`）。
			 * 空的 `h1` 会占一行高、看着像渲染坏了 ⇒ 不留空壳。
			 */
			if (element.children.length > 0) out.push(element);
			break;
		}
		case 'paragraph': {
			const element = draft('p');
			renderInline(subTokens(token) ?? [], element.children, ctx);
			/* 同上：整段都被净化掉时不留空 `<p>`。 */
			if (element.children.length > 0) out.push(element);
			break;
		}
		case 'blockquote': {
			const element = draft('blockquote');
			renderBlocks(subTokens(token) ?? [], element.children, ctx);
			out.push(element);
			break;
		}
		case 'list': {
			const one = token as Tokens.List;
			const element = draft(one.ordered ? 'ol' : 'ul');
			for (const item of one.items) renderListItem(item, ctx, element.children);
			out.push(element);
			break;
		}
		case 'list_item': {
			/* 理论上走不到（列表项由 `list` 处理）；兜底成一个 `li`。 */
			renderListItem(token as Tokens.ListItem, ctx, out);
			break;
		}
		case 'code': {
			const one = token as Tokens.Code;
			const pre = draft('pre');
			pre.props.class = 'md-code';
			const lang = safeLang(one.lang);
			if (lang !== null) pre.props['data-lang'] = lang;
			const code = draft('code');
			code.props.class = 'md-code__body';
			pushText(code.children, one.text);
			pre.children.push(code);
			out.push(pre);
			break;
		}
		case 'table': {
			const one = token as Tokens.Table;
			const table = draft('table');
			table.props.class = 'md-table';

			const thead = draft('thead');
			const headRow = draft('tr');
			for (const cell of one.header) {
				const th = draft('th');
				if (cell.align !== null) th.props.align = cell.align;
				renderInline(cell.tokens, th.children, ctx);
				headRow.children.push(th);
			}
			thead.children.push(headRow);
			table.children.push(thead);

			const tbody = draft('tbody');
			for (const row of one.rows) {
				const tr = draft('tr');
				for (const cell of row) {
					const td = draft('td');
					if (cell.align !== null) td.props.align = cell.align;
					renderInline(cell.tokens, td.children, ctx);
					tr.children.push(td);
				}
				tbody.children.push(tr);
			}
			table.children.push(tbody);
			out.push(table);
			break;
		}
		case 'hr': {
			out.push(draft('hr'));
			break;
		}
		case 'html': {
			feedHtml((token as Tokens.HTML).text, ctx, BLOCK_STACK.get(out) ?? [], out);
			break;
		}
		default: {
			const nested = subTokens(token);
			if (nested !== null) renderInline(nested, out, ctx);
			break;
		}
	}
}

/**
 * 块级渲染用的「跨块开放标签栈」。
 *
 * 原始 HTML 可以是 `<blockquote>`（块 A）→ 若干块 → `</blockquote>`（块 C）。
 * 要让中间的块**嵌进去**，开放栈必须活得比单个 token 长。
 * 用 `WeakMap` 挂在「当前挂载数组」上，这样嵌套的 `renderBlocks`
 * （列表项、引用块）各有各的栈，天然隔离。
 */
const BLOCK_STACK = new WeakMap<MdNode[], DraftElement[]>();

/**
 * token 序列 → 节点，追加到 `out`。
 *
 * 连续的**行内** token 攒成一段一起渲染（否则 `<b>` 开标签和后面的文字会被拆散）。
 */
function renderBlocks(tokens: readonly Token[], out: MdNode[], ctx: Ctx): void {
	const stack: DraftElement[] = [];
	BLOCK_STACK.set(out, stack);

	const target = (): MdNode[] => targetOf(stack, out);
	let run: Token[] = [];
	const flush = (): void => {
		if (run.length === 0) return;
		const batch = run;
		run = [];
		renderInline(batch, target(), ctx);
	};

	for (const token of tokens) {
		if (!isBlockToken(token)) {
			run.push(token);
			continue;
		}
		flush();
		renderBlockToken(token, target(), ctx);
	}
	flush();
}

/* ══════════════════════════════════════════════════════════
   入口
   ══════════════════════════════════════════════════════════ */

/**
 * markdown 源码 → 白名单虚拟节点树。
 *
 * @param source markdown 源码
 * @returns 顶层块节点（组件再套 `.md` 容器）
 *
 * @example
 * renderMarkdownNodes('**粗** `码`')
 * // ⇒ [ { kind:'element', tag:'p', props:{}, children:[
 * //        { kind:'element', tag:'strong', props:{}, children:[{kind:'text',value:'粗'}] },
 * //        { kind:'text', value:' ' },
 * //        { kind:'element', tag:'code', props:{}, children:[{kind:'text',value:'码'}] } ] } ]
 */
export function renderMarkdownNodes(source: string): MdNode[] {
	const out: MdNode[] = [];
	if (typeof source !== 'string' || source.trim() === '') return out;

	let tokens: readonly Token[];
	try {
		/*
		 * `breaks: true` = **GFM / GitHub 的默认**：单换行就是换行（`<br>`）。
		 * 严格 CommonMark（`false`）会把单换行折成一个空格并进同一段 ——
		 * 那是用户可见的行为退步，旧版手写解析器也是「回车 = 换行」。别改回 `false`。
		 * （`gfm: true` 也是 marked 的默认，显式写出来是钉住表格 / 任务列表 / 删除线。）
		 */
		tokens = marked.lexer(source, { gfm: true, breaks: true });
	} catch {
		/*
		 * marked 理论上只在「解析器死循环」这种病态输入上抛。
		 * 抛了也不能让整张卡渲染不出来 ⇒ 回落成一段纯文本（`textContent`，
		 * 绝不 `innerHTML`）。
		 */
		const paragraph = draft('p');
		pushText(paragraph.children, source);
		return [paragraph];
	}

	renderBlocks(tokens, out, { dropTag: null, dropDepth: 0 });
	return out;
}
