/**
 * `pure/section-edit.ts` 的测试 —— **「能不能编辑」与「content 组装」的纯判决**。
 *
 * 两条都是会静默出错的地方：
 *
 * | 判错 | 用户看到什么 |
 * |---|---|
 * | 终态还判可编辑 | 改完服务端拒绝（`ENDED_IMMUTABLE`），用户以为界面坏了 |
 * | content 只带改过的那一章 | `PATCH` 成功但其它章节被抹掉 —— **静默丢数据** |
 *
 * 所以这里钉的是行为（哪些状态可改 / 改一章不动别章），不是实现细节。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	contentOfSections,
	sectionEditableOf,
	sectionsEditableOf,
	sectionsWithPatch,
} from '../src/pure/section-edit.ts';
import type { CardSection } from '../src/types.ts';

/* ── 状态夹具（A2A 全名，分组见 @taskboard/protocol 的 STATUS_GROUP_OF） ── */

const DRAFT = 'TASK_STATE_UNSPECIFIED';
const ACTIVE = ['TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING'] as const;
const SHELVED = ['TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_AUTH_REQUIRED'] as const;
const ENDED = [
	'TASK_STATE_COMPLETED',
	'TASK_STATE_FAILED',
	'TASK_STATE_CANCELED',
	'TASK_STATE_REJECTED',
] as const;

/* ── 章节夹具 ── */

const TEXT_SECTION: CardSection = {
	label: '目标',
	payload: { $type: 'text', value: '原来的正文', placeholder: '写点什么' },
};

const ASK_SECTION: CardSection = {
	label: '需要回答的问题',
	payload: {
		$type: 'ask',
		items: [{ question: '依据？', options: [{ label: 'A' }, { label: 'B' }] }],
	},
};

const MARKDOWN_SECTION: CardSection = {
	label: '留档',
	payload: { $type: 'markdown', value: '# 标题' },
};

/* ══════════════════════════════════════════════════════════
   一、整体可编辑判定
   ══════════════════════════════════════════════════════════ */

describe('sectionsEditableOf —— 按 protocol 的状态分组判', () => {
	it('草稿（可编辑期）可改', () => {
		assert.equal(sectionsEditableOf(DRAFT), true);
	});

	it('进行组（提交 / 处理中）可改', () => {
		for (const status of ACTIVE) assert.equal(sectionsEditableOf(status), true, status);
	});

	it('搁置组（需要信息 / 需要授权）可改', () => {
		for (const status of SHELVED) assert.equal(sectionsEditableOf(status), true, status);
	});

	it('完成组（终态）冻结', () => {
		for (const status of ENDED) assert.equal(sectionsEditableOf(status), false, status);
	});

	it('未知状态按冻结处理（拿不准就不写库）', () => {
		assert.equal(sectionsEditableOf('TASK_STATE_WHAT'), false);
		assert.equal(sectionsEditableOf(''), false);
	});

	it('墓碑（deleted）一律冻结 —— 服务端 update 会回 CARD_NOT_FOUND', () => {
		assert.equal(sectionsEditableOf(DRAFT, true), false);
		assert.equal(sectionsEditableOf('TASK_STATE_WORKING', true), false);
		assert.equal(sectionsEditableOf('TASK_STATE_AUTH_REQUIRED', true), false);
	});
});

/* ══════════════════════════════════════════════════════════
   二、按内容形态判定
   ══════════════════════════════════════════════════════════ */

