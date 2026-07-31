/**
 * [정산] 마감을 과거 리비전으로 되돌린다.
 *
 * 2026-07-31, 7월 원천 파일이 `2026-06`으로 확정된 사고 때문에 만들었다.
 * (rev1 = 진짜 6월 / rev2 = 7월 자료. 근거는 docs settlement/마감.md §8-4)
 *
 * ★ 리비전을 **지우지 않는다.** 과거 스냅샷을 그대로 다시 저장해 새 리비전을
 * 만든다. 잘못된 리비전도 이력에 남아야 "언제 무엇이 잘못됐는지"를 나중에
 * 추적할 수 있다 (docs §8).
 *
 * 실행:
 *   npx tsx --env-file=.env.local scripts/restore-closing-revision.ts <기간> <리비전> [--apply]
 * 예:
 *   npx tsx --env-file=.env.local scripts/restore-closing-revision.ts 2026-06 1 --apply
 *
 * `--apply` 없이 돌리면 **무엇이 바뀌는지만 보여주고 끝난다.** 돈 숫자를
 * 되돌리는 작업이라 기본값은 항상 미리보기다.
 */
import { saveClosing, type ClosingVenueRow, type ClosingPartnerRow } from '@/features/settlement'
import { createAdminClient } from '@/lib/supabase/admin'

const [period, revisionArg, ...rest] = process.argv.slice(2)
const apply = rest.includes('--apply')

if (!period || !revisionArg) {
  console.error('사용법: restore-closing-revision.ts <YYYY-MM> <리비전> [--apply]')
  process.exit(1)
}
const revision = Number(revisionArg)

/** 사업장 합계 — 되돌리기 전후를 사람이 눈으로 확인할 수 있게 */
function summarize(venues: readonly ClosingVenueRow[]) {
  const bySource = new Map<string, { biz: Set<string>; cost: number; price: number }>()
  for (const v of venues) {
    const cur = bySource.get(v.source) ?? { biz: new Set<string>(), cost: 0, price: 0 }
    cur.biz.add(v.businessCode)
    cur.cost += v.cost.total
    cur.price += v.price.total
    bySource.set(v.source, cur)
  }
  return [...bySource.entries()]
    .sort()
    .map(
      ([src, s]) =>
        `    ${src.padEnd(10)} 사업장 ${String(s.biz.size).padStart(2)}곳 / 식당 ${String(
          venues.filter((v) => v.source === src).length
        ).padStart(3)}개 / 원가 ${s.cost.toLocaleString().padStart(12)} / 단가 ${s.price
          .toLocaleString()
          .padStart(12)}`
    )
    .join('\n')
}

async function main() {
  const db = createAdminClient()

  const { data, error } = await db
    .from('settlement_closing_snapshots')
    .select('revision, status, snapshot, created_at, created_by')
    .eq('period', period)
    .order('revision')
  if (error) throw new Error(`스냅샷 조회 실패: ${error.message}`)
  if (!data || data.length === 0) throw new Error(`${period} 스냅샷이 없습니다.`)

  console.log(`=== ${period} 리비전 목록 ===`)
  for (const row of data) {
    const snap = row.snapshot as { closingVenues?: ClosingVenueRow[] }
    const venues = snap?.closingVenues ?? []
    console.log(`  rev${row.revision} (${row.status}) ${row.created_at} · ${row.created_by}`)
    console.log(summarize(venues))
  }

  const target = data.find((r) => r.revision === revision)
  if (!target) throw new Error(`rev${revision}을 찾을 수 없습니다.`)

  const snap = target.snapshot as {
    closingVenues?: ClosingVenueRow[]
    closingPartners?: ClosingPartnerRow[]
  }
  const venues = snap?.closingVenues
  const partners = snap?.closingPartners
  if (!venues?.length || !partners?.length) {
    throw new Error(`rev${revision} 스냅샷에 venues/partners가 없습니다 — 되돌릴 수 없습니다.`)
  }

  console.log(`\n=== 되돌릴 대상: rev${revision} ===`)
  console.log(summarize(venues))
  console.log(`  영업자 ${partners.length}명`)

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 되돌리려면 --apply 를 붙이세요.')
    return
  }

  // 스냅샷은 그대로 다시 저장하되, **어디서 왔는지**를 남긴다.
  // 원본을 고치지 않으므로 재현성은 유지되고 출처만 추가된다.
  const restored = {
    ...(target.snapshot as Record<string, unknown>),
    restoredFrom: revision,
    restoredAt: new Date().toISOString(),
  }

  const saved = await saveClosing({
    period,
    action: 'confirm',
    venues,
    partners,
    snapshot: restored,
    actor: 'system:restore',
    reason: `rev${revision} 스냅샷으로 되돌림`,
    note: `rev${revision}의 숫자로 되돌린 상태입니다. 올바른 원천 파일을 다시 올려 확정하면 이 메모는 사라집니다.`,
  })

  console.log(`\n되돌렸습니다 → rev${saved.revision} (${saved.status})`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
