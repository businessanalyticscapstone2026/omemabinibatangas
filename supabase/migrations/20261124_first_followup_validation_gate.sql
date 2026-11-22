-- Require first-anniversary results before approving later annual entries.
create or replace function public.save_annual_validation_with_assignment(
  p_project_id uuid, p_year integer, p_result public.validation_status,
  p_remarks text, p_user_id uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_completion date;
  v_old public.validation_status;
  v_earlier_pending boolean;
  v_first_inspection uuid;
  v_first_score numeric;
  v_needs_maintenance boolean;
begin
  select actual_completion_date into v_completion from public.projects
    where id = p_project_id and archived_at is null for update;
  if not found then return false; end if;
  select result into v_old from public.annual_validation_entries
    where project_id = p_project_id and year = p_year and deleted_at is null for update;
  if not found then return false; end if;

  -- Only a new approval of a later year requires first-anniversary results.
  -- A return for revision, an already-approved entry, and the first year itself
  -- remain unaffected. Keep the chosen records locked until the decision commits.
  if p_result = 'approved' and v_old <> 'approved' and v_completion is not null
     and p_year > extract(year from v_completion)::integer + 1 then
    select i.id, i.overall_score into v_first_inspection, v_first_score
      from public.inspections i
      where i.project_id = p_project_id and i.annual_follow_up_year = extract(year from v_completion)::integer + 1
        and i.inspection_type = 'follow_up' and i.archived_at is null and i.overall_score > 0
      order by i.created_at, i.id limit 1 for share;
    if not found then
      raise exception using errcode = 'P0001', message = 'Record the first-anniversary inspection result before validating a later follow-up.';
    end if;
    perform 1 from public.inspection_items where inspection_id = v_first_inspection for share;
    select case when exists (select 1 from public.inspection_items where inspection_id = v_first_inspection and rating::text <> 'n/a')
      then exists (select 1 from public.inspection_items where inspection_id = v_first_inspection and rating::text in ('fair', 'poor', 'bad'))
      else v_first_score < 8 end into v_needs_maintenance;
    if v_needs_maintenance then
      perform 1 from public.maintenance_records m where m.project_id = p_project_id
        and m.inspection_id = v_first_inspection and m.archived_at is null and m.status = 'completed' limit 1 for share;
      if not found then
        raise exception using errcode = 'P0001', message = 'Complete maintenance for the first-anniversary inspection before validating a later follow-up.';
      end if;
    end if;
  end if;

  if p_result = 'approved' and v_old <> 'approved' and v_completion is not null
     and p_year > extract(year from v_completion)::integer + 1
     and not exists (select 1 from public.inspections i where i.project_id = p_project_id
                     and i.annual_follow_up_year = p_year and i.overall_score is not null) then
    select exists (
      select 1 from public.annual_validation_entries a
      where a.project_id = p_project_id and a.deleted_at is null and a.result = 'approved' and a.year < p_year
        and not exists (select 1 from public.inspections i where i.project_id = a.project_id
                        and i.annual_follow_up_year = a.year and i.overall_score is not null)
    ) into v_earlier_pending;
    update public.annual_validation_entries set result = p_result, remarks = trim(p_remarks),
      validated_by = p_user_id, validated_at = now(), inspector_reset_queued = v_earlier_pending
      where project_id = p_project_id and year = p_year and deleted_at is null;
    if not v_earlier_pending then
      update public.projects set inspector_id = null, deleted_inspector_id = null where id = p_project_id;
    end if;
  else
    update public.annual_validation_entries set result = p_result, remarks = trim(p_remarks),
      validated_by = p_user_id, validated_at = now(),
      inspector_reset_queued = case when p_result <> 'approved' then false else inspector_reset_queued end
      where project_id = p_project_id and year = p_year and deleted_at is null;
  end if;
  -- Historical validations can be entered out of order. If an earlier year
  -- becomes eligible later, keep subsequent validated years queued behind it.
  if p_result = 'approved' and v_old <> 'approved' and not exists (
    select 1 from public.inspections i where i.project_id = p_project_id
      and i.annual_follow_up_year = p_year and i.overall_score is not null
  ) then
    update public.annual_validation_entries a set inspector_reset_queued = true
      where a.project_id = p_project_id and a.year > p_year and a.result = 'approved' and a.deleted_at is null
        and not exists (select 1 from public.inspections i where i.project_id = a.project_id
          and i.annual_follow_up_year = a.year and i.overall_score is not null);
  end if;
  return true;
end $$;
