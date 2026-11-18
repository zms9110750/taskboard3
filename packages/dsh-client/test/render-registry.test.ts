/**
 * 渲染器注册表的单测。
 *
 * ## 为什么这个文件值得存在
 *
 * 注册表的每个"坏行为"都不会报错，只会表现成**界面不对**：
 *
 * | bug | 表现 |
 * |---|---|
 * | 重复注册静默覆盖 | 某个 action 用别人的组件画 ⇒ 内容看着像、其实错 |
 * | 封盘后还能注册 | ① 的警告结论过期 ⇒ 漏报「缺渲染器」 |
 * | 空 type 能注册 | payload 缺 `$type` 的章节误命中一个渲染器，**本该报错却假装正常** |
 * | `registeredTypes()` 顺序不稳 | ① 的日志两次启动不一样；测试快照全漂 |
 *
 * ⇒ 每一条都用一个 `it` 钉住，而不是"实现完看着没问题"。
 *
 * ## 不 import react-dom
 *
 * 渲染器是**普通函数**（`(props) => ReactNode`）。测试只需要构造 `() => null`
 * 这种合法 JS 函数，不需要 React 运行时。`ReactNode` 只是类型，被 Node 的
 * 类型剥离器抹掉。
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
	__resetRegistryForTest,
	isSealed,
	registerRenderer,
	registeredTypes,
	rendererOf,
	sealRegistry,
	type RendererComponent,
} from '../src/render-registry.ts';

/** 造一个假渲染器（内容是空的，注册表只管"是谁"，不管"画什么"）。 */
function fake(): RendererComponent {
	return () => null;
}

/* ══════════════════════════════════════════════════════════
   每个用例前清空 —— 否则封盘不可逆，第二个 it 就没法注册
   ══════════════════════════════════════════════════════════ */

beforeEach(() => {
	__resetRegistryForTest();
});

describe('registerRenderer / rendererOf —— 基本存取', () => {
	it('注册后能查回来（是同一个函数引用）', () => {
		const Comp = fake();
		registerRenderer('text', Comp);
		assert.equal(rendererOf('text'), Comp);
	});

	it('未注册的 type ⇒ undefined（不是 null、不抛）', () => {
		assert.equal(rendererOf('nope'), undefined);
	});

	it('大小写敏感 —— `Text` 和 `text` 是两个键', () => {
		registerRenderer('text', fake());
		assert.equal(rendererOf('Text'), undefined);
	});

	it('⚠ 用 Map 不用普通对象 —— `__proto__` 不会污染原型', () => {
		const Comp = fake();
		registerRenderer('__proto__', Comp);
		assert.equal(rendererOf('__proto__'), Comp);
		/* 普通对象上 `obj['__proto__'] = fn` 会改原型；Map 不会。 */
		assert.equal(Object.getPrototypeOf({}), Object.prototype);
	});
});

describe('registerRenderer —— 重复注册必须抛', () => {
	it('⚠ 同名注册两次 ⇒ 抛（不是静默覆盖）', () => {
		registerRenderer('markdown', fake());
		const first = rendererOf('markdown');

		assert.throws(
			() => {
				registerRenderer('markdown', fake());
			},
			/重复注册/,
		);

		/* 抛了之后**原来那个还在**，没被换掉。 */
		assert.equal(rendererOf('markdown'), first);
	});

	it('抛错信息里带 type 名（否则报错时不知道是哪个）', () => {
		registerRenderer('ask', fake());
		assert.throws(
			() => {
				registerRenderer('ask', fake());
			},
			/ask/,
		);
	});

	it('不同 type 各自独立', () => {
		const A = fake();
		const B = fake();
		registerRenderer('text', A);
		registerRenderer('markdown', B);
		assert.equal(rendererOf('text'), A);
		assert.equal(rendererOf('markdown'), B);
	});
});

describe('registerRenderer —— type 校验', () => {
	it('⚠ 空串 ⇒ 抛（否则「payload 缺 $type」会误命中）', () => {
		assert.throws(
			() => {
				registerRenderer('', fake());
			},
			/不能是空白/,
		);
	});

	it('⚠ 纯空白 ⇒ 抛（三个空格和空串一样坏）', () => {
		assert.throws(
			() => {
				registerRenderer('   ', fake());
			},
			/不能是空白/,
		);
	});

	it('抛错后注册表仍然是空的（没留半注册状态）', () => {
		assert.throws(() => {
			registerRenderer('', fake());
		});
		assert.deepEqual(registeredTypes(), []);
	});

	it('前后带空格但不是全空白 ⇒ 合法（不 trim，原样做键）', () => {
		/* 这不是推荐写法，但 registerRenderer 不该替调用方猜意图。 */
		registerRenderer(' text ', fake());
		assert.equal(rendererOf(' text ') !== undefined, true);
		assert.equal(rendererOf('text'), undefined);
	});
});

