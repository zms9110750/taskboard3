/**
 * 状态圆点 —— 一个 7px 的实心圆，颜色按**视觉档位**。
 *
 * ## 为什么不是「九个状态九种颜色」
 *
 * 9 种颜色没人分得清。四个组是用户定的语义，但「完成」组里要分三种
 * （成功绿 / 失败拒绝红 / 取消灰），所以档位是六个而不是四个。
 *
 * 档位判决全在 `dev/pure/card-view.ts` 的 `stateTone()`（已单测 28 条）。
 * 组件只做一件事：**档位 → CSS 类**。
 *
 * ## ⚠ 不导出颜色值
 *
 * 颜色写在 `preview.css` 的 `.dot--*` 里，和产品样式共用同一条规则。
 * 组件里出现 `#10b981` 这种字面量 = 无法换主题、无法统一改。
 */

import type { ReactNode } from 'react';

import { stateLabel, stateTone } from '../pure/card-view.ts';

/** 组件属性。 */
export interface StatusDotProps {
	/** A2A 状态全名。 */
	readonly status: string;
	/** 圆点直径（默认 7px；科技树卡片上用 6px）。 */
	readonly size?: number;
	/** 无障碍标签。默认用状态中文名。 */
	readonly label?: string;
}

/**
 * 一个状态圆点。
 *
 * @param props 见 `StatusDotProps`
 */
export function StatusDot(props: StatusDotProps): ReactNode {
	const tone = stateTone(props.status);
	return (
		<span
			className={`dot dot--${tone}`}
			title={props.label ?? stateLabel(props.status)}
			style={props.size === undefined ? undefined : { width: props.size, height: props.size }}
		/>
	);
}
