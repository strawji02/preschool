import type { SettlementSource } from '../parse/types'

/**
 * 업로드된 워크북에서 원천 시트를 찾아낸다.
 *
 * **시트명으로 판별하지 않는다.** 담당자가 매월 신세계·CJ에서 직접 내려받아 편집하는
 * 파일이라 시트명이 바뀔 수 있고, 통합 파일 하나로 올릴 수도 있고 두 개로 나눠
 * 올릴 수도 있다. 게다가 `신세계_전체 집계표`처럼 **이름은 비슷하지만 쓰면 안 되는
 * 시트**가 같은 파일에 있다.
 *
 * 그래서 헤더 내용으로 판별한다 (2026-07-29 실측):
 * - 신세계 품목 시트 → 헤더에 `면과세` + `품목코드`
 * - CJ 집계표      → 헤더에 `사업장코드`
 * - CJ 거래명세서   → 헤더에 `상품코드` + `주문량` (2026-07-31 추가)
 *
 * ⚠️ 신세계는 `품목코드`·`수량`, 거래명세서는 `상품코드`·`주문량`으로 **낱말이 다르다.**
 * 우연이 아니라 실측 결과이고, 셋이 겹치지 않아 판별이 갈리지 않는다.
 */

/** 원천 시트 종류. 거래명세서는 정산 산식에 직접 안 들어가서 `SettlementSource`가 아니다. */
export type SheetKind = SettlementSource | 'cjStatement'

/** 헤더를 찾기 위해 훑어볼 상단 행 수. 제목 행이 앞에 붙어 있는 경우를 흡수한다. */
const HEADER_SCAN_ROWS = 5

export function detectSheetKind(rows: readonly unknown[][]): SheetKind | null {
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rows.length); i++) {
    const labels = (rows[i] ?? []).map(normalizeLabel).filter(Boolean)
    if (labels.length === 0) continue

    // 신세계가 먼저다 — 품목 시트가 우리가 원하는 것이고 판별 근거가 더 구체적이다
    if (labels.includes('면과세') && labels.includes('품목코드')) return 'shinsegae'
    if (labels.includes('사업장코드')) return 'cj'
    if (labels.includes('상품코드') && labels.includes('주문량')) return 'cjStatement'
  }
  return null
}

/** 라벨 비교용 정규화 — 공백 제거 후 비교한다 (` 사업장 코드 ` → `사업장코드`) */
function normalizeLabel(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  return String(cell).replace(/\s+/g, '')
}

export interface UploadedSheet {
  name: string
  rows: unknown[][]
}

export interface UploadedWorkbook {
  fileName: string
  sheets: UploadedSheet[]
}

export interface PickedSheet {
  fileName: string
  sheetName: string
  rows: unknown[][]
}

export interface PickSheetsResult {
  shinsegae: PickedSheet | null
  cj: PickedSheet | null
  /**
   * CJ 거래명세서 — **없어도 진행한다.**
   *
   * 2026-07-31부터 함께 받기로 했지만, 그 전 달(26년 6월 등)을 다시 올릴 수
   * 있어야 한다. 없으면 경고만 남기고 교차검증을 건너뛴다.
   */
  cjStatement: PickedSheet | null
  /** 필수 시트를 못 찾은 경우 — 처리를 진행할 수 없다 */
  errors: string[]
  /** 진행은 가능하지만 사람이 확인해야 하는 사항 */
  warnings: string[]
}

export function pickSourceSheets(
  workbooks: readonly UploadedWorkbook[]
): PickSheetsResult {
  const found: Record<SheetKind, PickedSheet[]> = { shinsegae: [], cj: [], cjStatement: [] }

  for (const wb of workbooks) {
    for (const sheet of wb.sheets) {
      const kind = detectSheetKind(sheet.rows)
      if (!kind) continue
      found[kind].push({
        fileName: wb.fileName,
        sheetName: sheet.name,
        rows: sheet.rows,
      })
    }
  }

  const errors: string[] = []
  const warnings: string[] = []

  if (found.shinsegae.length === 0) {
    errors.push(
      '신세계 품목 시트를 찾지 못했습니다. `면과세`·`품목코드` 열이 있는 시트가 포함된 파일을 올려주세요.'
    )
  }
  if (found.cj.length === 0) {
    errors.push(
      'CJ 집계표 시트를 찾지 못했습니다. `사업장코드` 열이 있는 시트가 포함된 파일을 올려주세요.'
    )
  }

  if (found.cjStatement.length === 0) {
    warnings.push(
      'CJ 거래명세서가 없어 집계표와 대조하지 못했습니다. 품목 내역과 CJ 쪽 기간 확인이 생략됩니다.'
    )
  }

  const SHEET_LABEL: Record<SheetKind, string> = {
    shinsegae: '신세계',
    cj: 'CJ 집계표',
    cjStatement: 'CJ 거래명세서',
  }
  for (const kind of ['shinsegae', 'cj', 'cjStatement'] as const) {
    if (found[kind].length > 1) {
      const label = SHEET_LABEL[kind]
      const extras = found[kind]
        .slice(1)
        .map((s) => `${s.fileName}/${s.sheetName}`)
        .join(', ')
      warnings.push(
        `${label} 시트가 ${found[kind].length}개 발견돼 첫 번째(${found[kind][0].sheetName})만 사용합니다. 무시된 시트: ${extras}`
      )
    }
  }

  return {
    shinsegae: found.shinsegae[0] ?? null,
    cj: found.cj[0] ?? null,
    cjStatement: found.cjStatement[0] ?? null,
    errors,
    warnings,
  }
}
