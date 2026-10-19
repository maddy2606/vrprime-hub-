-- WhatsApp keeps a file on its servers for about a month. For an older screenshot the site asks the phone to upload it
-- again (it usually still has it); after two tries that get nothing, the screenshot is given up on.
alter table public.expense_messages add column if not exists media_expired boolean not null default false;
alter table public.expense_messages add column if not exists media_tries integer not null default 0;
