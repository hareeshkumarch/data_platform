/**
 * MarkdownRenderer — renders LLM markdown responses with proper formatting.
 *
 * Uses react-markdown + remark-gfm for tables, bold, headings, lists, etc.
 * Styled with Tailwind prose utilities for a clean, readable look.
 */
import React, { Component } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";

// Safety layer for fragile markdown parser (e.g. gfm footnotes)
class MarkdownErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any) { console.error("Markdown Render Error:", error); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-3 border border-dashed rounded-md text-muted-foreground italic bg-muted/20 text-[13px]">
          The response content is slightly malformed for complex formatting. Reverting to basic rendering...
        </div>
      );
    }
    return this.props.children;
  }
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-bold text-foreground mt-4 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-bold text-foreground mt-3 mb-1.5">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground mt-2.5 mb-1">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-medium text-foreground mt-2 mb-1">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-[14.5px] leading-relaxed text-foreground mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-foreground/90">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-inside space-y-1 mb-2 text-[14px] text-foreground">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside space-y-1 mb-2 text-[14px] text-foreground">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent/40 pl-3 my-2 text-muted-foreground italic text-[14px]">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="bg-surface border border-border rounded-lg p-3 my-2 overflow-x-auto text-[13px] font-mono text-foreground">
          <code className={className} {...props}>{children}</code>
        </pre>
      );
    }
    return (
      <code className="bg-surface border border-border rounded px-1.5 py-0.5 text-[13px] font-mono text-accent" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 rounded-lg border border-border">
      <table className="w-full text-sm text-left text-foreground">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/50 text-muted-foreground">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 font-medium whitespace-nowrap border-b border-border">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 whitespace-nowrap text-[13px] border-b border-border/50">{children}</td>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 hover:text-accent/80 transition-colors">
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-border" />,
};

export const MarkdownRenderer = ({ content, className }: MarkdownRendererProps) => {
  if (!content) return null;
  return (
    <div className={cn("markdown-content", className)}>
      <MarkdownErrorBoundary>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </MarkdownErrorBoundary>
    </div>
  );
};
