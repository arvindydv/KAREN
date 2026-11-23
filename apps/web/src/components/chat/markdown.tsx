'use client';

import { parseMarkdown, type MdBlock, type MdInline } from '@karen/ui';
import { cn } from '@karen/ui/web';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { IconCopy } from './icons';

/**
 * Renders chat Markdown from the @karen/ui AST as React elements. There is NO HTML path:
 * text is always a React text node (escaped), links are pre-filtered to http(s)/mailto and open
 * in a new tab without referrer or opener.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn('chat-md space-y-3 break-words', className)}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}

function Inline({ nodes }: { nodes: MdInline[] }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'br':
        return <br key={i} />;
      case 'code':
        return (
          <code
            key={i}
            className="rounded-md bg-[var(--karen-surface-raised)] px-1.5 py-0.5 font-mono text-[0.9em]"
          >
            {n.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            <Inline nodes={n.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={i}>
            <Inline nodes={n.children} />
          </em>
        );
      case 'link':
        return (
          <a
            key={i}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-[var(--karen-highlight)] underline underline-offset-2"
          >
            <Inline nodes={n.children} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        );
    }
  });
}

function Block({ block }: { block: MdBlock }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className="leading-relaxed">
          <Inline nodes={block.children} />
        </p>
      );
    case 'heading': {
      const cls = { 1: 'text-lg', 2: 'text-base', 3: 'text-sm uppercase tracking-wide' }[
        block.level
      ];
      return (
        <p role="heading" aria-level={block.level + 2} className={cn('font-semibold', cls)}>
          <Inline nodes={block.children} />
        </p>
      );
    }
    case 'code':
      return <CodeBlock lang={block.lang} text={block.text} />;
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-1 leading-relaxed">
          <Inline nodes={item} />
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start} className="list-decimal space-y-1 pl-6">
          {items}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-6">{items}</ul>
      );
    }
    case 'quote':
      return (
        <blockquote className="space-y-2 border-l-4 border-border pl-3 text-muted">
          {block.children.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </blockquote>
      );
    case 'hr':
      return <hr className="border-border" />;
    case 'table':
      return (
        <div className="overflow-x-auto rounded-[var(--karen-radius-sm)] border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--karen-surface-raised)]">
              <tr>
                {block.header.map((c, i) => (
                  <th key={i} scope="col" className="px-3 py-2 font-semibold">
                    <Inline nodes={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2 align-top">
                      <Inline nodes={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function CodeBlock({ lang, text }: { lang: string | null; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="overflow-hidden rounded-[var(--karen-radius-sm)] border border-border bg-[var(--karen-surface-raised)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-xs text-muted">
        <span>{lang ?? 'code'}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]"
          aria-label={copied ? 'Code copied' : 'Copy code'}
        >
          <IconCopy width={14} height={14} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className="font-mono">{text}</code>
      </pre>
    </div>
  );
}
