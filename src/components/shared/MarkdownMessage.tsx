/**
 * @fileoverview Markdown 消息渲染组件
 *
 * 支持：
 * - 标题 (## ### ####)
 * - 有序/无序列表
 * - 代码块 (```)
 * - 引用块 (>)
 * - 行内代码 (`)
 * - 粗体 (**)
 * - 链接自动检测
 * - 表格 (简单)
 * - 分割线
 */

import type { ReactNode } from "react";
import styles from "./markdownMessage.module.css";

type MarkdownBlock =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string; content: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "divider" };

/**
 * 渲染 Markdown 文本为 React 节点
 */
export function MarkdownMessage({ text }: { text: string }): ReactNode {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const HeadingTag = block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h4";
          return (
            <HeadingTag key={index} className={styles.heading}>
              {renderInlineMarkdown(block.text)}
            </HeadingTag>
          );
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={index} className={styles.list}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.kind === "code") {
          return (
            <pre key={index} className={styles.codeBlock}>
              {block.language && <span className={styles.codeLang}>{block.language}</span>}
              <code>{block.content}</code>
            </pre>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote key={index} className={styles.blockquote}>
              {block.lines.map((line, i) => (
                <p key={i}>{renderInlineMarkdown(line)}</p>
              ))}
            </blockquote>
          );
        }
        if (block.kind === "divider") {
          return <hr key={index} className={styles.divider} />;
        }
        return (
          <p key={index} className={styles.paragraph}>
            {renderMarkdownLines(block.lines, `p-${index}`)}
          </p>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────
// 解析逻辑
// ───────────────────────────────────────────────

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // 代码块
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language: fence[1] ?? "", content: codeLines.join("\n") });
      continue;
    }

    // 分割线
    if (/^(---|___|\*{3,})\s*$/.test(line)) {
      blocks.push({ kind: "divider" });
      index += 1;
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: Math.min(heading[1].length, 4) as 2 | 3 | 4,
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    // 引用块
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quoteLine = lines[index].match(/^>\s?(.*)$/);
        if (!quoteLine) break;
        quoteLines.push(quoteLine[1]);
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }

    // 列表
    const list = parseListLine(line);
    if (list) {
      const items: string[] = [];
      const ordered = list.ordered;
      while (index < lines.length) {
        const parsed = parseListLine(lines[index]);
        if (!parsed || parsed.ordered !== ordered) break;
        items.push(parsed.text);
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // 表格（简单检测：包含 | 的行）
    if (line.includes("|") && index + 1 < lines.length && lines[index + 1].includes("-")) {
      const tableRows: string[] = [];
      while (index < lines.length && lines[index].includes("|")) {
        tableRows.push(lines[index]);
        index += 1;
      }
      // 表格渲染为代码块
      blocks.push({ kind: "code", language: "table", content: tableRows.join("\n") });
      continue;
    }

    // 段落
    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (
        /^```/.test(lines[index]) ||
        /^(#{1,4})\s+/.test(lines[index]) ||
        /^>\s?/.test(lines[index]) ||
        parseListLine(lines[index]) ||
        /^(---|___|\*{3,})\s*$/.test(lines[index])
      ) {
        break;
      }
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraphLines });
  }

  return blocks.length > 0 ? blocks : [{ kind: "paragraph", lines: [text] }];
}

function parseListLine(line: string): { ordered: boolean; text: string } | null {
  const unordered = line.match(/^\s*[-*]\s+(.+)$/);
  if (unordered) return { ordered: false, text: unordered[1].trim() };
  const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
  if (ordered) return { ordered: true, text: ordered[1].trim() };
  return null;
}

// ───────────────────────────────────────────────
// 行内渲染
// ───────────────────────────────────────────────

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 匹配：行内代码 `code`、粗体 **bold**、斜体 *italic*、删除线 ~~strike~~、链接 [text](url)
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(renderPlainText(text.slice(cursor, match.index)));
    }

    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={`${match.index}-code`} className={styles.inlineCode}>
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${match.index}-strong`} className={styles.bold}>
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(
        <del key={`${match.index}-del`} className={styles.strike}>
          {token.slice(2, -2)}
        </del>
      );
    } else if (token.startsWith("[") && token.includes("](")) {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        nodes.push(
          <a
            key={`${match.index}-link`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            {linkMatch[1]}
          </a>
        );
      }
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={`${match.index}-em`} className={styles.italic}>
          {token.slice(1, -1)}
        </em>
      );
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(renderPlainText(text.slice(cursor)));
  }

  return nodes;
}

/**
 * 渲染纯文本，自动检测 URL 并转为链接
 */
function renderPlainText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const urlPattern = /(https?:\/\/[^\s<>"'`]+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    nodes.push(
      <a
        key={`url-${match.index}`}
        href={match[1]}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
      >
        {match[1].length > 40 ? match[1].slice(0, 37) + "..." : match[1]}
      </a>
    );
    cursor = match.index + match[1].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function renderMarkdownLines(lines: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      nodes.push(<br key={`${keyPrefix}-br-${lineIndex}`} />);
    }
    renderInlineMarkdown(line).forEach((node, nodeIndex) => {
      nodes.push(<span key={`${keyPrefix}-${lineIndex}-${nodeIndex}`}>{node}</span>);
    });
  });
  return nodes;
}
