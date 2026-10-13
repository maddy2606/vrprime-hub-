-- Money (Phase 6) is shelved: a switch, OFF by default. An owner turns it on in Settings, no deploy needed.
insert into public.app_settings (key, value) values ('money_enabled', 'false') on conflict (key) do nothing;
