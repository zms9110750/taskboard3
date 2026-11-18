/**
 * `pure/section.ts` 的测试 —— 纯函数，零 DOM、零 React。
 *
 * ## 夹具从哪来
 *
 * 不是编的：`text` / `markdown` / `ask` 三种 payload 的样例逐字抄自
 * `packages/core/templates/*.yaml`（`architecture.yaml` / `archive.yaml` /
 * `expectedMismatch.yaml` / `question.yaml`），形状由
 * `core/template/actions.ts` 的 zod schema 保证。
 *
 * ⚠ 另外**必须**测脏数据：core 的 `validate()` 第 ④ 步把模板 `default`
 *   **不校验**就塞进卡（`template/schema.ts` 的 `defaultsOf`）⇒ 第三方模板能给
 *   任意 payload。卡是 JSON，TypeScript 不校验运行时数据。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	NO_ANSWER,
	askSectionOf,
	askStateLabelOf,
	canEditOf,
	emptyHintOf,
	jsonPreviewOf,
	markdownLinesOf,
	payloadKindOf,
	payloadTypeOf,
	sectionLabelOf,
	sectionViewOf,
} from '../src/pure/section.ts';
import { extractText } from '../src/pure.ts';

/* ══════════════════════════════════════════════════════════
   真实 payload 夹具（抄自 packages/core/templates/*.yaml）
   ══════════════════════════════════════════════════════════ */

/** `architecture.yaml` 的「选择什么架构」—— 草稿态：只有 $type + placeholder。 */
const TEXT_EMPTY = { $type: 'text', placeholder: '选什么架构，为什么' } as const;

/** 同一章的填写态。 */
const TEXT_FILLED = {
	$type: 'text',
	value: '服务器 + 客户端，消息走异步流。',
	placeholder: '选什么架构，为什么',
} as const;

/** `archive.yaml` 的「留档内容」。 */
const MARKDOWN_EMPTY = { $type: 'markdown', placeholder: '把要保留的资料放在这里' } as const;

const MARKDOWN_FILLED = {
	$type: 'markdown',
	value: '第一行\n\n**粗体** 和 `代码`\n未闭合 ** 与 ` 保持字面',
	placeholder: '把要保留的资料放在这里',
} as const;

/**
 * `expectedMismatch.yaml` 的「为什么这么想」—— **真实 ask**，6 个选项。
 * 这是 v3 的形状：`items[]` 包着 `options[]`，不是旧版的 `title + case`。
 */
const ASK_REAL = {
	$type: 'ask',
	items: [
		{
			question: '这个预期的依据',
			multi_select: false,
			options: [
				{ label: '望文生义', description: '从语义说，这个东西在这里长这样就应该这样做才有道理' },
				{ label: '同类产品', description: '具有类似功能的项目实现，具有这样的行为' },
				{ label: '附随文档', description: '这个项目自己表示会这样说，包括更新说明和readme' },
				{ label: '社区传阅', description: '有wiki，或视频平台，论坛，有记录的表明很多人这样认为' },
				{ label: '历史惯性', description: '曾经是这样的行为，更新没说会变，但变了' },
				{ label: '官方暗示', description: '开发者访谈，笔记，博客。或是维护者在社区宣称，支持，某个功能在现版本发布' },
			],
		},
	],
} as const;

/** `question.yaml` 的「需要回答的问题」—— 真实 ask，**选项为空**。 */
const ASK_NO_OPTIONS = {
	$type: 'ask',
	items: [{ header: '要问的问题', options: [] }],
} as const;

/** `optimize.yaml` 的「优化类型」—— 单选，带选项但没有 description。 */
const ASK_SINGLE_CHOICE = {
	$type: 'ask',
	items: [
		{
			question: '优化类型',
			multi_select: false,
			options: [
				{ label: '性能优化' },
				{ label: '语义优化' },
				{ label: '可读性优化' },
				{ label: '接口界面优化' },
				{ label: '扩展性优化' },
				{ label: '一致性优化' },
			],
		},
	],
} as const;

