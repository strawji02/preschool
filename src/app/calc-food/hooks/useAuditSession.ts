'use client'

import { useReducer, useCallback } from 'react'
import type { ComparisonItem, MatchCandidate, Supplier, SupplierMatch, SavingsResult } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { extractPagesFromPDF, extractPagesFromImages, extractBase64, isPDF, isImage } from '@/lib/pdf-processor'

// 상태 타입
export type AuditStatus = 'empty' | 'processing' | 'analysis' | 'error'

// 공급사별 통계 포함
export interface SessionStats {
  totalItems: number
  matchedItems: number
  pendingItems: number
  unmatchedItems: number
  totalBilled: number
  // 공급사별 절감액
  cjSavings: number
  ssgSavings: number
  maxSavings: number
  // 매칭률
  cjMatchRate: number
  ssgMatchRate: number
}

export interface AuditState {
  status: AuditStatus
  sessionId: string | null
  pages: PageImage[]
  currentPage: number
  items: ComparisonItem[]
  stats: SessionStats
  processingPage: number
  totalPages: number
  error: string | null
  fileName: string | null
}

// 액션 타입
type AuditAction =
  | { type: 'START_PROCESSING'; fileName: string; totalPages: number }
  | { type: 'SET_SESSION_ID'; sessionId: string }
  | { type: 'SET_PAGES'; pages: PageImage[] }
  | { type: 'UPDATE_PROCESSING_PAGE'; page: number }
  | { type: 'ADD_PAGE_ITEMS'; items: ComparisonItem[] }
  | { type: 'COMPLETE_ANALYSIS' }
  | { type: 'SET_CURRENT_PAGE'; page: number }
  | { type: 'UPDATE_ITEM_MATCH'; itemId: string; supplier: Supplier; match: SupplierMatch }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' }

const initialStats: SessionStats = {
  totalItems: 0,
  matchedItems: 0,
  pendingItems: 0,
  unmatchedItems: 0,
  totalBilled: 0,
  cjSavings: 0,
  ssgSavings: 0,
  maxSavings: 0,
  cjMatchRate: 0,
  ssgMatchRate: 0,
}

const initialState: AuditState = {
  status: 'empty',
  sessionId: null,
  pages: [],
  currentPage: 1,
  items: [],
  stats: initialStats,
  processingPage: 0,
  totalPages: 0,
  error: null,
  fileName: null,
}

function calculateStats(items: ComparisonItem[]): SessionStats {
  if (items.length === 0) return initialStats

  let totalBilled = 0
  let cjSavings = 0
  let ssgSavings = 0
  let maxSavings = 0
  let matchedItems = 0
  let pendingItems = 0
  let unmatchedItems = 0
  let cjMatchCount = 0
  let ssgMatchCount = 0

  for (const item of items) {
    // 청구 총액
    totalBilled += item.extracted_unit_price * item.extracted_quantity

    // 절감액 합산
    cjSavings += item.savings.cj
    ssgSavings += item.savings.ssg
    maxSavings += item.savings.max

    // 매칭 상태 카운트
    if (item.match_status === 'auto_matched' || item.match_status === 'manual_matched') {
      matchedItems++
    } else if (item.match_status === 'pending') {
      pendingItems++
    } else {
      unmatchedItems++
    }

    // 공급사별 매칭 카운트
    if (item.cj_match) cjMatchCount++
    if (item.ssg_match) ssgMatchCount++
  }

  return {
    totalItems: items.length,
    matchedItems,
    pendingItems,
    unmatchedItems,
    totalBilled,
    cjSavings,
    ssgSavings,
    maxSavings,
    cjMatchRate: items.length > 0 ? (cjMatchCount / items.length) * 100 : 0,
    ssgMatchRate: items.length > 0 ? (ssgMatchCount / items.length) * 100 : 0,
  }
}

// 아이템 매칭 업데이트 시 savings 재계산
function recalculateSavings(
  unitPrice: number,
  quantity: number,
  cjPrice?: number,
  ssgPrice?: number
): SavingsResult {
  const cjSavings = cjPrice !== undefined ? Math.max(0, (unitPrice - cjPrice) * quantity) : 0
  const ssgSavings = ssgPrice !== undefined ? Math.max(0, (unitPrice - ssgPrice) * quantity) : 0
  const maxSavings = Math.max(cjSavings, ssgSavings)

  let best_supplier: 'CJ' | 'SHINSEGAE' | undefined
  if (maxSavings > 0) {
    if (cjSavings >= ssgSavings && cjSavings > 0) {
      best_supplier = 'CJ'
    } else if (ssgSavings > 0) {
      best_supplier = 'SHINSEGAE'
    }
  }

  return { cj: cjSavings, ssg: ssgSavings, max: maxSavings, best_supplier }
}

