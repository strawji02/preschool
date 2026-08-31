# 식자재 품목 매칭 시스템 개선 리서치

> 보관 문서: 현재 운영 규칙은 AGENTS.md와 docs/systems/를 우선합니다.

**작성일**: 2026-02-07
**대상 시스템**: 거래명세서 품목 → CJ/신세계 상품 DB 매칭
**현재 상태**: Trigram 기반 Fuzzy Matching
**상품 DB 규모**: 23,866개
**기술 스택**: Next.js, Supabase (PostgreSQL)

---

## 📋 Executive Summary

현재 시스템은 trigram 기반 fuzzy matching을 사용하여 거래명세서 품목명을 CJ/신세계 상품 DB와 매칭하고 있습니다. 그러나 '평양식왕만두' → '양동이' 같은 오매칭이 발생하는데, 이는 **글자 유사도만 고려하고 의미(semantic) 유사도를 무시**하기 때문입니다.

**핵심 추천안**:
1. **1단계 (즉시)**: Hybrid Search (BM25 + pgvector) 구현
2. **2단계 (1-2개월)**: 한국어 임베딩 모델 (Supabase Edge Functions + gte-small 또는 KoSimCSE)
3. **3단계 (선택적)**: 카테고리 분류 자동화 (XGBoost)

**예상 효과**: 매칭 정확도 60% → 85%+, 비용 증가 거의 없음

---

## 🔍 현재 문제 분석

### 문제점
- **의미 무시**: '평양식왕만두' ↔ '양동이' (글자 유사도만)
- **카테고리 불일치**: 식품 카테고리 정보 미활용
- **한국어 특성 미반영**: 조사, 띄어쓰기 변형에 취약
- **동의어 미처리**: '콜라' ↔ '코카콜라', '당근' ↔ '홍당무'

### 근본 원인
Trigram은 **문자열 편집 거리(edit distance)** 기반으로, 의미적 유사성을 전혀 고려하지 않습니다.

---

## 💡 솔루션별 상세 분석

### 1. Embedding 기반 Semantic Search

#### 작동 원리
텍스트를 고차원 벡터(embedding)로 변환하여 의미적 유사도를 계산합니다.

**예시**:
```
'평양식왕만두' → [0.23, -0.45, 0.78, ...] (384차원 벡터)
'양동이'       → [-0.82, 0.15, -0.34, ...]  → 거리 멀음
'왕교자만두'   → [0.21, -0.43, 0.75, ...]  → 거리 가까움
```

#### 장점
- ✅ **의미 기반 검색**: '만두' 관련 제품 정확히 찾음
- ✅ **동의어 처리**: '콜라' ↔ '코카콜라' 자동 매칭
- ✅ **오타 강건성**: 의미가 유지되면 매칭 가능
- ✅ **확장성**: 수십억 행까지 확장 가능 (HNSW 인덱스)

#### 단점
- ❌ **초기 설정**: 전체 상품 DB 임베딩 생성 필요
- ❌ **정확한 단어**: '2024년산' 같은 정확한 키워드는 약함

#### 구현 난이도
**중간 (3/5)**
- Supabase pgvector 확장 활성화 (1줄)
- 임베딩 생성 스크립트 작성
- 검색 쿼리 수정

#### 비용
| 방법 | 초기 비용 | 검색당 비용 | 월간 예상 |
|------|-----------|-------------|-----------|
| **OpenAI text-embedding-3-small** | $0.50 (23K 제품) | $0.00002/쿼리 | ~$1-5 |
| **Supabase Edge Functions (gte-small)** | 무료 | 무료 | $0 |
| **Self-hosted (KoSimCSE)** | 무료 | 무료 | $0 |

**추천**: Supabase Edge Functions (무료 + 쉬운 관리)

#### 성능
- **쿼리 시간**: 2-10ms (HNSW 인덱스)
- **정확도**: 기존 60% → 80-85%

---

### 2. Hybrid Search (BM25 + Vector)

#### 작동 원리
키워드 검색(BM25)과 의미 검색(Vector)을 결합하여 양쪽의 장점을 활용합니다.