/* ══════════════════════════════════════════════════════════
   payloadTypeOf / payloadKindOf
   ══════════════════════════════════════════════════════════ */

describe('payloadTypeOf —— 取 $type', () => {
	it('三种真实 action 各取到自己的 $type', () => {
		assert.equal(payloadTypeOf(TEXT_EMPTY), 'text');
		assert.equal(payloadTypeOf(MARKDOWN_EMPTY), 'markdown');
		assert.equal(payloadTypeOf(ASK_REAL), 'ask');
	});

	it('$type 不是字符串 ⇒ 空串（不 String() 强转）', () => {
		assert.equal(payloadTypeOf({ $type: 42 }), '');
		assert.equal(payloadTypeOf({ $type: null }), '');
		assert.equal(payloadTypeOf({}), '');
	});

	it('非对象 ⇒ 空串', () => {
		for (const one of [null, undefined, 42, true, 'text', [1, 2]]) {
			assert.equal(payloadTypeOf(one), '', String(one));
		}
	});
});

describe('payloadKindOf —— 决定用哪个渲染器', () => {
	it('三个真实 action 各自命中', () => {
		assert.equal(payloadKindOf(TEXT_FILLED), 'text');
		assert.equal(payloadKindOf(MARKDOWN_FILLED), 'markdown');
		assert.equal(payloadKindOf(ASK_REAL), 'ask');
		assert.equal(payloadKindOf(ASK_NO_OPTIONS), 'ask');
	});

	it('⚠ 未知 $type ⇒ unknown（不猜成 text）', () => {
		/* 第三方 action 的 UI 没接；硬画成文本会让「未注册」这个事实看不见。 */
		assert.equal(payloadKindOf({ $type: 'table', rows: [] }), 'unknown');
		assert.equal(payloadKindOf({ $type: 'chart' }), 'unknown');
	});

	it('没有 $type 但有字符串 value ⇒ text（旧数据兼容）', () => {
		assert.equal(payloadKindOf({ value: '一段话' }), 'text');
	});

	it('payload 本身就是字符串 ⇒ text', () => {
		assert.equal(payloadKindOf('直接是字符串'), 'text');
		assert.equal(payloadKindOf(''), 'text');
	});

	it('⚠ 脏数据一律 unknown，不抛', () => {
		for (const one of [null, undefined, 42, true, [], [1, 2, 3], {}, { value: 42 }]) {
			assert.equal(payloadKindOf(one), 'unknown', JSON.stringify(one));
		}
	});
});

/* ══════════════════════════════════════════════════════════
   text
   ══════════════════════════════════════════════════════════ */

describe('sectionViewOf —— text', () => {
	it('草稿态（只有 placeholder）⇒ empty = true，placeholder 带出来', () => {
		const view = sectionViewOf(TEXT_EMPTY);
		assert.equal(view.kind, 'text');
		assert.deepEqual(view, {
			kind: 'text',
			value: '',
			placeholder: '选什么架构，为什么',
			empty: true,
		});
	});

	it('填写态 ⇒ value 原样，empty = false', () => {
		const view = sectionViewOf(TEXT_FILLED);
		assert.equal(view.kind, 'text');
		if (view.kind !== 'text') return;
		assert.equal(view.value, '服务器 + 客户端，消息走异步流。');
		assert.equal(view.empty, false);
	});

	it('⚠ 复用 extractText —— text 的 { value } 与它一致', () => {
		const payload = { $type: 'text', value: '去查 X 怎么实现' };
		assert.equal(extractText(payload), '去查 X 怎么实现');
	});

	it('⚠ 只有空白 ⇒ 算空（不画一行看不见的空格）', () => {
		const view = sectionViewOf({ $type: 'text', value: '   \n\t' });
		assert.equal(view.kind === 'text' && view.empty, true);
	});
});

