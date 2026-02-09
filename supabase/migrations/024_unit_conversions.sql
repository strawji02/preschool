-- 단위 환산 테이블
CREATE TABLE IF NOT EXISTS unit_conversions (
  id SERIAL PRIMARY KEY,
  category TEXT,                      -- 품목 카테고리 (양파, 감자 등)
  from_unit TEXT NOT NULL,            -- 원본 단위 (망, 박스)
  to_unit TEXT NOT NULL,              -- 변환 단위 (KG)
  conversion_factor DECIMAL NOT NULL, -- 환산 계수 (1망=15kg → 15.0)
  source TEXT DEFAULT 'manual',       -- 'manual' 또는 'learned'
  confidence DECIMAL,                 -- 학습 기반일 경우 신뢰도
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- 유니크 제약: 같은 카테고리의 같은 from_unit과 to_unit 조합은 중복 불가
  UNIQUE(category, from_unit, to_unit)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_unit_conversions_category ON unit_conversions(category);
CREATE INDEX IF NOT EXISTS idx_unit_conversions_from_unit ON unit_conversions(from_unit);
CREATE INDEX IF NOT EXISTS idx_unit_conversions_source ON unit_conversions(source);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_unit_conversions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_unit_conversions_updated_at
  BEFORE UPDATE ON unit_conversions
  FOR EACH ROW
  EXECUTE FUNCTION update_unit_conversions_updated_at();

-- 초기 데이터 삽입 (일반적인 환산 규칙)
INSERT INTO unit_conversions (category, from_unit, to_unit, conversion_factor, source) VALUES
  ('양파', '망', 'KG', 15.0, 'manual'),
  ('감자', '망', 'KG', 20.0, 'manual'),
  ('마늘', '망', 'KG', 10.0, 'manual'),
  ('당근', '박스', 'KG', 10.0, 'manual'),
  ('배추', '박스', 'KG', 8.0, 'manual')
ON CONFLICT (category, from_unit, to_unit) DO NOTHING;

COMMENT ON TABLE unit_conversions IS '비정량 단위(망, 박스, 봉 등)를 정량 단위(kg, g)로 환산하는 규칙';
COMMENT ON COLUMN unit_conversions.category IS '품목 카테고리 (NULL이면 모든 품목에 적용)';
COMMENT ON COLUMN unit_conversions.from_unit IS '원본 단위 (망, 박스, 봉 등)';
COMMENT ON COLUMN unit_conversions.to_unit IS '변환 단위 (KG, G 등)';
COMMENT ON COLUMN unit_conversions.conversion_factor IS '환산 계수 (1 from_unit = conversion_factor * to_unit)';
COMMENT ON COLUMN unit_conversions.source IS '규칙 출처: manual(수동 입력) 또는 learned(학습 기반)';
COMMENT ON COLUMN unit_conversions.confidence IS '학습 기반 규칙의 신뢰도 (0.0 ~ 1.0)';
