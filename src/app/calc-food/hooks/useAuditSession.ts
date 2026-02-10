'use client'

import { useReducer, useCallback, useMemo } from 'react'
import type { ComparisonItem, MatchCandidate, Supplier, SupplierMatch, SavingsResult, SupplierScenario } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { extractPagesFromPDF, extractPagesFromImages, extractBase64, isPDF, isImage } from '@/lib/pdf-processor'

// 상태 타입
export type AuditStatus = 'empty' | 'processing' | 'analysis' | 'error'

// 분석 단계 (새로 추가)
export type AnalysisStep = 'matching' | 'report'

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
  currentStep: AnalysisStep  // 새로 추가: 매칭 → 리포트 단계
  sessionId: string | null
  pages: PageImage[]
  currentPage: number
  items: ComparisonItem[]
  stats: SessionStats
  processingPage: number
  totalPages: number
  error: string | null
  fileName: string | null
  isReanalyzing: boolean
  reanalyzingPage: number | null
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
  // 2-Step Workflow 액션 (새로 추가)
  | { type: 'SET_STEP'; step: AnalysisStep }
  | { type: 'SELECT_CANDIDATE'; itemId: string; supplier: Supplier; candidate: SupplierMatch }
  | { type: 'CONFIRM_ITEM'; itemId: string }
  | { type: 'CONFIRM_ALL_AUTO_MATCHED' }
  | { type: 'PROCEED_TO_REPORT' }
  | { type: 'BACK_TO_MATCHING' }
  // 재분석 액션
  | { type: 'START_REANALYZE'; pageNumber: number }
  | { type: 'REPLACE_PAGE_ITEMS'; pageNumber: number; items: ComparisonItem[] }
  | { type: 'COMPLETE_REANALYZE' }

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
  currentStep: 'matching',  // 기본값: 매칭 단계
  sessionId: null,
  pages: [],
  currentPage: 1,
  items: [],
  stats: initialStats,
  processingPage: 0,
  totalPages: 0,
  error: null,
  fileName: null,
  isReanalyzing: false,
  reanalyzingPage: null,
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

    // 2-Step Workflow 액션 핸들러
    case 'SET_STEP':
      return { ...state, currentStep: action.step }

    case 'SELECT_CANDIDATE': {
      const newItems = state.items.map((item) => {
        if (item.id !== action.itemId) return item

        const updatedItem = { ...item }
        if (action.supplier === 'CJ') {
          updatedItem.cj_match = action.candidate
        } else {
          updatedItem.ssg_match = action.candidate
        }

        // savings 재계산
        updatedItem.savings = recalculateSavings(
          item.extracted_unit_price,
          item.extracted_quantity,
          updatedItem.cj_match?.standard_price,
          updatedItem.ssg_match?.standard_price
        )

        return updatedItem
      })

      return {
        ...state,
        items: newItems,
        stats: calculateStats(newItems),
      }
    }

    case 'CONFIRM_ITEM': {
      const newItems = state.items.map((item) => {
        if (item.id !== action.itemId) return item
        // 토글: 이미 확정되어 있으면 해제, 아니면 확정
        return {
          ...item,
          is_confirmed: !item.is_confirmed,
          match_status: item.is_confirmed ? item.match_status : 'manual_matched' as const
        }
      })

      return {
        ...state,
        items: newItems,
        stats: calculateStats(newItems),
      }
    }

    case 'CONFIRM_ALL_AUTO_MATCHED': {
      const newItems = state.items.map((item) => {
        // 신뢰도 90% 이상인 매칭이 있는 경우에만 자동 확정
        const hasCjHighConfidence = item.cj_match && item.cj_match.match_score >= 0.9
        const hasSsgHighConfidence = item.ssg_match && item.ssg_match.match_score >= 0.9

        if (hasCjHighConfidence || hasSsgHighConfidence) {
          return { ...item, is_confirmed: true }
        }
        return item
      })

      return {
        ...state,
        items: newItems,
        stats: calculateStats(newItems),
      }
    }

    case 'PROCEED_TO_REPORT':
      return { ...state, currentStep: 'report' }

    case 'BACK_TO_MATCHING':
      return { ...state, currentStep: 'matching' }

    // 재분석 액션 핸들러
    case 'START_REANALYZE':
      return { ...state, isReanalyzing: true, reanalyzingPage: action.pageNumber }

    case 'REPLACE_PAGE_ITEMS': {
      // 해당 페이지의 기존 아이템 제거하고 새 아이템으로 교체
      const filteredItems = state.items.filter(
        item => item.id.split('-')[0] !== `page${action.pageNumber}`
      )
      const newItems = [...filteredItems, ...action.items]
      return {
        ...state,
        items: newItems,
        stats: calculateStats(newItems),
      }
    }

    case 'COMPLETE_REANALYZE':
      return { ...state, isReanalyzing: false, reanalyzingPage: null }

    default:
      return state
  }
}

