/**
 * wire DTO ↔ core 领域类型的 **schema parity** 测试。
 *
 * ## 为什么需要它
 *
 * `src/types.ts` 是手抄的 core 形状 —— 浏览器不能 import core（它会
 * `import 'node:sqlite'`，bundler 解析就炸）。抄错一个字段名**不会编译报错**：
 * JSON 多字段 / 少字段都不检查，界面只表现为一块空白，没有任何异常。
 *
 * 本文件把「抄得对不对」变成**编译错误**或**测试红**，两条腿：
 *
 * 1. **编译期双向 assignability**
 *    - `core → wire`：core 的 `Card` / `Workspace` / … 必须能直接赋给 wire 类型。
 *      core 多给的字段允许通过（wire 是 core 的**结构子集**）；
 *    - `wire → core` 的**逐字段存在性**：wire 的每个键都必须能在 core 的对应
 *      类型里找到同名键。反向差集（core 有、wire 没有）只允许落在下面
 *      「已知收窄」清单里 —— core 再删/改名/加字段都会让差集断言编译失败。
 * 2. **运行期固定样例 JSON**：一份照 `core/src/card.ts` 逐字段写的卡，
 *    `JSON.stringify` → `JSON.parse`（就是 HTTP 那条真实路径），断言解析回来
 *    能赋给 wire 的 `Card`，且样例覆盖 wire `Card` 的每一个键。
 *
 * ⚠ **这是它存在的意义**：core 以后给 `Card` 加字段（或改名）而 wire 没跟上，
 *   本文件的差集断言会**编译失败**。不要用 `any` / 放宽断言把它绕过去。
 *
 * ## 已知收窄（core 有、wire 故意没有；core 改了这里必须同步）
 *
 * | 子形状 | wire 缺的字段 | 为什么不传 |
 * |---|---|---|
 * | `HistoryEntry` | `actor`（谁引发的这条事件） | 卡详情的历史列表只显示时间 + action 文案，不显示作者 |
 * | `TemplateSummary` | `codePrefix`（编号字母段） | 模板选择器只显示模板名；编号由服务端在建卡时发 |
 *
 * TODO(审查): 这两条是「wire 是结构子集」的**现状记录**，不是「它们永远不该有」。
 * 若 UI 要显示「历史作者」或「模板编号前缀」，**wire 补字段需产品决定**；
 * 补字段时把对应差集断言的已知清单改成 `never`（并删掉本表对应行）。
 *
 * ## 为什么 `Workspace` / `TemplateSummary` 用 `Taskboard` 的返回类型取
 *
 * `@taskboard/core` 的入口按名字导出了 `Card` / `HistoryEntry` 等，但
 * `Workspace`、`TemplateSummary` 只出现在 `Taskboard` 的公开方法签名里。
 * 用 `ReturnType<Taskboard['listWorkspaces']>[number]` 取到的是**同一份**类型，
 * 又不用走深路径 import（那会破坏包的 `exports` 约束）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
	Card as CoreCard,
	CardHolder as CoreCardHolder,
	CardSection as CoreCardSection,
	CardUnread as CoreCardUnread,
	HistoryEntry as CoreHistoryEntry,
	KindDef as CoreKindDef,
	RelationEntry as CoreRelationEntry,
	Relations as CoreRelations,
	Taskboard,
	TemplateRef as CoreTemplateRef,
} from '@taskboard/core';

import type {
	Card as WireCard,
	CardHolder as WireCardHolder,
	CardSection as WireCardSection,
	CardUnread as WireCardUnread,
	HistoryEntry as WireHistoryEntry,
	KindSummary as WireKindSummary,
	RelationEntry as WireRelationEntry,
	Relations as WireRelations,
	StateData as WireStateData,
	TemplateRef as WireTemplateRef,
	TemplateSummary as WireTemplateSummary,
	Workspace as WireWorkspace,
} from '../src/types.ts';

/* ══════════════════════════════════════════════════════════
 * 标准 type-test 手法
 * ══════════════════════════════════════════════════════════ */

