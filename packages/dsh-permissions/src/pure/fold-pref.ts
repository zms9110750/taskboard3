/**
 * 折叠偏好（issue #56）：「分组默认展开 / 收起」要**记住用户的选择**。
 *
 * ## 为什么单独一个纯文件
 *
 * `localStorage` 在三种环境下行为不同，而三种都真实存在：
 *
 * | 环境 | 行为 |
 * |---|---|
 * | 浏览器（产品） | 正常读写 |
 * | SSR / `node --test` | `localStorage` **不存在** ⇒ 必须回落到默认值 |
 * | 隐私模式 / 配额满 | `getItem` / `setItem` **抛异常** ⇒ 不能让整页崩 |
 *
 * ⇒ 读 / 写各收成一个纯函数，存储端口**注入**（测试用假 store 覆盖上面三种）。
 *
 * ⚠ 偏好只是「默认状态」，不是数据：读失败一律回落默认值，**不报错**。
 *   与「组图保存失败要显示」是不同性质的失败（那个是用户数据）。
 */

/** 最小存储端口（`localStorage` 的形状子集）。 */
export interface FoldPrefStorage {
	readonly getItem: (key: string) => string | null;
	readonly setItem: (key: string, value: string) => void;
}

/** 键前缀 —— 所有折叠偏好都落在这个命名空间下。 */
export const FOLD_PREF_PREFIX = 'tb3-fold:';

/**
 * 作用域 → 存储键。
 *
 * @param scope 形如 `auth:tiers` / `auth:domain:代码`
 */
export function foldPrefKeyOf(scope: string): string {
	return `${FOLD_PREF_PREFIX}${scope}`;
}

/**
 * 读一个折叠偏好。
 *
 * @param storage 存储端口；省略 ⇒ 直接用默认值
 * @param key 存储键
 * @param fallback 没有记录 / 记录坏了时用的值
 */
export function readFoldPref(storage: FoldPrefStorage | undefined, key: string, fallback: boolean): boolean {
	if (storage === undefined) return fallback;
	let raw: string | null;
	try {
		raw = storage.getItem(key);
	} catch {
		return fallback;
	}
	if (raw === '1') return true;
	if (raw === '0') return false;
	return fallback;
}

/**
 * 写一个折叠偏好（失败静默：偏好不是数据）。
 *
 * @param storage 存储端口
 * @param key 存储键
 * @param open 展开为 `true`
 */
export function writeFoldPref(storage: FoldPrefStorage | undefined, key: string, open: boolean): void {
	if (storage === undefined) return;
	try {
		storage.setItem(key, open ? '1' : '0');
	} catch {
		/* 隐私模式 / 配额满：记住偏好不是必须的，别让点击折叠变成抛异常。 */
	}
}

/**
 * 浏览器里的 `localStorage`（不存在时 `undefined`）。
 *
 * 访问 `window.localStorage` 本身就可能抛（部分沙箱 / `file://` 限制），
 * 所以整个取值过程包在 try 里。
 */
export function browserFoldStorage(): FoldPrefStorage | undefined {
	try {
		if (typeof localStorage === 'undefined') return undefined;
		return localStorage;
	} catch {
		return undefined;
	}
}
