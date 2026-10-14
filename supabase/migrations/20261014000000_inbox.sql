-- The cloud inbox: a mailbox the phones post to and the laptop empties.
--
-- It holds SEALED envelopes only. Each is encrypted on the phone to a key
-- whose private half never leaves the laptop, so nothing in this database can
-- be read here -- not by Supabase, and not by anyone who gets into the
-- project. See src/lib/inbox.ts for the envelope format.
--
-- Both tables are reachable only through the `inbox` Edge Function, which
-- uses the service role. Row level security is ON with no policies, and the
-- API roles have no grants, so the anon and authenticated keys can read or
-- write nothing here even though they are public by design.

create table if not exists public.inbox_envelopes (
  id          bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  -- The phone's device id, sent in the clear beside the envelope. Used ONLY
  -- to say which phone a failed envelope came from; a successful one is
  -- attributed by the device id inside it.
  device_hint text,
  size_bytes  integer not null,
  -- Base64 of the envelope bytes.
  envelope    text not null,
  -- Set by the laptop when an envelope cannot be opened or ingested. It stays
  -- here, skipped by the normal drain, until a retry succeeds.
  failed_at   timestamptz,
  error       text
);

-- SHA-256 of each bearer token, never the token itself.
--   upload: what the phones send -- an HMAC of ANDROID_INGEST_TOKEN, so this
--           project never sees the token that also seals the envelopes.
--   drain:  INBOX_DRAIN_TOKEN, held by the laptop.
create table if not exists public.inbox_keys (
  role         text primary key check (role in ('upload', 'drain')),
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$')
);

alter table public.inbox_envelopes enable row level security;
alter table public.inbox_keys      enable row level security;

revoke all on public.inbox_envelopes from anon, authenticated;
revoke all on public.inbox_keys      from anon, authenticated;
