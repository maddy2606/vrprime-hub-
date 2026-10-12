-- Supabase security advisor: extensions should not live in the public schema.
-- pg_net cannot be moved with ALTER EXTENSION, so it is recreated. Nothing is lost:
-- it only holds a short-lived request queue. Its functions stay in the `net` schema.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
