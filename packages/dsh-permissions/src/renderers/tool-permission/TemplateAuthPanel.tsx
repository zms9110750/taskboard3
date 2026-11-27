/**
 * 「模板授权」页 —— 什么模板对应什么工具可用。
 *
 * 用户 `2026-11-24`：「什么模板对应什么工具可用还没有界面。」
 *
 * ## 它只做展示，不算并集
 *
 * 生效集（BASE ∪ 未领取 ∪ 通用 ∪ 命中组 ∪ 独立档）由**服务端**用 core 的
 * `effectiveToolsOf()` 算好放在 `GET /api/tool-policy` 的 `effective` 里。
 * 前端只负责「按来源分组解释」，重算一遍就是第二份真值（AGENTS 3.6）。
 *
 * ## 只读
 *
 * 本轮不放任何可编辑控件 —— 写策略仍走 AI 工具 `taskboard_tool_policy_*`。
 * 布局上给将来的开关留了位置（见右栏每段的 `data-source-slot` 占位注释）。
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { buildPath } from '../../api.ts';
import {
	effectiveCounts,
	effectiveToolsFor,
	GLOBAL_TIERS,
	globalContributionOf,
	globalTierSourceOf,
	globalTierSources,
	parseToolPolicy,
	sourcesFor,
	templateOwnSourcesFor,
	unionOfSources,
} from '../../pure/tool-policy.ts';
import type { GlobalTierKey, PolicySource, ToolPolicySnapshot } from '../../pure/tool-policy.ts';
import type { TemplateSummary } from '../../types.ts';

/**
 * 左栏选中了什么。
 *
 * 用户 `2026-11-24`：「这个领卡通用和未领卡的，要放在跟模板的同级别。而不是右边。
 * 因为这两个档位不归属某一个模板。」
 * ⇒ 左栏有两类可选项：全局档位、模板。**互斥**。
 */
type Selection =
	| { readonly kind: 'template'; readonly ref: string }
	| { readonly kind: 'tier'; readonly key: GlobalTierKey };

/** 取数结局。 */
type LoadState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ok'; readonly policy: ToolPolicySnapshot; readonly templates: readonly TemplateSummary[] }
	| { readonly kind: 'failed'; readonly reason: string };

/** 一次取数（失败返回原因字符串，不抛）。 */
export async function fetchJson(path: string, signal: AbortSignal): Promise<unknown | string> {
	let response: Response;
	try {
		response = await fetch(buildPath(path), { signal, headers: { accept: 'application/json' } });
	} catch (cause) {
		if (cause instanceof DOMException && cause.name === 'AbortError') return '已取消';
		return `无法连接任务板服务：${cause instanceof Error ? cause.message : String(cause)}`;
	}
	if (!response.ok) return `服务返回 HTTP ${String(response.status)}`;
	try {
		return await response.json();
	} catch {
		return '服务返回了非 JSON 内容';
	}
}

/** 从标准信封里取 data（`{ ok, data }`）。 */
export function dataOf(raw: unknown): unknown {
	if (typeof raw !== 'object' || raw === null) return undefined;
	return (raw as Record<string, unknown>)['data'];
}

