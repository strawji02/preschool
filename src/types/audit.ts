// 공급사 타입
export type Supplier = 'CJ' | 'SHINSEGAE'

// 매칭 상태
export type MatchStatus = 'auto_matched' | 'pending' | 'manual_matched' | 'unmatched'

// ========================================
// Side-by-Side Comparison Types
// ========================================

// 공급사별 매칭 결과 (간소화)
export interface SupplierMatch {
  id: string
  product_name: string
  standard_price: number
  match_score: number
  unit_normalized?: string
  ppu?: number              // Price Per Unit (단가당 가격)
  standard_unit?: string    // 표준 단위 (e.g., "100g", "1kg")
  tax_type?: '과세' | '면세'
  category?: string
  spec_quantity?: number
  spec_unit?: string
  _funnelReasons?: string[] // 깔때기 알고리즘 감점 사유 (선택적)
}

// 절감액 계산 결과
export interface SavingsResult {
  cj: number           // (내단가 - CJ단가) * 수량
  ssg: number          // (내단가 - SSG단가) * 수량
  max: number          // max(cj, ssg, 0)
  best_supplier?: 'CJ' | 'SHINSEGAE'
}

// 비교 아이템 (새 핵심 타입)
export interface ComparisonItem {
  id: string
  extracted_name: string
  extracted_spec?: string
  extracted_unit?: string            // 단위 (EA, KG, BOX 등) — 거래명세표 별도 컬럼
  extracted_quantity: number
  extracted_unit_price: number
  extracted_supply_amount?: number   // 세액 미포함 공급가액
  extracted_tax_amount?: number      // 부가세/세액 (면세 품목은 0)
  extracted_total_price?: number     // 부가세 포함 최종 합계
  page_number?: number               // 속한 거래명세표 페이지 번호 (그룹핑용, 2026-04-23 추가)
  source_file_name?: string          // 원본 파일명 (여러 파일 업로드 시 페이지-파일 매핑, 2026-04-23)

  // 현재 선택된 매칭 (Top 1 또는 사용자 선택)
  cj_match?: SupplierMatch
  ssg_match?: SupplierMatch

  // Top 5 후보 리스트 (새로 추가)
  cj_candidates: SupplierMatch[]
  ssg_candidates: SupplierMatch[]

  // 확정 여부 (새로 추가 - 공급사별)
  is_confirmed: boolean  // 전체 확정 (하위 호환성)
  cj_confirmed: boolean   // CJ 공급사 확정
  ssg_confirmed: boolean  // 신세계 공급사 확정

  savings: SavingsResult

  match_status: MatchStatus
  match_candidates?: MatchCandidate[]  // 기존 호환성 유지

  // 보고서 비교 제외 (Susan 피드백 반영, 2026-04-21)
  // - true면 ScenarioComparison 절감액 계산에서 스킵, "비교 불가 품목" 별지로 이동
  // - 기본 false, 미매칭 품목 자동 제외 + 담당자 수동 토글 가능
  is_excluded?: boolean
  exclusion_reason?: string  // 선택: 사유 (예: "매칭 없음", "일회성 구매")
}

// 공급사별 시나리오 분석 결과 (새로 추가)
export interface SupplierScenario {
  supplier: 'CJ' | 'SHINSEGAE'
  // 비교 가능 품목 기준 (is_excluded=false)
  totalOurCost: number           // 비교 가능 품목의 현재 총액
  totalSupplierCost: number      // 비교 가능 품목의 공급사 전환 시 총액
  totalSavings: number           // 절감액 = totalOurCost - totalSupplierCost
  savingsPercent: number         // 절감률 (비교 가능 총액 기준)
  matchedCount: number           // 비교 가능 + 매칭된 품목 수
  unmatchedCount: number         // 비교 가능인데 매칭 없는 품목 수 (레거시)

  // 전체 원장 기준 (Susan 피드백 반영, 2026-04-21)
  grandTotalOurCost: number      // 전체 품목 원본 총액 (기존 업체 거래명세표 총액)
  excludedCount: number          // 비교 제외 품목 수
  excludedTotalCost: number      // 비교 제외 품목의 원본 총액 (별지용)
}

