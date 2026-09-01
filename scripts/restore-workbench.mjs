import Database from "better-sqlite3";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST_NAME = "backup-manifest.json";
const DATABASE_NAME = "workbench.sqlite";
const ATTACHMENT_DIRECTORY_NAME = "attachments";

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isWithin(parent, child) {
  const childRelativePath = relative(parent, child);
  return childRelativePath === "" || (!childRelativePath.startsWith(".." + sep) && childRelativePath !== ".." && !isAbsolute(childRelativePath));
}

function assertSafeTargets(databasePath, attachmentPath, backupDirectory) {
  if (databasePath === parse(databasePath).root) throw new Error("The database restore path cannot be a drive root.");
  if (attachmentPath === parse(attachmentPath).root) throw new Error("The attachment restore path cannot be a drive root.");
  if (databasePath === attachmentPath || isWithin(attachmentPath, databasePath)) {
    throw new Error("The database file cannot be inside the attachment directory.");
  }
  if (isWithin(attachmentPath, backupDirectory) || isWithin(backupDirectory, attachmentPath)) {
    throw new Error("The backup and target attachment directories cannot contain each other.");
  }
  if (resolve(backupDirectory, DATABASE_NAME) === databasePath) throw new Error("The backup database cannot also be the restore target.");
}

function readStorageKeys(database) {
  const tables = new Map(
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => [
      name,
      new Set(database.prepare("PRAGMA table_info(" + JSON.stringify(name) + ")").all().map(({ name: columnName }) => columnName)),
    ]),
  );
  const keys = new Set();
  const collect = (table, column, where = "") => {
    if (!tables.get(table)?.has(column)) return;
    for (const row of database.prepare("SELECT " + column + " AS storage_key FROM " + table + " " + where).all()) {
      if (typeof row.storage_key === "string" && row.storage_key.trim()) keys.add(row.storage_key);
    }
  };
  collect("workspace_attachments", "storage_key", tables.get("workspace_attachments")?.has("size") ? "WHERE size > 0" : "");
  collect("workspace_attachment_versions", "storage_key", tables.get("workspace_attachment_versions")?.has("size") ? "WHERE size > 0" : "");
  collect("workspace_inline_images", "storage_key", tables.get("workspace_inline_images")?.has("size") ? "WHERE size > 0" : "");
  collect("templates", "attachment_key", "WHERE attachment_key IS NOT NULL AND attachment_key <> ''");
  return [...keys];
}

function inspectDatabase(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const messages = database.pragma("integrity_check").map((row) => String(row.integrity_check ?? Object.values(row)[0]));
    if (messages.length !== 1 || messages[0] !== "ok") {
      throw new Error("SQLite integrity check failed: " + (messages.join("; ") || "unknown error"));
    }
    return { storageKeys: readStorageKeys(database) };
  } finally {
    database.close();
  }
}

function resolveStorageKey(attachmentRoot, storageKey) {
  const normalized = storageKey.replaceAll("\\", "/");
  if (!normalized || normalized.split("/").some((part) => part === "" || part === "..")) {
    throw new Error("The backup database contains an invalid attachment path: " + storageKey);
  }
  const filePath = resolve(attachmentRoot, normalized);
  if (filePath === attachmentRoot || !filePath.startsWith(attachmentRoot + sep)) {
    throw new Error("The backup database contains an out-of-bounds attachment path: " + storageKey);
  }
  return filePath;
}

async function validateAttachmentFiles(attachmentRoot, storageKeys) {
  const attachmentInfo = await stat(attachmentRoot).catch(() => null);
  if (!attachmentInfo?.isDirectory()) throw new Error("The backup has no attachments directory.");
  for (const storageKey of storageKeys) {
    const filePath = resolveStorageKey(attachmentRoot, storageKey);
    const fileInfo = await stat(filePath).catch(() => null);
    if (!fileInfo?.isFile()) throw new Error("The backup is missing a referenced attachment: " + storageKey);
  }
}