/** 从 `{ templates: [...] }` 里取模板清单（只认形状对的条目）。 */
export function templatesOf(raw: unknown): readonly TemplateSummary[] {
	const data = dataOf(raw);
	if (typeof data !== 'object' || data === null) return [];
	const list = (data as Record<string, unknown>)['templates'];
	if (!Array.isArray(list)) return [];
	const out: TemplateSummary[] = [];
	for (const one of list) {
		if (typeof one !== 'object' || one === null) continue;
		const record = one as Record<string, unknown>;
		const ref = record['ref'];
		const displayName = record['displayName'];
		const kind = record['kind'];
		const domain = record['domain'];
		if (
			typeof ref !== 'string' ||
			typeof displayName !== 'string' ||
			typeof kind !== 'string' ||
			typeof domain !== 'string'
		) {
			continue;
		}
		out.push({ ref, displayName, kind, domain });
	}
	return out;
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

/** 一段「来源 → 工具」。 */
function SourceSection(props: { readonly source: PolicySource }): ReactNode {
	const { source } = props;
	return (
		<section className="tb3ta-sec" data-source-key={source.key}>
			<header className="tb3ta-sec__head">
				<span className="tb3ta-sec__name">{source.label}</span>
				<span className="tb3ta-sec__count">{String(source.tools.length)}</span>
				{source.locked ? <span className="tb3ta-sec__lock">不可移除</span> : null}
				{/*
				 * 将来的开关位置：写策略要走 AI 工具（或以后在后端加写端点），
				 * 本轮只读 ⇒ 这里故意什么都不渲染，但保留插槽标识。
				 */}
				<span className="tb3ta-sec__slot" data-source-slot={source.key} hidden />
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

/** 页面本体。 */
export function TemplateAuthPanel(): ReactNode {
	const [state, setState] = useState<LoadState>({ kind: 'loading' });
	/**
	 * 左栏选中项。`undefined` = 还没选过（等价于「选第一个模板」）。
	 *
	 * ⚠ 用 `undefined` 而不是直接拿 `templates[0].ref` 初始化：模板是异步来的，
	 *   初始值不能依赖它（否则第一次渲染是「空选中」，闪一下）。
	 */
	const [selection, setSelection] = useState<Selection | undefined>(undefined);

	useEffect(() => {
		const controller = new AbortController();
		void (async () => {
			const [policyRaw, templatesRaw] = await Promise.all([
				fetchJson('tool-policy', controller.signal),
				fetchJson('templates', controller.signal),
			]);
			if (controller.signal.aborted) return;
			if (typeof policyRaw === 'string') {
				setState({ kind: 'failed', reason: policyRaw });
				return;
			}
			if (typeof templatesRaw === 'string') {
				setState({ kind: 'failed', reason: `模板清单取不到：${templatesRaw}` });
				return;
			}
			const policy = parseToolPolicy(dataOf(policyRaw));
			if (policy === undefined) {
				setState({ kind: 'failed', reason: '权限策略的响应形状不对（缺少 baseTools / effective 等字段）' });
				return;
			}
			setState({ kind: 'ok', policy, templates: templatesOf(templatesRaw) });
		})();
		return () => {
			controller.abort();
		};
	}, []);

	if (state.kind === 'loading') {
		return <p className="tb3ta-loading">正在读取权限策略…</p>;
	}
	if (state.kind === 'failed') {
		return (
			<section className="tb3ta-page" data-testid="tab-templates" data-state="failed">
				<p className="tb3ta-banner tb3ta-banner--bad" data-testid="policy-failed">
					读取失败：{state.reason}
				</p>
			</section>
		);
	}

	const { policy, templates } = state;
	const counts = effectiveCounts(policy);
	/*
	 * 选中项归一化：没选过 ⇒ 第一个模板（没有模板才算「什么都没选」）。
	 * 档位可以被选（左栏「档位」那一节），此时右栏显示该档自己的工具。
	 */
	const active: Selection | undefined =
		selection ??
		(templates[0] === undefined ? undefined : { kind: 'template', ref: templates[0].ref });
	const pickedTemplate =
		active?.kind === 'template' ? templates.find((one) => one.ref === active.ref) : undefined;
	const tiers = globalTierSources(policy);

	return (
		<section className="tb3ta-page" data-testid="tab-templates" data-state="ok">
			{/*
			 * 左栏：**档位**（全局，跟模板同一层级）+ 模板清单（按领域分组）
			 *
			 * 用户 `2026-11-24`：「这个领卡通用和未领卡的，要放在跟模板的同级别。而不是右边。
			 * 因为这两个档位不归属某一个模板。」
			 */}
			<aside className="tb3ta-side" data-testid="template-list">
				<div className="tb3ta-side__head">
					<span>档位</span>
					<span className="tb3ta-side__hint">全局</span>
				</div>
				<div className="tb3ta-tiers" data-testid="tier-list">
					{tiers.map((tier) => {
						const key = tier.key as GlobalTierKey;
						const isPicked = active?.kind === 'tier' && active.key === key;
						return (
							<button
								key={key}
								type="button"
								data-tier-key={key}
								data-picked={isPicked ? '1' : '0'}
								className={`tb3ta-tpl tb3ta-tpl--tier${isPicked ? ' is-picked' : ''}`}
								onClick={() => {
									setSelection({ kind: 'tier', key });
								}}
							>
								<span className="tb3ta-tpl__name">{tier.label}</span>
								<span className="tb3ta-tpl__count">{String(tier.tools.length)}</span>
							</button>
						);
					})}
				</div>
				<div className="tb3ta-side__head">
					<span>模板</span>
					<span className="tb3ta-side__hint">{String(templates.length)} 个</span>
				</div>
				<div className="tb3ta-scroll">
					{templates.length === 0 ? (
						<p className="tb3ta-empty">还没有任何模板。</p>
					) : (
						groupByDomain(templates).map((group) => (
							<div className="tb3ta-domain" key={group.domain}>
								<div className="tb3ta-domain__title">{group.domain}</div>
								{group.items.map((one) => {
									const isPicked = pickedTemplate !== undefined && one.ref === pickedTemplate.ref;
									return (
										<button
											key={one.ref}
											type="button"
											data-template-ref={one.ref}
											data-picked={isPicked ? '1' : '0'}
											className={`tb3ta-tpl${isPicked ? ' is-picked' : ''}`}
											onClick={() => {
												setSelection({ kind: 'template', ref: one.ref });
											}}
										>
											<span className="tb3ta-tpl__name">{one.displayName}</span>
											<span className="tb3ta-tpl__count">{String(counts.get(one.ref) ?? 0)}</span>
										</button>
									);
								})}
							</div>
						))
					)}
				</div>
			</aside>

			{/* 右栏：选中的档位 / 模板 */}
			<div className="tb3ta-main" data-testid="template-detail">
				{active === undefined ? (
					<p className="tb3ta-empty">左边还没有可选模板。</p>
				) : active.kind === 'tier' ? (
					<TierDetail policy={policy} tierKey={active.key} />
				) : (
					pickedTemplate !== undefined && <TemplateDetail policy={policy} picked={pickedTemplate} />
				)}
			</div>
		</section>
	);
}

/** 右栏：选中**全局档位**时的内容（它不属于任何模板）。 */
function TierDetail(props: { readonly policy: ToolPolicySnapshot; readonly tierKey: GlobalTierKey }): ReactNode {
	const source = globalTierSourceOf(props.policy, props.tierKey);
	return (
		<>
			<header className="tb3ta-head" data-picked-ref={source.key} data-picked-kind="tier">
				<div className="tb3ta-head__title">
					<span className="tb3ta-head__domain">全局档位</span>
					<span className="tb3ta-head__name">{source.label}</span>
					<code className="tb3ta-head__ref">{source.key}</code>
				</div>
				<p className="tb3ta-head__sum" data-testid="tier-summary">
					这一档贡献 <b>{String(source.tools.length)}</b> 个工具
					（不归属任何模板；对所有模板都生效，见三档并集）
				</p>
			</header>
			<div className="tb3ta-scroll">
				{source.tools.length === 0 ? (
					<p className="tb3ta-empty">这一档还没有配置任何工具。</p>
				) : (
					<SourceSection source={source} />
				)}
				<p className="tb3ta-foot">
					只读视图 —— 改权限走 AI 工具 <code>taskboard_tool_policy</code>，或等后端写入接口。
				</p>
			</div>
		</>
	);
}

/** 右栏：选中**模板**时的内容（全局档位不在这里逐段列，只给一行归属说明）。 */
function TemplateDetail(props: {
	readonly policy: ToolPolicySnapshot;
	readonly picked: TemplateSummary;
}): ReactNode {
	const { policy, picked } = props;
	const contribution = globalContributionOf(policy);
	return (
		<>
			<header className="tb3ta-head" data-picked-ref={picked.ref} data-picked-kind="template">
				<div className="tb3ta-head__title">
					<span className="tb3ta-head__domain">{picked.domain}</span>
					<span className="tb3ta-head__name">{picked.displayName}</span>
					<code className="tb3ta-head__ref">{picked.ref}</code>
				</div>
				<p className="tb3ta-head__sum" data-testid="effective-summary">
					这个模板共可用 <b>{String(effectiveToolsFor(policy, picked.ref).length)}</b> 个工具
					（服务端按三档并集算好；分段只解释来源，重叠时各段之和会大于总数）
				</p>
				{contribution.total === 0 ? null : (
					<p className="tb3ta-head__global" data-testid="global-contribution">
						其中 <b>{String(contribution.total)}</b> 个来自<b>全局档位</b>（未领卡{' '}
						{String(contribution.unclaimed)} + 通用 {String(contribution.common)}）——
						这两档不归属本模板，在左栏「档位」里单独看。
					</p>
				)}
			</header>
			<div className="tb3ta-scroll">
				{templateOwnSourcesFor(policy, picked.ref).map((source) => (
					<SourceSection key={source.key} source={source} />
				))}
				<MismatchNote policy={policy} templateRef={picked.ref} />
				<p className="tb3ta-foot">
					只读视图 —— 改权限走 AI 工具 <code>taskboard_tool_policy</code>，或等后端写入接口。
				</p>
			</div>
		</>
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
