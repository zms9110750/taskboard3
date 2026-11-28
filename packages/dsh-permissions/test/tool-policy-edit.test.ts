/**
 * 「授权页编辑」的纯决策单测（issue #57）。
 *
 * 重点不是覆盖率，而是**四个会静默出错的地方**：
 *
 * 1. `common` ↔ 服务端 `claimed` 的映射（写错会改到另一档，而且看起来成功）；
 * 2. 可编辑集合必须是**本档增量**，不是 `effective`（否则会复制上游档位的工具）；
 * 3. 差集为空时**不发请求**（不然每次点保存都写一次 kv）；
 * 4. BASE 恒可用，不能进 allow / remove。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	diffOf,
	editabilityOf,
	isNoopDiff,
	pickerToolsOf,
	putBodyOf,
	scopeToolsOf,
	selectionKeyOf,
	wireTierOf,
} from '../src/pure/tool-policy-edit.ts';
import type { ToolPolicySnapshot } from '../src/pure/tool-policy.ts';

const POLICY: ToolPolicySnapshot = {
	baseTools: ['taskboard_card', 'read'],
	unclaimed: ['bash'],
	common: ['write'],
	groups: [{ name: '编码工具', tools: ['edit'] }],
	groupMembers: [{ group: '编码工具', templates: ['tpl-a'] }],
	templates: [{ templateRef: 'tpl-a', tools: ['grep'] }],
	effective: [{ templateRef: 'tpl-a', tools: ['taskboard_card', 'read', 'bash', 'write', 'edit', 'grep'] }],
};

describe('wireTierOf：UI 的档位 key ↔ 服务端的 tier', () => {
	it('unclaimed 原样；common 是服务端的 claimed', () => {
		assert.equal(wireTierOf('unclaimed'), 'unclaimed');
		assert.equal(wireTierOf('common'), 'claimed');
	});
});

describe('scopeToolsOf：可编辑的是本档增量', () => {
	it('未领卡档 / 通用档各取自己那段', () => {
		assert.deepEqual(scopeToolsOf(POLICY, { kind: 'tier', key: 'unclaimed' }), ['bash']);
		assert.deepEqual(scopeToolsOf(POLICY, { kind: 'tier', key: 'common' }), ['write']);
	});

	it('模板取 templates[ref]，不是 effective', () => {
		assert.deepEqual(scopeToolsOf(POLICY, { kind: 'template', ref: 'tpl-a' }), ['grep']);
	});

	it('模板没有独立档 / 没选中 ⇒ 空数组', () => {
		assert.deepEqual(scopeToolsOf(POLICY, { kind: 'template', ref: 'tpl-nope' }), []);
		assert.deepEqual(scopeToolsOf(POLICY, undefined), []);
	});
});

describe('editabilityOf：不能编辑时必须给原因', () => {
	it('没选中 ⇒ 先选一个', () => {
		const result = editabilityOf(undefined, [{ ref: 'tpl-a' }]);
		assert.equal(result.editable, false);
		assert.match(result.editable === false ? result.reason : '', /先在左栏选/);
	});

	it('模板已不在清单 ⇒ 明确说保存不进去', () => {
		const result = editabilityOf({ kind: 'template', ref: 'tpl-gone' }, [{ ref: 'tpl-a' }]);
		assert.equal(result.editable, false);
		assert.match(result.editable === false ? result.reason : '', /tpl-gone/);
	});

	it('档位与在册模板都可编辑', () => {
		assert.equal(editabilityOf({ kind: 'tier', key: 'common' }, []).editable, true);
		assert.equal(editabilityOf({ kind: 'template', ref: 'tpl-a' }, [{ ref: 'tpl-a' }]).editable, true);
	});
});

describe('diffOf / isNoopDiff', () => {
	it('只算增量与删除', () => {
		assert.deepEqual(diffOf(['a', 'b'], ['b', 'c']), { allow: ['c'], remove: ['a'] });
	});

	it('顺序无关：同一集合 ⇒ 空差集', () => {
		assert.deepEqual(diffOf(['a', 'b'], ['b', 'a']), { allow: [], remove: [] });
		assert.equal(isNoopDiff(diffOf(['a'], ['a'])), true);
		assert.equal(isNoopDiff(diffOf(['a'], ['a', 'b'])), false);
	});
});

describe('putBodyOf：PUT /api/tool-policy 的 body', () => {
	it('档位：unclaimed 原样、common → claimed', () => {
		assert.deepEqual(putBodyOf({ kind: 'tier', key: 'unclaimed' }, { allow: ['bash'], remove: [] }, POLICY.baseTools), {
			tier: 'unclaimed',
			allow: ['bash'],
			remove: [],
		});
		assert.deepEqual(putBodyOf({ kind: 'tier', key: 'common' }, { allow: [], remove: ['write'] }, POLICY.baseTools), {
			tier: 'claimed',
			allow: [],
			remove: ['write'],
		});
	});

	it('模板：templateRef 与 tier 二选一（这里只出现 templateRef）', () => {
		const body = putBodyOf({ kind: 'template', ref: 'tpl-a' }, { allow: ['grep'], remove: [] }, POLICY.baseTools);
		assert.deepEqual(body, { templateRef: 'tpl-a', allow: ['grep'], remove: [] });
		assert.equal(Object.hasOwn(body ?? {}, 'tier'), false);
	});

	it('BASE 不进 allow / remove（恒可用，不可移除）', () => {
		assert.deepEqual(
			putBodyOf({ kind: 'tier', key: 'common' }, { allow: ['read', 'write'], remove: ['taskboard_card'] }, POLICY.baseTools),
			{ tier: 'claimed', allow: ['write'], remove: [] },
		);
	});

	it('没有改动 / 只动了 BASE ⇒ undefined（不发请求）', () => {
		assert.equal(putBodyOf({ kind: 'tier', key: 'common' }, { allow: [], remove: [] }, POLICY.baseTools), undefined);
		assert.equal(putBodyOf({ kind: 'tier', key: 'common' }, { allow: ['read'], remove: ['read'] }, POLICY.baseTools), undefined);
	});
});

describe('pickerToolsOf / selectionKeyOf', () => {
	it('候选 = 宿主工具 ∪ 本档已配，去重排序（失效工具也还能取消勾选）', () => {
		assert.deepEqual(pickerToolsOf(['write', 'read'], ['gone-tool', 'read']), ['gone-tool', 'read', 'write']);
	});

	it('选中 key 稳定', () => {
		assert.equal(selectionKeyOf(undefined), 'none');
		assert.equal(selectionKeyOf({ kind: 'tier', key: 'common' }), 'tier:common');
		assert.equal(selectionKeyOf({ kind: 'template', ref: 'tpl-a' }), 'template:tpl-a');
	});
});
