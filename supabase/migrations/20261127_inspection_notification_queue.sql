-- Keep unsuccessful inspection notifications retryable without resubmitting results.
create table if not exists public.inspection_notification_queue (
  inspection_id uuid primary key references public.inspections(id) on delete cascade,
  project_name text not null,
  actor_note text not null default '',
  sent_at timestamptz,
  token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0
);
alter table public.inspection_notification_queue enable row level security;
revoke all on public.inspection_notification_queue from public, anon, authenticated;

create or replace function public.claim_inspection_notifications(p_inspection_id uuid default null, p_limit integer default 10)
returns table(inspection_id uuid, project_name text, actor_note text, token uuid)
language sql security definer set search_path=public as $$
  with candidates as (
    select q.inspection_id from public.inspection_notification_queue q
    where q.sent_at is null and q.next_attempt_at <= now() and (q.lease_until is null or q.lease_until < now())
      and (p_inspection_id is null or q.inspection_id=p_inspection_id)
    order by q.next_attempt_at, q.inspection_id for update skip locked limit least(greatest(p_limit, 1), 20)
  )
  update public.inspection_notification_queue q set token=gen_random_uuid(), lease_until=now()+interval '5 minutes', attempts=q.attempts+1
    from candidates c where q.inspection_id=c.inspection_id
    returning q.inspection_id,q.project_name,q.actor_note,q.token;
$$;
create or replace function public.finish_inspection_notification(p_inspection_id uuid, p_token uuid, p_sent boolean)
returns void language sql security definer set search_path=public as $$
  update public.inspection_notification_queue set sent_at=case when p_sent then now() else null end,
    next_attempt_at=case when p_sent then next_attempt_at else now()+interval '5 minutes' end,
    token=null,lease_until=null where inspection_id=p_inspection_id and token=p_token;
$$;
revoke all on function public.claim_inspection_notifications(uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_inspection_notification(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_inspection_notifications(uuid,integer) to service_role;
grant execute on function public.finish_inspection_notification(uuid,uuid,boolean) to service_role;
