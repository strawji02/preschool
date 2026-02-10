-- 추가 단위 환산 규칙 시딩
-- Generic conversions (모든 품목에 적용)
INSERT INTO unit_conversions (category, from_unit, to_unit, conversion_factor, source, confidence) VALUES
  -- Generic weight conversions
  (NULL, 'kg', 'g', 1000, 'manual', 1.0),
  (NULL, 'g', 'g', 1, 'manual', 1.0),
  (NULL, 'kg', 'kg', 1, 'manual', 1.0),

  -- Generic volume conversions
  (NULL, 'L', 'ml', 1000, 'manual', 1.0),
  (NULL, 'ml', 'ml', 1, 'manual', 1.0),
  (NULL, 'L', 'L', 1, 'manual', 1.0),

  -- Generic count conversions
  (NULL, 'EA', 'EA', 1, 'manual', 1.0),
  (NULL, '개', 'EA', 1, 'manual', 1.0)
ON CONFLICT (category, from_unit, to_unit) DO NOTHING;

-- Category-specific conversions (계란 및 기타)
INSERT INTO unit_conversions (category, from_unit, to_unit, conversion_factor, source, confidence) VALUES
  -- 계란 (Eggs)
  ('계란', '판', 'EA', 30, 'manual', 1.0),
  ('계란', '구', 'EA', 10, 'manual', 1.0),
  ('계란', '알', 'EA', 1, 'manual', 1.0),

  -- 추가 채소류
  ('대파', '단', 'KG', 1, 'manual', 0.9),
  ('쪽파', '단', 'KG', 0.5, 'manual', 0.9),
  ('고추', '박스', 'KG', 5, 'manual', 0.9),
  ('방울토마토', '박스', 'KG', 5, 'manual', 0.9),

  -- 과일류
  ('사과', '박스', 'KG', 10, 'manual', 0.9),
  ('배', '박스', 'KG', 12, 'manual', 0.9),
  ('귤', '박스', 'KG', 10, 'manual', 0.9),

  -- 버섯류
  ('느타리버섯', '봉', 'KG', 1, 'manual', 0.9),
  ('팽이버섯', '봉', 'KG', 0.15, 'manual', 0.9),
  ('새송이버섯', '봉', 'KG', 1, 'manual', 0.9),

  -- 기타
  ('두부', '모', 'EA', 1, 'manual', 1.0),
  ('우유', '팩', 'ml', 200, 'manual', 1.0)
ON CONFLICT (category, from_unit, to_unit) DO NOTHING;

-- 코멘트
COMMENT ON TABLE unit_conversions IS '
단위 환산 규칙 테이블
- category가 NULL인 경우: 모든 품목에 적용되는 범용 규칙
- category가 지정된 경우: 해당 품목 카테고리에만 적용
- confidence: 신뢰도 (1.0 = 확실, 0.9 = 일반적, 0.8 = 추정)
';
