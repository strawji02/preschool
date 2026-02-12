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
  extracted_quantity: number
  extracted_unit_price: number
  extracted_total_price?: number  // 합계 검증용 추가

  // 현재 선택된 매칭 (Top 1 또는 사용자 선택)
  cj_match?: SupplierMatch
  ssg_match?: SupplierMatch

  // Top 5 후보 리스트 (새로 추가)
  cj_candidates: SupplierMatch[]
  ssg_candidates: SupplierMatch[]

  // 확정 여부 (새로 추가)
  is_confirmed: boolean

  savings: SavingsResult

  match_status: MatchStatus
  match_candidates?: MatchCandidate[]  // 기존 호환성 유지
}

// 공급사별 시나리오 분석 결과 (새로 추가)
export interface SupplierScenario {
  supplier: 'CJ' | 'SHINSEGAE'
  totalOurCost: number        // 현재 총액
  totalSupplierCost: number   // 공급사 전환 시 총액
  totalSavings: number        // 절감액
  savingsPercent: number      // 절감률
  matchedCount: number        // 매칭된 품목 수
  unmatchedCount: number      // 미매칭 품목 수
}

// 새 API 응답 타입
export interface ComparisonPageResponse {
  success: boolean
  page_number: number
  items: ComparisonItem[]
  error?: string
}

// OCR 추출 품목
export interface ExtractedItem {
  name: string
  spec?: string
  quantity: number
  unit_price: number
  total_price?: number
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
