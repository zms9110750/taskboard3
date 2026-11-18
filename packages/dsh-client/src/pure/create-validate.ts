/**
 * 建卡草稿的**校验**与**类型切换规则** —— 纯函数，`node --test` 直接跑。
 *
 * ## 为什么校验在客户端也要做一遍（core 明明会校验）
 *
 * core 的校验在**提交之后**。用户点「提交」→ 等一个往返 → 报错 → 改 → 再提交。
 * 而「标题为空」这种错**在输入框旁边就能立刻说**。
 *
 * ⇒ 客户端校验是**体验优化**，不是安全边界。**core 的校验仍然是唯一权威**
 *   （客户端可以被绕过，而且客户端不知道模板的全部规则）。
 *
 * ## ⚠ 怎么和 core 的 zod schema 保持一致（不能 import core 的前提）
 *
 * 客户端能查的只有**结构层面**的东西：
 *
 * | 查什么 | 谁也是这么查的 |
 * |---|---|
 * | 标题 trim 后非空 | `core/src/create.ts:99-104` 完全一致 |
 * | 模板必选 | `core/src/create.ts:91-96`（模板不存在）|
 * | 每章 `payload.$type` 与声明的 action 一致 | `core` 的模板加载期断言 + `schema.ts` 逐章节校验 |
 * | 关系目标非空 | `core/src/create.ts` 的 `checkRelations` |
 *
 * **查不了的（故意不查）**：
 * - payload 内部字段是否合法（`ask` 的 `options[].label` 必填等）—— 那要 zod schema
 * - 模板是否存在（客户端只有 `TemplateSummary[]`，能查 ref，但「存在但加载失败」查不出）
 *
 * ⇒ **一致性靠结构对齐，不靠共享代码。** 两边都查的那几条，判据写在注释里
 *   指向 core 的具体行号，改一边时能看到另一边。
 */

import type {
	CreateDraft,
	CreateSubmission,
	RelationDraft,
	SectionDraft,
	SectionKind,
} from './create-types.ts';

/** 一条校验错误。 */
export interface CreateError {
	/**
	 * 字段路径。
	 *
	 * 约定：
	 * - `/title` —— 标题
	 * - `/templateRef` —— 模板
	 * - `/sections/<sectionId>` —— 某个章节
	 * - `/relations/<index>` —— 某条关系
	 */
	readonly field: string;
	/** 给人看的一句话（**不是**「必填」这种光秃秃的词）。 */
	readonly message: string;
}

/**
 * 校验一份建卡草稿。
 *
 * 空数组 = 通过。
 *
 * ⚠ **返回全部错误而不是遇到第一个就返回** —— 用户想知道「还有几个地方要改」，
 *   而不是改一个提交一次、再被拒一次。
 *
 * @param draft 草稿
 * @returns 错误清单（按字段路径顺序，稳定）
 */
export function validateCreate(draft: CreateDraft): readonly CreateError[] {
	const errors: CreateError[] = [];

	/* ── ① 标题（与 core/src/create.ts:99 同一判据：trim 后非空） ── */
	if (draft.title.trim() === '') {
		errors.push({ field: '/title', message: '卡标题不能为空。' });
	}

	/* ── ② 模板（core 的判据是「模板存在」，客户端只能查「选了没有」） ── */
	if (draft.templateRef === '') {
		errors.push({ field: '/templateRef', message: '还没选模板。' });
	}

	/* ── ③ 每章 $type 与声明的 action 一致 ── */
	for (const section of draft.sections) {
		const type = payloadTypeOf(section.payload);
		if (type === '') {
			errors.push({
				field: `/sections/${section.sectionId}`,
				message: `章节「${section.label}」的内容没有 $type，无法判断用哪个渲染器。`,
			});
			continue;
		}
		if (type !== section.kind) {
			/*
			 * 这条防的是「类型选择器切了但 payload 没跟着换」——
			 * 表现是界面上看着是 ask，提交上去 core 按 markdown 校验 ⇒ 报一个
			 * 用户完全看不懂的「content 不符合模板」。
			 */
			errors.push({
				field: `/sections/${section.sectionId}`,
				message: `章节「${section.label}」的内容类型是「${type}」，但表单选的是「${section.kind}」。`,
			});
		}
	}

	/* ── ④ 关系目标（空行不算，不报错但也不送） ── */
	draft.relations.forEach((relation, index) => {
		/* 空行本身合法（用户加了一行还没选）—— 只有「选了但选了空」才怪，
		 * 而那不可能发生（CardPicker 的 value 要么是卡 id 要么空串）。 */
		if (relation.to === '' && relation.label === '') {
			errors.push({
				field: `/relations/${index}`,
				message: '这一行关系既没有类型也没有目标。',
			});
		}
	});

	return errors;
}