/* ══════════════════════════════════════════════════════════
   markdown
   ══════════════════════════════════════════════════════════ */

describe('markdownLinesOf —— 临时最小子集', () => {
	it('空源码 / 非字符串 ⇒ 零行', () => {
		assert.deepEqual(markdownLinesOf(''), []);
		assert.deepEqual(markdownLinesOf(undefined), []);
		assert.deepEqual(markdownLinesOf(42), []);
		assert.deepEqual(markdownLinesOf(null), []);
	});

	it('换行切行；空行标 blank', () => {
		const lines = markdownLinesOf('第一行\n\n第三行');
		assert.equal(lines.length, 3);
		assert.deepEqual(
			lines.map((one) => one.blank),
			[false, true, false],
		);
		assert.deepEqual(lines[0]?.tokens, [{ kind: 'text', text: '第一行' }]);
		assert.deepEqual(lines[1]?.tokens, []);
		assert.deepEqual(lines[2]?.tokens, [{ kind: 'text', text: '第三行' }]);
	});

	it('⚠ CRLF / CR 都归一成 LF（Windows 里写的内容也得对）', () => {
		assert.equal(markdownLinesOf('a\r\nb').length, 2);
		assert.equal(markdownLinesOf('a\rb').length, 2);
		assert.deepEqual(markdownLinesOf('a\r\nb')[1]?.tokens, [{ kind: 'text', text: 'b' }]);
	});

	it('**粗体** 切成 strong', () => {
		assert.deepEqual(markdownLinesOf('前 **粗** 后')[0]?.tokens, [
			{ kind: 'text', text: '前 ' },
			{ kind: 'strong', text: '粗' },
			{ kind: 'text', text: ' 后' },
		]);
	});

	it('`代码` 切成 code', () => {
		assert.deepEqual(markdownLinesOf('用 `npm i` 装')[0]?.tokens, [
			{ kind: 'text', text: '用 ' },
			{ kind: 'code', text: 'npm i' },
			{ kind: 'text', text: ' 装' },
		]);
	});

	it('两种标记混在一行，按出现顺序', () => {
		assert.deepEqual(markdownLinesOf('**A** 和 `B`')[0]?.tokens, [
			{ kind: 'strong', text: 'A' },
			{ kind: 'text', text: ' 和 ' },
			{ kind: 'code', text: 'B' },
		]);
	});

	it('⚠ 不闭合的标记保持字面（用户写的 2 * 3 不该变成半截粗体）', () => {
		assert.deepEqual(markdownLinesOf('2 ** 3')[0]?.tokens, [{ kind: 'text', text: '2 ** 3' }]);
		assert.deepEqual(markdownLinesOf('未闭合 ` 反引号')[0]?.tokens, [
			{ kind: 'text', text: '未闭合 ` 反引号' },
		]);
		assert.deepEqual(markdownLinesOf('**')[0]?.tokens, [{ kind: 'text', text: '**' }]);
	});

	it('⚠ 开标记后是空白 ⇒ 不是粗体（`2 ** 3` 这类算式不被切开）', () => {
		/* CDP 验证抓到的真 bug：第一版只找闭合 **，把 `** 和 ` 当成了开标记。 */
		assert.deepEqual(markdownLinesOf('2 ** 3 = 8')[0]?.tokens, [
			{ kind: 'text', text: '2 ** 3 = 8' },
		]);
		assert.deepEqual(markdownLinesOf('** 和 ** 保持字面')[0]?.tokens, [
			{ kind: 'text', text: '** 和 ** 保持字面' },
		]);
	});

	it('⚠ 闭标记前是空白 ⇒ 不是粗体（`**x **` 不吞掉空格）', () => {
		assert.deepEqual(markdownLinesOf('**x **')[0]?.tokens, [{ kind: 'text', text: '**x **' }]);
	});

	it('⚠ 一段里既有真粗体又有字面 ** ⇒ 只切真粗体', () => {
		assert.deepEqual(markdownLinesOf('**真** 和 2 ** 3')[0]?.tokens, [
			{ kind: 'strong', text: '真' },
			{ kind: 'text', text: ' 和 2 ** 3' },
		]);
	});

	it('⚠ 单星号不是标记（只有 ** 是粗体）', () => {
		assert.deepEqual(markdownLinesOf('*不是斜体*')[0]?.tokens, [
			{ kind: 'text', text: '*不是斜体*' },
		]);
	});

	it('⚠ HTML 标签原样当文字 —— 绝不解析', () => {
		const tokens = markdownLinesOf('<img src=x onerror=alert(1)>')[0]?.tokens;
		assert.deepEqual(tokens, [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]);
	});

	it('粗体里的反引号不嵌套（先到先得，不递归）', () => {
		/* 现在是最小实现：** 与 ` 谁先出现谁先切，不处理嵌套。文档里写明。 */
		assert.deepEqual(markdownLinesOf('**a`b`**')[0]?.tokens, [
			{ kind: 'strong', text: 'a`b`' },
		]);
	});
});

