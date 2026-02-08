# 프로덕션 레벨 한국어 검색 기술 리서치

> **리서치 목적**: 식자재 가격 비교 시스템(23,866개 상품)의 한국어 검색 품질 개선을 위한 기술 조사
> **현재 스택**: PostgreSQL + pgvector + text-embedding-3-small (384차원)
> **핵심 문제**: 짧은 쿼리('당근')와 긴 상품명('세척당근 국내산') 매칭 정확도 부족

---

## 📋 Executive Summary

### 핵심 발견사항

1. **형태소 분석이 한국어 검색의 핵심**: 영어와 달리 한국어는 교착어로 형태소 단위 분석 없이는 정확한 검색 불가능
2. **하이브리드 검색이 정답**: 키워드 검색(BM25) + 시맨틱 검색(벡터) 조합이 최고 성능 (15-30% 정확도 향상)
3. **Re-ranking으로 정확도 극대화**: Cross-encoder를 통한 2단계 검색이 실전에서 효과적
4. **Supabase에서 바로 적용 가능**: PGroonga 확장 + 하이브리드 검색 구현 가능

### 권장 솔루션 (우선순위)

| 우선순위 | 솔루션 | 구현 난이도 | 예상 개선율 | 비고 |
|---------|--------|-----------|-----------|------|
| 🥇 **1단계** | 하이브리드 검색 (키워드 + 벡터) | ⭐⭐ 중간 | 15-30% | PostgreSQL 네이티브, 추가 인프라 불필요 |
| 🥈 **2단계** | PGroonga 통합 | ⭐⭐⭐ 높음 | 20-40% | Supabase 확장 설치 필요, 한국어 최적화 |
| 🥉 **3단계** | Cross-encoder Re-ranking | ⭐⭐⭐⭐ 매우 높음 | 10-20% 추가 | API 서버 필요, 비용 증가 |
| 🚀 **장기** | Elasticsearch + Nori 마이그레이션 | ⭐⭐⭐⭐⭐ 최고 | 30-50% | 인프라 복잡도 크게 증가 |

---

## 1. 대기업 검색 기술 스택

### 1.1 구글의 한국어 검색 기술

