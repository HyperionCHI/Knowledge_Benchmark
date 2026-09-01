import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const rootManifest = readJson(join(root, "package.json"));
const directNames = Object.keys(rootManifest.dependencies ?? {}).sort();
const shippedFrameworkNames = ["vinext", "react-server-dom-webpack"];
const approvedLicenses = new Set([
  "0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BlueOak-1.0.0",
  "CC-BY-4.0", "CC0-1.0", "ISC", "MIT", "MPL-2.0", "Python-2.0", "Unlicense",
  "(MPL-2.0 OR Apache-2.0)",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function packageLicense(manifest) {
  const declared = manifest.license ?? manifest.licenses;
  if (typeof declared === "string") return declared.trim();
  if (Array.isArray(declared)) return declared.map((item) => typeof item === "string" ? item : item?.type).filter(Boolean).join(" OR ");
  if (declared?.type) return String(declared.type);
  return "";
}

function repositoryUrl(manifest) {
  const raw = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  if (!raw) return manifest.homepage ?? "";
  return String(raw)
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^git\+ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}

function resolvePackageRoot(name, fromDirectory) {
  const requireFrom = createRequire(join(fromDirectory, "package.json"));
  let entry;
  try {
    entry = requireFrom.resolve(`${name}/package.json`);
  } catch {
    try { entry = requireFrom.resolve(name); } catch {
      const encoded = name.replace("/", "+");
      const pnpmDirectory = join(root, "node_modules", ".pnpm");
      if (!existsSync(pnpmDirectory)) return null;
      for (const candidate of readdirSync(pnpmDirectory).filter((item) => item.startsWith(`${encoded}@`)).sort()) {
        const fallback = join(pnpmDirectory, candidate, "node_modules", name);
        if (existsSync(join(fallback, "package.json"))) return fallback;
      }
      return null;
    }
  }
  let directory = statSync(entry).isDirectory() ? entry : dirname(entry);
  while (directory !== dirname(directory)) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      try {
        if (readJson(manifestPath).name === name) return directory;
      } catch {
        // Keep walking upward when an unrelated package.json is unreadable.
      }
    }
    directory = dirname(directory);
  }
  return null;
}

function findTextFiles(directory, pattern) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => ({ name: entry.name, text: readFileSync(join(directory, entry.name), "utf8").trim() }))
    .filter((entry) => entry.text);
}

function inferLicense(text) {
  if (/Mozilla Public License\s*(?:Version|,? v\.)?\s*2\.0/i.test(text)) return "MPL-2.0";
  if (/Apache License\s*\n?\s*Version 2\.0/i.test(text)) return "Apache-2.0";
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose/i.test(text)) return "ISC";
  if (/Redistribution and use in source and binary forms/i.test(text)) return /Neither the name/i.test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
  if (/Permission is hereby granted, free of charge/i.test(text)) return "MIT";
  if (/Blue Oak Model License/i.test(text)) return "BlueOak-1.0.0";
  if (/This is free and unencumbered software released into the public domain/i.test(text)) return "Unlicense";
  return "";
}

const queue = [
  ...directNames.map((name) => ({ name, from: root, direct: true, shippedFramework: false, optional: false })),
  ...shippedFrameworkNames.map((name) => ({ name, from: root, direct: false, shippedFramework: true, optional: false })),
];
const packages = new Map();
const unresolved = [];

while (queue.length) {
  const request = queue.shift();
  const packageRoot = resolvePackageRoot(request.name, request.from);
  if (!packageRoot) {
    if (!request.optional) unresolved.push(`${request.name} (required by ${request.from})`);
    continue;
  }
  const manifest = readJson(join(packageRoot, "package.json"));
  const key = `${manifest.name}@${manifest.version}`;
  const existing = packages.get(key);
  if (existing) {
    existing.direct ||= request.direct;
    existing.shippedFramework ||= request.shippedFramework;
    continue;
  }
  const licenseFiles = findTextFiles(packageRoot, /^(?:licen[cs]e|copying)(?:\.|$)/i);
  const noticeFiles = findTextFiles(packageRoot, /^notice(?:\.|$)/i);
  let license = packageLicense(manifest);
  if (!license && licenseFiles.length) license = inferLicense(licenseFiles.map((file) => file.text).join("\n"));
  packages.set(key, {
    key,
    name: manifest.name,
    version: manifest.version,
    direct: request.direct,
    shippedFramework: request.shippedFramework,
    license,
    repository: repositoryUrl(manifest),
    packageRoot,
    licenseFiles,
    noticeFiles,
  });

  const requiredNames = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}).filter((name) => !manifest.peerDependenciesMeta?.[name]?.optional),
  ]);
  const optionalNames = new Set(Object.keys(manifest.optionalDependencies ?? {}));
  for (const name of [...requiredNames].sort()) queue.push({ name, from: packageRoot, direct: false, shippedFramework: false, optional: false });
  for (const name of [...optionalNames].filter((name) => !requiredNames.has(name)).sort()) queue.push({ name, from: packageRoot, direct: false, shippedFramework: false, optional: true });
}

