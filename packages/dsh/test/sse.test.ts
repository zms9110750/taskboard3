/**
 * SSE 端点测试 —— 三条不泄漏的验收。
 *
 * ## 测什么、不测什么
 *
 * 测试用**假 response**（收集 `write` / `end` 调用 + 手动触发 `close`），
 * 不起真 http server。这样测的是**连接生命周期的账**：
 *
 * | 断言 | 证明什么 |
 * |---|---|
 * | 订阅后写卡 ⇒ 收到帧 | 转发链路通 |
 * | 客户端断开 ⇒ `bus.size()` 减少 | 退订没漏 |
 * | `closeAll()` ⇒ 所有 `res.end()` + `bus.size()` 归零 | 卸载没漏 |
 * | 鉴权拒绝 ⇒ 不订阅、不发帧 | 拒绝的路径不建连接 |
 *
 * ⚠ **`bus.size()` 恒等于活跃连接数** 是本文件的中心不变量
 *   （一条连接一个订阅，见 `src/sse.ts` 文件头）。所有断言都靠它。
 *
 * ⚠ 这些测试**跟 `core/src/bus.ts` 一起删**（原型期脚手架）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBus, type Card, type TaskboardMessage } from '@taskboard/core';

import { createSseHub, encodeFrame, type SseResponseLike } from '../src/sse.ts';
import type { IncomingLike } from '../src/types.ts';

/* ────────────────────────────── 测试替身 ────────────────────────────── */

/** 一条假响应：记录写进来的东西，可手动触发 `close`。 */
interface FakeResponse extends SseResponseLike {
	/*
	 * ⚠ 这里是**可变**的 `string[]`，不是 `readonly string[]`：
	 *   测试里要自己 `flaky.frames.push(...)` 记录写入（L351），
	 *   用只读类型会让那个「第 2 次写入抛错」的用例没法布置。
	 *   `readonly` 的防线在**产品代码**的 `SseResponseLike` 上，不在测试替身上。
	 */
	readonly frames: string[];
	readonly headers: Readonly<Record<string, string>>;
	readonly status: () => number;
	readonly ended: () => boolean;
	/** 模拟客户端断开（server 发的 `close` 事件）。 */
	readonly emitClose: () => void;
}

function makeRes(): FakeResponse {
	const frames: string[] = [];
	const headers: Record<string, string> = {};
	const listeners: (() => void)[] = [];
	let statusCode = 200;
	let ended = false;

	return {
		get statusCode() {
			return statusCode;
		},
		set statusCode(value: number) {
			statusCode = value;
		},
		setHeader(name: string, value: string) {
			headers[name.toLowerCase()] = value;
			return undefined;
		},
		write(chunk: string) {
			frames.push(chunk);
			return true;
		},
		end() {
			ended = true;
			return undefined;
		},
		on(event: 'close', listener: () => void) {
			if (event === 'close') listeners.push(listener);
			return undefined;
		},
		frames,
		headers,
		status: () => statusCode,
		ended: () => ended,
		emitClose: () => {
			for (const listener of listeners) listener();
		},
	};
}

/** 造一个请求。 */
function makeReq(workspaceId = ''): IncomingLike {
	return {
		method: 'GET',
		url: workspaceId === '' ? '/taskboard3/api/events' : `/taskboard3/api/events?workspace=${workspaceId}`,
		headers: { host: '127.0.0.1:3000' },
	};
}

