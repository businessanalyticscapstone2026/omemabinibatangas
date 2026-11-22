-- Auth's profile trigger must not use the singleton encoder role as a temporary
-- default: creating an inspector would otherwise fail as soon as an encoder exists.
-- Roles are assigned by the authenticated server after profile creation, never
-- trusted from public signup metadata.
create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_name text;
begin
  profile_name := coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1));
  insert into public.profiles (id, email, username, full_name, name, role, status)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)),
    profile_name, profile_name, 'inspector'::public.user_role, 'active'::public.account_status);
  return new;
end;
$$;

-- Includes inactive, non-archived accounts. Fails safely if duplicates exist;
-- they must be resolved by an administrator before applying this migration.
create unique index if not exists profiles_one_current_singleton_role
  on public.profiles (role)
  where archived_at is null and role in ('head_engineer', 'encoder', 'validator');