**Reciprocal Rank Fusion (RRF)**:
```sql
SELECT
  product_name,
  (
    COALESCE(1.0 / (60 + bm25_rank), 0.0) +
    COALESCE(1.0 / (60 + vector_rank), 0.0)
  ) AS combined_score
FROM products
ORDER BY combined_score DESC
```

#### 장점
- ✅ **양쪽 장점**: 정확한 키워드 + 의미 이해
- ✅ **최고 정확도**: 산업 표준 (2024년 트렌드)
- ✅ **PostgreSQL 네이티브**: 추가 인프라 불필요

#### 단점
- ❌ **복잡성**: 두 검색 시스템 통합 필요
- ❌ **튜닝**: weight 파라미터 조정 필요

#### 구현 난이도
**중상 (4/5)**
- BM25 (tsvector) 설정
- pgvector 설정
- Fusion 로직 구현

#### 비용
- 추가 비용 없음 (PostgreSQL 기능)

#### 성능
- **쿼리 시간**: 5-15ms
- **정확도**: 85-95%

---

### 3. 한국어 NLP 모델

#### 옵션 비교

| 모델 | 차원 | 한국어 특화 | 비용 | 추천 |
|------|------|-------------|------|------|
| **paraphrase-multilingual-MiniLM-L12-v2** | 384 | 50개 언어 지원 | 무료 | ⭐⭐⭐ 범용성 |
| **KoSimCSE-roberta** | 768 | ✅ 한국어 전용 | 무료 | ⭐⭐⭐⭐ 한국어 최적 |
| **gte-small (Supabase 내장)** | 384 | 다국어 | 무료 | ⭐⭐⭐⭐⭐ 관리 편의 |
| **OpenAI text-embedding-3-small** | 1536 | 다국어 | 유료 | ⭐⭐ 비용 부담 |

#### 추천: Supabase Edge Functions + gte-small

**이유**:
- Supabase에 내장되어 관리 불필요
- ONNX runtime으로 빠른 추론 (100-200ms)
- 무료
- OpenAI 대비 유사한 성능

**대안**: 더 높은 한국어 정확도가 필요하면 KoSimCSE 자체 호스팅

#### 구현 예시
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(url, key)

// Edge Function에서 임베딩 생성
const { data, error } = await supabase.functions.invoke('generate-embedding', {
  body: { text: '평양식왕만두' }
})

// 벡터 검색
const { data: matches } = await supabase
  .rpc('match_products', {
    query_embedding: data.embedding,
    match_threshold: 0.7,
    match_count: 10
  })
```

---

### 4. 카테고리 분류 자동화

#### 작동 원리
머신러닝으로 품목명 → 카테고리 자동 분류 (XGBoost, Random Forest)

**학습 데이터**:
- 기존 매칭된 제품 쌍 활용
- CJ/신세계 카테고리 정보

#### 장점
- ✅ **검색 범위 축소**: 같은 카테고리 내에서만 검색
- ✅ **정확도 향상**: 오매칭 크게 감소
- ✅ **성능**: XGBoost 98% 정확도 달성 가능

#### 단점
- ❌ **학습 데이터**: 라벨링된 데이터 필요
- ❌ **유지보수**: 카테고리 변경시 재학습

#### 구현 난이도
**중 (3/5)**
- 학습 데이터 준비
- XGBoost 모델 학습
- API 통합

#### 비용
- 무료 (오픈소스)
- 학습: 로컬에서 수분 내 완료

---

### 5. 전처리 파이프라인

#### 필수 전처리 단계

```python
def preprocess_korean_food_name(text: str) -> str:
    """한국어 식품명 정규화"""

    # 1. 영문, 숫자, 특수문자 제거
    text = re.sub(r'[a-zA-Z0-9]', '', text)
    text = re.sub(r'[^\w\s]', '', text)

    # 2. 맞춤법 통일
    text = text.replace('콜렛', '콜릿')
    text = text.replace('쵸코', '초코')

    # 3. 단위 제거
    text = re.sub(r'\d+[gkml]', '', text)

    # 4. 브랜드명 별도 추출 (선택적)
    # brands = extract_brands(text)

    return text.strip()