/** 从 payload 里取 `$type`（非字符串 / 缺失 ⇒ 空串）。 */
export function payloadTypeOf(payload: unknown): string {
	if (payload === null || typeof payload !== 'object') return '';
	const type = (payload as Record<string, unknown>)['$type'];
	return typeof type === 'string' ? type : '';
}

/* ══════════════════════════════════════════════════════════
   内容类型切换：内容保留 / 重置
   ══════════════════════════════════════════════════════════ */

/** 切换类型的结果。 */
export interface SwitchResult {
	/** 新的章节状态。 */
	readonly section: SectionDraft;
	/** 内容被丢弃了吗（真 = 调用方要提示用户）。 */
	readonly lostContent: boolean;
}

/**
 * 切换一个章节的内容类型。
 *
 * ## 五条规则（每条都有理由）
 *
 * | 从 → 到 | 保留？ | 理由 |
 * |---|---|---|
 * | `text` → `markdown` | ✅ | 都是 `{ $type, value }`，**只差渲染方式**。用户写的是源码，markdown 就是更富的文本 |
 * | `markdown` → `text` | ✅ | 同上，反向也一样。降级成纯文本不丢字，只是不渲染 |
 * | `text`/`markdown` → `ask` | ❌ 重置 | 结构完全不同：`ask` 是 `{ items:[{options}] }`，没有 `value` 字段可搬 |
 * | `ask` → `text` | ❌ 重置 | **见下** |
 * | `ask` → `markdown` | ❌ 重置 | 同上 |
 *
 * ## ⚠ 为什么 `ask` → `text` 选「重置」而不是「把选中项拼成文字」
 *
 * 三个理由，前两个是决定性的：
 *
 * 1. **答案会变成正文** —— ask 的「选中项」是**一份问卷的答案**，
 *    而 text 章节的 `value` 是**正文**。把答案拼成正文会让「这是什么」彻底变味，
 *    而且用户很难看出来（看着像一段正常的正文）。
 * 2. **丢失不可逆** —— 拼成文字之后切回 ask，无法还原成结构化选项。
 *    ⇒ 一次误点就永久破坏数据。
 * 3. 「拼成文字」看起来体贴，实际是**替用户做了语义决定**。那正是这个项目
 *    反复在避免的事（组件只做渲染决定，不做语义决定）。
 *
 * ⇒ 重置 + **明确提示**（`lostContent: true`）。丢内容是可以接受的，
 *   悄悄丢掉或悄悄变形才是问题。
 *
 * @param section 当前章节
 * @param next 目标类型
 * @returns 新章节状态 + 是否丢了内容
 */
export function switchSectionKind(section: SectionDraft, next: SectionKind): SwitchResult {
	if (section.kind === next) return { section, lostContent: false };

	const from = section.kind;
	const wasText = from === 'text' || from === 'markdown';
	const isText = next === 'text' || next === 'markdown';

	/* ① text ↔ markdown：双向保留（同一个 `value` 字段）。 */
	if (wasText && isText) {
		const value = valueOf(section.payload);
		return {
			section: { ...section, kind: next, payload: { $type: next, value } },
			lostContent: false,
		};
	}

	/* ② 其余组合（含 ask ↔ 文本）：重置成目标类型的空 payload。 */
	const hadContent = hasContent(section);
	return {
		section: { ...section, kind: next, payload: emptyPayloadOf(next) },
		lostContent: hadContent,
	};
}

/** 取 `{ value }` 里的字符串；不是字符串 ⇒ 空串。 */
export function valueOf(payload: unknown): string {
	if (payload === null || typeof payload !== 'object') return '';
	const value = (payload as Record<string, unknown>)['value'];
	return typeof value === 'string' ? value : '';
}

