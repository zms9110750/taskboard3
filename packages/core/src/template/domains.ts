/**
 * 领域注册表 —— **纯展示 + 筛选**。
 *
 * 用户 `2026-11-01 12:48`：「（domain 存什么）保持纯展示」
 * ⇒ 领域不参与任何判定，只用于分组与筛选。
 *
 * 内置两个领域：核心 / 代码。它们只是**默认内容**，可以注册更多。
 */

/** 一个领域的定义。 */
export interface DomainDef {
	readonly id: string;
	readonly displayName: string;
	readonly description: string;
}

/** 两个内置领域。 */
export const BUILTIN_DOMAINS: readonly DomainDef[] = Object.freeze([
	{ id: 'core', displayName: '核心', description: '任务板本身、协作方式、方法论。' },
	{ id: 'code', displayName: '代码', description: '写代码、改代码、修缺陷。' },
]);

/** 领域注册表。 */
// TODO(审查): 与 KindRegistry 同构（注册/注销 + onChange 通知、幂等退订）⇒ 应共用通用 `Registry<T>`，见 kinds.ts 同一 TODO，可直接改。
export class DomainRegistry {
	readonly #domains = new Map<string, DomainDef>();
	readonly #onChange: () => void;

	constructor(onChange: () => void = () => {}) {
		this.#onChange = onChange;
	}

	/** 注册一个领域。 */
	register(def: DomainDef): () => void {
		if (typeof def.id !== 'string' || def.id === '') {
			throw new TypeError('taskboard3-core: 领域必须有 id');
		}
		if (this.#domains.has(def.id)) {
			throw new TypeError(`taskboard3-core: 领域「${def.id}」已注册`);
		}
		this.#domains.set(def.id, Object.freeze({ ...def }));
		this.#onChange();

		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			if (this.#domains.delete(def.id)) this.#onChange();
		};
	}

	/** 取领域定义。 */
	get(id: string): DomainDef | undefined {
		return this.#domains.get(id);
	}

	/** 全部领域（注册顺序）。 */
	list(): readonly DomainDef[] {
		return [...this.#domains.values()];
	}

	/** 是否已注册。 */
	has(id: string): boolean {
		return this.#domains.has(id);
	}
}