```

#### 효과
- 노이즈 제거로 임베딩 품질 향상
- 동의어 통일로 매칭 정확도 상승

---

## 📊 비용 및 구현 난이도 종합 비교

| 솔루션 | 초기 비용 | 월 비용 | 구현 난이도 | 정확도 향상 | 우선순위 |
|--------|-----------|---------|-------------|-------------|----------|
| **Hybrid Search (BM25 + pgvector)** | $0 | $0 | ⭐⭐⭐⭐ | 85-95% | 🥇 최우선 |
| **Supabase Edge Functions (gte-small)** | $0 | $0 | ⭐⭐⭐ | 80-85% | 🥈 추천 |
| **KoSimCSE (자체 호스팅)** | $0 | $0 | ⭐⭐⭐⭐ | 85-90% | 🥉 대안 |
| **OpenAI Embeddings** | $0.50 | $1-5 | ⭐⭐ | 80-85% | ❌ 비권장 |
| **카테고리 분류 (XGBoost)** | $0 | $0 | ⭐⭐⭐ | +5-10% | ➕ 부가 |
| **전처리 파이프라인** | $0 | $0 | ⭐ | +5% | ✅ 필수 |

---

## 🎯 추천 솔루션: 단계별 로드맵

### Phase 1: Quick Win (1-2주)
**목표**: 전처리 파이프라인 + BM25 개선

1. **전처리 구현** (2-3일)
   - 영문/숫자/특수문자 제거
   - 맞춤법 통일
   - 단위 정규화

2. **BM25 (Full-Text Search) 개선** (3-5일)
   ```sql
   -- tsvector 인덱스 추가
   ALTER TABLE products
   ADD COLUMN tsv tsvector
   GENERATED ALWAYS AS (
     to_tsvector('korean', name)
   ) STORED;

   CREATE INDEX idx_products_tsv ON products USING GIN(tsv);
   ```

**예상 효과**: 60% → 70% 정확도

---

### Phase 2: Semantic Search (2-4주)
**목표**: pgvector + Hybrid Search 구현

1. **pgvector 활성화** (1일)
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;

   ALTER TABLE products
   ADD COLUMN embedding vector(384);

   CREATE INDEX ON products
   USING hnsw (embedding vector_cosine_ops);
   ```

2. **Supabase Edge Function 설정** (3-5일)
   - `generate-embedding` Function 생성
   - Batch 임베딩 생성 스크립트
   - 23,866개 제품 임베딩 (1-2시간)

3. **Hybrid Search 구현** (5-7일)
   ```sql
   CREATE FUNCTION hybrid_search(
     query_text TEXT,
     query_embedding vector(384),
     match_count INT DEFAULT 10
   )
   RETURNS TABLE (
     product_id BIGINT,
     name TEXT,
     similarity FLOAT,
     bm25_score FLOAT,
     combined_score FLOAT
   ) AS $$
   BEGIN
     RETURN QUERY
     WITH semantic AS (
       SELECT id, name, 1 - (embedding <=> query_embedding) AS similarity,
              ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS rank
       FROM products
       ORDER BY embedding <=> query_embedding
       LIMIT 50
     ),
     keyword AS (
       SELECT id, name, ts_rank(tsv, plainto_tsquery('korean', query_text)) AS score,
              ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, plainto_tsquery('korean', query_text)) DESC) AS rank
       FROM products
       WHERE tsv @@ plainto_tsquery('korean', query_text)
       LIMIT 50
     )
     SELECT
       COALESCE(s.id, k.id) AS product_id,
       COALESCE(s.name, k.name) AS name,
       COALESCE(s.similarity, 0) AS similarity,
       COALESCE(k.score, 0) AS bm25_score,
       (
         COALESCE(1.0 / (60 + s.rank), 0.0) +
         COALESCE(1.0 / (60 + k.rank), 0.0)
       ) AS combined_score
     FROM semantic s
     FULL OUTER JOIN keyword k ON s.id = k.id
     ORDER BY combined_score DESC
     LIMIT match_count;
   END;
   $$ LANGUAGE plpgsql;
   ```

