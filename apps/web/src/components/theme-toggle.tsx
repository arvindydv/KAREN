'use client';

import { Button } from '@karen/ui/web';

/** Toggles light/dark by class on <html>; the choice persists in localStorage. */
export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const dark = !root.classList.contains('dark');
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
    try {
      localStorage.setItem('karen-theme', dark ? 'dark' : 'light');
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this page view.
    }
  };
  return (
    <Button variant="ghost" onClick={toggle} aria-label="Toggle colour theme">
      Theme
    </Button>
  );
}

/** Inline, render-blocking script that applies the saved theme before paint (no flash). */
export const themeInitScript = `try{var t=localStorage.getItem('karen-theme');if(t){document.documentElement.classList.add(t)}}catch(e){}`;
