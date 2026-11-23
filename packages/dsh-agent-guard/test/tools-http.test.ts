/**
 * `handleToolsRequest` 的测试 —— 同步路径、异步路径、失败降级、鉴权。
 *
 * 重点：**异步枚举不能把响应写坏**（同步返回 `true` 之后才 `res.end()`），
 * 而且枚举失败也**不许 500**。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TOOLS_TAIL, handleToolsRequest } from '../src/http.ts';

/** 假响应：记下状态码与 body。 */
interface FakeRes {
	statusCode: number;
	readonly headers: Record<string, string>;
	body: string | undefined;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
}

/** 造一个假响应。 */
function fakeRes(): FakeRes {
	return {
		statusCode: 0,
		headers: {},
		body: undefined,
		setHeader(name: string, value: string): void {
			this.headers[name] = value;
		},
		end(body?: string): void {
			this.body = body;
		},
	};
}

/** 放行的连接（不鉴权拒绝）。 */
const allowConnection = { requestRejection: (): undefined => undefined };
/** 拒绝的连接。 */
const denyConnection = { requestRejection: (): 401 => 401 };

/** 等一轮微任务（让 fire-and-forget 的 then 跑完）。 */
const tick = async (): Promise<void> => {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
};

/** 解析响应体。 */
function bodyOf(res: FakeRes): { tools: readonly { name: string; description: string }[] } {
	assert.equal(typeof res.body, 'string');
	return JSON.parse(res.body as string) as { tools: readonly { name: string; description: string }[] };
}

describe('handleToolsRequest', () => {
	it('TOOLS_TAIL 是 /api/tools', () => {
		assert.equal(TOOLS_TAIL, '/api/tools');
	});

	it('同步 listTools ⇒ 当场写响应', () => {
		const res = fakeRes();
		const handled = handleToolsRequest(allowConnection, { method: 'GET', headers: {} }, res, () => [
			{ name: 'bash', description: 'shell', parameters: {} },
		]);
		assert.equal(handled, true);
		assert.equal(res.statusCode, 200);
		assert.deepEqual(
			bodyOf(res).tools.map((one) => one.name),
			['bash'],
		);
	});

	it('异步 listTools ⇒ 立刻返回 true，响应稍后写完', async () => {
		const res = fakeRes();
		const handled = handleToolsRequest(allowConnection, { method: 'GET', headers: {} }, res, async () => [
			{ name: 'read', description: 'read a file', parameters: {} },
		]);
		assert.equal(handled, true);
		/* fire-and-forget：这一瞬间还没写 */
		assert.equal(res.body, undefined);
		await tick();
		assert.equal(res.statusCode, 200);
		assert.deepEqual(
			bodyOf(res).tools.map((one) => one.name),
			['read'],
		);
	});

	it('异步 listTools 抛 ⇒ 仍然 200 + 空清单（不 500）', async () => {
		const res = fakeRes();
		handleToolsRequest(allowConnection, { method: 'GET', headers: {} }, res, async () => {
			throw new Error('枚举炸了');
		});
		await tick();
		assert.equal(res.statusCode, 200);
		assert.deepEqual(bodyOf(res).tools, []);
	});

	it('鉴权拒绝 ⇒ 401，不取清单', () => {
		const res = fakeRes();
		let asked = false;
		handleToolsRequest(denyConnection, { method: 'GET', headers: {} }, res, () => {
			asked = true;
			return [];
		});
		assert.equal(res.statusCode, 401);
		assert.equal(asked, false);
	});

	it('非 GET ⇒ 405', () => {
		const res = fakeRes();
		handleToolsRequest(allowConnection, { method: 'POST', headers: {} }, res, () => []);
		assert.equal(res.statusCode, 405);
	});

	it('只保留 name / description / parameters 三字段', () => {
		const res = fakeRes();
		handleToolsRequest(allowConnection, { method: 'GET', headers: {} }, res, () => [
			{ name: 'bash', description: 'shell', parameters: { type: 'object' }, secret: 'internal' },
		]);
		const one = bodyOf(res).tools[0];
		assert.deepEqual(Object.keys(one ?? {}).sort(), ['description', 'name', 'parameters']);
		assert.equal(
			Object.prototype.hasOwnProperty.call(one ?? {}, 'secret'),
			false,
			'内部字段不该漏到 UI',
		);
	});
});