/** 一张假卡（SSE 只转发，不读卡的内容 —— 所以最少的字段就够）。 */
function fakeCard(id: string): Card {
	return {
		id,
		title: `卡 ${id}`,
		status: 'TASK_STATE_SUBMITTED',
		template: { ref: 'demo', kind: 'work', domain: '核心' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: 0,
		adoptedAt: null,
		history: [],
		deleted: false,
		holders: [],
		/* 卡上的未读字段（`card.ts` 的 `CardUnread`）—— 夹具漏了，tsc 报 TS2741。 */
		unread: { ai: false, user: false },
	};
}

/** 造一条 bus 消息。 */
function fakeMessage(workspaceId: string, cardIds: readonly string[] = []): TaskboardMessage {
	return { type: 'card:written', workspaceId, cards: cardIds.map(fakeCard) };
}

/** 从一帧里解出负载。 */
function payloadOf(frame: string): unknown {
	assert.ok(frame.startsWith('data: '), `帧应以 'data: ' 开头：${frame}`);
	assert.ok(frame.endsWith('\n\n'), `帧应以两个换行结尾：${frame}`);
	return JSON.parse(frame.slice('data: '.length, -2)) as unknown;
}

/* ────────────────────────────── 用例 ────────────────────────────── */

describe('SSE 帧格式', () => {
	it('encodeFrame 产出标准 SSE 单行数据帧', () => {
		const frame = encodeFrame({ kind: 'hello', at: 1, workspaceId: 'ws' });
		assert.equal(frame, 'data: {"kind":"hello","at":1,"workspaceId":"ws"}\n\n');
	});

	it('帧里不含裸换行（JSON.stringify 转义过）', () => {
		const frame = encodeFrame({
			kind: 'bus',
			message: fakeMessage('ws'),
		});
		const body = frame.slice('data: '.length, -2);
		assert.ok(!body.includes('\n'), `body 不该含换行：${body}`);
		assert.ok(!body.includes('\r'), `body 不该含回车：${body}`);
	});
});

describe('连接生命周期', () => {
	it('open 写 SSE 头 + 先发 hello 帧', () => {
		const bus = createBus();
		const hub = createSseHub(bus, { now: () => 123 });
		const res = makeRes();

		hub.open(makeReq('ws1'), res);

		assert.equal(res.status(), 200);
		assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
		assert.equal(res.headers['cache-control'], 'no-cache');
		assert.equal(res.headers['connection'], 'keep-alive');
		/* 第一帧是 hello。 */
		assert.equal(res.frames.length, 1);
		const hello = payloadOf(res.frames[0] ?? '') as { kind: string; at: number; workspaceId: string };
		assert.equal(hello.kind, 'hello');
		assert.equal(hello.at, 123);
		assert.equal(hello.workspaceId, 'ws1');
		/* 已订阅。 */
		assert.equal(bus.size(), 1);
		assert.equal(hub.count(), 1);
	});

	it('订阅后写卡 ⇒ 收到 bus 帧', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		const res = makeRes();
		hub.open(makeReq('ws1'), res);
		const afterHello = res.frames.length;

		/* 写卡 ⇒ core 会 emit（这里直接 emit，模拟 core 的行为）。 */
		bus.emit(fakeMessage('ws1', ['GU01']));

		assert.equal(res.frames.length, afterHello + 1);
		const payload = payloadOf(res.frames[res.frames.length - 1] ?? '') as {
			kind: string;
			message: TaskboardMessage;
		};
		assert.equal(payload.kind, 'bus');
		assert.equal(payload.message.type, 'card:written');
		assert.equal(payload.message.workspaceId, 'ws1');
		assert.deepEqual(
			payload.message.cards.map((one) => one.id),
			['GU01'],
		);
	});

	it('?workspace= 只转发该空间的消息', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		const res = makeRes();
		hub.open(makeReq('ws1'), res);
		const afterHello = res.frames.length;

		bus.emit(fakeMessage('ws2', ['GU02']));
		assert.equal(res.frames.length, afterHello, '别的空间的消息不该转发');

		bus.emit(fakeMessage('ws1', ['GU01']));
		assert.equal(res.frames.length, afterHello + 1, '本空间的消息该转发');
	});

	it('不带 ?workspace= ⇒ 转发全部空间', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		const res = makeRes();
		hub.open(makeReq(''), res);
		const afterHello = res.frames.length;

		bus.emit(fakeMessage('ws1'));
		bus.emit(fakeMessage('ws2'));
		assert.equal(res.frames.length, afterHello + 2);
	});
});

describe('不泄漏：客户端断开', () => {
	it('res 触发 close ⇒ 退订 + 从集合移除', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		const res = makeRes();
		hub.open(makeReq('ws1'), res);
		assert.equal(bus.size(), 1);
		assert.equal(hub.count(), 1);

		res.emitClose();

		assert.equal(bus.size(), 0, '断开后应退订');
		assert.equal(hub.count(), 0, '断开后应从集合移除');
		/* 断开时不该再写帧。 */
		const framesAfterClose = res.frames.length;
		bus.emit(fakeMessage('ws1'));
		assert.equal(res.frames.length, framesAfterClose, '断开后不该再写帧');
	});

	it('重复触发 close 不重复退订（幂等）', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		const res = makeRes();
		hub.open(makeReq('ws1'), res);

		res.emitClose();
		res.emitClose();
		res.emitClose();

		assert.equal(bus.size(), 0);
		assert.equal(hub.count(), 0);
	});

	it('多条连接：断开一条，其它不受影响', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		const a = makeRes();
		const b = makeRes();
		hub.open(makeReq('ws1'), a);
		hub.open(makeReq('ws1'), b);
		assert.equal(bus.size(), 2);

		a.emitClose();

		assert.equal(bus.size(), 1);
		assert.equal(hub.count(), 1);

		/* b 还能收到帧。 */
		const beforeB = b.frames.length;
		bus.emit(fakeMessage('ws1'));
		assert.equal(b.frames.length, beforeB + 1);
	});
});

