/**
 * **core 的 `Failure` → 表单错误** —— 纯函数，`node --test` 直接跑。
 *
 * ## 为什么需要它（用户 `2026-11-22`）
 *
 * > 「点提交以后……都要进 core，也要过架构校验。而且是跟 ai tool 一样的校验入口。
 * >  过了校验才能建卡。」
 *
 * ⇒ 客户端 `validateCreate()` 只是**快速反馈**，`core` 的 `buildCard()` 才是唯一权威。
 *   但 core 拒绝时返回的是 `Failure`（`code` + `message` + `issues`），
 *   而界面要的是 `CreateError[]`（`field` + `message`）。
 *   **这一层就是把前者翻成后者** —— 不翻就没法在对应输入框下面标红。
 *
 * ## 两个方向都要保住
 *
 * | 方向 | 不能丢的东西 |
 * |---|---|
 * | core → 界面 | **逐条** issue（哪个章节、哪个字段、什么错），不是一句「创建失败」 |
 * | 界面 → 用户 | 左侧栏的 `/title`、`/templateRef` 要能命中；右栏的 `/sections/<id>` 要能命中 |
 *
 * ## ⚠ core 的 issue 路径 vs 本包的 `CreateError.field`
 *
 * core 用的是 **JSON Pointer**，而且章节那一层的 key 可能是**章节名（label）**
 * 也可能是**章节 id**（`schema.ts` 的 `sectionByKey` 两者都认）：
 *
 * ```
 * core:      /content/<label 或 id>            → 章节整体
 *            /content/<label 或 id>/<字段>     → 章节里某个字段
 *            /title                            → 标题
 *            /kind  /domain                    → 空模板缺分类/领域
 * 本包:      /sections/<sectionId>             → 章节整体（右栏挂在这里）
 *            /title  /templateRef              → 左栏
 *            ''（空串）                        → 统错，界面上单独一条横幅
 * ```
 *
 * ⇒ 必须建一张 `label/id → sectionId` 的映射表，否则 `/content/正文/x` 会落不到
 *   任何章节上（`CardCreate` 只认 `/sections/` 前缀）。
 *
 * ## 为什么无主的 issue 映射到空串而不是丢掉
 *
 * 丢掉 = 用户看到「还有 1 处要改」但**永远找不到那一处**。
 * 映射到 `''` 至少能进横幅（横幅显示 core 的完整 `message`，
 * 那条消息本身就带了逐章节的人话说明）。
 */

import type { CreateDraft } from './create-types.ts';
import type { CreateError } from './create-validate.ts';

/**
 * core 的 `Failure` 里本函数用到的字段。
 *
 * ⚠ 故意**不用** `@taskboard/protocol` 的 `Failure` 类型：本包是客户端，
 *   `protocol` 是被打进产物的纯词表，但 `create-validate.ts` 这条链路
 *   要能脱离 protocol 单独单测（见那个文件的「一致性靠结构对齐」口径）。
 *   结构相同即可，形状对齐写在下面这张表里。
 */