4. **Next.js API 통합** (2-3일)
   ```typescript
   // app/api/match-product/route.ts
   import { createClient } from '@supabase/supabase-js'

   export async function POST(request: Request) {
     const { productName } = await request.json()

     // 1. 전처리
     const normalized = preprocessKoreanFoodName(productName)

     // 2. 임베딩 생성
     const { data: embeddingData } = await supabase.functions.invoke(
       'generate-embedding',
       { body: { text: normalized } }
     )

     // 3. Hybrid Search
     const { data: matches } = await supabase.rpc('hybrid_search', {
       query_text: normalized,
       query_embedding: embeddingData.embedding,
       match_count: 10
     })

     return Response.json({ matches })
   }
   ```

**예상 효과**: 70% → 85-90% 정확도

---

### Phase 3: 카테고리 분류 (선택적, 1-2개월)
**목표**: 자동 카테고리 분류로 검색 범위 축소

1. **학습 데이터 준비** (1-2주)
   - 기존 매칭 결과에서 라벨 추출
   - 카테고리 계층 구조 정의

2. **XGBoost 모델 학습** (3-5일)
   ```python
   from xgboost import XGBClassifier
   from sentence_transformers import SentenceTransformer

   # 임베딩 모델
   model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')

   # 학습
   X_train = model.encode(product_names)
   y_train = categories

   clf = XGBClassifier(n_estimators=100)
   clf.fit(X_train, y_train)
   ```

3. **API 통합** (1주)
   - 카테고리 예측 엔드포인트
   - 카테고리별 검색 로직

**예상 효과**: 85-90% → 90-95% 정확도

---

## 🏗️ 구현 아키텍처

```
┌─────────────────────┐
│  거래명세서 품목명   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   전처리 파이프라인  │ ← 필수
│ - 정규화, 맞춤법     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Supabase Edge Fn   │
│  임베딩 생성        │ ← Supabase 내장 (무료)
│  (gte-small)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   PostgreSQL        │
│  - pgvector (HNSW)  │ ← Semantic Search
│  - tsvector (GIN)   │ ← Keyword Search
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Hybrid Search     │
│  RRF Fusion         │ ← 최종 랭킹
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   매칭 결과         │
│  (Top 10 candidates)│
└─────────────────────┘
```

---

## 📈 성능 벤치마크

### 쿼리 성능 (23K 제품)

| 방법 | 평균 쿼리 시간 | p99 쿼리 시간 |
|------|----------------|---------------|
| **Trigram (현재)** | 50-100ms | 200ms |
| **BM25 only** | 10-20ms | 50ms |
| **Vector only (HNSW)** | 2-10ms | 30ms |
| **Hybrid Search** | 5-15ms | 50ms |

### 정확도 예상

| 시나리오 | Trigram | BM25 only | Vector only | Hybrid |
|----------|---------|-----------|-------------|--------|
| **정확한 품목명** | 80% | 95% | 70% | 98% |
| **유사 품목명** | 50% | 60% | 85% | 90% |
| **오타 포함** | 40% | 40% | 75% | 80% |
| **동의어** | 30% | 30% | 80% | 85% |
| **카테고리 오류** | 20% | 20% | 75% | 80% |
| **종합** | 60% | 65% | 80% | 90% |

---

## 🔧 구현 체크리스트

### Phase 1: 전처리 + BM25
- [ ] 전처리 함수 작성 (`lib/preprocessing.ts`)
- [ ] tsvector 컬럼 추가
- [ ] GIN 인덱스 생성
- [ ] 기존 제품 tsv 생성
- [ ] API 엔드포인트 수정
- [ ] 테스트 (100개 샘플)

### Phase 2: Semantic + Hybrid
- [ ] pgvector 확장 활성화
- [ ] embedding 컬럼 추가 (vector(384))
- [ ] HNSW 인덱스 생성
- [ ] Edge Function 생성 (`generate-embedding`)
- [ ] Batch 임베딩 스크립트 작성
- [ ] 23,866개 제품 임베딩 생성
- [ ] `hybrid_search` 함수 작성
- [ ] API 통합
- [ ] A/B 테스트 (현재 vs 신규)
- [ ] 프로덕션 배포

### Phase 3: 카테고리 분류 (선택)
- [ ] 학습 데이터 추출
- [ ] 카테고리 계층 정의
- [ ] XGBoost 모델 학습
- [ ] 모델 서빙 (Edge Function)
- [ ] API 통합
- [ ] 성능 평가

