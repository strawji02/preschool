-- 067_comparison_proposal_web_dashboard.sql
-- [비교] 웹 제안서 현황판 공식 집계 시작점

BEGIN;

CREATE TABLE IF NOT EXISTS public.comparison_proposal_dashboard_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  official_start_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.comparison_proposal_dashboard_settings (id, official_start_at)
VALUES (1, now())
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.comparison_proposal_dashboard_settings IS
  '웹 제안서 현황판 공식 집계 시작점. 이전 실데이터·과거 추정치는 보존하되 화면과 통계에서 제외한다.';

ALTER TABLE public.comparison_proposal_dashboard_settings ENABLE ROW LEVEL SECURITY;

COMMIT;
