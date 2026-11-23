/*
 * 类别显示名 —— 把 core 的 `KindRegistry` 投影成客户端要的三种显示。
 *
 * ## 为什么在这里（`.ts` 而不是 `.tsx`）
 *
 * 这段逻辑的输入是**网络边界上的数据**（`GET /api/state` 的 `kinds`，老服务端可能没有、
 * 第三方注册的类别也可能字段不全）⇒ 最需要单测。
 * 而 Node 不认 `.tsx`（`ERR_UNKNOWN_FILE_EXTENSION`）⇒ 放 `.tsx` 等于放弃测试。
 *
 * ## 三条显示规则
 *
 * | 输出 | 用在哪 | 形状 |
 * |---|---|---|
 * | `labelOf`  | 模板选择器的「类别」列 | 中文名（`目标`）—— 字母由 `letterOf` 单独出 |
 * | `letterOf` | 同上（字母前缀）、编号前缀展示 | 单个大写字母（`G`） |
 * | `badgeOf`  | 列表行 / 详情 / 科技树上的类别徽标 | `G 目标` |
 *
 * ⚠ **不编中文**：注册表里没有的类别降级成英文 id（`defaultKindLabel`），
 *   字母降级成 id 首字母大写（`defaultKindLetter`）。
 *   这是「宁可难看，也不要编」的口径 —— 编出来的中文会变成第二份真值。
 *
 * 用户 2026-11-24：「模板分类那里要用中文的。并且中文前面要有一个大写的G。」
 */

import { defaultKindLabel, defaultKindLetter } from './template-picker.ts';

/**
 * 注册表里一项的最小形状。
 *
 * 故意**不 import** `src/types.ts` 的 `KindSummary`：那个类型来自网络响应，
 * 是「有什么字段」的声明；这里只要这三个 —— 少了不该编译过，多了不该报错。
 */
export interface KindLabelSource {
	/** 稳定英文标识。 */
	readonly id: string;
	/** 中文显示名。 */
	readonly displayName: string;
	/** 编号字母。 */
	readonly letter: string;
}

/** 一个类别的三种显示。 */
export interface KindLabels {
	/** 中文名；没有就降级成英文 id。 */
	labelOf(kind: string): string;
	/** 单个大写字母；取不到就降级成 id 首字母。 */
	letterOf(kind: string): string;
	/** 徽标文本：`字母 + 空格 + 中文名`；中文缺失时降级成 `字母 + 空格 + id`。 */
	badgeOf(kind: string): string;
}

/** 字母的**唯一合法形状**：单个大写 ASCII 字母（与 core 的注册校验一致）。 */
const LETTER_SHAPE = /^[A-Z]$/u;

/**
 * 建一份显示映射。
 *
 * @param kinds 注册表投影（`GET /api/state` 的 `kinds`），可为空
 */
export function kindLabelsOf(kinds: readonly KindLabelSource[]): KindLabels {
	const byId = new Map<string, KindLabelSource>();
	for (const one of kinds) {
		/* 重复 id：**先注册的赢**（注册表语义；后一个多半是脏数据）。 */
		if (!byId.has(one.id) && one.id !== '') byId.set(one.id, one);
	}

	const labelOf = (kind: string): string => {
		const def = byId.get(kind);
		const name = def?.displayName.trim() ?? '';
		/*
		 * ⚠ 空串 / 全空格必须降级 —— 否则徽标会变成「G 」（多个空格，看着像漏字）。
		 *   破坏性验证就钉这一条：把 displayName 改成空串，输出必须是 `G goal`。
		 */
		return name === '' ? defaultKindLabel(kind) : name;
	};

	const letterOf = (kind: string): string => {
		const def = byId.get(kind);
		const letter = def?.letter ?? '';
		/* 非法字母同样降级：core 那边注册时就拦了，这里防的是「老服务端 / 脏数据」。 */
		return LETTER_SHAPE.test(letter) ? letter : defaultKindLetter(kind);
	};

	return {
		labelOf,
		letterOf,
		badgeOf(kind: string): string {
			/* `kind === ''` ⇒ 卡上没有类别（空模板）⇒ 不显示徽标（调用方按空串跳过）。 */
			if (kind === '') return '';
			return `${letterOf(kind)} ${labelOf(kind)}`;
		},
	};
}
