import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSync } from '@/lib/queries';

const run = promisify(execFile);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TASK_NAME = 'Data Usage Collector';

/** schtasks reports this while a task is still running. */
const STILL_RUNNING = 267009;

/**
 * Trigger a collection on demand.
 *
 * Snapshotting the locked SRUM database needs Administrator (`esentutl /vss`),
 * and this server is deliberately NOT elevated, and should not be. So instead
 * of collecting, we ask Windows to start the registered collector task.
 *
 * Since 2026-09-21 that task is itself unelevated: it delegates the one
 * elevated step to a separate "Data Usage Snapshot" task, which runs only an
 * admin-owned copy of srum-snapshot.ps1. Before that, the collector task ran
 * elevated and executed repo code the user can edit -- so this very endpoint
 * was, in effect, a way for anything running as the user to get Administrator.
 * See scripts/srum-snapshot.ps1.
 *
 * No UAC prompt, no stored credentials, and no privileged web server. If
 * starting the task ever stops working, the fallback is running
 * `scripts\collector.ps1` by hand -- not elevating this process.
 *
 * The request returns as soon as the task is *started*. Collection takes
 * roughly 10-20s (99 MB VSS snapshot, parse, ingest, backup), and the client
 * polls GET for completion rather than holding a request open that long.
 */
export async function POST() {
  try {
    const before = getSync(1).lastSuccess?.startedAt ?? null;

    // schtasks rather than the ScheduledTasks PowerShell module: it is a plain
    // exe with a stable exit code, so there is no PowerShell start-up cost and
    // nothing to parse.
    await run('schtasks', ['/run', '/tn', TASK_NAME], { windowsHide: true });

    return NextResponse.json({ ok: true, startedFrom: before });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // The task not existing is the common, actionable failure: the collector
    // was never scheduled. Say that plainly instead of surfacing schtasks'
    // "The system cannot find the file specified."
    const notFound = /cannot find|does not exist|ERROR: The system cannot find/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        error: notFound ? 'task-not-registered' : 'start-failed',
        detail: notFound
          ? `No scheduled task named "${TASK_NAME}". Run scripts\\register-task.ps1 from an elevated PowerShell.`
          : message,
      },
      { status: notFound ? 409 : 500 },
    );
  }
}

/**
 * Poll for progress.
 *
 * Reports whether the task is still running and what the newest logged run
 * says, so the client can tell "finished, nothing new" (a normal, healthy
 * outcome) from "finished, added rows" and from "still going".
 */
export async function GET() {
  let running = false;
  let registered = true;

  try {
    const { stdout } = await run(
      'schtasks',
      ['/query', '/tn', TASK_NAME, '/fo', 'list', '/v'],
      { windowsHide: true },
    );
    running =
      /Status:\s*Running/i.test(stdout) || stdout.includes(String(STILL_RUNNING));
  } catch {
    registered = false;
  }

  const sync = getSync(1);
  const last = sync.runs[0] ?? null;

  return NextResponse.json({
    registered,
    running,
    lastRun: last
      ? {
          id: last.id,
          status: last.status,
          startedAt: last.startedAt,
          rowsInserted: last.rowsInserted,
          rowsSkipped: last.rowsSkipped,
          backupStatus: last.backupStatus,
          error: last.error,
        }
      : null,
    totalRows: sync.totalRows,
  });
}
