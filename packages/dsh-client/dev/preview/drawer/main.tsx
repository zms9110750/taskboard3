/**
 * 抽屉 **候选形态对比页** —— 用户要的「3 个变体并排，让我选」。
 *
 * ## 看什么
 *
 * 三列各是一个**完整的小 composer + 抽屉**（不是三个孤零零的面板）：
 * 入口正方形相对输入框的位置、面板底边贴输入框上边缘、面板宽度跟输入框一致
 * —— 这些**位置关系**只有把 composer 画出来才看得见（用户原话：
 * 「不要 handcraft 一个跟真 composer 无关的 mock」）。
 *
 * | 列 | 形态 |
 * |---|---|
 * | A | ▣ 方块 · 间距 0 · 无圆角 · `min(50vh,480px)` · 无遮罩 · 无动画 |
 * | B | ▲ 上箭头 · 间距 6px · 圆角 12px · 轻阴影 · 180ms 上滑 |
 * | C | ⋯ 三点 · 间距 12px · 圆角 16px · `50vh` · 强阴影 · 半透明遮罩 · 180ms 上滑 |
 *
 * ## 怎么玩
 *
 * - 点每列 composer 左下那颗**正方形入口**：开 / 合（三个入口图标各不相同）。
 * - **Esc** 或 **点面板外**：关。
 * - 顶部「模拟屏高」切 900 / 1200：高度候选 `min(50vh,480px)` 与 `50vh`
 *   只在屏高 > 960 时有差别（如实；别的地方没有差别）。
 * - 「全部打开 / 全部关闭」：三列一起。
 *
 * ## 真 / 假
 *
 * - **真**：`DrawerEntry` / `Drawer` / 面板里的 `<Workspace />` 全是 `src/` 同一份；
 *   产品 CSS 由 `injectStyles()` 注入（与产品同一份）。
 * - **假**：对话内容、`+`、发送键是 mock（没有服务端）。
 * - 每列容器带 `transform:translateZ(0)`：把候选 C 的 `position:fixed` 遮罩
 *   **关在本列里**（真实 DSH 里它铺满视口）。这是预览的模拟手段，不是产品行为。
 */

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { initRenderers } from '../../../src/init-renderers.ts';
import {
	DRAWER_VARIANTS,
	DRAWER_VARIANT_IDS,
	createDrawerStore,
	drawerHeightPxOf,
} from '../../../src/pure/drawer-view.ts';
import type { DrawerStore, DrawerVariantId } from '../../../src/pure/drawer-view.ts';
import { useDrawerStore } from '../../../src/renderers/Drawer.tsx';
import { injectStyles } from '../../../src/styles.ts';
import { MockComposer, injectMockStyles, screenVarStyle } from './mock-composer.tsx';
import { mockWorkspaceProps } from './mock-workspace.ts';

/** 「模拟屏高」两档：900（高度候选无差别）与 1200（差别可见）。 */
const SCREEN_HEIGHTS = [900, 1200] as const;

/** 一档模拟屏高。 */
type ScreenHeight = (typeof SCREEN_HEIGHTS)[number];

/* ══════════════════════════════════════════════════════════
   一列 = 一个完整形态
   ══════════════════════════════════════════════════════════ */

/** 一列的属性。 */
interface VariantColumnProps {
	readonly variantId: DrawerVariantId;
	readonly screenHeight: ScreenHeight;
	readonly store: DrawerStore;
	readonly onSay: (message: string) => void;
}

/**
 * 一列：列头 + 完整 composer（真入口 + 真面板 + 压缩版 Workspace）。
 *
 * @param props 见 `VariantColumnProps`
 */
