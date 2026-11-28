/**
 * `ask` 交互规则的纯逻辑测试。
 *
 * ⚠ 字段以 **action 架构** 为准：`packages/core/src/template/actions.ts` 的
 * `askItemSchema` —— `header` / `question` / `options` / `multi_select` /
 * `picked` / `custom` / `placeholder`。
 *
 * **没有 `custom_active`**。「自填行选中」在架构里表达成
 * `picked` 里有一个不是任何选项 label 的值（= 被选中的自填文字）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	applyAskAction,
	askCustomCommitOf,
	askDraftViewOf,
	askPatchOf,
	askPayloadAfter,
	askSectionOf,
	type AskCustomDraft,
} from '../src/pure/section.ts';

/** 造一个 ask payload。 */
function payloadOf(options: readonly string[], extra: Readonly<Record<string, unknown>> = {}): unknown {
	return {
		$type: 'ask',
		items: [
			{
				question: '这个卡的目的是什么？',
				options: options.map((label) => ({ label })),
				...extra,
			},
		],
	};
}

/** 取第 0 组的 view。 */
function groupOf(payload: unknown) {
	const view = askSectionOf(payload);
	assert.equal(view.kind, 'ask');
	const group = view.groups[0];
	assert.ok(group !== undefined);
	return group;
}

describe('askPatchOf · pick', () => {
	it('单选：新选中替换旧的，且不写 custom_active', () => {
		const group = groupOf(payloadOf(['A', 'B'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'pick', label: 'B' });
		assert.deepEqual(patch['picked'], ['B']);
		assert.ok(!('custom_active' in patch), '架构里没有 custom_active');
	});

	it('多选：新选中追加', () => {
		const group = groupOf(payloadOf(['A', 'B'], { multi_select: true, picked: ['A'] }));
		assert.deepEqual(askPatchOf(group, { type: 'pick', label: 'B' })['picked'], ['A', 'B']);
	});

	it('多选：再点已选 = 取消', () => {
		const group = groupOf(payloadOf(['A', 'B'], { multi_select: true, picked: ['A', 'B'] }));
		assert.deepEqual(askPatchOf(group, { type: 'pick', label: 'A' })['picked'], ['B']);
	});

	it('单选 pick 会把自填文字挤出 picked（互斥）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['自己写的'], custom: ['自己写的'] }));
		assert.equal(group.customActive, true);
		const patch = askPatchOf(group, { type: 'pick', label: 'A' });
		assert.deepEqual(patch['picked'], ['A']);
	});
});

describe('askPatchOf · clear', () => {
	it('未选择 = 删 picked 字段（不是空数组）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'clear' });
		assert.ok('picked' in patch);
		assert.equal(patch['picked'], undefined);
	});

	it('clear 不动 custom 文字', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'], custom: ['自己写的'] }));
		assert.ok(!('custom' in askPatchOf(group, { type: 'clear' })));
	});
});

describe('askPatchOf · custom-toggle', () => {
	it('没有自填文字时也能选中（用空字符串占位）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		assert.deepEqual(askPatchOf(group, { type: 'custom-toggle' })['picked'], ['']);
	});

	it('单选：自填文字进 picked，选项让位', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'], custom: ['自己写的'] }));
		assert.deepEqual(askPatchOf(group, { type: 'custom-toggle' })['picked'], ['自己写的']);
	});

	it('单选：再点一次 ⇒ 删 picked（回到未选择），custom 保留', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['自己写的'], custom: ['自己写的'] }));
		const patch = askPatchOf(group, { type: 'custom-toggle' });
		assert.equal(patch['picked'], undefined);
		assert.ok(!('custom' in patch));
	});

	it('多选：自填文字追加进 picked，选项保留', () => {
		const group = groupOf(payloadOf(['A'], { multi_select: true, picked: ['A'], custom: ['自己写的'] }));
		assert.deepEqual(askPatchOf(group, { type: 'custom-toggle' })['picked'], ['A', '自己写的']);
	});
});

