export const DEFAULT_CATEGORY_COLOR = "#124f9f";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeCategoryInput(body: Record<string, unknown>) {
  const name = clean(body.name);
  const description = clean(body.description);
  const requestedColor = clean(body.color);
  const color = /^#[0-9a-f]{6}$/i.test(requestedColor) ? requestedColor : DEFAULT_CATEGORY_COLOR;
  return { name, description, color };
}

export function categoryWriteError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.includes("UNIQUE")) return "分类名称已存在。";
  return error instanceof Error ? error.message : fallback;
}
