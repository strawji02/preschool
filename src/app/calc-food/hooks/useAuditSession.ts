'use client'

import { useReducer, useCallback } from 'react'
import type { AuditItemResponse } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { extractPagesFromPDF, extractPagesFromImages, extractBase64, isPDF, isImage } from '@/lib/pdf-processor'

// 상태 타입
export type AuditStatus = 'empty' | 'processing' | 'analysis' | 'error'

export interface SessionStats {
  totalItems: number
  matchedItems: number
  pendingItems: number
  unmatchedItems: number
  totalBilled: number
  totalStandard: number
  totalLoss: number
}

export interface AuditState {
  status: AuditStatus
  sessionId: string | null
  pages: PageImage[]
  currentPage: number
  items: AuditItemResponse[]
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
  | { type: 'ADD_PAGE_ITEMS'; items: AuditItemResponse[] }
  | { type: 'COMPLETE_ANALYSIS' }
  | { type: 'SET_CURRENT_PAGE'; page: number }
  | { type: 'UPDATE_ITEM'; itemId: string; updates: Partial<AuditItemResponse> }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' }

const initialStats: SessionStats = {
  totalItems: 0,
  matchedItems: 0,
  pendingItems: 0,
  unmatchedItems: 0,
  totalBilled: 0,
  totalStandard: 0,
  totalLoss: 0,
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

function calculateStats(items: AuditItemResponse[]): SessionStats {
  return items.reduce(
    (acc, item) => {
      acc.totalItems++

      if (item.match_status === 'auto_matched' || item.match_status === 'manual_matched') {
        acc.matchedItems++
      } else if (item.match_status === 'pending') {
        acc.pendingItems++
      } else {
        acc.unmatchedItems++
      }

      const itemTotal = item.extracted_unit_price * item.extracted_quantity
      acc.totalBilled += itemTotal

      if (item.matched_product) {
        const standardTotal = item.matched_product.standard_price * item.extracted_quantity
        acc.totalStandard += standardTotal
        acc.totalLoss += Math.max(0, itemTotal - standardTotal)
      }

      return acc
    },
    { ...initialStats }
  )
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

    case 'UPDATE_ITEM': {
      const newItems = state.items.map((item) =>
        item.id === action.itemId ? { ...item, ...action.updates } : item
      )
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

  const updateItem = useCallback((itemId: string, updates: Partial<AuditItemResponse>) => {
    dispatch({ type: 'UPDATE_ITEM', itemId, updates })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' })
  }, [])

  return {
    state,
    processFile,
    setCurrentPage,
    updateItem,
    reset,
  }
}
