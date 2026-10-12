-- Tickets are only used to track what has been opened on the marketplace, so the
-- screens are simpler: tabs with counts, and search that also finds the linked problem.

-- Search tickets by marketplace ID, SKU, VR-T number, or the linked problem's title / VR number.
create or replace function public.search_tickets(q text) returns setof public.tickets
language sql stable security invoker set search_path = '' as $$
  with needle as (
    select '%' || replace(replace(replace(btrim(coalesce(q, '')), '\', '\\'), '%', '\%'), '_', '\_')
           || '%' as pat
  )
  select t.*
  from public.tickets t, needle n
  where btrim(coalesce(q, '')) = ''
     or t.ticket_id ilike n.pat
     or t.sku ilike n.pat
     or ('VR-T-' || t.number) ilike n.pat
     or exists (select 1 from public.posts p
                where p.id = t.post_id
                  and (p.title ilike n.pat or ('VR-' || p.number) ilike n.pat))
$$;

-- Counts for the four tabs, for the current search and filters. Runs as the caller, so RLS applies.
create function public.ticket_counts(q text default '', p_platform text default null, p_issue text default null)
returns table (open_count bigint, waiting_count bigint, follow_up_due bigint, closed_count bigint)
language sql stable security invoker set search_path = '' as $$
  select
    count(*) filter (where s.status = 'open'),
    count(*) filter (where s.status = 'waiting_marketplace'),
    count(*) filter (where s.status in ('open', 'waiting_marketplace')
                       and s.next_follow_up <= (now() at time zone 'Asia/Kolkata')::date),
    count(*) filter (where s.status in ('resolved', 'rejected'))
  from public.search_tickets(q) s
  where (p_platform is null or s.platform = p_platform)
    and (p_issue is null or s.issue_type = p_issue)
$$;
revoke all on function public.ticket_counts(text, text, text) from public, anon;
grant execute on function public.ticket_counts(text, text, text) to authenticated, service_role;

-- Money totals are no longer shown anywhere. (The amount columns stay, unused.)
drop function public.ticket_totals();