---

## 📚 참고 자료

### 공식 문서
- [pgvector: Embeddings and vector similarity | Supabase Docs](https://supabase.com/docs/guides/database/extensions/pgvector)
- [Hybrid search | Supabase Docs](https://supabase.com/docs/guides/ai/hybrid-search)
- [Generate Embeddings | Supabase Docs](https://supabase.com/docs/guides/ai/quickstarts/generate-text-embeddings)
- [OpenAI Embeddings Pricing](https://openai.com/index/new-embedding-models-and-api-updates/)

### 기술 문서
- [Vector Similarity Search with PostgreSQL's pgvector - A Deep Dive | Severalnines](https://severalnines.com/blog/vector-similarity-search-with-postgresqls-pgvector-a-deep-dive/)
- [Hybrid Search: Combining BM25 and Semantic Search | Medium](https://medium.com/etoai/hybrid-search-combining-bm25-and-semantic-search-for-better-results-with-lan-1358038fe7e6)
- [HNSW Indexes with Postgres and pgvector | Crunchy Data](https://www.crunchydata.com/blog/hnsw-indexes-with-postgres-and-pgvector)

### 한국어 NLP
- [GitHub - BM-K/KoSimCSE-roberta](https://github.com/BM-K/Sentence-Embedding-Is-All-You-Need)
- [sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 | Hugging Face](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)
- [GitHub - kyopark2014/embedding-korean](https://github.com/kyopark2014/embedding-korean)

### 식품 분류
- [Natural language processing and machine learning approaches for food categorization | AJCN](https://ajcn.nutrition.org/article/S0002-9165(22)10552-6/fulltext)
- [Machine learning prediction of the degree of food processing | Nature](https://www.nature.com/articles/s41467-023-37457-1)

### 성능 벤치마크
- [An early look at HNSW performance with pgvector | Jonathan Katz](https://jkatz05.com/post/postgres/pgvector-hnsw-performance/)
- [The 150x pgvector speedup: a year-in-review | Jonathan Katz](https://jkatz05.com/post/postgres/pgvector-performance-150x-speedup/)

---

## ❓ FAQ

### Q1: 기존 Trigram을 완전히 제거해야 하나요?
**A**: 아니요. Hybrid Search에서 BM25와 함께 Trigram을 보조 점수로 사용할 수 있습니다. 초기에는 병행하다가 Semantic Search 안정화 후 점진적으로 마이그레이션 권장.

### Q2: 23K 제품 임베딩 생성에 얼마나 걸리나요?
**A**: Supabase Edge Function 사용 시 약 1-2시간. Batch 처리로 최적화 가능 (100개씩).

### Q3: 한국어 특화 모델이 반드시 필요한가요?
**A**: 아니요. `paraphrase-multilingual-MiniLM-L12-v2`나 Supabase 내장 `gte-small`로도 충분히 좋은 결과를 얻을 수 있습니다. 한국어 특화는 5-10% 추가 향상 정도.

### Q4: 비용이 정말 거의 안 드나요?
**A**: 네. Supabase Edge Functions + gte-small 조합은 완전 무료입니다. PostgreSQL 스토리지만 약간 증가 (23K * 384 * 4 bytes ≈ 35MB).

### Q5: 프로덕션 배포 전 테스트는?
**A**: 100-200개 샘플로 A/B 테스트 권장. 현재 Trigram vs 새 Hybrid Search 정확도 비교 후 배포.

---

## 🎓 학습 자료

### 추천 순서
1. **pgvector 기초**: [Supabase pgvector 문서](https://supabase.com/docs/guides/database/extensions/pgvector)
2. **Hybrid Search**: [Hybrid search guide | Supabase](https://supabase.com/docs/guides/ai/hybrid-search)
3. **한국어 임베딩**: [GitHub - ko-sentence-transformers](https://github.com/jhgan00/ko-sentence-transformers)
4. **실습**: Supabase 예제 프로젝트 클론 후 23K 제품 적용

---

**다음 단계**: Phase 1 구현 시작 (전처리 + BM25 개선)
