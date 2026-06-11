create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null default '',
  password_hash text not null,
  role text not null default 'student' check (role in ('student', 'admin')),
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

alter table app_users enable row level security;
alter table auth_sessions enable row level security;

create index if not exists idx_app_users_email on app_users (email);
create index if not exists idx_auth_sessions_user on auth_sessions (user_id);
create index if not exists idx_auth_sessions_token_hash on auth_sessions (token_hash);
create index if not exists idx_auth_sessions_active on auth_sessions (expires_at)
  where revoked_at is null;

grant usage on schema public to service_role;
grant select, insert, update, delete on table app_users to service_role;
grant select, insert, update, delete on table auth_sessions to service_role;

drop policy if exists app_users_no_direct_client_access on app_users;
create policy app_users_no_direct_client_access
  on app_users
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists auth_sessions_no_direct_client_access on auth_sessions;
create policy auth_sessions_no_direct_client_access
  on auth_sessions
  for all
  to anon, authenticated
  using (false)
  with check (false);
