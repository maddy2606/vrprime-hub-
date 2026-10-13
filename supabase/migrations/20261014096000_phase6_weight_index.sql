-- Only about 1,000 of 400,000 lines carry a weight slab: find them without reading the rest.
create index money_settled_weight_idx on public.money_settled_lines (payment_date) where weight_slab is not null;
