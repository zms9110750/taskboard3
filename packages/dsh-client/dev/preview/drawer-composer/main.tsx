/**
 * 抽屉 **单栏模拟页** —— 整页铺满视口，composer 宽照真实 DSH（≈1200px）。
 *
 * 用户 `2026-11-20` 否掉了上一版（三列把面板压成窄高）：
 * 这里**没有任何「模拟屏高」变量**，面板高度就是真实 `50vh` / `min(50vh,480px)`；
 * 页面里的「面板实测」读数由 `getBoundingClientRect()` 在浏览器里读，证明是**宽而扁**
 * （1920×952 视口下 ≈ 1200 × 476，宽高比 2.5 : 1）。
 *
 * ## 看什么
 *
 * - 入口正方形：**右边缘贴输入框左边缘**，和 `+` 同一行、在它左边；
 * - 点入口 ⇒ 面板从输入框上方向外展开，**宽度跟输入框完全一致**（≈1200px）；
 * - 面板底边贴输入框上边缘（间距随形态：0 / 6px / 12px）；
 * - 面板遮挡后方对话内容（浮层，不推挤布局）；
 * - 面板里是**压缩版 Workspace**（真组件，不是示意图）。
 *
 * ## 怎么玩
 *
 * 顶部按钮 / 数字键 1/2/3 切 A / B / C；点入口 / 「开·合」开合；Esc / 点面板外关闭。
 */

import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { initRenderers } from '../../../src/init-renderers.ts';
import {
	DRAWER_VARIANTS,
	DRAWER_VARIANT_IDS,
	createDrawerStore,
} from '../../../src/pure/drawer-view.ts';
import type { DrawerVariantId } from '../../../src/pure/drawer-view.ts';
import { useDrawerStore } from '../../../src/renderers/Drawer.tsx';
import { injectStyles } from '../../../src/styles.ts';
import { MockComposer, injectMockStyles } from '../drawer/mock-composer.tsx';
import { mockWorkspaceProps } from '../drawer/mock-workspace.ts';
import { PanelSizeBadge, usePanelMetrics } from '../drawer/panel-metrics.tsx';

/** 预览页。 */
function App(): React.ReactNode {
	const [variantId, setVariantId] = useState<DrawerVariantId>('b');
	const [selectedId, setSelectedId] = useState<string | null>('GU-02');
	const [notice, setNotice] = useState<string | undefined>(undefined);

	/*
	 * 切形态 ⇒ 换一个 store（形态是 store 的配置）。初始打开，一进来就能看到面板。
	 * ⚠ 切形态会重置开合状态 —— 这是预览的选择，不是产品行为。
	 */
	const store = useMemo(() => createDrawerStore(variantId, true), [variantId]);
	const drawer = useDrawerStore(store);

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
				<span className="pv-bar__tag">抽屉 V5 · 单栏模拟（真 composer 布局 · 整页铺满）</span>
				<span className="pv-bar__note">
					面板宽 = 输入框宽（≈1200px）· 高 = 真实 50vh；点左下入口开合，Esc / 点面板外关闭
				</span>
				<span className="pv-bar__sep" />
				{DRAWER_VARIANT_IDS.map((id, index) => (
					<button
						key={id}
						type="button"
						className={`pv-bar__btn${id === variantId ? ' is-on' : ''}`}
						data-variant-btn={id}
						data-variant-hotkey={String(index + 1)}
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
				<div className="pvs-window" data-single-column="1">
					<div className="pvs-head">
						<span className="pvs-head__title">重构 taskboard2 项目代码</span>
						<span className="pvs-head__chip">标准模式</span>
						<span className="pvs-head__muted">28 个子智能体</span>
						<PanelSizeBadge metrics={metrics} />
					</div>
					<MockComposer
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

/* 产品样式和预览是同一份。 */
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
