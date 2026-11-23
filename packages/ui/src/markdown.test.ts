import { describe, expect, it } from 'vitest';
import { isSafeLinkUrl, parseInline, parseMarkdown } from './markdown.js';

describe('parseMarkdown', () => {
  it('parses headings, paragraphs with breaks, lists, quotes, rules and code', () => {
    const md = [
      '# Plan',
      'Line one',
      'line two',
      '',
      '- milk',
      '- eggs',
      '',
      '3. third',
      '4. fourth',
      '',
      '> note',
      '',
      '---',
      '```ts',
      'const a = 1;',
      '```',
    ].join('\n');
    expect(parseMarkdown(md).map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'hr',
      'code',
    ]);
    const [, para, bullets, ordered, , , code] = parseMarkdown(md);
    expect(para).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Line one' },
        { type: 'br' },
        { type: 'text', text: 'line two' },
      ],
    });
    expect(bullets).toMatchObject({
      ordered: false,
      items: [[{ text: 'milk' }], [{ text: 'eggs' }]],
    });
    expect(ordered).toMatchObject({ ordered: true, start: 3 });
    expect(code).toEqual({ type: 'code', lang: 'ts', text: 'const a = 1;' });
  });

  it('treats an unclosed fence (still streaming) as code to the end', () => {
    expect(parseMarkdown('Intro\n```\nline 1\nline 2')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'Intro' }] },
      { type: 'code', lang: null, text: 'line 1\nline 2' },
    ]);
  });

  it('parses pipe tables', () => {
    const [t] = parseMarkdown('| City | Fare |\n|---|---:|\n| Pune | ₹1,200 |\n| Goa | ₹2 lakh |');
    expect(t).toMatchObject({ type: 'table', header: [[{ text: 'City' }], [{ text: 'Fare' }]] });
    expect(t?.type === 'table' && t.rows).toHaveLength(2);
  });

  it('never produces HTML: raw tags stay literal text', () => {
    const blocks = parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '<script>alert(1)</script> <img src=x onerror=alert(1)>' },
        ],
      },
    ]);
  });

  it('keeps Hindi and Hinglish text intact', () => {
    expect(parseMarkdown('**नमस्ते** — kal milte hain')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'strong', children: [{ type: 'text', text: 'नमस्ते' }] },
          { type: 'text', text: ' — kal milte hain' },
        ],
      },
    ]);
  });
});

describe('parseInline', () => {
  it('parses strong, em, code and safe links', () => {
    expect(parseInline('**b** *i* `c` [docs](https://example.com/a?b=1)')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'i' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'c' },
      { type: 'text', text: ' ' },
      {
        type: 'link',
        href: 'https://example.com/a?b=1',
        children: [{ type: 'text', text: 'docs' }],
      },
    ]);
  });

  it('drops unsafe link targets but keeps the label', () => {
    for (const href of ['javascript:void0', 'data:text/html,x', '/relative', 'JaVaScRiPt:x']) {
      expect(parseInline(`[click](${href})`)).toEqual([{ type: 'text', text: 'click' }]);
    }
    const tricky = parseInline('[click](javascript:alert(1))');
    expect(tricky.some((n) => n.type === 'link')).toBe(false);
  });

  it('autolinks bare https URLs without trailing punctuation', () => {
    expect(parseInline('See https://example.com/x.')).toEqual([
      { type: 'text', text: 'See ' },
      {
        type: 'link',
        href: 'https://example.com/x',
        children: [{ type: 'text', text: 'https://example.com/x' }],
      },
      { type: 'text', text: '.' },
    ]);
  });

  it('does not treat snake_case or unbalanced markers as emphasis', () => {
    expect(parseInline('my_var_name and 2 * 3')).toEqual([
      { type: 'text', text: 'my_var_name and 2 * 3' },
    ]);
    expect(parseInline('**unclosed')).toEqual([{ type: 'text', text: '**unclosed' }]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*not em\\*')).toEqual([{ type: 'text', text: '*not em*' }]);
  });
});

describe('isSafeLinkUrl', () => {
  it('allows only http(s) and mailto', () => {
    expect(isSafeLinkUrl('https://karen.example')).toBe(true);
    expect(isSafeLinkUrl('mailto:help@example.com')).toBe(true);
    expect(isSafeLinkUrl('ftp://x')).toBe(false);
    expect(isSafeLinkUrl('https://x" onclick="y')).toBe(false);
  });
});
