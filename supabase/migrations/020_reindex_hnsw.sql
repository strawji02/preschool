-- HNSW 인덱스 재생성
-- 문제: SSG 국내산 깻잎 상품들이 vector search에서 누락됨
-- 원인: HNSW approximate search가 일부 상품 누락

-- 1. 기존 인덱스 삭제
DROP INDEX IF EXISTS products_embedding_idx;

-- 2. HNSW 인덱스 재생성 (더 높은 정확도)
-- m=24 (기존 16): 더 많은 연결로 정확도 향상
-- ef_construction=100 (기존 64): 더 정확한 인덱스 구축
CREATE INDEX products_embedding_idx
ON products
USING hnsw (embedding vector_cosine_ops)
WITH (m = 24, ef_construction = 100);

COMMENT ON INDEX products_embedding_idx IS
'HNSW index for vector similarity search.
Rebuilt with higher accuracy parameters (m=24, ef_construction=100).
Previous m=16, ef_construction=64 was missing some products.';
