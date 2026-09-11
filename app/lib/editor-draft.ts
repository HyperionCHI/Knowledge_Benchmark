export type EditorDraft = {
  title: string;
  group: string;
  body: string;
  attachmentIds: string[];
  pendingDeleteIds: string[];
  status: "draft" | "published" | "archived";
  treeIcon: string;
  treeIconColor: string;
  baseVersion: number;
  savedAt: string;
};

export function editorDraftKey(userId: string, scope: string, brand: string, product: string, documentId?: string) {
  return "workspace-draft:v2:" + JSON.stringify([userId, scope, brand, product, documentId || "new"]);
}

export function parseEditorDraft(raw: string | null): EditorDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || !["title", "group", "body", "treeIcon", "treeIconColor", "savedAt"].every((key) => typeof value[key] === "string") ||
      !["draft", "published", "archived"].includes(value.status) || !Number.isInteger(value.baseVersion) || value.baseVersion < 0 ||
      ![value.attachmentIds, value.pendingDeleteIds].every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string"))) return null;
    return value;
  } catch { return null; }
}