describe('sectionViewOf —— markdown', () => {
	it('草稿态（只有 placeholder）⇒ empty = true', () => {
		const view = sectionViewOf(MARKDOWN_EMPTY);
		assert.equal(view.kind, 'markdown');
		assert.deepEqual(view, {
			kind: 'markdown',
			source: '',
			placeholder: '把要保留的资料放在这里',
			empty: true,
			lines: [],
		});
	});

	it('填写态 ⇒ 带 lines', () => {
		const view = sectionViewOf(MARKDOWN_FILLED);
		assert.equal(view.kind, 'markdown');
		if (view.kind !== 'markdown') return;
		assert.equal(view.empty, false);
		assert.equal(view.lines.length, 4);
		assert.deepEqual(view.lines[0]?.tokens, [{ kind: 'text', text: '第一行' }]);
		assert.deepEqual(view.lines[1]?.blank, true);
		assert.deepEqual(view.lines[2]?.tokens, [
			{ kind: 'strong', text: '粗体' },
			{ kind: 'text', text: ' 和 ' },
			{ kind: 'code', text: '代码' },
		]);
	});

	it('⚠ markdown 与 text 的 payload 形状相同，区别只在渲染', () => {
		const asText = sectionViewOf({ $type: 'text', value: '**x**' });
		const asMarkdown = sectionViewOf({ $type: 'markdown', value: '**x**' });
		assert.equal(asText.kind === 'text' && asText.value, '**x**');
		assert.equal(asMarkdown.kind === 'markdown' && asMarkdown.lines[0]?.tokens[0]?.kind, 'strong');
	});
});

/* ══════════════════════════════════════════════════════════
   ask
   ══════════════════════════════════════════════════════════ */

describe('askSectionOf —— 真实 ask（expectedMismatch 的 6 个选项）', () => {
	const view = askSectionOf(ASK_REAL);

	it('一个组、6 个选项，顺序保留', () => {
		assert.equal(view.kind, 'ask');
		assert.equal(view.empty, false);
		assert.equal(view.groups.length, 1);
		const group = view.groups[0];
		assert.equal(group?.question, '这个预期的依据');
		assert.equal(group?.header, '');
		assert.equal(group?.multiSelect, false);
		assert.deepEqual(
			group?.options.map((one) => one.label),
			['望文生义', '同类产品', '附随文档', '社区传阅', '历史惯性', '官方暗示'],
		);
	});

	it('description 带出来；没有就不编', () => {
		assert.equal(view.groups[0]?.options[0]?.description, '从语义说，这个东西在这里长这样就应该这样做才有道理');
	});

	it('⚠ picked 不存在 ⇒ unset（未选择）', () => {
		assert.equal(view.groups[0]?.pickedState, 'unset');
		assert.equal(view.groups[0]?.pickedCount, 0);
		assert.equal(view.groups[0] !== undefined && askStateLabelOf(view.groups[0]), '未选择');
		assert.deepEqual(
			view.groups[0]?.options.map((one) => one.picked),
			[false, false, false, false, false, false],
		);
	});
});

