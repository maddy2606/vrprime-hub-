-- Group messages the linked WhatsApp could not decrypt ("No session found"). The phone has them, so every fetch asks it to
-- send each one again (WhatsApp's placeholder resend) until it arrives readable, for up to 14 days and 12 tries. Only
-- the message's key is kept (group, message id, sender): no content. Read and written by the server only.

create table if not exists public.whatsapp_locked (
  id text primary key,
  msg_key jsonb not null,
  sent_at timestamptz,
  reason text,
  first_seen timestamptz not null default now(),
  tries integer not null default 0,
  last_try timestamptz
);
alter table public.whatsapp_locked enable row level security;
revoke all on public.whatsapp_locked from anon, authenticated;
grant all on public.whatsapp_locked to service_role;
