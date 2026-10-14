/**
 * The cloud inbox, from the command line. See src/lib/inbox.ts for what the
 * inbox is and why the phones encrypt to it.
 *
 *   npm run inbox -- keygen        create this laptop's key at inbox.keyPath
 *   npm run inbox -- drain-token   add INBOX_DRAIN_TOKEN to .env.local, if absent
 *   npm run inbox -- sql           print the SQL that registers both tokens
 *   npm run inbox -- drain         empty the inbox into the database
 *        [--retry-failed]          ...including envelopes that failed before
 *        [--dry-run]               ...opening and checking only, writing nothing
 *        [--if-configured]         ...silently, exit 0, when there is no inbox
 *   npm run inbox -- key           print the public key and its fingerprint
 *
 * Setting one up, once: create a Supabase project, apply
 * supabase/migrations/*.sql, deploy supabase/functions/inbox with JWT
 * verification OFF, set `inbox` in config/collector.json, then `keygen`,
 * `drain-token`, and run what `sql` prints in the project's SQL editor.
 *
 * `sql` prints SHA-256 digests only. Neither token appears in its output.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import {
  inboxConfig, secret, loadInboxKey, newInboxKeyPem, publicKeyB64, fingerprint,
  uploadBearer, sha256Hex, drainInbox,
} from '../src/lib/inbox';

function need<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    console.error(message);
    process.exit(1);
  }
  return value;
}

const NO_CONFIG = 'No "inbox" in config/collector.json. Set { "url": ..., "keyPath": ... } first.';

async function main(): Promise<void> {
  const [command, ...flags] = process.argv.slice(2);

  switch (command) {
    case 'keygen': {
      const cfg = need(inboxConfig(), NO_CONFIG);
      const path = resolve(cfg.keyPath);
      const systemDrive = (process.env['SystemDrive'] ?? 'C:').toUpperCase();
      // The repo is code only, and C:\ does not survive the reset this
      // project exists for. Losing the key loses whatever is still sealed in
      // the inbox; the phones can re-send the rest after a re-setup.
      if (path.toUpperCase().startsWith(systemDrive + '\\')) need(null, `Refusing a key on the system drive: ${path}`);
      if (path.toUpperCase().startsWith(process.cwd().toUpperCase())) need(null, `Refusing a key inside the repo: ${path}`);
      if (existsSync(path)) need(null, `${path} already exists. Delete it first to replace it -- every phone must then be set up again.`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, newInboxKeyPem(), { mode: 0o600, flag: 'wx' });
      const pub = publicKeyB64(loadInboxKey(path));
      console.log(`wrote ${path}\nfingerprint ${fingerprint(pub)}`);
      return;
    }

    case 'key': {
      const cfg = need(inboxConfig(), NO_CONFIG);
      const pub = publicKeyB64(loadInboxKey(cfg.keyPath));
      console.log(`${pub}\nfingerprint ${fingerprint(pub)}`);
      return;
    }

    case 'drain-token': {
      if (secret('INBOX_DRAIN_TOKEN')) {
        console.log('INBOX_DRAIN_TOKEN is already set; left as it is.');
        return;
      }
      appendFileSync(
        join(process.cwd(), '.env.local'),
        '\n# Bearer token the laptop uses to empty the cloud inbox (npm run inbox).\n' +
          '# The inbox stores only its SHA-256: see `npm run inbox -- sql`.\n' +
          `INBOX_DRAIN_TOKEN=${randomBytes(32).toString('hex')}\n`,
      );
      console.log('Added INBOX_DRAIN_TOKEN to .env.local.');
      return;
    }

    case 'sql': {
      const ingest = need(secret('ANDROID_INGEST_TOKEN'), 'ANDROID_INGEST_TOKEN is not set in .env.local.');
      const drain = need(secret('INBOX_DRAIN_TOKEN'), 'INBOX_DRAIN_TOKEN is not set: run `npm run inbox -- drain-token`.');
      console.log(
        `insert into public.inbox_keys (app, role, token_sha256) values\n` +
          `  ('data-usage', 'upload', '${sha256Hex(uploadBearer(ingest))}'),\n` +
          `  ('data-usage', 'drain',  '${sha256Hex(drain)}')\n` +
          `on conflict (app, role) do update set token_sha256 = excluded.token_sha256;`,
      );
      return;
    }

    case 'drain': {
      // The collector runs this every hour whether or not an inbox is set up.
      if (flags.includes('--if-configured') && !inboxConfig()) return;
      const started = Date.now();
      const out = await drainInbox({
        retryFailed: flags.includes('--retry-failed'),
        dryRun: flags.includes('--dry-run'),
        log: (line) => console.log(`  ${line}`),
      });
      if (!out) need(null, NO_CONFIG);
      console.log(
        `inbox: ${out!.landed} landed (${out!.rowsWritten} new rows), ${out!.failed} failed, ` +
          `${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      if (out!.failed > 0) process.exitCode = 1;
      return;
    }

    default:
      console.error('usage: npm run inbox -- keygen | key | drain-token | sql | drain [--retry-failed] [--dry-run]');
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
