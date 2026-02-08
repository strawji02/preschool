# 하이브리드 검색 구현 완료

## 📋 개요

BM25 (키워드 매칭) + Vector (시맨틱 유사도) 조합 하이브리드 검색을 구현했습니다.

**참고 문서**: `claudedocs/korean_search_production.md`

## 🎯 구현 내용

### 1. 새로운 SQL 함수

**파일**: `supabase/migrations/023_hybrid_bm25_vector.sql`

**함수명**: `search_products_hybrid_bm25_vector`

**알고리즘**: Reciprocal Rank Fusion (RRF)
- BM25 검색 결과 순위
- Vector 검색 결과 순위
- 두 순위의 역수를 가중치 합산

### 2. API 라우트 업데이트

**파일**: `src/app/api/products/search/route.ts`

**지원 모드**:
- `hybrid` (기본값, 권장): BM25 + Vector
- `semantic`: Vector만 (의미 기반)
- `bm25`: BM25만 (키워드 기반)
- `trigram`: Trigram만 (레거시)

## 🚀 사용 방법

### 환경 변수 설정

```bash
# .env.local
NEXT_PUBLIC_SEARCH_MODE=hybrid  # 기본값
```

### API 호출

```typescript
// 하이브리드 검색 (기본)
const response = await fetch('/api/products/search?q=당근&limit=10')

// 공급업체 필터링
const response = await fetch('/api/products/search?q=당근&supplier=CJ&limit=10')
```

### 직접 SQL 호출 (고급)

```sql
-- 기본 사용
SELECT * FROM search_products_hybrid_bm25_vector(
  '당근',                          -- 검색어
  '[0.1, 0.2, ...]'::vector(384), -- 임베딩 벡터
  10,                             -- 결과 개수
  NULL,                           -- 공급업체 필터 (CJ, SHINSEGAE, NULL)
  0.5,                            -- BM25 가중치
  0.5,                            -- Vector 가중치
  0.3                             -- 유사도 임계값
);

-- BM25 우선 (키워드 매칭 강조)
SELECT * FROM search_products_hybrid_bm25_vector(
  '당근', embedding, 10, NULL,
  0.7,  -- BM25 가중치 높임
  0.3,  -- Vector 가중치 낮춤
  0.3
);

-- Vector 우선 (의미 유사도 강조)
SELECT * FROM search_products_hybrid_bm25_vector(
  '당근', embedding, 10, NULL,
  0.3,  -- BM25 가중치 낮춤
  0.7,  -- Vector 가중치 높임
  0.3
);
```

## 📊 예상 효과

**문서 기준**: 15-30% 정확도 향상

**현재 → 개선 후**:
- 정확도: 60-70% → 75-85%
- 응답 속도: ~50ms → ~80ms (여전히 빠름)
- 재현율: 중간 → 높음

## 🔧 성능 튜닝

### HNSW 인덱스 설정

```sql
-- 쿼리 정확도 향상 (속도와 트레이드오프)
SET hnsw.ef_search = 100;  -- 기본값: 40, 범위: 1-1000
```

### 가중치 조정

```typescript
// API 호출 시 커스텀 가중치 (향후 지원 예정)
const response = await fetch('/api/products/search', {
  method: 'POST',
  body: JSON.stringify({
    query: '당근',
    bm25_weight: 0.6,
    vector_weight: 0.4,
  }),
})
```

## 🧪 테스트

### 기본 테스트

```bash
# API 테스트
curl "http://localhost:3000/api/products/search?q=당근&limit=5"

# 공급업체 필터 테스트
curl "http://localhost:3000/api/products/search?q=당근&supplier=CJ&limit=5"
```

### 비교 테스트

```bash
# Hybrid vs Semantic 비교 (테스트 스크립트 업데이트 필요)
npx tsx scripts/test-search-comparison.ts
```

## 📝 다음 단계

### Phase 2: PGroonga 통합 (한국어 형태소 분석)

**예상 기간**: 2-4주
**예상 효과**: 추가 20-40% 정확도 향상

**구현 방법**:
```sql
-- PGroonga 확장 활성화
CREATE EXTENSION pgroonga;

-- 인덱스 생성
CREATE INDEX idx_products_pgroonga
ON products
USING pgroonga (product_name pgroonga_text_full_text_search_ops_v2);
```

### Phase 3: Cross-Encoder Re-ranking

**예상 기간**: 4-8주
**예상 효과**: 추가 10-20% 정확도 향상

**구현 방법**: FastAPI/Express.js 서버 + rerankers 라이브러리

## 🎓 참고 자료

- **리서치 문서**: `claudedocs/korean_search_production.md`
- **Supabase Hybrid Search**: https://supabase.com/docs/guides/ai/hybrid-search
- **pgvector 문서**: https://github.com/pgvector/pgvector
- **RRF 알고리즘**: https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual

## ✅ 완료 체크리스트

- [x] BM25 + Vector 하이브리드 검색 함수 생성
- [x] API 라우트 업데이트 (hybrid 모드 지원)
- [x] 마이그레이션 적용 (023_hybrid_bm25_vector.sql)
- [x] 문서 작성
- [ ] 성능 벤치마크 측정
- [ ] A/B 테스트 설정
- [ ] Phase 2 준비 (PGroonga)

---

**구현일**: 2026-02-08
**담당**: Claude Code
**버전**: 1.0
