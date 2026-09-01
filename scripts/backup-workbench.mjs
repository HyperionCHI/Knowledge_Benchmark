import Database from "better-sqlite3";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const databasePath = resolve(process.env.WORKBENCH_DB_PATH || "data/workbench.sqlite");
const attachmentPath = resolve(process.env.WORKBENCH_ATTACHMENT_DIR || "data/attachments");
const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
if (argumentsWithoutSeparator.length > 1) throw new Error("Usage: pnpm backup -- [backup-root]");
const root = resolve(argumentsWithoutSeparator[0] || "backups");
const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const destination = resolve(root, `knowledge-workbench-${timestamp}`);
await mkdir(destination, { recursive: true });

const database = new Database(databasePath, { readonly: true, fileMustExist: true });
try { await database.backup(resolve(destination, "workbench.sqlite")); } finally { database.close(); }
const backupAttachmentPath = resolve(destination, "attachments");
await cp(attachmentPath, backupAttachmentPath, { recursive: true, force: false }).catch(async (error) => {
  if (error?.code !== "ENOENT") throw error;
  await mkdir(backupAttachmentPath, { recursive: true });
});
await writeFile(resolve(destination, "backup-manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), databasePath, attachmentPath, formatVersion: 1 }, null, 2));
console.log(destination);