export async function validateBackup(backupDirectory) {
  const resolvedBackupDirectory = resolve(backupDirectory);
  const backupInfo = await stat(resolvedBackupDirectory).catch(() => null);
  if (!backupInfo?.isDirectory()) throw new Error("Backup directory not found: " + resolvedBackupDirectory);

  const manifestPath = resolve(resolvedBackupDirectory, MANIFEST_NAME);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error("Cannot read backup manifest " + manifestPath + ": " + error.message);
  }
  if (manifest?.formatVersion !== 1 || typeof manifest.createdAt !== "string") {
    throw new Error("The backup manifest is incomplete or uses an unsupported format.");
  }

  const databasePath = resolve(resolvedBackupDirectory, DATABASE_NAME);
  const attachmentPath = resolve(resolvedBackupDirectory, ATTACHMENT_DIRECTORY_NAME);
  let inspection;
  try {
    inspection = inspectDatabase(databasePath);
  } catch (error) {
    throw new Error("The backup database is not usable: " + error.message);
  }
  await validateAttachmentFiles(attachmentPath, inspection.storageKeys);
  return {
    backupDirectory: resolvedBackupDirectory,
    databasePath,
    attachmentPath,
    manifest,
    storageKeyCount: inspection.storageKeys.length,
  };
}

