-- Track a later validated year waiting for the preceding validated inspection.
-- No existing assignments are changed by this migration.
alter table public.annual_validation_entries
  add column if not exists inspector_reset_queued boolean not null default false;

-- Service-only: validate the annual entry and reset (or queue the reset) under
-- the project lock. The first annual follow-up retains the existing workflow.
create or replace function public.save_annual_validation_with_assignment(
  p_project_id uuid, p_year integer, p_result public.validation_status,
  p_remarks text, p_user_id uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_completion date;
  v_old public.validation_status;
  v_earlier_pending boolean;
begin
  select actual_completion_date into v_completion from public.projects
    where id = p_project_id and archived_at is null for update;
  if not found then return false; end if;
  select result into v_old from public.annual_validation_entries
    where project_id = p_project_id and year = p_year and deleted_at is null for update;
  if not found then return false; end if;

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

-- Complete the result only after its assessment and attachments have been
-- saved. Serialize with validation and release the next queued year once.
create or replace function public.finish_annual_inspection(
  p_project_id uuid, p_inspection_id uuid, p_inspector_id uuid, p_score numeric
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_assigned uuid;
  v_year integer;
  v_owner uuid;
  v_score numeric;
  v_next integer;
begin
  if p_score is null or p_score <= 0 or p_score > 10 then return false; end if;
  select inspector_id into v_assigned from public.projects where id = p_project_id and archived_at is null for update;
  if not found or v_assigned is distinct from p_inspector_id then return false; end if;
  select annual_follow_up_year, inspector_id, overall_score into v_year, v_owner, v_score
    from public.inspections where id = p_inspection_id and project_id = p_project_id and archived_at is null for update;
  if not found or v_year is null or v_score is not null or (v_owner is not null and v_owner is distinct from p_inspector_id) then return false; end if;
  if not exists (select 1 from public.annual_validation_entries where project_id = p_project_id and year = v_year and result = 'approved' and deleted_at is null) then return false; end if;
  if exists (select 1 from public.annual_validation_entries a where a.project_id = p_project_id and a.result = 'approved' and a.deleted_at is null and a.year < v_year
      and not exists (select 1 from public.inspections i where i.project_id = a.project_id and i.annual_follow_up_year = a.year and i.overall_score is not null)) then return false; end if;
  update public.inspections set overall_score = p_score, inspector_id = p_inspector_id where id = p_inspection_id;
  select min(a.year) into v_next from public.annual_validation_entries a
    where a.project_id = p_project_id and a.deleted_at is null and a.result = 'approved' and a.inspector_reset_queued
      and not exists (select 1 from public.inspections i where i.project_id = a.project_id and i.annual_follow_up_year = a.year and i.overall_score is not null);
  if v_next is not null and not exists (
    select 1 from public.annual_validation_entries a where a.project_id = p_project_id and a.deleted_at is null and a.result = 'approved' and a.year < v_next
      and not exists (select 1 from public.inspections i where i.project_id = a.project_id and i.annual_follow_up_year = a.year and i.overall_score is not null)
  ) then
    update public.projects set inspector_id = null, deleted_inspector_id = null where id = p_project_id;
    update public.annual_validation_entries set inspector_reset_queued = false where project_id = p_project_id and year = v_next;
  end if;
  return true;
end $$;

revoke all on function public.save_annual_validation_with_assignment(uuid, integer, public.validation_status, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_annual_inspection(uuid, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.save_annual_validation_with_assignment(uuid, integer, public.validation_status, text, uuid) to service_role;
grant execute on function public.finish_annual_inspection(uuid, uuid, uuid, numeric) to service_role;