/**
 * 严格相等（结构 + 可选性 + readonly）。`extends` 双向判等会放过
 * `{ a: string }` 与 `{ a: string; b?: number }`，这个函数签名比较不会。
 */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
	? true
	: false;

/** 断言位置：`Expect<false>` 直接编译失败。 */
type Expect<T extends true> = T;

/**
 * 运行期空转的断言函数 —— 类型检查发生在 `tsc`，这里只为让「测试文件能跑」
 * 本身也成为一条记录（`node --test` 下不会真的判类型）。
 */
const _assertType = <T extends true>(value: T): T => value;

/* core 没按名字导出的两个形状 —— 从 `Taskboard` 的公开返回类型取。 */
type CoreWorkspace = ReturnType<Taskboard['listWorkspaces']>[number];
type CoreTemplateSummary = ReturnType<Taskboard['listTemplates']>[number];

/* ── 差集断言：两个方向 ──
 *
 * 注意：`Equal<…>` 只能在**具体类型**上实例化 —— 写成泛型别名
 * `type MissingKeys<Core, Wire> = Expect<Equal<…>>` 时条件类型无法求值，
 * 会退化成 `boolean` 并报 TS2344。所以这里只算差集，断言放到每个用例处。
 */

/** wire 多出来的键（core 没有）—— 任何形状都不允许：那是拼错 / 臆造的字段。 */
type ExtraKeys<Core, Wire> = Exclude<keyof Wire, keyof Core>;

/**
 * core 有、wire 没有的键 —— 必须**恰好**等于已知收窄清单（默认空 = 一个都不能少）。
 *
 * 清单是已知收窄：多一个未知字段 ⇒ 红（core 加了字段没跟）；
 * core 把清单里的字段删了 ⇒ 也红（清单该删了，否则测试在撒谎）。
 */
type MissingKeys<Core, Wire> = Exclude<keyof Core, keyof Wire>;

/* ══════════════════════════════════════════════════════════
 * core → wire：可赋值（wire 是结构子集）
 * ══════════════════════════════════════════════════════════ */

const _coreCardToWire = (card: CoreCard): WireCard => card;
const _coreTemplateRefToWire = (ref: CoreTemplateRef): WireTemplateRef => ref;
const _coreRelationEntryToWire = (entry: CoreRelationEntry): WireRelationEntry => entry;
const _coreRelationsToWire = (relations: CoreRelations): WireRelations => relations;
const _coreSectionToWire = (section: CoreCardSection): WireCardSection => section;
const _coreHistoryEntryToWire = (entry: CoreHistoryEntry): WireHistoryEntry => entry;
const _coreHolderToWire = (holder: CoreCardHolder): WireCardHolder => holder;
const _coreUnreadToWire = (unread: CoreCardUnread): WireCardUnread => unread;
const _coreWorkspaceToWire = (workspace: CoreWorkspace): WireWorkspace => workspace;
const _coreKindToWire = (kind: CoreKindDef): WireKindSummary => kind;
const _coreTemplateSummaryToWire = (summary: CoreTemplateSummary): WireTemplateSummary => summary;

/* ══════════════════════════════════════════════════════════
 * wire → core：逐字段存在性（键集）
 * ══════════════════════════════════════════════════════════ */

/* Card 顶层必须一一对应：core 加字段而 wire 没跟 ⇒ 下面这行红。 */
type _CardNoExtra = Expect<Equal<ExtraKeys<CoreCard, WireCard>, never>>;
type _CardNoMissing = Expect<Equal<MissingKeys<CoreCard, WireCard>, never>>;

type _TemplateRefNoExtra = Expect<Equal<ExtraKeys<CoreTemplateRef, WireTemplateRef>, never>>;
type _TemplateRefNoMissing = Expect<Equal<MissingKeys<CoreTemplateRef, WireTemplateRef>, never>>;

type _RelationEntryNoExtra = Expect<
	Equal<ExtraKeys<CoreRelationEntry, WireRelationEntry>, never>
