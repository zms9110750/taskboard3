// 一次性：解决 io × tpl 的合并冲突
//
// 两个任务都改了测试夹具，冲突本质是「createTaskboard 的入参形状」：
//   io 那边  ：删了 dataDir，改必填 store  ⇒ createTaskboard({ store })
//   tpl 那边 ：还在用 dataDir + 新增 builtinTemplates 选项 ⇒ createTaskboard({ dataDir, builtinTemplates: false })
//
// 正确形态 = io 的 store 必填 + tpl 的 builtinTemplates 选项：
//   createTaskboard({ store: createMemoryStore(), builtinTemplates: false })
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = process.argv.slice(2);
let total = 0;

for (const file of FILES) {
	let text = readFileSync(file, 'utf8');
	const before = text;

	/*
	 * 模式 1：`createTaskboard({ dataDir: X, ... })`
	 *   ⇒ `createTaskboard({ store: createMemoryStore(), ... })`
	 *   但只在**测试文件**里这么改（生产代码 dsh 本来就用 store）。
	 */
	text = text.replace(
		/createTaskboard\(\{\s*dataDir:\s*([A-Za-z0-9_.$]+)([^}]*)\}\)/g,
		(_m, _dir, rest) => {
			const tail = rest.trim();
			return `createTaskboard({ store: createMemoryStore()${tail.length > 0 ? `, ${tail}` : ''} })`;
		},
	);

	if (text !== before) {
		writeFileSync(file, text);
		total += 1;
		console.log(`改了 ${file}`);
	}
}

console.log(`\n共处理 ${String(total)} 个文件`);
