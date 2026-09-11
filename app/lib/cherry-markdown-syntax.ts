type Node = {
  type: string; name?: string; value?: string; children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { directiveLabel?: boolean; hName?: string; hProperties?: Record<string, unknown> };
};
const panelNames = new Set(["primary", "success", "info", "warning", "danger", "tip", "note", "left", "center", "right", "justify", "2cols", "3cols", "cols", "tabs"]);

/** Adapt Cherry's block delimiters to remark directives, leaving code fences untouched. */
export function normalizeCherryBlocks(markdown: string) {
  const stack: Array<{ marker: string; fence: string }> = [];
  let codeFence = "";
  const escapeLabel = (label: string) => label.replace(/([\\[\]])/g, "\\$1");
  return markdown.split(/\r\n?|\n/).map((line) => {
    const code = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (codeFence) {
      if (code && code[1][0] === codeFence[0] && code[1].length >= codeFence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) codeFence = "";
      return line;
    }
    if (code) { codeFence = code[1]; return line; }
    const closing = line.match(/^ {0,3}(:::|\+\+\+)\s*$/);
    if (closing && stack.at(-1)?.marker === closing[1]) return stack.pop()!.fence;
    const panel = line.match(/^ {0,3}:::\s+([\w-]+)(?:\s+(.*))?$/);
    const detail = line.match(/^ {0,3}\+\+\+\s+(.*)$/);
    if ((panel && panelNames.has(panel[1])) || detail) {
      const fence = ":".repeat(Math.max(3, 32 - stack.length));
      const name = panel ? "workbench-" + panel[1] : "workbench-detail";
      const label = panel ? panel[2] || "" : detail![1];
      stack.push({ marker: panel ? ":::" : "+++", fence });
      return fence + name + (label ? "[" + escapeLabel(label) + "]" : "");
    }
    if (stack.length && /^ {0,3}::(?:\s|$)/.test(line)) return "::workbench-column[" + escapeLabel(line.replace(/^ {0,3}::\s*/, "")) + "]";
    return line;
  }).join("\n");
}

export function remarkCherryBlocks() {
  return (tree: Node, file: { value: unknown }) => {
    const visit = (node: Node) => {
      if (node.type.endsWith("Directive")) {
        const kind = node.name?.replace(/^workbench-/, "");
        if (!node.name?.startsWith("workbench-") || (!panelNames.has(kind || "") && kind !== "detail" && kind !== "column")) {
          const start = node.position?.start.offset, end = node.position?.end.offset;
          node.type = "text";
          node.value = typeof start === "number" && typeof end === "number" ? String(file.value).slice(start, end) : "";
          delete node.children;
          return;
        }
        const title = node.children?.[0]?.data?.directiveLabel ? node.children.shift()! : null;
        if (kind === "detail") {
          node.data = { hName: "details", hProperties: { className: ["knowledge-details"] } };
          const summary: Node = { type: "paragraph", children: title?.children || [{ type: "text", value: "详情" }], data: { hName: "summary" } };
          node.children = [summary, ...(node.children || [])];
        } else if (kind === "column") {
          node.data = { hName: "hr", hProperties: { className: ["knowledge-column-break"] } };
          if (title) node.children = [title];
        } else {
          node.data = { hName: "div", hProperties: { className: ["knowledge-panel", "knowledge-panel-" + kind] } };
          if (title) { title.data = { hName: "div", hProperties: { className: ["knowledge-panel-title"] } }; node.children?.unshift(title); }
          if (["2cols", "3cols", "cols", "tabs"].includes(kind!)) {
            const groups: Node[] = [];
            let group: Node = { type: "containerDirective", name: "workbench-group", children: [], data: { hName: "div" } };
            for (const child of node.children || []) {
              if (child.name === "workbench-column") {
                if (group.children?.length) groups.push(group);
                const label = child.children?.[0];
                group = { type: "paragraph", children: [], data: { hName: kind === "tabs" ? "details" : "div" } };
                if (label?.children?.length) group.children?.push({ type: "paragraph", children: label.children, data: { hName: kind === "tabs" ? "summary" : "div" } });
              } else group.children?.push(child);
            }
            if (group.children?.length) groups.push(group);
            // Grouping nodes are ordinary flow nodes, never arbitrary user-selected HTML.
            groups.forEach((item) => { item.type = "paragraph"; });
            node.children = groups;
          }
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