describe('sectionEditableOf —— markdown 永远只读，text / ask 跟状态', () => {
	it('text：草稿 / 交互期可改，终态冻结', () => {
		assert.equal(sectionEditableOf('text', DRAFT), true);
		for (const status of [...ACTIVE, ...SHELVED]) {
			assert.equal(sectionEditableOf('text', status), true, status);
		}
		for (const status of ENDED) assert.equal(sectionEditableOf('text', status), false, status);
	});

	it('ask：草稿 / 交互期可作答，终态冻结', () => {
		assert.equal(sectionEditableOf('ask', DRAFT), true);
		for (const status of [...ACTIVE, ...SHELVED]) {
			assert.equal(sectionEditableOf('ask', status), true, status);
		}
		for (const status of ENDED) assert.equal(sectionEditableOf('ask', status), false, status);
	});

	it('⭐ markdown 永远只读 —— 包括草稿（lead 2026-11-28 裁定，覆盖 #10 的可编辑格）', () => {
		assert.equal(sectionEditableOf('markdown', DRAFT), false);
		for (const status of [...ACTIVE, ...SHELVED, ...ENDED]) {
			assert.equal(sectionEditableOf('markdown', status), false, status);
		}
	});

	it('unknown 永远只读（没有编辑控件，不能假装能改）', () => {
		assert.equal(sectionEditableOf('unknown', DRAFT), false);
		assert.equal(sectionEditableOf('unknown', 'TASK_STATE_WORKING'), false);
	});

	it('墓碑 ⇒ text / ask 也冻结（哪怕状态还在交互期）', () => {
		assert.equal(sectionEditableOf('text', 'TASK_STATE_WORKING', true), false);
		assert.equal(sectionEditableOf('ask', 'TASK_STATE_WORKING', true), false);
	});
});

/* ══════════════════════════════════════════════════════════
   三、content 组装（PATCH 是整份覆盖）
   ══════════════════════════════════════════════════════════ */

describe('contentOfSections', () => {
	it('把全部章节装进 content：key = sectionId，value = payload', () => {
		const sections = { goal: TEXT_SECTION, question: ASK_SECTION, archive: MARKDOWN_SECTION };
		const content = contentOfSections(sections);

		assert.deepEqual(Object.keys(content).sort(), ['archive', 'goal', 'question']);
		assert.strictEqual(content['goal'], TEXT_SECTION.payload);
		assert.strictEqual(content['question'], ASK_SECTION.payload);
		assert.strictEqual(content['archive'], MARKDOWN_SECTION.payload);
	});

	it('空章节 ⇒ 空对象（不是 undefined）', () => {
		assert.deepEqual(contentOfSections({}), {});
	});
});

describe('sectionsWithPatch —— 改一章不影响别章', () => {
	it('只替换目标章节的 payload，其它章节原引用返回', () => {
		const sections = { goal: TEXT_SECTION, question: ASK_SECTION };
		const after = sectionsWithPatch(sections, 'question', {
			picked: ['A'],
		});

		assert.notStrictEqual(after, sections);
		/* ⭐ 别的章节是**同一个对象** —— React 能跳过重渲染，也不会被 content 组装弄丢。 */
		assert.strictEqual(after['goal'], sections['goal']);
		/* 目标章节是新对象，payload 合并了补丁。 */
		assert.notStrictEqual(after['question'], sections['question']);
		assert.deepEqual(after['question']?.payload, {
			$type: 'ask',
			items: [
				{
					question: '依据？',
					options: [{ label: 'A' }, { label: 'B' }],
				},
			],
			picked: ['A'],
		});
	});

	it('不改入参（纯函数）', () => {
		const sections = { goal: TEXT_SECTION };
		const before = structuredClone(sections);
		sectionsWithPatch(sections, 'goal', { value: '新正文' });
		assert.deepEqual(sections, before);
	});

	it('保留 label（模板副本，不由编辑决定）', () => {
		const after = sectionsWithPatch({ goal: TEXT_SECTION }, 'goal', { value: '新正文' });
		assert.equal(after['goal']?.label, '目标');
	});

	it('章节不存在 / payload 不是对象 ⇒ 原 map 返回（交给调用方报错，不静默造半截 payload）', () => {
		const sections = { goal: TEXT_SECTION };
		assert.strictEqual(sectionsWithPatch(sections, 'missing', { value: 'x' }), sections);

		const dirty = { legacy: { label: '旧数据', payload: '裸字符串' } };
		assert.strictEqual(sectionsWithPatch(dirty, 'legacy', { value: 'x' }), dirty);
	});

	it('组装出来的 content 里，改一章后别章的 payload 仍然在', () => {
		const sections = { goal: TEXT_SECTION, question: ASK_SECTION };
		const after = sectionsWithPatch(sections, 'goal', { value: '新正文' });
		const content = contentOfSections(after);

		assert.deepEqual(content['goal'], { $type: 'text', value: '新正文', placeholder: '写点什么' });
		/* ⭐ 服务端整份覆盖：question 不能因为没改就消失。 */
		assert.strictEqual(content['question'], ASK_SECTION.payload);
	});
});
