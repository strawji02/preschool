/**
 * SplitView 컴포넌트 타입 정의
 */

import type { ComparisonItem, SupplierMatch } from '@/types/audit'

/**
 * 거래명세서 품목 (좌측 패널 표시용)
 */
export interface InvoiceRow {
  id: string
  no: number
  name: string
  spec?: string
  unitPrice: number
  quantity: number
  totalPrice?: number
  // 매칭 결과
  matchedProduct?: SupplierMatch
  isConfirmed: boolean
  isAutoConfirmed: boolean
}

/**
 * 검색 결과 품목 (우측 패널 표시용)
 */
export interface SearchResult {
  id: string
  productName: string
  spec: string
  price: number
  pricePerGram?: number // g당 단가
  matchScore: number
  taxType?: '과세' | '면세'
  category?: string
  funnelReasons?: string[] // 감점 사유
}

/**
 * 진행 상태
 */
export interface ProgressStatus {
  total: number
  completed: number
  autoConfirmed: number
  manualReview: number
}

/**
 * 패널 포커스 상태
 */
export type PanelFocus = 'left' | 'right'

/**
 * SplitView Props
 */
export interface SplitViewProps {
  items: ComparisonItem[]
  onSelectProduct: (itemId: string, product: SupplierMatch) => void
  onConfirmItem: (itemId: string) => void
  onConfirmAll: () => void
  onProceed: () => void
}