const rows = [...packages.values()].sort((left, right) => left.key.localeCompare(right.key));
const errors = [];
if (unresolved.length) errors.push(`无法解析运行依赖：\n- ${unresolved.join("\n- ")}`);
for (const item of rows) {
  if (!item.license) errors.push(`${item.key} 未声明许可证，且无法从许可证文本推断`);
  else if (!approvedLicenses.has(item.license)) errors.push(`${item.key} 使用未批准许可证：${item.license}`);
}

const fallbackByLicense = new Map();
for (const item of rows) {
  if (item.licenseFiles.length && !fallbackByLicense.has(item.license)) fallbackByLicense.set(item.license, item.licenseFiles[0].text);
}
fallbackByLicense.set("Apache-2.0", readFileSync(join(root, "LICENSE"), "utf8").trim());
for (const item of rows) {
  if (!item.licenseFiles.length) {
    const fallback = fallbackByLicense.get(item.license);
    if (fallback) item.licenseFiles = [{ name: `canonical-${item.license}.txt`, text: fallback }];
    else errors.push(`${item.key} 没有可随发布包提供的许可证文本`);
  }
}

if (errors.length) {
  console.error("第三方许可证生成失败：\n- " + errors.join("\n- "));
  process.exit(1);
}

const escapeCell = (value) => String(value || "—").replaceAll("|", "\\|").replaceAll("\n", " ");
const inventory = [
  "# 第三方开源组件声明",
  "",
  "> 此文件由 `scripts/generate-third-party-notices.mjs` 根据当前生产依赖自动生成，请勿手工编辑。",
  "",
  `本发布使用 ${rows.length} 个已解析的生产依赖包版本，其中 ${rows.filter((item) => item.direct).length} 个为直接依赖。完整许可证和上游 NOTICE 文本见 \`THIRD_PARTY_LICENSES.txt\`；MPL-2.0 组件的对应源码见 \`MPL_SOURCE_OFFER.md\`。`,
  "",
  "| 组件 | 类型 | 许可证 | 上游源码 |",
  "| --- | --- | --- | --- |",
  ...rows.map((item) => `| \`${escapeCell(item.key)}\` | ${item.direct ? "直接运行依赖" : item.shippedFramework ? "构建运行框架" : "传递运行依赖"} | \`${escapeCell(item.license)}\` | ${item.repository ? `<${escapeCell(item.repository)}>` : "—"} |`),
  "",
  "## 说明",
  "",
  "Knowledge Workbench 自身代码采用 Apache-2.0。第三方组件仍分别受上表所列许可证约束；本项目许可证不会替代或限制第三方许可证授予的权利。",
  "",
].join("\n");

const textGroups = new Map();
function addText(kind, item, file) {
  const normalized = file.text.replace(/\r\n?/g, "\n").trim();
  const hash = createHash("sha256").update(normalized).digest("hex");
  const key = `${kind}:${hash}`;
  const group = textGroups.get(key) ?? { kind, text: normalized, packages: [] };
  group.packages.push(`${item.key} (${file.name})`);
  textGroups.set(key, group);
}
for (const item of rows) {
  for (const file of item.licenseFiles) addText("LICENSE", item, file);
  for (const file of item.noticeFiles) addText("NOTICE", item, file);
}

const licenses = [
  "THIRD-PARTY LICENSES AND NOTICES",
  "================================",
  "",
  "This file is generated from the installed production dependency graph.",
  "Each section lists the packages to which the following text applies.",
  "",
  ...[...textGroups.values()]
    .sort((left, right) => left.packages[0].localeCompare(right.packages[0]) || left.kind.localeCompare(right.kind))
    .flatMap((group) => [
      "--------------------------------------------------------------------------------",
      group.kind,
      `Packages: ${group.packages.sort().join(", ")}`,
      "--------------------------------------------------------------------------------",
      group.text,
      "",
    ]),
].join("\n");

const outputs = new Map([
  [join(root, "THIRD_PARTY_NOTICES.md"), inventory],
  [join(root, "THIRD_PARTY_LICENSES.txt"), licenses],
  [join(root, "public", "third-party-notices.txt"), inventory],
  [join(root, "public", "third-party-licenses.txt"), licenses],
]);

let stale = false;
for (const [path, content] of outputs) {
  const normalized = `${content.replace(/\r\n?/g, "\n").trimEnd()}\n`;
  if (checkOnly) {
    const current = existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n?/g, "\n") : "";
    if (current !== normalized) {
      console.error(`第三方许可证文件缺失或已过期：${path.slice(root.length + 1)}`);
      stale = true;
    }
  } else {
    writeFileSync(path, normalized, "utf8");
  }
}

if (stale) process.exit(1);
console.log(`${checkOnly ? "第三方许可证检查通过" : "第三方许可证文件已生成"}：${rows.length} 个生产依赖包版本。`);
