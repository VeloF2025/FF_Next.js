/**
 * Section Renderer Component
 * 
 * Renders markdown content with FibreFlow styling
 * Custom implementation since we can't add react-markdown
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface SectionRendererProps {
  content: string;
  sectionId?: string;
  className?: string;
}

export const SectionRenderer: React.FC<SectionRendererProps> = ({
  content,
  sectionId,
  className
}) => {
  // Parse markdown content into JSX elements
  const renderMarkdown = (text: string) => {
    if (!text || typeof text !== 'string') return null;
    
    const lines = text.split('\n');
    const elements: JSX.Element[] = [];
    let currentList: JSX.Element[] = [];
    let currentListType: 'ul' | 'ol' | null = null;
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let inTable = false;
    let tableRows: JSX.Element[] = [];
    let isTableHeader = false;

    const flushList = () => {
      if (currentList.length > 0 && currentListType) {
        if (currentListType === 'ul') {
          elements.push(
            <ul key={`list-${elements.length}`} className="list-disc list-inside mb-4 pl-4 text-[var(--ff-text-secondary)]">
              {currentList}
            </ul>
          );
        } else {
          elements.push(
            <ol key={`list-${elements.length}`} className="list-decimal list-inside mb-4 pl-4 text-[var(--ff-text-secondary)]">
              {currentList}
            </ol>
          );
        }
        currentList = [];
        currentListType = null;
      }
    };

    const flushTable = () => {
      if (tableRows.length > 0) {
        elements.push(
          <div key={`table-wrapper-${elements.length}`} className="overflow-x-auto mb-6">
            <table className="w-full border-collapse border border-[var(--ff-border-light)] rounded-lg">
              <tbody>
                {tableRows}
              </tbody>
            </table>
          </div>
        );
        tableRows = [];
        inTable = false;
        isTableHeader = false;
      }
    };

    const flushCodeBlock = () => {
      if (codeBlockContent.length > 0) {
        elements.push(
          <pre key={`code-${elements.length}`} className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] p-4 rounded-lg mb-4 overflow-x-auto border border-[var(--ff-border-light)]">
            <code>{codeBlockContent.join('\n')}</code>
          </pre>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Handle code blocks
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          flushCodeBlock();
        } else {
          flushList();
          flushTable();
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        continue;
      }

      // Empty line
      if (!line.trim()) {
        flushList();
        flushTable();
        if (elements.length > 0 && elements[elements.length - 1]?.type !== 'div') {
          elements.push(<div key={`spacer-${i}`} className="mb-2" />);
        }
        continue;
      }

      // Headers
      if (line.startsWith('#')) {
        flushList();
        flushTable();
        
        const level = line.match(/^#+/)?.[0].length || 1;
        const text = line.replace(/^#+\s*/, '');
        const id = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');

        const headingContent = formatInlineElements(text);

        if (level === 1) {
          elements.push(
            <h1 key={`h1-${i}`} id={id} className="text-3xl font-bold text-[var(--ff-text-primary)] mb-6 pb-2 border-b-2 border-[var(--ff-primary)]">
              {headingContent}
            </h1>
          );
        } else if (level === 2) {
          elements.push(
            <h2 key={`h2-${i}`} id={id} className="text-2xl font-semibold text-[var(--ff-text-primary)] mb-4 mt-8 pb-2 border-b border-[var(--ff-border-light)]">
              {headingContent}
            </h2>
          );
        } else if (level === 3) {
          elements.push(
            <h3 key={`h3-${i}`} id={id} className="text-xl font-semibold text-[var(--ff-text-primary)] mb-3 mt-6">
              {headingContent}
            </h3>
          );
        } else if (level === 4) {
          elements.push(
            <h4 key={`h4-${i}`} id={id} className="text-lg font-medium text-[var(--ff-primary)] mb-2 mt-4">
              {headingContent}
            </h4>
          );
        }
        continue;
      }

      // Tables
      if (line.includes('|') && !inTable) {
        flushList();
        inTable = true;
        isTableHeader = true;
      }

      if (inTable && line.includes('|')) {
        const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
        
        if (cells.length > 0) {
          const cellElements = cells.map((cell, cellIndex) => {
            const cellContent = formatInlineElements(cell);
            if (isTableHeader) {
              return (
                <th
                  key={`header-${cellIndex}`}
                  className="bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] font-semibold p-3 text-left border border-[var(--ff-border-light)]"
                >
                  {cellContent}
                </th>
              );
            } else {
              return (
                <td
                  key={`cell-${cellIndex}`}
                  className="p-3 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]"
                >
                  {cellContent}
                </td>
              );
            }
          });

          tableRows.push(
            <tr key={`row-${i}`}>
              {cellElements}
            </tr>
          );

          // Check if next line is separator
          if (i + 1 < lines.length && lines[i + 1].match(/^\s*\|[\s\|\-:]+\|\s*$/)) {
            isTableHeader = false;
            i++; // Skip separator line
          } else if (isTableHeader) {
            isTableHeader = false;
          }
        }
        continue;
      } else if (inTable && !line.includes('|')) {
        flushTable();
      }

      // Lists
      if (line.match(/^\s*[\-\*\+]\s+/) || line.match(/^\s*\d+\.\s+/)) {
        const isOrdered = line.match(/^\s*\d+\.\s+/);
        const newListType = isOrdered ? 'ol' : 'ul';
        
        if (currentListType !== newListType) {
          flushList();
          currentListType = newListType;
        }
        
        const text = line.replace(/^\s*(\d+\.|\-|\*|\+)\s+/, '');
        const content = formatInlineElements(text);
        
        currentList.push(
          <li key={`li-${i}`} className="mb-1">
            {content}
          </li>
        );
        continue;
      } else {
        flushList();
      }

      // Blockquotes
      if (line.startsWith('>')) {
        const text = line.replace(/^>\s*/, '');
        const content = formatInlineElements(text);
        elements.push(
          <blockquote key={`quote-${i}`} className="border-l-4 border-[var(--ff-primary)] bg-[var(--ff-bg-secondary)] p-4 mb-4 italic text-[var(--ff-text-secondary)]">
            {content}
          </blockquote>
        );
        continue;
      }

      // Horizontal rules
      if (line.match(/^[\-\*_]{3,}$/)) {
        elements.push(
          <hr key={`hr-${i}`} className="my-6 border-[var(--ff-border-light)]" />
        );
        continue;
      }

      // HTML img tags (e.g., <img src="..." alt="..." />)
      if (line.match(/<img\s/)) {
        const srcMatch = line.match(/src="([^"]+)"/);
        const altMatch = line.match(/alt="([^"]+)"/);
        if (srcMatch) {
          elements.push(
            <div key={`htmlimg-${i}`} className="my-4">
              <img
                src={srcMatch[1]}
                alt={altMatch?.[1] || ''}
                className="rounded-lg border border-[var(--ff-border-light)] shadow-lg max-w-full"
                loading="lazy"
              />
            </div>
          );
        }
        continue;
      }

      // Regular paragraphs
      if (line.trim()) {
        const content = formatInlineElements(line);
        elements.push(
          <p key={`p-${i}`} className="mb-4 text-[var(--ff-text-secondary)] leading-relaxed">
            {content}
          </p>
        );
      }
    }

    // Flush any remaining content
    flushList();
    flushTable();
    flushCodeBlock();

    return elements;
  };

  // Format inline elements (bold, italic, code, links)
  const formatInlineElements = (text: string): React.ReactNode => {
    const parts = [];
    let remaining = text;
    let key = 0;

    while (remaining) {
      // Bold text (**text** or __text__)
      const boldMatch = remaining.match(/(\*\*|__)(.*?)\1/);
      if (boldMatch) {
        const beforeBold = remaining.substring(0, boldMatch.index);
        if (beforeBold) {
          parts.push(beforeBold);
        }
        parts.push(
          <strong key={`bold-${key++}`} className="font-semibold text-[var(--ff-text-primary)]">
            {boldMatch[2]}
          </strong>
        );
        remaining = remaining.substring((boldMatch.index || 0) + boldMatch[0].length);
        continue;
      }

      // Italic text (*text* or _text_)
      const italicMatch = remaining.match(/(\*|_)(.*?)\1/);
      if (italicMatch && italicMatch[2]) {
        const beforeItalic = remaining.substring(0, italicMatch.index);
        if (beforeItalic) {
          parts.push(beforeItalic);
        }
        parts.push(
          <em key={`italic-${key++}`} className="italic">
            {italicMatch[2]}
          </em>
        );
        remaining = remaining.substring((italicMatch.index || 0) + italicMatch[0].length);
        continue;
      }

      // Code (`code`)
      const codeMatch = remaining.match(/`([^`]+)`/);
      if (codeMatch) {
        const beforeCode = remaining.substring(0, codeMatch.index);
        if (beforeCode) {
          parts.push(beforeCode);
        }
        parts.push(
          <code key={`code-${key++}`} className="bg-[var(--ff-bg-tertiary)] px-2 py-1 rounded text-sm font-mono text-[var(--ff-text-primary)]">
            {codeMatch[1]}
          </code>
        );
        remaining = remaining.substring((codeMatch.index || 0) + codeMatch[0].length);
        continue;
      }

      // Images (![alt](src))
      const imageMatch = remaining.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      if (imageMatch) {
        const beforeImage = remaining.substring(0, imageMatch.index);
        if (beforeImage) {
          parts.push(beforeImage);
        }
        parts.push(
          <span key={`img-wrap-${key++}`} className="block my-4">
            <img
              src={imageMatch[2]}
              alt={imageMatch[1]}
              className="rounded-lg border border-[var(--ff-border-light)] shadow-lg max-w-full"
              loading="lazy"
            />
            {imageMatch[1] && (
              <span className="block text-xs text-[var(--ff-text-tertiary)] mt-2 italic text-center">
                {imageMatch[1]}
              </span>
            )}
          </span>
        );
        remaining = remaining.substring((imageMatch.index || 0) + imageMatch[0].length);
        continue;
      }

      // Links ([text](url))
      const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const beforeLink = remaining.substring(0, linkMatch.index);
        if (beforeLink) {
          parts.push(beforeLink);
        }
        parts.push(
          <a
            key={`link-${key++}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--ff-primary)] hover:underline"
          >
            {linkMatch[1]}
          </a>
        );
        remaining = remaining.substring((linkMatch.index || 0) + linkMatch[0].length);
        continue;
      }

      // No more patterns found, add the rest
      parts.push(remaining);
      break;
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  const renderedContent = renderMarkdown(content);

  return (
    <div className={cn('prose prose-invert max-w-none', className)}>
      <div className="space-y-1">
        {renderedContent}
      </div>
    </div>
  );
};