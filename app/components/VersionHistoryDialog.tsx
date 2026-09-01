"use client";

import { useEffect, useMemo, useState } from "react";

type VersionItem = { id: string; version: number; payload: Record<string, unknown>; createdBy: string; createdAt: string };

function textOf(item: VersionItem) {
  const value = item.payload.body ?? item.payload.content ?? item.payload.note ?? item.payload.title ?? "";
  return String(value);
}

export function VersionHistoryDialog({ type, entityId, currentText, onClose, onRestored }: { type: "doc" | "sop" | "tracker-link"; entityId: string; currentText: string; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/versions?type=${encodeURIComponent(type)}&id=${encodeURIComponent(entityId)}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "版本记录读取失败"); return body; })
      .then((body) => { if (!active) return; const items = body.versions || []; setVersions(items); setSelected(items[0]?.id || ""); })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "版本记录读取失败"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [entityId, type]);

  const item = useMemo(() => versions.find((version) => version.id === selected), [selected, versions]);

  async function restore() {
    if (!item || !window.confirm(`确认恢复到 v${item.version}？系统会先保存当前版本，恢复后仍可撤销。`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: item.id }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "版本恢复失败");
      onRestored();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "版本恢复失败"); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop version-history-backdrop"><section className="modal version-history-modal" role="dialog" aria-modal="true" aria-label="版本历史">
    <header><div><span>VERSION HISTORY</span><h2>版本历史</h2><p>选择历史版本，可与当前正文并排比较后恢复。</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
    {error && <div className="inline-notice error-notice">{error}</div>}
    {loading ? <div className="empty-state"><b>正在读取版本记录…</b></div> : versions.length === 0 ? <div className="empty-state"><b>暂无历史版本</b><small>内容首次修改后会自动保留历史版本。</small></div> : <>
      <div className="version-toolbar"><label>历史版本<select value={selected} onChange={(event) => setSelected(event.target.value)}>{versions.map((version) => <option value={version.id} key={version.id}>v{version.version} · {version.createdBy} · {new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false })}</option>)}</select></label><button className="primary" disabled={!item || busy} onClick={restore}>{busy ? "正在恢复…" : "恢复此版本"}</button></div>
      <div className="version-compare"><article><b>历史版本 v{item?.version}</b><pre>{item ? textOf(item) : ""}</pre></article><article><b>当前版本</b><pre>{currentText}</pre></article></div>
    </>}
  </section></div>;
}
