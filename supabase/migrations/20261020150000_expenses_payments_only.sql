-- Only "payment done" screenshots are expenses. A QR code someone posts to be paid ("scanner") is never one, and chat is
-- only ever the reason next to a screenshot.
--
--   expense_messages.is_qr      the image is a QR code (checked when the screenshot is saved); null until checked
--   expense_messages.sender_id  who sent it, for pairing a screenshot with its note: 'me' for the linked phone
--   expenses.verdict            pending (not read yet), payment (a payment screenshot), not_payment (anything else)

alter table public.expense_messages add column if not exists is_qr boolean;
alter table public.expense_messages add column if not exists sender_id text;
update public.expense_messages set sender_id = case when sender = 'You' then 'me' else 'member' end where sender_id is null;

alter table public.expenses add column if not exists verdict text not null default 'pending' check (verdict in ('pending', 'payment', 'not_payment'));
-- Ones added by hand are payments.
update public.expenses set verdict = 'payment' where key is null;
