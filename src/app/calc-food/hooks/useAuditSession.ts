'use client'

import { useReducer, useCallback, useMemo } from 'react'
import type { ComparisonItem, MatchCandidate, Supplier, SupplierMatch, SavingsResult, SupplierScenario } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { extractPagesFromPDF, extractPagesFromImages, extractBase64, isPDF, isImage } from '@/lib/pdf-processor'
import { parseInvoiceExcel, isExcelFile } from '@/lib/excel-parser'

// 상태 타입
// 'excel_preview' — 2026-04-21 추가: 엑셀 파싱 후 담당자 확인 절차
export type AuditStatus = 'empty' | 'excel_preview' | 'processing' | 'analysis' | 'error'

// 엑셀 파싱 결과 (담당자 확인용 임시 데이터)
export interface ExcelPreviewData {
  fileName: string
  supplierName: string
  items: Array<{
    name: string
    spec?: string
    /** 단위 (KG, PAC, EA 등) */
    unit?: string
    quantity: number
    unit_price: number
    /** 공급가액 (세액 미포함) */
    supply_amount?: number
    /** 세액 */
    tax_amount?: number
    /** 세액 포함 총액 (원장 총액) */
    total_price: number
    row_index: number
  }>
  totalAmount: number
  mismatchCount: number  // 공급가액 + 세액 ≠ 총액인 행 수
}

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
  supplierName: string | null  // 파일명에서 추출한 공급업체명
  isReanalyzing: boolean
  reanalyzingPage: number | null
  // 엑셀 파싱 후 담당자 확인 단계용 임시 데이터 (2026-04-21 추가)
  excelPreview: ExcelPreviewData | null
}

// 파일명에서 업체명(유치원 이름) 추출
// 예시 패턴 — "_" 뒤의 마지막 세그먼트가 업체명으로 관례화되어 있음:
//   "8월 급식 거래명세서_만안.xlsx"     → "만안"
//   "2024.12월 급식 거래명세서_로사.pdf" → "로사"
//   "25년6월검수일지_선경.xlsx"          → "선경"
//   "청정원 8월 거래명세서_예은.pdf"     → "예은"
// fallback: 파일명 전체에서 "명세서" 앞 부분
export function extractSupplierName(fileName: string): string {
  const nameWithoutExt = fileName.replace(/\.(pdf|xlsx|xls|heic|jpg|jpeg|png)$/i, '').trim()

  // 패턴 1: 마지막 언더스코어 뒤 부분 (가장 흔한 관례)
  const underscoreMatch = nameWithoutExt.match(/_([^_]+)$/)
  if (underscoreMatch && underscoreMatch[1]) {
    const candidate = underscoreMatch[1].trim()
    // 너무 길면(>10자) 아마 업체명이 아니라 수식어 → 다음 패턴으로
    if (candidate.length <= 10 && !/^\d+$/.test(candidate)) {
      return candidate
    }
  }

  // 패턴 2: "명세서"/"명세" 앞 부분의 마지막 단어
  const nameseoMatch = nameWithoutExt.match(/(.+?)(거래명세서|거래명세|명세서|명세|검수일지|검수)/)
  if (nameseoMatch && nameseoMatch[1]) {
    const beforeNamese = nameseoMatch[1].trim()
    // 마지막 공백 뒤 단어
    const words = beforeNamese.split(/\s+/).filter(Boolean)
    const lastWord = words[words.length - 1]
    if (lastWord && lastWord.length <= 10) return lastWord
  }

  // 최종 fallback: 파일명 그대로 (수동 수정 가능)
  return nameWithoutExt
}

