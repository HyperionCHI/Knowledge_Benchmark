export const DEFAULT_DOCUMENT_TREE_ICON = "docs";
export const DEFAULT_DOCUMENT_TREE_ICON_COLOR = "#53617b";

export const documentTreeIconChoices = [
  "docs", "book", "templates", "sop", "ideas", "clipboard", "database", "code",
  "globe", "building", "briefcase", "package", "boxes", "target", "rocket", "app",
  "laptop", "phone", "shopping", "cloud", "palette", "shield", "service", "audio",
  "marketing", "premium", "badge", "dashboard", "sparkle",
] as const;

export const documentTreeColorChoices = [
  "#53617b", "#2859e8", "#124f9f", "#0c7c86", "#5a7f45", "#9a6700", "#c54526", "#923947", "#6757f5", "#17243b",
] as const;

export const documentTreeIconLabels: Record<(typeof documentTreeIconChoices)[number], string> = {
  docs: "文档", book: "书籍", templates: "模板", sop: "清单", ideas: "灵感", clipboard: "剪贴板", database: "数据库", code: "代码",
  globe: "全球", building: "组织", briefcase: "业务", package: "包裹", boxes: "集合", target: "目标", rocket: "项目", app: "应用",
  laptop: "电脑", phone: "手机", shopping: "零售", cloud: "云端", palette: "设计", shield: "安全", service: "服务", audio: "音频",
  marketing: "营销", premium: "精选", badge: "徽章", dashboard: "看板", sparkle: "亮点",
};

export function isDocumentTreeIcon(value: unknown): value is string {
  return typeof value === "string" && (documentTreeIconChoices as readonly string[]).includes(value);
}

export function isDocumentTreeIconColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeDocumentTreeIcon(value: unknown) {
  return isDocumentTreeIcon(value) ? value : DEFAULT_DOCUMENT_TREE_ICON;
}

export function normalizeDocumentTreeIconColor(value: unknown) {
  return isDocumentTreeIconColor(value) ? value.toLowerCase() : DEFAULT_DOCUMENT_TREE_ICON_COLOR;
}
