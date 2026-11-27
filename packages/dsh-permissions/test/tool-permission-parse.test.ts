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
});