describe('registeredTypes —— 排序稳定', () => {
	it('空表 ⇒ 空数组', () => {
		assert.deepEqual(registeredTypes(), []);
	});

	it('⚠ 字母序，与注册顺序无关', () => {
		registerRenderer('text', fake());
		registerRenderer('ask', fake());
		registerRenderer('markdown', fake());
		assert.deepEqual(registeredTypes(), ['ask', 'markdown', 'text']);
	});

	it('⚠ 换个注册顺序，结果一样（这条是①日志可读性的保证）', () => {
		registerRenderer('markdown', fake());
		registerRenderer('text', fake());
		registerRenderer('ask', fake());
		assert.deepEqual(registeredTypes(), ['ask', 'markdown', 'text']);
	});

	it('两次调用返回不同的数组实例（调用方改了不影响注册表）', () => {
		registerRenderer('text', fake());
		const a = registeredTypes();
		const b = registeredTypes();
		assert.notEqual(a, b);
		assert.deepEqual(a, b);

		/* `a` 是 readonly 类型，但运行时是普通数组 —— 强改一个，注册表不受影响。 */
		(a as string[]).push('hacked');
		assert.deepEqual(registeredTypes(), ['text']);
	});

	it('查出来的钟表 = 注册的钟表', () => {
		registerRenderer('text', fake());
		registerRenderer('ask', fake());
		assert.deepEqual(registeredTypes(), [...registeredTypes()].sort());
	});
});

describe('sealRegistry —— 封盘', () => {
	it('未封盘时 isSealed() === false', () => {
		assert.equal(isSealed(), false);
	});

	it('⚠ 封盘后注册 ⇒ 抛', () => {
		registerRenderer('text', fake());
		sealRegistry();
		assert.throws(
			() => {
				registerRenderer('markdown', fake());
			},
			/已封盘/,
		);
	});

	it('⚠ 封盘不影响已注册的（查询照常）', () => {
		const Comp = fake();
		registerRenderer('text', Comp);
		sealRegistry();
		assert.equal(rendererOf('text'), Comp);
		assert.deepEqual(registeredTypes(), ['text']);
	});

	it('封盘幂等 —— 调两次不抛（插件重载时不该报错）', () => {
		sealRegistry();
		assert.doesNotThrow(() => {
			sealRegistry();
		});
		assert.equal(isSealed(), true);
	});

	it('⚠ 封盘后**重复注册**报的是「已封盘」而不是「重复」（顺序对）', () => {
		/* 两条校验都在，先撞哪条要稳定 —— 否则报错信息随实现微调而变。 */
		registerRenderer('text', fake());
		sealRegistry();
		assert.throws(
			() => {
				registerRenderer('text', fake());
			},
			/已封盘/,
		);
	});
});

describe('__resetRegistryForTest —— 清空 + 解封', () => {
	it('清空已注册的', () => {
		registerRenderer('text', fake());
		__resetRegistryForTest();
		assert.deepEqual(registeredTypes(), []);
		assert.equal(rendererOf('text'), undefined);
	});

	it('⚠ 解封（否则同一个测试文件里的后续用例没法再注册）', () => {
		sealRegistry();
		__resetRegistryForTest();
		assert.equal(isSealed(), false);
		assert.doesNotThrow(() => {
			registerRenderer('text', fake());
		});
	});

	it('反复重置无副作用', () => {
		__resetRegistryForTest();
		__resetRegistryForTest();
		assert.deepEqual(registeredTypes(), []);
		assert.equal(isSealed(), false);
	});
});

describe('⚠ 三个时刻的契约（注册表这一侧）', () => {
	it('① 的数据源：registeredTypes() 在任何时候都能调（封盘前后都一样）', () => {
		registerRenderer('text', fake());
		const before = registeredTypes();
		sealRegistry();
		assert.deepEqual(registeredTypes(), before);
	});

	it('③ 的判据：rendererOf 返回 undefined ⇒ 调用方该报错（注册表不替它报）', () => {
		/* 注册表**不写日志、不抛 ③** —— 那是调用方的事。
		 * 这样它才能被单测覆盖，且不产生测试期的噪音日志。 */
		assert.equal(rendererOf('unregistered'), undefined);
	});

	it('④ 兜底不依赖注册表（空表也能工作 —— 兜底是 core 的职责）', () => {
		assert.deepEqual(registeredTypes(), []);
		assert.equal(isSealed(), false);
	});
});
