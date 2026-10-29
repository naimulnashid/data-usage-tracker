'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { cleanColor } from '@/lib/app-colors';
import { PencilIcon } from './Icons';

export interface RenameTarget {
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
 * Rename an app, or change its colour, in a modal dialog.
 *
 * Opened from the detail page's pencil and from the "..." menu on By App.
 * It used to be an inline form that replaced the name where it stood, which
 * stretched a table row and squeezed a grid card out of shape; a dialog
 * leaves the page as it was.
 *
 * Both values are stored server-side (lib/app-renames.ts,
 * lib/app-color-overrides.ts) and the page is then refreshed, so every chart,
 * legend and table on it picks the change up from the same place the server
 * does. Clearing the name, or Reset name, returns the app to its original
 * name; "Default colour" drops the override and the app goes back to its
 * brand or palette colour.
 *
 * The colour can be picked or typed: the native picker for choosing by eye,
 * the hex field for pasting a brand's exact code. The two stay in step.
 *
 * A native <dialog> opened with showModal(): it traps focus, closes on
 * Escape and makes the page behind it inert. Portalled into `.shell` so it
 * wears the device's accent.
 */
export function RenameDialog({ onClose, ...t }: RenameTarget & { onClose: () => void }) {
  const { platform, device, appKey, name, baseName, color, customColor } = t;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hex, setHex] = useState(color);
  const [host, setHost] = useState<Element | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pressed = useRef(false);
  const renamed = name !== baseName;

  useEffect(() => setHost(document.querySelector('.shell') ?? document.body), []);
  useEffect(() => {
    if (!host) return;
    dialog.current?.showModal();
    input.current?.select();
  }, [host]);

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
      onClose();
      router.refresh();
    } catch {
      setError('Could not reach the dashboard.');
    } finally {
      setBusy(false);
    }
  }

  if (!host) return null;
  const picked = cleanColor(hex);
  return createPortal(
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="rename-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      // A click on the backdrop lands on the <dialog> itself; one inside lands
      // on its content. Both ends must be on it, or a text selection dragged
      // out of the name field would close the dialog. React events bubble
      // through portals, so the click stops here: a grid card would
      // otherwise take it as a click on the card and open the detail page.
      onMouseDown={(e) => { pressed.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        e.stopPropagation();
        if (pressed.current && e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="modal-body"
        onSubmit={(e) => { e.preventDefault(); void save(input.current?.value ?? ''); }}
      >
        <h2 id="rename-title" className="modal-title">Rename or recolour</h2>

        <label className="modal-field">
          <span className="modal-label">Name</span>
          <input
            ref={input}
            className="rename-input"
            defaultValue={name}
            maxLength={60}
            placeholder={baseName}
            disabled={busy}
          />
          {renamed && <span className="modal-hint">Originally {baseName}</span>}
        </label>

        <div className="modal-field">
          <span className="modal-label" id="rename-colour">Chart colour</span>
          <span className="color-field" role="group" aria-labelledby="rename-colour">
            {/* The native picker needs a valid #rrggbb at all times, so while
                the hex field holds a half-typed value it keeps showing the
                last good one. */}
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
        </div>

        {error && <span className="rename-error" role="alert">{error}</span>}

        <div className="modal-actions">
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
          <span className="modal-actions-gap" />
          <button type="button" className="chip chip--small" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="chip chip--small" data-active="true" disabled={busy}>Save</button>
        </div>
      </form>
    </dialog>,
    host,
  );
}

/** The detail page's heading, with a pencil after the name that opens the dialog. */
export function RenameApp({ icon, ...t }: RenameTarget & { icon: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const renamed = t.name !== t.baseName;
  return (
    <h1 className="app-title">
      {icon}{t.name}
      <button
        type="button"
        className="rename-btn"
        onClick={() => setEditing(true)}
        title={renamed ? `Rename or recolour (originally ${t.baseName})` : 'Rename or recolour'}
        aria-label={`Rename or recolour ${t.name}`}
      >
        <PencilIcon size={14} />
      </button>
      {editing && <RenameDialog {...t} onClose={() => setEditing(false)} />}
    </h1>
  );
}
