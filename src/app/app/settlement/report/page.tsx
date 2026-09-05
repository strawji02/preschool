import Link from 'next/link'
import { requireUser } from '@/features/shared/auth'
import SettlementHeader from '../settlement-header'
import ReportDownloads from './downloads'
import {
  listClosings,
  loadActiveSources,
  loadClosingDetail,
  loadClosingSnapshot,
  loadCollection,
  rollupByKindergarten,
  rollupBySource,
} from '@/features/settlement'

/**
 * 경영 보고서 (docs/systems/settlement.md §13).
 *
 * **마감된 달만 보여준다.** 업로드 화면의 미리보기와 달리 여기 숫자는 스냅샷에서
 * 나온다 — 나중에 담당자나 수수료율이 바뀌어도 과거 보고서는 달라지지 않는다.
 *
 * 세 기준을 섞지 않는다 (§13-1):
 *   발생(거래) — 이 화면. 원천 업로드로 확정된 값.
 *   세무(신고) — 세금 3종 카드. 성격·납부시점이 달라 분리한다.
 *   현금(입출금) — `발생 vs 현금` 섹션. 수금·지급 기록(§9)에서 온다.
 */

export const dynamic = 'force-dynamic'

const won = (n: number) => n.toLocaleString('ko-KR')
const pct = (r: number) => `${(r * 100).toFixed(1)}%`

const SOURCE_LABEL = { shinsegae: '신세계', cj: 'CJ' } as const

const STATUS_LABEL = { draft: '작성중', confirmed: '확정', closed: '마감' } as const
const STATUS_STYLE = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-800',
  closed: 'bg-emerald-100 text-emerald-800',
} as const

