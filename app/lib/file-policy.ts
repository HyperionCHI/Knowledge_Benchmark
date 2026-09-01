const blockedExtensions = new Set(["exe", "dll", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "msi", "scr", "hta", "jar", "sh", "app", "deb", "rpm"]);
const blockedTypes = ["application/x-msdownload", "application/x-sh", "application/x-executable", "text/javascript", "application/javascript"];
export const MAX_WORKSPACE_FILE_SIZE = 200 * 1024 * 1024;

export function validateWorkspaceFile(file: File) {
  if (!file.name.trim()) return "文件名不能为空。";
  if (file.size <= 0) return "文件内容为空。";
  if (file.size > MAX_WORKSPACE_FILE_SIZE) return "单个文件不能超过 200 MB。";
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (blockedExtensions.has(extension) || blockedTypes.includes(file.type.toLowerCase())) return "出于安全原因，不允许上传可执行文件或脚本。";
  return null;
}

export function safeAttachmentName(name: string) {
  return name.normalize("NFKC").split("").map((character) => character.charCodeAt(0) < 32 ? "-" : character).join("").replace(/[\\/:*?"<>|]/g, "-").replace(/\.{2,}/g, ".").slice(0, 120) || "attachment";
}
