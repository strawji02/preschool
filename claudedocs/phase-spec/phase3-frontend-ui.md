# Phase 3: Frontend UI Implementation Spec

> **Goal**: Split-View 인터페이스 기반 "식자재 단가 감사" 페이지 구축
> **Route**: `/calc-food`
> **Stack**: Next.js 16 (App Router), Tailwind CSS v4, Lucide React, pdfjs-dist

---

## 1. 개요

### 1.1 목표
- PDF 명세서 업로드 → OCR 분석 → 단가 비교 → 절감액 시각화
- 사용자 친화적 Split-View 인터페이스
- 수동 매칭 지원 (미매칭 항목)

### 1.2 의존성 (Phase 2 API)
| API | 용도 |
|-----|------|
| `POST /api/session/init` | 세션 생성 |
| `POST /api/analyze/page` | 페이지별 OCR + 매칭 |
| `GET /api/products/search` | 수동 검색 |

### 1.3 신규 의존성 설치
```bash
npm install pdfjs-dist lucide-react clsx tailwind-merge
```

---

## 2. 페이지 상태 머신

```
┌─────────────┐     Upload      ┌─────────────┐     Complete     ┌─────────────┐
│   EMPTY     │ ───────────────▶│ PROCESSING  │ ────────────────▶│  ANALYSIS   │
│  (Upload)   │                 │ (Progress)  │                  │ (Dashboard) │
└─────────────┘                 └─────────────┘                  └─────────────┘
      ▲                               │                                │
      │                               │ Error                          │ Reset
      │                               ▼                                │
      │                         ┌─────────────┐                        │
      └─────────────────────────│    ERROR    │◀───────────────────────┘
                                └─────────────┘
```

### 2.1 State A: EMPTY (파일 업로드 대기)
- Drag & Drop 업로드 존
- 지원 포맷: PDF
- 시각적 피드백 (hover, drag-over)

### 2.2 State B: PROCESSING (분석 진행중)
- Progress Bar + 페이지 카운터
- "페이지 3/10 분석 중..."
- Cancel 버튼 (선택)

### 2.3 State C: ANALYSIS (결과 대시보드)
- Split View: 이미지 뷰어 | 데이터 그리드
- 총 절감액 Summary
- 수동 매칭 지원

---

## 3. 컴포넌트 계층 구조

```
src/
├── app/
│   └── calc-food/
│       ├── page.tsx                    # 메인 페이지
│       └── components/
│           ├── UploadZone.tsx          # 파일 업로드 영역
│           ├── ProcessingView.tsx      # 분석 진행 화면
│           ├── AnalysisDashboard.tsx   # Split View 대시보드
│           ├── InvoiceViewer.tsx       # 좌측: 이미지 뷰어
│           ├── AnalysisGrid.tsx        # 우측: 데이터 그리드
│           ├── SummaryHeader.tsx       # 절감액 요약
│           ├── ProductSearchModal.tsx  # 수동 매칭 모달
│           └── PageThumbnails.tsx      # 페이지 썸네일
├── lib/
│   └── pdf-processor.ts                # PDF → 이미지 변환
└── hooks/
    └── useAuditSession.ts              # 세션 상태 관리
```

---

## 4. 컴포넌트 상세 설계

### 4.1 UploadZone

```typescript
// Props
interface UploadZoneProps {
  onFileSelect: (file: File) => void
  isLoading?: boolean
}

// 기능
- Drag & Drop 지원 (onDragOver, onDrop)
- Click to Upload (hidden input)
- 파일 유효성 검사 (PDF only)
- 시각적 피드백:
  - 기본: 점선 테두리 + 아이콘
  - Hover/Drag: 배경색 변경, 테두리 강조
  - Loading: 스피너

// 스타일 가이드
- 최소 높이: 300px
- 아이콘: Lucide `Upload`, `FileText`
- 컬러: primary (#38549C), border-dashed
```

### 4.2 ProcessingView

```typescript
// Props
interface ProcessingViewProps {
  currentPage: number
  totalPages: number
  onCancel?: () => void
}

// 기능
- Progress Bar (currentPage / totalPages * 100)
- 페이지 카운터 텍스트
- 취소 버튼 (optional)

// 스타일 가이드
- 중앙 정렬
- 프로그레스 바: h-3, rounded-full
- 애니메이션: transition-all duration-300
```

### 4.3 AnalysisDashboard (Split View)

```typescript
// Props
interface AnalysisDashboardProps {
  pages: PageImage[]
  items: AuditItemResponse[]
  stats: SessionStats
  onItemUpdate: (itemId: string, productId: string) => void
  onReset: () => void
}

// 레이아웃
- 2-Column Grid: grid-cols-1 lg:grid-cols-2
- Left: InvoiceViewer (min-w-0, flex-1)
- Right: AnalysisGrid (min-w-0, flex-1)
- Divider: 드래그로 비율 조절 (optional, Phase 3+)
```

### 4.4 InvoiceViewer (좌측 패널)