function VariantColumn(props: VariantColumnProps): React.ReactNode {
	const variant = DRAWER_VARIANTS[props.variantId];
	const drawer = useDrawerStore(props.store);
	const [selectedId, setSelectedId] = useState<string | null>('GU-02');

	/* `mockWorkspaceProps` 每次都造新对象 ⇒ useMemo 只为让 Workspace 少重渲染一次。 */
	const workspace = useMemo(
		() =>
			mockWorkspaceProps({
				selectedId,
				onSelect: setSelectedId,
				onSay: props.onSay,
			}),
		[selectedId, props.onSay],
	);

	/* 同一公式的数值版：告诉用户这一档屏高下实际多高。 */
	const heightPx = drawerHeightPxOf(variant, props.screenHeight);

	return (
		<section
			className="pvc"
			data-variant-column={props.variantId}
			data-screen-height={String(props.screenHeight)}
			style={screenVarStyle(props.screenHeight)}
		>
			<header className="pvc__head">
				<div className="pvc__titleline">
					<span className="pvc__tag" data-variant-label={props.variantId}>
						{variant.label}
					</span>
					<span className="pvc__height" data-variant-height={String(heightPx)}>
						面板高 {heightPx}px
					</span>
				</div>
				<div className="pvc__summary">{variant.summary}</div>
			</header>
			<MockComposer
				variant={variant}
				open={drawer.open}
				onToggle={drawer.toggle}
				onClose={drawer.close}
				workspace={workspace}
				title="任务板"
				onRefresh={() => {
					props.onSay('抽屉：刷新（预览：没有服务端）');
				}}
			/>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

/** 预览页。 */
function App(): React.ReactNode {
	const [screenHeight, setScreenHeight] = useState<ScreenHeight>(1200);
	const [notice, setNotice] = useState<string | undefined>(undefined);

	/*
	 * 三列各一个 store。用 `useMemo` 只造一次 —— 屏高切换不能把开合状态清掉，
	 * 否则用户每点一次「模拟屏高」三个抽屉全关上。
	 */
	const stores = useMemo((): Readonly<Record<DrawerVariantId, DrawerStore>> => {
		const created = {} as Record<DrawerVariantId, DrawerStore>;
		for (const id of DRAWER_VARIANT_IDS) {
			created[id] = createDrawerStore(id, true);
		}
		return created;
	}, []);

	/** 三列一起开 / 关。 */
	const setAll = (open: boolean): void => {
		for (const id of DRAWER_VARIANT_IDS) {
			const store = stores[id];
			if (open) store.open();
			else store.close();
		}
	};

	return (
		<div className="pv">
			<header className="pv-bar">
				<span className="pv-bar__tag">抽屉 V5 · 候选形态对比（3 选 1）</span>
				<span className="pv-bar__note">
					点每列 composer 左下角的入口开合；Esc / 点面板外关闭。宽度 = 输入框宽，高度 ≈ 屏幕一半。
				</span>
				<span className="pv-bar__sep" />
				<span className="pv-bar__label">模拟屏高</span>
				{SCREEN_HEIGHTS.map((height) => (
					<button
						key={height}
						type="button"
						className={`pv-bar__btn${height === screenHeight ? ' is-on' : ''}`}
						data-screen-btn={String(height)}
						onClick={() => {
							setScreenHeight(height);
						}}
					>
						{height}px
					</button>
				))}
				<span className="pv-bar__sep" />
				<button
					type="button"
					className="pv-bar__btn"
					data-all-btn="open"
					onClick={() => {
						setAll(true);
					}}
				>
					全部打开
				</button>
				<button
					type="button"
					className="pv-bar__btn"
					data-all-btn="close"
					onClick={() => {
						setAll(false);
					}}
				>
					全部关闭
				</button>
			</header>

			<div className="pv-scroll">
				<div className="pv-columns">
					{DRAWER_VARIANT_IDS.map((id) => (
						<VariantColumn
							key={id}
							variantId={id}
							screenHeight={screenHeight}
							store={stores[id]}
							onSay={setNotice}
						/>
					))}
				</div>
			</div>

			{notice === undefined ? null : (
				<div className="pv-toast" data-pv-toast="1">
					<span>{notice}</span>
					<button
						type="button"
						onClick={() => {
							setNotice(undefined);
						}}
					>
						知道了
					</button>
				</div>
			)}
		</div>
	);
}

/* 产品样式和预览是同一份 —— 不在预览的 style.css 里抄一份。 */
initRenderers();
injectStyles();
injectMockStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