>;
type _RelationEntryNoMissing = Expect<
	Equal<MissingKeys<CoreRelationEntry, WireRelationEntry>, never>
>;

type _RelationsNoExtra = Expect<Equal<ExtraKeys<CoreRelations, WireRelations>, never>>;
type _RelationsNoMissing = Expect<Equal<MissingKeys<CoreRelations, WireRelations>, never>>;

type _SectionNoExtra = Expect<Equal<ExtraKeys<CoreCardSection, WireCardSection>, never>>;
type _SectionNoMissing = Expect<Equal<MissingKeys<CoreCardSection, WireCardSection>, never>>;

/* 已知收窄：wire 故意不传 `actor`（见文件头表）。core 再加字段 ⇒ 红。 */
type _HistoryNoExtra = Expect<Equal<ExtraKeys<CoreHistoryEntry, WireHistoryEntry>, never>>;
type _HistoryKnownNarrowing = Expect<
	Equal<MissingKeys<CoreHistoryEntry, WireHistoryEntry>, 'actor'>
>;

type _HolderNoExtra = Expect<Equal<ExtraKeys<CoreCardHolder, WireCardHolder>, never>>;
type _HolderNoMissing = Expect<Equal<MissingKeys<CoreCardHolder, WireCardHolder>, never>>;

type _UnreadNoExtra = Expect<Equal<ExtraKeys<CoreCardUnread, WireCardUnread>, never>>;
type _UnreadNoMissing = Expect<Equal<MissingKeys<CoreCardUnread, WireCardUnread>, never>>;

type _WorkspaceNoExtra = Expect<Equal<ExtraKeys<CoreWorkspace, WireWorkspace>, never>>;
type _WorkspaceNoMissing = Expect<Equal<MissingKeys<CoreWorkspace, WireWorkspace>, never>>;

type _KindNoExtra = Expect<Equal<ExtraKeys<CoreKindDef, WireKindSummary>, never>>;
type _KindNoMissing = Expect<Equal<MissingKeys<CoreKindDef, WireKindSummary>, never>>;

/* 已知收窄：wire 故意不传 `codePrefix`（见文件头表）。 */
type _TemplateSummaryNoExtra = Expect<
	Equal<ExtraKeys<CoreTemplateSummary, WireTemplateSummary>, never>
>;
type _TemplateSummaryKnownNarrowing = Expect<
	Equal<MissingKeys<CoreTemplateSummary, WireTemplateSummary>, 'codePrefix'>
>;

/**
 * `StateData` 在 core 里**没有同名类型** —— 服务端在 `dsh/src/http.ts` 的
 * `/api/state` 处现场拼响应。这里用 `Taskboard` 的公开返回类型拼出 wire 关心的
 * 那几个字段，让每个字段都有 core 侧的来源可查。
 *
 * ⚠ 服务端还会多给一个 `templateErrors`（wire 不读）—— 那是允许的额外字段，
 *   和 core 的 `Card` 多给字段同理，不进这个参照形状。
 */
interface CoreStateData {
	readonly workspaceId: string;
	readonly workspaces: ReturnType<Taskboard['listWorkspaces']>;
	readonly cards: ReturnType<Taskboard['list']>;
	readonly templates: ReturnType<Taskboard['listTemplates']>;
	readonly kinds?: ReturnType<ReturnType<Taskboard['kinds']>['list']>;
}

const _coreStateDataToWire = (data: CoreStateData): WireStateData => data;

type _StateDataNoExtra = Expect<Equal<ExtraKeys<CoreStateData, WireStateData>, never>>;
type _StateDataNoMissing = Expect<Equal<MissingKeys<CoreStateData, WireStateData>, never>>;

/* ══════════════════════════════════════════════════════════
 * 运行期固定样例：照 core/src/card.ts 逐字段写的真卡
 * ══════════════════════════════════════════════════════════ */

/**
 * 一份**最小的真实卡**（字段与 `core/src/card.ts` 的 `Card` 逐个对应）。
 *
 * `satisfies CoreCard` 保证样例本身是 core 里真实的卡：少字段、状态写错、
 * 关系边写成未知词都会编译失败。`JSON.stringify` 之后走的就是 HTTP 的真实路径
 * （可选且 `undefined` 的字段会真的消失 —— 和线上一样）。
 */
