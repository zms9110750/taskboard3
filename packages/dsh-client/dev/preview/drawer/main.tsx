/**
 * 抽屉 **候选形态对比页（切换器版）** —— 用户 `2026-11-20` 否掉了上一版「三列并排」：
 *
 * > 「莫写着模拟屏高。然后用高而窄的放抽屉面板做什么」
 *
 * 三列并排会把每列压到 ~480px，面板变成「窄高」，三个候选的间距 / 圆角 / 阴影 /
 * 遮罩**根本看不出来**。⇒ 现在**一次只显示一个变体、占满宽度**：
 *
 * | 量 | 真实值（用户从截图量） |
 * |---|---|
 * | 输入框宽 | ≈ **1200px** |
 * | 屏高 | 952px ⇒ 面板高 ≈ **476px** |
 * | 面板 | ≈ **1200 × 476**，宽高比 **2.5 : 1**（宽而扁）|
 *
 * - 顶部按钮 / 数字键 `1` `2` `3` 切 A / B / C；页面里显示**实测尺寸**（`getBoundingClientRect`）。
 * - 点 composer 左下角的正方形入口：开 / 合；Esc / 点面板外关闭。
 * - 面板高度是**真实 `50vh` / `min(50vh,480px)`** —— 没有任何「模拟屏高」变量。
 *
 * ## 真 / 假
 *
 * - **真**：`DrawerEntry` / `Drawer` / 面板里的 `<Workspace />` 全是 `src/` 同一份；
 *   产品 CSS 由 `injectStyles()` 注入（与产品同一份）；composer 结构照 asar 原文 mock。
 * - **假**：对话内容、`+`、发送键是 mock（没有服务端）。
 */

import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { initRenderers } from '../../../src/init-renderers.ts';
import {
	DRAWER_VARIANTS,
	DRAWER_VARIANT_IDS,
	createDrawerStore,
} from '../../../src/pure/drawer-view.ts';
import type { DrawerStore, DrawerVariantId } from '../../../src/pure/drawer-view.ts';
import { useDrawerStore } from '../../../src/renderers/Drawer.tsx';
import { injectStyles } from '../../../src/styles.ts';
import { ComposerFrame } from './composer-frame.tsx';
import { injectMockStyles } from './mock-composer.tsx';
import { mockWorkspaceProps } from './mock-workspace.ts';
import { PanelSizeBadge, usePanelMetrics } from './panel-metrics.tsx';

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

/** 预览页。 */
function App(): React.ReactNode {
	const [variantId, setVariantId] = useState<DrawerVariantId>('a');
	const [selectedId, setSelectedId] = useState<string | null>('GU-02');
	const [notice, setNotice] = useState<string | undefined>(undefined);

	/*
	 * 三个形态各一个 store（切换时开合状态保留）。
	 * 形态是 store 的配置，所以切形态 = 用另一个 store，**不是**改当前 store。
	 */
	const stores = useMemo((): Readonly<Record<DrawerVariantId, DrawerStore>> => {
		const created = {} as Record<DrawerVariantId, DrawerStore>;
		for (const id of DRAWER_VARIANT_IDS) created[id] = createDrawerStore(id, true);
		return created;
	}, []);
	const store = stores[variantId];
	const drawer = useDrawerStore(store);

	/* 当前展示的形态 + 它在真浏览器里的实测尺寸（宽 × 高）。 */
	const variant = DRAWER_VARIANTS[variantId];
	const metrics = usePanelMetrics('[data-drawer="1"]', [variantId, drawer.open]);

	const workspace = useMemo(
		() =>
			mockWorkspaceProps({
				selectedId,
				onSelect: setSelectedId,
				onSay: setNotice,
			}),
		[selectedId],
	);

	/* 数字键 1/2/3 切形态（不抢输入框焦点 —— 预览里没有输入框）。 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.defaultPrevented) return;
			const index = DRAWER_VARIANT_IDS.indexOf(event.key as DrawerVariantId);
			if (index < 0) return;
			const nextId = DRAWER_VARIANT_IDS[index];
			if (nextId !== undefined) setVariantId(nextId);
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
		};
	}, []);

	return (
		<div className="pv">
			<header className="pv-bar">
				<span className="pv-bar__tag">抽屉 V5 · 候选形态（一次一个 · 占满宽度）</span>
				<span className="pv-bar__note">
					宽 = 输入框宽（≈1200px）· 高 = 50vh · 按 1/2/3 或点按钮切 A/B/C；点左下入口开合，Esc / 点面板外关闭
				</span>
				<span className="pv-bar__sep" />
				{DRAWER_VARIANT_IDS.map((id, index) => (
					<button
						key={id}
						type="button"
						className={`pv-bar__btn${id === variantId ? ' is-on' : ''}`}
						data-compare-variant={id}
						data-compare-hotkey={String(index + 1)}
						onClick={() => {
							setVariantId(id);
						}}
					>
						{index + 1} · {DRAWER_VARIANTS[id].label}
					</button>
				))}
				<span className="pv-bar__sep" />
				<button
					type="button"
					className={`pv-bar__btn${drawer.open ? ' is-on' : ''}`}
					data-drawer-toggle="1"
					onClick={drawer.toggle}
				>
					{drawer.open ? '抽屉：开' : '抽屉：关'}
				</button>
			</header>

			<div className="pv-scroll">
				<section className="pv-stage" data-variant-column={variantId}>
					<header className="pv-stage__head">
						<div className="pv-stage__line">
							<span className="pv-stage__tag" data-variant-label={variantId}>
								{variant.label}
							</span>
							<PanelSizeBadge metrics={metrics} />
						</div>
						<div className="pv-stage__summary">{variant.summary}</div>
					</header>
					<ComposerFrame
						variant={variant}
						open={drawer.open}
						onToggle={drawer.toggle}
						onClose={drawer.close}
						workspace={workspace}
						title="任务板"
						onRefresh={() => {
							setNotice('抽屉：刷新（预览：没有服务端）');
						}}
					/>
				</section>
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
