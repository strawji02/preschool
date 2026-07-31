import * as XLSX from 'xlsx'
import { ADJUSTMENT_COL_WIDTHS } from './adjustment-sheet'
import { ITEM_HEADER, type VenueStatement } from './venue-statement'

/**
 * 유치원 제공 거래명세표를 xlsx로 만든다 — docs/systems/settlement/조정.md §19
 *
 * 서식은 **내용이 통하는 수준**까지만 맞춘다. 신세계 원본은 43열에 셀 병합으로
 * 공급자 박스를 그려 놨는데, 그 테두리·배경까지 재현하려면 SheetJS 유료 기능이
 * 필요하다. 유치원이 확인해야 하는 건 **어느 날 무엇이 얼마에 들어왔는가**다.
 */

const MONEY = '#,##0'

/** 시트명은 31자 제한이고 `:\/?*[]`를 못 쓴다 */
function safeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 28).trim() || '시트'
  let out = base
  let n = 2
  while (used.has(out)) out = `${base.slice(0, 26)}_${n++}`
  used.add(out)
  return out
}

export function buildVenueStatementWorkbook(st: VenueStatement): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()

  // ── 집계표 ──
  const sws = XLSX.utils.aoa_to_sheet(st.summary.rows as unknown[][])
  sws['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 16 }]
  money(sws)
  XLSX.utils.book_append_sheet(wb, sws, safeSheetName('집계표', used))

  // ── 식당별 ──
  for (const r of st.restaurants) {
    const rows: unknown[][] = []
    rows.push([`${st.businessName}  ${r.name}  ${st.period} 거래명세서`])
    rows.push([])

    for (const day of r.days) {
      rows.push([formatDate(day.date)])
      rows.push(ITEM_HEADER)
      for (const row of day.rows) rows.push(row)
      // 그날 합계 — 과세·면세를 갈라 적는다 (원본과 같은 형태)
      rows.push(['합계', '과세', '', '', '', '', '', day.taxableSupply, day.vat, day.taxableSupply + day.vat])
      rows.push(['', '면세', '', '', '', '', '', day.exempt, 0, day.exempt])
      rows.push(['', '', '', '', '', '', '', '', '당일 합계', day.total])
      rows.push([])
    }

    rows.push(['월합계', '', '', '', '', '', '', '', '', r.monthTotal])

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [
      { wch: 6 }, // 번호
      { wch: 14 }, // 온도
      { wch: 38 }, // 품목
      { wch: 26 }, // 규격
      { wch: 8 }, // 단위
      { wch: 8 }, // 수량
      { wch: 10 }, // 단가
      { wch: 12 }, // 공급가액
      { wch: 10 }, // 세액
      { wch: 12 }, // 합계
    ]
    money(ws)
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(r.name, used))
  }

  // ── 조정 내역 (있을 때만) ──
  if (st.adjustmentSheet) {
    const aws = XLSX.utils.aoa_to_sheet(st.adjustmentSheet.rows as unknown[][])
    aws['!cols'] = ADJUSTMENT_COL_WIDTHS.map((wch) => ({ wch }))
    money(aws)
    XLSX.utils.book_append_sheet(wb, aws, safeSheetName('조정 내역', used))
  }

  return wb
}

export function writeVenueStatementXlsx(st: VenueStatement): Uint8Array {
  // ⚠️ `type: 'array'`는 환경에 따라 ArrayBuffer를 준다. 타입만 Uint8Array로
  // 단언하면 `fs.writeFile` 같은 곳에서 런타임에 터진다. 실제로 감싸 준다.
  const out = XLSX.write(buildVenueStatementWorkbook(st), {
    type: 'array',
    bookType: 'xlsx',
  }) as ArrayBuffer | Uint8Array
  return out instanceof Uint8Array ? out : new Uint8Array(out)
}

/** `2026-06-01` → `2026년 06월 01일` (원본 표기) */
function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}년 ${m[2]}월 ${m[3]}일` : iso
}

function money(ws: XLSX.WorkSheet): void {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === 'n') cell.z = MONEY
    }
  }
}
