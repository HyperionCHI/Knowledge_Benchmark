import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { restoreWorkbench, validateBackup } from "../scripts/restore-workbench.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function createDatabase(path, marker, storageKey = null) {
  const database = new Database(path);
  try {
    database.exec("CREATE TABLE marker (value TEXT NOT NULL)");
    database.prepare("INSERT INTO marker (value) VALUES (?)").run(marker);
    database.exec("CREATE TABLE workspace_attachments (storage_key TEXT NOT NULL, size INTEGER NOT NULL)");
    if (storageKey) database.prepare("INSERT INTO workspace_attachments (storage_key, size) VALUES (?, 1)").run(storageKey);
  } finally {
    database.close();
  }
}

function readMarker(path) {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return database.prepare("SELECT value FROM marker").pluck().get();
  } finally {
    database.close();
  }
}

async function createBackup(root, marker = "backup", storageKey = "workspace/test.bin") {
  const backupDirectory = join(root, "backup");
  const attachmentPath = join(backupDirectory, "attachments");
  await mkdir(dirname(join(attachmentPath, storageKey)), { recursive: true });
  await writeFile(join(attachmentPath, storageKey), "new attachment");
  createDatabase(join(backupDirectory, "workbench.sqlite"), marker, storageKey);
  await writeFile(join(backupDirectory, "backup-manifest.json"), JSON.stringify({
    createdAt: "2026-08-25T00:00:00.000Z",
    databasePath: "original/workbench.sqlite",
    attachmentPath: "original/attachments",
    formatVersion: 1,
  }));
  return backupDirectory;
}

test("restores one database and attachment snapshot while preserving rollback copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-restore-success-"));
  try {
    const backupDirectory = await createBackup(root);
    const databasePath = join(root, "current", "workbench.sqlite");
    const attachmentPath = join(root, "current", "attachments");
    await mkdir(attachmentPath, { recursive: true });
    createDatabase(databasePath, "current");
    await writeFile(join(attachmentPath, "old.txt"), "old attachment");
    await writeFile(databasePath + "-wal", "old wal");
    await writeFile(databasePath + "-shm", "old shm");

    const result = await restoreWorkbench({
      backupDirectory,
      databasePath,
      attachmentPath,
      confirmStopped: true,
      checkServiceRunning: async () => false,
    });

    assert.equal(readMarker(databasePath), "backup");
    assert.equal(await readFile(join(attachmentPath, "workspace", "test.bin"), "utf8"), "new attachment");
    await assert.rejects(stat(join(attachmentPath, "old.txt")), { code: "ENOENT" });
    assert.equal(result.rollbackPaths.length, 4);
    for (const rollbackPath of result.rollbackPaths) assert.ok(await stat(rollbackPath));
    const rollbackDatabasePath = result.rollbackPaths.find((path) => path.includes("workbench.sqlite.pre-restore"));
    assert.equal(readMarker(rollbackDatabasePath), "current");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a corrupt backup before changing current data", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-restore-invalid-"));
  try {
    const backupDirectory = await createBackup(root);
    await writeFile(join(backupDirectory, "workbench.sqlite"), "not a sqlite database");
    const databasePath = join(root, "current", "workbench.sqlite");
    const attachmentPath = join(root, "current", "attachments");
    await mkdir(attachmentPath, { recursive: true });
    createDatabase(databasePath, "current");
    await writeFile(join(attachmentPath, "old.txt"), "old attachment");

    await assert.rejects(validateBackup(backupDirectory), /backup database is not usable/i);
    assert.equal(readMarker(databasePath), "current");
    assert.equal(await readFile(join(attachmentPath, "old.txt"), "utf8"), "old attachment");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("automatically rolls back when installation fails after moving only the current database", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-restore-rollback-"));
  try {
    const backupDirectory = await createBackup(root);
    const databasePath = join(root, "current", "workbench.sqlite");
    const attachmentPath = join(root, "current", "attachments");
    await mkdir(attachmentPath, { recursive: true });
    createDatabase(databasePath, "current");
    await writeFile(join(attachmentPath, "old.txt"), "old attachment");

    await assert.rejects(restoreWorkbench({
      backupDirectory,
      databasePath,
      attachmentPath,
      confirmStopped: true,
      checkServiceRunning: async () => false,
      hooks: { afterDatabaseMoved: async () => { throw new Error("injected failure"); } },
    }), /original data was restored automatically/i);

    assert.equal(readMarker(databasePath), "current");
    assert.equal(await readFile(join(attachmentPath, "old.txt"), "utf8"), "old attachment");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup ignores pnpm's separator and always emits an attachments directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-backup-arguments-"));
  try {
    const databasePath = join(root, "source", "workbench.sqlite");
    const attachmentPath = join(root, "source", "attachments");
    const backupRoot = join(root, "destination");
    await mkdir(dirname(databasePath), { recursive: true });
    createDatabase(databasePath, "source");

    const execution = spawnSync(process.execPath, [join(projectRoot, "scripts", "backup-workbench.mjs"), "--", backupRoot], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, WORKBENCH_DB_PATH: databasePath, WORKBENCH_ATTACHMENT_DIR: attachmentPath },
    });
    assert.equal(execution.status, 0, execution.stderr);
    const destination = execution.stdout.trim();
    assert.equal(dirname(destination), backupRoot);
    assert.ok((await stat(join(destination, "attachments"))).isDirectory());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
