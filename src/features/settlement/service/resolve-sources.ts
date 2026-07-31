import 'server-only'
import { isExcelUpload, readUploadedWorkbook } from './read-upload'
import { loadSourceWorkbooks } from '../data/source-archive'
import type { UploadedWorkbook } from './pick-sheets'
import type { SourceFileRecord } from '../data/source-archive'

/**
 * 이번 요청이 쓸 원천을 정한다 — docs/systems/settlement/원천보관.md §20
 *
 * ★ **보관된 원천이 기본이다.** 말일에 한 번 올려 두면 그 뒤 조정·재분석·산출물이
 * 전부 파일 없이 돈다. 창을 닫아도, 중간에 딴 일을 해도 이어서 할 수 있다.
 *
 * 요청에 파일이 실려 오면 **그쪽을 우선**한다. 보관 기능이 막히는 일이 생겨도
 * 업무가 멈추지 않도록 예전 경로를 남겨 둔 것이다. 5시간짜리 마감에서 도구가
 * 통째로 안 되는 상황은 만들면 안 된다.
 */
export interface ResolvedSources {
  workbooks: UploadedWorkbook[]
  /** 어디서 왔는지 — 화면이 "보관된 원천 사용 중"을 보여줄 수 있게 */
  from: 'upload' | 'archive' | 'none'
  /** `archive`일 때 쓰인 파일들 */
  files: SourceFileRecord[]
}

export async function resolveSources(input: {
  period: string
  files: readonly File[]
}): Promise<ResolvedSources> {
  const excel = input.files.filter(isExcelUpload)
  if (excel.length > 0) {
    const workbooks = await Promise.all(excel.map(readUploadedWorkbook))
    return { workbooks, from: 'upload', files: [] }
  }

  if (!/^\d{4}-\d{2}$/.test(input.period)) {
    return { workbooks: [], from: 'none', files: [] }
  }

  const { workbooks, files } = await loadSourceWorkbooks(input.period)
  return {
    workbooks,
    from: workbooks.length > 0 ? 'archive' : 'none',
    files,
  }
}

/** 원천이 없을 때 쓰는 안내 — 세 라우트가 같은 문구를 써야 한다 */
export const NO_SOURCE_MESSAGE =
  '이 달의 원천이 없습니다. 엑셀 파일을 올리거나, 먼저 원천을 보관해 주세요.'
