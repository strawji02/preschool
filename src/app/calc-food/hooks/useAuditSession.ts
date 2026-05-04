'use client'

import { useReducer, useCallback, useMemo, useEffect } from 'react'
import type { ComparisonItem, MatchCandidate, Supplier, SupplierMatch, SavingsResult, SupplierScenario } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { extractPagesFromPDF, imageFileToPage, extractBase64, isPDF, isImage } from '@/lib/pdf-processor'
import { parseInvoiceExcel, isExcelFile } from '@/lib/excel-parser'
import { estimateSsgTotal } from '@/lib/unit-conversion'

// 상태 타입
// 'excel_preview' — 2026-04-21 추가: 엑셀 파싱 후 담당자 확인 절차
// 'image_preview' — 2026-04-23 추가: PDF/이미지 OCR 완료 후 담당자 확인 절차 (엑셀과 UX 통일)
export type AuditStatus = 'empty' | 'excel_preview' | 'image_preview' | 'processing' | 'analysis' | 'error'

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

// 페이지별 OCR footer 합계 (2026-04-23 추가)
// 여러 파일의 거래명세표 다중 페이지를 처리할 때 각 페이지의 합계 금액을 담당자가 검증
export interface PageTotal {
  page: number              // 전역 페이지 번호
  ocr_total: number | null  // OCR이 읽은 footer 합계 (없으면 null)
  source_file?: string | null  // 원본 파일명 (여러 파일 업로드 시)
  reviewed?: boolean        // 검수자가 명시적으로 "검수 완료"로 마크 (2026-04-26)
}

