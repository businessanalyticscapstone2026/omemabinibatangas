-- Item writes previously calculated the overall score before the annual
-- finalization RPC ran. That made the RPC reject its own partially saved row.
-- Keep scheduled annual inspections pending until their result and owner can
-- be finalized together; ordinary/completed inspections retain the old behavior.
create or replace function public.trg_inspection_items_refresh()
returns trigger language plpgsql as $$
declare
  v_id uuid := case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;
begin
  if exists (select 1 from public.inspections
             where id = v_id and annual_follow_up_year is not null and overall_score is null) then
    return null;
  end if;
  perform public.refresh_inspection_summary(v_id);
  return null;
end $$;

-- Refresh the derived condition and road summary only after the service-only
-- finalization RPC has assigned the inspector and completed the inspection.
create or replace function public.refresh_finalized_annual_inspection()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.overall_score is null and new.overall_score is not null
     and new.annual_follow_up_year is not null and new.inspector_id is not null then
    perform public.refresh_inspection_summary(new.id);
  end if;
  return null;
end $$;

drop trigger if exists trg_refresh_finalized_annual_inspection on public.inspections;
create trigger trg_refresh_finalized_annual_inspection
  after update of overall_score, inspector_id on public.inspections
  for each row execute function public.refresh_finalized_annual_inspection();
