import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const attachmentRoot = resolve(process.env.WORKBENCH_ATTACHMENT_DIR || "data/attachments");

function resolveAttachmentPath(key: string) {
  const normalized = key.replaceAll("\\", "/");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("附件路径无效。");
  }
  const filePath = resolve(attachmentRoot, normalized);
  if (filePath !== attachmentRoot && !filePath.startsWith(`${attachmentRoot}${sep}`)) throw new Error("附件路径越界。");
  return filePath;
}

type UploadOptions = { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };

class LocalAttachmentStore {
  async put(key: string, body: BodyInit, options: UploadOptions = {}) {
    const filePath = resolveAttachmentPath(key);
    await mkdir(dirname(filePath), { recursive: true });
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    await writeFile(filePath, bytes);
    await writeFile(`${filePath}.metadata.json`, JSON.stringify({
      contentType: options.httpMetadata?.contentType || "application/octet-stream",
      customMetadata: options.customMetadata || {},
    }));
    return { key };
  }

  async get(key: string) {
    const filePath = resolveAttachmentPath(key);
    try {
      const [body, fileInfo] = await Promise.all([readFile(filePath), stat(filePath)]);
      let contentType = "application/octet-stream";
      try {
        const metadata = JSON.parse(await readFile(`${filePath}.metadata.json`, "utf8")) as { contentType?: string };
        contentType = metadata.contentType || contentType;
      } catch { /* legacy attachment without metadata */ }
      return { body, size: fileInfo.size, httpMetadata: { contentType } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    const filePath = resolveAttachmentPath(key);
    await Promise.all([
      rm(filePath, { force: true }),
      rm(`${filePath}.metadata.json`, { force: true }),
    ]);
  }
}

export const attachments = new LocalAttachmentStore();