describe('askPatchOf · custom-input', () => {
	it('输入即选中：custom + picked 都写', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'custom-input', text: '自己写的' });
		assert.deepEqual(patch['custom'], ['自己写的']);
		assert.deepEqual(patch['picked'], ['自己写的']);
	});

	it('清空文字 ⇒ custom 清空，但自填行仍选中（picked 留空字符串）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['自己写的'], custom: ['自己写的'] }));
		const patch = askPatchOf(group, { type: 'custom-input', text: '' });
		assert.deepEqual(patch['custom'], []);
		assert.deepEqual(patch['picked'], ['']);
	});
});

describe('applyAskAction', () => {
	it('pick 写回 payload', () => {
		const next = applyAskAction(payloadOf(['A', 'B']), 0, { type: 'pick', label: 'B' });
		const group = groupOf(next);
		assert.equal(group.pickedState, 'picked');
		assert.equal(group.options.find((one) => one.label === 'B')?.picked, true);
	});

	it('clear 后 payload 里没有 picked 字段（= unset）', () => {
		const next = applyAskAction(payloadOf(['A'], { picked: ['A'] }), 0, { type: 'clear' });
		assert.equal(groupOf(next).pickedState, 'unset');
		assert.ok(!('picked' in ((next as { items: Record<string, unknown>[] }).items[0] ?? {})));
	});

	it('自填：custom 存文字，customActive 由 picked 派生', () => {
		const next = applyAskAction(payloadOf(['A']), 0, { type: 'custom-input', text: 'hi' });
		const group = groupOf(next);
		assert.deepEqual(group.custom, ['hi']);
		assert.equal(group.customActive, true);
	});

	it('单选：先选 A 再填自填 ⇒ A 不再选中', () => {
		let payload = applyAskAction(payloadOf(['A', 'B']), 0, { type: 'pick', label: 'A' });
		payload = applyAskAction(payload, 0, { type: 'custom-input', text: 'hi' });
		const group = groupOf(payload);
		assert.equal(group.customActive, true);
		assert.equal(group.options.find((one) => one.label === 'A')?.picked, false);
	});

	it('形状不对时原样返回', () => {
		const bad = { $type: 'ask' };
		assert.equal(applyAskAction(bad, 0, { type: 'clear' }), bad);
	});
});

/*
 * `askPayloadAfter` 是**组件接线的入口**：CardDetail 拿到它返回的整个新 payload，
 * 以 patch 形式上抛；形状不对时返回 `undefined`，调用方就不会发一次无意义的 PATCH。
 */
describe('askPayloadAfter', () => {
	it('形状合法 ⇒ 返回完整新 payload', () => {
		const next = askPayloadAfter(payloadOf(['A', 'B']), 0, { type: 'pick', label: 'B' });
		assert.ok(next !== undefined);
		assert.equal(next['$type'], 'ask');
		assert.equal(groupOf(next).pickedState, 'picked');
		assert.equal(groupOf(next).options.find((one) => one.label === 'B')?.picked, true);
	});

	it('payload 不是对象 ⇒ undefined（不假装作答成功）', () => {
		assert.equal(askPayloadAfter(undefined, 0, { type: 'clear' }), undefined);
		assert.equal(askPayloadAfter('旧形状', 0, { type: 'clear' }), undefined);
	});

	it('items 缺失 / 组下标越界 ⇒ undefined', () => {
		assert.equal(askPayloadAfter({ $type: 'ask' }, 0, { type: 'clear' }), undefined);
		assert.equal(askPayloadAfter(payloadOf(['A']), 3, { type: 'clear' }), undefined);
	});
});

/* ══════════════════════════════════════════════════════════
   输入即选中（issue #61 / 用户 2026-11-28）

   回归的缺陷：在自填框里打了字、光标还在框内，单选圆圈却是空的，
   **必须失焦才选中**。根因是「选中态只能来自 payload，而 payload 失焦才写」。
   ⇒ 草稿层（`askDraftViewOf`）负责同一帧的显示，`askCustomCommitOf` 负责失焦落库。

   ⚠ 两条用户原话必须同时成立，别为一条牺牲另一条：
     · 2026-11-28（issue #61）：「输入内容的时候没有自动立刻选择自填框」
       ⇒ 聚焦 / 打字都要**同一帧**显示选中；
     · 2026-11-21 第 3 条：「点输入框不是选择（可能只是想刮取/看文字）」
       ⇒ **只聚焦不打字 ⇒ 失焦回到原答案、不写库**。
   ══════════════════════════════════════════════════════════ */

