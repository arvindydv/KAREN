'use client';

/**
 * Icon toggle for light/dark (class on <html>, persisted in localStorage). Both icons are
 * rendered and CSS shows the right one, so server and client markup always match.
 */
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
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle colour theme"
      title="Toggle colour theme"
      className="landing-icon-btn grid size-10 place-items-center rounded-full"
    >
      {/* Moon (shown in light mode) */}
      <svg
        viewBox="0 0 24 24"
        className="theme-icon-moon size-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
      </svg>
      {/* Sun (shown in dark mode) */}
      <svg
        viewBox="0 0 24 24"
        className="theme-icon-sun size-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
    </button>
  );
}

// KAREN's signature look is the dark "deep space" theme: it is the default until the user picks.
export const themeInitScript = `try{var t=localStorage.getItem('karen-theme');document.documentElement.classList.add(t==='light'?'light':'dark')}catch(e){document.documentElement.classList.add('dark')}`;
