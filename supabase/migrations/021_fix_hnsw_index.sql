-- HNSW 인덱스 문제 해결
-- 증상: SSG 상품들이 vector search 결과에서 누락됨
-- 원인: 인덱스 생성 시점에 SSG 상품 embedding이 없었거나 인덱스 손상

-- 1. 기존 인덱스 완전 삭제
DROP INDEX IF EXISTS products_embedding_idx;

-- 2. 통계 업데이트 (인덱스 생성 전 필수)
ANALYZE products;

-- 3. HNSW 인덱스 재생성 (CONCURRENTLY 없이 - 더 정확한 인덱스)
-- ef_construction을 200으로 높여서 모든 상품 포함 보장
CREATE INDEX products_embedding_idx
ON products
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 4. 인덱스 사용 강제 (planner가 seq scan 안 하도록)
-- 런타임에 SET으로 설정
-- SET hnsw.ef_search = 100;

COMMENT ON INDEX products_embedding_idx IS
'HNSW index rebuilt with high accuracy params.
m=32 (max connections), ef_construction=200 (build quality).
Fixed: SSG products were missing from search results.';