/** 造一份草稿（`edited` = 这一轮里真的打过字）。 */
function draftOf(text: string, edited: boolean): AskCustomDraft {
	return { text, edited };
}

/**
 * 只取**画在界面上的选中信息**（选项勾选 / 自填是否选中 / 三态 / 计数）。
 *
 * 不看 `custom` 文字和 `picked` 的原始内容 —— 那两个是数据，不是这一行的选中态。
 */
function selectionOf(group: ReturnType<typeof groupOf>) {
	return {
		options: group.options.map((one) => ({ label: one.label, picked: one.picked })),
		customActive: group.customActive,
		pickedState: group.pickedState,
		pickedCount: group.pickedCount,
	};
}

describe('askDraftViewOf · 聚焦/输入 ⇒ 同一帧选中 custom', () => {
	it('单选：打字 ⇒ 自填选中 + 同组其它选项立刻取消', () => {
		const group = groupOf(payloadOf(['A', 'B'], { picked: ['A'] }));
		const shown = askDraftViewOf(group, draftOf('444', true));

		assert.equal(shown.customActive, true, '自填行必须是选中态');
		assert.deepEqual(shown.custom, ['444']);
		assert.deepEqual(
			shown.options.map((one) => one.picked),
			[false, false],
			'单选互斥：同一次渲染里其它选项全部取消',
		);
		/* 「未选择」徽章的亮灭只看这个三态（`AskGroupHead` 的 `unset`）。 */
		assert.equal(shown.pickedState, 'picked');
		assert.equal(shown.pickedCount, 1);
	});

	it('单选：只聚焦（还没打字）也立刻选中 —— 不靠失焦', () => {
		const group = groupOf(payloadOf(['A', 'B'], { picked: ['A'] }));
		const shown = askDraftViewOf(group, draftOf('', false));

		assert.equal(shown.customActive, true);
		assert.deepEqual(
			shown.options.map((one) => one.picked),
			[false, false],
		);
		assert.equal(shown.pickedState, 'picked');
	});

	it('多选：草稿和已选选项**共存**（不挤掉选项，和 custom-input 一致）', () => {
		const group = groupOf(payloadOf(['A', 'B'], { multi_select: true, picked: ['A'] }));
		const shown = askDraftViewOf(group, draftOf('补充', true));

		assert.deepEqual(
			shown.options.map((one) => one.picked),
			[true, false],
			'多选：已选选项保留',
		);
		assert.equal(shown.customActive, true);
		assert.equal(shown.pickedCount, 2);
	});

	it('多选：草稿为空 ⇒ 原样返回（没输入文字不算选中，界面一个像素都不动）', () => {
		const group = groupOf(payloadOf(['A'], { multi_select: true }));
		/* 打过字又删空，也还是「没有文字」⇒ 不算选中。 */
		assert.equal(askDraftViewOf(group, draftOf('', true)), group);
	});

	it('多选：自填本来就选中 ⇒ 计数不重复加', () => {
		const group = groupOf(payloadOf(['A'], { multi_select: true, picked: ['A', '旧'], custom: ['旧'] }));
		const shown = askDraftViewOf(group, draftOf('新的', true));

		assert.equal(shown.customActive, true);
		assert.equal(shown.pickedCount, 2);
		assert.deepEqual(shown.custom, ['新的']);
	});

	it('没有草稿（undefined）⇒ 原样返回', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		assert.equal(askDraftViewOf(group, undefined), group);
	});
});