function auditReducer(state: AuditState, action: AuditAction): AuditState {
  switch (action.type) {
    case 'START_PROCESSING':
      return {
        ...initialState,
        status: 'processing',
        fileName: action.fileName,
        totalPages: action.totalPages,
        processingPage: 0,
      }

    case 'SET_SESSION_ID':
      return { ...state, sessionId: action.sessionId }

    case 'SET_PAGES':
      return { ...state, pages: action.pages }

    case 'UPDATE_PROCESSING_PAGE':
      return { ...state, processingPage: action.page }

    case 'ADD_PAGE_ITEMS': {
      const newItems = [...state.items, ...action.items]
      return {
        ...state,
        items: newItems,
        stats: calculateStats(newItems),
      }
    }

    case 'COMPLETE_ANALYSIS':
      return { ...state, status: 'analysis' }

    case 'SET_CURRENT_PAGE':
      return { ...state, currentPage: action.page }

    case 'UPDATE_ITEM_MATCH': {
      const newItems = state.items.map((item) => {
        if (item.id !== action.itemId) return item

        // 새 매칭 적용
        const updatedItem = { ...item }
        if (action.supplier === 'CJ') {
          updatedItem.cj_match = action.match
        } else {
          updatedItem.ssg_match = action.match
        }

        // savings 재계산
        updatedItem.savings = recalculateSavings(
          item.extracted_unit_price,
          item.extracted_quantity,
          updatedItem.cj_match?.standard_price,
          updatedItem.ssg_match?.standard_price
        )

        // 상태 업데이트 (수동 매칭)
        updatedItem.match_status = 'manual_matched'

        return updatedItem
      })

      return {
        ...state,
        items: newItems,
        stats: calculateStats(newItems),
      }
    }

    case 'SET_ERROR':
      return { ...state, status: 'error', error: action.error }

    case 'RESET':
      return initialState

    default:
      return state
  }
}

export function useAuditSession() {
  const [state, dispatch] = useReducer(auditReducer, initialState)

  const processFile = useCallback(async (file: File) => {
    try {
      // 1. 파일 타입에 따라 페이지 추출
      let pages: PageImage[]

      if (isPDF(file)) {
        pages = await extractPagesFromPDF(file)
      } else if (isImage(file)) {
        pages = await extractPagesFromImages([file])
      } else {
        throw new Error('지원하지 않는 파일 형식입니다. PDF 또는 이미지 파일을 업로드하세요.')
      }

      dispatch({ type: 'START_PROCESSING', fileName: file.name, totalPages: pages.length })
      dispatch({ type: 'SET_PAGES', pages })

      // 2. 세션 초기화 API 호출
      const initRes = await fetch('/api/session/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          total_pages: pages.length,
        }),
      })

      if (!initRes.ok) {
        throw new Error('세션 초기화 실패')
      }

      const initData = await initRes.json()
      if (!initData.success) {
        throw new Error(initData.message || '세션 초기화 실패')
      }

      dispatch({ type: 'SET_SESSION_ID', sessionId: initData.session_id })

      // 3. 각 페이지 분석
      for (let i = 0; i < pages.length; i++) {
        dispatch({ type: 'UPDATE_PROCESSING_PAGE', page: i + 1 })

        const analyzeRes = await fetch('/api/analyze/page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: initData.session_id,
            page_number: i + 1,
            image: extractBase64(pages[i].dataUrl),
          }),
        })

        if (!analyzeRes.ok) {
          console.error(`페이지 ${i + 1} 분석 실패`)
          continue
        }

        const analyzeData = await analyzeRes.json()
        if (analyzeData.success && analyzeData.items) {
          dispatch({ type: 'ADD_PAGE_ITEMS', items: analyzeData.items })
        }
      }

      // 4. 분석 완료
      dispatch({ type: 'COMPLETE_ANALYSIS' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류'
      dispatch({ type: 'SET_ERROR', error: message })
    }
  }, [])

  const setCurrentPage = useCallback((page: number) => {
    dispatch({ type: 'SET_CURRENT_PAGE', page })
  }, [])

  // 아이템 매칭 업데이트 (수동 검색 결과 적용)
  const updateItemMatch = useCallback(
    (itemId: string, product: MatchCandidate, supplier: Supplier) => {
      const match: SupplierMatch = {
        id: product.id,
        product_name: product.product_name,
        standard_price: product.standard_price,
        match_score: product.match_score,
        unit_normalized: product.unit_normalized,
      }
      dispatch({ type: 'UPDATE_ITEM_MATCH', itemId, supplier, match })
    },
    []
  )

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' })
  }, [])

  return {
    state,
    processFile,
    setCurrentPage,
    updateItemMatch,
    reset,
  }
}
