import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import "./editor-layout.css";

export const metadata: Metadata = {
  title: "工作空间 · 知识工作台",
  description: "可自托管的资料、SOP、项目索引、术语与模板知识库。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
