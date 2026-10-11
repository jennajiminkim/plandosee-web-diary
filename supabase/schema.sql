-- plan.do.see Task 6 / v2. Execute in Supabase SQL Editor on a NEW project.
-- Public users have no direct table permissions. Vercel server uses service_role.
create extension if not exists pgcrypto;

create table if not exists public.pds_plans (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(title) between 1 and 180),
 start_date date not null, end_date date not null,
 priority integer not null default 1 check(priority between 1 and 999),
 success_criteria text not null default '',
 estimated_minutes integer not null default 0 check(estimated_minutes between 0 and 100000),
 from_reflection_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint pds_plan_dates check(end_date >= start_date)
);
create table if not exists public.pds_plan_versions (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.pds_plans(id) on delete cascade,
 snapshot jsonb not null, changed_at timestamptz not null default now()
);
create index if not exists pds_plan_versions_plan_idx on public.pds_plan_versions(plan_id,changed_at desc);

create table if not exists public.pds_tasks (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid references public.pds_plans(id) on delete set null,
 title text not null check(length(title) between 1 and 180),
 priority integer not null default 1 check(priority between 1 and 999),
 tag text not null default '생활', color text not null default '#dce9dc',
 due_date date, start_date date, end_date date,
 mode text not null default 'single' check(mode in ('single','range','repeat')),
 estimated_minutes integer not null default 0 check(estimated_minutes between 0 and 100000),
 estimate_basis text not null default 'total' check(estimate_basis in ('total','per_session')),
 status text not null default 'active' check(status in ('active','done')),
 completed_at timestamptz, deleted_at timestamptz,
 created_at timestamptz not null default now(),
 constraint pds_task_dates check(start_date is null or end_date is null or end_date >= start_date)
);
create index if not exists pds_tasks_plan_idx on public.pds_tasks(plan_id);

create table if not exists public.pds_cells (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.pds_tasks(id) on delete cascade,
 day date not null, state text not null default 'planned' check(state in ('planned','progress','done')),
 progress text not null default '', note text not null default '',
 constraint pds_cells_unique unique(task_id,day)
);
create table if not exists public.pds_logs (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.pds_tasks(id) on delete cascade,
 started_at timestamptz not null, ended_at timestamptz not null,
 actual_minutes integer not null check(actual_minutes between 0 and 1440),
 progress text not null default '', blocker text not null default '',
 created_at timestamptz not null default now(),
 constraint pds_log_order check(ended_at >= started_at),
 constraint pds_log_minutes_consistent check(actual_minutes = round(extract(epoch from (ended_at - started_at)) / 60.0)::integer)
);
create index if not exists pds_logs_task_idx on public.pds_logs(task_id);

-- One completion event per task: concurrency-safe at the DB layer, not just a disabled button.
create table if not exists public.pds_completion_events (
 task_id uuid primary key references public.pds_tasks(id) on delete cascade,
 completed_at timestamptz not null default now()
);
create table if not exists public.pds_reflections (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null unique references public.pds_plans(id) on delete cascade,
 question text not null default '', answer text not null default '', improvement text not null default '',
 next_plan_id uuid references public.pds_plans(id) on delete set null,
 updated_at timestamptz not null default now()
);

-- Keep the plan-reflection back-reference as an actual foreign key.
alter table public.pds_plans drop constraint if exists pds_plans_from_reflection_id_fkey;
alter table public.pds_plans add constraint pds_plans_from_reflection_id_fkey
 foreign key(from_reflection_id) references public.pds_reflections(id) on delete set null;

-- PL/pgSQL functions are one database transaction each.
create or replace function public.pds_update_plan(
 p_id uuid, p_title text, p_start_date date, p_end_date date,
 p_priority integer, p_success_criteria text, p_estimated_minutes integer
) returns public.pds_plans language plpgsql security definer
set search_path = public, pg_temp as $$
declare previous public.pds_plans%rowtype; current_plan public.pds_plans%rowtype;
begin
 select * into previous from public.pds_plans where id=p_id for update;
 if not found then raise exception '계획을 찾을 수 없습니다.'; end if;
 insert into public.pds_plan_versions(plan_id,snapshot) values(previous.id,to_jsonb(previous));
 update public.pds_plans set title=p_title,start_date=p_start_date,end_date=p_end_date,
  priority=p_priority,success_criteria=p_success_criteria,estimated_minutes=p_estimated_minutes,
  updated_at=now() where id=p_id returning * into current_plan;
 return current_plan;
end; $$;

create or replace function public.pds_complete_task(p_id uuid)
returns public.pds_tasks language plpgsql security definer
set search_path = public, pg_temp as $$
declare current_task public.pds_tasks%rowtype;
begin
 select * into current_task from public.pds_tasks where id=p_id and deleted_at is null for update;
 if not found then raise exception '할 일을 찾을 수 없습니다.'; end if;
 if current_task.status <> 'done' then
  update public.pds_tasks set status='done',completed_at=now() where id=p_id returning * into current_task;
  insert into public.pds_completion_events(task_id,completed_at)
   values(p_id,current_task.completed_at) on conflict(task_id) do nothing;
 end if;
 return current_task;
end; $$;

create or replace function public.pds_create_next_plan(p_reflection_id uuid,p_start_date date,p_end_date date)
returns public.pds_plans language plpgsql security definer
set search_path = public, pg_temp as $$
declare reflection_row public.pds_reflections%rowtype;
 prior public.pds_plans%rowtype; result public.pds_plans%rowtype;
begin
 select * into reflection_row from public.pds_reflections where id=p_reflection_id for update;
 if not found then raise exception '돌아보기 기록이 없습니다.'; end if;
 if reflection_row.next_plan_id is not null then
  select * into result from public.pds_plans where id=reflection_row.next_plan_id;
  return result;
 end if;
 if btrim(reflection_row.improvement) = '' then raise exception '다음 주에 다르게 해볼 내용을 작성하세요.'; end if;
 if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
  raise exception '기간을 확인하세요.';
 end if;
 select * into prior from public.pds_plans where id=reflection_row.plan_id;
 insert into public.pds_plans(title,start_date,end_date,priority,success_criteria,
  estimated_minutes,from_reflection_id)
 values(left(reflection_row.improvement,180),p_start_date,p_end_date,prior.priority,
  reflection_row.improvement,0,reflection_row.id) returning * into result;
 update public.pds_reflections set next_plan_id=result.id where id=reflection_row.id;
 return result;
end; $$;

-- RLS and no direct client privileges. Do not paste SERVICE_ROLE_KEY into any SQL or browser file.
DO $$
declare tbl text;
begin
 foreach tbl in array array['pds_plans','pds_plan_versions','pds_tasks','pds_cells','pds_logs','pds_completion_events','pds_reflections'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from anon, authenticated',tbl);
 end loop;
end $$;
revoke all on function public.pds_update_plan(uuid,text,date,date,integer,text,integer) from public,anon,authenticated;
revoke all on function public.pds_complete_task(uuid) from public,anon,authenticated;
revoke all on function public.pds_create_next_plan(uuid,date,date) from public,anon,authenticated;
grant execute on function public.pds_update_plan(uuid,text,date,date,integer,text,integer) to service_role;
grant execute on function public.pds_complete_task(uuid) to service_role;
grant execute on function public.pds_create_next_plan(uuid,date,date) to service_role;
