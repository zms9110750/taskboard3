/**
 * core 的 `Failure` → 表单错误（`pure/create-failure.ts`）的测试。
 *
 * ## 为什么这块必须单测
 *
 * 用户 `2026-11-22`：
 * > 「点了提交以后，这个建卡参数都要进 core，也要过架构校验。
 * >  而且是跟 ai tool 一样的校验入口。过了校验才能建卡。」
 *
 * core 拒绝时返回的是 **JSON Pointer 路径**（`/content/<label>/<字段>`），
 * 而 `CardCreate` 只认本包的 `/sections/<sectionId>`。
 * **这一层翻错了，用户就看到「还有 1 处要改」但永远找不到那一处** ——
 * 界面不报错，只是让人困惑。这正是最难查的那类 bug。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CreateDraft } from '../src/pure/create-types.ts';
import {
	GENERAL_FIELD,
	errorsFromFailure,
	fieldOf,
	hasGeneralError,
	isFailureLike,
	sectionKeysOf,
	segmentsOf,
} from '../src/pure/create-failure.ts';

/* ══════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════ */

/**
 * 造一份草稿。
 *
 * ⚠ 章节的 `sectionId` 和 `label` **故意不同** —— 那样才能证明
 *   映射表真的在用 label 查，而不是碰巧 id 和 label 一样。
 */
function draft(): CreateDraft {
	return {
		title: '测试卡',
		templateRef: 'decision',
		parentId: '',
		relations: [],
		note: '',
		sections: [
			{ sectionId: 'directions', label: '可能的方向', hint: '', kind: 'text', payload: { $type: 'text', value: '' } },
			{ sectionId: 'helpful', label: '知道什么信息后对决策有帮助', hint: '', kind: 'text', payload: { $type: 'text', value: '' } },
		],
	};
}

/* ══════════════════════════════════════════════════════════
   segmentsOf
   ══════════════════════════════════════════════════════════ */

describe('segmentsOf —— 拆 JSON Pointer', () => {
	it('普通路径', () => {
		assert.deepEqual(segmentsOf('/content/directions/value'), ['content', 'directions', 'value']);
	});

	it('空串 ⇒ 空数组（指向根）', () => {
		assert.deepEqual(segmentsOf(''), []);
	});

	it('反转义 ~1（/）和 ~0（~）', () => {
		assert.deepEqual(segmentsOf('/a~1b/c~0d'), ['a/b', 'c~d']);
	});

	it('多个前导 / 被吃掉', () => {
		assert.deepEqual(segmentsOf('///a/b'), ['a', 'b']);
	});
});

/* ══════════════════════════════════════════════════════════
   sectionKeysOf
   ══════════════════════════════════════════════════════════ */

describe('sectionKeysOf —— 章节名/id 映射', () => {
	it('id 和 label 都指向同一个 sectionId', () => {
		const keys = sectionKeysOf(draft());
		assert.equal(keys.get('directions'), 'directions');
		assert.equal(keys.get('可能的方向'), 'directions');
	});

	it('label 为空时只登记 id（不登记空串）', () => {
		const one = draft();
		/*
		 * `noUncheckedIndexedAccess` 让 `one.sections[0]` 是 `SectionDraft | undefined`
		 * —— 展开它会把「可能没有第一节」这个事实带进对象字面量（tsc 报 TS2322）。
		 * 夹具里第一节一定在，所以显式取出并断言，比 `!` 诚实。
		 */
		const first = one.sections[0];
		assert.ok(first !== undefined, '夹具至少该有一节');
		const keys = sectionKeysOf({
			...one,
			sections: [{ ...first, sectionId: 'x', label: '' }],
		});
		assert.equal(keys.get('x'), 'x');
		assert.equal(keys.has(''), false);
	});
});

/* ══════════════════════════════════════════════════════════
   fieldOf —— core 路径 → 本包字段
   ══════════════════════════════════════════════════════════ */

