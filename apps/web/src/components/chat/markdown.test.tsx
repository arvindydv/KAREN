import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

describe('<Markdown>', () => {
  it('renders formatting as elements and raw HTML as inert text', () => {
    const { container } = render(
      <Markdown
        text={'**Bold** and `code`\n\n<img src=x onerror=alert(1)><script>alert(2)</script>'}
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('opens safe links in a new tab without opener/referrer and drops unsafe ones', () => {
    const { container } = render(
      <Markdown text={'[ok](https://example.com) [bad](javascript:void0) [rel](/app/settings)'} />,
    );
    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('https://example.com');
    expect(links[0]!.getAttribute('target')).toBe('_blank');
    expect(links[0]!.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(container.textContent).toContain('bad');
  });

  it('renders code blocks with a copy button, lists and tables', () => {
    const { container, getByRole } = render(
      <Markdown
        text={'```ts\nconst a = 1;\n```\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |'}
      />,
    );
    expect(container.querySelector('pre code')?.textContent).toBe('const a = 1;');
    expect(getByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });
});
