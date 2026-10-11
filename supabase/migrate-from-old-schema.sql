-- ONLY for users who already executed the previous Task 6 v1 schema.
-- Run after carefully backing up data. Next run schema.sql to add constraints and RPCs.
-- Old schema had plan_id NOT NULL with ON DELETE CASCADE; v2 makes it optional.
alter table if exists public.pds_tasks alter column plan_id drop not null;
alter table if exists public.pds_tasks drop constraint if exists pds_tasks_plan_id_fkey;
alter table if exists public.pds_tasks add constraint pds_tasks_plan_id_fkey
 foreign key(plan_id) references public.pds_plans(id) on delete set null;
-- Update existing DB's reflection foreign key for optional next plan as well.
alter table if exists public.pds_reflections drop constraint if exists pds_reflections_next_plan_id_fkey;
alter table if exists public.pds_reflections add constraint pds_reflections_next_plan_id_fkey
 foreign key(next_plan_id) references public.pds_plans(id) on delete set null;