describe('不泄漏：provider 卸载', () => {
	it('closeAll ⇒ 所有连接 res.end() + bus.size() 归零', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		const a = makeRes();
		const b = makeRes();
		const c = makeRes();
		hub.open(makeReq('ws1'), a);
		hub.open(makeReq('ws2'), b);
		hub.open(makeReq(''), c);
		assert.equal(bus.size(), 3);

		hub.closeAll();

		assert.equal(bus.size(), 0, '卸载后 bus 订阅应归零');
		assert.equal(hub.count(), 0, '卸载后连接集合应清空');
		assert.equal(a.ended(), true);
		assert.equal(b.ended(), true);
		assert.equal(c.ended(), true);
		assert.equal(hub.isClosed(), true);
	});

	it('closeAll 幂等', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		const res = makeRes();
		hub.open(makeReq('ws1'), res);

		hub.closeAll();
		hub.closeAll();

		assert.equal(bus.size(), 0);
		assert.equal(hub.count(), 0);
	});

	it('closeAll 之后 open ⇒ 直接关掉，不进集合', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		hub.closeAll();

		const res = makeRes();
		hub.open(makeReq('ws1'), res);

		assert.equal(res.ended(), true, '关闭后新连接应被关掉');
		assert.equal(hub.count(), 0, '关闭后不该长出新连接');
		assert.equal(bus.size(), 0, '关闭后不该订阅');
		assert.equal(res.frames.length, 0, '关闭后不该发帧');
	});

	it('关闭后再 emit 不抛、不写帧', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		const res = makeRes();
		hub.open(makeReq('ws1'), res);
		const framesBefore = res.frames.length;

		hub.closeAll();
		bus.emit(fakeMessage('ws1'));

		assert.equal(res.frames.length, framesBefore, '关闭后不该再写帧');
	});
});

describe('不泄漏：写失败当断开处理', () => {
	it('连上之后 write 开始抛错 ⇒ 该连接被清理，其它连接不受影响', () => {
		const bus = createBus();
		const hub = createSseHub(bus);

		/*
		 * 一条**先成功、后失败**的响应：hello 写成功（连接建立），
		 * 之后的帧写失败（模拟 socket 在连接建立后断开）。
		 *
		 * ⚠ 不能一开始就抛 —— 那样 hello 就失败了，连接根本不会建立
		 *   （这条路径由下一条用例单独测）。
		 */
		const flaky = makeRes();
		let writes = 0;
		const flakyRes: SseResponseLike = {
			...flaky,
			write(chunk: string) {
				writes += 1;
				/* 第 1 次（hello）成功；之后抛。 */
				if (writes > 1) throw new Error('ERR_STREAM_WRITE_AFTER_END');
				flaky.frames.push(chunk);
				return true;
			},
		};
		hub.open(makeReq('ws1'), flakyRes);

		const ok = makeRes();
		hub.open(makeReq('ws1'), ok);
		assert.equal(bus.size(), 2, '两条都连上了');

		/* emit 一次：flaky 写失败被清理，ok 正常收到。 */
		bus.emit(fakeMessage('ws1'));

		assert.equal(bus.size(), 1, '坏连接应被清理');
		assert.equal(hub.count(), 1);

		/* ok 还能继续收到后续帧。 */
		const beforeOk = ok.frames.length;
		bus.emit(fakeMessage('ws1'));
		assert.equal(ok.frames.length, beforeOk + 1, '好连接不受坏连接影响');
	});

	it('hello 帧写失败 ⇒ 连接根本不该进集合', () => {
		const bus = createBus();
		const hub = createSseHub(bus);

		const broken = makeRes();
		let ended = false;
		const brokenRes: SseResponseLike = {
			...broken,
			write() {
				throw new Error('socket closed');
			},
			end() {
				ended = true;
				return undefined;
			},
		};
		hub.open(makeReq('ws1'), brokenRes);

		/*
		 * ⚠ 这是「先写 hello 再订阅」那条顺序的守卫：
		 *   若将来有人把订阅提到 hello 之前，hello 失败就会留下一个
		 *   「订阅着但客户端已断」的泄漏 ⇒ 这里会变成 1。
		 */
		assert.equal(bus.size(), 0, 'hello 写失败时不该留下订阅');
		assert.equal(hub.count(), 0);
		assert.equal(ended, true, 'hello 写失败时应关掉响应');
	});
});

describe('鉴权（由路由层负责，这里验 hub 不会被调用）', () => {
	it('没有 open 调用 ⇒ 无连接、无订阅、无帧', () => {
		const bus = createBus();
		const hub = createSseHub(bus);
		/* 路由层在鉴权失败时直接 return，根本不会调 hub.open。 */
		assert.equal(hub.count(), 0);
		assert.equal(bus.size(), 0);
	});
});
