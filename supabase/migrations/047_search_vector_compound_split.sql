-- 047_search_vector_compound_split.sql
-- search_vector 확장: 통짜 합성어를 분해한 토큰을 추가해 recall 근본 개선
--
-- 배경 (사용자 보고 2026-07-04):
--   'simple' 토크나이저는 형태소 분석을 안 해 "세척당근"·"미니꿀약과"가 통짜 lexeme.
--   → 검수 "당근"/"약과" 검색이 통짜 상품과 BM25 불일치 → 후보에서 완전 탈락.
--   예) "세척당근 국내산"(붙임)은 '당근' 토큰이 없어 "당근" 검색에 안 잡힘.
--       반면 "세척 당근 중국"(띄어쓰기)만 잡혀 국내산이 후보에서 누락.
--
-- 해결:
--   product_name의 가공/저장/크기 접두어와 과자 접미 품목어 앞뒤에 공백을 삽입한
--   분해 텍스트를 tsvector에 "추가"(원본도 유지 → 통짜 매칭도 그대로).
--     "세척당근"   → 원본 + " 세척 당근 "   → [세척당근, 세척, 당근]
--     "미니꿀약과"  → 원본 + " 미니 꿀 약과 " → [미니꿀약과, 미니, 꿀, 약과]
--     "냉동미니당근" → " 냉동 미니 당근 "(접두 2회 적용으로 연속 접두 분해)
--   IMMUTABLE regexp_replace만 사용 → generated column 유지 가능.
--
-- 영향:
--   - GENERATED column 재계산 — 전체 24,593 row 재산정 (수십초, 짧은 락 예상)
--   - GIN 인덱스 재구축 (DROP COLUMN으로 자동 삭제 → 재생성)
--   - 원본 토큰 유지라 기존 매칭은 안 깨짐 (토큰 추가만)

-- 1. generated column 재정의 (분해 토큰 추가)
ALTER TABLE products
  DROP COLUMN search_vector;

ALTER TABLE products
  ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(product_name, '') || ' ' || coalesce(spec_raw, '') || ' ' ||
      -- 접미 과자 품목어 분리 (미니꿀약과 → 미니꿀 약과)
      regexp_replace(
        -- 접두어 2회차 (냉동미니당근 → 냉동 미니 당근)
        regexp_replace(
          -- 접두어 1회차
          regexp_replace(
            coalesce(product_name, ''),
            '(냉동|냉장|실온|상온|세척|손질|미니|대용량|유기농|친환경|무항생제|절단|다짐|슬라이스|컷팅|커팅|볶은|데친|구운|삶은|다진|채썬|깍둑|국내산|수입산)([가-힣])',
            '\1 \2', 'g'),
          '(냉동|냉장|실온|상온|세척|손질|미니|대용량|유기농|친환경|무항생제|절단|다짐|슬라이스|컷팅|커팅|볶은|데친|구운|삶은|다진|채썬|깍둑|국내산|수입산)([가-힣])',
          '\1 \2', 'g'),
        '([가-힣])(약과|강정|한과|전병|튀각|부각)',
        '\1 \2', 'g')
    )
  ) STORED;

-- 2. GIN 인덱스 재생성 (DROP COLUMN으로 자동 삭제됨)
CREATE INDEX IF NOT EXISTS idx_products_search_vector
  ON products USING gin(search_vector);

COMMENT ON COLUMN products.search_vector IS
  'product_name + spec_raw + 합성어 분해토큰 통합 tsvector — 세척당근→당근, 미니꿀약과→약과 등 통짜 recall 복구 (047)';
