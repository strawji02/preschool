-- 048_search_vector_gim_split.sql
-- search_vector 확장: 김(海苔) 접미 분리 + 쌈무 접미 대칭 (mig047 후속)
--
-- 배경 (사용자 보고 2026-07-04):
--   검수 "짱구김(식탁용특大)" 검색 시 신세계 김류 후보 0개.
--   'simple' 토크나이저라 "재래김"·"전장김"·"짱구김"이 전부 통짜 lexeme →
--   "김" 토큰이 없어 검수·상품이 서로 매칭 불가 (세척당근·미니약과와 동일 계열).
--
-- 해결:
--   product_name의 어절 끝 "김"만 앞에 공백 삽입해 분해 토큰을 tsvector에 추가.
--     "재래김"   → 원본 + " 재래 김 "   → [재래김, 재래, 김]
--     "구운 김밥김" → " 구운 김밥 김 "
--   ① 어절 끝(비한글/문자열끝 앞)의 "김"만 → "김치/김밥/김말이"(뒤에 한글) 불변
--   ② "튀김"은 "튀 김"으로 분리됐다가 복원 → "감자튀김" 보존
--      (Postgres는 lookbehind 미지원 → "분리 후 복원" 방식. token-match.ts splitGim과 동일)
--   추가로 mig047에서 누락된 "쌈무" 접미도 이번에 대칭(비트쌈무 → 쌈무).
--   IMMUTABLE regexp_replace만 사용 → generated column 유지.
--
-- 영향: GENERATED column 전체 재산정(약 24,600 row) + GIN 재구축. 원본 토큰 유지라 회귀 없음.

ALTER TABLE products
  DROP COLUMN search_vector;

ALTER TABLE products
  ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(product_name, '') || ' ' || coalesce(spec_raw, '') || ' ' ||
      -- (바깥) "튀 김" 복원 → 감자튀김 보존
      regexp_replace(
        -- 김 접미 분리 (어절 끝 김만)
        regexp_replace(
          -- 접미 과자 품목어 + 쌈무 분리
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
            '([가-힣])(약과|강정|한과|전병|튀각|부각|쌈무)',
            '\1 \2', 'g'),
          '([가-힣])김([^가-힣]|$)',
          '\1 김\2', 'g'),
        '튀 김', '튀김', 'g')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_products_search_vector
  ON products USING gin(search_vector);

COMMENT ON COLUMN products.search_vector IS
  'product_name + spec_raw + 합성어 분해토큰 — 세척당근→당근, 미니약과→약과, 재래김→김, 비트쌈무→쌈무 (048)';
