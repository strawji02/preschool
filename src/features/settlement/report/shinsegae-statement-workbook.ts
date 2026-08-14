import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import {
  formatStatementAmount,
  formatStatementDate,
  formatStatementQuantity,
  type ShinsegaeStatement,
  type ShinsegaeStatementBlock,
  type ShinsegaeStatementBuyer,
} from './shinsegae-statement'

/**
 * 신세계 거래명세표 엑셀 — **템플릿의 블록을 복제해 텍스트만 넣는다** (docs §19-2)
 *
 * ★ **서식을 코드로 그리지 않는다.** 원본은 43열·병합 7,309개짜리 폼이라 좌표로
 * 재현하면 만드는 것도 유지하는 것도 불가능하다. 대신 원본에서 뽑은 템플릿
 * (`templates/신세계_거래명세표.xlsx`)을 읽어, 블록을 복제하고 값만 채운다.
 *
 * 실측으로 확인한 것 (2026-08-01):
 * ```
 * exceljs 왕복    병합 430 / 테두리 571셀 / 채움 49 / 글꼴 80 / 열너비·행높이  전부 보존
 * 블록 복제       테두리 571 / 병합 70 / 값 65   원본 블록과 동일
 * 도장 이미지     18개 → 19개  복제됨
 * ```
 *
 * ★ **공급자·직인은 템플릿에 박혀 있다.** (주)신세계푸드 그대로 — 유치원이 그걸
 * 원하고, 우리 단가가 신세계 청구가와 원단위로 같아 사실과도 맞는다.
 */

/** 블록 안의 셀 위치 — 블록 첫 행을 1로 본다 */
export const BLOCK = {
  /** 머리: 제목·공급자·공급받는자·표 헤더 */
  headRows: 16,
  /** 품목 한 줄 */
  itemRow: 17,
  /** 꼬리: 합계·월합계·검수·페이지 */
  tailFrom: 18,
  /**
   * ⚠️ 33까지다. 34로 두면 블록이 34행이 되어 원본 간격(33행)과 어긋나고,
   * 장수가 늘수록 페이지가 밀린다. 원본 블록 제목 행이 3·36·69로 33 간격이다.
   */
  tailTo: 33,
} as const

/** 열 번호 (A=1) */
const COL = {
  date: 4, // D6  납품일
  buyerBizRegNo: 29, // AC10
  buyerCompany: 29, // AC12
  buyerCeo: 40, // AN12
  buyerAddress: 29, // AC13
  no: 1, // A17
  temperature: 6, // F17
  productName: 8, // H17
  spec: 14, // N17
  unit: 20, // T17
  quantity: 23, // W17
  unitPrice: 24, // X17
  supply: 28, // AB17
  vat: 33, // AG17
  total: 35, // AI17
  origin: 41, // AO17  단가표에서 채운다 (docs §21). 못 찾으면 빈칸
  taxLabel: 20, // T18 과세 / T19 면세
  taxAmount: 23, // W18/W19
  daySupply: 28, // AB18
  dayVat: 33, // AG18
  dayTotal: 36, // AJ18
  page: 21, // U31
} as const

/** 머리 기준 행 (블록 첫 행 = 1) */
const HEAD_ROW = { date: 6, regNo: 10, company: 12, address: 13 } as const
/** 꼬리 기준 오프셋 (꼬리 첫 행 = 0) */
const TAIL_OFFSET = {
  sumRow: 0,
  exemptRow: 1,
  monthRow: 4,
  /**
   * ★ **탄력 여백 행** — 월합계와 검수 사이의 빈 행(템플릿 r23).
   *
   * 원본은 이 한 행을 늘였다 줄였다 하며 블록이 정확히 한 장을 채우게 만든다.
   * ```
   * 오전간식 (품목  1건)   409.6pt
   * 급식재료 (품목 14건)    65.2pt
   * → 블록 총높이는 둘 다 819.4pt = 한 장
   * ```
   * 이걸 안 맞추면 품목이 많은 날 블록이 1,150pt까지 커져 **매번 두 장**이 된다.
   */
  elasticRow: 5,
  pageRow: 13,
} as const

