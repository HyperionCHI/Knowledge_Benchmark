import { zipSync } from "fflate";
import { currentSession } from "../../../../lib/auth";
import { getWorkspaceAssetBindings } from "../../../../../db/workspace-assets";
import { scanOrphanAttachments } from "../../../../lib/orphan-attachments";

function safeZipName(name: string, index: number) {
  const cleaned = [...name].map((character) => character.charCodeAt(0) < 32 || "\\/:*?\"<>|".includes(character) ? "_" : character).join("").trim() || `attachment-${index + 1}`;
  return `${String(index + 1).padStart(3, "0")}-${cleaned}`;
}

export async function GET(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if ((session.user as typeof session.user & { role?: string }).role !== "admin") return Response.json({ error: "仅管理员可下载孤儿附件。" }, { status: 403 });
  const rows = await scanOrphanAttachments();
  const total = rows.reduce((sum, row) => sum + row.size, 0);
  if (!rows.length) return Response.json({ error: "当前没有可下载的孤儿附件。" }, { status: 404 });
  if (rows.length > 200 || total > 500 * 1024 * 1024) return Response.json({ error: "孤儿附件过多或总体积超过 500 MB，请先分批处理。" }, { status: 413 });
  const { ATTACHMENTS } = getWorkspaceAssetBindings();
  const entries: Record<string, Uint8Array> = {};
  for (const [index, row] of rows.entries()) {
    const object = await ATTACHMENTS.get(row.storage_key);
    if (object) entries[safeZipName(row.name, index)] = new Uint8Array(object.body);
  }
  const archive = zipSync(entries, { level: 6 });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="orphan-attachments-${date}.zip"`, "Cache-Control": "no-store" } });
}
