-- 2026-05-02: OCR 오인식 보정 사전 DB 이전 (사용자 결정)
-- 기존 src/lib/gemini.ts의 OCR_FIXES 정적 배열을 DB로 이전.
-- 검수자가 행 편집 시 직접 등록 가능 → 코드 배포 없이 사전 누적.

CREATE TABLE IF NOT EXISTS ocr_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wrong TEXT NOT NULL,
  correct TEXT NOT NULL,
  category TEXT,
  note TEXT,
  applied_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ocr_corrections IS
  'OCR 오인식 자동 보정 사전. gemini.ts에서 매 OCR 후 적용 (TTL 5분 메모리 캐시).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_ocr_corrections_wrong_active
  ON ocr_corrections(wrong) WHERE is_active = true;

-- 기존 OCR_FIXES 19개 시드
INSERT INTO ocr_corrections (wrong, correct, category, note) VALUES
  ('편두부', '판두부', 'food', '두부 종류 표준 (판/모/손/연/순)'),
  ('이초웰', '이츠웰', 'supplier', '계란/다진마늘 공급사'),
  ('증가집', '종가집', 'supplier', '김치 공급사'),
  ('굿떡', '굿픽', 'supplier', '야채 공급사 — 픽 글자 오독'),
  ('굿팩', '굿픽', 'supplier', '야채 공급사 — 픽 글자 오독'),
  ('굿핏', '굿픽', 'supplier', '야채 공급사 — 픽 글자 오독'),
  ('굿박', '굿픽', 'supplier', '야채 공급사 — 픽 글자 오독'),
  ('굿곡', '굿픽', 'supplier', '야채 공급사 — 픽 글자 오독'),
  ('긋픽', '굿픽', 'supplier', '야채 공급사 — 굿 글자 오독'),
  ('마자촌', '마차촌', 'supplier', '어묵 공급사 — 차→자 오독'),
  ('마자춘', '마차촌', 'supplier', '어묵 공급사 — 차→자 오독'),
  ('삼송 ', '삼승 ', 'supplier', '닭다리살 공급사 — 승→송 오독 (공백 포함)'),
  ('삼송프리미엄', '삼승프리미엄', 'supplier', '닭다리살 공급사 — 승→송 오독'),
  ('속주', '숙주', 'food', '녹두 발아 나물'),
  ('돈암다리', '돈앞다리', 'cut', '돼지 앞다리살 — 앞→암 오독'),
  ('소암다리', '소앞다리', 'cut', '소 앞다리살 — 앞→암 오독 (예방)'),
  ('세척우무', '세척무우', 'food', '세척 무 — 무/우 글자 순서 오독'),
  ('쌈김자', '깐감자', 'food', '깐 감자 — 깐→쌈, 감→김 오독'),
  ('깐김자', '깐감자', 'food', '깐 감자 — 감→김 오독');