/**
 * 这一章**有没有值得挽留的内容**。
 *
 * 判据：`text` / `markdown` 看 `value` 非空；`ask` 看有没有选项或已选。
 * 空章节切类型时 `lostContent` 为 `false` —— 不该为一个空章节弹「会丢内容」的提示。
 */
export function hasContent(section: SectionDraft): boolean {
	if (section.kind === 'ask') {
		const items = itemsOf(section.payload);
		return items.some((one) => one.options.length > 0 || one.picked !== undefined);
	}
	return valueOf(section.payload) !== '';
}

/** 某类型的最小空 payload（与 core 的 `defaultPayload` 同形）。 */
export function emptyPayloadOf(kind: SectionKind): unknown {
	if (kind === 'ask') return { $type: 'ask', items: [{ options: [] }] };
	return { $type: kind, value: '' };
}

/** 取 ask payload 里的 items（结构化，不抛）。 */
function itemsOf(
	payload: unknown,
): readonly { readonly options: readonly unknown[]; readonly picked?: readonly string[] }[] {
	if (payload === null || typeof payload !== 'object') return [];
	const items = (payload as Record<string, unknown>)['items'];
	if (!Array.isArray(items)) return [];
	const out: { options: readonly unknown[]; picked?: readonly string[] }[] = [];
	for (const one of items) {
		if (one === null || typeof one !== 'object') continue;
		const record = one as Record<string, unknown>;
		const options = Array.isArray(record['options']) ? (record['options'] as readonly unknown[]) : [];
		const picked = Array.isArray(record['picked'])
			? (record['picked'] as readonly string[])
			: undefined;
		out.push(picked === undefined ? { options } : { options, picked });
	}
	return out;
}

/* ══════════════════════════════════════════════════════════
   草稿 → 提交结构
   ══════════════════════════════════════════════════════════ */

/**
 * 把草稿组装成 core 认得的形状。
 *
 * ## 对照 `core/src/create.ts:42-66` 的 `CreateInput`
 *
 * ```
 * CreateInput            CreateSubmission（本函数产出）
 * ├ templateRef  string  ← draft.templateRef
 * ├ title        string  ← draft.title.trim()      ← ⚠ trim 在这里做一次
 * ├ content?     object  ← { [sectionId]: payload }
 * ├ relations?   object  ← { parent, links }  （空行已滤掉）
 * ├ note?        string  ← draft.note
 * ├ workspaceId          ← ❌ 不归本层（调用方补）
 * ├ origin?              ← ❌ 不归本层（调用方定，面板固定 'panel'）
 * └ actor?               ← ❌ 不归本层（入口决定 user / ai）
 * ```
 *
 * ⚠ **`content` 的 key 用 `sectionId` 不用 `label`**：core 的
 *   `schema.ts` 两者都认（`sectionByKey` 同时装 label 和 id），
 *   但 id 是稳定的，label 可以被用户改模板时改掉。
 *
 * ⚠ **空关系行不送**（`to === ''`）—— 和 `relationCountOf` 同一个判据，
 *   否则「标签上写 2 条、提交 3 条」。
 *
 * @param draft 草稿
 * @returns 提交结构（调用方补 `workspaceId` / `actor` / `origin` 后交给 API）
 */
export function toCreateSubmission(draft: CreateDraft): CreateSubmission {
	const content: Record<string, unknown> = {};
	for (const section of draft.sections) content[section.sectionId] = section.payload;

	const links: { label: string; to: string }[] = [];
	for (const relation of draft.relations) {
		if (relation.to === '') continue;
		links.push({ label: relation.label, to: relation.to });
	}

	return {
		templateRef: draft.templateRef,
		title: draft.title.trim(),
		content,
		relations: { parent: draft.parentId === '' ? null : draft.parentId, links },
		note: draft.note,
	};
}

/**
 * 关系的**有效条数** —— 只算选了目标的。
 *
 * ⚠ 和 `toCreateSubmission` 里滤空行用**同一个判据**（`to !== ''`）。
 *   分开写就会出现「界面显示 3 条、提交 2 条」这种最难查的 bug。
 *
 * @param relations 关系行
 */
export function relationCountOf(relations: readonly RelationDraft[]): number {
	return relations.filter((one) => one.to !== '').length;
}
