/**
 * `parseToolList()` 的单测 —— `/api/tools` 响应的形状校验。
 *
 * ## 为什么它值得单测
 *
 * 这个函数在**网络边界**上：输入是 `unknown`（不可信），输出决定页面显示什么。
 * 它判错的方向有两种，代价不同：
 *
 * | 判错方向 | 后果 |
 * |---|---|
 * | 该接受却拒绝 ⇒ 降级到夹具 | 看得见（红色提示条），可接受 |
 * | 该拒绝却接受 ⇒ 显示垃圾 | 页面出现空白/`undefined` 行，**看不出原因** |
 *
 * ⇒ 所以这里重点钉**拒绝**的那条路。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseToolList } from '../src/pure/tool-permission.ts';

describe('parseToolList', () => {
	it('正常响应：投影成 {name, source}，丢掉 description/parameters', () => {
		const parsed = parseToolList({
			tools: [
				{ name: 'taskboard_update', description: '改卡', parameters: { type: 'object' } },
				{ name: 'bash', description: 'shell' },
			],
		});
		assert.deepEqual(parsed, [
			{ name: 'taskboard_update', source: '任务板' },
			{ name: 'bash', source: '宿主' },
		]);
	});

	it('来源按前缀判定：taskboard_ 是任务板，其余是宿主', () => {
		const parsed = parseToolList({ tools: [{ name: 'taskboard_tool_policy' }, { name: 'working_directory' }] });
		assert.deepEqual(parsed, [
			{ name: 'taskboard_tool_policy', source: '任务板' },
			{ name: 'working_directory', source: '宿主' },
		]);
	});

	it('不是对象 ⇒ undefined（调用方据此降级）', () => {
		assert.equal(parseToolList(null), undefined);
		assert.equal(parseToolList('nope'), undefined);
		assert.equal(parseToolList(42), undefined);
	});

	it('没有 tools 数组 ⇒ undefined', () => {
		assert.equal(parseToolList({}), undefined);
		assert.equal(parseToolList({ tools: 'not-an-array' }), undefined);
		assert.equal(parseToolList({ tools: null }), undefined);
	});

	it('空数组 ⇒ undefined（0 个工具在真实 DSH 里不成立，多半打错路由了）', () => {
		assert.equal(parseToolList({ tools: [] }), undefined);
	});

	it('脏条目：跳过而不是整体失败（一个坏的不该让整页降级）', () => {
		const parsed = parseToolList({
			tools: [null, 7, { name: '' }, { name: 42 }, { name: 'bash' }, { noName: true }],
		});
		assert.deepEqual(parsed, [{ name: 'bash', source: '宿主' }]);
	});

	it('全是脏条目 ⇒ undefined', () => {
		assert.equal(parseToolList({ tools: [null, { name: '' }, { name: 1 }] }), undefined);
	});

	/*
	 * issue #55：用户实测 `GET /api/tools` 返回 **53** 个工具。
	 * 「右栏工具不是全集」的第一嫌疑是客户端解析丢项 ⇒ 这里用 53 项的样本钉住
	 * 「进 53 出 53」。样本里的字段形状照宿主真实给的样子（name / description / parameters）。
	 */
	it('宿主实测样本 53 项 ⇒ 一个都不能少（issue #55）', () => {
		const TASKBOARD_NAMES = [
			'ask_user_question',
			'taskboard_adopt',
			'taskboard_card',
			'taskboard_cards',
			'taskboard_claim',
			'taskboard_create',
			'taskboard_definitions',
			'taskboard_raw_card',
			'taskboard_release',
			'taskboard_render_check',
			'taskboard_search',
			'taskboard_tool_policy',
			'taskboard_tool_policy_read',
			'taskboard_transition',
			'taskboard_update',
			'taskboard_update_note',
			'taskboard_workspaces',
		];
		const HOST_NAMES = [
			'apply_patch',
			'bash',
			'code_search',
			'cordis_inspect',
			'cordis_inspect_config',
			'cordis_inspect_context',
			'create_goal',
			'edit',
			'exit_plan_mode',
			'get_goal',
			'glob',
			'grep',
			'job_kill',
			'job_list',
			'job_output',
			'list_agents',
			'list_resources',
			'pwsh',
			'read',
			'read_image',
			'read_resource',
			'screenshot',
			'send_message',
			'update_goal',
			'wait_agent',
			'web_fetch',
			'web_search',
			'workflow',
			'write',
			'write_files',
			'workspace_create',
			'workspace_list',
			'workspace_open',
			'workspace_send',
			'workspace_watch',
			'agent_send',
		];
		const names = [...TASKBOARD_NAMES, ...HOST_NAMES];
		assert.equal(names.length, 53, '样本本身就是 53 项');
		assert.equal(new Set(names).size, 53, '样本没有重名');

		const parsed = parseToolList({
			tools: names.map((name) => ({ name, description: `${name} 的说明`, parameters: { type: 'object' } })),
		});
		assert.ok(parsed !== undefined);
		assert.equal(parsed.length, 53);
		assert.deepEqual(
			parsed.map((one) => one.name),
			names,
			'顺序也不动（右栏按名字排序是组件的事，解析不应该重排）',
		);
		for (const entry of parsed) {
			assert.equal(entry.source, entry.name.startsWith('taskboard_') ? '任务板' : '宿主', entry.name);
		}
	});

	it('53 项外再混进一个坏条目 ⇒ 仍是 53 项，而不是整体失败', () => {
		const names = Array.from({ length: 53 }, (_, index) => `tool_${String(index)}`);
		const parsed = parseToolList({
			tools: [...names.map((name) => ({ name })), { description: '没有 name' }],
		});
		assert.equal(parsed?.length, 53);
	});
});
