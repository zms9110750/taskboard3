/**
 * 发号 —— **纯计算**，不读存储、不管并发。
 *
 * ## 编号规则
 *
 * 编号 = **分类字母 + 模板 `codePrefix` + 流水号**：
 *
 * ```
 * 目标 / 用户任务  kind=goal(字母 G)  codePrefix=U   →  GU01, GU02, …
 * 目标 / 空模板    kind=goal(字母 G)  codePrefix=''  →  G01
 * 工作 / 写代码    kind=work(字母 W)  codePrefix=C   →  WC01
 * ```
 *
 * 用户 `2026-11-01 03:32`：「编号默认的就用他们的首字母。目标是 goal。」
 * 用户 `2026-11-01 03:47`：「数字递增是看前缀的。会有 G01, GA01, GD01, GTT01」
 *
 * ## 分类字母从哪来
 *
 * ⚠ 本模块**不猜字母**。分类 → 字母的映射是**注册表**（`kindLetterOf`），
 * 未注册就返回 `undefined`，由调用方决定要不要报错。
 * 猜一个字母会造出**会撞号的前缀**，那比报错难查得多。
 *
 * ## 流水号看前缀
 *
 * 「数字递增是看前缀的」⇒ 只统计**前缀相同**的已用编号，取最大号 +1。
 * ⇒ 不同前缀各自独立计数。
 *
 * ## 墓碑也占号
 *
 * 用户：「删除是标记为删除。不是持久化里面不存了。」
 * ⇒ `usedIds` 必须含墓碑，否则删掉的号会被重新发出去。
 */

/**
 * 从一组编号里算下一个号。
 *
 * @param prefix 前缀（如 `GU`）
 * @param usedIds 该空间**全部**已用编号（**含墓碑**）
 * @returns 下一个编号（如 `GU03`）
 */
export function nextId(prefix: string, usedIds: readonly string[]): string {
	if (!/^[A-Z]+$/u.test(prefix)) {
		throw new TypeError(`编号前缀必须是大写字母：${prefix}`);
	}

	let max = 0;
	for (const id of usedIds) {
		if (!id.startsWith(prefix)) continue;
		const tail = id.slice(prefix.length);
		/* 只认纯数字尾巴 —— `GUA02` 这种"前缀更长的"不算 `GU` 的号。 */
		if (!/^\d+$/u.test(tail)) continue;
		const value = Number(tail);
		if (Number.isSafeInteger(value) && value > max) max = value;
	}

	const next = max + 1;
	/* 第 100 个是 3 位（用户：「第100个是3位」）。04 位宽不够，用最小宽度 2。 */
	return `${prefix}${String(next).padStart(2, '0')}`;
}

/**
 * 拼前缀：分类字母 + 模板 `codePrefix`。
 *
 * @param kindLetter 分类字母；`undefined` = 该分类未注册
 * @param codePrefix 模板的字母段（`''` 合法）
 * @returns 前缀，或失败原因
 */
export function prefixOf(
	kindLetter: string | undefined,
	codePrefix: string,
): { ok: true; prefix: string } | { ok: false; reason: 'KIND_UNKNOWN' | 'PREFIX_INVALID' } {
	if (kindLetter === undefined || kindLetter === '') return { ok: false, reason: 'KIND_UNKNOWN' };
	const prefix = `${kindLetter}${codePrefix}`;
	if (!/^[A-Z]+$/u.test(prefix)) return { ok: false, reason: 'PREFIX_INVALID' };
	return { ok: true, prefix };
}

