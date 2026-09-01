import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const requiredLicenseFiles = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt", "MPL_SOURCE_OFFER.md"];
const forbiddenPaths = [
  ".env", ".env.local", ".env.development", ".env.production",
  "data/workbench.sqlite", "data/workbench.sqlite-wal", "data/workbench.sqlite-shm",
  "db/knowledge-vault-docs.ts",
];

for (const path of forbiddenPaths) {
  if (existsSync(join(root, path))) failures.push(`不应出现在发布目录：${path}`);
}

for (const path of requiredLicenseFiles) {
  if (!existsSync(join(root, path))) failures.push(`缺少开源合规文件：${path}`);
}

const packageManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (packageManifest.license !== "Apache-2.0") failures.push("package.json 的 license 必须为 Apache-2.0");

const licenseCheck = spawnSync(process.execPath, [join(root, "scripts", "generate-third-party-notices.mjs"), "--check"], { cwd: root, encoding: "utf8" });
if (licenseCheck.status !== 0) failures.push(`第三方许可证清单检查失败：${(licenseCheck.stderr || licenseCheck.stdout).trim()}`);

const standalone = join(root, "dist", "standalone");
if (existsSync(standalone)) {
  for (const path of requiredLicenseFiles) {
    const source = join(root, path);
    const distributed = join(standalone, path);
    if (!existsSync(distributed)) failures.push(`standalone 缺少开源合规文件：${path}`);
    else if (existsSync(source) && readFileSync(source, "utf8") !== readFileSync(distributed, "utf8")) failures.push(`standalone 中的 ${path} 已过期`);
  }
}

for (const obsoleteAsset of ["file.svg", "globe.svg", "window.svg"]) {
  if (existsSync(join(root, "public", obsoleteAsset))) failures.push(`仍包含来源未确认的模板素材：public/${obsoleteAsset}`);
}

const attachmentDirectory = join(root, "data", "attachments");
if (existsSync(attachmentDirectory) && readdirSync(attachmentDirectory).length > 0) failures.push("data/attachments 中仍有文件");

const ignoredDirectories = new Set([".git", "node_modules", "dist", ".vinext", ".next", ".pnpm-store", "coverage"]);
const textExtensions = new Set([".cmd", ".css", ".example", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ps1", ".sql", ".ts", ".tsx", ".txt", ".yml", ".yaml"]);
const forbiddenText = ["D:\\CodexProject", "knowledgeVaultDocuments", "knowledgeVaultDocumentCategories", "https://docs.qq.com/", "张敏", "李哲"];

function inspect(directory) {
  for (const name of readdirSync(directory)) {
    if (ignoredDirectories.has(name)) continue;
    const path = join(directory, name);
    if (relative(root, path).replaceAll("\\", "/") === "scripts/check-release-readiness.mjs") continue;
    const info = statSync(path);
    if (info.isDirectory()) inspect(path);
    else if (textExtensions.has(extname(path).toLowerCase())) {
      const content = readFileSync(path, "utf8");
      for (const token of forbiddenText) if (content.includes(token)) failures.push(`${relative(root, path)} 仍包含禁止发布的内容标记：${token}`);
    }
  }
}

inspect(root);

const terminology = JSON.parse(readFileSync(join(root, "app", "sections", "terminology", "terminology-data.json"), "utf8"));
if (terminology.categories?.length || terminology.terms?.length) failures.push("术语种子数据不为空");

const workspaceSource = readFileSync(join(root, "db", "workspace.ts"), "utf8");
for (const marker of ["brands: []", "products: []", "links: []", "sops: []", "docs: []", "otherDocs: []"]) {
  if (!workspaceSource.includes(marker)) failures.push(`默认工作区未保持为空：${marker}`);
}

const templateSource = readFileSync(join(root, "app", "sections", "templates", "initialTemplates.ts"), "utf8");
if (!/initialTemplates:\s*TemplateRecord\[\]\s*=\s*\[\s*\]/s.test(templateSource)) failures.push("内置模板种子数据不为空");

if (failures.length) {
  console.error("发布检查失败：\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("发布检查通过：数据清理、项目许可证、第三方声明、MPL 源码说明和构建产物许可证材料均符合当前规则。");
