/**
 * 建卡页的样式 —— 前缀 `tb3cc-`。
 *
 * ## ⚠ 为什么单独一个 `.ts` 文件（CSS 跟着组件走）
 *
 * 用户要求：**CSS 必须跟着组件走**，不再把所有组件的样式堆在 `src/styles.ts`。
 * 这段 CSS 服务的是 `src/renderers/create/` 下的组件（`CardCreate` / `CreateLeftColumn` /
 * `MetaPanelContent` / `MetaTabs` / `SectionEditorAsk` / `SectionFormList` /
 * `TemplatePickerPopover` 等），所以真值就放在组件目录里。
 *
 * 它仍要被两处用：
 *
 * ```
 * src/renderers/create/*.tsx   ← 组件就在这份 CSS 的目录里（归属明确）
 * src/styles.ts                ← 产品注入 injectStyles() 时拼进去
 * ```
 *
 * `styles.ts` **不能 import `.tsx`**（`node --test` 直接跑 TS 源码时只认 `.ts`），
 * 所以真值必须落在纯 `.ts`：`styles.ts` import 本文件并 `export { CREATE_CSS }` 转发，
 * `test/create-layout.test.ts` 继续从 `styles.ts` 拿到它。
 * `test/css-ownership.test.ts` 断言两边是**同一个引用** ⇒ 物理上不可能漂移。
 *
 * ## 为什么不并进 styles.ts 的主表
 *
 * 主表（现在仍在 `styles.ts`）的类名是 `tb3-*`，是**任务板面板内部**的（tab 里那套）。建卡页是一整页
 * （顶栏 / 左右两栏 / 底栏）—— 两套样式的作用域不同。
 *
 * ⇒ 分开：出问题时能一眼看出「这条规则属于建卡页还是面板内」。
 *
 * ## ⚠ 建卡页**填满它的父容器**（`height:100%` + `container-type:size`）
 *
 * 早期版本是 `position:fixed; inset:0`（「铺满浏览器」）。用户 `2026-11-19` 给了
 * 三个真实尺寸（工作区 570×920 / 抽屉 1200×400 / 全屏 1600×1000）之后那就不成立了：
 * **fixed 会脱离父容器**，挂在窄 tab 里也按整个窗口铺开。
 * 现在靠 `container-type:size` 做容器查询，父容器给多高就多高。
 *
 * ## ⚠ 关键：`.tb3cc-page__body { min-height: 0 }`
 *
 * flex 子元素默认 `min-height: auto`，会被内容撑高 ⇒ 子元素的
 * `overflow-y: auto` **永远不生效** ⇒ 整页滚动、顶栏底栏跟着滚走。
 * 这是 flex 里最常见的坑，加注释钉住。
 *
 * ## ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（TS1005）
 */
