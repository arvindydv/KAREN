/**
 * Minimal, safe Markdown → AST for chat messages (web and mobile render the AST natively).
 *
 * Security: this never produces HTML. Raw HTML in the input stays literal text; links are
 * kept only for http(s) and mailto URLs (everything else — javascript:, data:, relative —
 * renders as plain text). Designed for model output that may still be streaming: an unclosed
 * code fence runs to the end, unbalanced emphasis stays literal.
 *
 * Supported: paragraphs with line breaks, # headings (1–3), - * + bullet and 1. ordered lists,
 * > quotes, ``` fenced code, --- rules, GFM pipe tables; inline **strong**, *em* / _em_,
 * `code`, [text](https://…) links and bare https:// URLs.
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MdInline[] }
  | { type: 'br' };

export type MdBlock =
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: MdInline[] }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: MdInline[][] }
  | { type: 'quote'; children: MdBlock[] }
  | { type: 'hr' }
  | { type: 'table'; header: MdInline[][]; rows: MdInline[][][] };

const SAFE_URL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+)$/i;

/** True for URLs a chat message may link to. */
export const isSafeLinkUrl = (url: string): boolean => SAFE_URL.test(url.trim());

const FENCE = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) });
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) body.push(lines[i++]!);
      i++; // closing fence (or past the end while streaming)
      blocks.push({ type: 'code', lang: fence[2] || null, text: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }
    if (HR.test(line)) {
      flushPara();
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      const level = Math.min(heading[1]!.length, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2]!) });
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      flushPara();
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: MdInline[][][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(splitRow(lines[i]!).map(parseInline));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (QUOTE.test(line)) {
      flushPara();
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(QUOTE.exec(lines[i++]!)![1]!);
      blocks.push({ type: 'quote', children: parseMarkdown(inner.join('\n')) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flushPara();
      const isOrdered = !bullet;
      const start = ordered ? Number(ordered[1]) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const b = BULLET.exec(l);
        const o = ORDERED.exec(l);
        const m = isOrdered ? o : b;
        if (m) {
          items.push(isOrdered ? o![2]! : b![1]!);
          i++;
        } else if (l.trim() !== '' && /^\s{2,}\S/.test(l) && items.length > 0) {
          items[items.length - 1] += `\n${l.trim()}`; // continuation line
          i++;
        } else break;
      }
      blocks.push({ type: 'list', ordered: isOrdered, start, items: items.map(parseInline) });
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

const BARE_URL = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/y;

/** Inline parser: a small left-to-right scanner (no regex backtracking on user input). */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let buf = '';
  const push = (node: MdInline) => {
    if (buf) {
      out.push({ type: 'text', text: buf });
      buf = '';
    }
    out.push(node);
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length && /[\\`*_[\]()#>|-]/.test(text[i + 1]!)) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      push({ type: 'br' });
      i++;
      continue;
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        push({ type: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && text[i + 1] === ch) {
      const end = text.indexOf(ch + ch, i + 2);
      if (end > i + 2) {
        push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && text[i + 1] !== ch && text[i + 1] !== ' ') {
      // `_` inside words (snake_case) is not emphasis.
      const wordBefore = ch === '_' && i > 0 && /\w/.test(text[i - 1]!);
      const end = text.indexOf(ch, i + 1);
      if (!wordBefore && end > i + 1 && text[end - 1] !== ' ') {
        push({ type: 'em', children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const close = text.indexOf('](', i + 1);
      const end = close > -1 ? text.indexOf(')', close + 2) : -1;
      if (close > i && end > close) {
        const label = text.slice(i + 1, close);
        const href = text.slice(close + 2, end).trim();
        if (isSafeLinkUrl(href)) push({ type: 'link', href, children: parseInline(label) });
        else push({ type: 'text', text: label });
        i = end + 1;
        continue;
      }
    }
    if (ch === 'h' && (text.startsWith('http://', i) || text.startsWith('https://', i))) {
      BARE_URL.lastIndex = i;
      const m = BARE_URL.exec(text);
      if (m) {
        push({ type: 'link', href: m[0], children: [{ type: 'text', text: m[0] }] });
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  if (buf) out.push({ type: 'text', text: buf });
  return out;
}

/** Plain text of inline nodes (for copy, accessibility labels and previews). */
export const inlineText = (nodes: MdInline[]): string =>
  nodes
    .map((n) =>
      n.type === 'text' || n.type === 'code'
        ? n.text
        : n.type === 'br'
          ? '\n'
          : inlineText(n.children),
    )
    .join('');
