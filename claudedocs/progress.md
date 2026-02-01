# 식자재 단가 감사 시스템 - 진행 상황

> **최종 업데이트**: 2026-02-01
> **참조 문서**: [spec.md](./spec.md), [db-schema-plan.md](./db-schema-plan.md)

---

## 전체 진행률

```
Phase 1: DB 설계 & 시드     [██████████] 100% ✅
Phase 2: 매칭 & API         [░░░░░░░░░░]   0% ⏳
Phase 3: 감사 UI            [░░░░░░░░░░]   0% ⏳
```

---

## Phase 1: Upload & Extraction (DB Setup) ✅ 완료

### 목표
> DB Schema를 설계하고, CJ/신세계 단가표 데이터를 시드하여 Fuzzy Matching 기반 마련

### 완료된 작업

#### 1.1 Supabase 프로젝트 설정
| 항목 | 상태 | 세부 내용 |
|------|------|----------|
| 프로젝트 생성 | ✅ | `kihwrilnkaszuhhengvp` |
| 환경 변수 설정 | ✅ | `.env.local` (URL, anon key, service role) |
| CLI 연결 | ✅ | `supabase link` |

#### 1.2 데이터베이스 스키마 설계 & 마이그레이션
| 테이블 | 상태 | 용도 | 행 수 |
|--------|------|------|-------|
| `products` | ✅ | 마스터 상품 테이블 | 23,866 |
| `unit_mappings` | ✅ | 단위 정규화 매핑 | 23 |
| `audit_sessions` | ✅ | 감사 세션 | 0 (대기) |
| `audit_files` | ✅ | 업로드 파일 | 0 (대기) |
| `audit_items` | ✅ | 감사 항목 | 0 (대기) |

**PostgreSQL 확장**:
- `pg_trgm` ✅ - Fuzzy Matching (trigram 유사도)
- `uuid-ossp` ✅ - UUID 생성

**인덱스**:
- `idx_products_name_trgm` (GIN) - 상품명 Fuzzy 검색
- `idx_products_search` (GIN) - Full-text 검색
- `idx_products_supplier` - 공급사 필터링

#### 1.3 시드 스크립트 개발
| 파일 | 용도 |
|------|------|
| `scripts/seed.ts` | 메인 시드 스크립트 |
| `scripts/lib/excel-parser.ts` | 엑셀 파일 파싱 |
| `scripts/lib/unit-normalizer.ts` | 단위 정규화 (개→EA, kg→KG) |
| `scripts/lib/spec-parser.ts` | 규격 파싱 (20Kg/EA → quantity:20, unit:KG) |

#### 1.4 데이터 시드 결과
| 공급사 | 상품 수 | 규격 파싱 성공 | 파싱 실패 | 성공률 |
|--------|---------|---------------|----------|--------|
| **CJ** | 15,806 | 14,148 | 1,658 | 89.5% |
| **신세계** | 8,060 | 8,059 | 1 | 99.99% |
| **합계** | **23,866** | **22,207** | **1,659** | **93.0%** |

#### 1.5 Supabase 클라이언트 설정
| 파일 | 용도 |
|------|------|
| `src/lib/supabase/client.ts` | 브라우저 클라이언트 |
| `src/lib/supabase/server.ts` | 서버 컴포넌트 클라이언트 |
| `src/lib/supabase/admin.ts` | Service Role 클라이언트 (시드용) |

### 커밋 이력
```
c32cac8 feat: Phase 1 - Supabase DB setup and product data seeding
```

---

## Phase 2: Intelligent Matching & API ⏳ 대기

### 목표
> Fuzzy Matching 검색 API와 PDF 업로드/OCR 파이프라인 구축

### 예정 작업

#### 2.1 검색 API
- [ ] `GET /api/products/search` - Fuzzy 검색 API
  - Query params: `q` (검색어), `supplier` (필터), `limit`
  - pg_trgm의 `similarity()` 함수 활용
  - 상위 5개 후보 반환