export const CREATE_CSS = `
/*
 * ── 页面本体：**填满父容器**，不是铺满浏览器 ──
 *
 * 用户 2026-11-19 给了三个真实尺寸，旧版这里是 position:fixed + inset:0：
 *
 * | 场景 | 尺寸 |
 * |---|---|
 * | 工作区 | 570 × 920（窄、高）|
 * | 抽屉 | 1200 × 400（宽、矮）|
 * | 全屏 | 1600 × 1000（都够）|
 *
 * ⚠ position:fixed 会脱离父容器 —— 挂在 570 宽的 tab 里也按整个浏览器窗口铺开，
 *   左右两栏被挤扁。⇒ 必须改成 height:100% 撑满父容器。
 *
 * ⚠ container-type:size 要求父容器给高度 —— 父层没高度时页会**塌成 0**。
 *   预览里挂载点给了固定尺寸的舞台；产品里 tab body 必须是 height:100%。
 *   这一条由 test/create-layout.test.ts 的反向断言 + 预览的三个尺寸舞台共同守护。
 *
 * ⚠ size 而不是 inline-size：要能同时查**宽**和**高**（两个维度是两件事，
 *   见下面两条 @container）。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会提前结束字符串）。
 */
.tb3cc-page{container-type:size;container-name:tb3cc;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-primary,#fff);font-size:13px;line-height:1.5}
.tb3cc-page__top{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e4e7ec)}
.tb3cc-page__title{font-size:16px;margin:0}
.tb3cc-page__close{border:none;background:transparent;font-size:20px;line-height:1;color:var(--dsw-alias-text-secondary,#8a919c);padding:2px 8px;border-radius:6px;cursor:pointer}
.tb3cc-page__close:hover{background:var(--dsw-alias-bg-secondary,#f1f3f6)}
.tb3cc-page__body{flex:1 1 auto;display:flex;min-height:0}
.tb3cc-page__left{flex:0 0 320px;padding:16px 18px;border-right:1px solid var(--dsw-alias-border-secondary,#e4e7ec);background:var(--dsw-alias-bg-secondary,#fafbfc);overflow-y:auto}
.tb3cc-page__right{flex:1 1 auto;padding:16px 20px;overflow-y:auto;min-width:0}
.tb3cc-page__foot{flex:0 0 auto;border-top:1px solid var(--dsw-alias-border-secondary,#e4e7ec);background:var(--dsw-alias-bg-secondary,#fafbfc)}

.tb3cc-sec-list{display:flex;flex-direction:column;gap:12px}
.tb3cc-sec-list__empty{color:var(--dsw-alias-text-secondary,#8a919c);padding:24px 0}
/*
 * ⚠ 这里曾经有一整段 .tb3cc-sec*（章节卡 / 头行 / 类型下拉 / 正文内边距 /
 *   裸 input / 错误行）。issue #59 / #60 之后**章节外观只剩 SectionShell 的
 *   .tb3-sec* **（CSS 在 src/renderers/section-shell-css.ts）——
 *   那一段是**删掉**的，不是被覆盖。别再往这里加章节样式。
 */

.tb3cc-actions{display:flex;align-items:center;justify-content:space-between;padding:10px 18px}
.tb3cc-actions__msg{color:var(--dsw-alias-text-secondary,#6b7280);font-size:12px}
.tb3cc-actions__err{color:var(--dsw-alias-text-danger,#b91c1c)}
.tb3cc-actions__buttons{display:flex;gap:8px}

.tb3cc-btn{padding:6px 16px;border-radius:7px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#2b3138);font-weight:500;font-family:inherit;font-size:13px;cursor:pointer}
.tb3cc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-secondary,#f6f7f9)}
.tb3cc-btn:disabled{opacity:.55;cursor:default}
.tb3cc-btn--primary{background:var(--dsw-alias-text-primary,#1f2328);border-color:var(--dsw-alias-text-primary,#1f2328);color:var(--dsw-alias-bg-primary,#fff)}
.tb3cc-btn--primary:hover:not(:disabled){opacity:.88}

.tb3cc-tpl-hint{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f6f8fb);border:1px solid var(--dsw-alias-border-secondary,#e6eaf0)}
.tb3cc-tpl-hint.is-empty{border-style:dashed}
.tb3cc-tpl-hint__empty{color:var(--dsw-alias-text-secondary,#a6adb8)}
.tb3cc-tpl-hint__usage{color:var(--dsw-alias-text-secondary,#4b5563);margin-bottom:6px;font-size:12px;line-height:1.55}
.tb3cc-tpl-hint__meta{display:flex;justify-content:space-between;gap:10px;color:var(--dsw-alias-text-secondary,#6b7280);font-size:11px;flex-wrap:wrap}
.tb3cc-tpl-hint__meta b{color:var(--dsw-alias-text-primary,#1f2328)}
.tb3cc-tpl-hint__meta code{font-family:var(--font-mono,Consolas,"Courier New",monospace);font-size:11px}

/*
 * ── 左栏（定稿排法：标题 → 模板 → 父任务 → 关系|高级设置）──
 *
 * 宽度**不写在这里**：父层 .tb3cc-page__left 是 flex:0 0 320px。
 * 左栏组件撑满即可，写死宽度换个容器就错位。
 * ⚠ 这段在模板字符串里，注释里**不能出现反引号**（会提前结束字符串）。
 */
.tb3cc-leftcol{display:flex;flex-direction:column;gap:16px}
.tb3cc-field{display:flex;flex-direction:column;gap:5px}
.tb3cc-label{font-size:12px;font-weight:600;color:var(--dsw-alias-text-secondary,#3d444d)}
.tb3cc-req{color:var(--dsw-alias-text-danger,#dc2626)}
.tb3cc-input{width:100%;padding:8px 11px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:8px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);outline:none;font-family:inherit;font-size:13px;box-sizing:border-box}
.tb3cc-input:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-input.has-error{border-color:var(--dsw-alias-border-danger,#f0a8a8)}
.tb3cc-field-err{color:var(--dsw-alias-text-danger,#b91c1c);font-size:11px;line-height:1.5;margin-top:4px}

/* ── 模板 + 父任务（**分行**） ── */
.tb3cc-tfield{display:flex;flex-direction:column;gap:12px}
.tb3cc-tfield__cell{display:flex;flex-direction:column;gap:5px;min-width:0}

/* ── 卡片选择器（combobox：输入即筛选，不是 select） ── */
.tb3cc-picker{position:relative;width:100%}
.tb3cc-picker__display{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 10px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:8px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);text-align:left;font-family:inherit;font-size:13px;cursor:pointer}
.tb3cc-picker__display:hover{border-color:var(--dsw-alias-border-secondary,#b9bfc9)}
.tb3cc-picker__display.is-open{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-picker__display.is-empty .tb3cc-picker__value{color:var(--dsw-alias-text-secondary,#a6adb8)}
.tb3cc-picker__value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3cc-picker__caret{flex:0 0 auto;color:var(--dsw-alias-text-secondary,#8a919c);font-size:11px}
/*
 * 弹层挂在自己容器里（absolute），**不挂 body** ——
 * 永远在建卡页的叠层语境里，不会被 fixed 的页面裁掉。
 */
.tb3cc-picker__pop{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;background:var(--dsw-alias-bg-primary,#fff);border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:9px;box-shadow:0 8px 24px rgb(0 0 0 / 14%);overflow:hidden}
.tb3cc-picker__input{width:100%;padding:8px 11px;border:none;border-bottom:1px solid var(--dsw-alias-border-secondary,#eef1f5);outline:none;background:var(--dsw-alias-bg-secondary,#fafbfc);color:var(--dsw-alias-text-primary,#1f2328);font-family:inherit;font-size:13px;box-sizing:border-box}
.tb3cc-picker__list{max-height:220px;overflow-y:auto;padding:4px}
.tb3cc-picker__item{display:flex;align-items:baseline;gap:8px;width:100%;padding:6px 9px;border:none;border-radius:6px;background:transparent;text-align:left;color:var(--dsw-alias-text-primary,#1f2328);font-family:inherit;font-size:13px;cursor:pointer}
.tb3cc-picker__item:hover{background:var(--dsw-alias-bg-secondary,#f1f3f6)}
.tb3cc-picker__item--clear{color:var(--dsw-alias-text-secondary,#6b7280);font-style:italic}
.tb3cc-picker__id{flex:0 0 auto;font-family:var(--font-mono,Consolas,"Courier New",monospace);font-size:11px;color:var(--dsw-alias-text-secondary,#6b7280);font-weight:700}
.tb3cc-picker__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3cc-picker__empty{padding:10px;color:var(--dsw-alias-text-secondary,#8a919c);text-align:center}

/* ── 模板三级联选弹层（独立组件 TemplatePickerPopover） ── */
.tb3cc-tpick{position:relative;width:100%}
.tb3cc-tpick__trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 10px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:8px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);text-align:left;font-family:inherit;font-size:13px;cursor:pointer}
.tb3cc-tpick__trigger:hover{border-color:var(--dsw-alias-border-secondary,#b9bfc9)}
.tb3cc-tpick__trigger.is-open{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-tpick__trigger.is-empty .tb3cc-tpick__value{color:var(--dsw-alias-text-secondary,#a6adb8)}
.tb3cc-tpick__value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3cc-tpick__caret{flex:0 0 auto;color:var(--dsw-alias-text-secondary,#8a919c);font-size:11px}
/*
 * 三列弹层的宽度**大于 320px 左栏**是故意的：三列在 320 里每列只剩 ~100px，读不了。
 *
 * ⚠ 用 position:fixed + 由组件量触发器坐标（不是 absolute）——
 *   左栏 .tb3cc-page__left 是 overflow-y:auto 的滚动容器，会**裁掉**任何溢出的
 *   子元素。absolute 的后果实测：第三列被切掉一半 + 左栏底部冒出横向滚动条。
 */
.tb3cc-tpick__pop{position:fixed;z-index:60;width:470px;max-width:calc(100vw - 48px);background:var(--dsw-alias-bg-primary,#fff);border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:10px;box-shadow:0 12px 32px rgb(0 0 0 / 16%);overflow:hidden}
.tb3cc-tpick__cols{display:grid;grid-template-columns:104px 104px 1fr}
.tb3cc-tpick__col{padding:6px;display:flex;flex-direction:column;gap:1px;min-width:0}
.tb3cc-tpick__col + .tb3cc-tpick__col{border-left:1px solid var(--dsw-alias-border-secondary,#eef1f5)}
/* 第三列（模板）占掉剩余宽度 —— 模板名比「领域 / 类别」长得多 */
.tb3cc-tpick__col--wide{flex:1 1 auto}
.tb3cc-tpick__col-head{padding:4px 8px 6px;color:var(--dsw-alias-text-secondary,#8a919c);font-size:11px;font-weight:600;letter-spacing:.04em}
.tb3cc-tpick__opt{display:flex;align-items:center;gap:7px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:transparent;text-align:left;color:var(--dsw-alias-text-primary,#1f2328);font-family:inherit;font-size:12.5px;cursor:pointer}
.tb3cc-tpick__opt:hover{background:var(--dsw-alias-bg-secondary,#f1f3f6)}
.tb3cc-tpick__opt.is-picked{background:var(--dsw-alias-bg-tertiary,#e8eefb);color:var(--dsw-alias-brand-primary,#1d4ed8);font-weight:600}
.tb3cc-tpick__radio{flex:0 0 auto;font-size:9px;color:var(--dsw-alias-text-secondary,#b9bfc9);line-height:1}
.tb3cc-tpick__opt.is-picked .tb3cc-tpick__radio{color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-tpick__prefix{flex:0 0 auto;width:15px;text-align:center;font-family:var(--font-mono,Consolas,"Courier New",monospace);font-size:11px;font-weight:700;color:var(--dsw-alias-text-secondary,#8a919c)}
.tb3cc-tpick__opt.is-picked .tb3cc-tpick__prefix{color:var(--dsw-alias-brand-primary,#1d4ed8)}
.tb3cc-tpick__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3cc-tpick__empty{padding:8px;color:var(--dsw-alias-text-secondary,#a6adb8);font-size:12px}
/* 底部说明 —— 选中之后才出现（**选完不关弹层**就是为了看这块） */
.tb3cc-tpick__foot{padding:10px 12px;border-top:1px solid var(--dsw-alias-border-secondary,#eef1f5);background:var(--dsw-alias-bg-secondary,#fafbfc);display:flex;flex-direction:column;gap:4px}
.tb3cc-tpick__foot-idle{color:var(--dsw-alias-text-secondary,#a6adb8);font-size:12px}
.tb3cc-tpick__foot-title{font-weight:700;color:var(--dsw-alias-text-primary,#1f2328);font-size:12.5px}
.tb3cc-tpick__foot-domain{margin-left:8px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-tertiary,#eef1f5);color:var(--dsw-alias-text-secondary,#6b7280);font-size:10.5px;font-weight:600}
.tb3cc-tpick__foot-usage{color:var(--dsw-alias-text-secondary,#4b5563);font-size:11.5px;line-height:1.55}
.tb3cc-tpick__foot-meta{display:flex;justify-content:space-between;gap:10px;color:var(--dsw-alias-text-secondary,#6b7280);font-size:11px;flex-wrap:wrap;margin-top:2px}
.tb3cc-tpick__foot-meta b{color:var(--dsw-alias-text-primary,#1f2328)}
.tb3cc-tpick__foot-meta code{font-family:var(--font-mono,Consolas,"Courier New",monospace);font-size:11px}

/* ── 关系 | 高级设置：两个标签按钮 + 共用折叠区 ── */
.tb3cc-meta{display:flex;flex-direction:column;gap:10px}
.tb3cc-meta__tabs{display:flex;gap:8px}
.tb3cc-meta__tab{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-secondary,#4b5563);font-size:12px;font-weight:600;font-family:inherit;cursor:pointer}
.tb3cc-meta__tab:hover{border-color:var(--dsw-alias-border-secondary,#b9bfc9)}
.tb3cc-meta__tab.is-on{background:var(--dsw-alias-text-primary,#1f2328);border-color:var(--dsw-alias-text-primary,#1f2328);color:var(--dsw-alias-bg-primary,#fff)}
.tb3cc-meta__count{min-width:16px;padding:0 4px;border-radius:9px;background:var(--dsw-alias-bg-tertiary,#eef1f5);color:var(--dsw-alias-text-secondary,#6b7280);font-size:10px;text-align:center;line-height:16px}
.tb3cc-meta__tab.is-on .tb3cc-meta__count{background:rgb(255 255 255 / 24%);color:var(--dsw-alias-bg-primary,#fff)}
/* 折叠区 —— 两个面板共用这一块位置（同一时间只可能有一个存在） */
.tb3cc-meta__panel{padding:11px 12px;border:1px solid var(--dsw-alias-border-secondary,#e4e7ec);border-radius:9px;background:var(--dsw-alias-bg-secondary,#fafbfc);display:flex;flex-direction:column;gap:9px}
.tb3cc-meta__hint{color:var(--dsw-alias-text-secondary,#6b7280);font-size:11px;line-height:1.5}
.tb3cc-meta__empty{color:var(--dsw-alias-text-secondary,#8a919c)}
.tb3cc-meta__empty-hint{color:var(--dsw-alias-text-secondary,#a6adb8);font-size:11px}
.tb3cc-meta__panel--empty{align-items:flex-start}
.tb3cc-meta__rel-list{display:flex;flex-direction:column;gap:6px}
.tb3cc-meta__rel-row{display:grid;grid-template-columns:72px minmax(0,1fr) 20px;gap:6px;align-items:center;min-width:0}
.tb3cc-meta__rel-kind{padding:6px 2px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:7px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);font-size:12px;outline:none;min-width:0;font-family:inherit}
.tb3cc-meta__rel-del{border:none;background:transparent;color:var(--dsw-alias-text-secondary,#9aa1ad);font-size:13px;padding:0;border-radius:4px;cursor:pointer}
.tb3cc-meta__rel-del:hover{color:var(--dsw-alias-text-danger,#dc2626)}
.tb3cc-meta__rel-add{align-self:flex-start;padding:5px 11px;border-radius:7px;border:1px dashed var(--dsw-alias-border-primary,#c7ced8);background:transparent;color:var(--dsw-alias-text-secondary,#4b5563);font-size:12px;font-family:inherit;cursor:pointer}
.tb3cc-meta__rel-add:hover{border-color:var(--dsw-alias-brand-primary,#2563eb);color:var(--dsw-alias-brand-primary,#2563eb)}

/*
 * ══════════════════════════════════════════════════════════
 * 响应式：三个真实尺寸 —— **两个维度，不是三个宽度档**
 * ══════════════════════════════════════════════════════════
 *
 * 用户 2026-11-19 给的尺寸（产品里 CardCreate 会挂在三种容器里）：
 *
 * | 场景 | 尺寸 | 问题 |
 * |---|---|---|
 * | 工作区 | 570 × 920 | **横向**放不下左右分栏 ⇒ 堆叠 |
 * | 抽屉 | 1200 × 400 | **纵向**放不下那么多行 ⇒ 收紧间距（**不能堆叠**）|
 * | 全屏 | 1600 × 1000 | 都不用管 |
 *
 * ⚠ **判断依据是宽 / 高两个独立维度，不是面积。**
 *   抽屉 1200 宽 × 400 高 —— 面积只有全屏的 30%，但它**宽**，横排好看得很；
 *   一旦误判成「小 ⇒ 堆叠」，400 高里竖着塞两栏会死。
 *   ⇒ 宽的门槛管**结构**（堆叠），高的门槛管**间距**（收紧），两者互不推断。
 *
 * ⚠ 容器查询只写**有差异的**属性。没列到的属性继承上面的基础规则 ——
 *   否则「响应式」变成第二套样式表，改一处要改两遍。
 */

/*
 * ── A. 窄（小于 700px）⇒ 上下堆叠 ──
 *
 * 门槛 700 的来由：左栏 320 + 右栏最小可用 340 + 边框 ≈ 660。
 * 低于 700 时右栏会被挤到放不下一列章节卡，那比堆叠更难用。
 */
@container tb3cc (max-width: 700px) {
  .tb3cc-page__body{flex-direction:column}
  /*
   * 堆叠后左栏在上、右栏在下。
   *
   * ## ⚠ 左栏上限是 70%，不是 46%（用户 2026-11-19 反馈后改的）
   *
   * 第一版给 46%，理由是「别让左栏把右栏挤没」。实测 570×920 下这是错的：
   *
   * | 左栏状态 | 内容自然高（含 padding）|
   * |---|---|
   * | 关系收起 | 341px |
   * | 关系展开（空） | 457px |
   * | 关系展开 + 1 行关联 | 471px |
   *
   * 46% ≈ 376px ⇒ **关系一展开左栏就出滚动条**。用户原话：
   *
   * > 「抽屉打滚动无所谓。但是工作区打滚动就不行。」
   *
   * ⇒ 左栏是**主输入区**，滚起来就看不到自己刚填的字段，这个代价不可接受。
   *   70%（920 × 70% ≈ 573px）能放下「关系展开 + 5 行关联」，典型状态一律不滚。
   *   右栏剩 30%（≈246px）—— 右栏本来就比视口长（要滚），少 130px 不影响它可用。
   *
   * ⚠ **抽屉（1200×400）走不到这条**：宽 1200 > 700 ⇒ 横排，左栏 400 高里滚是应该的
   *   （高度就那么点，不滚看不完）。「滚不滚」的判据是**宽**（结构），不是高。
   */
  .tb3cc-page__left{flex:0 0 auto;max-height:70%;border-right:none;border-bottom:1px solid var(--dsw-alias-border-secondary,#e4e7ec)}
  .tb3cc-page__right{flex:1 1 auto;min-height:0}

  /*
   * 窄容器里顺带把左栏的纵向间距收一点 —— 和 70% 是同一件事：
   * 让左栏在 570×920 里**装得下**，而不是靠滚动条兜。
   * 只动 gap，不动字号 / 结构（那属于「矮」那一维）。
   */
  .tb3cc-leftcol{gap:12px}
  .tb3cc-tfield{gap:10px}
  .tb3cc-meta{gap:8px}
}

/*
 * ── B. 矮（< 560px）⇒ 收紧纵向间距（**结构不动**）──
 *
 * 门槛 560 的来由：顶栏 ~50 + 底栏 ~50 + 右栏至少要露出两章（~230×2）。
 * 抽屉 400 高 ⇒ 必须把垂直 padding / gap / 行高都压下来，否则一屏只能看半张章节卡。
 */
@container tb3cc (max-height: 560px) {
  .tb3cc-page__top{padding:6px 14px}
  .tb3cc-page__title{font-size:14px}
  .tb3cc-page__left{padding:10px 14px}
  .tb3cc-page__right{padding:10px 14px}
  .tb3cc-actions{padding:6px 14px}
  .tb3cc-btn{padding:4px 12px;font-size:12px}
  .tb3cc-sec-list{gap:8px}
  .tb3cc-leftcol{gap:10px}
  .tb3cc-tfield{gap:8px}
  /* 模板说明块在矮容器里只留一句话，省掉「编号前缀 / 共 N 段」那行 */
  .tb3cc-tpl-hint{padding:6px 9px}
  .tb3cc-tpl-hint__usage{margin-bottom:0;font-size:11px}
  .tb3cc-tpl-hint__meta{display:none}
}
`;