describe('askSectionOf —— picked 三态（core 注释原文的三种）', () => {
	/** 造一个带 picked 的 ask。 */
	const withPicked = (picked: unknown): unknown => ({
		$type: 'ask',
		items: [{ question: 'q', options: [{ label: 'A' }, { label: 'B' }], picked }],
	});

	it('⚠ 不存在 = 未选择', () => {
		const group = askSectionOf(withPicked(undefined)).groups[0];
		assert.equal(group?.pickedState, 'unset');
		assert.equal(group !== undefined && askStateLabelOf(group), '未选择');
	});

	it('⚠ [] = 看了但都不要 —— **与「不存在」是两种回答**', () => {
		const group = askSectionOf(withPicked([])).groups[0];
		assert.equal(group?.pickedState, 'none');
		assert.equal(group?.pickedCount, 0);
		assert.equal(group !== undefined && askStateLabelOf(group), '都不要');
		/* 两种状态必须能区分出来，否则「都不要」会被显示成「未选择」。 */
		assert.notEqual(group?.pickedState, askSectionOf(withPicked(undefined)).groups[0]?.pickedState);
	});

	it('["A"] = 选了 A ⇒ 只有 A 是 picked', () => {
		const group = askSectionOf(withPicked(['A'])).groups[0];
		assert.equal(group?.pickedState, 'picked');
		assert.equal(group?.pickedCount, 1);
		assert.deepEqual(
			group?.options.map((one) => one.picked),
			[true, false],
		);
		assert.equal(group !== undefined && askStateLabelOf(group), '单选·已选 1');
	});

	it('多选标注与单选不同', () => {
		const view = askSectionOf({
			$type: 'ask',
			items: [
				{
					multi_select: true,
					options: [{ label: 'A' }, { label: 'B' }],
					picked: ['A', 'B'],
				},
			],
		});
		const group = view.groups[0];
		assert.equal(group?.multiSelect, true);
		assert.equal(group !== undefined && askStateLabelOf(group), '多选·已答 2');
	});

	it('⚠ picked 里的脏值（非字符串）被丢掉，不炸', () => {
		const group = askSectionOf(withPicked(['A', 42, null, { x: 1 }])).groups[0];
		assert.equal(group?.pickedState, 'picked');
		assert.equal(group?.pickedCount, 1);
		assert.deepEqual(
			group?.options.map((one) => one.picked),
			[true, false],
		);
	});

	it('⚠ picked 里的值不在 options 里 ⇒ 计数仍在，但不点亮任何选项（脏数据看得见）', () => {
		const group = askSectionOf(withPicked(['不存在的选项'])).groups[0];
		assert.equal(group?.pickedCount, 1);
		assert.deepEqual(
			group?.options.map((one) => one.picked),
			[false, false],
		);
	});

	it('⚠ picked 不是数组（脏数据）⇒ unset，不猜成「都不要」', () => {
		for (const bad of ['A', 42, null, {}]) {
			const group = askSectionOf(withPicked(bad)).groups[0];
			assert.equal(group?.pickedState, 'unset', JSON.stringify(bad));
		}
	});
});

