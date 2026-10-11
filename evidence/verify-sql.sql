-- Read-only SQL evidence queries. Execute in Supabase SQL Editor after real data entry.
-- Use your actual plan_id (replace the example UUID in the WITH clause).
with chosen as (select '00000000-0000-0000-0000-000000000000'::uuid as plan_id),
 tasks as (select t.* from public.pds_tasks t join chosen c on t.plan_id=c.plan_id where t.deleted_at is null)
select
 (select count(*) from tasks) as planned,
 (select count(*) from tasks where status='done') as completed,
 (select count(*) from tasks where status<>'done' and due_date < (now() at time zone 'Asia/Seoul')::date) as overdue,
 (select count(*) from tasks t where exists(select 1 from public.pds_logs l where l.task_id=t.id and length(trim(l.blocker))>0)) as blocked,
 coalesce((select sum(estimated_minutes) from tasks),0) as estimated_minutes,
 coalesce((select sum(l.actual_minutes) from public.pds_logs l join tasks t on l.task_id=t.id),0) as actual_minutes,
 coalesce((select sum(l.actual_minutes) from public.pds_logs l join tasks t on l.task_id=t.id),0) - coalesce((select sum(estimated_minutes) from tasks),0) as difference_minutes;

-- Current data presence counts for the entire public app
select
 (select count(*) from public.pds_plans) as plans,
 (select count(*) from public.pds_tasks where deleted_at is null and plan_id is not null) as linked_tasks,
 (select count(*) from public.pds_logs) as execution_logs,
 (select count(*) from public.pds_reflections) as reflections,
 (select count(*) from public.pds_plan_versions) as saved_versions;

-- Actual completion events for any task: each task_id has at most one row due to PRIMARY KEY
select task_id, count(*) as events from public.pds_completion_events group by task_id order by events desc, task_id;
