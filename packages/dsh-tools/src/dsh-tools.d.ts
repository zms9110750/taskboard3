/**
 * `@deepseek-ai/dsh-tools` 的**类型垫片**（临时）。
 *
 * ## 为什么需要它
 *
 * `dsh-tools` 的真实版本是 `0.2.2-rc.2`（随 DSH 安装分发），
 * 而 npm 上可装的是 `0.2.1-rc.5` —— **API 有差异**：
 *
 * | | 真实（0.2.2-rc.2） | npm（0.2.1-rc.5） |
 * |---|---|---|
 * | `parameters` | 隐式开放对象（`ParameterSchemaSpec`） | 类型更窄 |
 * | `output.schema` | `JsonSchemaNode` | 同 |
 *
 * 我们的参数表里有 `additionalProperties: true` 的开放对象、
 * 以及 `{ type: 'array', items: {...} }` —— npm 版的类型不接受。
 *
 * ## ⚠ 这是「单一真值」的**唯一豁免**
 *
 * 正常规则：一个事实只写一遍。这条是例外，理由：
 * · 真实签名在 asar 里，编译期读不到；
 * · 垫片**只声明本包实际用到的字段**，不复制校验逻辑、不复制类型推导；
 * · 真实签名若变了，**运行时会炸**，而不是静默错。
 *
 * ## 验证过的事实
 *
 * `packages/dsh/node_modules/@deepseek-ai/dsh-tools` 实测版本 `0.2.1-rc.5`。
 * 真实 DSH 安装里是 `0.2.2-rc.2`（`dsh-tools/package.json`）。
 * 两者 `defineTool` 的**运行时行为一致**（编译 schema + 每次调用前校验），
 * 差异只在 TypeScript 的泛型约束严格程度。
 *
 * ## 什么时候可以删掉它
 *
 * 当 npm 上出现与 DSH 同版本的 `dsh-tools`，或 DSH 把它作为公开的
 * types 包发布时 —— 届时把 `peerDependencies` 指向真实包、删本文件。
 */

declare module '@deepseek-ai/dsh-tools' {
	/** 一个已定义的工具（`ToolDefinition` 的字段子集）。 */
	export interface ToolDefinition {
		readonly name: string;
		readonly description: string;
		readonly parameters: Record<string, unknown>;
		readonly output: {
			readonly schema: Record<string, unknown>;
			readonly render(args: unknown, value: unknown): readonly unknown[];
		};
		execute(args: unknown, exec: unknown): Promise<unknown>;
	}

	/** `defineTool` 的入参（只声明本包用到的子集）。 */
	export interface DefineToolOptions {
		readonly name: string;
		readonly description: string;
		readonly parameters: Record<string, unknown>;
		readonly output: {
			readonly schema: Record<string, unknown>;
			readonly render(args: unknown, value: unknown): readonly unknown[];
		};
		execute(args: never, exec: never): Promise<unknown>;
	}

	/**
	 * 定义一个模型可调用的工具。
	 *
	 * ⚠ 真实实现会编译参数 schema 并在每次调用前校验；本垫片只保留形状。
	 */
	export function defineTool(options: DefineToolOptions): ToolDefinition;
}