describe('askSectionOf —— options 为空必须能画', () => {
	it('question.yaml 的真实默认值：items 1 条、options 空', () => {
		const view = askSectionOf(ASK_NO_OPTIONS);
		assert.equal(view.empty, false);
		assert.equal(view.groups.length, 1);
		const group = view.groups[0];
		assert.equal(group?.header, '要问的问题');
		assert.deepEqual(group?.options, []);
		/* 有 header 就算「有东西可画」—— 不能因为没选项就判空。 */
		assert.equal(group?.empty, false);
	});

	it('⚠ core 的 defaultPayload：items:[{options:[]}] —— 连 header 都没有', () => {
		const view = askSectionOf({ $type: 'ask', items: [{ options: [] }] });
		assert.equal(view.empty, false);
		assert.equal(view.groups.length, 1);
		/* 组本身是空壳，但组还在 —— 组件据此画「还没有选项」而不是白屏。 */
		assert.equal(view.groups[0]?.empty, true);
	});

	it('options 里脏元素跳过，合法的留下', () => {
		const view = askSectionOf({
			$type: 'ask',
			items: [{ options: [null, 42, { noLabel: 1 }, { label: '好的' }, { label: '' }, { label: '也好' }] }],
		});
		assert.deepEqual(
			view.groups[0]?.options.map((one) => one.label),
			['好的', '也好'],
		);
	});
});

describe('askSectionOf —— items 允许 N 条（结构上不写死 1）', () => {
	it('两条 items ⇒ 两组，顺序保留', () => {
		const view = askSectionOf({
			$type: 'ask',
			items: [
				{ question: '第一个问题', options: [{ label: 'A' }] },
				{ question: '第二个问题', multi_select: true, options: [{ label: 'B' }, { label: 'C' }] },
			],
		});
		assert.equal(view.groups.length, 2);
		assert.deepEqual(
			view.groups.map((one) => one.question),
			['第一个问题', '第二个问题'],
		);
		assert.deepEqual(
			view.groups.map((one) => one.multiSelect),
			[false, true],
		);
	});

	it('⚠ 脏 items（混了非对象）跳过那一条，不丢整章', () => {
		const view = askSectionOf({
			$type: 'ask',
			items: [null, 'x', 42, { question: '真的', options: [] }],
		});
		assert.equal(view.groups.length, 1);
		assert.equal(view.groups[0]?.question, '真的');
	});
});

describe('askSectionOf —— custom（自填值）', () => {
	it('custom 数组带出来；非字符串丢掉', () => {
		const view = askSectionOf({
			$type: 'ask',
			items: [{ options: [{ label: 'A' }], custom: ['自己写的', 42, ''] }],
		});
		assert.deepEqual(view.groups[0]?.custom, ['自己写的', '']);
	});

	it('custom 不是数组 ⇒ 空数组', () => {
		const view = askSectionOf({ $type: 'ask', items: [{ options: [], custom: 'x' }] });
		assert.deepEqual(view.groups[0]?.custom, []);
	});

	it('placeholder 带出来（自填框灰字）', () => {
		const view = askSectionOf({
			$type: 'ask',
			items: [{ options: [], placeholder: '自定义答案…' }],
		});
		assert.equal(view.groups[0]?.placeholder, '自定义答案…');
	});
});

describe('askSectionOf —— 脏数据不炸', () => {
	it('payload 不是对象 ⇒ 零组、empty', () => {
		for (const bad of [null, undefined, 42, 'ask', true, []]) {
			const view = askSectionOf(bad);
			assert.equal(view.groups.length, 0, JSON.stringify(bad));
			assert.equal(view.empty, true, JSON.stringify(bad));
		}
	});

	it('items 不是数组 ⇒ 零组', () => {
		for (const bad of [null, 42, 'x', {}, { 0: {} }]) {
			const view = askSectionOf({ $type: 'ask', items: bad });
			assert.equal(view.empty, true, JSON.stringify(bad));
		}
	});

	it('⚠ 所有字段都是错类型 ⇒ 组还在（消息在，只是空）', () => {
		const view = askSectionOf({
			$type: 'ask',
			items: [{ header: 1, question: {}, options: 'x', multi_select: 'yes', picked: 'A', custom: 9 }],
		});
		assert.equal(view.groups.length, 1);
		const group = view.groups[0];
		assert.equal(group?.header, '');
		assert.equal(group?.question, '');
		assert.deepEqual(group?.options, []);
		assert.equal(group?.multiSelect, false);
		assert.equal(group?.pickedState, 'unset');
		assert.deepEqual(group?.custom, []);
		assert.equal(group?.empty, true);
	});
});

