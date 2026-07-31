-- 060_source_archive.sql
-- [정산] 원천 파일 서버 보관 (docs/systems/settlement/원천보관.md §20)
--
-- ★ **왜 서버에 두는가.** 지금은 원천이 브라우저 메모리에만 있어, 새로고침하면
-- 처음부터다. 말일 09:00~14:00 다섯 시간 안에 정산과 계산서 발행을 **혼자**
-- 끝내야 하는데, 그 사이 조정 요청이 몰려 들어온다. 조정 한 건 넣을 때마다
-- 파일이 살아 있어야 하니 창을 닫을 수도, 딴 일을 할 수도 없다.
--
-- 2026-07-31에는 7월 자료가 6월로 확정된 사고가 있었는데, **원본 파일이 없어**
-- 마감 스냅샷(rev1)으로 되돌려야 했다. 원천이 남아 있었으면 바로 다시 돌렸다.
--
-- ⚠️ 파싱 결과는 저장하지 않는다. 실측 결과 **파싱이 1~2ms**라(읽기 59~82ms)
-- 연 3만 행짜리 테이블과 그 동기화 문제를 떠안을 이유가 없다. 파일만 두고
-- 쓸 때마다 다시 판다. 조회 화면이 필요해지면 그때 행 테이블을 얹는다.

BEGIN;

-- ============================================================
-- 1. 보관 버킷 — **비공개**
-- ============================================================
-- 거래처 단가가 담긴 자료다. 앱이 service_role로만 읽고, 화면에는
-- 서명 URL 없이 서버를 거쳐 내보낸다.
INSERT INTO storage.buckets (id, name, public)
VALUES ('settlement-sources', 'settlement-sources', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. 원천 파일 목록
-- ============================================================
-- **파일 1개가 2종을 담을 수 있다** (통합 파일 = 신세계 + CJ 집계표).
-- 그때는 행을 2개 만들고 `storage_path`를 공유한다. 종류별로 활성본을
-- 따로 갈아끼울 수 있어야 하기 때문이다 — CJ 거래명세서만 재발행되는 일이 잦다.
CREATE TABLE IF NOT EXISTS public.settlement_source_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  period text NOT NULL,          -- YYYY-MM
  kind text NOT NULL,            -- shinsegae | cj | cj_statement

  file_name text NOT NULL,
  -- 같은 파일이 2종을 담으면 두 행이 같은 경로를 가리킨다
  storage_path text NOT NULL,
  file_size bigint NOT NULL,
  sheet_name text NOT NULL,

  -- 파일이 실제로 담고 있는 기간 (§8-4 기간 검증 결과).
  -- CJ 집계표는 날짜 열이 없어 NULL이다.
  date_min date,
  date_max date,

  /**
   * 지금 쓰는 원천인가. **종류별로 하나만 true.**
   * 이전 것은 지우지 않고 false로 남긴다 — 어제 같은 사고를 추적하려면
   * "그때 무엇을 올렸는지"가 있어야 한다.
   */
  is_active boolean NOT NULL DEFAULT true,

  uploaded_by text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  /** 왜 교체됐는지. 비활성으로 내려갈 때 적는다. */
  replaced_reason text
);

ALTER TABLE public.settlement_source_files
  DROP CONSTRAINT IF EXISTS settlement_source_files_kind_valid;
ALTER TABLE public.settlement_source_files
  ADD CONSTRAINT settlement_source_files_kind_valid
    CHECK (kind IN ('shinsegae', 'cj', 'cj_statement'));

-- 종류별 활성본은 **하나뿐**이다. 둘이 되면 어느 걸 쓸지 코드가 정해야 하는데,
-- 그런 판단은 사람이 해야 한다. DB에서 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS settlement_source_files_active_uniq
  ON public.settlement_source_files (period, kind)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS settlement_source_files_period_idx
  ON public.settlement_source_files (period, uploaded_at DESC);

COMMENT ON TABLE public.settlement_source_files IS
  '원천 파일 보관 (docs §20). 파일 실체는 Storage, 여기는 메타. 5년 보존.';
COMMENT ON COLUMN public.settlement_source_files.storage_path IS
  '같은 파일이 2종(신세계+CJ 집계표)을 담으면 두 행이 같은 경로를 가리킨다.';
COMMENT ON COLUMN public.settlement_source_files.is_active IS
  '지금 쓰는 원천. 종류별로 하나만 true (부분 유니크 인덱스로 강제).';

-- 앱은 service_role로만 접근한다 (다른 정산 테이블과 동일)
ALTER TABLE public.settlement_source_files ENABLE ROW LEVEL SECURITY;

COMMIT;
