'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'ok' | 'error';

/**
 * A transient message, anchored to the viewport rather than the top bar.
 *
 * This used to be a span next to the sync button. Its text is variable-length
 * ("Added 1,247 new rows" vs "Up to date - nothing new since the last run"),
 * so it pushed the scope controls around and wrapped the bar onto two rows the
 * moment a run finished. A toast carries the same information without letting
 * message length dictate the layout of persistent chrome.
 *
 * Portalled to <body> so no ancestor's overflow or stacking context can clip
 * it -- the top bar is `position: sticky`, which creates one.
 */
export function Toast({
  message,
  kind = 'ok',
  onDismiss,
  /** Errors stay put: they are worth reading, and often worth acting on. */
  durationMs = kind === 'error' ? 12000 : 5000,
}: {
  message: string;
  kind?: ToastKind;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [onDismiss, durationMs, message]);

  if (!mounted) return null;

  // Deliberately no role/aria-live here. This element is created together with
  // its text, which screen readers often do not announce; the caller keeps a
  // live region mounted from the start and announces through that instead
  // (see SyncButton). A second live region here would announce twice.
  return createPortal(
    <div className={`toast toast--${kind}`}>
      <span className="toast-dot" aria-hidden />
      <span className="toast-text">{message}</span>
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        &times;
      </button>
    </div>,
    document.body,
  );
}
