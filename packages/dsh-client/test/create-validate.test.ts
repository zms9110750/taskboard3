/**
 * `validateCreate` / `switchSectionKind` / `toCreateSubmission` 的测试。
 *
 * ## 为什么这三块值得单测
 *
 * | 函数 | 错的症状 |
 * |---|---|
 * | `validateCreate` | 提交后 core 报错，而用户在客户端看不到任何提示 —— 要等一个往返才知道 |
 * | `switchSectionKind` | **静默丢内容**（切类型时把用户写的字扔了） |
 * | `toCreateSubmission` | 界面显示 3 条关系、提交 2 条；或者 title 带首尾空格进了库 |
 *
 * 三种都不报错，只是「用户觉得怪」。⇒ 逐条钉住。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CreateDraft, RelationDraft, SectionDraft } from '../src/pure/create-types.ts';
import {
	emptyPayloadOf,
	hasContent,
	payloadTypeOf,
	relationCountOf,
	switchSectionKind,
	toCreateSubmission,
	validateCreate,
	valueOf,
} from '../src/pure/create-validate.ts';

/* ══════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════ */

/** 造一个章节草稿。 */
function section(patch: Partial<SectionDraft> & { sectionId: string }): SectionDraft {
	return {
		label: patch.sectionId,
		hint: '',
		kind: 'text',
		payload: { $type: 'text', value: '' },
		...patch,
	};
}

/** 造一份合法草稿（各用例在此基础上改一处）。 */
function draft(patch: Partial<CreateDraft> = {}): CreateDraft {
	return {
		title: '修好分组为空的提示',
		templateRef: 'expectedMismatch',
		parentId: '',
		relations: [],
		sections: [section({ sectionId: 'summary', payload: { $type: 'text', value: '一句话' } })],
		note: '',
		...patch,
	};
}

/* ══════════════════════════════════════════════════════════
   validateCreate
   ══════════════════════════════════════════════════════════ */

describe('validateCreate —— 全通过', () => {
	it('最小合法草稿 ⇒ 无错误', () => {
		assert.deepEqual(validateCreate(draft()), []);
	});

	it('章节为空 payload 也算通过（空章节合法，core 会填默认值）', () => {
		assert.deepEqual(
			validateCreate(draft({ sections: [section({ sectionId: 'a', payload: { $type: 'text' } })] })),
			[],
		);
	});

	it('关系有目标 ⇒ 通过', () => {
		assert.deepEqual(
			validateCreate(draft({ relations: [{ label: 'dependsOn', to: 'AB-01' }] })),
			[],
		);
	});
});

describe('validateCreate —— 标题', () => {
	it('⚠ 空标题 ⇒ 报错', () => {
		const errors = validateCreate(draft({ title: '' }));
		assert.equal(errors.length, 1);
		assert.equal(errors[0]?.field, '/title');
	});

	it('⚠ 只空格的标题 ⇒ 也报错（trim 后为空）', () => {
		const errors = validateCreate(draft({ title: '   \t  ' }));
		assert.equal(errors.length, 1);
		assert.equal(errors[0]?.field, '/title');
	});

	it('前后有空格但中间有字 ⇒ 通过（trim 在提交时做）', () => {
		assert.deepEqual(validateCreate(draft({ title: '  有内容  ' })), []);
	});
});

describe('validateCreate —— 模板', () => {
	it('⚠ 没选模板 ⇒ 报错', () => {
		const errors = validateCreate(draft({ templateRef: '' }));
		assert.equal(errors.length, 1);
		assert.equal(errors[0]?.field, '/templateRef');
	});

	it('标题和模板都缺 ⇒ 两条都报（不是只报第一条）', () => {
		const errors = validateCreate(draft({ title: '', templateRef: '' }));
		assert.equal(errors.length, 2);
		assert.deepEqual(
			errors.map((one) => one.field),
			['/title', '/templateRef'],
		);
	});
});

