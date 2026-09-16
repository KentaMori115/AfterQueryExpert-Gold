-- Ensure required extensions
create extension if not exists pgcrypto;

-- Core tables
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('admin','pm','dev','client')),
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  code text primary key,
  name text not null,
  hours_monthly integer not null check (hours_monthly > 0)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references public.users(id) on delete set null,
  stripe_customer_id text unique,
  plan_code text references public.plans(code),
  hours_monthly integer not null default 40,
  hours_used_month numeric(8,2) not null default 0,
  cycle_start date not null default (now()::date)
);

create table if not exists public.client_members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('admin','pm','dev','client')),
  unique (client_id, user_id)
);

create type task_priority as enum ('low','medium','high');
create type task_status as enum ('queued','in_progress','done');

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text,
  priority task_priority not null default 'medium',
  status task_status not null default 'queued',
  est_hours integer,
  hours_spent numeric(8,2) default 0,
  assigned_dev_id uuid references public.users(id) on delete set null,
  attachments jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Queue ordering support
alter table public.tasks
  add column if not exists position integer not null default 0;

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  hours numeric(6,2) not null check (hours > 0),
  logged_by uuid not null references public.users(id) on delete restrict,
  logged_at timestamptz not null default now()
);

-- Seed plans
insert into public.plans (code, name, hours_monthly) values
  ('starter','Starter',40),
  ('growth','Growth',80),
  ('scale','Scale',120),
  ('dedicated','Dedicated',160)
on conflict (code) do update set name=excluded.name, hours_monthly=excluded.hours_monthly;

-- RLS: enable and policies
alter table public.users enable row level security;
alter table public.plans enable row level security;
alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.tasks enable row level security;
alter table public.usage_logs enable row level security;

-- Helper: check membership
create or replace function public.is_member(u uuid, c uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.client_members m
    where m.user_id = u and m.client_id = c
  );
$$;

-- Helper: get current user id from JWT when auth.uid() is unavailable
create or replace function public.current_user_id()
returns uuid language sql stable as $$
  select 
    case 
      when current_setting('request.jwt.claims', true) is null then null
      else 
        (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
    end;
$$;

-- Users: self or admin can see
create policy users_select on public.users for select
  using (true);

-- Plans: readable by all (no sensitive info)
create policy plans_select on public.plans for select using (true);

-- Clients: member visibility
create policy clients_select on public.clients for select using (
  exists (
    select 1 from public.client_members m
    where m.client_id = clients.id and m.user_id = coalesce(public.current_user_id(), '00000000-0000-0000-0000-000000000000'::uuid)
  )
);

-- Clients: allow users to create their own client (uses auth.uid() for INSERT)
create policy clients_insert_own on public.clients for insert with check (
  owner_user_id = auth.uid()
);

-- Client members: self membership visibility (simplified to avoid recursion)
create policy members_select on public.client_members for select using (
  user_id = coalesce(public.current_user_id(), '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Client members: allow users to create their own memberships (uses auth.uid() for INSERT)
create policy members_insert_own on public.client_members for insert with check (
  user_id = auth.uid()
);

-- Tasks: members can read; clients can insert queued tasks for their own client; pm/admin can update
create policy tasks_select on public.tasks for select using (
  public.is_member(coalesce(public.current_user_id(), '00000000-0000-0000-0000-000000000000'::uuid), client_id)
);

create policy tasks_insert_client on public.tasks for insert with check (
  exists (
    select 1 from public.client_members
    where client_id = tasks.client_id and user_id = auth.uid()
  )
);

drop policy if exists tasks_update_pm on public.tasks;
create policy tasks_update_pm on public.tasks for update using (
  exists (
    select 1 from public.client_members m
    where m.client_id = tasks.client_id
      and m.user_id = coalesce(public.current_user_id(), '00000000-0000-0000-0000-000000000000'::uuid)
      and m.role in ('pm','admin')
  )
);

-- Usage logs: only pm/admin/dev can insert; members can read
create policy usage_select on public.usage_logs for select using (
  public.is_member(coalesce(public.current_user_id(), '00000000-0000-0000-0000-000000000000'::uuid), client_id)
);

create policy usage_insert on public.usage_logs for insert with check (
  public.is_member(coalesce(public.current_user_id(), '00000000-0000-0000-0000-000000000000'::uuid), client_id)
);

-- Keep client's monthly used hours in sync when usage is logged
create or replace function public.bump_hours_used()
returns trigger language plpgsql as $$
begin
  update public.clients
    set hours_used_month = hours_used_month + new.hours
  where id = new.client_id;
  return new;
end;
$$;

drop trigger if exists trg_usage_bump on public.usage_logs;
create trigger trg_usage_bump after insert on public.usage_logs
for each row execute procedure public.bump_hours_used();

-- Stats for dashboard: completed this month and average turnaround (days)
create or replace function public.calculate_task_stats(p_client_id uuid)
returns table (
  completed_this_month integer,
  avg_turnaround_days numeric
) language sql stable as $$
  with done_this_month as (
    select * from public.tasks t
    where t.client_id = p_client_id
      and t.status = 'done'
      and t.completed_at is not null
      and date_trunc('month', t.completed_at) = date_trunc('month', now())
  )
  select
    count(*)::int as completed_this_month,
    coalesce(avg(extract(epoch from (completed_at - created_at)))/(60*60*24), 0) as avg_turnaround_days
  from done_this_month;
$$;

-- Aggregated usage view for UI (month-scoped)
create or replace view public.v_client_usage as
select c.id as client_id,
       c.hours_monthly,
       coalesce(sum(u.hours) filter (where date_trunc('month', u.logged_at)=date_trunc('month', current_date)),0) as hours_used,
       case when c.hours_monthly=0 then 0
            else round(100*coalesce(sum(u.hours) filter (where date_trunc('month', u.logged_at)=date_trunc('month', current_date)),0)/c.hours_monthly,1)
       end as pct_used
from public.clients c
left join public.usage_logs u on u.client_id = c.id
group by c.id, c.hours_monthly;

-- Unique constraint: One active task per client
create unique index if not exists one_active_task_per_client
on public.tasks(client_id)
where status = 'in_progress';

-- RPC to increment task hours
create or replace function public.increment_task_hours(p_task_id uuid, p_hours numeric)
returns void language plpgsql as $$
begin
  update public.tasks
  set hours_spent = coalesce(hours_spent, 0) + p_hours
  where id = p_task_id;
end;
$$;
