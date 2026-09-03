export function formatFileSize(size: number | null | undefined) {
  if (!size) return "";
  return size < 1024 * 1024
    ? `${Math.max(1, Math.ceil(size / 1024))} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
