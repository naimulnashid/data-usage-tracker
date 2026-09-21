import { join } from 'node:path';

/**
 * Where config/collector.json is.
 *
 * `DATA_USAGE_CONFIG` overrides it, and exists for one reason: the README's
 * screenshots are taken from a second dashboard instance running on synthetic
 * data (`scripts/make-demo-data.ts`, `scripts/make-screenshots.ts`), and that
 * instance must read a different database from the one this machine collects
 * into -- without a copy of the repo, and without touching the real config.
 *
 * Every reader in the dashboard goes through here. There used to be three
 * separate `join(process.cwd(), 'config', 'collector.json')` calls, so an
 * override applied to one would have left the others reading the real file:
 * a demo page with the real machine's name above synthetic numbers. The
 * command-line scripts do not read it: the demo generator hands `ingest.ts`
 * its database with `--db`, and the collector has no reason to be redirected.
 */
export function configPath(): string {
  const override = process.env['DATA_USAGE_CONFIG']?.trim();
  return override || join(process.cwd(), 'config', 'collector.json');
}