describe('NO_ANSWER —— 「都不要」的回调值', () => {
	it('是空串（对应 payload 的 picked: []，不是删掉 picked）', () => {
		assert.equal(NO_ANSWER, '');
	});
});

/* ══════════════════════════════════════════════════════════
   unknown / 降级
   ══════════════════════════════════════════════════════════ */

describe('sectionViewOf —— 未知 $type 降级', () => {
	it('未注册的 $type ⇒ unknown + 标题带 $type + JSON', () => {
		const view = sectionViewOf({ $type: 'table', rows: [1, 2] });
		assert.equal(view.kind, 'unknown');
		if (view.kind !== 'unknown') return;
		assert.equal(view.title, '未注册的动作「table」');
		assert.match(view.json, /"rows"/u);
	});

	it('连 $type 都没有 ⇒ 「无法识别的数据」', () => {
		const view = sectionViewOf({ 奇怪: { 嵌套: 1 } });
		assert.equal(view.kind, 'unknown');
		if (view.kind !== 'unknown') return;
		assert.equal(view.title, '无法识别的数据');
	});

	it('⚠ 任意脏数据都能给出一个 view，不抛', () => {
		const dirty: readonly unknown[] = [
			null,
			undefined,
			0,
			-1,
			Number.NaN,
			true,
			false,
			[],
			[1, 2, 3],
			['a'],
			{},
			{ $type: '' },
			{ $type: 0 },
			{ $type: null },
			{ $type: 'text', value: {} },
			{ $type: 'markdown', value: 42 },
		];
		for (const one of dirty) {
			const view = sectionViewOf(one);
			assert.ok(['text', 'markdown', 'ask', 'unknown'].includes(view.kind), JSON.stringify(one));
		}
	});

	it('⚠ 循环引用 / BigInt 不炸（JSON.stringify 会抛的脏数据）', () => {
		const circular: Record<string, unknown> = { $type: 'cycle' };
		circular['self'] = circular;
		const a = sectionViewOf(circular);
		assert.equal(a.kind, 'unknown');

		const big = { $type: 'big', n: BigInt(10) };
		const b = sectionViewOf(big);
		assert.equal(b.kind, 'unknown');
	});
});

describe('jsonPreviewOf —— 原始 JSON 预览', () => {
	it('正常对象 ⇒ 缩进 JSON', () => {
		assert.equal(jsonPreviewOf({ a: 1 }), '{\n  "a": 1\n}');
	});

	it('⚠ 超长截断（不让详情页被一坨 JSON 撑爆）', () => {
		const long = jsonPreviewOf({ a: 'x'.repeat(5000) });
		assert.ok(long.length <= 2001, `长度 ${long.length}`);
		assert.ok(long.endsWith('…'));
	});

	it('⚠ 循环引用不抛', () => {
		const circular: Record<string, unknown> = {};
		circular['self'] = circular;
		assert.equal(typeof jsonPreviewOf(circular), 'string');
	});

	it('⚠ BigInt 不抛', () => {
		assert.equal(typeof jsonPreviewOf({ n: BigInt(1) }), 'string');
	});

	it('undefined ⇒ 字符串（不是 "undefined" 之外的崩溃）', () => {
		assert.equal(typeof jsonPreviewOf(undefined), 'string');
	});
});

/* ══════════════════════════════════════════════════════════
   章节名 / 空态 / 可编辑
   ══════════════════════════════════════════════════════════ */