#### 2.2 업로드 API
- [ ] `POST /api/upload` - PDF 업로드
  - Supabase Storage에 파일 저장
  - `audit_sessions` 레코드 생성
  - `audit_files` 레코드 생성

#### 2.3 OCR API
- [ ] `POST /api/ocr` - Gemini Vision API 연동
  - PDF → 이미지 변환
  - Gemini 2.5 Flash로 텍스트 추출
  - 품목명, 규격, 수량, 청구단가 파싱
  - `audit_items` 레코드 생성

#### 2.4 자동 매칭 로직
- [ ] 추출된 품목명으로 `products` 테이블 Fuzzy 검색
- [ ] similarity > 0.8 → `auto_matched`
- [ ] similarity 0.3~0.8 → `pending` (후보 제시)
- [ ] similarity < 0.3 → `unmatched`

---

## Phase 3: The Audit Interface ⏳ 대기

### 목표
> Split View UI로 PDF 뷰어 + 데이터 그리드 감사 화면 구축

### 예정 작업

#### 3.1 페이지 구조
- [ ] `/calc-food` 페이지 생성
- [ ] Split View 레이아웃 (좌: PDF, 우: 그리드)

#### 3.2 PDF 뷰어 (좌측 패널)
- [ ] PDF.js 또는 react-pdf 연동
- [ ] 페이지 네비게이션
- [ ] 줌 인/아웃

#### 3.3 데이터 그리드 (우측 패널)
- [ ] 감사 항목 테이블
- [ ] 손실 계산: `(청구단가 - 기준단가) × 수량`
- [ ] 손실 > 0 → 빨간색 하이라이트
- [ ] 매칭 상태 표시 (auto/pending/unmatched)

#### 3.4 수동 매칭 기능
- [ ] 상품 검색 모달
- [ ] 후보 상품 선택
- [ ] 매칭 확정/수정

#### 3.5 세션 관리
- [ ] 세션 목록 페이지
- [ ] 세션별 통계 (총 청구액, 기준액, 손실액)

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| **Framework** | Next.js 16 (App Router) |
| **Database** | Supabase (PostgreSQL) |
| **AI/OCR** | Google Gemini 2.5 Flash |
| **Styling** | Tailwind CSS v4 |
| **Language** | TypeScript |

---

## 파일 구조

```
preschool/
├── .env.local                    # 환경 변수 (Supabase)
├── src/
│   ├── app/
│   │   ├── calc-food/           # [Phase 3] 감사 페이지
│   │   └── api/
│   │       ├── products/        # [Phase 2] 검색 API
│   │       ├── upload/          # [Phase 2] 업로드 API
│   │       └── ocr/             # [Phase 2] OCR API
│   └── lib/
│       └── supabase/            # ✅ Supabase 클라이언트
├── scripts/
│   ├── seed.ts                  # ✅ 시드 스크립트
│   └── lib/                     # ✅ 파싱 유틸리티
├── supabase/
│   └── migrations/              # ✅ SQL 마이그레이션
└── claudedocs/
    ├── spec.md                  # PRD 원본
    ├── db-schema-plan.md        # DB 설계 문서
    └── progress.md              # 진행 상황 (이 문서)
```

---

## 다음 단계

1. **Phase 2 시작**: `/api/products/search` Fuzzy 검색 API 구현
2. **Gemini API 키 준비**: OCR 연동을 위한 API 키 필요
3. **Storage 버킷 생성**: PDF 업로드용 `invoice-pdfs` 버킷

---

## 이슈 & 메모

### 규격 파싱 실패 케이스 (1,659건)
- 대부분 CJ 데이터의 비표준 규격 표기
- 추후 파싱 로직 개선 또는 수동 보정 필요

### 단위 정규화 범위
- 현재 23개 단위 매핑 등록
- 새로운 단위 발견 시 `unit_mappings` 테이블에 추가 필요
