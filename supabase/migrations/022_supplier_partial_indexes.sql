-- Supplier별 Partial Index 생성
-- 문제: HNSW가 WHERE supplier 조건을 무시하고 전체에서 탐색
-- 해결: 각 supplier별로 별도의 partial index 생성

-- 기존 인덱스 삭제 (전체용)
DROP INDEX IF EXISTS products_embedding_idx;

-- CJ 전용 HNSW 인덱스
CREATE INDEX products_embedding_cj_idx
ON products
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE supplier = 'CJ';

-- SHINSEGAE 전용 HNSW 인덱스
CREATE INDEX products_embedding_ssg_idx
ON products
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE supplier = 'SHINSEGAE';

-- 전체 검색용 인덱스도 유지 (supplier_filter NULL일 때)
CREATE INDEX products_embedding_all_idx
ON products
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX products_embedding_cj_idx IS 'HNSW partial index for CJ products only';
COMMENT ON INDEX products_embedding_ssg_idx IS 'HNSW partial index for SHINSEGAE products only';
COMMENT ON INDEX products_embedding_all_idx IS 'HNSW index for all products (when no supplier filter)';