export interface AuditState {
  status: AuditStatus
  currentStep: AnalysisStep  // 새로 추가: 매칭 → 리포트 단계
  sessionId: string | null
  pages: PageImage[]
  pageSourceFiles: string[]   // pages[i]가 속한 원본 파일명 (2026-04-23 추가)
  pageTotals: PageTotal[]     // 페이지별 OCR footer 합계 (2026-04-23 추가)
  currentPage: number
  items: ComparisonItem[]
  stats: SessionStats
  processingPage: number
  totalPages: number
  // 처리 시간 / 진행률 UX (2026-04-24 추가)
  processingStartedAt: number | null   // epoch ms — 업로드 시작 시각
  processingRetryRound: number          // 0=1차 처리, 1+=실패 페이지 재시도 라운드
  processingFailedPages: number         // 현재까지 실패한 페이지 수 (재시도 대상)
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
  | { type: 'SET_RETRY_ROUND'; round: number; failedCount: number }
  // 저장된 세션 불러오기 — 한 번에 state 복원 (2026-04-26)
  | {
      type: 'LOAD_SESSION'
      sessionId: string
      items: ComparisonItem[]
      pageTotals: PageTotal[]
      pageSourceFiles: string[]
      totalPages: number
      fileName: string
      supplierName: string
      currentStep: AnalysisStep
      enterStatus: 'image_preview' | 'analysis'
    }
  // 추가 업로드 시작 (기존 세션 유지) — pages/items/total은 누적 (2026-04-26)
  | { type: 'START_EXTEND'; addedPages: number }
  // 추가 업로드 완료 후 page 확장
  | { type: 'EXTEND_PAGES'; pages: PageImage[]; sourceFiles: string[] }
  | { type: 'SET_SESSION_ID'; sessionId: string }
  | { type: 'SET_PAGES'; pages: PageImage[]; sourceFiles?: string[] }
  | { type: 'ADD_PAGE_TOTAL'; pageNumber: number; ocrTotal: number | null; sourceFile?: string | null }
  // Phase 1 검수 단계 (2026-04-26): 행 inline edit + 추가 + 삭제 + OCR 합계 수정
  | { type: 'PATCH_ITEM'; itemId: string; patch: Partial<ComparisonItem> }
  | { type: 'REMOVE_ITEM'; itemId: string }
  | { type: 'ADD_ITEM'; item: ComparisonItem }
  | { type: 'UPDATE_PAGE_OCR_TOTAL'; pageNumber: number; ocrTotal: number | null }
  | { type: 'SET_PAGE_REVIEWED'; pageNumber: number; reviewed: boolean }
  // 페이지 재촬영 — 기존 페이지 items 모두 교체 (2026-04-26)
  | { type: 'REPLACE_PAGE_ITEMS_AT'; pageNumber: number; items: ComparisonItem[] }
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
  | { type: 'CONFIRM_ITEM'; itemId: string; supplier?: Supplier; adjustments?: { adjusted_quantity?: number; adjusted_unit_weight_g?: number; adjusted_pack_unit?: string } }  // supplier + 정밀 검수 조정값
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
  // PDF/이미지 담당자 확인 단계 (2026-04-23 추가)
  | { type: 'SHOW_IMAGE_PREVIEW' }
  | { type: 'CONFIRM_IMAGE_PREVIEW' }

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
  pageSourceFiles: [],
  pageTotals: [],
  currentPage: 1,
  items: [],
  stats: initialStats,
  processingPage: 0,
  totalPages: 0,
  processingStartedAt: null,
  processingRetryRound: 0,
  processingFailedPages: 0,
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
        processingStartedAt: Date.now(),
        processingRetryRound: 0,
        processingFailedPages: 0,
      }

    case 'SET_RETRY_ROUND':
      return {
        ...state,
        processingRetryRound: action.round,
        processingFailedPages: action.failedCount,
        processingPage: 0,  // 재시도 라운드는 진행률 0부터 재시작
        totalPages: action.failedCount,
      }

    case 'LOAD_SESSION':
      return {
        ...initialState,
        sessionId: action.sessionId,
        items: action.items,
        pageTotals: action.pageTotals,
        pageSourceFiles: action.pageSourceFiles,
        totalPages: action.totalPages,
        fileName: action.fileName,
        supplierName: action.supplierName,
        currentStep: action.currentStep,
        status: action.enterStatus,
        stats: calculateStats(action.items),
      }

    case 'START_EXTEND':
      // 추가 업로드 시작: 기존 세션 유지하되 진행률 표시를 위해 status='processing' 전환
      return {
        ...state,
        status: 'processing',
        processingPage: 0,
        totalPages: action.addedPages,
        processingStartedAt: Date.now(),
        processingRetryRound: 0,
        processingFailedPages: 0,
      }

    case 'EXTEND_PAGES':
      return {
        ...state,
        pages: [...state.pages, ...action.pages],
        pageSourceFiles: [...state.pageSourceFiles, ...action.sourceFiles],
        totalPages: state.pages.length + action.pages.length,
      }

    case 'SET_SESSION_ID':
      return { ...state, sessionId: action.sessionId }

    case 'SET_PAGES':
      return {
        ...state,
        pages: action.pages,
        pageSourceFiles: action.sourceFiles ?? state.pageSourceFiles,
      }

    case 'ADD_PAGE_TOTAL': {
      // 같은 페이지가 이미 있으면 대체, 없으면 추가
      const rest = state.pageTotals.filter((p) => p.page !== action.pageNumber)
      return {
        ...state,
        pageTotals: [
          ...rest,
          { page: action.pageNumber, ocr_total: action.ocrTotal, source_file: action.sourceFile ?? null },
        ].sort((a, b) => a.page - b.page),
      }
    }

    // Phase 1 검수 단계 액션 (2026-04-26)
    case 'PATCH_ITEM': {
      const newItems = state.items.map((it) =>
        it.id === action.itemId ? { ...it, ...action.patch } : it,
      )
      return { ...state, items: newItems, stats: calculateStats(newItems) }
    }

    case 'REMOVE_ITEM': {
      const newItems = state.items.filter((it) => it.id !== action.itemId)
      return { ...state, items: newItems, stats: calculateStats(newItems) }
    }

    case 'ADD_ITEM': {
      const newItems = [...state.items, action.item]
      return { ...state, items: newItems, stats: calculateStats(newItems) }
    }

    case 'UPDATE_PAGE_OCR_TOTAL': {
      const rest = state.pageTotals.filter((p) => p.page !== action.pageNumber)
      const existing = state.pageTotals.find((p) => p.page === action.pageNumber)
      return {
        ...state,
        pageTotals: [
          ...rest,
          {
            page: action.pageNumber,
            ocr_total: action.ocrTotal,
            source_file: existing?.source_file ?? null,
            reviewed: existing?.reviewed ?? false,
          },
        ].sort((a, b) => a.page - b.page),
      }
    }

    case 'REPLACE_PAGE_ITEMS_AT': {
      // 기존 page_number의 items 모두 제거 후 새 items로 교체
      const filtered = state.items.filter((it) => it.page_number !== action.pageNumber)
      const newItems = [...filtered, ...action.items]
      return {
        ...state,
        items: newItems,
        stats: calculateStats(newItems),
      }
    }

    case 'SET_PAGE_REVIEWED': {
      const newPageTotals = state.pageTotals.map((p) =>
        p.page === action.pageNumber ? { ...p, reviewed: action.reviewed } : p,
      )
      // 페이지가 pageTotals에 없는 경우 (OCR 합계가 없었던 페이지) 추가
      if (!state.pageTotals.some((p) => p.page === action.pageNumber)) {
        newPageTotals.push({
          page: action.pageNumber,
          ocr_total: null,
          source_file: null,
          reviewed: action.reviewed,
        })
      }
      return {
        ...state,
        pageTotals: newPageTotals.sort((a, b) => a.page - b.page),
      }
    }

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

    // PDF/이미지 OCR 완료 → 담당자 확인 단계 진입
    case 'SHOW_IMAGE_PREVIEW':
      return { ...state, status: 'image_preview' }

    // 담당자 확인 완료 → 매칭 단계 진입 (analysis status + matching step)
    case 'CONFIRM_IMAGE_PREVIEW':
      return { ...state, status: 'analysis', currentStep: 'matching' }

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

        // 정밀 검수 조정값 머지 (precision view에서 발주수량/단위중량/포장단위 수정 후 Confirm)
        const adj = action.adjustments
        const mergedAdjusted = adj
          ? {
              adjusted_quantity: adj.adjusted_quantity ?? item.adjusted_quantity,
              adjusted_unit_weight_g: adj.adjusted_unit_weight_g ?? item.adjusted_unit_weight_g,
              adjusted_pack_unit: adj.adjusted_pack_unit ?? item.adjusted_pack_unit,
              precision_reviewed_at: new Date().toISOString(),
            }
          : {}

        // 공급사별 확정 처리
        if (action.supplier) {
          const updatedItem = { ...item, ...mergedAdjusted }
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
          ...mergedAdjusted,
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

  // 저장된 세션 불러오기 (2026-04-26)
  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`)
      if (!res.ok) throw new Error(`세션 불러오기 실패 (HTTP ${res.status})`)
      const data = await res.json()
      if (!data.success || !data.session) {
        throw new Error(data.error || '세션 데이터가 비어 있습니다')
      }
      const session = data.session as {
        id: string
        name: string
        kindergarten_name: string | null
        total_pages: number
        current_step: string
        page_totals: PageTotal[] | null
      }
      const items = (data.items as ComparisonItem[]) ?? []
      const pageTotals = (session.page_totals ?? []) as PageTotal[]
      const pageSourceFiles: string[] = []
      // page_number → source_file_name 매핑 (items에서 추출)
      const fileByPage = new Map<number, string>()
      for (const it of items) {
        if (it.page_number != null && it.source_file_name) {
          fileByPage.set(it.page_number, it.source_file_name)
        }
      }
      for (let p = 1; p <= session.total_pages; p++) {
        pageSourceFiles.push(fileByPage.get(p) ?? '')
      }
      // 어느 단계로 진입할지: matching/report면 analysis, 아니면 image_preview
      const enterStatus =
        session.current_step === 'matching' || session.current_step === 'report'
          ? 'analysis'
          : 'image_preview'
      const currentStep: AnalysisStep =
        session.current_step === 'report' ? 'report' : 'matching'

      dispatch({
        type: 'LOAD_SESSION',
        sessionId: session.id,
        items,
        pageTotals,
        pageSourceFiles,
        totalPages: session.total_pages,
        fileName: session.name,
        supplierName: session.kindergarten_name || extractSupplierName(session.name),
        currentStep,
        enterStatus,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류'
      dispatch({ type: 'SET_ERROR', error: message })
    }
  }, [])

  // ─── Phase 1 검수 단계 메서드 (2026-04-26) ───────────────────────────────
  // 행 inline edit (수량/단가/공급가액/세액/총액/품목명/규격/단위)
  // state 즉시 갱신 + DB 백그라운드 PATCH (낙관적 업데이트)
  const updateItem = useCallback(
    async (itemId: string, patch: Partial<ComparisonItem>) => {
      // state는 즉시 반영
      dispatch({ type: 'PATCH_ITEM', itemId, patch })
      // DB 필드 매핑 (ComparisonItem → audit_items 컬럼)
      const dbPatch: Record<string, unknown> = {}
      const map: Record<string, string> = {
        extracted_name: 'extracted_name',
        extracted_spec: 'extracted_spec',
        extracted_unit: 'extracted_unit',
        extracted_quantity: 'extracted_quantity',
        extracted_unit_price: 'extracted_unit_price',
        extracted_supply_amount: 'extracted_supply_amount',
        extracted_tax_amount: 'extracted_tax_amount',
        extracted_total_price: 'extracted_total_price',
      }
      for (const [k, v] of Object.entries(patch)) {
        if (map[k] !== undefined) dbPatch[map[k]] = v
      }
      if (Object.keys(dbPatch).length === 0) return
      try {
        await fetch(`/api/audit-items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dbPatch),
        })
      } catch (e) {
        console.warn('행 DB 업데이트 실패 (state는 유지됨):', e)
      }
    },
    [],
  )

  // 행 삭제 (state + DB)
  const removeItem = useCallback(async (itemId: string) => {
    dispatch({ type: 'REMOVE_ITEM', itemId })
    try {
      await fetch(`/api/audit-items/${itemId}`, { method: 'DELETE' })
    } catch (e) {
      console.warn('행 삭제 실패 (state는 유지됨):', e)
    }
  }, [])

  // 행 추가 (수동 입력) — 페이지에 새 행 추가
  // 입력 검증은 호출 측에서 수행
  const addItem = useCallback(
    async (
      pageNumber: number,
      sourceFile: string | null,
      data: {
        extracted_name: string
        extracted_spec?: string
        extracted_unit?: string
        extracted_quantity: number
        extracted_unit_price: number
        extracted_supply_amount?: number
        extracted_tax_amount?: number
        extracted_total_price?: number
      },
    ) => {
      if (!state.sessionId) {
        dispatch({ type: 'SET_ERROR', error: '세션이 없습니다.' })
        return
      }
      try {
        const res = await fetch('/api/audit-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: state.sessionId,
            page_number: pageNumber,
            source_file_name: sourceFile,
            ...data,
          }),
        })
        const body = await res.json()
        if (!body.success || !body.item_id) {
          throw new Error(body.error || '행 추가 실패')
        }
        const newItem: ComparisonItem = {
          id: body.item_id,
          extracted_name: data.extracted_name,
          extracted_spec: data.extracted_spec,
          extracted_unit: data.extracted_unit,
          extracted_quantity: data.extracted_quantity,
          extracted_unit_price: data.extracted_unit_price,
          extracted_supply_amount: data.extracted_supply_amount,
          extracted_tax_amount: data.extracted_tax_amount,
          extracted_total_price: data.extracted_total_price,
          page_number: pageNumber,
          source_file_name: sourceFile ?? undefined,
          cj_match: undefined,
          ssg_match: undefined,
          cj_candidates: [],
          ssg_candidates: [],
          is_confirmed: false,
          cj_confirmed: false,
          ssg_confirmed: false,
          savings: { cj: 0, ssg: 0, max: 0 },
          match_status: 'unmatched',
          is_excluded: false,
        }
        dispatch({ type: 'ADD_ITEM', item: newItem })
      } catch (e) {
        const msg = e instanceof Error ? e.message : '행 추가 오류'
        dispatch({ type: 'SET_ERROR', error: msg })
      }
    },
    [state.sessionId],
  )

  // 페이지 검수 완료 토글 — state + DB 동기화 (2026-04-26)
  const togglePageReviewed = useCallback(
    async (pageNumber: number) => {
      if (!state.sessionId) return
      // 현재 페이지의 reviewed 상태 토글
      const existing = state.pageTotals.find((p) => p.page === pageNumber)
      const newReviewed = !(existing?.reviewed ?? false)

      // state 즉시 갱신
      const rest = state.pageTotals.filter((p) => p.page !== pageNumber)
      const updated: PageTotal[] = [
        ...rest,
        {
          page: pageNumber,
          ocr_total: existing?.ocr_total ?? null,
          source_file: existing?.source_file ?? null,
          reviewed: newReviewed,
        },
      ].sort((a, b) => a.page - b.page)

      dispatch({
        type: 'UPDATE_PAGE_OCR_TOTAL',
        pageNumber,
        ocrTotal: existing?.ocr_total ?? null,
      })
      // 별도 액션 없이 ADD_PAGE_TOTAL을 reviewed 포함으로 갱신하기 위해 reducer 의존성에 추가 필요
      // 임시: state.pageTotals에 reviewed 반영 위해 ADD_PAGE_TOTAL 사용 + reducer 단언
      dispatch({ type: 'ADD_PAGE_TOTAL', pageNumber, ocrTotal: existing?.ocr_total ?? null, sourceFile: existing?.source_file ?? null })

      // DB에 저장 (page_totals 배열 전체 재저장)
      try {
        await fetch('/api/session/page-totals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: state.sessionId, page_totals: updated }),
        })
        // 성공 후 state도 reviewed 반영하기 위해 한 번 더 dispatch (ADD_PAGE_TOTAL은 reviewed를 무시하므로
        // 직접 setState는 불가. 대신 새 액션 추가 — 아래에서 처리)
      } catch (e) {
        console.warn('검수 완료 토글 DB 동기화 실패:', e)
      }
      // state에 reviewed 반영을 위해 새 액션 사용
      dispatch({ type: 'SET_PAGE_REVIEWED', pageNumber, reviewed: newReviewed })
    },
    [state.sessionId, state.pageTotals],
  )

  // 페이지 OCR 합계 수정 — state 즉시 갱신 + DB 일괄 저장 (page_totals 배열 전체 재저장)
  const updatePageOcrTotal = useCallback(
    async (pageNumber: number, ocrTotal: number | null) => {
      dispatch({ type: 'UPDATE_PAGE_OCR_TOTAL', pageNumber, ocrTotal })
      if (!state.sessionId) return
      // 즉시 백엔드 동기화 — 최신 pageTotals를 새로 계산해서 보냄
      const updated = state.pageTotals.map((p) =>
        p.page === pageNumber ? { ...p, ocr_total: ocrTotal } : p,
      )
      // 만약 해당 페이지가 없으면 추가
      if (!state.pageTotals.some((p) => p.page === pageNumber)) {
        updated.push({ page: pageNumber, ocr_total: ocrTotal, source_file: null })
      }
      try {
        await fetch('/api/session/page-totals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: state.sessionId,
            page_totals: updated.sort((a, b) => a.page - b.page),
          }),
        })
      } catch (e) {
        console.warn('OCR 합계 DB 동기화 실패 (state는 유지됨):', e)
      }
    },
    [state.sessionId, state.pageTotals],
  )

  // 페이지 재촬영 — 특정 페이지를 새 사진으로 교체 (2026-04-26)
  // 기존 audit_items + Storage 이미지 모두 덮어쓰기, page_number 유지
  const replacePage = useCallback(
    async (pageNumber: number, file: File) => {
      if (!state.sessionId) {
        dispatch({ type: 'SET_ERROR', error: '활성 세션이 없습니다.' })
        return
      }
      if (!isImage(file) && !isPDF(file)) {
        dispatch({ type: 'SET_ERROR', error: '이미지 또는 PDF만 업로드 가능합니다.' })
        return
      }
      const baseSessionId = state.sessionId
      const sourceFile = file.name

      try {
        // 1. 페이지 추출 — 단일 이미지/PDF 첫 페이지만
        let dataUrl: string
        if (isImage(file)) {
          const imgPage = await imageFileToPage(file, pageNumber)
          dataUrl = imgPage.dataUrl
        } else {
          // PDF: 첫 페이지만 사용 (재촬영 시나리오상 단일 페이지가 자연스러움)
          const pdfPages = await extractPagesFromPDF(file)
          if (pdfPages.length === 0) throw new Error('PDF에서 페이지를 추출할 수 없습니다')
          dataUrl = pdfPages[0].dataUrl
        }

        // 2. analyze API 호출 (replace_existing=true → 기존 items 삭제 후 재처리)
        const analyzeRes = await fetch('/api/analyze/page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: baseSessionId,
            page_number: pageNumber,
            image: extractBase64(dataUrl),
            source_file_name: sourceFile,
            replace_existing: true,
          }),
        })

        if (!analyzeRes.ok) {
          let serverErrMsg = ''
          try {
            const errBody = await analyzeRes.json()
            serverErrMsg = errBody?.error || ''
          } catch { /* ignore */ }
          throw new Error(serverErrMsg || `재촬영 분석 실패 (HTTP ${analyzeRes.status})`)
        }

        const analyzeData = await analyzeRes.json()
        if (!analyzeData.success || !Array.isArray(analyzeData.items)) {
          throw new Error(analyzeData.error || '재촬영 분석 결과 없음')
        }

        // 3. state 업데이트 — 기존 페이지 items 삭제 후 새 items로 교체
        dispatch({
          type: 'REPLACE_PAGE_ITEMS_AT',
          pageNumber,
          items: analyzeData.items as ComparisonItem[],
        })

        // 4. page_totals 갱신 (해당 페이지의 reviewed=false 리셋)
        const newOcrTotal =
          analyzeData.page_total != null ? Number(analyzeData.page_total) : null
        dispatch({
          type: 'ADD_PAGE_TOTAL',
          pageNumber,
          ocrTotal: newOcrTotal,
          sourceFile,
        })
        // reviewed 상태도 리셋 (재촬영 후 다시 검수 필요)
        dispatch({ type: 'SET_PAGE_REVIEWED', pageNumber, reviewed: false })

        // 5. pageSourceFiles 업데이트 (해당 페이지의 source 파일명 갱신)
        // (state.pageSourceFiles는 직접 변경할 수 없으므로 SET_PAGES 액션 활용)
        const newSources = [...state.pageSourceFiles]
        newSources[pageNumber - 1] = sourceFile
        dispatch({ type: 'SET_PAGES', pages: state.pages, sourceFiles: newSources })

        // 6. session 백엔드의 page_totals JSONB 갱신
        try {
          const updated = state.pageTotals
            .filter((p) => p.page !== pageNumber)
            .concat({
              page: pageNumber,
              ocr_total: newOcrTotal,
              source_file: sourceFile,
              reviewed: false,
            })
            .sort((a, b) => a.page - b.page)
          await fetch('/api/session/page-totals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: baseSessionId, page_totals: updated }),
          })
        } catch (e) {
          console.warn('재촬영 후 page-totals 동기화 실패:', e)
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : '재촬영 처리 오류'
        dispatch({ type: 'SET_ERROR', error: msg })
      }
    },
    [state.sessionId, state.pages, state.pageSourceFiles, state.pageTotals],
  )

  // 추가 업로드 — 기존 세션에 페이지/품목 누적 (2026-04-26)
  // 시작 페이지 번호는 현재 totalPages + 1부터 부여, 같은 session_id로 OCR 호출
  const extendSession = useCallback(
    async (files: File[]) => {
      if (!state.sessionId) {
        dispatch({ type: 'SET_ERROR', error: '활성 세션이 없습니다. 먼저 세션을 불러오세요.' })
        return
      }
      if (files.length === 0) {
        dispatch({ type: 'SET_ERROR', error: '파일을 선택해주세요.' })
        return
      }
      // 엑셀은 추가 업로드 미지원 (단일 시트 가정)
      if (files.some((f) => isExcelFile(f))) {
        dispatch({ type: 'SET_ERROR', error: '엑셀은 추가 업로드를 지원하지 않습니다. PDF/이미지만 가능합니다.' })
        return
      }

      const baseSessionId = state.sessionId
      const startPageNum = state.totalPages + 1

      // 1. 새 페이지 추출
      const newPages: PageImage[] = []
      const newSourceFiles: string[] = []
      let nextNum = startPageNum
      try {
        for (const file of files) {
          if (isPDF(file)) {
            const pdfPages = await extractPagesFromPDF(file)
            for (const p of pdfPages) {
              newPages.push({ ...p, pageNumber: nextNum })
              newSourceFiles.push(file.name)
              nextNum += 1
            }
          } else if (isImage(file)) {
            const imgPage = await imageFileToPage(file, nextNum)
            newPages.push(imgPage)
            newSourceFiles.push(file.name)
            nextNum += 1
          } else {
            throw new Error(`지원하지 않는 파일 형식: ${file.name}`)
          }
        }
        if (newPages.length === 0) throw new Error('추출된 페이지가 없습니다.')
      } catch (error) {
        const message = error instanceof Error ? error.message : '파일 처리 오류'
        dispatch({ type: 'SET_ERROR', error: message })
        return
      }

      dispatch({ type: 'START_EXTEND', addedPages: newPages.length })

      // 2. 페이지별 OCR (순차 + 5초 지연, processFiles와 동일 로직)
      const DELAY_MS = 5000
      const collectedTotals: PageTotal[] = []
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

      const analyzeOnePage = async (
        pageNumber: number,
        page: PageImage,
        sourceFile: string,
      ): Promise<boolean> => {
        try {
          const analyzeRes = await fetch('/api/analyze/page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: baseSessionId,
              page_number: pageNumber,
              image: extractBase64(page.dataUrl),
              source_file_name: sourceFile,
            }),
          })
          if (!analyzeRes.ok) {
            console.error(`추가 페이지 ${pageNumber} 분석 실패 (HTTP ${analyzeRes.status})`)
            return false
          }
          const analyzeData = await analyzeRes.json()
          if (analyzeData.success && Array.isArray(analyzeData.items)) {
            dispatch({ type: 'ADD_PAGE_ITEMS', items: analyzeData.items })
            const ocrTotal =
              analyzeData.page_total != null ? Number(analyzeData.page_total) : null
            dispatch({ type: 'ADD_PAGE_TOTAL', pageNumber, ocrTotal, sourceFile })
            collectedTotals.push({ page: pageNumber, ocr_total: ocrTotal, source_file: sourceFile })
            return true
          }
          return false
        } catch (err) {
          console.error(`추가 페이지 ${pageNumber} 요청 오류:`, err)
          return false
        }
      }

      let completedCount = 0
      for (let i = 0; i < newPages.length; i++) {
        const page = newPages[i]
        const sourceFile = newSourceFiles[i]
        const pageNumber = startPageNum + i
        await analyzeOnePage(pageNumber, page, sourceFile)
        completedCount += 1
        dispatch({ type: 'UPDATE_PROCESSING_PAGE', page: completedCount })
        if (i < newPages.length - 1) await sleep(DELAY_MS)
      }

      // 3. pages 누적 + total_pages 업데이트
      dispatch({ type: 'EXTEND_PAGES', pages: newPages, sourceFiles: newSourceFiles })

      // 4. 세션 메타 업데이트 (백엔드)
      try {
        await fetch(`/api/sessions/${baseSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            total_pages: startPageNum + newPages.length - 1,
            current_step: 'image_preview',
          }),
        })
      } catch { /* ignore */ }

      // 5. page_totals append (기존 + 신규)
      try {
        await fetch('/api/session/page-totals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: baseSessionId,
            page_totals: [...state.pageTotals, ...collectedTotals].sort((a, b) => a.page - b.page),
          }),
        })
      } catch { /* ignore */ }

      // 6. 확인 단계로 전환
      dispatch({ type: 'SHOW_IMAGE_PREVIEW' })
    },
    [state.sessionId, state.totalPages, state.pageTotals],
  )

  // 세션 메타데이터 자동 업데이트 — sessionId/currentStep/status 변경 시 백엔드에 PATCH (2026-04-26)
  useEffect(() => {
    if (!state.sessionId) return
    // 저장 단계 결정
    let stepToSave: string | null = null
    if (state.status === 'image_preview') stepToSave = 'image_preview'
    else if (state.status === 'analysis') {
      stepToSave = state.currentStep === 'report' ? 'report' : 'matching'
    }
    if (!stepToSave) return

    const payload: Record<string, unknown> = { current_step: stepToSave }
    if (state.supplierName) payload.kindergarten_name = state.supplierName

    // fire-and-forget (실패해도 UX 무영향)
    fetch(`/api/sessions/${state.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((e) => console.warn('세션 자동 업데이트 실패:', e))
  }, [state.sessionId, state.status, state.currentStep, state.supplierName])

  const processFiles = useCallback(async (files: File[]) => {
    try {
      if (files.length === 0) {
        throw new Error('파일을 선택해주세요.')
      }

      // 엑셀 파일인 경우 별도 처리 (단일 엑셀만 지원)
      if (files.some((f) => isExcelFile(f))) {
        if (files.length > 1 || !isExcelFile(files[0])) {
          throw new Error('엑셀 파일은 단일 파일로만 업로드 가능합니다.')
        }
        await processExcelFile(files[0])
        return
      }

      // 1. 파일 타입별 페이지 추출 (PDF/이미지 혼합 지원, 2026-04-23)
      // 각 파일이 이미지 또는 PDF 중 하나. 여러 PDF + 여러 이미지 혼합도 OK.
      const allPages: PageImage[] = []
      const pageSourceFiles: string[] = []
      let globalPageNum = 1

      for (const file of files) {
        if (isPDF(file)) {
          const pdfPages = await extractPagesFromPDF(file)
          for (const p of pdfPages) {
            allPages.push({ ...p, pageNumber: globalPageNum })
            pageSourceFiles.push(file.name)
            globalPageNum += 1
          }
        } else if (isImage(file)) {
          const imgPage = await imageFileToPage(file, globalPageNum)
          allPages.push(imgPage)
          pageSourceFiles.push(file.name)
          globalPageNum += 1
        } else {
          throw new Error(`지원하지 않는 파일 형식: ${file.name}`)
        }
      }

      if (allPages.length === 0) {
        throw new Error('추출된 페이지가 없습니다. PDF 또는 이미지 파일을 업로드하세요.')
      }

      // 파일 여러 개 업로드 시 파일명 조합 표시
      const fileName =
        files.length === 1
          ? files[0].name
          : `${files[0].name} 외 ${files.length - 1}개 (총 ${allPages.length}페이지)`

      const supplierName = extractSupplierName(files[0].name)
      dispatch({
        type: 'START_PROCESSING',
        fileName,
        totalPages: allPages.length,
        supplierName,
      })
      dispatch({ type: 'SET_PAGES', pages: allPages, sourceFiles: pageSourceFiles })

      // 2. 세션 초기화 API 호출
      const initRes = await fetch('/api/session/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fileName,
          total_pages: allPages.length,
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

      // 3. 페이지 분석 — 순차 처리 + 5초 간격 (Gemini 2.5-flash 무료 티어 10 RPM 대응, 2026-04-24)
      // 품질 우선 + rate limit 회피. 14장 기준 평균 ~3분, 실패 재시도 포함 5~8분 예상.
      const DELAY_MS = 5000
      const collectedTotals: PageTotal[] = []
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

      // 단일 페이지 분석 함수 (재사용 가능)
      const analyzeOnePage = async (
        pageNumber: number,
        page: PageImage,
        sourceFile: string,
      ): Promise<boolean> => {
        try {
          const analyzeRes = await fetch('/api/analyze/page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: initData.session_id,
              page_number: pageNumber,
              image: extractBase64(page.dataUrl),
              source_file_name: sourceFile,
            }),
          })

          if (!analyzeRes.ok) {
            let serverErrMsg = ''
            try {
              const errBody = await analyzeRes.json()
              serverErrMsg = errBody?.error || ''
            } catch {
              try { serverErrMsg = await analyzeRes.text() } catch { /* ignore */ }
            }
            console.error(
              `페이지 ${pageNumber} 분석 실패 (HTTP ${analyzeRes.status}): ${serverErrMsg || '(no error body)'}`,
            )
            return false
          }

          const analyzeData = await analyzeRes.json()
          if (analyzeData.success && Array.isArray(analyzeData.items)) {
            dispatch({ type: 'ADD_PAGE_ITEMS', items: analyzeData.items })
            const ocrTotal =
              analyzeData.page_total != null ? Number(analyzeData.page_total) : null
            dispatch({ type: 'ADD_PAGE_TOTAL', pageNumber, ocrTotal, sourceFile })
            collectedTotals.push({ page: pageNumber, ocr_total: ocrTotal, source_file: sourceFile })
            return true
          }
          return false
        } catch (err) {
          console.error(`페이지 ${pageNumber} 요청 오류:`, err)
          return false
        }
      }

      // 1차 처리: 모든 페이지 순차
      const failedIndexes: number[] = []   // allPages 기준 인덱스
      let completedCount = 0
      for (let i = 0; i < allPages.length; i++) {
        const pageNumber = i + 1
        const sourceFile = pageSourceFiles[i]
        const ok = await analyzeOnePage(pageNumber, allPages[i], sourceFile)
        completedCount += 1
        dispatch({ type: 'UPDATE_PROCESSING_PAGE', page: completedCount })
        if (!ok) failedIndexes.push(i)
        // 다음 페이지 전 지연 (마지막은 생략)
        if (i < allPages.length - 1) {
          await sleep(DELAY_MS)
        }
      }

      // 재시도 라운드: 실패한 페이지만 더 긴 지연으로 재처리 (최대 3 라운드)
      const MAX_RETRY_ROUNDS = 3
      let remaining = [...failedIndexes]
      for (let round = 1; round <= MAX_RETRY_ROUNDS && remaining.length > 0; round++) {
        dispatch({ type: 'SET_RETRY_ROUND', round, failedCount: remaining.length })
        // 라운드 시작 전 긴 쿨다운 (rate window 회복)
        await sleep(15_000)

        const stillFailed: number[] = []
        let retryCompleted = 0
        for (const i of remaining) {
          const pageNumber = i + 1
          const sourceFile = pageSourceFiles[i]
          const ok = await analyzeOnePage(pageNumber, allPages[i], sourceFile)
          retryCompleted += 1
          dispatch({ type: 'UPDATE_PROCESSING_PAGE', page: retryCompleted })
          if (!ok) stillFailed.push(i)
          await sleep(DELAY_MS + round * 3000)  // 라운드마다 지연 증가
        }
        remaining = stillFailed
      }

      // 4. 페이지별 OCR footer 합계를 session에 일괄 저장
      if (collectedTotals.length > 0) {
        try {
          await fetch('/api/session/page-totals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: initData.session_id,
              page_totals: collectedTotals.sort((a, b) => a.page - b.page),
            }),
          })
        } catch (e) {
          console.warn('page-totals 저장 실패:', e)
        }
      }

      // 5. OCR + 매칭 완료 → 담당자 확인 단계로 진입 (엑셀과 UX 통일)
      dispatch({ type: 'SHOW_IMAGE_PREVIEW' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류'
      dispatch({ type: 'SET_ERROR', error: message })
    }
  }, [])

  // 담당자 확인 완료 → 매칭 단계 진입 (PDF/이미지)
  const confirmImagePreview = useCallback(() => {
    dispatch({ type: 'CONFIRM_IMAGE_PREVIEW' })
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

  // 2-Step Workflow 함수들 (2026-05-04: DB 저장 추가 — 새로고침 후 보존)
  const selectCandidate = useCallback(
    (itemId: string, supplier: Supplier, candidate: SupplierMatch) => {
      dispatch({ type: 'SELECT_CANDIDATE', itemId, supplier, candidate })
      // DB 저장: 빈 매칭(id 없음)은 매칭 제거, 그 외는 매칭 변경
      const isClearMatch = !candidate.id
      void fetch(`/api/audit-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matched_product_id: isClearMatch ? null : candidate.id,
          standard_price: isClearMatch ? null : candidate.standard_price,
          match_score: isClearMatch ? null : candidate.match_score,
          match_status: isClearMatch ? 'unmatched' : 'manual_matched',
        }),
      }).catch((e) => console.warn('selectCandidate DB 저장 실패:', e))
    },
    []
  )

  const confirmItem = useCallback(
    (
      itemId: string,
      supplier?: Supplier,
      adjustments?: { adjusted_quantity?: number; adjusted_unit_weight_g?: number; adjusted_pack_unit?: string },
    ) => {
      dispatch({ type: 'CONFIRM_ITEM', itemId, supplier, adjustments })
      // DB 저장: 매칭 상태 + 정밀 검수 조정값 (있으면)
      const body: Record<string, unknown> = { match_status: 'manual_matched' }
      if (adjustments) {
        if (adjustments.adjusted_quantity !== undefined) body.adjusted_quantity = adjustments.adjusted_quantity
        if (adjustments.adjusted_unit_weight_g !== undefined) body.adjusted_unit_weight_g = adjustments.adjusted_unit_weight_g
        if (adjustments.adjusted_pack_unit !== undefined) body.adjusted_pack_unit = adjustments.adjusted_pack_unit
        body.precision_reviewed_at = new Date().toISOString()
      }
      void fetch(`/api/audit-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch((e) => console.warn('confirmItem DB 저장 실패:', e))
    },
    [],
  )

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

      // SSG 시나리오 (비교 가능 품목만) — 정밀 환산 사용 (매칭 화면 KPI와 통일)
      // ppk × 단위중량 × adjusted_qty (단위중량/포장이 다른 매칭에서 정확)
      ssgComparableOur += billedCost
      ssgComparableItems++
      if (item.ssg_match) {
        ssgComparableSupplier += estimateSsgTotal(item)
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
    // PDF/이미지 담당자 확인 단계 (2026-04-23 추가)
    confirmImagePreview,
    // 세션 저장/이어가기/추가 업로드 (2026-04-26 추가)
    loadSession,
    extendSession,
    // Phase 1 검수 단계 — 페이지 재촬영 (2026-04-26)
    replacePage,
    // Phase 1 검수 단계 — 행 inline edit / 추가 / 삭제 / OCR 합계 수정 (2026-04-26)
    updateItem,
    removeItem,
    addItem,
    updatePageOcrTotal,
    // Phase 2 페이지별 검수 완료 토글 (2026-04-26)
    togglePageReviewed,
  }
}