export interface FailureLike {
	readonly code: string;
	readonly message: string;
	readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/**
 * 一个未知异常是不是「带业务错误码的 API 失败」。
 *
 * ## ⚠ 为什么不用 `instanceof ApiError`
 *
 * `api.ts` 的 `ApiError` 现在是 class（`instanceof` 可用），但**本模块是纯逻辑、
 * 不 import 网络层**（`api.ts` 会拖进 `fetch` 语义，且它不该是表单层的依赖）。
 * 按形状判定还能兼容未来其它来源的同形错误（如 Host 侧注入的 `Failure`）。
 *
 * 判据两条：`code` 是非空字符串、`message` 是字符串。
 * 不用「有没有 `issues`」—— 失败可以没有字段级问题（比如业务规则拒绝）。
 *
 * @param cause 任意抛出物
 */
export function isFailureLike(cause: unknown): cause is FailureLike & Error {
	if (!(cause instanceof Error)) return false;
	const record = cause as unknown as Record<string, unknown>;
	return typeof record['code'] === 'string' && record['code'] !== '';
}

/** 无主错误的 `field` 值（空串 = 不属于任何字段，走横幅）。 */
export const GENERAL_FIELD = '';

/**
 * 建一张 `章节名 / 章节 id → 章节 id` 的映射。
 *
 * @param draft 草稿
 * @returns 两个 key 都指向**同一个** sectionId
 */
export function sectionKeysOf(draft: CreateDraft): ReadonlyMap<string, string> {
	const map = new Map<string, string>();
	for (const section of draft.sections) {
		map.set(section.sectionId, section.sectionId);
		/* label 也进表 —— core 的 issue 可能用 label（用户给模板写的中文名）。 */
		if (section.label !== '') map.set(section.label, section.sectionId);
	}
	return map;
}

/**
 * 拆一个 JSON Pointer 成段（反转义 `~1` → `/`、`~0` → `~`）。
 *
 * @param path JSON Pointer（如 `/content/正文/value`）
 * @returns 段数组（空数组 = 指向根）
 */
export function segmentsOf(path: string): readonly string[] {
	if (path === '') return [];
	return path
		.replace(/^\/+/, '')
		.split('/')
		.map((one) => one.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

/**
 * 把 core 的 `Failure` 翻成表单错误。
 *
 * @param failure core 的失败结果
 * @param draft 当前草稿（用来查 label → sectionId）
 * @returns 错误清单；`issues` 为空时返回一条 `field: ''` 的统错
 */
export function errorsFromFailure(failure: FailureLike, draft: CreateDraft): readonly CreateError[] {
	const keys = sectionKeysOf(draft);
	const issues = failure.issues ?? [];

	if (issues.length === 0) {
		return [{ field: GENERAL_FIELD, message: failure.message }];
	}

	return issues.map((issue) => ({
		field: fieldOf(issue.path, keys),
		message: issue.message,
	}));
}

/**
 * core 的一个 issue 路径 → 本包的 `field`。
 *
 * @param path JSON Pointer
 * @param keys `章节名/id → sectionId` 的映射
 * @returns `/title` / `/templateRef` / `/sections/<id>` / `''`
 */
export function fieldOf(path: string, keys: ReadonlyMap<string, string>): string {
	const segments = segmentsOf(path);
	const head = segments[0];

	if (head === 'title') return '/title';
	if (head === 'templateRef') return '/templateRef';
	/* 空模板缺分类/领域 —— 界面上它是「模板选得不对」这件事，挂到模板字段。 */
	if (head === 'kind' || head === 'domain') return '/templateRef';

	if (head === 'content') {
		/*
		 * `/content/<key>` 或 `/content/<key>/<字段…>`。
		 * key 可能是 label 也可能是 id —— 用映射表查，查不到就归统错（不猜）。
		 */
		const key = segments[1];
		if (key === undefined) return GENERAL_FIELD;
		const sectionId = keys.get(key);
		return sectionId === undefined ? GENERAL_FIELD : `/sections/${sectionId}`;
	}

	/*
	 * 其余一切 head（含 relations —— core 目前不给关系逐条 issue，
	 * `RELATION_TARGET_INVALID` 走 message；也含没列出的未来字段）兜底成统错。
	 */
	return GENERAL_FIELD;
}

/**
 * core 的 `Failure` 有没有**能落到具体字段**的错误。
 *
 * 用途：界面决定要不要显示横幅。全是字段级错误时横幅可以只说「有 N 处要改」；
 * 有一条无主的就必须把 core 的原话显示出来（否则用户找不到那一处）。
 *
 * @param errors `errorsFromFailure()` 的结果
 */
export function hasGeneralError(errors: readonly CreateError[]): boolean {
	return errors.some((one) => one.field === GENERAL_FIELD);
}