/**
 * 한 장에 들어가는 내용 높이 (pt).
 *
 * 원본 `급식재료`의 한 장짜리 블록 21개가 전부 819.1~819.9pt였다 —
 * A4 세로·여백 0 기준의 실측값이다. **조금 낮게 잡는다**: 딱 맞추면 반올림
 * 한 번에 다음 장으로 밀린다. 남는 몇 pt는 눈에 안 보인다.
 */
const PAGE_CONTENT_HEIGHT = 815

/** 탄력 행을 0으로 만들면 표가 붙어 버린다. 최소한은 남긴다. */
const MIN_ELASTIC_HEIGHT = 3

/** 높이를 지정하지 않은 행의 기본값 (템플릿 시트 설정) */
const DEFAULT_ROW_HEIGHT = 12.75

/**
 * 탄력 행을 뺀 블록 높이 — 탄력 행에 얼마를 줄지, 몇 장이 될지 둘 다 이걸로 정한다.
 */
function heightWithoutElastic(
  tpl: { head: Segment; item: Segment; tail: Segment },
  itemCount: number
): number {
  const itemHeight = tpl.item.rows[0]?.height ?? DEFAULT_ROW_HEIGHT
  return (
    segmentHeight(tpl.head) +
    itemCount * itemHeight +
    segmentHeight(tpl.tail, TAIL_OFFSET.elasticRow)
  )
}

/** 블록이 차지할 인쇄 장수 — 품목이 많으면 두 장이 된다 (원본도 그렇다) */
function pagesForBlock(
  tpl: { head: Segment; item: Segment; tail: Segment },
  itemCount: number
): number {
  const h = Math.max(PAGE_CONTENT_HEIGHT, heightWithoutElastic(tpl, itemCount) + MIN_ELASTIC_HEIGHT)
  return Math.ceil(h / PAGE_CONTENT_HEIGHT)
}

function segmentHeight(seg: Segment, skipIndex?: number): number {
  return seg.rows.reduce(
    (sum, row, i) => (i === skipIndex ? sum : sum + (row.height ?? DEFAULT_ROW_HEIGHT)),
    0
  )
}

interface CellSnapshot {
  col: number
  style: Partial<ExcelJS.Style>
  value: ExcelJS.CellValue
}
interface RowSnapshot {
  height: number | undefined
  cells: CellSnapshot[]
}
export interface Segment {
  rows: RowSnapshot[]
  /** 구간 첫 행을 0으로 본 병합 */
  merges: { top: number; left: number; bottom: number; right: number }[]
  /** 구간 첫 행을 0으로 본 이미지 (exceljs는 0-based) */
  /** exceljs 런타임 앵커는 타입 정의(`Anchor`)보다 필드가 적어 구조로 받는다 */
  images: { imageId: number; tl: ImageAnchor; br: ImageAnchor }[]
}

/**
 * 이미지 앵커 — 0-based `col`/`row`만 쓴다.
 *
 * ⚠️ **exceljs 앵커 객체를 그대로 펼치면 안 된다.** `row`·`col`은 프로토타입
 * getter라 `{...anchor}`로는 **복사되지 않는다.** 대신 `nativeRow`만 넘어가서
 * 블록을 옮겨도 이미지가 안 따라오고, 위치로 거르는 필터도 전부 빗나간다.
 * 실제로 그래서 모든 식당 시트 첫 장에 오전간식 금액 그림이 박혔다 (2026-08-01).
 */
type ImageAnchor = { col: number; row: number }

export const MAX_COL = 43

export function snapshotSegment(ws: ExcelJS.Worksheet, from: number, to: number): Segment {
  const rows: RowSnapshot[] = []
  for (let r = from; r <= to; r++) {
    const row = ws.getRow(r)
    const cells: CellSnapshot[] = []
    for (let c = 1; c <= MAX_COL; c++) {
      const cell = row.getCell(c)
      cells.push({ col: c, style: { ...cell.style }, value: cell.value })
    }
    rows.push({ height: row.height, cells })
  }

  const merges: Segment['merges'] = []
  for (const ref of ws.model.merges ?? []) {
    const [a, b] = ref.split(':')
    const pa = splitRef(a)
    const pb = splitRef(b)
    if (pa.row < from || pb.row > to) continue
    merges.push({
      top: pa.row - from,
      left: pa.col,
      bottom: pb.row - from,
      right: pb.col,
    })
  }

  const images: Segment['images'] = []
  for (const im of ws.getImages()) {
    // exceljs 이미지 앵커는 0-based
    if (im.range.tl.row < from - 1 || im.range.br.row > to) continue
    // getter를 **여기서 읽어** 숫자로 굳힌다 (위 ImageAnchor 주석 참고)
    images.push({
      imageId: Number(im.imageId),
      tl: { col: im.range.tl.col, row: im.range.tl.row },
      br: { col: im.range.br.col, row: im.range.br.row },
    })
  }
  return { rows, merges, images }
}

