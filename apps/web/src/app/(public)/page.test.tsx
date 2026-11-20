import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { features, pillars } from '@/components/landing/content';
import HomePage from './page';

describe('public home page', () => {
  afterEach(cleanup);

  it('renders the hero heading and honest pre-release labelling', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1, name: /taken care of/i })).toBeTruthy();
    expect(screen.getAllByText(/pre-release/i).length).toBeGreaterThan(0);
    // The animated hero timeline is explicitly marked as an example, not a live booking.
    expect(screen.getByText(/illustrative example/i)).toBeTruthy();
  });

  it('explains every pillar and feature, each with an availability label', () => {
    render(<HomePage />);
    for (const p of pillars) expect(screen.getByRole('heading', { name: p.title })).toBeTruthy();
    for (const f of features) expect(screen.getByRole('heading', { name: f.title })).toBeTruthy();
    expect(screen.getAllByText('Later').length).toBeGreaterThan(1);
  });

  it('has one landmark heading per section', () => {
    render(<HomePage />);
    for (const name of [
      /more than a chatbot/i,
      /intent to verified outcome/i,
      /busy parts of life/i,
      /powerful because it is careful/i,
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
  });
});
