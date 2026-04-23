-- 1) Extensions
create extension if not exists "pgcrypto";

-- 2) Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  phone text not null default '',
  address text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Tickets
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (subject in ('question', 'complaint', 'social_help', 'suggestion')),
  status text not null default 'new' check (status in ('new', 'in_progress', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('user', 'admin')),
  content text not null,
  attachment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 5) Updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_tickets_updated_at on public.tickets;
create trigger trg_tickets_updated_at
before update on public.tickets
for each row execute function public.set_updated_at();

-- 6) Role helper
create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- 7) Enable RLS
alter table public.profiles enable row level security;
alter table public.tickets enable row level security;
alter table public.messages enable row level security;

-- 8) Profiles policies
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles
for select
using (
  auth.uid() = id
  or public.current_user_role() = 'admin'
);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
on public.profiles
for update
using (
  auth.uid() = id
  or public.current_user_role() = 'admin'
)
with check (
  auth.uid() = id
  or public.current_user_role() = 'admin'
);

-- 9) Tickets policies
drop policy if exists "tickets_select_owner_or_admin" on public.tickets;
create policy "tickets_select_owner_or_admin"
on public.tickets
for select
using (
  auth.uid() = user_id
  or public.current_user_role() = 'admin'
);

drop policy if exists "tickets_insert_owner" on public.tickets;
create policy "tickets_insert_owner"
on public.tickets
for insert
with check (auth.uid() = user_id);

drop policy if exists "tickets_update_owner_or_admin" on public.tickets;
create policy "tickets_update_owner_or_admin"
on public.tickets
for update
using (
  auth.uid() = user_id
  or public.current_user_role() = 'admin'
)
with check (
  auth.uid() = user_id
  or public.current_user_role() = 'admin'
);

-- 10) Messages policies
drop policy if exists "messages_select_owner_or_admin" on public.messages;
create policy "messages_select_owner_or_admin"
on public.messages
for select
using (
  exists (
    select 1 from public.tickets t
    where t.id = messages.ticket_id
      and (t.user_id = auth.uid() or public.current_user_role() = 'admin')
  )
);

drop policy if exists "messages_insert_owner_or_admin" on public.messages;
create policy "messages_insert_owner_or_admin"
on public.messages
for insert
with check (
  exists (
    select 1 from public.tickets t
    where t.id = messages.ticket_id
      and (t.user_id = auth.uid() or public.current_user_role() = 'admin')
  )
  and (
    auth.uid() = sender_id
    or public.current_user_role() = 'admin'
  )
);

-- 11) Helpful indexes
create index if not exists idx_tickets_user_id on public.tickets(user_id);
create index if not exists idx_tickets_created_at on public.tickets(created_at desc);
create index if not exists idx_messages_ticket_id on public.messages(ticket_id);
create index if not exists idx_messages_created_at on public.messages(created_at asc);
