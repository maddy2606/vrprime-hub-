-- Supabase security advisor: public.rls_auto_enable() is a SECURITY DEFINER
-- function that anyone could call through the API. It is only meant to run
-- from its event trigger, so nobody needs EXECUTE on it.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