```typescript
// Props
interface InvoiceViewerProps {
  pages: PageImage[]
  currentPage: number
  onPageChange: (page: number) => void
}

// 기능
1. 이미지 렌더링 (선택된 페이지)
2. Zoom 컨트롤 (+/- 버튼, 휠)
3. Pan 지원 (드래그)
4. 페이지 썸네일 (하단 또는 좌측)

// 구현 옵션
- Option A: Native <img> + CSS transform (간단)
- Option B: Canvas 렌더링 (고성능)
→ Phase 3 MVP: Option A 선택

// 스타일 가이드
- 배경: bg-gray-100 (체크 패턴 optional)
- 썸네일: w-16 h-20, 선택 시 ring-2
- 컨트롤: 우측 상단 오버레이
```

### 4.5 AnalysisGrid (우측 패널)

```typescript
// Props
interface AnalysisGridProps {
  items: AuditItemResponse[]
  stats: SessionStats
  onRowClick: (item: AuditItemResponse) => void
}

// 구성
1. SummaryHeader (상단)
2. DataTable (본문)

// SummaryHeader
- "총 예상 절감액: ₩XX,XXX" (Red, Bold)
- 추가 통계: 총 청구액, 총 표준가, 매칭률

// DataTable 컬럼
| 컬럼 | 필드 | 정렬 |
|------|------|------|
| 품목명 | extracted_name | left |
| 수량 | extracted_quantity | right |
| 청구단가 | extracted_unit_price | right |
| 시장가 (CJ/SSG) | matched_product.standard_price | right |
| 절감액 | loss_amount | right |
| 상태 | match_status | center |

// 행 스타일링
- loss_amount > 0: bg-red-50
- loss_amount < 0: bg-green-50 (optional)
- 호버: bg-gray-50

// 상태 아이콘 (Lucide)
- auto_matched: CheckCircle (green)
- manual_matched: CheckCircle2 (blue)
- pending: AlertCircle (yellow)
- unmatched: XCircle (red)

// 행 클릭
- pending/unmatched 클릭 → ProductSearchModal 열기
```

### 4.6 ProductSearchModal

```typescript
// Props
interface ProductSearchModalProps {
  isOpen: boolean
  onClose: () => void
  initialQuery: string  // extracted_name
  onSelect: (product: MatchCandidate) => void
}

// 기능
1. 검색 입력 (디바운스 300ms)
2. API 호출: GET /api/products/search?q={query}
3. 결과 리스트 렌더링
4. 선택 시 onSelect 콜백

// 결과 리스트 항목
- 상품명
- 규격 (spec_quantity + spec_unit)
- 표준가
- 공급사 배지 (CJ/SSG)
- 유사도 점수 (optional)

// 스타일 가이드
- 모달: max-w-lg, rounded-xl
- 백드롭: bg-black/50
- 검색 결과: max-h-80 overflow-y-auto
```

---

## 5. 상태 관리 (useAuditSession)

```typescript
// hooks/useAuditSession.ts

interface PageImage {
  pageNumber: number
  blob: Blob
  dataUrl: string  // 렌더링용
}

interface SessionStats {
  total_items: number
  matched_items: number
  pending_items: number
  unmatched_items: number
  total_billed: number
  total_standard: number
  total_savings: number
}

interface AuditSessionState {
  // 상태
  status: 'empty' | 'processing' | 'analysis' | 'error'

  // 세션
  sessionId: string | null

  // PDF 처리
  pages: PageImage[]
  currentPage: number

  // 분석 결과
  items: AuditItemResponse[]
  stats: SessionStats

  // 진행 상황
  processingPage: number
  totalPages: number

  // 에러
  error: string | null
}

// Actions
type AuditAction =
  | { type: 'START_UPLOAD'; file: File }
  | { type: 'SET_PAGES'; pages: PageImage[] }
  | { type: 'START_SESSION'; sessionId: string }
  | { type: 'PAGE_ANALYZED'; items: AuditItemResponse[]; pageNumber: number }
  | { type: 'ANALYSIS_COMPLETE' }
  | { type: 'UPDATE_ITEM'; itemId: string; product: MatchCandidate }
  | { type: 'SET_CURRENT_PAGE'; page: number }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' }
```

---

## 6. PDF 처리 로직

### 6.1 pdf-processor.ts

```typescript
// lib/pdf-processor.ts
import * as pdfjs from 'pdfjs-dist'

// Worker 설정 (Next.js 호환)
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`

interface PDFPage {
  pageNumber: number
  blob: Blob
  dataUrl: string
}

