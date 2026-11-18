/**
 * 建卡草稿的**共享类型** —— 纯数据，零依赖。
 *
 * ## 为什么单独一个文件
 *
 * 这一组类型同时被三处用：
 *
 * 1. `src/pure/create-validate.ts` —— 校验（纯函数，`node --test` 直接跑）
 * 2. `src/renderers/create/useCreateForm.ts` —— 表单状态（`.ts`，也能被 Node 跑）
 * 3. `src/renderers/create/*.tsx` —— 表单组件
 *
 * 如果类型声明在 `.tsx` 里，前两处就不能 import（`node --test` 加载不了 JSX）。
 *
 * ## 为什么不在 `src/types.ts` 里
 *
 * `types.ts` 是「**服务端数据的镜像**」（`Card` / `Workspace` / 信封），注释里
 * 明确写着「与 core 的 `Card` 逐字段对应」。建卡草稿是**客户端自己的东西**，
 * 服务端从不知道它的存在（提交时会被组装成 `CreateInput` 的形状）。
 *
 * 混进去会让「哪些是镜像、哪些是本地」变模糊。
 */

/** 内容类型（`payload.$type`）。 */
export type SectionKind = 'text' | 'markdown' | 'ask';

/**
 * 一个章节在表单里的状态。
 *
 * ⚠ `payload` 是**不透明**的：它的结构由 `$type` 决定，本包不解析它
 * （解析在 `src/pure/section.ts`，渲染在 `src/renderers/`）。
 */
export interface SectionDraft {
	/** 章节 id（模板里的稳定 key）。 */
	readonly sectionId: string;
	/** 章节名（模板给的 `label`，**不编「正文」这种容器词**）。 */
	readonly label: string;
	/** 填写提示（模板给的 `hint`）。 */
	readonly hint: string;
	/**
	 * 模板声明这一章该用哪个 action。
	 *
	 * ⚠ 与 `payload.$type` **必须一致** —— core 在加载模板时已经断言过
	 * （见 `core/src/template/loader.ts` 的 `action === defaultPayload.$type`），
	 * 但用户可以在 UI 上改类型，所以这里是**当前选择的类型**，可能已经偏离模板。
	 */
	readonly kind: SectionKind;
	/** 当前 payload（`$type` 与上面的 `kind` 应当一致）。 */
	readonly payload: unknown;
}

/** 一条关系草稿。 */
export interface RelationDraft {
	/** 关系类型（协议名：`dependsOn` / `constrains` / `related` / `references`）。 */
	readonly label: string;
	/** 目标卡 id；空串 = 还没选（**提交时不送**）。 */
	readonly to: string;
}

/**
 * 建卡草稿 —— 表单的**唯一数据源**。
 *
 * 提交时会被 `toCreateInput()` 组装成 core 认得的形状（见 `create-draft.ts`）。
 */
export interface CreateDraft {
	/** 标题（提交时 trim）。 */
	readonly title: string;
	/** 模板 ref；空串 = 还没选。 */
	readonly templateRef: string;
	/** 父卡 id；空串 = 顶层。 */
	readonly parentId: string;
	/** 关系行。 */
	readonly relations: readonly RelationDraft[];
	/** 各章节。 */
	readonly sections: readonly SectionDraft[];
	/** 备注（可选）。 */
	readonly note: string;
}

/** 空草稿。 */
export const EMPTY_DRAFT: CreateDraft = Object.freeze({
	title: '',
	templateRef: '',
	parentId: '',
	relations: Object.freeze([]) as readonly RelationDraft[],
	sections: Object.freeze([]) as readonly SectionDraft[],
	note: '',
});

/**
 * 提交给 `onSubmit` 的结构 —— **照着 core 的 `CreateInput` 组装**。
 *
 * 对照 `packages/core/src/create.ts` 的 `CreateInput`：
 *
 * ```ts
 * interface CreateInput {
 *   workspaceId: string;     // ← 本层不管（由调用方补）
 *   templateRef: string;
 *   title: string;
 *   content?: unknown;       // { [章节名或id]: payload }
 *   relations?: { parent?: string | null; links?: { label, to }[] };
 *   note?: string;
 *   origin?: 'panel' | 'derive' | 'fork' | 'import';
 *   actor?: 'user' | 'ai';
 * }
 * ```
 *
 * ⚠ **本包不送 `workspaceId` / `actor` / `origin`** —— 那三个由调用方决定
 * （`workspaceId` 是当前空间；`actor` 由入口决定；`origin` 是 `'panel'`）。
 * 让表单自己决定「谁建的卡」是越权。
 */
export interface CreateSubmission {
	readonly templateRef: string;
	/** `{ [sectionId]: payload }`。 */
	readonly content: Readonly<Record<string, unknown>>;
	readonly title: string;
	readonly relations: {
		readonly parent: string | null;
		readonly links: readonly { readonly label: string; readonly to: string }[];
	};
	readonly note: string;
}