describe('validateCreate —— 章节 $type', () => {
	it('⚠ 缺 $type ⇒ 报错', () => {
		const errors = validateCreate(
			draft({ sections: [section({ sectionId: 'a', payload: { value: 'x' } })] }),
		);
		assert.equal(errors.length, 1);
		assert.equal(errors[0]?.field, '/sections/a');
	});

	it('⚠ $type 与声明的 kind 不一致 ⇒ 报错（防「切了类型但 payload 没换」）', () => {
		const errors = validateCreate(
			draft({
				sections: [
					section({ sectionId: 'basis', kind: 'ask', payload: { $type: 'markdown', value: 'x' } }),
				],
			}),
		);
		assert.equal(errors.length, 1);
		assert.equal(errors[0]?.field, '/sections/basis');
		assert.ok(errors[0]?.message.includes('markdown'), errors[0]?.message);
		assert.ok(errors[0]?.message.includes('ask'), errors[0]?.message);
	});

	it('多个章节都错 ⇒ 每条都报', () => {
		const errors = validateCreate(
			draft({
				sections: [
					section({ sectionId: 'a', payload: {} }),
					section({ sectionId: 'b', payload: {} }),
				],
			}),
		);
		assert.deepEqual(
			errors.map((one) => one.field),
			['/sections/a', '/sections/b'],
		);
	});

	it('payload 是字符串 / null ⇒ 当作缺 $type', () => {
		assert.equal(payloadTypeOf('裸字符串'), '');
		assert.equal(payloadTypeOf(null), '');
		assert.equal(payloadTypeOf(42), '');
		assert.equal(payloadTypeOf({ $type: 42 }), '');
	});
});

describe('validateCreate —— 关系', () => {
	it('空关系行（没类型也没目标）⇒ 报错', () => {
		const errors = validateCreate(draft({ relations: [{ label: '', to: '' }] }));
		assert.equal(errors.length, 1);
		assert.equal(errors[0]?.field, '/relations/0');
	});

	it('⚠ 有类型没目标 ⇒ **不报错**（用户加了一行还没选，是正常中间态）', () => {
		assert.deepEqual(validateCreate(draft({ relations: [{ label: 'dependsOn', to: '' }] })), []);
	});
});

/* ══════════════════════════════════════════════════════════
   switchSectionKind
   ══════════════════════════════════════════════════════════ */

describe('switchSectionKind —— text ↔ markdown 保留内容', () => {
	it('text → markdown：value 带过去', () => {
		const before = section({ sectionId: 'a', kind: 'text', payload: { $type: 'text', value: '# 标题' } });
		const result = switchSectionKind(before, 'markdown');
		assert.equal(result.lostContent, false);
		assert.equal(result.section.kind, 'markdown');
		assert.equal(valueOf(result.section.payload), '# 标题');
		assert.equal(payloadTypeOf(result.section.payload), 'markdown');
	});

	it('markdown → text：value 带回来', () => {
		const before = section({
			sectionId: 'a',
			kind: 'markdown',
			payload: { $type: 'markdown', value: '正文' },
		});
		const result = switchSectionKind(before, 'text');
		assert.equal(result.lostContent, false);
		assert.equal(valueOf(result.section.payload), '正文');
		assert.equal(payloadTypeOf(result.section.payload), 'text');
	});
});

describe('switchSectionKind —— 切到 ask 重置', () => {
	it('⚠ text → ask：丢掉文本，标记 lostContent', () => {
		const before = section({ sectionId: 'a', kind: 'text', payload: { $type: 'text', value: '要丢的' } });
		const result = switchSectionKind(before, 'ask');
		assert.equal(result.lostContent, true);
		assert.equal(result.section.kind, 'ask');
		assert.equal(payloadTypeOf(result.section.payload), 'ask');
		assert.equal(valueOf(result.section.payload), '');
	});

	it('空文本 → ask：不标 lostContent（没东西可丢，不该弹提示）', () => {
		const before = section({ sectionId: 'a', kind: 'text', payload: { $type: 'text', value: '' } });
		const result = switchSectionKind(before, 'ask');
		assert.equal(result.lostContent, false);
	});
});

describe('switchSectionKind —— ask 切回文本也是重置（三条理由）', () => {
	/*
	 * 理由（详见 create-validate.ts 的注释）：
	 * ① 答案是「问卷答案」，正文是「正文」—— 拼起来会让语义彻底变味
	 * ② 拼成文字之后切回 ask 无法还原 ⇒ 一次误点永久破坏数据
	 * ③ 「拼成文字」是替用户做语义决定
	 */
	const askSection = section({
		sectionId: 'basis',
		kind: 'ask',
		payload: {
			$type: 'ask',
			items: [{ question: '依据', options: [{ label: '望文生义' }], picked: ['望文生义'] }],
		},
	});

	it('⚠ ask → text：重置 + 标记 lostContent', () => {
		const result = switchSectionKind(askSection, 'text');
		assert.equal(result.lostContent, true);
		assert.equal(result.section.kind, 'text');
		assert.equal(valueOf(result.section.payload), '');
	});

	it('⚠ ask → markdown：同样重置', () => {
		const result = switchSectionKind(askSection, 'markdown');
		assert.equal(result.lostContent, true);
		assert.equal(valueOf(result.section.payload), '');
	});

	it('空的 ask → text：不标 lostContent', () => {
		const empty = section({ sectionId: 'x', kind: 'ask', payload: emptyPayloadOf('ask') });
		assert.equal(switchSectionKind(empty, 'text').lostContent, false);
	});

	it('⚠ 切回同一类型 ⇒ 原样返回、不标丢内容', () => {
		const result = switchSectionKind(askSection, 'ask');
		assert.equal(result.lostContent, false);
		assert.equal(result.section, askSection);
	});
});

