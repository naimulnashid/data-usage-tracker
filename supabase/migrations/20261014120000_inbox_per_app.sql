-- One inbox, two apps: Data Usage Tracker and Screen Time Tracker share this
-- project (a free plan allows two), each as its own mailbox. Every envelope
-- and every token belongs to an app, and the function filters on it, so one
-- project's drain token cannot read or delete the other's envelopes.
--
-- Existing rows and keys are data-usage's, which is what the default says.

alter table public.inbox_envelopes
  add column if not exists app text not null default 'data-usage'
  check (app in ('data-usage', 'screen-time'));

create index if not exists inbox_envelopes_app_id on public.inbox_envelopes (app, id);

alter table public.inbox_keys
  add column if not exists app text not null default 'data-usage'
  check (app in ('data-usage', 'screen-time'));

alter table public.inbox_keys drop constraint if exists inbox_keys_pkey;
alter table public.inbox_keys add primary key (app, role);
