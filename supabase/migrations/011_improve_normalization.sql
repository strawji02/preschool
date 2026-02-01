-- 정규화 로직 개선: 숫자+단위 패턴 제거
--
-- 문제: "바라깻잎 1kg국산" 처럼 규격이 남아서 엉뚱한 매칭 발생
-- 해결: 숫자+단위 패턴 완전 제거하여 순수 품목명만 남김

-- 1. 기존 데이터 재정규화
-- 규칙: 괄호 제거 → 숫자+단위 제거 → 숫자 제거 → 특수문자 제거
UPDATE products SET product_name_normalized =
  TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(product_name, '\[[^\]]*\]', '', 'g'),  -- [대괄호] 제거
            '\([^)]*\)', '', 'g'                                   -- (괄호) 제거
          ),
          '\d+(\.\d+)?\s*(kg|g|ml|l|ea|개|팩|봉|box)', '', 'gi'   -- 숫자+단위 제거
        ),
        '\d+', '', 'g'                                             -- 남은 숫자 제거
      ),
      '[^가-힣a-zA-Z\s]', '', 'g'                                  -- 특수문자 제거 (한글,영문만)
    )
  );

-- 2. 빈 문자열 처리 (혹시 정규화 후 빈 값이 되면 원본 사용)
UPDATE products
SET product_name_normalized = product_name
WHERE product_name_normalized = '' OR product_name_normalized IS NULL;