function periodLabel(period: string): string {
  const [y, m] = period.split('-')
  return `${y}년 ${Number(m)}월`
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  await requireUser('/app/settlement/report')
  const { period: requested } = await searchParams

  const closings = await listClosings()
  // 요청한 달이 없으면 가장 최근 마감을 보여준다
  const period = requested ?? closings[0]?.period ?? null
  const [detail, collection, snapshot, sourceFiles] = period
    ? await Promise.all([
        loadClosingDetail(period),
        loadCollection(period),
        // 산출물 다시 받기용 — 계산서 장수만 쓴다 (docs §8-2)
        loadClosingSnapshot(period),
        loadActiveSources(period),
      ])
    : [null, null, null, []]

  const invoiceRows = (snapshot?.snapshot as { invoiceRows?: { taxKind: string }[] })
    ?.invoiceRows
  const taxableCount = invoiceRows?.filter((r) => r.taxKind === 'taxable').length ?? 0
  const exemptCount = invoiceRows?.filter((r) => r.taxKind === 'exempt').length ?? 0
  const sourceKinds = new Set(sourceFiles.map((file) => file.kind))
  const statementVenues = detail
    ? [...new Map(
        detail.venues
          .filter((venue) => !venue.isExcluded)
          .filter((venue) => venue.source === 'shinsegae'
            ? sourceKinds.has('shinsegae')
            : sourceKinds.has('cj') && sourceKinds.has('cj_statement'))
          .map((venue) => [
            `${venue.source}:${venue.businessCode}`,
            {
              source: venue.source,
              businessCode: venue.businessCode,
              businessName: venue.companyName ?? venue.businessName,
            },
          ])
      ).values()].sort((a, b) => a.businessName.localeCompare(b.businessName, 'ko'))
    : []

  return (
    <div>
      <SettlementHeader
        active="report"
        title="경영 보고서"
        description={
          <>
            <strong className="font-medium text-gray-700">마감된 달의 확정 숫자</strong>
            입니다. 나중에 담당 영업자나 수수료율이 바뀌어도 이 값은 달라지지 않습니다.
          </>
        }
      />

      {closings.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">아직 마감된 달이 없습니다.</p>
          <p className="mt-1 text-xs text-gray-400">
            정산 화면에서 원천 파일을 올리고 확정·마감하면 여기에 나타납니다.
          </p>
          <Link
            href="/app/settlement"
            className="mt-4 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            정산 화면으로
          </Link>
        </div>
      ) : (
        <>
          {/* 기간 선택 — 라벨이 없으면 상태 배지처럼 보인다 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium text-gray-400">조회 기간</span>
            {closings.map((c) => (
              <Link
                key={c.period}
                href={`/app/settlement/report?period=${c.period}`}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  c.period === period
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {periodLabel(c.period)}
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${
                    c.period === period ? 'bg-white/20' : STATUS_STYLE[c.status]
                  }`}
                >
                  {STATUS_LABEL[c.status]}
                </span>
              </Link>
            ))}
          </div>

          {!detail ? (
            <p className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
              {period ? `${periodLabel(period)} 마감 자료를 찾지 못했습니다.` : ''}
            </p>
          ) : (
            <div className="space-y-6">
              {/*
                마감 메모. 지금은 `테스트 마감` 표시에 쓴다 — 이게 안 보이면
                테스트 자료를 실제 장부로 착각하게 된다. 재확정하면 비워진다.
              */}
              {detail.closing.note && (
                <p className="rounded-2xl border border-amber-300 bg-amber-50 px-6 py-4 text-sm text-amber-900">
                  <span className="font-semibold">이 마감에 메모가 있습니다 — </span>
                  {detail.closing.note}
                </p>
              )}
              {period && (
                <ReportDownloads
                  period={period}
                  taxableCount={taxableCount}
                  exemptCount={exemptCount}
                  partners={detail.partners.map((p) => ({
                    partnerId: p.partnerId,
                    partnerName: p.partnerName,
                  }))}
                  closingRevision={detail.closing.revision}
                  statementVenues={statementVenues}
                />
              )}
              <ReportBody detail={detail} collection={collection} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ReportBody({
  detail,
  collection,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof loadClosingDetail>>>
  collection: Awaited<ReturnType<typeof loadCollection>>
}) {
  const { closing, venues, partners } = detail
  const t = closing.totals
  const byVenue = rollupByKindergarten(venues)
  const bySource = rollupBySource(venues)
  const billed = byVenue.filter((v) => !v.isExcluded)
  const excluded = byVenue.filter((v) => v.isExcluded)

  // 공급사 합계 — 두 원천을 더한다. 화면이 직접 더하면 열이 늘 때마다 어긋난다.
  const sourceTotals = (['shinsegae', 'cj'] as const).reduce(
    (acc, s) => {
      const r = bySource[s]
      return {
        restaurantCount: acc.restaurantCount + r.restaurantCount,
        costTotal: acc.costTotal + r.costTotal,
        priceTotal: acc.priceTotal + r.priceTotal,
        margin: acc.margin + r.margin,
        excludedCost: acc.excludedCost + r.excludedCost,
        excludedPrice: acc.excludedPrice + r.excludedPrice,
      }
    },
    { restaurantCount: 0, costTotal: 0, priceTotal: 0, margin: 0, excludedCost: 0, excludedPrice: 0 }
  )

  return (
    <div className="mt-6 space-y-6">
      {/* ── 헤드라인 ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-gray-900">
            {periodLabel(closing.period)} 손익
            <span
              className={`ml-3 rounded px-2 py-0.5 text-xs font-medium ${
                STATUS_STYLE[closing.status]
              }`}
            >
              {STATUS_LABEL[closing.status]}
            </span>
          </h2>
          <span className="text-xs text-gray-400">리비전 {closing.revision}</span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Headline label="매출" value={t.revenue} hint="계산서 발행분" />
          <Headline
            label="총마진"
            value={t.grossMargin}
            hint={`매출 대비 ${pct(t.revenue === 0 ? 0 : t.grossMargin / t.revenue)}`}
          />
          <Headline
            label="영업이익"
            value={t.operatingProfit}
            hint="본사 몫 − 마케팅비"
            strong
          />
        </div>

        {/* 워터폴 */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-right text-sm">
            <tbody className="divide-y divide-gray-100">
              <Row id="pnl-revenue" label="매출 (계산서 발행분)" value={t.revenue} />
              <Row id="pnl-cost" label="매출원가" value={-t.costOfSales} />
              <Row id="pnl-margin" label="총마진" value={t.grossMargin} bold />
              <Row id="pnl-pretax" label="영업자 세전 지급액" value={-t.partnerPreTax} />
              <Row
                id="pnl-hq"
                label="본사 몫"
                value={t.hqShare}
                bold
                note={`적립금 ${won(t.platformFee)} + 부가세차액 ${won(
                  t.vatDiff
                )} + 공제 ${won(t.businessDeduction)}`}
              />
              <Row id="pnl-marketing" label="마케팅비 (본사 자체 소비분)" value={-t.marketingCost} />
              <Row id="pnl-profit" label="영업이익" value={t.operatingProfit} total />
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 세금 3종 (§13-2 ③) ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">세금</h2>
        <p className="mt-1 text-xs text-gray-500">
          성격과 납부 시점이 달라 따로 봅니다.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Headline
            label="부가가치세 (분기 신고)"
            value={t.vatPayable}
            hint={`매출세액 ${won(t.salesVat)} − 매입세액 ${won(t.purchaseVat)}`}
          />
          <Headline
            label="원천세 (익월 10일)"
            value={t.withholding}
            hint="영업자 사업소득 3.3%"
          />
          <Headline
            label="사업소득 신고액"
            value={t.declared}
            hint="지급명세서 제출분"
          />
        </div>
        {t.vatDiffGap !== 0 && (
          <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
            <strong>대조</strong> — 영업자에게 회수한 부가세차액({won(t.vatDiff)})이 실제
            납부액({won(t.vatPayable)})보다 <strong>{won(t.vatDiffGap)}원</strong> 많습니다.
            정산제외 사업장(마케팅비)의 매입세액을 공제받기 때문이고, 이상 항목이 아닙니다.
            매달 이 차이가 마케팅비 매입세액과 같은지만 확인하면 됩니다.
          </p>
        )}
      </section>

      {/* ── 공급사별 매입·매출 (§13-2 ①) ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">공급사별</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-right text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="py-2 text-left font-medium">공급사</th>
                <th className="py-2 font-medium">식당</th>
                <th className="py-2 font-medium">매입</th>
                <th className="py-2 font-medium">매출</th>
                <th className="py-2 font-medium">마진</th>
                <th className="py-2 font-medium">마진율</th>
                <th className="py-2 font-medium text-gray-400">제외 매입</th>
                <th className="py-2 font-medium text-gray-400">제외 매출</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(['shinsegae', 'cj'] as const).map((s) => {
                const r = bySource[s]
                return (
                  <tr key={s}>
                    <td className="py-2 text-left font-medium text-gray-900">
                      {SOURCE_LABEL[s]}
                    </td>
                    <td className="py-2 tabular-nums">{r.restaurantCount}</td>
                    <td className="py-2 tabular-nums">{won(r.costTotal)}</td>
                    <td className="py-2 tabular-nums">{won(r.priceTotal)}</td>
                    <td className="py-2 tabular-nums">{won(r.margin)}</td>
                    <td className="py-2 tabular-nums">
                      {r.priceTotal === 0 ? '—' : pct(r.margin / r.priceTotal)}
                    </td>
                    <td className="py-2 tabular-nums text-gray-500">
                      {r.excludedCost === 0 ? '—' : won(r.excludedCost)}
                    </td>
                    <td className="py-2 tabular-nums text-gray-500">
                      {r.excludedPrice === 0 ? '—' : won(r.excludedPrice)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 text-sm font-semibold">
              <tr>
                <td className="py-2 text-left">합계</td>
                <td className="py-2 tabular-nums">{sourceTotals.restaurantCount}</td>
                <td className="py-2 tabular-nums">{won(sourceTotals.costTotal)}</td>
                <td className="py-2 tabular-nums">
                  <PnlLink to="pnl-revenue">{won(sourceTotals.priceTotal)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums">{won(sourceTotals.margin)}</td>
                <td className="py-2 tabular-nums">
                  {sourceTotals.priceTotal === 0
                    ? '—'
                    : pct(sourceTotals.margin / sourceTotals.priceTotal)}
                </td>
                <td className="py-2 tabular-nums text-gray-500">
                  <PnlLink to="pnl-marketing">{won(sourceTotals.excludedCost)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums text-gray-500">
                  {won(sourceTotals.excludedPrice)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-gray-400">
          정산제외 사업장은 <strong>매입 {won(sourceTotals.excludedCost)}원 포함</strong>,{' '}
          <strong>매출 {won(sourceTotals.excludedPrice)}원 제외</strong>했습니다. 위 매입
          열에는 이 금액이 들어 있고 매출 열에는 들어 있지 않습니다.
        </p>
      </section>

      {/* ── 영업자별 (§13-2 ②) ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">영업자별 정산</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-right text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="py-2 text-left font-medium">영업자</th>
                <th className="py-2 font-medium">차액 M</th>
                <th className="py-2 font-medium">적립금 O</th>
                <th className="py-2 font-medium">부가세차액 P</th>
                <th className="py-2 font-medium">공제 Q</th>
                <th className="py-2 font-medium">세전 R</th>
                <th className="py-2 font-medium">신고액 V</th>
                <th className="py-2 font-medium">원천세</th>
                <th className="py-2 font-medium">실지급 U</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {partners.map((p) => (
                <tr key={p.partnerId}>
                  <td className="py-2 text-left">
                    <span className="font-medium text-gray-900">{p.partnerName}</span>
                    {p.partnerType === 'cofounder' && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                        코파운더
                      </span>
                    )}
                    <span className="ml-2 text-xs text-gray-400">
                      {p.commissionPercent}%
                    </span>
                  </td>
                  <td className="py-2 tabular-nums">{won(p.margin)}</td>
                  <td className="py-2 tabular-nums">{won(p.platformFee)}</td>
                  <td className="py-2 tabular-nums">{won(p.vatDiff)}</td>
                  <td className="py-2 tabular-nums">{won(p.businessDeduction)}</td>
                  <td className="py-2 tabular-nums">{won(p.preTax)}</td>
                  <td className="py-2 tabular-nums">{won(p.declared)}</td>
                  <td className="py-2 tabular-nums">{won(p.incomeTax + p.localTax)}</td>
                  <td className="py-2 font-semibold tabular-nums text-gray-900">
                    {won(p.netPay)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 text-sm font-semibold">
              <tr>
                <td className="py-2 text-left">합계</td>
                <td className="py-2 tabular-nums">
                  <PnlLink to="pnl-margin">{won(t.grossMargin)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums">
                  <PnlLink to="pnl-hq">{won(t.platformFee)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums">
                  <PnlLink to="pnl-hq">{won(t.vatDiff)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums">
                  <PnlLink to="pnl-hq">{won(t.businessDeduction)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums">
                  <PnlLink to="pnl-pretax">{won(t.partnerPreTax)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums">{won(t.declared)}</td>
                <td className="py-2 tabular-nums">{won(t.withholding)}</td>
                <td className="py-2 tabular-nums text-gray-900">{won(t.partnerNetPay)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-gray-400">
          차액 합계 <PnlLink to="pnl-margin">{won(t.grossMargin)}</PnlLink> − 세전 합계{' '}
          <PnlLink to="pnl-pretax">{won(t.partnerPreTax)}</PnlLink> = 본사 몫{' '}
          <PnlLink to="pnl-hq">{won(t.hqShare)}</PnlLink>
        </p>
      </section>

      {/* ── 유치원별 (§13-2 ①) ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">
          유치원별 매출·매입
          <span className="ml-2 text-xs font-normal text-gray-400">{billed.length}곳</span>
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[860px] text-right text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="py-2 text-left font-medium">유치원</th>
                <th className="py-2 text-left font-medium">담당</th>
                <th className="py-2 font-medium">식당</th>
                <th className="py-2 font-medium">매입</th>
                <th className="py-2 font-medium">과세</th>
                <th className="py-2 font-medium">면세</th>
                <th className="py-2 font-medium">청구액</th>
                <th className="py-2 font-medium">마진</th>
                <th className="py-2 font-medium">마진율</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {billed.map((v) => (
                <tr key={`${v.source}:${v.businessCode}`}>
                  <td className="py-2 text-left">
                    <span className="font-medium text-gray-900">{v.label}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {SOURCE_LABEL[v.source]} {v.businessCode}
                    </span>
                  </td>
                  <td className="py-2 text-left text-gray-600">{v.partnerName ?? '—'}</td>
                  <td className="py-2 tabular-nums">{v.restaurantCount}</td>
                  <td className="py-2 tabular-nums">{won(v.costTotal)}</td>
                  <td className="py-2 tabular-nums">
                    {won(v.priceTaxableSupply + v.priceVat)}
                  </td>
                  <td className="py-2 tabular-nums">{won(v.priceExempt)}</td>
                  <td className="py-2 tabular-nums">{won(v.priceTotal)}</td>
                  <td className="py-2 tabular-nums">{won(v.margin)}</td>
                  <td className="py-2 tabular-nums">{pct(v.marginRate)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 text-sm font-semibold">
              <tr>
                <td className="py-2 text-left" colSpan={3}>
                  합계
                </td>
                <td className="py-2 tabular-nums">
                  <PnlLink to="pnl-cost">{won(t.costOfSales)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums">
                  {won(t.revenue - sumExempt(billed))}
                </td>
                <td className="py-2 tabular-nums">{won(sumExempt(billed))}</td>
                <td className="py-2 tabular-nums">
                  <PnlLink to="pnl-revenue">{won(t.revenue)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums">
                  <PnlLink to="pnl-margin">{won(t.grossMargin)}</PnlLink>
                </td>
                <td className="py-2 tabular-nums">
                  {pct(t.revenue === 0 ? 0 : t.grossMargin / t.revenue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {excluded.length > 0 && (
          <div className="mt-5 rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium text-gray-700">정산 제외</p>
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {excluded.map((v) => (
                <li key={`${v.source}:${v.businessCode}`}>
                  {SOURCE_LABEL[v.source]} _ {stripSourcePrefix(v.label)} : 매입{' '}
                  <PnlLink to="pnl-marketing">{won(v.costTotal)}원</PnlLink>
                  _마케팅비 본사_유치원 매출 계산서 미발행분
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── 발생 vs 현금 (§13-3) ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-gray-900">발생 vs 현금</h2>
          <Link
            href="/app/settlement/collection"
            className="text-xs text-gray-500 underline hover:text-gray-900"
          >
            수금·지급 관리 →
          </Link>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          왼쪽은 <strong>청구·지급 예정액</strong>(발생), 오른쪽은{' '}
          <strong>실제 입출금</strong>입니다. 차이가 미수금·미지급입니다.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-right text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="py-2 text-left font-medium">항목</th>
                <th className="py-2 font-medium">발생</th>
                <th className="py-2 font-medium">현금</th>
                <th className="py-2 font-medium">잔액</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="py-2 text-left">유치원 청구 · 수금</td>
                <td className="py-2 tabular-nums">{won(t.revenue)}</td>
                <td className="py-2 tabular-nums">{won(collection?.summary.totals.received ?? 0)}</td>
                <td
                  className={`py-2 tabular-nums ${
                    (collection?.summary.totals.outstanding ?? t.revenue) > 0
                      ? 'font-medium text-red-600'
                      : ''
                  }`}
                >
                  {won(collection?.summary.totals.outstanding ?? t.revenue)}
                </td>
              </tr>
              <tr>
                <td className="py-2 text-left">영업자 실지급 · 지급</td>
                <td className="py-2 tabular-nums">{won(t.partnerNetPay)}</td>
                <td className="py-2 tabular-nums">{won(collection?.summary.totals.paid ?? 0)}</td>
                <td
                  className={`py-2 tabular-nums ${
                    (collection?.summary.totals.unpaid ?? t.partnerNetPay) > 0
                      ? 'font-medium text-red-600'
                      : ''
                  }`}
                >
                  {won(collection?.summary.totals.unpaid ?? t.partnerNetPay)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {collection && collection.summary.readyToPay.length > 0 && (
          <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <strong>지급 요청 {collection.summary.readyToPay.length}명</strong> — 담당 유치원
            전원 입금 완료:{' '}
            {collection.summary.readyToPay.map((p) => p.partnerName).join(', ')}
          </p>
        )}

        <h3 className="mt-6 text-sm font-medium text-gray-900">발생 기준 현금 추정</h3>
        <p className="mt-1 text-xs text-gray-500">
          전액 수금·지급됐다고 가정한 값입니다. 실제 통장 잔액과는 위 잔액만큼 차이가 납니다.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-right text-sm">
            <tbody className="divide-y divide-gray-100">
              <Row label="유입 — 유치원 수금" value={t.revenue} />
              <Row label="유출 — 신세계·CJ 대금" value={-(t.costOfSales + t.marketingCost)} />
              <Row label="유출 — 영업자 실지급" value={-t.partnerNetPay} />
              <Row label="유출 — 원천세 (익월 10일)" value={-t.withholding} />
              <Row label="유출 — 부가세 (분기)" value={-t.vatPayable} />
              <Row
                label="순현금"
                value={
                  t.revenue -
                  (t.costOfSales + t.marketingCost) -
                  t.partnerNetPay -
                  t.withholding -
                  t.vatPayable
                }
                total
              />
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-gray-400">
          발생 기준 영업이익 {won(t.operatingProfit)}과 순현금이 다른 이유: 원천세·부가세는
          나중에 나가고, 신세계·CJ 대금에 마케팅비 매입이 함께 들어 있습니다.
        </p>
      </section>
    </div>
  )
}

/**
 * 신세계 사업장명의 `EDU)키즈_` 접두를 뗀다.
 *
 * 원천 시스템의 내부 표기라 보고서에서는 의미가 없다.
 * (`venueDisplayName`이 내역서에서 하는 것과 같은 처리)
 */
function stripSourcePrefix(name: string): string {
  return name.replace(/^EDU\)키즈_/, '')
}

function sumExempt(rows: readonly { priceExempt: number }[]): number {
  return rows.reduce((acc, r) => acc + r.priceExempt, 0)
}

function Headline({
  label,
  value,
  hint,
  strong,
}: {
  label: string
  value: number
  hint: string
  strong?: boolean
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        strong ? 'border-gray-900 bg-gray-900' : 'border-gray-200'
      }`}
    >
      <p className={`text-xs ${strong ? 'text-gray-300' : 'text-gray-500'}`}>{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          strong ? 'text-white' : 'text-gray-900'
        }`}
      >
        {won(value)}
      </p>
      <p className={`mt-0.5 text-xs ${strong ? 'text-gray-400' : 'text-gray-400'}`}>{hint}</p>
    </div>
  )
}

/**
 * 손익 워터폴 한 줄.
 *
 * `id`를 주면 세부 카드에서 `#id`로 건너뛸 수 있다. 이동한 행은 CSS `:target`으로
 * 노랗게 표시된다 — 자바스크립트 없이 서버 컴포넌트에서 동작한다.
 * `scroll-mt-24`는 상단에 가려지지 않게 여백을 준다.
 */
function Row({
  id,
  label,
  value,
  bold,
  total,
  note,
}: {
  id?: string
  label: string
  value: number
  bold?: boolean
  total?: boolean
  note?: string
}) {
  return (
    <tr
      id={id}
      className={`scroll-mt-24 target:bg-amber-100 target:ring-2 target:ring-amber-400 ${
        total ? 'border-t-2 border-gray-300 text-base font-semibold' : bold ? 'font-medium' : ''
      }`}
    >
      <td className="py-2 text-left">
        {label}
        {note && <span className="ml-2 text-xs font-normal text-gray-400">{note}</span>}
      </td>
      <td className="py-2 tabular-nums">
        {value < 0 ? `− ${won(Math.abs(value))}` : won(value)}
      </td>
    </tr>
  )
}

/**
 * 손익 워터폴의 같은 값으로 건너뛰는 링크.
 *
 * 세부 카드의 숫자가 **손익 카드의 어느 줄에서 온 것인지**를 클릭 한 번으로 잇는다.
 * 값이 다른 항목에는 붙이지 않는다 — 잘못 이으면 대조가 틀어진다.
 */
function PnlLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <a
      href={`#${to}`}
      className="underline decoration-gray-300 decoration-dotted underline-offset-4 hover:decoration-gray-900"
      title="손익 카드의 해당 줄로 이동"
    >
      {children}
    </a>
  )
}
