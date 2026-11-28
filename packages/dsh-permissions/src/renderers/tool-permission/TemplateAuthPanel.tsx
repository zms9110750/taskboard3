/**
 * 「模板授权」页 —— 什么模板 / 档位对应什么工具可用（issue #56 / #57）。
 *
 * 用户 `2026-11-24`：「什么模板对应什么工具可用还没有界面。」
 * 用户 `2026-11-28`（issue #57）：「授权界面无法选中一个模板或者档位。也无法进行编辑。」
 *
 * ## 它负责什么
 *
 * ```
 *  ① 读 GET /api/tool-policy + GET /api/templates（失败要显示原因，不静默）
 *  ② 左栏：档位 / 模板 / 每个领域块 —— 都可折叠（FoldPill + FoldRect，复用 issue #52 的组件）
 *  ③ 选中：档位或模板（互斥），选中态 = 左侧竖条 + 底色 + 加粗
 *  ④ 编辑：勾选工具 → PUT /api/tool-policy（tier 或 templateRef + allow/remove）→ 用返回的视图刷新
 *  ⑤ 不能编辑时**说明原因**（BASE 不可移除 / 模板已不在清单 / 还没选）
 * ```
 *
 * ## 为什么编辑集合是「本档增量」而不是「生效集」
 *
 * 生效集（BASE ∪ 未领卡 ∪ 通用 ∪ 命中组 ∪ 独立档）由**服务端**用 core 的
 * `effectiveToolsOf()` 算好。把它当可编辑集合，一保存就会把上游档位的工具
 * **复制**成本档的增量 —— 并集语义被悄悄改掉。所以编辑器只动本档自己的那一段
 * （档位 = `unclaimed` / `common`；模板 = `templates[ref]`），决策在
 * `src/pure/tool-policy-edit.ts`（有单测）。
 *
 * ## 只读的地方
 *
 * BASE 工具恒可用、不可移除：编辑器里显示为**已勾选 + 禁用**，并写明原因；
 * `putBodyOf()` 也会把它们从 allow/remove 里剔掉（服务端同样保护）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { FoldPill, FoldRect } from '@taskboard/dsh-client/fold-pill';

import { browserFoldStorage, foldPrefKeyOf, readFoldPref, writeFoldPref } from '../../pure/fold-pref.ts';
import {
	diffOf,
	editabilityOf,
	pickerToolsOf,
	putBodyOf,
	scopeToolsOf,
	selectionKeyOf,
} from '../../pure/tool-policy-edit.ts';
import type { AuthSelection, Editability } from '../../pure/tool-policy-edit.ts';
import {
	effectiveCounts,
	effectiveToolsFor,
	globalContributionOf,
	globalTierSourceOf,
	globalTierSources,
	parseToolPolicy,
	sourcesFor,
	templateOwnSourcesFor,
	unionOfSources,
} from '../../pure/tool-policy.ts';
import type { GlobalTierKey, PolicySource, ToolPolicySnapshot } from '../../pure/tool-policy.ts';
import type { ToolEntry } from '../../pure/tool-permission.ts';
import type { TemplateSummary } from '../../types.ts';
import { requestJson, templatesOf } from '../../wire.ts';
import { SaveStatusBar, type SaveState } from './SaveStatusBar.tsx';

/** 取数结局。 */
type LoadState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ok'; readonly policy: ToolPolicySnapshot; readonly templates: readonly TemplateSummary[] }
	| { readonly kind: 'failed'; readonly reason: string };

/** 编辑器的会话状态（打开时才有）。 */
interface EditorState {
	/** 用户勾选后的**完整**集合（含 BASE —— BASE 恒勾、禁用）。 */
	readonly picked: ReadonlySet<string>;
	/** 工具搜索词。 */
	readonly query: string;
}

