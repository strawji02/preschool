import * as XLSX from 'xlsx'
import type { UploadedWorkbook } from './pick-sheets'

/**
 * 업로드된 엑셀 파일을 시트별 2차원 배열로 바꾼다.
 *
 * `sheet_to_json(sheet, { header: 1 })`은 기존 `src/lib/excel-parser.ts`와 같은
 * 관례다. ⚠️ 이 함수는 각 행의 **trailing 빈 셀을 배열에서 제거**하므로 행 길이가
 * 헤더보다 짧을 수 있다 — 파서의 `numCell`/`textCell`이 그걸 흡수한다.
 *
 * `blankrows: false`로 완전 빈 행을 없앤다. 원천 파일 상단에 빈 행이 있으면
 * 데이터 시작 인덱스가 밀리므로, 파서가 기대하는 형태로 정리해서 넘긴다.
 */
export async function readUploadedWorkbook(file: File): Promise<UploadedWorkbook> {
  return readWorkbookBytes(file.name, await file.arrayBuffer())
}

/**
 * 바이트에서 바로 읽는다 — **보관된 원천**을 다시 쓸 때 (docs §20).
 *
 * Storage에서 받은 파일은 `File`이 아니라 바이트다. `File`을 새로 만들어
 * 감싸는 것보다 이쪽이 솔직하다.
 */
export function readWorkbookBytes(
  fileName: string,
  buffer: ArrayBuffer | Uint8Array
): UploadedWorkbook {
  const wb = XLSX.read(buffer, { type: 'array' })

  return {
    fileName,
    sheets: wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], {
        header: 1,
        blankrows: false,
      }) as unknown[][],
    })),
  }
}

/** 업로드 허용 확장자 — 담당자가 xls로 내려받는 경우도 있다 */
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.xlsm']

export function isExcelUpload(file: File): boolean {
  const lower = file.name.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
