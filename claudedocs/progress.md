# 식자재 단가 감사 시스템 - 진행 상황

> **최종 업데이트**: 2026-02-01
> **참조 문서**: [spec.md](./spec.md), [db-schema-plan.md](./db-schema-plan.md)

---

## 전체 진행률

```
Phase 1: DB 설계 & 시드     [██████████] 100% ✅
Phase 2: 매칭 & API         [██████████] 100% ✅
Phase 3: 감사 UI            [██████████] 100% ✅
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

## Phase 2: Intelligent Matching & API ✅ 완료

### 목표
> Fuzzy Matching 검색 API와 PDF 업로드/OCR 파이프라인 구축

### 완료된 작업

#### 2.1 타입 정의
| 파일 | 용도 |
|------|------|
| `src/types/audit.ts` | 감사 관련 TypeScript 타입 정의 |

#### 2.2 API 엔드포인트
| 엔드포인트 | 상태 | 용도 |
|------------|------|------|
| `POST /api/session/init` | ✅ | 감사 세션 생성 |
| `GET /api/products/search` | ✅ | Fuzzy 검색 API (pg_trgm) |
| `POST /api/analyze/page` | ✅ | 페이지 분석 (OCR + 매칭) |

#### 2.3 핵심 라이브러리
| 파일 | 용도 |
|------|------|
| `src/lib/gemini.ts` | Google Gemini Vision OCR 래퍼 |
| `src/lib/matching.ts` | Fuzzy Matching 로직 |

#### 2.4 RPC 함수
| 함수 | 용도 |
|------|------|
| `fuzzy_search_products` | pg_trgm 기반 상품 검색 |
| `search_products` | 전체 공급사 대상 검색 |

### 커밋 이력
```
193284c feat: Phase 2 - OCR extraction and dual search matching API
```

---

## Phase 3: The Audit Interface ✅ 완료

### 목표
> Split View UI로 PDF 뷰어 + 데이터 그리드 감사 화면 구축

### 완료된 작업

#### 3.1 신규 의존성
| 패키지 | 용도 |
|--------|------|
| `pdfjs-dist` | PDF → 이미지 변환 |
| `lucide-react` | 아이콘 라이브러리 |
| `clsx` + `tailwind-merge` | 조건부 스타일링 |

#### 3.2 유틸리티 함수
| 파일 | 용도 |
|------|------|
| `src/lib/cn.ts` | clsx + tailwind-merge 래퍼 |
| `src/lib/format.ts` | 통화 포맷 (formatCurrency) |
| `src/lib/pdf-processor.ts` | PDF 페이지 추출 |

#### 3.3 페이지 및 훅
| 파일 | 용도 |
|------|------|
| `src/app/calc-food/page.tsx` | 메인 감사 페이지 |
| `src/app/calc-food/hooks/useAuditSession.ts` | 상태 관리 (useReducer) |

#### 3.4 컴포넌트
| 컴포넌트 | 용도 |
|----------|------|
| `UploadZone.tsx` | Drag & Drop PDF 업로드 |
| `ProcessingView.tsx` | 분석 진행 표시 |
| `AnalysisDashboard.tsx` | Split View 컨테이너 |
| `InvoiceViewer.tsx` | 좌측: 이미지 뷰어 (줌, 회전, 드래그) |
| `PageThumbnails.tsx` | 페이지 썸네일 네비게이션 |
| `SummaryHeader.tsx` | 절감액 요약 (총 손실액, 매칭 현황) |
| `AnalysisGrid.tsx` | 우측: 데이터 테이블 (필터, 확장) |
| `ProductSearchModal.tsx` | 수동 상품 검색/매칭 모달 |

#### 3.5 UI 상태 머신
```
EMPTY → PROCESSING → ANALYSIS
                 ↘    ERROR
```

- **EMPTY**: PDF 업로드 대기
- **PROCESSING**: 페이지별 OCR + 매칭 진행
- **ANALYSIS**: Split View 감사 화면
- **ERROR**: 오류 표시 + 재시도

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| **Framework** | Next.js 16 (App Router) |
| **Database** | Supabase (PostgreSQL + pg_trgm) |
| **AI/OCR** | Google Gemini 2.0 Flash |
| **Styling** | Tailwind CSS v4 |
| **Language** | TypeScript |

---

## 파일 구조

```
preschool/
├── .env.local                    # 환경 변수 (Supabase, Gemini API)
├── src/
│   ├── app/
│   │   ├── calc-food/           # ✅ 감사 페이지
│   │   │   ├── page.tsx
│   │   │   ├── hooks/
│   │   │   │   └── useAuditSession.ts
│   │   │   └── components/
│   │   │       ├── UploadZone.tsx
│   │   │       ├── ProcessingView.tsx
│   │   │       ├── AnalysisDashboard.tsx
│   │   │       ├── InvoiceViewer.tsx
│   │   │       ├── PageThumbnails.tsx
│   │   │       ├── SummaryHeader.tsx
│   │   │       ├── AnalysisGrid.tsx
│   │   │       └── ProductSearchModal.tsx
│   │   └── api/
│   │       ├── products/search/  # ✅ 검색 API
│   │       ├── session/init/     # ✅ 세션 API
│   │       └── analyze/page/     # ✅ 분석 API
│   ├── lib/
│   │   ├── supabase/            # ✅ Supabase 클라이언트
│   │   ├── gemini.ts            # ✅ Gemini OCR
│   │   ├── matching.ts          # ✅ 매칭 로직
│   │   ├── cn.ts                # ✅ 스타일 유틸
│   │   ├── format.ts            # ✅ 포맷 유틸
│   │   └── pdf-processor.ts     # ✅ PDF 처리
│   └── types/
│       └── audit.ts             # ✅ 타입 정의
├── scripts/
│   ├── seed.ts                  # ✅ 시드 스크립트
│   └── lib/                     # ✅ 파싱 유틸리티
├── supabase/
│   └── migrations/              # ✅ SQL 마이그레이션
└── claudedocs/
    ├── spec.md                  # PRD 원본
    ├── db-schema-plan.md        # DB 설계 문서
    ├── phase-spec/              # 단계별 스펙
    │   ├── phase2-backend-api.md
    │   └── phase3-frontend-ui.md
    └── progress.md              # 진행 상황 (이 문서)
```

---

## 사용 방법

### 1. 환경 변수 설정
```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_GEMINI_API_KEY=...  # https://aistudio.google.com/app/apikey
```

### 2. 개발 서버 실행
```bash
npm run dev
# http://localhost:3000/calc-food
```

### 3. 감사 프로세스
1. `/calc-food` 접속
2. 식자재 명세서 PDF 업로드 (Drag & Drop 또는 클릭)
3. AI가 자동으로 품목 추출 + 기준단가 매칭
4. Split View에서 결과 확인
   - 좌측: 원본 PDF 이미지
   - 우측: 품목별 손실액 분석
5. 필요시 수동 매칭 (검색 아이콘 클릭)

---

## 완료 상태

모든 Phase가 완료되었습니다:

- ✅ **Phase 1**: DB 설계 및 23,866개 상품 시드
- ✅ **Phase 2**: Gemini OCR + pg_trgm Fuzzy Matching API
- ✅ **Phase 3**: Split View 감사 UI

---

## 추후 개선 사항 (Optional)

1. **세션 관리 페이지**: 과거 감사 이력 조회
2. **엑셀 내보내기**: 분석 결과 다운로드
3. **배치 처리**: 여러 PDF 동시 분석
4. **정확도 향상**: 규격 파싱 로직 개선
