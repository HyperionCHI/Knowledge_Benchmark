import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, "dist", "standalone");
const files = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "MPL_SOURCE_OFFER.md"];

if (!existsSync(standalone)) {
  console.error("许可证复制失败：dist/standalone 不存在，请先完成生产构建。");
  process.exit(1);
}

mkdirSync(standalone, { recursive: true });
for (const file of files) {
  const source = join(root, file);
  if (!existsSync(source)) {
    console.error(`许可证复制失败：缺少 ${file}`);
    process.exit(1);
  }
  copyFileSync(source, join(standalone, file));
}

console.log(`已将 ${files.length} 个许可证与源码说明文件复制到 dist/standalone。`);