export function useAuditSession() {
  const [state, dispatch] = useReducer(auditReducer, initialState)

  const processFiles = useCallback(async (files: File[]) => {
    try {
      if (files.length === 0) {
        throw new Error('파일을 선택해주세요.')
      }

      // 1. 파일 타입에 따라 페이지 추출
      let pages: PageImage[]
      let fileName: string

      // 첫 번째 파일이 PDF인지 확인
      if (isPDF(files[0])) {
        pages = await extractPagesFromPDF(files[0])
        fileName = files[0].name
      } else if (files.every(f => isImage(f))) {
        // 모든 파일이 이미지인 경우
        pages = await extractPagesFromImages(files)
        fileName = files.length === 1 ? files[0].name : `${files[0].name} 외 ${files.length - 1}장`
      } else {
        throw new Error('지원하지 않는 파일 형식입니다. PDF 또는 이미지 파일을 업로드하세요.')
      }

      dispatch({ type: 'START_PROCESSING', fileName, totalPages: pages.length })
      dispatch({ type: 'SET_PAGES', pages })

      // 2. 세션 초기화 API 호출
      const initRes = await fetch('/api/session/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fileName,
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

  // 2-Step Workflow 함수들
  const selectCandidate = useCallback(
    (itemId: string, supplier: Supplier, candidate: SupplierMatch) => {
      dispatch({ type: 'SELECT_CANDIDATE', itemId, supplier, candidate })
    },
    []
  )

  const confirmItem = useCallback((itemId: string) => {
    dispatch({ type: 'CONFIRM_ITEM', itemId })
  }, [])

  const confirmAllAutoMatched = useCallback(() => {
    dispatch({ type: 'CONFIRM_ALL_AUTO_MATCHED' })
  }, [])

  const proceedToReport = useCallback(() => {
    dispatch({ type: 'PROCEED_TO_REPORT' })
  }, [])

  const backToMatching = useCallback(() => {
    dispatch({ type: 'BACK_TO_MATCHING' })
  }, [])

  // 재분석
  const reanalyze = useCallback(async (pageNumber: number) => {
    if (!state.sessionId || state.isReanalyzing) return

    try {
      dispatch({ type: 'START_REANALYZE', pageNumber })

      const page = state.pages.find(p => p.pageNumber === pageNumber)
      if (!page) {
        throw new Error('페이지를 찾을 수 없습니다.')
      }

      const analyzeRes = await fetch('/api/analyze/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.sessionId,
          page_number: pageNumber,
          image: extractBase64(page.dataUrl),
        }),
      })

      if (!analyzeRes.ok) {
        throw new Error('페이지 재분석 실패')
      }

      const analyzeData = await analyzeRes.json()
      if (analyzeData.success && analyzeData.items) {
        dispatch({ type: 'REPLACE_PAGE_ITEMS', pageNumber, items: analyzeData.items })
      }

      dispatch({ type: 'COMPLETE_REANALYZE' })
    } catch (error) {
      console.error('재분석 실패:', error)
      dispatch({ type: 'COMPLETE_REANALYZE' })
      alert('페이지 재분석에 실패했습니다.')
    }
  }, [state.sessionId, state.pages, state.isReanalyzing])

  // 시나리오 계산 (CJ vs SSG)
  const scenarios = useMemo((): { cj: SupplierScenario; ssg: SupplierScenario } => {
    const items = state.items

    let cjTotalOur = 0
    let cjTotalSupplier = 0
    let cjMatchedCount = 0
    let ssgTotalOur = 0
    let ssgTotalSupplier = 0
    let ssgMatchedCount = 0

    for (const item of items) {
      const itemTotal = item.extracted_unit_price * item.extracted_quantity

      // CJ 시나리오
      cjTotalOur += itemTotal
      if (item.cj_match) {
        cjTotalSupplier += item.cj_match.standard_price * item.extracted_quantity
        cjMatchedCount++
      } else {
        cjTotalSupplier += itemTotal // 매칭 없으면 현재가 유지
      }

      // SSG 시나리오
      ssgTotalOur += itemTotal
      if (item.ssg_match) {
        ssgTotalSupplier += item.ssg_match.standard_price * item.extracted_quantity
        ssgMatchedCount++
      } else {
        ssgTotalSupplier += itemTotal // 매칭 없으면 현재가 유지
      }
    }

    const cjSavings = Math.max(0, cjTotalOur - cjTotalSupplier)
    const ssgSavings = Math.max(0, ssgTotalOur - ssgTotalSupplier)

    return {
      cj: {
        supplier: 'CJ',
        totalOurCost: cjTotalOur,
        totalSupplierCost: cjTotalSupplier,
        totalSavings: cjSavings,
        savingsPercent: cjTotalOur > 0 ? (cjSavings / cjTotalOur) * 100 : 0,
        matchedCount: cjMatchedCount,
        unmatchedCount: items.length - cjMatchedCount,
      },
      ssg: {
        supplier: 'SHINSEGAE',
        totalOurCost: ssgTotalOur,
        totalSupplierCost: ssgTotalSupplier,
        totalSavings: ssgSavings,
        savingsPercent: ssgTotalOur > 0 ? (ssgSavings / ssgTotalOur) * 100 : 0,
        matchedCount: ssgMatchedCount,
        unmatchedCount: items.length - ssgMatchedCount,
      },
    }
  }, [state.items])

  // 확정 현황
  const confirmationStats = useMemo(() => {
    const total = state.items.length
    const confirmed = state.items.filter(item => item.is_confirmed).length
    const unconfirmed = total - confirmed
    return { total, confirmed, unconfirmed }
  }, [state.items])

  return {
    state,
    processFiles,
    setCurrentPage,
    updateItemMatch,
    reset,
    // 2-Step Workflow
    selectCandidate,
    confirmItem,
    confirmAllAutoMatched,
    proceedToReport,
    backToMatching,
    scenarios,
    confirmationStats,
    // 재분석
    reanalyze,
    isReanalyzing: state.isReanalyzing,
  }
}
