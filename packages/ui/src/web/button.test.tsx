import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, StatusBadge } from './index.js';

describe('web primitives', () => {
  it('renders an accessible button that defaults to type="button"', () => {
    render(<Button>Approve</Button>);
    const btn = screen.getByRole('button', { name: 'Approve' });
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('status badge always renders a text label', () => {
    render(<StatusBadge tone="danger" label="Failed" />);
    expect(screen.getByText('Failed')).toBeTruthy();
  });
});