/** 模板选择器里的一个领域分组。 */
function groupByDomain(templates: readonly TemplateSummary[]): readonly { domain: string; items: readonly TemplateSummary[] }[] {
	const map = new Map<string, TemplateSummary[]>();
	for (const one of templates) {
		const list = map.get(one.domain);
		if (list === undefined) map.set(one.domain, [one]);
		else list.push(one);
	}
	return [...map.entries()].map(([domain, items]) => ({ domain, items }));
}

/** 折叠键：左栏三处（档位 / 模板 / 领域）。 */
const TIERS_FOLD_KEY = 'auth:tiers';
const TEMPLATES_FOLD_KEY = 'auth:templates';
const domainFoldKeyOf = (domain: string): string => `auth:domain:${domain}`;

/** 折叠状态表（key → 展开）；缺键 = 由偏好 / 默认决定。 */
type FoldMap = Readonly<Record<string, boolean>>;

/** 折叠是否展开（缺键 = 展开）。 */
function foldOpenOf(folds: FoldMap, key: string): boolean {
	return folds[key] !== false;
}

/* ══════════════════════════════════════════════════════════
   左栏（纯展示）：档位 / 模板 / 领域 —— 全部 FoldPill + FoldRect
   ══════════════════════════════════════════════════════════ */

/** `AuthSidebar` 的 props。 */
export interface AuthSidebarProps {
	readonly policy: ToolPolicySnapshot;
	readonly templates: readonly TemplateSummary[];
	readonly selection: AuthSelection | undefined;
	/** 折叠状态（键见 `TIERS_FOLD_KEY` / `TEMPLATES_FOLD_KEY` / `domainFoldKeyOf()`）。 */
	readonly folds: FoldMap;
	readonly onSelect: (selection: AuthSelection) => void;
	readonly onToggleFold: (key: string) => void;
}

/**
 * 授权页左栏（issue #56 / #57）。
 *
 * @param props 见 `AuthSidebarProps`
 */
export function AuthSidebar(props: AuthSidebarProps): ReactNode {
	const { policy, templates, selection, folds } = props;
	const tiers = globalTierSources(policy);
	const counts = effectiveCounts(policy);
	const tierOpen = foldOpenOf(folds, TIERS_FOLD_KEY);
	const templatesOpen = foldOpenOf(folds, TEMPLATES_FOLD_KEY);

	return (
		<aside className="tb3ta-side" data-testid="template-list">
			<div className="tb3ta-fold" data-fold="tiers">
				<FoldPill
					open={tierOpen}
					label="档位"
					count={tiers.length}
					countSuffix=" 个"
					tone={selection?.kind === 'tier' ? 'selected' : 'plain'}
					onToggle={() => props.onToggleFold(TIERS_FOLD_KEY)}
				/>
				<FoldRect open={tierOpen}>
					<div className="tb3ta-tiers" data-testid="tier-list">
						{tiers.map((tier) => {
							const key = tier.key as GlobalTierKey;
							const isPicked = selection?.kind === 'tier' && selection.key === key;
							return (
								<button
									key={key}
									type="button"
									data-tier-key={key}
									data-picked={isPicked ? '1' : '0'}
									aria-pressed={isPicked}
									className={`tb3ta-tpl tb3ta-tpl--tier${isPicked ? ' is-picked' : ''}`}
									onClick={() => props.onSelect({ kind: 'tier', key })}
								>
									<span className="tb3ta-tpl__name">{tier.label}</span>
									<span className="tb3ta-tpl__count">{String(tier.tools.length)}</span>
								</button>
							);
						})}
					</div>
				</FoldRect>
			</div>

			<div className="tb3ta-fold" data-fold="templates">
				<FoldPill
					open={templatesOpen}
					label="模板"
					count={templates.length}
					countSuffix=" 个"
					tone={selection?.kind === 'template' ? 'selected' : 'plain'}
					onToggle={() => props.onToggleFold(TEMPLATES_FOLD_KEY)}
				/>
				<FoldRect open={templatesOpen}>
					<div className="tb3ta-tpls" data-testid="template-rows">
						{templates.length === 0 ? (
							<p className="tb3ta-empty">还没有任何模板。</p>
						) : (
							groupByDomain(templates).map((group) => {
								const domainKey = domainFoldKeyOf(group.domain);
								const domainOpen = foldOpenOf(folds, domainKey);
								return (
									<div className="tb3ta-fold tb3ta-fold--domain" data-fold={`domain:${group.domain}`} key={group.domain}>
										<FoldPill
											open={domainOpen}
											label={group.domain}
											count={group.items.length}
											countSuffix=" 个"
											onToggle={() => props.onToggleFold(domainKey)}
										/>
										<FoldRect open={domainOpen}>
											<div className="tb3ta-domain" data-domain={group.domain}>
												{group.items.map((one) => {
													const isPicked = selection?.kind === 'template' && one.ref === selection.ref;
													return (
														<button
															key={one.ref}
															type="button"
															data-template-ref={one.ref}
															data-picked={isPicked ? '1' : '0'}
															aria-pressed={isPicked}
															className={`tb3ta-tpl${isPicked ? ' is-picked' : ''}`}
															onClick={() => props.onSelect({ kind: 'template', ref: one.ref })}
														>
															<span className="tb3ta-tpl__name">{one.displayName}</span>
															<span className="tb3ta-tpl__count">{String(counts.get(one.ref) ?? 0)}</span>
														</button>
													);
												})}
											</div>
										</FoldRect>
									</div>
								);
							})
						)}
					</div>
				</FoldRect>
			</div>
		</aside>
	);
}

