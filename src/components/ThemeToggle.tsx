'use client';

import { useEffect, useRef, useState } from 'react';
import { THEME_KEY, type ThemeChoice } from '@/lib/theme';

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

declare global {
  interface Window { __duTheme?: () => void }
}

/**
 * The theme menu in the top bar: Dark, Light, or follow the system.
 *
 * The choice is read in an effect, not during render: the server cannot know
 * it, and reading localStorage while rendering would hand the server one
 * answer and the client another -- a hydration mismatch, the same trap the
 * sidebar's collapsed state avoids. The page itself is already painted in the
 * right theme by then (lib/theme.ts), so only this button waits.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('dark');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') setChoice(v);
    } catch { /* private mode: stays on the default */ }
  }, []);

  // Close on a click elsewhere or on Escape, as any menu does.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  function pick(v: ThemeChoice) {
    setChoice(v);
    setOpen(false);
    try { localStorage.setItem(THEME_KEY, v); } catch { /* applies for this page only */ }
    if (window.__duTheme) window.__duTheme();
    else document.documentElement.setAttribute('data-theme', v === 'light' ? 'light' : 'dark');
  }

  return (
    <div className="theme-menu" ref={root}>
      <button
        type="button"
        className="chip icon-chip"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Theme: ${CHOICES.find((c) => c.value === choice)?.label}`}
        aria-label="Theme"
      >
        {/* Sun in the light theme, moon in the dark one; CSS picks, so the
            icon is right on first paint even before the effect has run. */}
        <svg className="theme-icon theme-icon--sun" width="15" height="15" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <svg className="theme-icon theme-icon--moon" width="15" height="15" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      </button>
      {open && (
        <div className="theme-popover" role="menu" aria-label="Theme">
          {CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              role="menuitemradio"
              aria-checked={choice === c.value}
              className="theme-option"
              onClick={() => pick(c.value)}
            >
              <span className="theme-check" aria-hidden>{choice === c.value ? '✓' : ''}</span>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