function splitRef(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.replace('$', ''))
  if (!m) return { col: 1, row: 1 }
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col, row: Number(m[2]) }
}

function colName(n: number): string {
  let s = ''
  let x = n
  while (x > 0) {
    const r = (x - 1) % 26
    s = String.fromCharCode(65 + r) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}

/** 구간을 `at`(1-based)부터 붙여 넣는다. 스타일·병합·이미지까지. */
export function paste(ws: ExcelJS.Worksheet, seg: Segment, at: number, srcTop: number): number {
  seg.rows.forEach((snap, i) => {
    const row = ws.getRow(at + i)
    if (snap.height !== undefined) row.height = snap.height
    for (const c of snap.cells) {
      const cell = row.getCell(c.col)
      cell.style = c.style
      if (c.value !== null && c.value !== undefined) cell.value = c.value
    }
  })
  for (const m of seg.merges) {
    const ref = `${colName(m.left)}${at + m.top}:${colName(m.right)}${at + m.bottom}`
    try {
      ws.mergeCells(ref)
    } catch {
      // 이미 병합된 경우 — 템플릿이 겹치게 잡혀 있으면 무시한다
    }
  }
  for (const im of seg.images) {
    const shift = at - srcTop
    ws.addImage(im.imageId, {
      tl: { col: im.tl.col, row: im.tl.row + shift },
      br: { col: im.br.col, row: im.br.row + shift },
    } as unknown as ExcelJS.ImageRange)
  }
  return at + seg.rows.length
}

/** 명세서 블록 하나를 그리고 값을 채운다. 다음 블록이 시작할 행을 돌려준다. */
function writeBlock(
  ws: ExcelJS.Worksheet,
  tpl: { head: Segment; item: Segment; tail: Segment },
  at: number,
  block: ShinsegaeStatementBlock,
  buyer: ShinsegaeStatementBuyer
): number {
  let cursor = paste(ws, tpl.head, at, 1)

  ws.getCell(at + HEAD_ROW.date - 1, COL.date).value = formatStatementDate(block.date)
  ws.getCell(at + HEAD_ROW.regNo - 1, COL.buyerBizRegNo).value = formatBizRegNo(buyer.bizRegNo)
  ws.getCell(at + HEAD_ROW.company - 1, COL.buyerCompany).value = buyer.companyName
  ws.getCell(at + HEAD_ROW.company - 1, COL.buyerCeo).value = buyer.ceoName
  ws.getCell(at + HEAD_ROW.address - 1, COL.buyerAddress).value = buyer.address

  for (const item of block.items) {
    const r = cursor
    paste(ws, tpl.item, r, BLOCK.itemRow)
    ws.getCell(r, COL.no).value = String(item.no)
    ws.getCell(r, COL.temperature).value = item.temperature
    ws.getCell(r, COL.productName).value = item.productName
    ws.getCell(r, COL.spec).value = item.spec
    ws.getCell(r, COL.unit).value = item.unit
    ws.getCell(r, COL.quantity).value = formatStatementQuantity(item.quantity)
    ws.getCell(r, COL.unitPrice).value = formatStatementAmount(item.unitPrice)
    ws.getCell(r, COL.supply).value = formatStatementAmount(item.supply)
    ws.getCell(r, COL.vat).value = formatStatementAmount(item.vat)
    ws.getCell(r, COL.total).value = formatStatementAmount(item.total)
    /*
      ★ **원산지는 신세계 월별 단가표에서만 온다** (docs §21).
      못 찾으면 빈칸이다 — 품목명에서 추정하면 **틀린 원산지를 유치원에 주는
      문서**가 된다 (§19 원칙).
    */
    ws.getCell(r, COL.origin).value = item.origin || null
    cursor = r + 1
  }

  const tailAt = cursor
  cursor = paste(ws, tpl.tail, tailAt, BLOCK.tailFrom)

  const sumRow = tailAt + TAIL_OFFSET.sumRow
  ws.getCell(sumRow, COL.taxAmount).value = formatStatementAmount(block.taxableSupply)
  ws.getCell(sumRow, COL.daySupply).value = formatStatementAmount(block.supply)
  ws.getCell(sumRow, COL.dayVat).value = formatStatementAmount(block.vat)
  ws.getCell(sumRow, COL.dayTotal).value = formatStatementAmount(block.total)
  ws.getCell(tailAt + TAIL_OFFSET.exemptRow, COL.taxAmount).value = formatStatementAmount(
    block.exempt
  )

  const monthRow = tailAt + TAIL_OFFSET.monthRow
  ws.getCell(monthRow, COL.daySupply).value = formatStatementAmount(block.cumulativeSupply)
  ws.getCell(monthRow, COL.vat).value = formatStatementAmount(block.cumulativeVat)
  ws.getCell(monthRow, COL.total).value = formatStatementAmount(block.cumulativeTotal)

  ws.getCell(tailAt + TAIL_OFFSET.pageRow, COL.page).value = block.page

  /*
    ★ **탄력 여백 행으로 한 장을 채운다** (위 `elasticRow` 주석).

    품목이 많으면 줄이고 적으면 늘려서 블록이 한 장에 들어가게 한다.
    품목이 아주 많아 한 장을 넘기면 최소값만 남기고 두 장으로 흐르게 둔다 —
    원본도 그 날은 두 장이다(품목 17건 이상).
  */
  ws.getRow(tailAt + TAIL_OFFSET.elasticRow).height = Math.max(
    MIN_ELASTIC_HEIGHT,
    PAGE_CONTENT_HEIGHT - heightWithoutElastic(tpl, block.items.length)
  )

  return cursor
}

/** `1328049224` → `132-80-49224` */
function formatBizRegNo(raw: string): string {
  const d = raw.replace(/\D/g, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : raw
}

/**
 * 엑셀 시트명 제약 — 31자, `[]:*?/\` 금지.
 * 겹치면 뒤에 번호를 붙인다. 식당명이 길어 잘리는 일이 실제로 있다.
 */
function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || '식당'
  let name = base
  let i = 2
  while (used.has(name)) {
    const suffix = `(${i++})`
    name = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(name)
  return name
}

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'src/features/settlement/report/templates/신세계_거래명세표.xlsx'
)

export async function writeShinsegaeStatementXlsx(st: ShinsegaeStatement): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  // `readFile`은 NonSharedBuffer를 주는데 exceljs 타입은 Buffer를 요구한다. 내용은 같다.
  const bytes = await readFile(TEMPLATE_PATH)
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0])

  const summaryWs = wb.getWorksheet('집계표')
  const blockWs = wb.getWorksheet('명세서')
  if (!summaryWs || !blockWs) throw new Error('거래명세표 템플릿이 올바르지 않습니다.')

  const tpl = {
    head: snapshotSegment(blockWs, 1, BLOCK.headRows),
    item: snapshotSegment(blockWs, BLOCK.itemRow, BLOCK.itemRow),
    tail: snapshotSegment(blockWs, BLOCK.tailFrom, BLOCK.tailTo),
  }
  /*
    ★ **머리 구간(공급자 박스)의 도장 말고는 이미지를 싣지 않는다.**

    원본 신세계 파일에는 `합계`·`26,340` 같은 **글자 그림**이 합계 칸 위에 덮여 있다.
    그걸 같이 복제하는 바람에 모든 식당 시트에 **오전간식 첫날 금액이 그림으로**
    박혔다 (2026-08-01). 템플릿에서 걷어냈지만, 템플릿을 다시 뽑을 때 실수로
    딸려 오면 유치원에 틀린 금액이 보이는 문서가 나간다. 여기서 한 번 더 막는다.
  */
  tpl.item.images = []
  tpl.tail.images = []
  const widths: (number | undefined)[] = []
  for (let c = 1; c <= MAX_COL; c++) widths[c] = blockWs.getColumn(c).width

  // ── 집계표: 본문 1행 템플릿을 식당 수만큼 복제
  const bodyTpl = snapshotSegment(summaryWs, 8, 8)
  const totalTpl = snapshotSegment(summaryWs, 9, 9)
  summaryWs.getCell('A1').value = st.title
  /*
    ⚠️ 템플릿 9행은 `계` 행이라 `A9:B9`가 병합돼 있다. 그 자리에 본문을 쓰면
    번호(A)와 식당명(B)이 한 칸으로 합쳐져 **번호가 사라진다.** 실제로 그랬다.
    본문을 깔기 전에 풀고, `계`는 제자리에서 다시 병합된다.
  */
  summaryWs.unMergeCells('A9:B9')
  let r = 8
  for (const row of st.summary) {
    paste(summaryWs, bodyTpl, r, 8)
    summaryWs.getCell(r, 1).value = row.no
    summaryWs.getCell(r, 2).value = row.name
    summaryWs.getCell(r, 3).value = row.taxableSupply
    summaryWs.getCell(r, 4).value = row.vat
    summaryWs.getCell(r, 5).value = row.sum
    summaryWs.getCell(r, 6).value = row.exempt
    summaryWs.getCell(r, 7).value = row.total
    r++
  }
  paste(summaryWs, totalTpl, r, 9)
  summaryWs.getCell(r, 1).value = '계'
  for (let c = 3; c <= 7; c++) {
    summaryWs.getCell(r, c).value = { formula: `SUM(${colName(c)}8:${colName(c)}${r - 1})` }
  }

  // ── 식당마다 시트 하나
  const used = new Set<string>(['집계표', '명세서'])
  for (const sheet of st.sheets) {
    const ws = wb.addWorksheet(sheetName(sheet.restaurantName, used), {
      pageSetup: { ...blockWs.pageSetup },
      views: blockWs.views,
    })
    for (let c = 1; c <= MAX_COL; c++) {
      if (widths[c] !== undefined) ws.getColumn(c).width = widths[c]
    }
    /*
      ★ **날짜마다 새 장에서 시작하게 페이지 나눔을 넣는다** (docs §19-2).

      원본은 행 높이를 자동으로 늘려 각 블록이 정확히 한 장(819.4pt)을 채우게
      만든다. 품목명이 길면 행이 두 줄이 되고, 그만큼 아래 빈 행이 줄어든다.
      **그 자동맞춤은 글꼴 폭에 달려 있어 우리가 재현할 수 없다.**

      대신 블록 끝마다 **명시적 페이지 나눔**을 건다. 행 높이가 어떻든
      한 날짜가 페이지 중간에서 잘리지 않고, 다음 날짜는 새 장에서 시작한다.
      원본이 패딩으로 얻으려던 결과를 더 확실하게 얻는다.

      ⚠️ 마지막 블록 뒤에는 넣지 않는다 — 빈 장이 한 장 더 붙는다.
    */
    /*
      ★ **페이지 번호는 실제 인쇄 장수로 매긴다** (`n/N`).

      블록 번호로 매기면 품목이 많은 날이 두 장이 될 때 어긋난다. 원본도
      인쇄 장수 기준이다 — 26년 6월 급식재료가 블록 21개인데 `10/24`였다.
    */
    const pages = sheet.blocks.map((b) => pagesForBlock(tpl, b.items.length))
    const totalPages = pages.reduce((a, n) => a + n, 0)
    let pageNo = 1
    let at = 1
    sheet.blocks.forEach((block, i) => {
      at = writeBlock(ws, tpl, at, { ...block, page: `${pageNo}/${totalPages}` }, st.buyer)
      pageNo += pages[i]
      if (i < sheet.blocks.length - 1) ws.getRow(at - 1).addPageBreak()
    })
  }

  // 템플릿용 빈 명세서 시트는 결과물에 남기지 않는다
  wb.removeWorksheet(blockWs.id)

  const out = await wb.xlsx.writeBuffer()
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer)
}
