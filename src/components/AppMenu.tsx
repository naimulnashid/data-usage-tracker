'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { EyeIcon, EyeOffIcon, MergeIcon, MoreIcon, PencilIcon, SplitIcon } from './Icons';
import { RenameDialog } from './RenameApp';

interface Target {
  platform: 'windows' | 'android';
  /** The device's URL slug. */
  device: string;
  /** Family groupKey on Windows, uid on a phone -- what detail URLs carry. */
  appKey: string;
  /** As shown now. */
  name: string;
}

/** POST /api/apps/prefs; null on success, else the message to show. */
async function post(t: Target, body: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch('/api/apps/prefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: t.platform, device: t.device, key: t.appKey, ...body }),
    });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    return res.ok && out.ok ? null : (out.message ?? 'Could not save.');
  } catch {
    return 'Could not reach the dashboard.';
  }
}

/**
 * A row's or a card's actions on the By App page: rename or recolour it, hide
 * it from the page, or merge it into another app. See lib/app-prefs.ts for
 * what hiding and merging mean -- hiding is this page's view only, merging is
 * read everywhere.
 *
 * Shown on row or card hover and on focus, and always on a touch screen.
 */
export function AppMenu({
  hidden, candidates, baseName, color, customColor, ...target
}: Target & {
  hidden: boolean;
  /** The apps this one may be merged into, as shown. */
  candidates: { key: string; name: string }[];
  /** For the rename dialog: the name without a rename, and the stored colour. */
  baseName: string;
  color: string;
  customColor: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<{ top: number; right: number; host: Element } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLSpanElement>(null);

  // Outside clicks, Escape, scrolling and resizing close it, as any menu does.
  // Scrolling too because the menu is fixed to where its button WAS.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function show() {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    // Into the shell, not <body>, so the menu wears this device's accent.
    const host = button.current?.closest('.shell') ?? document.body;
    setAt({ top: r.bottom + 6, right: window.innerWidth - r.right, host });
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setMerging(false);
    setError(null);
  }

  async function run(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    const failed = await post(target, body);
    setBusy(false);
    if (failed) { setError(failed); return; }
    close();
    router.refresh();
  }

  const others = candidates
    .filter((c) => c.key !== target.appKey)
    .sort((a, b) => a.name.localeCompare(b.name));

  // In a portal, fixed to the button: the table scrolls sideways inside
  // `.table-wrap`, whose overflow would otherwise clip a menu opened on one
  // of its last rows.
  return (
    <>
      <button
        ref={button}
        type="button"
        className="rename-btn app-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${target.name}`}
        title="Rename, hide or merge"
        onClick={() => (open ? close() : show())}
      >
        <MoreIcon size={15} />
      </button>
      {open && at && createPortal(
        <span className="app-menu" role="menu" ref={menu} style={{ top: at.top, right: at.right }}>
          {!merging ? (
            <>
              <button
                type="button" role="menuitem" className="app-menu-item" disabled={busy}
                onClick={() => { close(); setRenaming(true); }}
              >
                <PencilIcon size={15} />
                Rename or recolour…
              </button>
              <button
                type="button" role="menuitem" className="app-menu-item" disabled={busy}
                onClick={() => void run({ action: hidden ? 'show' : 'hide' })}
              >
                {hidden ? <EyeIcon size={15} /> : <EyeOffIcon size={15} />}
                {hidden ? 'Show on this page' : 'Hide from this page'}
              </button>
              <button
                type="button" role="menuitem" className="app-menu-item" disabled={busy || others.length === 0}
                onClick={() => { setInto(''); setMerging(true); }}
              >
                <MergeIcon size={15} />
                Merge into…
              </button>
            </>
          ) : (
            <form
              className="app-menu-merge"
              onSubmit={(e) => { e.preventDefault(); if (into) void run({ action: 'merge', into }); }}
            >
              <span className="app-menu-label">Count {target.name} as part of</span>
              <select
                className="chip" value={into} autoFocus disabled={busy}
                onChange={(e) => setInto(e.target.value)}
                aria-label={`App to merge ${target.name} into`}
              >
                <option value="" disabled>Choose an app</option>
                {others.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
              <span className="app-menu-actions">
                <button type="submit" className="chip chip--small" data-active="true" disabled={busy || !into}>Merge</button>
                <button type="button" className="chip chip--small" disabled={busy} onClick={() => setMerging(false)}>Back</button>
              </span>
            </form>
          )}
          {error && <span className="rename-error" role="alert">{error}</span>}
        </span>,
        at.host,
      )}
      {renaming && (
        <RenameDialog {...target} baseName={baseName} color={color} customColor={customColor} onClose={() => setRenaming(false)} />
      )}
    </>
  );
}

/** Undo a merge, from the target's Merged apps card. */
export function UnmergeButton(target: Target) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="unmerge">
      <button
        type="button" className="rename-btn unmerge-btn" disabled={busy}
        title={`Separate: show ${target.name} as an app of its own again`}
        aria-label={`Separate ${target.name}`}
        onClick={async () => {
          setBusy(true);
          const failed = await post(target, { action: 'unmerge' });
          setBusy(false);
          if (failed) setError(failed);
          else router.refresh();
        }}
      >
        <SplitIcon size={15} />
      </button>
      {error && <span className="rename-error" role="alert">{error}</span>}
    </span>
  );
}