const SAMPLE_CARD = {
	id: 'G-W-0001',
	title: '写 wire parity 测试',
	status: 'TASK_STATE_WORKING',
	template: { ref: 'work', kind: 'work', domain: 'core' },
	relations: {
		parent: null,
		links: [{ label: 'dependsOn', to: 'G-W-0002' }],
	},
	sections: {
		goal: { label: '目标', payload: { text: '让漂移变成编译错误' } },
	},
	note: '固定样例，不要随手改。',
	createdAt: 1_764_000_000_000,
	adoptedAt: null,
	history: [
		{
			at: 1_764_000_000_000,
			action: 'create',
			actor: 'user',
			detail: { origin: 'user' },
		},
	],
	deleted: false,
	holders: [{ holder: 'session-abc', at: 1_764_000_100_000 }],
	unread: { ai: true, user: false },
} satisfies CoreCard;

/** 对象 → JSON 文本 → 解析。真实传输里多/少字段都不报错，这正是要钉的地方。 */
const SAMPLE_CARD_JSON = JSON.stringify(SAMPLE_CARD);

/**
 * 样例必须覆盖 wire `Card` 的**每一个**键。
 *
 * `satisfies readonly (keyof WireCard)[]` 只保证「列出来的都是真键」；
 * 下面的 `Equal` 再保证「一个都不少、也不多」。运行期再比一次 `Object.keys`，
 * 钉住 JSON 序列化后键真的在（比如把字段写成 `undefined` 会整个消失）。
 */
const SAMPLE_CARD_KEYS = [
	'adoptedAt',
	'createdAt',
	'deleted',
	'history',
	'holders',
	'id',
	'note',
	'relations',
	'sections',
	'status',
	'template',
	'title',
	'unread',
] as const satisfies readonly (keyof WireCard)[];

type _SampleCoversEveryCardKey = Expect<Equal<(typeof SAMPLE_CARD_KEYS)[number], keyof WireCard>>;

/* ══════════════════════════════════════════════════════════
 * node --test
 * ══════════════════════════════════════════════════════════ */

describe('wire ↔ core schema parity', () => {
	it('编译期断言（能跑起来即 tsc 阶段已通过）', () => {
		_assertType<Equal<keyof CoreCard, keyof WireCard>>(true);
		_assertType<Equal<keyof CoreWorkspace, keyof WireWorkspace>>(true);
		_assertType<Equal<keyof CoreKindDef, keyof WireKindSummary>>(true);
	});

	it('照 core 写的卡，序列化后解析回来能赋给 wire 的 Card', () => {
		const parsed: WireCard = JSON.parse(SAMPLE_CARD_JSON);

		assert.equal(parsed.id, SAMPLE_CARD.id);
		assert.equal(parsed.title, SAMPLE_CARD.title);
		assert.equal(parsed.status, SAMPLE_CARD.status);
		assert.deepEqual(parsed.template, SAMPLE_CARD.template);
		assert.deepEqual(parsed.relations, SAMPLE_CARD.relations);
		assert.equal(parsed.sections.goal?.label, '目标');
		assert.deepEqual(parsed.history, SAMPLE_CARD.history);
		assert.deepEqual(parsed.holders, SAMPLE_CARD.holders);
		assert.equal(parsed.unread.ai, true);
		assert.equal(parsed.unread.user, false);
		assert.equal(parsed.adoptedAt, null);
		assert.equal(parsed.deleted, false);
		assert.equal(parsed.createdAt, SAMPLE_CARD.createdAt);
	});

	it('样例 JSON 覆盖 wire Card 的每一个字段（少一个 ⇒ 这里红）', () => {
		const parsed: WireCard = JSON.parse(SAMPLE_CARD_JSON);
		assert.deepEqual(Object.keys(parsed).sort(), [...SAMPLE_CARD_KEYS].sort());
	});
});