describe('hasContent', () => {
	it('text 有 value ⇒ true', () => {
		assert.equal(hasContent(section({ sectionId: 'a', payload: { $type: 'text', value: 'x' } })), true);
	});

	it('text 空 value ⇒ false', () => {
		assert.equal(hasContent(section({ sectionId: 'a', payload: { $type: 'text', value: '' } })), false);
	});

	it('ask 有选项 ⇒ true', () => {
		assert.equal(
			hasContent(
				section({
					sectionId: 'a',
					kind: 'ask',
					payload: { $type: 'ask', items: [{ options: [{ label: 'x' }] }] },
				}),
			),
			true,
		);
	});

	it('ask 有 picked（即使选项空）⇒ true', () => {
		assert.equal(
			hasContent(
				section({
					sectionId: 'a',
					kind: 'ask',
					payload: { $type: 'ask', items: [{ options: [], picked: ['x'] }] },
				}),
			),
			true,
		);
	});

	it('ask 全空 ⇒ false', () => {
		assert.equal(
			hasContent(section({ sectionId: 'a', kind: 'ask', payload: emptyPayloadOf('ask') })),
			false,
		);
	});

	it('脏 payload ⇒ false（不抛）', () => {
		assert.equal(hasContent(section({ sectionId: 'a', payload: null })), false);
		assert.equal(hasContent(section({ sectionId: 'a', payload: 'str' })), false);
	});
});

/* ══════════════════════════════════════════════════════════
   toCreateSubmission
   ══════════════════════════════════════════════════════════ */

describe('toCreateSubmission —— 对照 core 的 CreateInput', () => {
	it('title 被 trim', () => {
		const out = toCreateSubmission(draft({ title: '  有内容  ' }));
		assert.equal(out.title, '有内容');
	});

	it('content 的 key 是 sectionId', () => {
		const out = toCreateSubmission(
			draft({
				sections: [section({ sectionId: 'summary', label: '一句话描述', payload: { $type: 'text', value: 'x' } })],
			}),
		);
		assert.deepEqual(Object.keys(out.content), ['summary']);
		assert.equal(payloadTypeOf(out.content['summary']), 'text');
	});

	it('⚠ 空关系行不送（和 relationCountOf 同一判据）', () => {
		const relations: readonly RelationDraft[] = [
			{ label: 'dependsOn', to: 'AB-01' },
			{ label: 'related', to: '' },
		];
		const out = toCreateSubmission(draft({ relations }));
		assert.equal(out.relations.links.length, 1);
		assert.equal(relationCountOf(relations), 1);
	});

	it('父任务空串 ⇒ null（不是空串）', () => {
		assert.equal(toCreateSubmission(draft({ parentId: '' })).relations.parent, null);
	});

	it('父任务有值 ⇒ 原样', () => {
		assert.equal(toCreateSubmission(draft({ parentId: 'AB-01' })).relations.parent, 'AB-01');
	});

	it('⚠ 不带 workspaceId / actor / origin（那三个归调用方）', () => {
		const out = toCreateSubmission(draft()) as unknown as Record<string, unknown>;
		assert.equal('workspaceId' in out, false);
		assert.equal('actor' in out, false);
		assert.equal('origin' in out, false);
	});

	it('note 原样带出', () => {
		assert.equal(toCreateSubmission(draft({ note: '备注' })).note, '备注');
	});
});

describe('relationCountOf —— 只算有目标的', () => {
	it('空 ⇒ 0', () => assert.equal(relationCountOf([]), 0));
	it('全空行 ⇒ 0', () => {
		assert.equal(relationCountOf([{ label: 'dependsOn', to: '' }]), 0);
	});
	it('两个有目标 ⇒ 2', () => {
		assert.equal(
			relationCountOf([
				{ label: 'dependsOn', to: 'A' },
				{ label: 'related', to: '' },
				{ label: 'references', to: 'B' },
			]),
			2,
		);
	});
});