describe('askCustomCommitOf · 失焦那一次动作（写库节奏不变）', () => {
	it('只聚焦、没打字 ⇒ 不发（点输入框不是选择）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'], custom: ['旧'] }));
		assert.equal(askCustomCommitOf(group, draftOf('', false)), undefined);
		assert.equal(askCustomCommitOf(group, draftOf('旧', false)), undefined);
	});

	it('打过字、文字变了 ⇒ 一次 custom-input（老路径）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		assert.deepEqual(askCustomCommitOf(group, draftOf('444', true)), {
			type: 'custom-input',
			text: '444',
		});
	});

	it('打过字、又改回原值、本来就选中 ⇒ 不发（省一次无意义的 PATCH）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['旧'], custom: ['旧'] }));
		assert.equal(askCustomCommitOf(group, draftOf('旧', true)), undefined);
	});

	it('打过字、又改回原值、但还没选中 ⇒ 补一次 custom-input 把选中落库', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'], custom: ['旧'] }));
		assert.deepEqual(askCustomCommitOf(group, draftOf('旧', true)), {
			type: 'custom-input',
			text: '旧',
		});
	});

	it('多选：把已存的自填文字删空 ⇒ 仍然要发（清空得让服务端知道）', () => {
		const group = groupOf(
			payloadOf(['A'], { multi_select: true, picked: ['A', '旧'], custom: ['旧'] }),
		);
		assert.deepEqual(askCustomCommitOf(group, draftOf('', true)), { type: 'custom-input', text: '' });
	});

	it('没有草稿 ⇒ 不发', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		assert.equal(askCustomCommitOf(group, undefined), undefined);
	});
});

describe('⚠ 打过字的草稿：看到的选中 = 落库后的选中', () => {
	/*
	 * 这条是本修复的**核心不变量**：打字时叠出来的选中态，必须和
	 * 「失焦 → `askCustomCommitOf()` → `applyAskAction()`」之后画出来的选中态一致。
	 *
	 * 少了它，两个函数各自都对、合起来仍然会闪一下 —— 那种 bug 单看一个函数看不出来。
	 *
	 * 只对**界面上真的有变化**的草稿对账：多选 + 空文字不显示选中（见下一个用例）。
	 */
	const CASES: ReadonlyArray<readonly [string, unknown]> = [
		['单选 · 已选 A', payloadOf(['A', 'B'], { picked: ['A'] })],
		['单选 · 未选择', payloadOf(['A', 'B'])],
		['单选 · 自填已选中', payloadOf(['A'], { picked: ['旧'], custom: ['旧'] })],
		['单选 · 有文字但没选中', payloadOf(['A'], { picked: ['A'], custom: ['旧'] })],
		['多选 · 已选 A', payloadOf(['A', 'B'], { multi_select: true, picked: ['A'] })],
		['多选 · 自填已选中', payloadOf(['A'], { multi_select: true, picked: ['A', '旧'], custom: ['旧'] })],
		['多选 · 有文字但没选中', payloadOf(['A'], { multi_select: true, picked: ['A'], custom: ['旧'] })],
		['多选 · 未选择', payloadOf(['A'], { multi_select: true })],
	];

	const DRAFTS = ['', '444', '旧'];

	it('每种（组 × 草稿）组合都一致', () => {
		for (const [name, payload] of CASES) {
			for (const text of DRAFTS) {
				const group = groupOf(payload);
				const draft = draftOf(text, true);
				const shown = askDraftViewOf(group, draft);
				/* 界面没变化（多选 + 空文字）⇒ 没有「看到的选中」可对账。 */
				if (shown === group) continue;

				const action = askCustomCommitOf(group, draft);
				assert.ok(action !== undefined, `${name} / 草稿「${text}」：界面变了，却没有落库动作`);

				const after = groupOf(applyAskAction(payload, 0, action));
				assert.deepEqual(
					selectionOf(shown),
					selectionOf(after),
					`${name} / 草稿「${text}」：草稿显示与落库后不一致`,
				);
			}
		}
	});

	it('多选 + 空文字：界面不变，就不发动作（不凭空写出一份「选中」）', () => {
		for (const payload of [payloadOf(['A', 'B'], { multi_select: true, picked: ['A'] }), payloadOf(['A'], { multi_select: true })]) {
			const group = groupOf(payload);
			assert.equal(askDraftViewOf(group, draftOf('', true)), group, '前置：界面本就不变');
			assert.equal(askCustomCommitOf(group, draftOf('', true)), undefined);
		}
	});

	it('⚠ 只聚焦（没打字）⇒ 任何一组都不落库（预览而已）', () => {
		for (const [name, payload] of CASES) {
			for (const text of DRAFTS) {
				const group = groupOf(payload);
				assert.equal(
					askCustomCommitOf(group, draftOf(text, false)),
					undefined,
					`${name} / 草稿「${text}」：只聚焦竟然要写库`,
				);
			}
		}
	});
});
