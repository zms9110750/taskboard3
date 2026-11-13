/**
 * 类别注册表 —— **分类 → 编号字母**。
 *
 * ## 为什么单独一份
 *
 * 编号前缀 = 分类字母 + 模板 `codePrefix`。分类字母**不能从模板反推**
 * （否则两个模板用同一分类会拼出不同的字母，号就撞了）。
 * 用户 `2026-11-01 03:32`：「编号默认的就用他们的首字母。目标是 goal。」
 *
 * ## 四个内置类别
 *
 * | id | 显示名 | 字母 | 初态 |
 * |---|---|---|---|
 * | `goal` | 目标 | `G` | 草稿 |
 * | `design` | 设计 | `D` | 草稿 |
 * | `work` | 工作 | `W` | 草稿 |
 * | `record` | 记录 | `R` | 草稿 |
 *
 * 用户 `2026-11-02 16:05`：`design` / `record` 的初始状态改为「未指定」——
 * 与 `goal` / `work` 一样都从草稿开始，区别在**采纳之后去哪**
 * （目标与工作进「提交」，设计与记录进「需要授权」）。
 *
 * ## 未注册就返回 `undefined`
 *
 * **不猜字母**。猜一个会造出会撞号的前缀，那比报错难查得多。
 */

/** 一个类别的定义。 */
export interface KindDef {
	/** 稳定英文标识。存进卡里、参与判断的就是它。 */
	readonly id: string;
	/** 中文显示名。 */
	readonly displayName: string;
	/**
	 * 编号字母（单个大写字母）。
	 *
	 * ⚠ 与模板的 `codePrefix` 拼起来才是完整前缀。两个字母组合必须唯一 ——
	 * 否则发号会撞。
	 */
	readonly letter: string;
	/** 一句话说明（给 AI / 模板查看器）。 */
	readonly description: string;
	/**
	 * 取消后能否重开。
	 *
	 * 用户：「目标与设计可以由用户重开；工作与记录没有重开入口，重来就新建一张。」
	 */
	readonly reopenable: boolean;
	/**
	 * 这类卡**是否需要领取**（即：领取是它的权限凭证）。
	 *
	 * 用户 `2026-11-13`：
	 * > 一次一张要的。因为自动化下。就是工作卡给的权限。这是为了防止越狱。
	 * > 比如编写代码是没有命令行的。跑一边要另外开卡。这也是为了记录流程。
	 * > 因为其他的所有卡，都是可以在仅聊天下去做的。
	 *
	 * ⇒ **只有「工作」是 `true`**。目标 / 设计 / 记录在纯聊天里就能做，
	 *   不需要执行权限，也就不需要领取。
	 *
	 * ⚠ 这是**类别自身的属性**，不是「名字叫 work」的硬编码。
	 *   第三方注册的类别自己声明要不要领取。
	 */
	readonly needsClaim: boolean;
}

/** 四个内置类别。顺序 = UI 里的显示顺序。 */
export const BUILTIN_KINDS: readonly KindDef[] = Object.freeze([
	{
		id: 'goal',
		displayName: '目标',
		letter: 'G',
		description: '达成某个结果的目标。子任务的状态会推着它走。',
		reopenable: true,
		needsClaim: false,
	},
	{
		id: 'design',
		displayName: '设计',
		letter: 'D',
		description: '决定方向。建出来先停在「需要授权」，等用户点头。',
		reopenable: true,
		needsClaim: false,
	},
	{
		id: 'work',
		displayName: '工作',
		letter: 'W',
		description: '实际动手做的任务。领取它就是拿到执行权限。',
		reopenable: false,
		needsClaim: true,
	},
	{
		id: 'record',
		displayName: '记录',
		letter: 'R',
		description: '记一件事。建出来先停在「需要授权」。',
		reopenable: false,
		needsClaim: false,
	},
]);

/** 类别注册表。 */
export class KindRegistry {
	readonly #kinds = new Map<string, KindDef>();
	readonly #onChange: () => void;

	constructor(onChange: () => void = () => {}) {
		this.#onChange = onChange;
	}

	/** 注册一个类别。 */
	register(def: KindDef): () => void {
		if (typeof def.id !== 'string' || def.id === '') {
			throw new TypeError('taskboard3-core: 类别必须有 id');
		}
		if (!/^[A-Z]$/u.test(def.letter)) {
			throw new TypeError(`taskboard3-core: 类别「${def.id}」的 letter 必须是单个大写字母`);
		}
		if (this.#kinds.has(def.id)) {
			throw new TypeError(`taskboard3-core: 类别「${def.id}」已注册`);
		}
		/* 字母撞车会让两个类别发出的号互相覆盖 —— 注册期就拒。 */
		for (const other of this.#kinds.values()) {
			if (other.letter === def.letter) {
				throw new TypeError(
					`taskboard3-core: 类别「${def.id}」的字母 ${def.letter} 已被「${other.id}」占用`,
				);
			}
		}
		this.#kinds.set(def.id, Object.freeze({ ...def }));
		this.#onChange();

		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			if (this.#kinds.delete(def.id)) this.#onChange();
		};
	}

	/** 取类别定义。 */
	get(id: string): KindDef | undefined {
		return this.#kinds.get(id);
	}

	/** 取分类字母；未注册返回 `undefined`（**不猜**）。 */
	letterOf(id: string): string | undefined {
		return this.#kinds.get(id)?.letter;
	}

	/** 全部类别（注册顺序）。 */
	list(): readonly KindDef[] {
		return [...this.#kinds.values()];
	}

	/** 是否已注册。 */
	has(id: string): boolean {
		return this.#kinds.has(id);
	}
}