// 새 API 응답 타입
export interface ComparisonPageResponse {
  success: boolean
  page_number: number
  items: ComparisonItem[]
  // 거래명세표 1장의 하단 합계 (OCR이 footer에서 인식, 없으면 null)
  page_total?: number | null
  // 페이지가 속한 원본 파일명 (여러 파일 업로드 시 그룹핑용)
  source_file_name?: string
  error?: string
}

// OCR 추출 품목
export interface ExtractedItem {
  name: string
  spec?: string
  unit?: string            // 단위 (EA, KG, BOX 등)
  quantity: number
  unit_price: number
  supply_amount?: number   // 세액 미포함 공급가액
  tax_amount?: number      // 부가세/세액 (면세 품목은 0)
  total_price?: number     // 부가세 포함 최종 합계
}

// 매칭 후보 (supplier 추가)
export interface MatchCandidate {
  id: string
  product_name: string
  standard_price: number
  unit_normalized: string
  spec_quantity?: number
  spec_unit?: string
  supplier: Supplier  // 추가: 어느 공급사의 가격인지
  match_score: number
}

// 감사 항목 (DB 레코드)
export interface AuditItem {
  id: string
  session_id: string
  file_id?: string
  extracted_name: string
  extracted_spec?: string
  extracted_quantity: number
  extracted_unit_price: number
  extracted_total_price?: number
  matched_product_id?: string
  match_score?: number
  match_candidates?: MatchCandidate[]
  match_status: MatchStatus
  standard_price?: number
  price_difference?: number
  loss_amount?: number
  page_number?: number
  row_index?: number
  is_flagged: boolean
  user_note?: string
  is_excluded?: boolean  // 2026-04-21 추가
  created_at: string
  updated_at: string
}

// 감사 항목 (API Response용) - matched_product에 supplier 추가
export interface AuditItemResponse {
  id: string
  extracted_name: string
  extracted_spec?: string
  extracted_quantity: number
  extracted_unit_price: number
  matched_product?: {
    id: string
    product_name: string
    standard_price: number
    supplier: Supplier  // 추가
  }
  match_score?: number
  match_status: MatchStatus
  match_candidates?: MatchCandidate[]
  loss_amount?: number
}

// 감사 세션 (DB 레코드) - supplier는 optional로 변경 (3rd party 명세서)
export interface AuditSession {
  id: string
  name: string
  supplier?: Supplier  // optional로 변경 (3rd party 명세서일 경우 없음)
  status: 'processing' | 'completed' | 'error'
  total_items: number
  matched_items: number
  pending_items: number
  unmatched_items: number
  total_billed: number
  total_standard: number
  total_loss: number
  created_at: string
  updated_at: string
}

// Gemini OCR Request/Response - supplier 제거 (OCR은 공급사와 무관)
export interface GeminiOCRRequest {
  image: string  // Base64
  // supplier 제거됨
}

export interface GeminiOCRResponse {
  success: boolean
  items: ExtractedItem[]
  page_total?: number | null  // 거래명세표 footer의 합계 금액 (OCR이 인식, 없으면 null)
  raw_response?: string
  error?: string
}

// Matching Request/Response - supplier 제거 (전체 DB 검색)
export interface MatchRequest {
  item_name: string
  // supplier 제거됨 - 전체 DB 검색
}

export interface MatchResult {
  status: MatchStatus
  best_match?: MatchCandidate
  candidates?: MatchCandidate[]
}

// API Request/Response 타입
export interface InitSessionRequest {
  name: string
  supplier?: Supplier  // optional로 변경 (3rd party 명세서)
  total_pages: number
}

export interface InitSessionResponse {
  success: boolean
  session_id?: string
  message?: string
}

export interface AnalyzePageRequest {
  session_id: string
  page_number: number
  image: string  // Base64
  source_file_name?: string  // 원본 파일명 (여러 파일 업로드 시, 2026-04-23 추가)
}

export interface AnalyzePageResponse {
  success: boolean
  page_number: number
  items: AuditItemResponse[]
  error?: string
}

export interface SearchProductsParams {
  q: string
  supplier?: Supplier  // optional 유지
  limit?: number
}

export interface SearchProductsResponse {
  success: boolean
  products: MatchCandidate[]
  error?: string
}
