'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Backspace follows the page's "←" link, as a browser's once did and as the
 * native app does. Never while a field has focus, so editing a name still
 * deletes, and never with a modifier held.
 */
export function BackKey({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      router.push(href);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [href, router]);
  return null;
}
