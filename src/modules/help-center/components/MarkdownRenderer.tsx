import React, { useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
  searchHighlight?: string;
}

/**
 * Lightweight markdown renderer for the Help Center.
 * Handles: headings, bold, italic, code, lists, tables, links, blockquotes, hr
 */
export function MarkdownRenderer({ content, searchHighlight }: MarkdownRendererProps) {
  const rendered = useMemo(() => {
    if (!content) return [];
    return parseMarkdownBlocks(content);
  }, [content]);

  return (
    <div className="prose prose-invert max-w-none space-y-3">
      {rendered.map((block, i) => (
        <MarkdownBlock key={i} block={block} searchHighlight={searchHighlight} />
      ))}
    </div>
  );
}

type BlockType = 'paragraph' | 'heading' | 'list' | 'table' | 'code' | 'blockquote' | 'hr';

interface Block {
  type: BlockType;
  content: string;
  level?: number; // heading level
  rows?: string[][]; // table rows
  items?: string[]; // list items
  ordered?: boolean;
  language?: string;
}

function parseMarkdownBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      blocks.push({ type: 'hr', content: '' });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', content: headingMatch[2]!, level: headingMatch[1]!.length });
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().replace('```', '').trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      blocks.push({ type: 'code', content: codeLines.join('\n'), language: lang || undefined });
      i++; // skip closing ```
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && /^\|[\s-:|]+\|$/.test(lines[i + 1]!.trim())) {
      const rows: string[][] = [];
      // Header row
      rows.push(parseTRow(line));
      i++; // skip separator
      i++;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim().startsWith('|')) {
        rows.push(parseTRow(lines[i]!));
        i++;
      }
      blocks.push({ type: 'table', content: '', rows });
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    // List (ordered or unordered)
    if (/^[\s]*[-*+]\s/.test(line) || /^[\s]*\d+\.\s/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && (/^[\s]*[-*+]\s/.test(lines[i]!) || /^[\s]*\d+\.\s/.test(lines[i]!))) {
        items.push(lines[i]!.replace(/^[\s]*[-*+]\s/, '').replace(/^[\s]*\d+\.\s/, ''));
        i++;
      }
      blocks.push({ type: 'list', content: '', items, ordered });
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.match(/^#{1,6}\s/) && !lines[i]!.trim().startsWith('```') && !lines[i]!.trim().startsWith('>') && !/^[\s]*[-*+]\s/.test(lines[i]!) && !/^[\s]*\d+\.\s/.test(lines[i]!) && !/^---+$/.test(lines[i]!.trim())) {
      paraLines.push(lines[i]!);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join(' ') });
    }
  }

  return blocks;
}

function parseTRow(row: string): string[] {
  return row.split('|').slice(1, -1).map(c => c.trim());
}

function MarkdownBlock({ block, searchHighlight }: { block: Block; searchHighlight?: string }) {
  switch (block.type) {
    case 'hr':
      return <hr className="border-white/10 my-6" />;

    case 'heading': {
      const Tag = `h${Math.min(block.level || 3, 6)}` as keyof JSX.IntrinsicElements;
      const sizes: Record<number, string> = {
        1: 'text-2xl font-bold mt-8 mb-4',
        2: 'text-xl font-bold mt-6 mb-3',
        3: 'text-lg font-semibold mt-5 mb-2',
        4: 'text-base font-semibold mt-4 mb-2',
        5: 'text-sm font-semibold mt-3 mb-1',
        6: 'text-sm font-medium mt-3 mb-1',
      };
      return (
        <Tag className={`${sizes[block.level || 3]} text-white`}>
          <InlineMarkdown text={block.content} highlight={searchHighlight} />
        </Tag>
      );
    }

    case 'paragraph':
      return (
        <p className="text-gray-300 leading-relaxed">
          <InlineMarkdown text={block.content} highlight={searchHighlight} />
        </p>
      );

    case 'code':
      return (
        <pre className="bg-black/40 border border-white/10 rounded-lg p-4 overflow-x-auto text-sm">
          <code className="text-green-400">{block.content}</code>
        </pre>
      );

    case 'blockquote':
      return (
        <blockquote className="border-l-4 border-blue-500/50 pl-4 py-1 text-gray-400 italic">
          <InlineMarkdown text={block.content} highlight={searchHighlight} />
        </blockquote>
      );

    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag className={`space-y-1.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'} text-gray-300`}>
          {block.items?.map((item, i) => (
            <li key={i} className="leading-relaxed">
              <InlineMarkdown text={item} highlight={searchHighlight} />
            </li>
          ))}
        </ListTag>
      );
    }

    case 'table':
      if (!block.rows || block.rows.length === 0) return null;
      return (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card/5">
                {block.rows[0].map((cell, i) => (
                  <th key={i} className="px-4 py-2 text-left font-semibold text-gray-200 border-b border-white/10">
                    <InlineMarkdown text={cell} highlight={searchHighlight} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, ri) => (
                <tr key={ri} className="border-b border-white/5 hover:bg-card/5">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-4 py-2 text-gray-300">
                      <InlineMarkdown text={cell} highlight={searchHighlight} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return null;
  }
}

function InlineMarkdown({ text, highlight }: { text: string; highlight?: string }) {
  // Process inline markdown: bold, italic, code, links, images
  const processed = text;

  // Split into segments to handle inline code, bold, italic, links
  const segments = parseInline(processed);

  return (
    <>
      {segments.map((seg, i) => {
        let el: React.ReactNode;
        if (seg.type === 'code') {
          el = <code key={i} className="bg-card/10 px-1.5 py-0.5 rounded text-sm text-orange-300">{seg.text}</code>;
        } else if (seg.type === 'bold') {
          el = <strong key={i} className="text-white font-semibold">{seg.text}</strong>;
        } else if (seg.type === 'italic') {
          el = <em key={i}>{seg.text}</em>;
        } else if (seg.type === 'bolditalic') {
          el = <strong key={i} className="text-white font-semibold"><em>{seg.text}</em></strong>;
        } else if (seg.type === 'link') {
          el = <a key={i} href={seg.href} className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">{seg.text}</a>;
        } else {
          // Plain text — apply search highlight if present
          if (highlight && highlight.length >= 2) {
            const parts = seg.text.split(new RegExp(`(${escapeRegex(highlight)})`, 'gi'));
            el = (
              <span key={i}>
                {parts.map((part, j) =>
                  part.toLowerCase() === highlight.toLowerCase() ? (
                    <mark key={j} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part}</mark>
                  ) : (
                    part
                  )
                )}
              </span>
            );
          } else {
            el = <span key={i}>{seg.text}</span>;
          }
        }
        return el;
      })}
    </>
  );
}

interface InlineSegment {
  type: 'text' | 'code' | 'bold' | 'italic' | 'bolditalic' | 'link';
  text: string;
  href?: string;
}

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  // Combined regex for inline patterns
  const regex = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      segments.push({ type: 'code', text: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ type: 'link', text: match[2], href: match[3] });
    } else if (match[4] !== undefined) {
      segments.push({ type: 'bolditalic', text: match[4] });
    } else if (match[5] !== undefined) {
      segments.push({ type: 'bold', text: match[5] });
    } else if (match[6] !== undefined) {
      segments.push({ type: 'italic', text: match[6] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text }];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