// 액션 타입
type AuditAction =
  | { type: 'START_PROCESSING'; fileName: string; totalPages: number; supplierName: string }
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
  | { type: 'CONFIRM_ITEM'; itemId: string; supplier?: Supplier }  // supplier 추가
  | { type: 'CONFIRM_ALL_AUTO_MATCHED' }
  | { type: 'AUTO_EXCLUDE_UNMATCHED' }
  | { type: 'PROCEED_TO_REPORT' }
  | { type: 'BACK_TO_MATCHING' }
  // 재분석 액션
  | { type: 'START_REANALYZE'; pageNumber: number }
  | { type: 'REPLACE_PAGE_ITEMS'; pageNumber: number; items: ComparisonItem[] }
  | { type: 'COMPLETE_REANALYZE' }
  // 업체명 수정 / 비교 제외 (2026-04-21 추가)
  | { type: 'UPDATE_SUPPLIER_NAME'; supplierName: string }
  | { type: 'TOGGLE_EXCLUDE'; itemId: string; reason?: string }
  // 엑셀 담당자 확인 단계 (2026-04-21 추가)
  | { type: 'SET_EXCEL_PREVIEW'; preview: ExcelPreviewData }
  | { type: 'UPDATE_EXCEL_PREVIEW_ITEM'; rowIndex: number; patch: Partial<ExcelPreviewData['items'][number]> }
  | { type: 'REMOVE_EXCEL_PREVIEW_ITEM'; rowIndex: number }
  | { type: 'UPDATE_EXCEL_PREVIEW_SUPPLIER'; supplierName: string }
  | { type: 'CLEAR_EXCEL_PREVIEW' }

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
  supplierName: null,
  isReanalyzing: false,
  reanalyzingPage: null,
  excelPreview: null,
}

// 엑셀 preview 합계 불일치 카운트
// 검증: 공급가액 + 세액 = 총액 (공급가액이 없으면 quantity × unit_price로 계산)
function countMismatches(items: ExcelPreviewData['items']): number {
  return items.filter(i => {
    const supply = i.supply_amount ?? i.quantity * i.unit_price
    const expected = supply + (i.tax_amount ?? 0)
    return Math.abs(expected - i.total_price) > 1  // 1원 오차 허용
  }).length
}