export async function extractPagesFromPDF(file: File): Promise<PDFPage[]> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise

  const pages: PDFPage[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 }) // 고해상도

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height

    const context = canvas.getContext('2d')!
    await page.render({ canvasContext: context, viewport }).promise

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9)
    })

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)

    pages.push({ pageNumber: i, blob, dataUrl })
  }

  return pages
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
```

### 6.2 분석 플로우

```typescript
async function analyzeDocument(file: File) {
  dispatch({ type: 'START_UPLOAD', file })

  try {
    // 1. PDF → 이미지 변환
    const pages = await extractPagesFromPDF(file)
    dispatch({ type: 'SET_PAGES', pages })

    // 2. 세션 생성
    const initRes = await fetch('/api/session/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name,
        total_pages: pages.length
      })
    })
    const { session_id } = await initRes.json()
    dispatch({ type: 'START_SESSION', sessionId: session_id })

    // 3. 페이지별 순차 분석
    for (const page of pages) {
      const base64 = await blobToBase64(page.blob)

      const analyzeRes = await fetch('/api/analyze/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id,
          page_number: page.pageNumber,
          image: base64
        })
      })

      const { items } = await analyzeRes.json()
      dispatch({ type: 'PAGE_ANALYZED', items, pageNumber: page.pageNumber })
    }

    dispatch({ type: 'ANALYSIS_COMPLETE' })
  } catch (error) {
    dispatch({ type: 'SET_ERROR', error: error.message })
  }
}
```

---

## 7. 스타일 가이드

### 7.1 색상 시스템

```css
/* globals.css - CSS Variables */
:root {
  --color-primary: #38549C;
  --color-secondary: #F3921E;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-savings-positive: #fef2f2; /* bg-red-50 */
  --color-savings-negative: #f0fdf4; /* bg-green-50 */
}
```

### 7.2 통화 포맷

```typescript
// lib/format.ts
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0
  }).format(amount)
}

// 사용 예: formatCurrency(12500) → "₩12,500"
```

### 7.3 반응형 브레이크포인트

```
- sm: 640px (모바일 가로)
- md: 768px (태블릿)
- lg: 1024px (Split View 활성화)
- xl: 1280px (넓은 데스크톱)
```

---

## 8. 구현 단계

### Step 1: 기반 설정 (1시간)
- [ ] 의존성 설치 (`pdfjs-dist`, `lucide-react`, `clsx`, `tailwind-merge`)
- [ ] `/calc-food/page.tsx` 기본 구조
- [ ] `useAuditSession` 훅 스켈레톤
- [ ] `pdf-processor.ts` 유틸리티

### Step 2: 업로드 & 처리 (1시간)
- [ ] `UploadZone` 컴포넌트
- [ ] `ProcessingView` 컴포넌트
- [ ] PDF → 이미지 변환 테스트

### Step 3: 대시보드 레이아웃 (1시간)
- [ ] `AnalysisDashboard` (Split View)
- [ ] `InvoiceViewer` (이미지 + 썸네일)
- [ ] `SummaryHeader` (통계)

### Step 4: 데이터 그리드 (1시간)
- [ ] `AnalysisGrid` (테이블 + 하이라이팅)
- [ ] 행 클릭 핸들러
- [ ] 상태 아이콘

### Step 5: 수동 매칭 (1시간)
- [ ] `ProductSearchModal`
- [ ] 검색 API 연동
- [ ] 선택 → 상태 업데이트

### Step 6: 통합 & 폴리싱 (1시간)
- [ ] 전체 플로우 테스트
- [ ] 에러 핸들링
- [ ] 로딩 상태
- [ ] 반응형 최적화

---

## 9. API 연동 예시

### 9.1 세션 초기화

```typescript
const response = await fetch('/api/session/init', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Invoice-2026-02.pdf',
    total_pages: 5
  })
})
// Response: { success: true, session_id: "uuid..." }
```

### 9.2 페이지 분석

```typescript
const response = await fetch('/api/analyze/page', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: 'uuid...',
    page_number: 1,
    image: 'base64...'
  })
})
// Response: { success: true, items: [...] }
```

### 9.3 상품 검색

```typescript
const response = await fetch('/api/products/search?q=옛날당면&limit=10')
// Response: { success: true, products: [...] }
```

---

## 10. 테스트 체크리스트

### 기능 테스트
- [ ] PDF 업로드 (Drag & Drop)
- [ ] PDF 업로드 (Click)
- [ ] 잘못된 파일 형식 거부
- [ ] 분석 진행 표시
- [ ] Split View 렌더링
- [ ] 페이지 전환
- [ ] 절감액 하이라이팅
- [ ] 수동 검색 모달
- [ ] 상품 선택 → 업데이트

### 반응형 테스트
- [ ] 모바일 (< 768px): 단일 컬럼
- [ ] 태블릿 (768px ~ 1024px): 탭 전환
- [ ] 데스크톱 (> 1024px): Split View

### 에러 처리
- [ ] 네트워크 오류
- [ ] API 오류 응답
- [ ] 빈 PDF
- [ ] 분석 실패

---

## 11. 향후 개선 (Phase 3+)

### 11.1 UX 개선
- 드래그로 Split View 비율 조절
- 이미지 영역 하이라이팅 (OCR 좌표 기반)
- 키보드 네비게이션

### 11.2 기능 확장
- 분석 결과 Excel 내보내기
- 분석 이력 저장 & 조회
- 공급사별 필터링

### 11.3 성능 최적화
- 이미지 Lazy Loading
- 가상화 테이블 (대용량 데이터)
- Service Worker 캐싱
