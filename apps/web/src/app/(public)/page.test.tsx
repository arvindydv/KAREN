import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('public home page', () => {
  it('renders the hero heading and honest pre-release label', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: /taken care of/i })).toBeTruthy();
    expect(screen.getByText(/pre-release/i)).toBeTruthy();
  });
});
