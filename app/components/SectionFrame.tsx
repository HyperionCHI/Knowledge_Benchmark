import type { ReactNode } from "react";

export type SectionSearchEntry = {
  id: string;
  group: string;
  title: string;
  body: string;
  meta?: string;
};

type SectionFrameProps = {
  id: string;
  index?: string;
  eyebrow: string;
  title: string;
  lead: string;
  children: ReactNode;
  tone?: "blue" | "purple" | "green" | "amber";
  searchQuery?: string;
  searchEntries?: SectionSearchEntry[];
};

export function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return <>{parts.map((part, index) => part.toLocaleLowerCase("zh-CN") === query.toLocaleLowerCase("zh-CN") ? <mark key={`${part}-${index}`}>{part}</mark> : part)}</>;
}

export function resultExcerpt(body: string, query: string) {
  const compact = body.replace(/\s+/g, " ").trim();
  const matchAt = compact.toLocaleLowerCase("zh-CN").indexOf(query.toLocaleLowerCase("zh-CN"));
  if (matchAt < 0) return compact.length > 190 ? `${compact.slice(0, 190)}…` : compact;
  const start = Math.max(0, matchAt - 65);
  const end = Math.min(compact.length, matchAt + query.length + 125);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function SectionSearchResults({ query, entries }: { query: string; entries: SectionSearchEntry[] }) {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const results = entries.filter((entry) => [entry.group, entry.title, entry.body, entry.meta ?? ""].join(" ").toLocaleLowerCase("zh-CN").includes(normalized));

  return (
    <div className="section-search-results" aria-live="polite">
      <div className="search-results-head"><span>板块内检索</span><b>找到 {results.length} 条</b></div>
      {results.length === 0 ? <div className="empty-search"><b>当前板块没有找到“{query}”</b><span>换一个关键词，或清空搜索查看全部内容。</span></div> : (
        <div className="search-result-list">
          {results.map((entry) => (
            <article className="search-result-card" key={entry.id}>
              <div><span>{entry.group}</span>{entry.meta && <small>{entry.meta}</small>}</div>
              <h3><HighlightedText text={entry.title} query={query.trim()} /></h3>
              <p><HighlightedText text={resultExcerpt(entry.body, query.trim())} query={query.trim()} /></p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function SectionFrame({ id, index, eyebrow, title, lead, children, tone = "blue", searchQuery = "", searchEntries }: SectionFrameProps) {
  const searching = Boolean(searchQuery.trim() && searchEntries);
  return (
    <section id={id} className={`knowledge-section tone-${tone}`} data-knowledge-section>
      <header className={`section-heading ${index ? "" : "section-heading-unindexed"}`}>
        {index && <span className="section-index">{index}</span>}
        <div>
          <p className="section-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="section-lead">{lead}</p>
        </div>
      </header>
      {searching ? <SectionSearchResults query={searchQuery.trim()} entries={searchEntries ?? []} /> : children}
    </section>
  );
}

export function SourceTag({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "green" | "purple" | "amber" | "red" }) {
  return <span className={`source-tag source-${tone}`}>{children}</span>;
}
