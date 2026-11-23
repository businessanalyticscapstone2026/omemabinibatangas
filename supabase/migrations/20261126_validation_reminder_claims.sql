-- Serialize reminder sends across cron and interactive requests. Only the
-- server's service role may claim or complete a reminder.
create table if not exists public.validation_reminder_claims (
  project_id uuid not null references public.projects(id) on delete cascade,
  year integer not null,
  token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  primary key (project_id, year)
);
alter table public.validation_reminder_claims enable row level security;
revoke all on public.validation_reminder_claims from public, anon, authenticated;

create or replace function public.claim_validation_reminder(p_project_id uuid, p_year integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_token uuid := gen_random_uuid(); v_claimed uuid;
begin
  if not exists (select 1 from public.annual_validation_entries a join public.projects p on p.id=a.project_id
    where a.project_id=p_project_id and a.year=p_year and a.result='pending' and a.deleted_at is null and p.archived_at is null) then
    return null;
  end if;
  insert into public.validation_reminder_claims(project_id, year, token, lease_until)
    values(p_project_id, p_year, v_token, now()+interval '5 minutes')
    on conflict(project_id,year) do update set token=excluded.token, lease_until=excluded.lease_until
      where validation_reminder_claims.sent_at is null and (validation_reminder_claims.lease_until is null or validation_reminder_claims.lease_until < now())
    returning token into v_claimed;
  return v_claimed;
end $$;

create or replace function public.finish_validation_reminder(p_project_id uuid, p_year integer, p_token uuid, p_sent boolean)
returns void language sql security definer set search_path = public as $$
  update public.validation_reminder_claims set sent_at=case when p_sent then now() else null end,
    token=null, lease_until=null where project_id=p_project_id and year=p_year and token=p_token;
$$;
revoke all on function public.claim_validation_reminder(uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_validation_reminder(uuid,integer,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_validation_reminder(uuid,integer) to service_role;
grant execute on function public.finish_validation_reminder(uuid,integer,uuid,boolean) to service_role;
