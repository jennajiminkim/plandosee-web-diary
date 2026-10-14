-- plan.do.see: SAFE, idempotent v2 -> v3 upgrade on the EXISTING database.
-- BACK UP existing data before execution. NO DROP, TRUNCATE, or destructive DELETE.
-- Run this file once in Supabase SQL Editor, then deploy the matching app/api files.
BEGIN;

ALTER TABLE public.pds_plans ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.pds_weekly_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 week_start date NOT NULL UNIQUE,
 entry_date date NOT NULL,
 plan_id uuid REFERENCES public.pds_plans(id) ON DELETE SET NULL,
 question text NOT NULL DEFAULT '',
 discovery text NOT NULL DEFAULT '',
 next_action text NOT NULL DEFAULT '',
 bg_color text NOT NULL DEFAULT '#FAFAFA' CHECK (bg_color ~ '^#[0-9A-Fa-f]{6}$'),
 date_color text NOT NULL DEFAULT '#1E4099' CHECK (date_color ~ '^#[0-9A-Fa-f]{6}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT pds_weekly_reviews_monday CHECK (extract(isodow from week_start)=1)
);

CREATE TABLE IF NOT EXISTS public.pds_color_swatches (
 color text PRIMARY KEY CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
 usage_count integer NOT NULL DEFAULT 1 CHECK (usage_count>=0),
 last_used timestamptz NOT NULL DEFAULT now()
);

-- Capture previously selected task colors without discarding or modifying tasks.
INSERT INTO public.pds_color_swatches(color,usage_count,last_used)
SELECT lower(color), count(*)::integer, now()
FROM public.pds_tasks WHERE color ~ '^#[0-9A-Fa-f]{6}$'
GROUP BY lower(color)
ON CONFLICT(color) DO NOTHING;

CREATE OR REPLACE FUNCTION public.pds_remember_task_color()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.color IS DISTINCT FROM OLD.color THEN
   IF NEW.color ~ '^#[0-9A-Fa-f]{6}$' THEN
     INSERT INTO public.pds_color_swatches(color,usage_count,last_used)
     VALUES(lower(NEW.color),1,now())
     ON CONFLICT(color) DO UPDATE
     SET usage_count=public.pds_color_swatches.usage_count+1,last_used=now();
   END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS pds_task_color_trigger ON public.pds_tasks;
CREATE TRIGGER pds_task_color_trigger
AFTER INSERT OR UPDATE OF color ON public.pds_tasks
FOR EACH ROW EXECUTE FUNCTION public.pds_remember_task_color();

-- Atomic plan revision, including inherited task priorities. Old plan version retained.
CREATE OR REPLACE FUNCTION public.pds_update_plan(
 p_id uuid, p_title text, p_start_date date, p_end_date date,
 p_priority integer, p_success_criteria text, p_estimated_minutes integer
) RETURNS public.pds_plans LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE previous public.pds_plans%rowtype; current_plan public.pds_plans%rowtype;
BEGIN
 SELECT * INTO previous FROM public.pds_plans WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '계획을 찾을 수 없습니다.'; END IF;
 INSERT INTO public.pds_plan_versions(plan_id,snapshot) VALUES(previous.id,to_jsonb(previous));
 UPDATE public.pds_plans SET title=p_title,start_date=p_start_date,end_date=p_end_date,
  priority=p_priority,success_criteria=p_success_criteria,estimated_minutes=p_estimated_minutes,
  updated_at=now() WHERE id=p_id RETURNING * INTO current_plan;
 UPDATE public.pds_tasks SET priority=p_priority
 WHERE plan_id=p_id AND deleted_at IS NULL AND priority IS DISTINCT FROM p_priority;
 RETURN current_plan;
END; $$;

-- Backfill priority inheritance on linked tasks, leaving unlinked task priorities untouched.
UPDATE public.pds_tasks AS t SET priority=p.priority
FROM public.pds_plans AS p
WHERE t.plan_id=p.id AND p.deleted_at IS NULL
  AND t.deleted_at IS NULL AND t.priority IS DISTINCT FROM p.priority;

-- Weekly journal is separate from per-plan reflections; both kept.
-- Merge one latest historic plan reflection per week (Korea time); original plan reflections remain in place.
WITH prior AS (
 SELECT r.*, ((r.updated_at AT TIME ZONE 'Asia/Seoul')::date -
   (extract(isodow FROM (r.updated_at AT TIME ZONE 'Asia/Seoul'))::int-1))::date AS ws
 FROM public.pds_reflections r
 WHERE btrim(r.answer)<>'' OR btrim(r.improvement)<>''
), ordered AS (
 SELECT DISTINCT ON (ws) ws, plan_id,
  (updated_at AT TIME ZONE 'Asia/Seoul')::date AS day,
  question,answer,improvement FROM prior ORDER BY ws,updated_at DESC,id DESC
)
INSERT INTO public.pds_weekly_reviews(week_start,entry_date,plan_id,question,discovery,next_action)
SELECT ws,day,plan_id,question,answer,improvement FROM ordered
ON CONFLICT (week_start) DO NOTHING;

-- One transaction: one calendar-week entry plus compatibility with task 6's plan reflection link.
CREATE OR REPLACE FUNCTION public.pds_save_weekly_review(
 p_week_start date, p_plan_id uuid, p_question text,
 p_discovery text, p_next_action text, p_bg_color text, p_date_color text
) RETURNS public.pds_weekly_reviews LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE saved public.pds_weekly_reviews%rowtype;
BEGIN
 IF p_week_start IS NULL OR extract(isodow FROM p_week_start)<>1 THEN
   RAISE EXCEPTION '주간 시작일은 월요일이어야 합니다.';
 END IF;
 IF p_plan_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.pds_plans WHERE id=p_plan_id AND deleted_at IS NULL
 ) THEN RAISE EXCEPTION '활성 계획을 선택하거나 연결을 해제하세요.'; END IF;
 IF p_bg_color !~ '^#[0-9A-Fa-f]{6}$' OR p_date_color !~ '^#[0-9A-Fa-f]{6}$' THEN
   RAISE EXCEPTION '색상 형식을 확인하세요.';
 END IF;
 INSERT INTO public.pds_weekly_reviews
  (week_start,entry_date,plan_id,question,discovery,next_action,bg_color,date_color)
 VALUES(p_week_start,(now() AT TIME ZONE 'Asia/Seoul')::date,p_plan_id,
  left(p_question,350),left(p_discovery,5000),left(p_next_action,2000),p_bg_color,p_date_color)
 ON CONFLICT(week_start) DO UPDATE SET
  plan_id=excluded.plan_id,question=excluded.question,
  discovery=excluded.discovery,next_action=excluded.next_action,
  bg_color=excluded.bg_color,date_color=excluded.date_color,updated_at=now()
 RETURNING * INTO saved;
 IF p_plan_id IS NOT NULL THEN
   INSERT INTO public.pds_reflections(plan_id,question,answer,improvement,updated_at)
   VALUES(p_plan_id,saved.question,saved.discovery,saved.next_action,now())
   ON CONFLICT(plan_id) DO UPDATE SET
     question=excluded.question,answer=excluded.answer,
     improvement=excluded.improvement,updated_at=now();
 END IF;
 RETURN saved;
END; $$;

ALTER TABLE public.pds_weekly_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pds_color_swatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pds_weekly_reviews, public.pds_color_swatches FROM anon,authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pds_weekly_reviews,public.pds_color_swatches TO service_role;
REVOKE ALL ON FUNCTION public.pds_save_weekly_review(date,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pds_save_weekly_review(date,uuid,text,text,text,text,text) TO service_role;
COMMIT;