function recalcExcelPreviewTotals(items: ExcelPreviewData['items']) {
  const totalAmount = items.reduce((s, i) => s + i.total_price, 0)
  const mismatchCount = countMismatches(items)
  return { totalAmount, mismatchCount }
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
    // 청구 총액 (세액 포함 총액 우선, 없으면 공급가액으로 대체)
    totalBilled += item.extracted_total_price ?? item.extracted_unit_price * item.extracted_quantity

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
        supplierName: action.supplierName,
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
      // 새 아이템에 공급사별 확정 필드 초기화
      const itemsWithConfirmation = action.items.map(item => ({
        ...item,
        cj_confirmed: item.cj_confirmed ?? false,
        ssg_confirmed: item.ssg_confirmed ?? false,
      }))
      const newItems = [...state.items, ...itemsWithConfirmation]
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

    // 업체명 수정 (inline edit) ─ 2026-04-21
    case 'UPDATE_SUPPLIER_NAME':
      return { ...state, supplierName: action.supplierName }

    // 비교 제외 토글 ─ 2026-04-21
    case 'TOGGLE_EXCLUDE': {
      const newItems = state.items.map((item) => {
        if (item.id !== action.itemId) return item
        return {
          ...item,
          is_excluded: !item.is_excluded,
          exclusion_reason: !item.is_excluded ? (action.reason ?? '담당자 제외') : undefined,
        }
      })
      return { ...state, items: newItems, stats: calculateStats(newItems) }
    }

    // 엑셀 preview (2026-04-21)
    case 'SET_EXCEL_PREVIEW':
      return {
        ...state,
        status: 'excel_preview',
        excelPreview: action.preview,
      }

    case 'UPDATE_EXCEL_PREVIEW_ITEM': {
      if (!state.excelPreview) return state
      // 수정 대상 행에만 patch 적용. 다른 행은 건드리지 않는다.
      // 자동 재계산:
      //  - 수량/단가 변경 → 공급가액 = quantity × unit_price (명시적 supply_amount patch가 없을 때만)
      //  - 공급가액/세액 변경 → 총액 = 공급가액 + 세액 (명시적 total_price patch가 없을 때만)
      const newItems = state.excelPreview.items.map((it) => {
        if (it.row_index !== action.rowIndex) return it
        const merged = { ...it, ...action.patch }
        const qtyOrPriceChanged = 'quantity' in action.patch || 'unit_price' in action.patch
        if (qtyOrPriceChanged && !('supply_amount' in action.patch)) {
          merged.supply_amount = Math.round(merged.quantity * merged.unit_price)
        }
        const supplyOrTaxChanged = qtyOrPriceChanged || 'supply_amount' in action.patch || 'tax_amount' in action.patch
        if (supplyOrTaxChanged && !('total_price' in action.patch)) {
          const supply = merged.supply_amount ?? merged.quantity * merged.unit_price
          merged.total_price = Math.round(supply + (merged.tax_amount ?? 0))
        }
        return merged
      })
      const totals = recalcExcelPreviewTotals(newItems)
      return {
        ...state,
        excelPreview: { ...state.excelPreview, items: newItems, ...totals },
      }
    }

    case 'REMOVE_EXCEL_PREVIEW_ITEM': {
      if (!state.excelPreview) return state
      const newItems = state.excelPreview.items.filter((it) => it.row_index !== action.rowIndex)
      const totals = recalcExcelPreviewTotals(newItems)
      return {
        ...state,
        excelPreview: { ...state.excelPreview, items: newItems, ...totals },
      }
    }

    case 'UPDATE_EXCEL_PREVIEW_SUPPLIER':
      if (!state.excelPreview) return state
      return {
        ...state,
        excelPreview: { ...state.excelPreview, supplierName: action.supplierName },
      }

    case 'CLEAR_EXCEL_PREVIEW':
      return { ...state, status: 'empty', excelPreview: null }

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

        // 공급사별 확정 처리
        if (action.supplier) {
          const updatedItem = { ...item }
          if (action.supplier === 'CJ') {
            updatedItem.cj_confirmed = !item.cj_confirmed
          } else {
            updatedItem.ssg_confirmed = !item.ssg_confirmed
          }
          // 전체 확정 여부: 둘 중 하나라도 확정되면 true
          updatedItem.is_confirmed = updatedItem.cj_confirmed || updatedItem.ssg_confirmed
          updatedItem.match_status = updatedItem.is_confirmed ? 'manual_matched' as const : item.match_status
          return updatedItem
        }

        // supplier가 없으면 기존 방식 (전체 토글)
        return {
          ...item,
          is_confirmed: !item.is_confirmed,
          cj_confirmed: !item.is_confirmed,
          ssg_confirmed: !item.is_confirmed,
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
      // 매칭 후보가 존재하는 모든 품목 일괄 확정 (담당자가 개별 검토 대신 한 번에 처리)
      // 매칭 score 낮아도 어차피 보고서에서 개별로 제외 토글 가능
      const newItems = state.items.map((item) => {
        if (item.is_confirmed) return item
        const hasAnyMatch = Boolean(item.cj_match || item.ssg_match)
        if (hasAnyMatch) {
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

    case 'AUTO_EXCLUDE_UNMATCHED': {
      // 매칭 없는 품목 일괄 제외 + 확정 (Susan 요구사항: 비교 불가 별지 처리)
      const newItems = state.items.map((item) => {
        if (item.is_confirmed) return item
        const hasAnyMatch = Boolean(item.cj_match || item.ssg_match)
        if (!hasAnyMatch) {
          return {
            ...item,
            is_excluded: true,
            exclusion_reason: '매칭 결과 없음 (자동 제외)',
            is_confirmed: true,
          }
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

      // 엑셀 파일인 경우 별도 처리
      if (isExcelFile(files[0])) {
        await processExcelFile(files[0])
        return
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
        throw new Error('지원하지 않는 파일 형식입니다. PDF, 이미지 또는 엑셀 파일을 업로드하세요.')
      }

      const supplierName = extractSupplierName(fileName)
      dispatch({ type: 'START_PROCESSING', fileName, totalPages: pages.length, supplierName })
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

  // 엑셀 파일 처리 — 1단계: 파싱 후 담당자 확인을 위한 preview 상태로 전환
  const processExcelFile = useCallback(async (file: File) => {
    try {
      // 클라이언트에서 엑셀 파싱
      const parseResult = await parseInvoiceExcel(file)

      if (!parseResult.success) {
        throw new Error(parseResult.error || '엑셀 파싱 실패')
      }

      console.log(`엑셀에서 ${parseResult.items.length}개 품목 추출`)

      const totalAmount = parseResult.items.reduce((s, i) => s + i.total_price, 0)
      const mismatchCount = countMismatches(parseResult.items as ExcelPreviewData['items'])

      const preview: ExcelPreviewData = {
        fileName: file.name,
        supplierName: extractSupplierName(file.name),
        items: parseResult.items as ExcelPreviewData['items'],
        totalAmount,
        mismatchCount,
      }

      dispatch({ type: 'SET_EXCEL_PREVIEW', preview })
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류'
      dispatch({ type: 'SET_ERROR', error: message })
    }
  }, [])

  // 엑셀 담당자 확인 완료 — 2단계: 실제 매칭 수행
  // preview 데이터를 명시적으로 인자로 받음 (state snapshot 문제 회피)
  const confirmAndAnalyzeExcel = useCallback(async (preview: ExcelPreviewData) => {
    try {
      dispatch({
        type: 'START_PROCESSING',
        fileName: preview.fileName,
        totalPages: 1,
        supplierName: preview.supplierName,
      })

      // 세션 초기화
      const initRes = await fetch('/api/session/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: preview.fileName, total_pages: 1 }),
      })
      if (!initRes.ok) throw new Error('세션 초기화 실패')
      const initData = await initRes.json()
      if (!initData.success) throw new Error(initData.message || '세션 초기화 실패')

      dispatch({ type: 'SET_SESSION_ID', sessionId: initData.session_id })
      dispatch({ type: 'UPDATE_PROCESSING_PAGE', page: 1 })

      // 배치로 나눠 매칭
      const BATCH_SIZE = 20
      const allItems = preview.items
      const batches: typeof allItems[] = []
      for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
        batches.push(allItems.slice(i, i + BATCH_SIZE))
      }

      for (const [batchIdx, batch] of batches.entries()) {
        const analyzeRes = await fetch('/api/analyze/excel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: initData.session_id, items: batch }),
        })
        if (!analyzeRes.ok) {
          const errorData = await analyzeRes.json().catch(() => ({}))
          throw new Error(errorData.error || `품목 매칭 실패 (배치 ${batchIdx + 1}/${batches.length})`)
        }
        const analyzeData = await analyzeRes.json()
        if (analyzeData.success && analyzeData.items) {
          dispatch({ type: 'ADD_PAGE_ITEMS', items: analyzeData.items })
        } else {
          throw new Error(analyzeData.error || '분석 결과가 없습니다.')
        }
      }

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

  const confirmItem = useCallback((itemId: string, supplier?: Supplier) => {
    dispatch({ type: 'CONFIRM_ITEM', itemId, supplier })
  }, [])

  const confirmAllAutoMatched = useCallback(() => {
    dispatch({ type: 'CONFIRM_ALL_AUTO_MATCHED' })
  }, [])

  const autoExcludeUnmatched = useCallback(() => {
    dispatch({ type: 'AUTO_EXCLUDE_UNMATCHED' })
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

  // 시나리오 계산 (CJ vs SSG) — 2026-04-21 개편
  // - is_excluded=true 품목은 "비교 불가" 별지로 이동, 절감액 계산에서 스킵
  // - grandTotalOurCost = 원장(거래명세표 전체 총액, 제외 품목 포함)
  // - totalOurCost = 비교 가능 품목의 총액 (비교 기준)
  // - excludedCount / excludedTotalCost = 별지 정보
  const scenarios = useMemo((): { cj: SupplierScenario; ssg: SupplierScenario } => {
    const items = state.items

    let grandTotal = 0
    let excludedCount = 0
    let excludedTotal = 0

    let cjComparableOur = 0
    let cjComparableSupplier = 0
    let cjMatchedCount = 0
    let cjComparableItems = 0

    let ssgComparableOur = 0
    let ssgComparableSupplier = 0
    let ssgMatchedCount = 0
    let ssgComparableItems = 0

    for (const item of items) {
      // 원장 기준 총액 (세액 포함). 없으면 공급가액으로 대체.
      const billedCost = item.extracted_total_price ?? item.extracted_unit_price * item.extracted_quantity
      grandTotal += billedCost

      if (item.is_excluded) {
        excludedCount++
        excludedTotal += billedCost
        continue  // 비교 제외 품목은 시나리오 계산에서 스킵
      }

      // CJ 시나리오 (비교 가능 품목만) — 우리측은 세액 포함 원장 기준
      cjComparableOur += billedCost
      cjComparableItems++
      if (item.cj_match) {
        cjComparableSupplier += item.cj_match.standard_price * item.extracted_quantity
        cjMatchedCount++
      } else {
        cjComparableSupplier += billedCost
      }

      // SSG 시나리오 (비교 가능 품목만)
      ssgComparableOur += billedCost
      ssgComparableItems++
      if (item.ssg_match) {
        ssgComparableSupplier += item.ssg_match.standard_price * item.extracted_quantity
        ssgMatchedCount++
      } else {
        ssgComparableSupplier += billedCost
      }
    }

    const cjSavings = Math.max(0, cjComparableOur - cjComparableSupplier)
    const ssgSavings = Math.max(0, ssgComparableOur - ssgComparableSupplier)

    return {
      cj: {
        supplier: 'CJ',
        totalOurCost: cjComparableOur,
        totalSupplierCost: cjComparableSupplier,
        totalSavings: cjSavings,
        savingsPercent: cjComparableOur > 0 ? (cjSavings / cjComparableOur) * 100 : 0,
        matchedCount: cjMatchedCount,
        unmatchedCount: cjComparableItems - cjMatchedCount,
        grandTotalOurCost: grandTotal,
        excludedCount,
        excludedTotalCost: excludedTotal,
      },
      ssg: {
        supplier: 'SHINSEGAE',
        totalOurCost: ssgComparableOur,
        totalSupplierCost: ssgComparableSupplier,
        totalSavings: ssgSavings,
        savingsPercent: ssgComparableOur > 0 ? (ssgSavings / ssgComparableOur) * 100 : 0,
        matchedCount: ssgMatchedCount,
        unmatchedCount: ssgComparableItems - ssgMatchedCount,
        grandTotalOurCost: grandTotal,
        excludedCount,
        excludedTotalCost: excludedTotal,
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

  // 업체명 수정 (inline edit) ─ 2026-04-21
  const updateSupplierName = useCallback((supplierName: string) => {
    dispatch({ type: 'UPDATE_SUPPLIER_NAME', supplierName })
  }, [])

  // 비교 제외 토글 ─ 2026-04-21
  const toggleExclude = useCallback((itemId: string, reason?: string) => {
    dispatch({ type: 'TOGGLE_EXCLUDE', itemId, reason })
  }, [])

  // 엑셀 담당자 확인 단계 액션들 (2026-04-21)
  const updateExcelPreviewItem = useCallback(
    (rowIndex: number, patch: Partial<ExcelPreviewData['items'][number]>) => {
      dispatch({ type: 'UPDATE_EXCEL_PREVIEW_ITEM', rowIndex, patch })
    },
    [],
  )
  const removeExcelPreviewItem = useCallback((rowIndex: number) => {
    dispatch({ type: 'REMOVE_EXCEL_PREVIEW_ITEM', rowIndex })
  }, [])
  const updateExcelPreviewSupplier = useCallback((supplierName: string) => {
    dispatch({ type: 'UPDATE_EXCEL_PREVIEW_SUPPLIER', supplierName })
  }, [])
  const clearExcelPreview = useCallback(() => {
    dispatch({ type: 'CLEAR_EXCEL_PREVIEW' })
  }, [])

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
    autoExcludeUnmatched,
    proceedToReport,
    backToMatching,
    scenarios,
    confirmationStats,
    // 재분석
    reanalyze,
    isReanalyzing: state.isReanalyzing,
    // 업체명 수정 / 비교 제외 (2026-04-21 추가)
    updateSupplierName,
    toggleExclude,
    // 엑셀 담당자 확인 단계 (2026-04-21 추가)
    confirmAndAnalyzeExcel,
    updateExcelPreviewItem,
    removeExcelPreviewItem,
    updateExcelPreviewSupplier,
    clearExcelPreview,
  }
}
