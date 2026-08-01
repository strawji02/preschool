/**
 * 신세계 거래명세표 **템플릿 제작** — 원본에서 한 번 뽑는다 (docs §19-2)
 *
 * 실행: `npx tsx scripts/build-shinsegae-template.ts`
 * 원본: `국제 26년 6월 급식 청구서류(거래명세표).xlsx` (리포 루트)
 *
 * ⚠️ **openpyxl로 만들면 안 된다.** 도형 XML을 exceljs가 못 읽어
 * `drawing.anchors` 오류로 죽는다. 반드시 exceljs로 만든다.
 *
 * ⚠️ **이미지는 도장만 남긴다.** 원본에는 `합계`·`26,340` 같은 **글자 그림**이
 * 합계 칸 위에 덮여 있다. 신세계 쪽에서 붙인 것으로 보이는데, 그대로 복제하면
 * 모든 식당 시트에 **오전간식 첫날 금액이 그림으로 박힌다.** 실제로 그랬다.
 * 도장은 공급자 박스(머리 구간)에 있고, 글자 그림은 품목·합계 구간에 있다.
 */
import { readFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import {
  BLOCK,
  MAX_COL,
  paste,
  snapshotSegment,
} from '@/features/settlement/report/shinsegae-statement-workbook'

const SRC = '국제 26년 6월 급식 청구서류(거래명세표).xlsx'
const OUT = 'src/features/settlement/report/templates/신세계_거래명세표.xlsx'

/** 유치원마다 달라지는 칸 — 비워 둔다. 빠뜨려도 남의 정보가 새지 않는다. */
const BLANK_BLOCK = [
  'I3', 'D6', 'AC10', 'AC12', 'AN12', 'AC13', 'U31', 'B32', // 호차·날짜·공급받는자·페이지
  'A17', 'F17', 'H17', 'N17', 'T17', 'W17', 'X17', 'AB17', 'AG17', 'AI17', 'AO17', // 품목
  'W18', 'AB18', 'AG18', 'AJ18', 'W19', 'AB22', 'AG22', 'AI22', // 합계·월합계
]

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await readFile(SRC)) as unknown as Parameters<typeof wb.xlsx.load>[0])
  const srcBlock = wb.getWorksheet('오전간식')
  const srcSum = wb.getWorksheet('신세계_전체 집계표')
  if (!srcBlock || !srcSum) throw new Error('원본 시트를 찾지 못했습니다.')

  // ── 명세서: 블록 1개(1~33행)만
  const seg = snapshotSegment(srcBlock, 1, BLOCK.tailTo)
  const before = seg.images.length
  // ★ 도장만 남긴다 — 머리 구간(공급자 박스) 안에 있는 이미지가 도장이다
  seg.images = seg.images.filter((im) => im.br.row <= BLOCK.headRows)
  console.log(`이미지 ${before}개 중 ${seg.images.length}개(도장)만 유지`)

  const ws = wb.addWorksheet('명세서', {
    pageSetup: { ...srcBlock.pageSetup },
    views: srcBlock.views,
  })
  for (let c = 1; c <= MAX_COL; c++) {
    const w = srcBlock.getColumn(c).width
    if (w !== undefined) ws.getColumn(c).width = w
  }
  paste(ws, seg, 1, 1)
  for (const ref of BLANK_BLOCK) ws.getCell(ref).value = null

  // ── 집계표: 머리 + 본문 1행 + 계
  const s = wb.addWorksheet('집계표', {
    pageSetup: { ...srcSum.pageSetup },
    views: srcSum.views,
  })
  for (let c = 1; c <= 10; c++) {
    const w = srcSum.getColumn(c).width
    if (w !== undefined) s.getColumn(c).width = w
  }
  paste(s, snapshotSegment(srcSum, 1, 8), 1, 1)
  paste(s, snapshotSegment(srcSum, 13, 13), 9, 13)
  s.getCell('A1').value = null
  for (const ref of ['A8', 'B8', 'C8', 'D8', 'E8', 'F8', 'G8', 'H8']) s.getCell(ref).value = null
  for (const col of ['C', 'D', 'E', 'F', 'G']) {
    s.getCell(`${col}9`).value = { formula: `SUM(${col}8:${col}8)` }
  }

  for (const name of ['신세계_전체 집계표', '급식재료', '교사식재료', '오전간식', '종일반간식', '행사용']) {
    const t = wb.getWorksheet(name)
    if (t) wb.removeWorksheet(t.id)
  }
  /*
    ★ **안 쓰는 이미지를 버린다.** 원본에는 이미지가 66개 들어 있는데 우리가 쓰는 건
    도장 하나뿐이다. 그대로 두면 파일마다 180KB가 따라다니고, 무엇보다 그 조각들이
    **국제유치원의 다른 날짜 금액 그림**이라 다른 유치원에 보낼 파일 안에 남는다.
    화면에 보이지는 않지만 압축을 풀면 나온다.
  */
  // ⚠️ `wb.model`은 **호출할 때마다 새 객체**라 거기에 대입하면 아무 일도 안 난다.
  //    실제 저장소는 `wb.media`다.
  const media = (wb as unknown as { media: unknown[] }).media
  const usedId = seg.images[0]?.imageId
  if (usedId === undefined) throw new Error('도장 이미지를 찾지 못했습니다.')
  const mediaCount = media.length
  const seal = media[usedId]
  media.splice(0, media.length, seal)
  for (const w of wb.worksheets) {
    for (const m of (w as unknown as { _media: { imageId: number }[] })._media ?? []) m.imageId = 0
  }
  console.log(`미디어 ${mediaCount}개 → ${media.length}개(도장)`)

  await wb.xlsx.writeFile(OUT)
  console.log('템플릿 저장:', OUT, '| 시트', wb.worksheets.map((w) => w.name).join(', '))
}

void main()
