import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { readWorkbookBytes } from '../service/read-upload'
import type { UploadedWorkbook } from '../service/pick-sheets'
import type { SourceDateRange } from '../calc/period-guard'

/**
 * 원천 파일 보관 — docs/systems/settlement/원천보관.md §20
 *
 * ★ **왜 서버에 두는가.** 말일 09:00~14:00 다섯 시간 안에 정산과 계산서 발행을
 * **혼자** 끝내야 하는데, 그 사이 조정 요청이 몰려 들어온다. 원천이 브라우저
 * 메모리에만 있으면 조정 한 건 넣을 때마다 파일이 살아 있어야 하고, 창을 닫는
 * 순간 처음부터다.
 *
 * ⚠️ **파싱 결과는 저장하지 않는다.** 실측상 파싱이 1~2ms(읽기 59~82ms)라
 * 연 3만 행짜리 테이블을 떠안을 이유가 없다. 파일만 두고 쓸 때마다 다시 판다.
 */

const BUCKET = 'settlement-sources'

export type SourceKind = 'shinsegae' | 'cj' | 'cj_statement'

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  shinsegae: '신세계 품목',
  cj: 'CJ 집계표',
  cj_statement: 'CJ 거래명세서',
}

export interface SourceFileRecord {
  id: string
  period: string
  kind: SourceKind
  fileName: string
  storagePath: string
  fileSize: number
  sheetName: string
  dateMin: string | null
  dateMax: string | null
  isActive: boolean
  uploadedBy: string
  uploadedAt: string
}

export class SourceArchiveError extends Error {}

/** 한 파일이 담은 시트 하나 */
export interface DetectedSheet {
  kind: SourceKind
  sheetName: string
  dateRange: SourceDateRange | null
}

export interface SaveSourceInput {
  period: string
  uploadedBy: string
  files: {
    fileName: string
    bytes: Uint8Array
    /** 이 파일에서 찾아낸 원천 시트들. 통합 파일은 2종이 나온다. */
    sheets: DetectedSheet[]
  }[]
}

interface Row {
  id: string
  period: string
  kind: string
  file_name: string
  storage_path: string
  file_size: number
  sheet_name: string
  date_min: string | null
  date_max: string | null
  is_active: boolean
  uploaded_by: string
  uploaded_at: string
}

const COLUMNS =
  'id, period, kind, file_name, storage_path, file_size, sheet_name, ' +
  'date_min, date_max, is_active, uploaded_by, uploaded_at'

function toRecord(r: Row): SourceFileRecord {
  return {
    id: r.id,
    period: r.period,
    kind: r.kind as SourceKind,
    fileName: r.file_name,
    storagePath: r.storage_path,
    fileSize: Number(r.file_size),
    sheetName: r.sheet_name,
    dateMin: r.date_min ? String(r.date_min).slice(0, 10) : null,
    dateMax: r.date_max ? String(r.date_max).slice(0, 10) : null,
    isActive: r.is_active,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
  }
}

/**
 * 원천을 보관하고 활성본으로 세운다.
 *
 * ⚠️ **이전 활성본을 지우지 않는다.** `is_active`만 내린다 — 어제 같은 사고
 * (7월 자료가 6월로 확정)를 추적하려면 "그때 무엇을 올렸는지"가 남아야 한다.
 *
 * 파일 실체는 종류마다 다시 올리지 않는다. 통합 파일이면 한 번 올리고
 * 두 행이 같은 경로를 가리킨다.
 */
export async function saveSourceFiles(input: SaveSourceInput): Promise<SourceFileRecord[]> {
  const db = createAdminClient()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const saved: SourceFileRecord[] = []

  for (const file of input.files) {
    if (file.sheets.length === 0) continue

    // 경로에 원본 파일명을 쓰지 않는다 — 한글·공백·괄호가 섞여 있어 문제가 된다.
    // 어떤 파일이었는지는 `file_name` 컬럼에 그대로 남는다.
    const kinds = file.sheets.map((s) => s.kind).join('+')
    const path = `${input.period}/${stamp}_${kinds}.xlsx`

    const up = await db.storage.from(BUCKET).upload(path, file.bytes as unknown as ArrayBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: false,
    })
    if (up.error) throw new SourceArchiveError(`파일 보관 실패: ${up.error.message}`)

    for (const sheet of file.sheets) {
      // 같은 종류의 기존 활성본을 내린다 (부분 유니크 인덱스가 둘을 허용하지 않는다)
      const off = await db
        .from('settlement_source_files')
        .update({ is_active: false, replaced_reason: `${input.uploadedBy}가 다시 올림` })
        .eq('period', input.period)
        .eq('kind', sheet.kind)
        .eq('is_active', true)
      if (off.error) throw new SourceArchiveError(`이전 원천 정리 실패: ${off.error.message}`)

      const ins = await db
        .from('settlement_source_files')
        .insert({
          period: input.period,
          kind: sheet.kind,
          file_name: file.fileName,
          storage_path: path,
          file_size: file.bytes.byteLength,
          sheet_name: sheet.sheetName,
          date_min: sheet.dateRange?.min ?? null,
          date_max: sheet.dateRange?.max ?? null,
          is_active: true,
          uploaded_by: input.uploadedBy,
        })
        .select(COLUMNS)
        .single()
      if (ins.error) throw new SourceArchiveError(`원천 기록 실패: ${ins.error.message}`)
      saved.push(toRecord(ins.data as unknown as Row))
    }
  }

  return saved
}

/** 그 달의 활성 원천 (종류별 1개) */
export async function loadActiveSources(period: string): Promise<SourceFileRecord[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_source_files')
    .select(COLUMNS)
    .eq('period', period)
    .eq('is_active', true)
    .order('kind')
  if (error) throw new SourceArchiveError(`원천 조회 실패: ${error.message}`)
  return (data ?? []).map((r) => toRecord(r as unknown as Row))
}

/** 이력 포함 전체 — 무엇이 언제 교체됐는지 보여줄 때 */
export async function listSourceFiles(period: string): Promise<SourceFileRecord[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_source_files')
    .select(COLUMNS)
    .eq('period', period)
    .order('uploaded_at', { ascending: false })
  if (error) throw new SourceArchiveError(`원천 이력 조회 실패: ${error.message}`)
  return (data ?? []).map((r) => toRecord(r as unknown as Row))
}

/**
 * 보관된 원천을 `runSettlement`가 먹는 형태로 되살린다.
 *
 * **같은 경로를 가리키는 행이 여럿이면 한 번만 읽는다** — 통합 파일은 신세계와
 * CJ 집계표 두 행이 같은 파일이다. 두 번 내려받으면 시간만 두 배로 든다.
 */
export async function loadSourceWorkbooks(period: string): Promise<{
  workbooks: UploadedWorkbook[]
  files: SourceFileRecord[]
}> {
  const files = await loadActiveSources(period)
  if (files.length === 0) return { workbooks: [], files: [] }

  const db = createAdminClient()
  const byPath = new Map<string, SourceFileRecord>()
  for (const f of files) if (!byPath.has(f.storagePath)) byPath.set(f.storagePath, f)

  const workbooks = await Promise.all(
    [...byPath.values()].map(async (f) => {
      const { data, error } = await db.storage.from(BUCKET).download(f.storagePath)
      if (error || !data) {
        throw new SourceArchiveError(
          `보관된 원천을 읽지 못했습니다 (${f.fileName}): ${error?.message ?? '없음'}`
        )
      }
      return readWorkbookBytes(f.fileName, await data.arrayBuffer())
    })
  )

  return { workbooks, files }
}
