'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { cleanColor } from '@/lib/app-colors';

interface Target {
  platform: 'windows' | 'android';
  /** The device's URL slug. */
  device: string;
  /** Family groupKey on Windows, uid on a phone -- what detail URLs carry. */
  appKey: string;
  /** As shown now, rename included. */
  name: string;
  /** As it would be without a rename. */
  baseName: string;
  /** The app's colour as stored, #rrggbb (`rawColorOf`), override included. */
  color: string;
  /** Whether that colour is the user's own rather than brand or palette. */
  customColor: boolean;
}

/**
 * Rename an app, or change its colour, from the page it is shown on.
 *
 * Two placements share one form:
 *
 * - `title`: the detail page's heading. The pencil sits after the name.
 * - `row`: an app-table name cell. The pencil appears on row hover or focus,
 *   so a table of a hundred rows is not a column of pencils; on a touch
 *   screen, which has no hover, it is always shown.
 *
 * Both are stored server-side (lib/app-renames.ts, lib/app-color-overrides.ts)
 * and the page is then refreshed, so every chart, legend and table on it picks
 * the change up from the same place the server does. Clearing the name, or
 * Reset, returns the app to its original name; "Default colour" drops the
 * override and the app goes back to its brand or palette colour.
 *
 * The colour can be picked or typed: the native picker for choosing by eye,
 * the hex field for pasting a brand's exact code. The two stay in step.
 */
export function RenameApp(props: Target & (
  | { variant: 'title'; icon: ReactNode }
  | { variant: 'row'; children: ReactNode }
)) {
  const { platform, device, appKey, name, baseName, color, customColor } = props;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hex, setHex] = useState(color);
  const input = useRef<HTMLInputElement>(null);
  const renamed = name !== baseName;

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function open() {
    setError(null);
    setHex(color);
    setEditing(true);
  }

  async function post(path: string, body: Record<string, string>): Promise<string | null> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform, device, key: appKey, ...body }),
    });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    return res.ok && out.ok ? null : (out.message ?? 'Could not save.');
  }

  /**
   * Save what changed. `next` is the name field; `nextColor` null means
   * "back to the default colour", undefined means the colour field.
   */
  async function save(next: string, nextColor?: string | null) {
    const wanted = nextColor === undefined ? cleanColor(hex) : nextColor;
    if (nextColor === undefined && wanted === null) {
      setError('A colour is a hex code like #2f80ed.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (next.trim() !== name) {
        const failed = await post('/api/apps/name', { name: next });
        if (failed) { setError(failed); return; }
      }
      const colorChanged = wanted === null ? customColor : wanted !== color.toLowerCase();
      if (colorChanged) {
        const failed = await post('/api/apps/color', { color: wanted ?? '' });
        if (failed) { setError(failed); return; }
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError('Could not reach the dashboard.');
    } finally {
      setBusy(false);
    }
  }

  const pencil = (
    <button
      type="button"
      className="rename-btn"
      onClick={open}
      title={renamed ? `Rename or recolour (originally ${baseName})` : 'Rename or recolour'}
      aria-label={`Rename or recolour ${name}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );

  const picked = cleanColor(hex);
  const form = (
    <form
      className="rename-form"
      onSubmit={(e) => { e.preventDefault(); void save(input.current?.value ?? ''); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } }}
    >
      <input
        ref={input}
        className="rename-input"
        defaultValue={name}
        maxLength={60}
        placeholder={baseName}
        aria-label={`New name for ${name}`}
        disabled={busy}
        autoFocus
      />
      <span className="color-field" title="Chart colour: pick one, or type a hex code">
        {/* The native picker needs a valid #rrggbb at all times, so while the
            hex field holds a half-typed value it keeps showing the last
            good one. */}
        <input
          type="color"
          className="color-swatch-input"
          value={picked ?? color}
          onChange={(e) => setHex(e.target.value)}
          aria-label={`Colour for ${name}`}
          disabled={busy}
        />
        <input
          className="rename-input color-hex-input"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          maxLength={7}
          spellCheck={false}
          aria-label={`Colour hex code for ${name}`}
          aria-invalid={picked === null}
          disabled={busy}
        />
      </span>
      <button type="submit" className="chip chip--small" data-active="true" disabled={busy}>Save</button>
      {renamed && (
        <button
          type="button"
          className="chip chip--small"
          disabled={busy}
          onClick={() => void save('', customColor ? color : undefined)}
          title={`Back to ${baseName}`}
        >
          Reset name
        </button>
      )}
      {customColor && (
        <button
          type="button"
          className="chip chip--small"
          disabled={busy}
          onClick={() => void save(input.current?.value ?? name, null)}
          title="Back to the brand or palette colour"
        >
          Default colour
        </button>
      )}
      <button type="button" className="chip chip--small" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && <span className="rename-error" role="alert">{error}</span>}
    </form>
  );

  if (props.variant === 'title') {
    return editing ? (
      <div className="app-title">{props.icon}{form}</div>
    ) : (
      <h1 className="app-title">{props.icon}{name}{pencil}</h1>
    );
  }
  return editing ? form : <>{props.children}{pencil}</>;
}
