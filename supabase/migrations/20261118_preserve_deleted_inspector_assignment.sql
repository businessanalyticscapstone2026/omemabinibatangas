-- Preserve an unavailable-assignment marker when permanent account deletion
-- clears the inspector_id foreign key. No existing assignments are changed.
alter table public.projects
  add column if not exists deleted_inspector_id uuid;

create or replace function public.remember_deleted_project_inspector()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.projects
    set deleted_inspector_id = old.id
    where inspector_id = old.id;
  return old;
end;
$$;

revoke all on function public.remember_deleted_project_inspector() from public;
drop trigger if exists remember_deleted_project_inspector on public.profiles;
create trigger remember_deleted_project_inspector
  before delete on public.profiles
  for each row execute function public.remember_deleted_project_inspector();