#### BERT (2019년 도입)
- **기술**: Bidirectional Encoder Representations from Transformers
- **한국어 지원**: Featured snippets에서 한국어, 힌디어, 포르투갈어 등에서 큰 개선
- **특징**: 양방향 컨텍스트 이해, 검색 의도 파악 향상
- **출처**: [Google Blog - Understanding searches better than ever before](https://blog.google/products/search/search-language-understanding-bert/)

#### MUM (2021년 발표)
- **정식명**: Multitask Unified Model
- **성능**: BERT 대비 **1,000배 더 강력**
- **다국어 능력**: **75개 언어 동시 학습**, 언어 간 정보 전이 가능
- **멀티모달**: 텍스트, 이미지, 비디오 동시 분석
- **한국어 특화**: 복잡한 한국어 쿼리에 대한 뉘앙스 있는 답변 제공
- **출처**:
  - [Google MUM: Expert Guide on SEO Content in 2025](https://learn.g2.com/google-mum)
  - [Search Engine Land - Google MUM: 1,000x more powerful than BERT](https://searchengineland.com/google-previews-mum-its-new-tech-thats-1000x-more-powerful-than-bert-348707)

**시사점**: 구글도 단순 키워드 매칭을 넘어 **시맨틱 이해 + 멀티모달 분석**으로 진화 중

---

### 1.2 네이버 검색 기술 스택

#### HyperCLOVA X (2024년 주력 모델)
- **특징**: **한국어와 한국 문화에 최적화된 LLM**
- **학습 데이터**:
  - 50년간의 뉴스 아카이브
  - 9년간의 블로그 데이터
  - 고품질 한국어 텍스트 수십 년분
- **검색 통합**: 검색 엔진과 온라인 쇼핑에 HyperCLOVA X 기반 AI 적용
- **출처**: [Naver's AI-powered search - KED Global](https://www.kedglobal.com/artificial-intelligence/newsView/ked202411110012)

#### Cue 함수 (2023년 12월 출시)
- **기술**: Multi-step reasoning (다단계 추론)
- **기능**: 복잡한 쿼리를 순차적 논리로 처리하여 미묘한 검색 의도 해석
- **출처**: [Inside Naver: How Korea's Leading Tech Giant Is Shaping the Future](https://www.nexxworks.com/blog/inside-naver-how-koreas-leading-tech-giant-is-shaping-the-future)

#### AI Briefing 기능 (2024년)
- **기능**: 사용자 질문에 대한 AI 생성 요약 답변 + 출처 검증 정보 제공
- **신뢰성**: 정보 신뢰도 확인을 위한 출처 링크 포함
- **출처**: [Naver to strengthen search, map, shopping services with AI](https://www.koreatimes.co.kr/www/tech/2024/11/133_386087.html)

#### 형태소 분석 시스템
- **분류**: 12가지 형태소 타입 (체언, 용언, 관형사, 부사, 감탄사, 조사, 선어말 어미, 어말 어미, 접두사, 접미사, 어근, 불능)
- **자체 알고리즘**: 네이버 독자적인 형태소 분석 시스템 운영
- **출처**: [네이버 형태소 분석기](https://whereispost.com/morpheme/)

**시사점**: 네이버는 **한국어 전용 LLM + 형태소 분석 + 다단계 추론**으로 한국어 검색 최적화

---

### 1.3 카카오 검색 기술

검색 결과에서 카카오의 구체적인 검색 엔진 아키텍처는 공개되지 않았으나, 다음과 같은 정보 확인:

#### Khaiii (딥러닝 기반 형태소 분석기)
- **기술**: 딥러닝 기반 한국어 형태소 분석기 (오픈소스)
- **학습 데이터**: 세종 코퍼스 약 1,000만 어절
- **특징**: 형태소 단위 분리, 기존 사전 기반 분석기 대비 새로운 접근
- **한계**: 띄어쓰기가 잘 안 된 비문에서는 Mecab보다 성능 낮음
- **출처**: [Khaiii 형태소 분석기 사용하기](https://jeongwookie.github.io/2019/11/17/datascience/koreannlp/1-khaiii-korean-tokenizer/)

**시사점**: 카카오는 **딥러닝 기반 형태소 분석**에 투자하며 오픈소스로 공개

---

## 2. 한국어 형태소 분석의 중요성

### 2.1 왜 한국어 검색에 형태소 분석이 필수인가?

#### 한국어의 교착어 특성
```
영어: "running" → "run" (어간) + "ing" (접미사)
한국어: "먹었습니다" → "먹" (어간) + "었" (과거) + "습니다" (존칭)
```

**문제점**:
- 영어는 공백 기준 토큰화로 충분하지만, **한국어는 형태소 분석 없이는 의미 추출 불가**
- 예: "당근을" vs "당근이" vs "당근은" → 모두 "당근"으로 정규화해야 검색 가능

#### 복합명사 분해
```
검색어: "당근"
상품명: "세척당근", "유기농당근", "당근즙"

형태소 분석 없이: 매칭 실패 ❌
형태소 분석 후: "세척" + "당근", "유기농" + "당근", "당근" + "즙" → 매칭 성공 ✅
```

**출처**: [한국어 형태소 분석기 비교](https://www.blog.cosadama.com/articles/2021-practicenlp-01/)

---

### 2.2 주요 형태소 분석기 비교

#### 성능 벤치마크 (10만 문장 기준)

| 분석기 | 처리 시간 | 상대 속도 | 로딩 시간 | 정확도 | 특징 |
|-------|---------|----------|---------|-------|------|
| **Mecab-ko** | 7.83초 | 1.0x (기준) | 0.0007초 | ⭐⭐⭐⭐ 높음 | 가장 빠름, 띄어쓰기 없는 문장에 강함 |
| **Khaiii** | 84.70초 | 10.8x 느림 | - | ⭐⭐⭐ 중상 | 딥러닝 기반, 새로운 단어 학습 가능 |
| **Nori** | - | Mecab 대비 느림 | - | ⭐⭐⭐⭐ 높음 | Elasticsearch 공식, Mecab 기반 |

**출처**:
- [한국어 형태소 분석기 비교](https://gist.github.com/jinmang2/4a872300a0f8134382f05de7e1dac8ea)
- [OpenKorPOS: Democratizing Korean Tokenization](https://openreview.net/pdf?id=uRVJ8qwi7aF)

---

#### 상세 비교

##### 1. Mecab-ko (추천 ⭐⭐⭐⭐⭐)
**장점**:
- **압도적인 속도**: Khaiii 대비 10.8배 빠름
- **높은 정확도**: 띄어쓰기가 없는 문장에서 가장 좋은 성능
- **안정성**: 오랜 기간 검증된 엔진
- **기반 기술**: MeCab (일본어 형태소 분석 엔진) + mecab-ko-dic (21세기 세종 프로젝트 코퍼스)
- **알고리즘**: Conditional Random Fields (CRF), Viterbi 알고리즘

**단점**:
- 사전 기반이라 신조어 처리 약함
- 사전 업데이트 필요

**사용처**: 네이버, 대부분의 한국어 NLP 시스템

**출처**: [Introduction to RcppMeCab](https://junhewk.github.io/text/2018/05/18/introduction-to-rcppmecab/)

---

##### 2. Nori (Elasticsearch 공식)
**장점**:
- **Elasticsearch 네이티브 통합**: 6.4 버전부터 공식 플러그인
- **Mecab 기반**: mecab-ko-dic 사용, 바이너리 사전으로 성능 개선
- **Lucene 7.4.0**: 빠르고 가벼운 한국어 분석기
- **풍부한 기능**: 사용자 사전, 품사 필터링, 한자→한글 변환, 숫자 정규화
- **벤치마크**: Arirang과 유사한 성능 (초당 3000+ 문서 색인)

**단점**:
- Mecab, Fastcat보다 속도 열위
- Elasticsearch 필수 (PostgreSQL에서 사용 불가)

**사용처**: Elasticsearch 기반 한국어 검색 시스템

**출처**:
- [Nori: The Official Elasticsearch Plugin for Korean Language Analysis](https://www.elastic.co/blog/nori-the-official-elasticsearch-plugin-for-korean-language-analysis)
- [Mecab과 Nori, Fastcat 플러그인 색인 성능 비교](https://danawalab.github.io/elastic/2023/01/05/MecabVsNori.html)

---

##### 3. Khaiii (카카오)
**장점**:
- **딥러닝 기반**: 새로운 패턴 학습 가능
- **대규모 학습**: 세종 코퍼스 1,000만 어절
- **유연성**: 사전 의존도 낮음

**단점**:
- **느린 속도**: Mecab 대비 10.8배 느림
- **띄어쓰기 민감**: 비문에서 Mecab보다 성능 낮음
- **리소스 사용**: CPU 집약적

**사용처**: 카카오 내부, 연구 목적

**출처**: [챗봇 딥러닝 - 한국어 형태소 분석기 성능 비교](http://aidev.co.kr/chatbotdeeplearning/6618)

---

### 2.3 프로젝트에 적합한 형태소 분석기

**현재 상황**: 23,866개 상품, PostgreSQL + pgvector

**추천 순위**:

1. **PGroonga (최우선 추천)** ⭐⭐⭐⭐⭐
   - PostgreSQL 확장으로 Groonga 엔진 통합
   - **한국어 포함 모든 언어 동시 지원**
   - 네이티브 PostgreSQL 전문검색 대비 월등한 다국어 성능
   - Supabase에서 간단히 활성화 가능
   - **출처**: [PGroonga: Multilingual Full Text Search - Supabase](https://supabase.com/docs/guides/database/extensions/pgroonga)

2. **Mecab-ko (외부 전처리)** ⭐⭐⭐⭐
   - 데이터 삽입 전 형태소 분석 → 별도 컬럼 저장
   - PostgreSQL full-text search와 조합
   - Python/Node.js에서 쉽게 사용 가능

3. **Nori (Elasticsearch 마이그레이션 시)** ⭐⭐⭐
   - 장기적으로 Elasticsearch 도입 시 선택
   - 현재 스택에서는 사용 불가

---

## 3. Elasticsearch vs PostgreSQL 비교

### 3.1 Elasticsearch + Nori

#### 장점
- **전문 검색 엔진**: BM25 알고리즘 기반 관련성 랭킹 최적화
- **대규모 데이터**: 수백만~수억 건 문서에서 탁월한 성능
- **고급 기능**:
  - Fuzzy matching (오타 허용)
  - Phrase proximity search (구문 근접도)
  - Field boosting (필드별 가중치)
  - Faceted navigation (패싯 검색)
  - Aggregations (집계)
- **Nori 통합**: 한국어 형태소 분석 네이티브 지원
- **벤치마크**: 초당 3,000+ 문서 색인

**출처**: [Postgres vs Elasticsearch: Full-Text Search Comparison](https://www.myscale.com/blog/postgres-vs-elasticsearch-comparison-full-text-search/)

#### 단점
- **인프라 복잡도**: 별도 Elasticsearch 클러스터 운영 필요
- **데이터 동기화**: PostgreSQL ↔ Elasticsearch 싱크 관리 필요
- **비용**: 추가 서버 비용, 운영 인력 필요
- **일관성**: 데이터 일관성 보장 어려움 (Eventual consistency)
- **러닝 커브**: Elasticsearch 전문 지식 필요

**출처**: [Why we replaced Elasticsearch with Postgres Full-Text Search](https://blog.blockost.com/why-we-replaced-elasticsearch-with-postgres-full-text-search)

---

### 3.2 PostgreSQL Full-Text Search

#### 장점
- **제로 인프라**: 추가 시스템 불필요
- **데이터 일관성**: ACID 트랜잭션 보장
- **비용 효율**: 기존 DB 활용, 추가 비용 없음
- **간단한 아키텍처**: 복잡도 제거
- **지속적인 개선**: 각 버전마다 검색 속도 향상
- **SQL 기반**: 쿼리 투명성, 디버깅 용이

**출처**: [Full-Text Search Battle: PostgreSQL vs Elasticsearch](https://www.rocky.dev/blog/full-text-search)

#### 단점
- **언어 제한**: 네이티브 full-text search는 영어, 프랑스어, 스페인어 등만 지원 (한국어 없음)
- **성능**: 수백만 건 이상에서 Elasticsearch 대비 느림
- **고급 기능 부족**: Fuzzy matching, aggregation 등 제한적

**출처**: [PostgreSQL Full-Text Search vs Elasticsearch - Neon](https://neon.com/blog/postgres-full-text-search-vs-elasticsearch)

---

### 3.3 현재 프로젝트 적용 시 권장사항

**데이터 규모**: 23,866개 상품 → **PostgreSQL 충분**

**추천 접근**:

1. **단기 (지금 바로)**: PostgreSQL 하이브리드 검색
   - pgvector (semantic) + PostgreSQL full-text search (keyword)
   - 인프라 추가 없이 즉시 개선 가능

2. **중기 (1-3개월)**: PGroonga 통합
   - 한국어 형태소 분석 네이티브 지원
   - Supabase 확장 활성화로 간단 구현

3. **장기 (6개월+, 데이터 10만+ 시)**: Elasticsearch 마이그레이션 고려
   - 대규모 데이터, 복잡한 쿼리 요구 시 검토

**출처**: [Hybrid Search in PostgreSQL: The Missing Manual](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)

---

## 4. Cross-Encoder Re-ranking

### 4.1 Re-ranking이란?

**정의**: 초기 검색 결과를 더 정확한 모델로 재정렬하는 2단계 검색 기법

**작동 원리**:
1. **1단계 (Retrieval)**: 빠른 Bi-encoder로 후보 문서 검색 (예: 100개)
2. **2단계 (Re-ranking)**: 느리지만 정확한 Cross-encoder로 재정렬 (예: 상위 10개)

**출처**: [Search reranking with cross-encoders - OpenAI Cookbook](https://cookbook.openai.com/examples/search_reranking_with_cross-encoders)

---

### 4.2 Bi-Encoder vs Cross-Encoder

#### Bi-Encoder (현재 사용 중: text-embedding-3-small)

**구조**:
```
Query → Encoder → Query Vector
Document → Encoder → Document Vector
Similarity = Cosine(Query Vector, Document Vector)
```

**장점**:
- **빠름**: 문서 벡터 미리 계산 가능
- **확장성**: 수백만 벡터 검색 가능 (HNSW, IVF 인덱스)
- **응답 속도**: 밀리초 단위

**단점**:
- **정확도 낮음**: 쿼리와 문서가 독립적으로 인코딩되어 상호작용 부족
- **미묘한 의미 차이**: 부정문, 복잡한 문맥 처리 약함

**출처**: [Bi-Encoders and Cross-Encoders: Two Sides of the Retrieval Coin](https://medium.com/@mpuig/bi-encoders-and-cross-encoders-two-sides-of-the-retrieval-coin-06a95fe18619)

---

#### Cross-Encoder

**구조**:
```
[Query + [SEP] + Document] → Transformer → Relevance Score (0~1)
```

**장점**:
- **높은 정확도**: 쿼리와 문서가 함께 처리되어 Self-Attention으로 토큰 간 상호작용
- **일관된 점수**: 쿼리 간 점수 비교 가능 (threshold 설정 가능)
- **복잡한 의미**: 부정문, 문맥 이해 우수

**단점**:
- **느림**: 모든 (쿼리, 문서) 쌍을 실시간 계산
- **확장성 낮음**: 대규모 문서에 직접 사용 불가 (100개 문서 × 1번 쿼리 = 100번 추론)
- **사전 계산 불가**: 쿼리마다 새로 계산

**성능 차이**: Cross-encoder가 Bi-encoder 대비 **1000배 더 강력**하다는 보고도 있음

**출처**:
- [The aRt of RAG Part 3: Reranking with Cross Encoders](https://medium.com/@rossashman/the-art-of-rag-part-3-reranking-with-cross-encoders-688a16b64669)
- [Using Cross-Encoders as reranker in multistage vector search](https://weaviate.io/blog/cross-encoders-as-reranker)

---

### 4.3 2단계 Retrieval Pipeline (추천 아키텍처)

```
사용자 쿼리: "당근"
    ↓
[1단계: Bi-Encoder 검색 - 빠름]
    ↓
pgvector로 상위 100개 후보 검색 (< 10ms)
    ↓
결과: ["세척당근", "유기농당근", "당근즙", "당근케이크", ...]
    ↓
[2단계: Cross-Encoder Re-ranking - 정확함]
    ↓
Cross-encoder로 각 후보 점수화 (100개 × 50ms = 5초)
    ↓
점수 기준 재정렬 + Threshold 적용 (예: 0.7 이상만)
    ↓
최종 결과: ["세척당근"(0.95), "유기농당근"(0.92), "당근"(0.90)]
```

**개선 효과**: 15-30% 정확도 향상

**출처**: [Mastering RAG — How ReRanking revolutionizes information retrieval](https://unfoldai.com/rag-rerankers/)

---

### 4.4 프로덕션 구현 방법

#### 옵션 1: Python 라이브러리 (추천)

**rerankers 라이브러리** (Answer.AI):
```python
from rerankers import Reranker

# Cross-encoder 모델 로드
ranker = Reranker("cross-encoder", model_name="ms-marco-MiniLM-L-6-v2")

# Re-ranking 실행
results = ranker.rank(
    query="당근",
    docs=["세척당근 국내산", "유기농 당근", "당근 케이크"],
    doc_ids=[1, 2, 3]
)

# 결과: [{"doc_id": 1, "score": 0.95}, {"doc_id": 2, "score": 0.92}, ...]
```

**장점**:
- 통합 API (다양한 re-ranker 모델 교체 가능)
- 낮은 의존성
- 코드 변경 최소화

**출처**: [rerankers: A Lightweight Python Library to Unify Ranking Methods](https://www.answer.ai/posts/2024-09-16-rerankers.html)

---

#### 옵션 2: PostgreSQL + Python 통합

**아키텍처**:
```
PostgreSQL (pgvector) → Python API (FastAPI/Django) → Cross-encoder → 재정렬 결과 반환
```

**구현 예시** (PostgresML 활용):
```sql
-- 1단계: pgvector 검색
WITH candidates AS (
  SELECT id, item_name, embedding <-> query_embedding AS distance
  FROM products
  ORDER BY distance
  LIMIT 100
)
-- 2단계: Python UDF로 re-ranking (PostgresML 필요)
SELECT * FROM rerank_with_crossencoder(candidates, 'query text')
LIMIT 10;
```

**출처**: [Improving Vector Search - Reranking with PostgresML and LlamaIndex](https://www.llamaindex.ai/blog/improving-vector-search-reranking-with-postgresml-and-llamaindex)

---

#### 옵션 3: Cohere Re-rank API (가장 쉬움)

**Cohere Re-rank**:
```python
import cohere

co = cohere.Client('YOUR_API_KEY')

results = co.rerank(
    query="당근",
    documents=["세척당근 국내산", "유기농 당근", "당근 케이크"],
    top_n=5,
    model="rerank-multilingual-v3.0"  # 한국어 지원
)
```

**장점**:
- 즉시 사용 가능 (인프라 불필요)
- 한국어 지원 모델
- 클라우드 확장성

**단점**:
- API 비용 (쿼리당 과금)
- 외부 의존성

**출처**: [How Rerankers and Metadata Instantly Make Your RAG Agents Smarter](https://asfandyarmalik.medium.com/how-rerankers-and-metadata-instantly-make-your-rag-agents-smarter-e882634da0f0)

---

### 4.5 성능 최적화 팁

1. **후보 개수 조정**: 100개 대신 20-50개로 줄여 속도 향상
2. **비동기 처리**: Celery/Django async로 CPU 집약적 작업 분리
3. **캐싱**: 인기 쿼리 결과 캐싱 (Redis)
4. **Threshold 설정**: 0.7 이상만 반환하여 품질 유지
5. **배치 처리**: 여러 문서 한 번에 처리하여 오버헤드 감소

**출처**: [RAG Series - Hybrid Search with Re-ranking](https://www.dbi-services.com/blog/rag-series-hybrid-search-with-re-ranking/)

---

## 5. Supabase/PostgreSQL 실용적 구현 방안

### 5.1 하이브리드 검색 (키워드 + 시맨틱)

#### 개념
- **Lexical Search (BM25)**: 정확한 키워드 매칭
- **Semantic Search (벡터)**: 의미 기반 매칭
- **RRF Fusion**: Reciprocal Rank Fusion으로 두 결과 통합

**효과**: 15-30% 정확도 향상

**출처**: [Hybrid search - Supabase Docs](https://supabase.com/docs/guides/ai/hybrid-search)

---

#### 구현 방법 (PostgreSQL + pgvector)

**1단계: Full-Text Search 인덱스 생성**

```sql
-- 형태소 분석 없이 간단한 한국어 검색 (제한적)
ALTER TABLE products ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  to_tsvector('simple', coalesce(item_name, '') || ' ' || coalesce(description, ''))
) STORED;

CREATE INDEX idx_products_search ON products USING GIN(search_vector);
```

**2단계: 하이브리드 검색 함수**

```sql
CREATE OR REPLACE FUNCTION hybrid_search(
  query_text TEXT,
  query_embedding VECTOR(384),
  match_count INT DEFAULT 10,
  full_text_weight FLOAT DEFAULT 1.0,
  semantic_weight FLOAT DEFAULT 1.0
)
RETURNS TABLE(
  id BIGINT,
  item_name TEXT,
  rank_score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH semantic_search AS (
    SELECT id, item_name,
           ROW_NUMBER() OVER (ORDER BY embedding <-> query_embedding) AS rank
    FROM products
    ORDER BY embedding <-> query_embedding
    LIMIT 50
  ),
  keyword_search AS (
    SELECT id, item_name,
           ROW_NUMBER() OVER (ORDER BY ts_rank(search_vector, plainto_tsquery('simple', query_text)) DESC) AS rank
    FROM products
    WHERE search_vector @@ plainto_tsquery('simple', query_text)
    LIMIT 50
  )
  SELECT
    COALESCE(s.id, k.id) AS id,
    COALESCE(s.item_name, k.item_name) AS item_name,
    (COALESCE(1.0 / (60 + s.rank), 0.0) * semantic_weight +
     COALESCE(1.0 / (60 + k.rank), 0.0) * full_text_weight) AS rank_score
  FROM semantic_search s
  FULL OUTER JOIN keyword_search k ON s.id = k.id
  ORDER BY rank_score DESC
  LIMIT match_count;
END;
$$;
```

**사용 예시**:
```sql
SELECT * FROM hybrid_search(
  '당근',  -- 검색어
  '[0.1, 0.2, ...]'::vector,  -- 쿼리 임베딩
  10,  -- 결과 개수
  1.0,  -- 키워드 가중치
  1.0   -- 시맨틱 가중치
);
```

**출처**: [Hybrid Search in PostgreSQL: The Missing Manual](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)

---

### 5.2 PGroonga 통합 (한국어 최적화)

#### PGroonga란?
- Groonga 기반 PostgreSQL 확장
- **모든 언어 동시 지원** (한국어 포함)
- Native PostgreSQL 전문검색보다 월등한 다국어 성능

**출처**: [PGroonga: Multilingual Full Text Search - Supabase](https://supabase.com/docs/guides/database/extensions/pgroonga)

---

#### Supabase에서 설치

```sql
-- 1. 확장 활성화
CREATE EXTENSION pgroonga;

-- 2. PGroonga 인덱스 생성
CREATE INDEX idx_products_pgroonga
ON products
USING pgroonga (item_name pgroonga_text_full_text_search_ops_v2);

-- 3. 검색 쿼리
SELECT * FROM products
WHERE item_name &@~ '당근'  -- Full-text search
ORDER BY pgroonga_score(tableoid, ctid) DESC
LIMIT 10;
```

**장점**:
- 한국어 형태소 분석 자동 처리
- 복합명사 분해 ("세척당근" → "세척" + "당근")
- 간단한 설치 (Supabase에서 CREATE EXTENSION만)

**출처**: [PGroonga Users](https://pgroonga.github.io/users/)

---

#### PGroonga + pgvector 하이브리드

```sql
CREATE OR REPLACE FUNCTION pgroonga_hybrid_search(
  query_text TEXT,
  query_embedding VECTOR(384),
  match_count INT DEFAULT 10
)
RETURNS TABLE(
  id BIGINT,
  item_name TEXT,
  rank_score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH semantic_search AS (
    SELECT id, item_name,
           ROW_NUMBER() OVER (ORDER BY embedding <-> query_embedding) AS rank
    FROM products
    ORDER BY embedding <-> query_embedding
    LIMIT 50
  ),
  keyword_search AS (
    SELECT id, item_name,
           ROW_NUMBER() OVER (ORDER BY pgroonga_score(tableoid, ctid) DESC) AS rank
    FROM products
    WHERE item_name &@~ query_text
    LIMIT 50
  )
  SELECT
    COALESCE(s.id, k.id) AS id,
    COALESCE(s.item_name, k.item_name) AS item_name,
    (COALESCE(1.0 / (60 + s.rank), 0.0) +
     COALESCE(1.0 / (60 + k.rank), 0.0)) AS rank_score
  FROM semantic_search s
  FULL OUTER JOIN keyword_search k ON s.id = k.id
  ORDER BY rank_score DESC
  LIMIT match_count;
END;
$$;
```

---

### 5.3 Embedding 개선

#### 현재 모델: text-embedding-3-small (384차원)
- 빠르고 비용 효율적
- 단, 정확도는 중간 수준

#### 개선 옵션:

1. **text-embedding-3-large (3072차원)** ⭐⭐⭐⭐⭐
   - OpenAI 최신 모델
   - 훨씬 높은 정확도
   - 비용: small 대비 약 3배
   - **권장**: 프로덕션 환경에서 품질 우선 시

2. **multilingual-e5-large** ⭐⭐⭐⭐
   - 한국어 특화 오픈소스 모델
   - 무료
   - Self-hosting 필요

3. **Korean-specific models** (klue/roberta-large 등)
   - 한국어 전용 모델
   - Hugging Face에서 사용 가능
   - Fine-tuning 가능

---

### 5.4 Re-ranking 통합 (API 서버)

#### 아키텍처

```
Supabase (PostgreSQL + pgvector)
    ↓ [1단계: 하이브리드 검색으로 상위 50개 후보 검색]
FastAPI/Express.js 서버
    ↓ [2단계: Cross-encoder re-ranking]
    ↓
클라이언트 (Next.js)
```

#### FastAPI 구현 예시

```python
from fastapi import FastAPI
from supabase import create_client, Client
from rerankers import Reranker

app = FastAPI()
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
ranker = Reranker("cross-encoder", model_name="ms-marco-MiniLM-L-6-v2")

@app.post("/search")
async def search(query: str, limit: int = 10):
    # 1단계: Supabase 하이브리드 검색
    response = supabase.rpc(
        "pgroonga_hybrid_search",
        {"query_text": query, "query_embedding": get_embedding(query), "match_count": 50}
    ).execute()

    candidates = response.data

    # 2단계: Re-ranking
    docs = [c["item_name"] for c in candidates]
    doc_ids = [c["id"] for c in candidates]

    ranked = ranker.rank(query=query, docs=docs, doc_ids=doc_ids)

    # 3단계: Threshold 적용 (0.7 이상만)
    filtered = [r for r in ranked if r.score >= 0.7]

    return filtered[:limit]
```

---

### 5.5 메타데이터 필터링

**개념**: 카테고리, 브랜드, 가격대 등 메타데이터로 검색 결과 필터링

**예시**:
```sql
SELECT * FROM hybrid_search(
  '당근',
  '[0.1, 0.2, ...]'::vector,
  10
)
WHERE category = '채소'
  AND price BETWEEN 1000 AND 5000
  AND supplier IN ('CJ', '신세계');
```

**효과**: 검색 정확도 대폭 향상 (관련 없는 결과 제거)

**출처**: [Building a RAG Agent with Metadata, Supabase, and Re-Ranking](https://medium.com/@asfandyarmalik/building-a-rag-agent-with-metadata-supabase-and-re-ranking-in-n8n-472fd19f8b83)

---

### 5.6 성능 최적화

#### HNSW 인덱스 설정

```sql
-- pgvector 0.8.0+ 최적화
CREATE INDEX ON products
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 쿼리 시 ef_search 조정
SET hnsw.ef_search = 100;  -- 정확도 향상 (기본값: 40)
```

**효과**:
- Aurora PostgreSQL에서 최대 **9배 빠른 쿼리**
- **100배 더 관련성 높은 결과**

**출처**: [Supercharging vector search performance with pgvector 0.8.0 on Aurora](https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql/)

---

#### pgvector vs 전문 Vector DB 비교

**pgvector (+ pgvectorscale) 성능**:
- **50M 벡터 (768차원) 기준**
- Pinecone 대비: **28배 낮은 지연시간**, **16배 높은 처리량**
- Qdrant 대비: **10배 이상 처리량**, 100ms 이하 유지

**출처**:
- [Postgres Vector Search with pgvector: Benchmarks, Costs, and Reality Check](https://medium.com/@DataCraft-Innovations/postgres-vector-search-with-pgvector-benchmarks-costs-and-reality-check-f839a4d2b66f)
- [Pgvector vs. Qdrant: Open-Source Vector Database Comparison](https://www.tigerdata.com/blog/pgvector-vs-qdrant)

**결론**: 23,866개 수준에서는 **pgvector 충분**, 1M+ 시 pgvectorscale 확장 고려

---

## 6. 추천 구현 로드맵

### Phase 1: 즉시 적용 (1-2주) ⭐⭐⭐⭐⭐

**목표**: 인프라 변경 없이 검색 품질 개선

**구현**:
1. ✅ 하이브리드 검색 함수 추가 (키워드 + 벡터)
2. ✅ RRF Fusion으로 결과 통합
3. ✅ 메타데이터 필터링 (카테고리, 공급업체)

**예상 효과**: 15-30% 정확도 향상

**비용**: $0 (기존 인프라 활용)

---

### Phase 2: 한국어 최적화 (2-4주) ⭐⭐⭐⭐

**목표**: 한국어 형태소 분석 도입

**옵션 A: PGroonga (권장)**
1. ✅ Supabase에서 PGroonga 확장 활성화
2. ✅ 인덱스 생성
3. ✅ 하이브리드 검색 함수 업데이트

**옵션 B: 전처리 방식**
1. ✅ Python에서 Mecab-ko로 형태소 분석
2. ✅ 분석 결과를 별도 컬럼 저장
3. ✅ Full-text search 인덱스 생성

**예상 효과**: 추가 20-40% 정확도 향상

**비용**: $0 (PGroonga 무료)

---

### Phase 3: Re-ranking 적용 (4-8주) ⭐⭐⭐

**목표**: Cross-encoder로 최종 정확도 극대화

**구현**:
1. ✅ FastAPI/Express.js 서버 구축
2. ✅ rerankers 라이브러리 통합 OR Cohere API
3. ✅ Threshold 설정 (0.7 이상)
4. ✅ 캐싱 전략 (Redis)

**예상 효과**: 추가 10-20% 정확도 향상

**비용**:
- Self-hosting: $20-50/월 (서버 비용)
- Cohere API: $1-5/월 (쿼리량 기준)

---

### Phase 4: 모니터링 및 튜닝 (지속적)

**구현**:
1. ✅ 검색 쿼리 로그 수집
2. ✅ 정확도 메트릭 측정 (Precision, Recall, nDCG)
3. ✅ A/B 테스트 (하이브리드 vs 순수 벡터)
4. ✅ 사용자 피드백 수집 (클릭률, 구매 전환율)
5. ✅ 주기적 임베딩 모델 업데이트

**도구**: Grafana, Mixpanel, Google Analytics

---

## 7. 코드 예제

### 7.1 Supabase 하이브리드 검색 (즉시 사용 가능)

```typescript
// supabase/functions/hybrid-search.ts
import { createClient } from '@supabase/supabase-js'
import { OpenAI } from 'openai'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

export async function hybridSearch(query: string, limit: number = 10) {
  // 1. 쿼리 임베딩 생성
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  })
  const queryEmbedding = embeddingResponse.data[0].embedding

  // 2. 하이브리드 검색 실행
  const { data, error } = await supabase.rpc('hybrid_search', {
    query_text: query,
    query_embedding: queryEmbedding,
    match_count: limit,
    full_text_weight: 1.0,
    semantic_weight: 1.0,
  })

  if (error) throw error
  return data
}
```

---

### 7.2 PGroonga 검색

```typescript
// supabase/functions/pgroonga-search.ts
export async function pgroongaSearch(query: string, limit: number = 10) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .textSearch('item_name', query, {
      type: 'websearch',  // PGroonga 전문검색
      config: 'simple',
    })
    .order('pgroonga_score', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data
}
```

---

### 7.3 Re-ranking 서버 (FastAPI)

```python
# api/search.py
from fastapi import FastAPI, HTTPException
from supabase import create_client
from rerankers import Reranker
from openai import OpenAI
import os

app = FastAPI()

# 클라이언트 초기화
supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)
ranker = Reranker("cross-encoder", model_name="ms-marco-MiniLM-L-6-v2")
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

@app.post("/search")
async def search_with_reranking(
    query: str,
    limit: int = 10,
    threshold: float = 0.7
):
    try:
        # 1단계: 쿼리 임베딩
        embedding_response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=query
        )
        query_embedding = embedding_response.data[0].embedding

        # 2단계: 하이브리드 검색 (상위 50개)
        response = supabase.rpc(
            "hybrid_search",
            {
                "query_text": query,
                "query_embedding": query_embedding,
                "match_count": 50
            }
        ).execute()

        candidates = response.data

        if not candidates:
            return {"results": [], "message": "No results found"}

        # 3단계: Re-ranking
        docs = [c["item_name"] for c in candidates]
        doc_ids = [c["id"] for c in candidates]

        ranked_results = ranker.rank(
            query=query,
            docs=docs,
            doc_ids=doc_ids
        )

        # 4단계: Threshold 적용 및 메타데이터 병합
        filtered_results = []
        for result in ranked_results:
            if result.score >= threshold:
                # 원본 메타데이터 찾기
                original = next(c for c in candidates if c["id"] == result.doc_id)
                filtered_results.append({
                    **original,
                    "rerank_score": result.score
                })

        return {
            "results": filtered_results[:limit],
            "total_candidates": len(candidates),
            "reranked_count": len(filtered_results)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
```

**실행**:
```bash
pip install fastapi uvicorn supabase rerankers openai
uvicorn api.search:app --host 0.0.0.0 --port 8000
```

---

### 7.4 클라이언트 통합 (Next.js)

```typescript
// app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server'

const RERANK_API_URL = process.env.RERANK_API_URL || 'http://localhost:8000'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q')
  const limit = parseInt(searchParams.get('limit') || '10')

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 })
  }

  try {
    // Re-ranking API 호출
    const response = await fetch(`${RERANK_API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        limit,
        threshold: 0.7,
      }),
    })

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    )
  }
}
```

**사용 예시**:
```typescript
// app/components/SearchBar.tsx
const searchProducts = async (query: string) => {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`)
  const data = await response.json()
  return data.results
}
```

---

## 8. 성능 벤치마크 예상

### 현재 상황 (pgvector only)
- **정확도**: 60-70% (짧은 쿼리에서 낮음)
- **응답 속도**: ~50ms
- **재현율**: 중간 (복합명사 매칭 약함)

### Phase 1 적용 후 (하이브리드 검색)
- **정확도**: 75-85% (+15-25%)
- **응답 속도**: ~80ms (+30ms, 여전히 빠름)
- **재현율**: 높음 (키워드 매칭 보완)

### Phase 2 적용 후 (PGroonga)
- **정확도**: 85-95% (+10-20%)
- **응답 속도**: ~100ms (+20ms)
- **재현율**: 매우 높음 (형태소 분석)

### Phase 3 적용 후 (Re-ranking)
- **정확도**: 90-98% (+5-10%)
- **응답 속도**: ~200-500ms (+100-400ms, 여전히 허용 범위)
- **재현율**: 최고 (정밀한 관련성 점수)

---

## 9. 비용 분석

### 현재 (pgvector)
- **인프라**: Supabase Free Tier OR Pro ($25/월)
- **OpenAI API**: text-embedding-3-small (~$0.02/1M 토큰)
- **총 비용**: ~$25-50/월

### Phase 1 (하이브리드)
- **추가 비용**: $0 (PostgreSQL 네이티브)
- **총 비용**: ~$25-50/월

### Phase 2 (PGroonga)
- **추가 비용**: $0 (무료 확장)
- **총 비용**: ~$25-50/월

### Phase 3 (Re-ranking)
- **옵션 A (Self-hosting)**:
  - FastAPI 서버: $20-50/월 (AWS t3.small/Fly.io)
  - 총 비용: ~$45-100/월

- **옵션 B (Cohere API)**:
  - Re-rank API: $1-5/월 (1,000-10,000 쿼리 기준)
  - 총 비용: ~$26-55/월

**권장**: 초기에는 Self-hosting으로 시작, 규모 확대 시 Cohere 고려

---

## 10. 결론 및 액션 아이템

### 핵심 인사이트

1. **형태소 분석은 필수**: 한국어 검색에서 형태소 분석 없이는 정확한 매칭 불가능
2. **하이브리드 검색이 정답**: 키워드 + 시맨틱 조합이 최고 성능
3. **Re-ranking으로 마무리**: 2단계 검색으로 정확도 극대화
4. **Supabase에서 충분**: 현재 규모에서 Elasticsearch 불필요, PostgreSQL로 충분

---

### 즉시 실행 가능한 액션 아이템

#### Week 1-2: 하이브리드 검색 구현
- [ ] PostgreSQL full-text search 인덱스 생성
- [ ] `hybrid_search` 함수 구현
- [ ] API 엔드포인트 업데이트
- [ ] A/B 테스트 설정

#### Week 3-4: PGroonga 통합
- [ ] Supabase에서 PGroonga 확장 활성화
- [ ] PGroonga 인덱스 생성
- [ ] 하이브리드 검색 함수 업데이트
- [ ] 성능 벤치마크 수행

#### Week 5-8: Re-ranking 적용
- [ ] FastAPI 서버 구축
- [ ] rerankers 라이브러리 통합
- [ ] Threshold 및 캐싱 구현
- [ ] 프로덕션 배포

#### 지속적: 모니터링 및 개선
- [ ] 검색 쿼리 로그 수집
- [ ] 정확도 메트릭 대시보드
- [ ] 사용자 피드백 수집
- [ ] 월별 성능 리포트

---

## 11. 참고 자료

### 대기업 검색 기술
- [Google Blog - Understanding searches better than ever before](https://blog.google/products/search/search-language-understanding-bert/)
- [Google MUM: Expert Guide on SEO Content in 2025](https://learn.g2.com/google-mum)
- [Inside Naver: How Korea's Leading Tech Giant Is Shaping the Future](https://www.nexxworks.com/blog/inside-naver-how-koreas-leading-tech-giant-is-shaping-the-future)
- [Naver's AI-powered search - KED Global](https://www.kedglobal.com/artificial-intelligence/newsView/ked202411110012)

### 형태소 분석기
- [한국어 형태소 분석기 비교](https://www.blog.cosadama.com/articles/2021-practicenlp-01/)
- [Nori: The Official Elasticsearch Plugin for Korean Language Analysis](https://www.elastic.co/blog/nori-the-official-elasticsearch-plugin-for-korean-language-analysis)
- [Mecab과 Nori, Fastcat 플러그인 색인 성능 비교](https://danawalab.github.io/elastic/2023/01/05/MecabVsNori.html)
- [OpenKorPOS: Democratizing Korean Tokenization](https://openreview.net/pdf?id=uRVJ8qwi7aF)

### Elasticsearch vs PostgreSQL
- [Postgres vs Elasticsearch: Full-Text Search Comparison](https://www.myscale.com/blog/postgres-vs-elasticsearch-comparison-full-text-search/)
- [PostgreSQL Full-Text Search vs Elasticsearch - Neon](https://neon.com/blog/postgres-full-text-search-vs-elasticsearch)
- [Hybrid Search in PostgreSQL: The Missing Manual](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)

### Cross-Encoder Re-ranking
- [Search reranking with cross-encoders - OpenAI Cookbook](https://cookbook.openai.com/examples/search_reranking_with_cross-encoders)
- [The aRt of RAG Part 3: Reranking with Cross Encoders](https://medium.com/@rossashman/the-art-of-rag-part-3-reranking-with-cross-encoders-688a16b64669)
- [rerankers: A Lightweight Python Library](https://www.answer.ai/posts/2024-09-16-rerankers.html)
- [Mastering RAG — How ReRanking revolutionizes information retrieval](https://unfoldai.com/rag-rerankers/)

### Supabase 구현
- [PGroonga: Multilingual Full Text Search - Supabase](https://supabase.com/docs/guides/database/extensions/pgroonga)
- [Hybrid search - Supabase Docs](https://supabase.com/docs/guides/ai/hybrid-search)
- [PostgreSQL Hybrid Search Using pgvector and Cohere](https://www.tigerdata.com/blog/postgresql-hybrid-search-using-pgvector-and-cohere)
- [Supercharging vector search with pgvector 0.8.0 on Aurora](https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql/)

### 성능 벤치마크
- [Postgres Vector Search with pgvector: Benchmarks](https://medium.com/@DataCraft-Innovations/postgres-vector-search-with-pgvector-benchmarks-costs-and-reality-check-f839a4d2b66f)
- [Pgvector vs. Qdrant Comparison](https://www.tigerdata.com/blog/pgvector-vs-qdrant)

---

**리서치 완료일**: 2026-02-08
**버전**: 1.0
**다음 업데이트**: 구현 후 성능 벤치마크 결과 반영