/* ══════════════════════════════════════════════════════════
   编辑器（纯展示，受控）
   ══════════════════════════════════════════════════════════ */

/** `PolicyEditor` 的 props。 */
export interface PolicyEditorProps {
	/** 正在编辑的档位 / 模板的人话名字。 */
	readonly title: string;
	/** 候选工具名（`pickerToolsOf()` 的结果，未过滤）。 */
	readonly toolNames: readonly string[];
	/** 当前勾选（含 BASE）。 */
	readonly picked: ReadonlySet<string>;
	/** 恒可用不可移除的工具名。 */
	readonly baseTools: readonly string[];
	/** 搜索词。 */
	readonly query: string;
	readonly onToggle: (name: string) => void;
	readonly onQuery: (query: string) => void;
	readonly onSave: () => void;
	readonly onCancel: () => void;
	readonly saveState: SaveState;
}

/**
 * 授权编辑器。
 *
 * @param props 见 `PolicyEditorProps`
 */
export function PolicyEditor(props: PolicyEditorProps): ReactNode {
	const base = new Set(props.baseTools);
	const query = props.query.trim().toLowerCase();
	const rows = props.toolNames.filter((name) => query === '' || name.toLowerCase().includes(query));

	return (
		<div className="tb3ta-editor" data-testid="policy-editor">
			<header className="tb3ta-editor__head">
				<span className="tb3ta-editor__title">编辑「{props.title}」的授权工具</span>
				<span className="tb3ta-editor__hint">勾选 = 本档直接给出（BASE 恒可用，不可移除）</span>
			</header>
			<input
				className="tb3g-input tb3g-input--side"
				data-testid="editor-filter"
				placeholder="搜索工具…"
				value={props.query}
				onChange={(event) => props.onQuery(event.target.value)}
			/>
			<div className="tb3ta-editor__list">
				{rows.length === 0 ? <p className="tb3ta-empty">没有匹配的工具。</p> : null}
				{rows.map((name) => {
					const locked = base.has(name);
					const checked = locked || props.picked.has(name);
					return (
						<label
							key={name}
							className={`tb3ta-editor__row${checked ? ' is-checked' : ''}${locked ? ' is-locked' : ''}`}
							data-tool-name={name}
							data-locked={locked ? '1' : '0'}
							title={locked ? 'BASE 恒可用 —— 已在所有模板里生效，不能移除' : undefined}
						>
							<input type="checkbox" checked={checked} disabled={locked} onChange={() => props.onToggle(name)} />
							<span className="tb3ta-editor__name">{name}</span>
							{locked ? <span className="tb3ta-editor__tag">BASE 恒可用</span> : null}
						</label>
					);
				})}
			</div>
			<footer className="tb3ta-editor__foot">
				<SaveStatusBar state={props.saveState} idleText="改动还没保存" />
				<button type="button" className="tb3g-btn tb3g-btn--primary" data-action="auth-save" onClick={props.onSave}>
					保存
				</button>
				<button type="button" className="tb3g-btn" data-action="auth-cancel" onClick={props.onCancel}>
					取消
				</button>
			</footer>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   编辑入口 / 不可编辑原因（纯展示）
   ══════════════════════════════════════════════════════════ */

/** `EditButton` 的 props。 */
export interface EditButtonProps {
	readonly editability: Editability;
	readonly onEdit: () => void;
}

/**
 * 「编辑授权」按钮 —— 不能编辑时**禁用并把原因挂 title**（issue #57）。
 *
 * @param props 见 `EditButtonProps`
 */
export function EditButton(props: EditButtonProps): ReactNode {
	return (
		<button
			type="button"
			className="tb3g-btn tb3g-btn--tiny tb3ta-head__edit"
			data-action="auth-edit"
			data-editable={props.editability.editable ? '1' : '0'}
			disabled={!props.editability.editable}
			{...(props.editability.editable ? {} : { title: props.editability.reason })}
			onClick={props.onEdit}
		>
			编辑授权
		</button>
	);
}

/**
 * 「不能编辑：<原因>」—— 只有不能编辑时才出现。
 *
 * @param props 判决结果
 */
export function EditBlockedReason(props: { readonly editability: Editability }): ReactNode {
	if (props.editability.editable) return null;
	return (
		<p className="tb3ta-readonly" data-testid="edit-blocked-reason">
			不能编辑：{props.editability.reason}
		</p>
	);
}

/* ══════════════════════════════════════════════════════════
   页面本体（取数 + 状态）
   ══════════════════════════════════════════════════════════ */

/** `TemplateAuthPanel` 的 props。 */
export interface TemplateAuthPanelProps {
	/** 宿主工具清单（编辑器候选；取不到时用降级夹具，与组图页一致）。 */
	readonly tools?: readonly ToolEntry[];
}

/** 页面本体。 */
export function TemplateAuthPanel(props: TemplateAuthPanelProps): ReactNode {
	const [state, setState] = useState<LoadState>({ kind: 'loading' });
	const [reloadToken, setReloadToken] = useState(0);
	/**
	 * 左栏选中项。`undefined` = 还没选过（等价于「选第一个模板」）。
	 *
	 * ⚠ 用 `undefined` 而不是直接拿 `templates[0].ref` 初始化：模板是异步来的，
	 *   初始值不能依赖它（否则第一次渲染是「空选中」，闪一下）。
	 */
	const [selection, setSelection] = useState<AuthSelection | undefined>(undefined);
	const [folds, setFolds] = useState<FoldMap>({});
	const [editor, setEditor] = useState<EditorState | undefined>(undefined);
	const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
	const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

	/* 存储端口：浏览器有 localStorage；测试 / SSR 没有 ⇒ 偏好回落默认值。 */
	const storage = useMemo(() => browserFoldStorage(), []);

	useEffect(() => {
		const controller = new AbortController();
		void (async () => {
			const [policyResult, templatesResult] = await Promise.all([
				requestJson('GET', 'tool-policy', { signal: controller.signal }),
				requestJson('GET', 'templates', { signal: controller.signal }),
			]);
			if (controller.signal.aborted) return;
			if (!policyResult.ok) {
				setState({ kind: 'failed', reason: `权限策略读不到：${policyResult.failure.message}` });
				return;
			}
			if (!templatesResult.ok) {
				setState({ kind: 'failed', reason: `模板清单读不到：${templatesResult.failure.message}` });
				return;
			}
			const policy = parseToolPolicy(policyResult.data);
			if (policy === undefined) {
				setState({ kind: 'failed', reason: '权限策略的响应形状不对（缺少 baseTools / effective 等字段）' });
				return;
			}
			setState({ kind: 'ok', policy, templates: templatesOf(templatesResult.data) });
		})();
		return () => {
			controller.abort();
		};
	}, [reloadToken]);

	/* ── 折叠：键 = 屏幕上存在的那些（领域按数据来）── */
	const foldKeys = useMemo(() => {
		if (state.kind !== 'ok') return [] as readonly string[];
		return [
			TIERS_FOLD_KEY,
			TEMPLATES_FOLD_KEY,
			...groupByDomain(state.templates).map((group) => domainFoldKeyOf(group.domain)),
		];
	}, [state]);

	/** 每个键的当前展开态（用户点过的优先，否则读偏好，否则默认展开）。 */
	const foldMap = useMemo((): FoldMap => {
		const out: Record<string, boolean> = {};
		for (const key of foldKeys) {
			out[key] = folds[key] ?? readFoldPref(storage, foldPrefKeyOf(key), true);
		}
		return out;
	}, [foldKeys, folds, storage]);

	const toggleFold = useCallback(
		(key: string): void => {
			const next = !foldOpenOf(foldMap, key);
			setFolds((current) => ({ ...current, [key]: next }));
			writeFoldPref(storage, foldPrefKeyOf(key), next);
		},
		[foldMap, storage],
	);

	if (state.kind === 'loading') {
		return <p className="tb3ta-loading">正在读取权限策略…</p>;
	}
	if (state.kind === 'failed') {
		return (
			<section className="tb3ta-page" data-testid="tab-templates" data-state="failed">
				<p className="tb3ta-banner tb3ta-banner--bad" data-testid="policy-failed" role="alert">
					读取失败：{state.reason}
				</p>
				<button type="button" className="tb3g-btn" data-action="reload-policy" onClick={() => setReloadToken((one) => one + 1)}>
					重新读取
				</button>
			</section>
		);
	}

	const { policy, templates } = state;
	const toolEntries = props.tools ?? [];
	const toolNames = toolEntries.map((one) => one.name);

	/*
	 * 选中项归一化：没选过 ⇒ 第一个模板（没有模板才算「什么都没选」）。
	 * 档位可以被选（左栏「档位」那一节），此时右栏显示该档自己的工具。
	 */
	const active: AuthSelection | undefined =
		selection ?? (templates[0] === undefined ? undefined : { kind: 'template', ref: templates[0].ref });
	const pickedTemplate = active?.kind === 'template' ? templates.find((one) => one.ref === active.ref) : undefined;
	const pickability = editabilityOf(active, templates);

	/** 本档当前增量（编辑器的「原值」）。 */
	const currentTools = scopeToolsOf(policy, active);

	/** 右栏标题（档位 / 模板各一种）。 */
	const activeLabel =
		active?.kind === 'tier'
			? globalTierSourceOf(policy, active.key).label
			: (pickedTemplate?.displayName ?? '（未选）');

	const startEdit = (): void => {
		if (!pickability.editable || active === undefined) return;
		setEditor({ picked: new Set([...policy.baseTools, ...currentTools]), query: '' });
		setSaveState({ kind: 'idle' });
		setNotice(null);
	};

	const cancelEdit = (): void => {
		setEditor(undefined);
		setSaveState({ kind: 'idle' });
	};

	const toggleEditTool = (name: string): void => {
		if (policy.baseTools.includes(name)) return;
		setEditor((prev) => {
			if (prev === undefined) return prev;
			const next = new Set(prev.picked);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return { ...prev, picked: next };
		});
	};

	/** 保存：只发差集（`PUT /api/tool-policy`），成功用返回的视图刷新。 */
	const saveEdit = async (): Promise<void> => {
		if (editor === undefined || active === undefined) return;
		const body = putBodyOf(active, diffOf(currentTools, [...editor.picked]), policy.baseTools);
		if (body === undefined) {
			setEditor(undefined);
			setNotice({ kind: 'ok', text: '没有改动，什么都没发。' });
			return;
		}
		setSaveState({ kind: 'saving' });
		const result = await requestJson('PUT', 'tool-policy', { body });
		if (!result.ok) {
			setSaveState({
				kind: 'failed',
				message: result.failure.message,
				...(result.failure.code === undefined ? {} : { code: result.failure.code }),
			});
			return;
		}
		const updated = parseToolPolicy(result.data);
		if (updated === undefined) {
			setSaveState({ kind: 'failed', message: '保存后服务端返回的策略形状不对' });
			return;
		}
		setState({ kind: 'ok', policy: updated, templates });
		setEditor(undefined);
		setSaveState({ kind: 'saved', at: new Date().toLocaleTimeString() });
		setNotice({ kind: 'ok', text: `已保存「${activeLabel}」的授权` });
	};

	return (
		<section className="tb3ta-page" data-testid="tab-templates" data-state="ok" data-selection={selectionKeyOf(active)}>
			<AuthSidebar
				policy={policy}
				templates={templates}
				selection={active}
				folds={foldMap}
				onSelect={(next) => {
					setSelection(next);
					setEditor(undefined);
					setSaveState({ kind: 'idle' });
					setNotice(null);
				}}
				onToggleFold={toggleFold}
			/>

			{/* 右栏：选中的档位 / 模板（或编辑器） */}
			<div className="tb3ta-main" data-testid="template-detail">
				{active === undefined ? (
					<p className="tb3ta-empty">左边还没有可选模板。</p>
				) : (
					<>
						<header className="tb3ta-head">
							<div className="tb3ta-head__title">
								<span className="tb3ta-head__domain">{active.kind === 'tier' ? '全局档位' : (pickedTemplate?.domain ?? '模板')}</span>
								<span className="tb3ta-head__name">{activeLabel}</span>
								<code className="tb3ta-head__ref">
									{active.kind === 'tier' ? active.key : (pickedTemplate?.ref ?? active.ref)}
								</code>
								{editor === undefined ? <EditButton editability={pickability} onEdit={startEdit} /> : null}
							</div>
							<p className="tb3ta-head__sum" data-testid={active.kind === 'tier' ? 'tier-summary' : 'effective-summary'}>
								{active.kind === 'tier' ? (
									<>
										这一档直接给出 <b>{String(currentTools.length)}</b> 个工具（不归属任何模板；对所有模板都生效）
									</>
								) : (
									<>
										这个模板共可用 <b>{String(effectiveToolsFor(policy, active.ref).length)}</b> 个工具
										（服务端按三档并集算好；分段只解释来源，重叠时各段之和会大于总数）
									</>
								)}
							</p>
							{active.kind === 'template' ? <TemplateGlobalLine policy={policy} /> : null}
							{/* 不能编辑时**说明原因**（issue #57 的硬要求） */}
							{editor === undefined ? <EditBlockedReason editability={pickability} /> : null}
						</header>

						{notice === null ? null : (
							<div className={`tb3ta-banner${notice.kind === 'bad' ? ' tb3ta-banner--bad' : ''}`} data-testid="auth-notice" role="status">
								{notice.text}
							</div>
						)}

						{editor === undefined ? (
							<div className="tb3ta-scroll">
								{active.kind === 'tier' ? (
									<TierSections policy={policy} tierKey={active.key} />
								) : (
									<TemplateSections policy={policy} templateRef={active.ref} />
								)}
								<p className="tb3ta-foot">
									只读视图 + 就地编辑 —— 编辑只改<b>本档自己的增量</b>，不动其它档；
									也可以继续走 AI 工具 <code>taskboard_tool_policy</code>。
								</p>
							</div>
						) : (
							<PolicyEditor
								title={activeLabel}
								toolNames={pickerToolsOf(toolNames, currentTools)}
								picked={editor.picked}
								baseTools={policy.baseTools}
								query={editor.query}
								onToggle={toggleEditTool}
								onQuery={(query) => setEditor((prev) => (prev === undefined ? prev : { ...prev, query }))}
								onSave={() => {
									void saveEdit();
								}}
								onCancel={cancelEdit}
								saveState={saveState}
							/>
						)}
					</>
				)}
			</div>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   右栏的分段（档位 / 模板）
   ══════════════════════════════════════════════════════════ */

/** 选中档位时的来源分段。 */
function TierSections(props: { readonly policy: ToolPolicySnapshot; readonly tierKey: GlobalTierKey }): ReactNode {
	const source = globalTierSourceOf(props.policy, props.tierKey);
	if (source.tools.length === 0) return <p className="tb3ta-empty">这一档还没有配置任何工具。</p>;
	return <SourceSection source={source} />;
}

/** 选中模板时的来源分段 + 一致性核对。 */
function TemplateSections(props: { readonly policy: ToolPolicySnapshot; readonly templateRef: string }): ReactNode {
	return (
		<>
			{templateOwnSourcesFor(props.policy, props.templateRef).map((source) => (
				<SourceSection key={source.key} source={source} />
			))}
			<MismatchNote policy={props.policy} templateRef={props.templateRef} />
		</>
	);
}

/** 「其中 N 个来自全局档位」一行。 */
function TemplateGlobalLine(props: { readonly policy: ToolPolicySnapshot }): ReactNode {
	const contribution = globalContributionOf(props.policy);
	if (contribution.total === 0) return null;
	return (
		<p className="tb3ta-head__global" data-testid="global-contribution">
			其中 <b>{String(contribution.total)}</b> 个来自<b>全局档位</b>（未领卡 {String(contribution.unclaimed)} + 通用{' '}
			{String(contribution.common)}）—— 这两档不归属本模板，在左栏「档位」里单独看。
		</p>
	);
}

/** 一段「来源 → 工具」。 */
function SourceSection(props: { readonly source: PolicySource }): ReactNode {
	const { source } = props;
	return (
		<section className="tb3ta-sec" data-source-key={source.key}>
			<header className="tb3ta-sec__head">
				<span className="tb3ta-sec__name">{source.label}</span>
				<span className="tb3ta-sec__count">{String(source.tools.length)}</span>
				{source.locked ? <span className="tb3ta-sec__lock">不可移除</span> : null}
			</header>
			<ul className="tb3ta-tools">
				{source.tools.map((tool) => (
					<li className="tb3ta-tools__item" key={`${source.key}:${tool}`}>
						{tool}
					</li>
				))}
			</ul>
		</section>
	);
}

/** 分段并集 vs 服务端生效集不一致时**明确报出来**（不许静默）。 */
function MismatchNote(props: { readonly policy: ToolPolicySnapshot; readonly templateRef: string }): ReactNode {
	const union = unionOfSources(sourcesFor(props.policy, props.templateRef));
	const effective = effectiveToolsFor(props.policy, props.templateRef);
	if (union.length === effective.length && union.every((one) => effective.includes(one))) return null;
	return (
		<p className="tb3ta-banner tb3ta-banner--bad" data-testid="policy-mismatch">
			分段并集（{String(union.length)} 个）与服务端生效集（{String(effective.length)} 个）不一致 ——
			说明并集规则和分段视图不同步，请报告这个差异。
		</p>
	);
}