export function isPortOpen(port) {
  return new Promise((resolvePortCheck) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePortCheck(open);
    };
    socket.setTimeout(750);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function moveIfPresent(source, destination, movedPaths) {
  if (!(await exists(source))) return;
  if (await exists(destination)) throw new Error("Rollback path already exists: " + destination);
  await rename(source, destination);
  movedPaths.push({ source, destination });
}

async function removeStaging(stagingDatabasePath, stagingAttachmentPath) {
  await Promise.all([
    rm(stagingDatabasePath, { force: true }),
    rm(stagingAttachmentPath, { force: true, recursive: true }),
  ]);
}

async function removeInstalledAndStaging({
  databaseInstalled,
  attachmentInstalled,
  databasePath,
  attachmentPath,
  stagingDatabasePath,
  stagingAttachmentPath,
}) {
  const removals = [removeStaging(stagingDatabasePath, stagingAttachmentPath)];
  if (databaseInstalled) removals.push(
    rm(databasePath, { force: true }),
    rm(databasePath + "-wal", { force: true }),
    rm(databasePath + "-shm", { force: true }),
  );
  if (attachmentInstalled) removals.push(rm(attachmentPath, { force: true, recursive: true }));
  await Promise.all(removals);
}

async function rollbackRestore(movedPaths, cleanupState) {
  const failures = [];
  try {
    await removeInstalledAndStaging(cleanupState);
  } catch (error) {
    failures.push("Could not clean up the incomplete restore: " + error.message);
  }
  for (const { source, destination } of [...movedPaths].reverse()) {
    try {
      if (await exists(destination)) await rename(destination, source);
    } catch (error) {
      failures.push("Could not restore the original path " + source + ": " + error.message);
    }
  }
  return failures;
}

export async function restoreWorkbench({
  backupDirectory,
  databasePath = resolve(process.env.WORKBENCH_DB_PATH || "data/workbench.sqlite"),
  attachmentPath = resolve(process.env.WORKBENCH_ATTACHMENT_DIR || "data/attachments"),
  confirmStopped = false,
  servicePort = Number(process.env.PORT || 3001),
  checkServiceRunning = isPortOpen,
  hooks = {},
}) {
  if (!confirmStopped) throw new Error("Stop the workbench service, then rerun with --confirm-stopped.");
  if (!Number.isInteger(servicePort) || servicePort < 1 || servicePort > 65535) throw new Error("Invalid service port: " + servicePort);
  if (await checkServiceRunning(servicePort)) throw new Error("Port " + servicePort + " is still accepting connections. Stop the workbench service first.");

  const backup = await validateBackup(backupDirectory);
  const targetDatabasePath = resolve(databasePath);
  const targetAttachmentPath = resolve(attachmentPath);
  assertSafeTargets(targetDatabasePath, targetAttachmentPath, backup.backupDirectory);

  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const stagingDatabasePath = targetDatabasePath + ".restore-staging-" + timestamp;
  const stagingAttachmentPath = targetAttachmentPath + ".restore-staging-" + timestamp;
  const rollbackDatabasePath = targetDatabasePath + ".pre-restore-" + timestamp;
  const rollbackWalPath = targetDatabasePath + "-wal.pre-restore-" + timestamp;
  const rollbackShmPath = targetDatabasePath + "-shm.pre-restore-" + timestamp;
  const rollbackAttachmentPath = targetAttachmentPath + ".pre-restore-" + timestamp;
  const reservedPaths = [
    stagingDatabasePath,
    stagingAttachmentPath,
    rollbackDatabasePath,
    rollbackWalPath,
    rollbackShmPath,
    rollbackAttachmentPath,
  ];
  for (const reservedPath of reservedPaths) {
    if (await exists(reservedPath)) throw new Error("A restore staging or rollback path already exists: " + reservedPath);
  }

  await Promise.all([
    mkdir(dirname(targetDatabasePath), { recursive: true }),
    mkdir(dirname(targetAttachmentPath), { recursive: true }),
  ]);
  try {
    await copyFile(backup.databasePath, stagingDatabasePath, fsConstants.COPYFILE_EXCL);
    await cp(backup.attachmentPath, stagingAttachmentPath, { recursive: true, errorOnExist: true, force: false });
    const stagingInspection = inspectDatabase(stagingDatabasePath);
    await validateAttachmentFiles(stagingAttachmentPath, stagingInspection.storageKeys);
  } catch (error) {
    await removeStaging(stagingDatabasePath, stagingAttachmentPath).catch(() => {});
    throw new Error("Could not prepare the restore; current data was not changed: " + error.message);
  }

  const movedPaths = [];
  let databaseInstalled = false;
  let attachmentInstalled = false;
  try {
    await moveIfPresent(targetDatabasePath, rollbackDatabasePath, movedPaths);
    await hooks.afterDatabaseMoved?.();
    await moveIfPresent(targetDatabasePath + "-wal", rollbackWalPath, movedPaths);
    await moveIfPresent(targetDatabasePath + "-shm", rollbackShmPath, movedPaths);
    await moveIfPresent(targetAttachmentPath, rollbackAttachmentPath, movedPaths);
    await hooks.afterCurrentMoved?.();

    await rename(stagingDatabasePath, targetDatabasePath);
    databaseInstalled = true;
    await rename(stagingAttachmentPath, targetAttachmentPath);
    attachmentInstalled = true;
    const restoredInspection = inspectDatabase(targetDatabasePath);
    await validateAttachmentFiles(targetAttachmentPath, restoredInspection.storageKeys);
  } catch (error) {
    const cleanupState = {
      databaseInstalled,
      attachmentInstalled,
      databasePath: targetDatabasePath,
      attachmentPath: targetAttachmentPath,
      stagingDatabasePath,
      stagingAttachmentPath,
    };
    const rollbackFailures = await rollbackRestore(movedPaths, cleanupState);
    const rollbackMessage = rollbackFailures.length
      ? "; automatic rollback had errors: " + rollbackFailures.join("; ")
      : "; original data was restored automatically";
    throw new Error("Restore failed: " + error.message + rollbackMessage);
  }

  return {
    databasePath: targetDatabasePath,
    attachmentPath: targetAttachmentPath,
    backupCreatedAt: backup.manifest.createdAt,
    storageKeyCount: backup.storageKeyCount,
    rollbackPaths: movedPaths.map(({ destination }) => destination),
  };
}

function parseArguments(argv) {
  const argumentsWithoutSeparator = argv.filter((argument) => argument !== "--");
  const confirmStopped = argumentsWithoutSeparator.includes("--confirm-stopped");
  const positional = argumentsWithoutSeparator.filter((argument) => argument !== "--confirm-stopped");
  if (positional.length !== 1) throw new Error("Usage: pnpm restore -- <backup-directory> --confirm-stopped");
  return { backupDirectory: positional[0], confirmStopped };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const result = await restoreWorkbench(options);
  console.log("Restore completed.");
  console.log("Database: " + result.databasePath);
  console.log("Attachments: " + result.attachmentPath);
  console.log("Backup created at: " + result.backupCreatedAt);
  if (result.rollbackPaths.length) {
    console.log("Pre-restore data was retained at:");
    for (const rollbackPath of result.rollbackPaths) console.log("- " + rollbackPath);
  } else {
    console.log("No previous data existed, so no rollback copy was created.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
