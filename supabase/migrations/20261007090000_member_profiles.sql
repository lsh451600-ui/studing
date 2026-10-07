-- Supabase Auth owns passwords. Public profiles never contain password hashes or emails.
create table if not exists public.member_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{4,20}$'),
  phone text not null check (phone ~ '^\+?[0-9]{9,15}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists member_profiles_username_unique on public.member_profiles (lower(username));
alter table public.member_profiles enable row level security;
revoke all on public.member_profiles from anon, authenticated;
grant select on public.member_profiles to authenticated;
drop policy if exists member_read_own_profile on public.member_profiles;
create policy member_read_own_profile on public.member_profiles for select to authenticated using ((select auth.uid()) = id);

create or replace function public.create_member_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.member_profiles (id, username, phone)
  values (new.id, trim(new.raw_user_meta_data ->> 'username'), new.raw_user_meta_data ->> 'phone');
  return new;
end;
$$;
revoke all on function public.create_member_profile() from public, anon, authenticated;
drop trigger if exists create_dining_member_profile on auth.users;
create trigger create_dining_member_profile after insert on auth.users for each row execute procedure public.create_member_profile();

-- Only the server's secret key may resolve a username to an email address.
create or replace function public.resolve_member_login(requested_username text)
returns text language sql stable security definer set search_path = '' as $$
  select u.email from public.member_profiles p join auth.users u on u.id = p.id
  where lower(p.username) = lower(trim(requested_username)) limit 1;
$$;
revoke all on function public.resolve_member_login(text) from public, anon, authenticated;
grant execute on function public.resolve_member_login(text) to service_role;

create table if not exists public.member_auth_limits (
  key text primary key, attempts integer not null, expires_at timestamptz not null
);
create index if not exists member_auth_limits_expiry on public.member_auth_limits(expires_at);
alter table public.member_auth_limits enable row level security;
revoke all on public.member_auth_limits from public, anon, authenticated;
create or replace function public.member_auth_limit(request_key text, request_maximum integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare count_attempts integer;
begin
  delete from public.member_auth_limits where expires_at < now();
  insert into public.member_auth_limits as limits (key, attempts, expires_at)
  values (request_key, 1, now() + interval '16 minutes')
  on conflict(key) do update set attempts = limits.attempts + 1
  returning attempts into count_attempts;
  return count_attempts <= least(greatest(request_maximum, 1), 10);
end;
$$;
revoke all on function public.member_auth_limit(text, integer) from public, anon, authenticated;
grant execute on function public.member_auth_limit(text, integer) to service_role;