describe('fieldOf —— core 的 JSON Pointer 翻成本包字段', () => {
	const keys = sectionKeysOf(draft());

	it('⭐ /content/<label> 能落到 sectionId（label ≠ id 的实况）', () => {
		assert.equal(fieldOf('/content/可能的方向', keys), '/sections/directions');
	});

	it('⭐ /content/<id> 也能（core 两者都认）', () => {
		assert.equal(fieldOf('/content/directions', keys), '/sections/directions');
	});

	it('⭐ /content/<label>/<字段> 只要章节对得上就归到那一章', () => {
		assert.equal(fieldOf('/content/可能的方向/value', keys), '/sections/directions');
	});

	it('/title ⇒ /title', () => {
		assert.equal(fieldOf('/title', keys), '/title');
	});

	it('/templateRef ⇒ /templateRef', () => {
		assert.equal(fieldOf('/templateRef', keys), '/templateRef');
	});

	it('⭐ /kind、/domain ⇒ /templateRef（空模板缺分类 = 模板没选对）', () => {
		assert.equal(fieldOf('/kind', keys), '/templateRef');
		assert.equal(fieldOf('/domain', keys), '/templateRef');
	});

	it('⭐ 认不出的章节名 ⇒ 空串（不猜，走统错横幅）', () => {
		assert.equal(fieldOf('/content/不存在的章节', keys), GENERAL_FIELD);
	});

	it('/content 后面什么都没有 ⇒ 空串', () => {
		assert.equal(fieldOf('/content', keys), GENERAL_FIELD);
	});

	it('/relations/0 ⇒ 空串（core 目前不给关系逐条 issue）', () => {
		assert.equal(fieldOf('/relations/0', keys), GENERAL_FIELD);
	});

	it('完全未知的路径 ⇒ 空串', () => {
		assert.equal(fieldOf('/nonsense/x/y', keys), GENERAL_FIELD);
	});
});

/* ══════════════════════════════════════════════════════════
   errorsFromFailure
   ══════════════════════════════════════════════════════════ */

describe('errorsFromFailure —— core 失败 → 表单错误', () => {
	it('⭐ 逐条映射，不合并成一句', () => {
		const errors = errorsFromFailure(
			{
				code: 'CONTENT_INVALID',
				message: '模板「决策」的章节内容格式不对。',
				issues: [
					{ path: '/content/可能的方向/value', message: '必填' },
					{ path: '/title', message: '必填' },
				],
			},
			draft(),
		);
		assert.deepEqual(errors, [
			{ field: '/sections/directions', message: '必填' },
			{ field: '/title', message: '必填' },
		]);
	});

	it('⭐ 没有 issues ⇒ 一条统错（field 是空串）', () => {
		const errors = errorsFromFailure(
			{ code: 'RELATION_TARGET_INVALID', message: '父卡「X」不存在。' },
			draft(),
		);
		assert.deepEqual(errors, [{ field: GENERAL_FIELD, message: '父卡「X」不存在。' }]);
	});

	it('issues 为空数组 ⇒ 同样走统错（不是「没有错误」）', () => {
		const errors = errorsFromFailure(
			{ code: 'FIELD_REQUIRED', message: '卡标题不能为空。', issues: [] },
			draft(),
		);
		assert.equal(errors.length, 1);
		assert.equal(errors[0]?.field, GENERAL_FIELD);
	});
});

/* ══════════════════════════════════════════════════════════
   hasGeneralError
   ══════════════════════════════════════════════════════════ */

describe('hasGeneralError —— 要不要显示 core 原话', () => {
	it('全字段级 ⇒ false（界面上能落到输入框，不用横幅）', () => {
		assert.equal(hasGeneralError([{ field: '/title', message: '必填' }]), false);
	});

	it('⭐ 有一条无主 ⇒ true（否则用户找不到那一处）', () => {
		assert.equal(
			hasGeneralError([
				{ field: '/title', message: '必填' },
				{ field: GENERAL_FIELD, message: '模板没有这些章节' },
			]),
			true,
		);
	});

	it('空数组 ⇒ false', () => {
		assert.equal(hasGeneralError([]), false);
	});
});

/* ══════════════════════════════════════════════════════════
   isFailureLike —— 形状判定（不能 instanceof）
   ══════════════════════════════════════════════════════════ */

describe('isFailureLike —— 按形状判定，不是 instanceof', () => {
	it('⭐ 带 code 的 Error ⇒ true', () => {
		const error = Object.assign(new Error('卡标题不能为空。'), { code: 'FIELD_REQUIRED' });
		assert.equal(isFailureLike(error), true);
	});

	it('普通 Error（无 code）⇒ false', () => {
		assert.equal(isFailureLike(new Error('网络炸了')), false);
	});

	it('code 是空串 ⇒ false', () => {
		assert.equal(isFailureLike(Object.assign(new Error('x'), { code: '' })), false);
	});

	it('非 Error ⇒ false', () => {
		assert.equal(isFailureLike({ code: 'X', message: 'y' }), false);
		assert.equal(isFailureLike('字符串'), false);
		assert.equal(isFailureLike(null), false);
		assert.equal(isFailureLike(undefined), false);
	});
});