describe('sectionLabelOf —— 章节名用模板给的副本', () => {
	it('正常章节 ⇒ label', () => {
		assert.equal(sectionLabelOf({ label: '选择什么架构', payload: TEXT_EMPTY }), '选择什么架构');
	});

	it('⚠ 不编「正文」这种容器词：label 为空就返回空串', () => {
		assert.equal(sectionLabelOf({ label: '', payload: TEXT_EMPTY }), '');
		assert.equal(sectionLabelOf({ payload: TEXT_EMPTY }), '');
	});

	it('脏数据 ⇒ 空串，不抛', () => {
		for (const bad of [null, undefined, 42, 'x', [], {}]) {
			assert.equal(sectionLabelOf(bad), '', JSON.stringify(bad));
		}
	});

	it('label 不是字符串 ⇒ 空串（不 String() 强转）', () => {
		assert.equal(sectionLabelOf({ label: 42 }), '');
	});
});

describe('emptyHintOf —— 空章节显示什么', () => {
	const textView = sectionViewOf(TEXT_EMPTY);
	const noHint = sectionViewOf({ $type: 'text' });

	it('只读 ⇒ 「（空）」，不提示用户去点', () => {
		if (textView.kind !== 'text') return;
		assert.equal(emptyHintOf(textView, true), '（空）');
	});

	it('可编辑 ⇒ 用模板作者写的 placeholder', () => {
		if (textView.kind !== 'text') return;
		assert.equal(emptyHintOf(textView, false), '选什么架构，为什么');
	});

	it('可编辑但没 placeholder ⇒ 「（空）」', () => {
		if (noHint.kind !== 'text') return;
		assert.equal(emptyHintOf(noHint, false), '（空）');
	});
});

describe('canEditOf —— 组件不判能不能编辑，只翻这一个布尔', () => {
	it('只读 ⇒ 不能编辑（哪怕接了回调）', () => {
		assert.equal(canEditOf(true, true), false);
	});

	it('非只读但没接回调 ⇒ 不能编辑（点了没人管 ⇒ 不该可点）', () => {
		assert.equal(canEditOf(false, false), false);
	});

	it('非只读 + 接了回调 ⇒ 可编辑', () => {
		assert.equal(canEditOf(false, true), true);
	});
});

/* ══════════════════════════════════════════════════════════
   已知缺陷（会自己变红的测试）
   ══════════════════════════════════════════════════════════ */

describe('⚠ 已知缺陷：extractText 认的是 taskboard2 的 ask 形状', () => {
	it('⚠ 已知缺陷：extractText 认的是 taskboard2 的 ask 形状（title + case），v3 是 {items:[{options}]} ⇒ 返回空串。修好后这条测试自己变红，届时删掉本条。见 AGENTS 3.6。', () => {
		/*
		 * 这条**故意钉住当前（错误的）行为**：
		 *
		 * · v3 的真实 ask payload 是 `{ $type:'ask', items:[{ options:[…] }] }`
		 *   （见上面 ASK_REAL，抄自 expectedMismatch.yaml）；
		 * · `src/pure.ts:125` 的 `extractText()` 只认 `{ value }` 和旧版的
		 *   `{ title, case/options }` ⇒ 对 v3 的 ask 返回 `''`；
		 * · 后果：`src/views/CardDetail.tsx:70` 把所有 ask 章节显示成「（空）」。
		 *
		 * ⇒ 修好 `extractText`（改成读 `items[].options`）之后，**这条断言会变红**
		 *   —— 那是验收信号，不是回归。届时删掉本条，改为断言真实文本。
		 */
		assert.equal(extractText(ASK_REAL), '');

		/* 对照：旧形状它认（这正是缺陷的证据 —— 认旧不认新）。 */
		assert.equal(
			extractText({ title: '这个预期的依据', case: [{ label: '望文生义' }] }),
			'这个预期的依据\n· {"label":"望文生义"}',
		);

		/* 而 text / markdown 的形状它认对 —— 所以 Section 里只有 ask 不能复用它。 */
		assert.equal(extractText(TEXT_FILLED), '服务器 + 客户端，消息走异步流。');
	});
});
