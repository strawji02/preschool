'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// ⚠️ 클라이언트 전용 배럴을 쓴다. 메인 배럴은 Supabase service_role 접근 코드를
// 함께 내보내므로 브라우저 번들에 서버 코드가 끌려 들어간다.
import {
  DEDUCTION_CATEGORIES,
  buildDeclarationLines,
  calcSettlement,
  sumDeductionItems,
  type DeclarationSplit,
  type DeductionItem,
  type PartnerType,
  type SettlementResult,
} from '@/features/settlement/client'

/**
 * 정산 작업 화면.
 *
 * 사업자공제(Q)를 바꿀 때마다 서버를 왕복하지 않는다 — 산식이 순수 함수라
 * 브라우저에서 그대로 돌린다. 다운로드 시점에만 서버가 같은 산식으로 다시 계산한다.
 */

interface AnalyzedPartner {
  partnerId: string
  partnerName: string
  partnerType: PartnerType
  venueCount: number
  costTotal: number
  costVat: number
  priceTotal: number
  priceVat: number
}

interface AnalyzeResponse {
  success: boolean
  error?: string
  partners: AnalyzedPartner[]
  excluded: { businessName: string; costTotal: number; priceTotal: number }[]
  unmapped: { source: string; businessCode: string; businessName: string; costTotal: number }[]
  sources: {
    shinsegae: { fileName: string; sheetName: string; venueCount: number } | null
    cj: { fileName: string; sheetName: string; venueCount: number } | null
  }
  warnings: string[]
  errors: string[]
  canClose: boolean
}

const won = (n: number) => n.toLocaleString('ko-KR')

const EXCEL_EXT = /\.(xlsx|xls|xlsm)$/i

export default function SettlementWorkspace() {
  const fileInput = useRef<HTMLInputElement>(null)
  /** dragleave가 자식 요소로 이동할 때도 발생하므로 깊이를 세서 깜빡임을 막는다 */
  const dragDepth = useRef(0)
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  const [deductions, setDeductions] = useState<Record<string, DeductionItem[]>>({})
  /** 분할 신고 명의 (docs §4). 비어 있으면 영업자 본인 명의로 신고한다. */
  const [splits, setSplits] = useState<Record<string, DeclarationSplit[]>>({})
  const [period, setPeriod] = useState(defaultPeriod())
  const [busy, setBusy] = useState<'analyze' | 'download' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** 파일 추가 — 같은 파일을 두 번 넣지 않는다 (이름+크기로 판별) */
  const addFiles = useCallback((incoming: readonly File[]) => {
    const excel = incoming.filter((f) => EXCEL_EXT.test(f.name))
    const skipped = incoming.length - excel.length

    if (excel.length === 0) {
      setError(
        skipped > 0
          ? '엑셀 파일(.xlsx/.xls/.xlsm)만 올릴 수 있습니다.'
          : '읽을 수 있는 파일이 없습니다.'
      )
      return
    }

    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const added = excel.filter((f) => !seen.has(`${f.name}:${f.size}`))
      if (added.length === 0) {
        setNotice('이미 추가된 파일입니다.')
        return prev
      }
      setError(null)
      setNotice(
        `${added.length}개 추가${skipped > 0 ? ` (엑셀이 아닌 ${skipped}개는 무시)` : ''}`
      )
      return [...prev, ...added]
    })
    setAnalysis(null)
  }, [])

  /**
   * 드래그&드롭 — **페이지 전체**를 드롭 대상으로 잡는다.
   *
   * 처음엔 드롭존 div에만 핸들러를 달았는데 동작하지 않았다. 요소 단위로 달면
   * (1) 조금만 빗나가도 브라우저가 파일을 열어버리고 (2) 자식 요소 위를 지날 때
   * dragleave가 튀어 상태가 흔들린다. window에 달면 어디에 떨어뜨려도 받는다.
   *
   * `dragover`에서 preventDefault를 하지 않으면 브라우저가 기본 동작(파일 열기)을
   * 하므로 반드시 필요하다. dragenter/dragover 둘 다 막는 게 표준 권장이다.
   *
   * 깊이 카운터를 쓰는 이유: dragleave는 자식 요소로 이동할 때도 발생해서
   * 단순히 false로 만들면 하이라이트가 깜빡인다.
   */
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files')

    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current += 1
      setDragging(true)
    }
    function onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault() // 없으면 브라우저가 파일을 열어버린다
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const dropped = Array.from(e.dataTransfer?.files ?? [])
      if (dropped.length > 0) addFiles(dropped)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [addFiles])

  /**
   * 붙여넣기 — 클립보드에 **파일 데이터**가 들어있을 때만 동작한다.
   *
   * ⚠️ Windows 탐색기에서 파일을 복사(Ctrl+C)한 것은 Chrome이 웹페이지에 노출하지
   * 않는다(보안 제약). 그래서 탐색기 복붙은 원리적으로 불가능하다.
   * 반면 스크린샷처럼 클립보드에 데이터 자체가 담긴 경우는 여기서 받힌다.
   * 엑셀 업로드 용도로는 사실상 쓰이지 않지만, 되는 경우를 막을 이유는 없어 남긴다.
   */
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const pasted = Array.from(e.clipboardData?.files ?? [])
      if (pasted.length === 0) return
      e.preventDefault()
      addFiles(pasted)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  function buildFormData(): FormData {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    return fd
  }

  async function analyze() {
    if (files.length === 0) {
      setError('엑셀 파일을 올려주세요.')
      return
    }
    setBusy('analyze')
    setError(null)
    setNotice(null)
    setAnalysis(null)
    try {
      const res = await fetch('/api/settlement/analyze', {
        method: 'POST',
        body: buildFormData(),
      })
      const json: AnalyzeResponse = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error ?? '분석에 실패했습니다.')
        return
      }
      setAnalysis(json)
      setDeductions({})
    } catch (e) {
      setError(e instanceof Error ? e.message : '분석 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    setBusy('download')
    setError(null)
    try {
      const fd = buildFormData()
      fd.append('deductionItems', JSON.stringify(deductions))
      fd.append('splits', JSON.stringify(splits))
      fd.append('period', period)

      const res = await fetch('/api/settlement/report', { method: 'POST', body: fd })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setError(json?.error ?? '내역서 생성에 실패했습니다.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `정산내역서_${period || '기간미지정'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : '다운로드 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  /** 공제액을 반영한 산식 결과 — 항목이 바뀌면 즉시 다시 계산된다 */
  const settlements = useMemo(() => {
    const map = new Map<string, SettlementResult>()
    for (const p of analysis?.partners ?? []) {
      map.set(
        p.partnerId,
        calcSettlement({
          costTotal: p.costTotal,
          costVat: p.costVat,
          priceTotal: p.priceTotal,
          priceVat: p.priceVat,
          partnerType: p.partnerType,
          businessDeduction: sumDeductionItems(deductions[p.partnerId] ?? []),
        })
      )
    }
    return map
  }, [analysis, deductions])

  const totals = useMemo(() => {
    let preTax = 0
    let netPay = 0
    let declared = 0
    let deduction = 0
    for (const s of settlements.values()) {
      preTax += s.preTax
      netPay += s.netPay
      declared += s.declared
      deduction += s.businessDeduction
    }
    return { preTax, netPay, declared, deduction }
  }, [settlements])

  /**
   * 지급명세서 미리보기 (docs §6-3).
   *
   * 서버가 다운로드 시점에 같은 함수로 다시 만든다. 여기서 미리 보여주는 이유는
   * **분할 합계가 틀리면 다운로드가 막히기 때문**이다 — 눌러보고 실패하는 대신
   * 입력하는 즉시 어긋난 금액을 알려준다.
   */
  const declaration = useMemo(
    () =>
      buildDeclarationLines(
        (analysis?.partners ?? []).map((p) => ({
          partnerName: p.partnerName,
          declared: settlements.get(p.partnerId)?.declared ?? 0,
          splits: splits[p.partnerId],
        }))
      ),
    [analysis, settlements, splits]
  )

  /** 분할 합계 불일치는 마감 차단 사유다 (docs §4) */
  const splitBlocked = declaration.warnings.some((w) => w.includes('마감할 수 없습니다'))

  return (
    <div className="mt-8 space-y-6">
      {/*
        드래그 중 전체 화면 안내.
        `pointer-events-none`이 필수다 — 이 오버레이가 마우스를 받으면 dragleave/drop이
        오버레이에서 발생해 파일 인식이 흔들린다.
      */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20">
          <div className="rounded-2xl border-2 border-dashed border-gray-900 bg-white px-8 py-6 text-center shadow-lg">
            <p className="font-semibold text-gray-900">여기에 놓으세요</p>
            <p className="mt-1 text-xs text-gray-500">화면 어디에 놓아도 됩니다</p>
          </div>
        </div>
      )}

      {/* 1. 업로드 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">1. 원천 파일 업로드</h2>

        {/*
          드래그 처리는 window 리스너가 담당한다 (위 useEffect 참고).
          요소에 직접 달면 조금만 빗나가도 브라우저가 파일을 열어버린다.
          클릭 경로는 label + 숨은 input — 같은 저장소의 /calc-food UploadZone과 동일한 패턴.
        */}
        <label
          className={`mt-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging
              ? 'border-gray-900 bg-gray-100'
              : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".xlsx,.xls,.xlsm"
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = '' // 같은 파일 다시 선택 가능하게
            }}
          />
          <p className="text-sm font-medium text-gray-700">
            {dragging ? (
              '여기에 놓으세요'
            ) : (
              <>
                파일을 <span className="underline">화면 아무 곳에나</span> 끌어다 놓거나 클릭해서
                선택하세요
              </>
            )}
          </p>
          <p className="mt-3 text-xs text-gray-400">
            신세계 품목 시트 + CJ 집계표 · 통합 파일 1개도 가능 · .xlsx / .xls / .xlsm
          </p>
        </label>

        {files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((f) => (
              <li
                key={`${f.name}:${f.size}`}
                className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="truncate text-gray-700">
                  {f.name}
                  <span className="ml-2 text-xs text-gray-400">
                    {(f.size / 1024).toFixed(0)}KB
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFiles((prev) =>
                      prev.filter((x) => `${x.name}:${x.size}` !== `${f.name}:${f.size}`)
                    )
                    setAnalysis(null)
                  }}
                  className="ml-3 shrink-0 text-xs text-gray-400 hover:text-red-600"
                >
                  제거
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={analyze}
            disabled={busy !== null || files.length === 0}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'analyze' ? '분석 중…' : '분석'}
          </button>
          {files.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setFiles([])
                setAnalysis(null)
                setNotice(null)
              }}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              전체 지우기
            </button>
          )}
          {notice && <span className="text-xs text-gray-500">{notice}</span>}
        </div>
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {analysis && (
        <>
          {/* 2. 판별 결과 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">2. 판별된 원천 시트</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <SourceCard label="신세계" src={analysis.sources.shinsegae} />
              <SourceCard label="CJ" src={analysis.sources.cj} />
            </dl>

            {analysis.excluded.length > 0 && (
              <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">
                정산 제외 {analysis.excluded.length}건 —{' '}
                {analysis.excluded.map((e) => e.businessName).join(', ')} (원가{' '}
                {won(analysis.excluded.reduce((s, e) => s + e.costTotal, 0))}원)
              </p>
            )}

            {analysis.unmapped.length > 0 && (
              <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                <p className="font-medium">
                  담당 영업자가 지정되지 않은 사업장 {analysis.unmapped.length}건 — 마감할 수 없습니다
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {analysis.unmapped.map((u) => (
                    <li key={`${u.source}:${u.businessCode}`}>
                      {u.source}:{u.businessCode} {u.businessName} (원가 {won(u.costTotal)}원)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.warnings.length > 0 && (
              <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
                {analysis.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </section>

          {/* 3. 사업자공제 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">3. 사업자공제 입력</h2>
            <p className="mt-1 text-xs text-gray-500">
              항목별로 넣으면 합계가 산식의 공제액(Q)이 됩니다. 입력 내역은 내역서의{' '}
              <span className="font-medium">사업자공제 상세</span> 시트로 함께 저장됩니다.
            </p>

            <div className="mt-4 space-y-4">
              {analysis.partners.map((p) => (
                <DeductionEditor
                  key={p.partnerId}
                  partnerName={p.partnerName}
                  items={deductions[p.partnerId] ?? []}
                  onChange={(items) =>
                    setDeductions((prev) => ({ ...prev, [p.partnerId]: items }))
                  }
                />
              ))}
            </div>
          </section>

          {/* 4. 정산 결과 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">4. 영업자별 정산</h2>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-right text-sm">
                <thead className="border-b border-gray-200 text-xs text-gray-500">
                  <tr>
                    <th className="py-2 text-left font-medium">영업자</th>
                    <th className="py-2 font-medium">원가합계</th>
                    <th className="py-2 font-medium">단가합계</th>
                    <th className="py-2 font-medium">적립금</th>
                    <th className="py-2 font-medium">부가세차액</th>
                    <th className="py-2 font-medium">사업자공제</th>
                    <th className="py-2 font-medium">세전</th>
                    <th className="py-2 font-medium">신고액</th>
                    <th className="py-2 font-medium">실지급</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {analysis.partners.map((p) => {
                    const s = settlements.get(p.partnerId)
                    if (!s) return null
                    return (
                      <tr key={p.partnerId}>
                        <td className="py-2 text-left">
                          <span className="font-medium text-gray-900">{p.partnerName}</span>
                          {p.partnerType === 'cofounder' && (
                            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                              코파운더
                            </span>
                          )}
                          <span className="ml-2 text-xs text-gray-400">
                            식당 {p.venueCount}
                          </span>
                        </td>
                        <td className="py-2 tabular-nums">{won(p.costTotal)}</td>
                        <td className="py-2 tabular-nums">{won(p.priceTotal)}</td>
                        <td className="py-2 tabular-nums">{won(s.platformFee)}</td>
                        <td className="py-2 tabular-nums">{won(s.vatDiff)}</td>
                        <td className="py-2 tabular-nums">{won(s.businessDeduction)}</td>
                        <td className="py-2 tabular-nums">{won(s.preTax)}</td>
                        <td className="py-2 tabular-nums">{won(s.declared)}</td>
                        <td className="py-2 font-semibold tabular-nums text-gray-900">
                          {won(s.netPay)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="border-t-2 border-gray-300 text-sm font-semibold">
                  <tr>
                    <td className="py-2 text-left">합계</td>
                    <td colSpan={4} />
                    <td className="py-2 tabular-nums">{won(totals.deduction)}</td>
                    <td className="py-2 tabular-nums">{won(totals.preTax)}</td>
                    <td className="py-2 tabular-nums">{won(totals.declared)}</td>
                    <td className="py-2 tabular-nums text-gray-900">{won(totals.netPay)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {[...settlements.values()].some((s) => s.warnings.length > 0) && (
              <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
                {[...settlements.entries()].flatMap(([id, s]) =>
                  s.warnings.map((w, i) => {
                    const name = analysis.partners.find((p) => p.partnerId === id)?.partnerName
                    return (
                      <li key={`${id}-${i}`}>
                        {name}: {w}
                      </li>
                    )
                  })
                )}
              </ul>
            )}
          </section>

          {/* 5. 분할 신고 + 지급명세서 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">5. 사업소득 지급명세서</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              세무사 제출용입니다. 비워 두면 영업자 본인 명의로 신고합니다. 여러 명 명의로
              나눠 신고하려면 아래에 성명과 금액을 넣으세요 — <strong>합계가 신고액과
              정확히 같아야</strong> 내역서를 만들 수 있습니다.
              <br />
              <span className="text-gray-400">
                주민번호 칸은 빈칸으로 출력됩니다. 저장하지 않으니 다운로드 후 직접
                채워 주세요.
              </span>
            </p>

            <div className="mt-4 space-y-4">
              {analysis.partners.map((p) => {
                const declared = settlements.get(p.partnerId)?.declared ?? 0
                return (
                  <SplitEditor
                    key={p.partnerId}
                    partnerName={p.partnerName}
                    declared={declared}
                    splits={splits[p.partnerId] ?? []}
                    onChange={(next) =>
                      setSplits((prev) => ({ ...prev, [p.partnerId]: next }))
                    }
                  />
                )
              })}
            </div>

            {declaration.warnings.length > 0 && (
              <ul
                className={`mt-4 space-y-1 rounded-lg px-4 py-3 text-xs ${
                  splitBlocked ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
                }`}
              >
                {declaration.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            {declaration.lines.length > 0 && (
              <div className="mt-5 overflow-x-auto">
                <p className="mb-2 text-xs font-medium text-gray-500">
                  신고 내역 미리보기 — 내역서의{' '}
                  <span className="text-gray-900">사업소득 신고내역</span> 시트로 나갑니다
                </p>
                <table className="w-full min-w-[620px] text-right text-sm">
                  <thead className="border-b border-gray-200 text-xs text-gray-500">
                    <tr>
                      <th className="py-2 text-left font-medium">성명</th>
                      <th className="py-2 font-medium">사업소득액</th>
                      <th className="py-2 font-medium">소득세</th>
                      <th className="py-2 font-medium">지방소득세</th>
                      <th className="py-2 font-medium">소득세계</th>
                      <th className="py-2 font-medium">실지급액</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {declaration.lines.map((l) => (
                      <tr key={`${l.partnerName}-${l.seq}`}>
                        <td className="py-2 text-left">
                          <span className="font-medium text-gray-900">{l.name}</span>
                          {l.name !== l.partnerName && (
                            <span className="ml-2 text-xs text-gray-400">
                              {l.partnerName} 분할
                            </span>
                          )}
                        </td>
                        <td className="py-2 tabular-nums">{won(l.amount)}</td>
                        <td className="py-2 tabular-nums">{won(l.incomeTax)}</td>
                        <td className="py-2 tabular-nums">{won(l.localTax)}</td>
                        <td className="py-2 tabular-nums">{won(l.taxTotal)}</td>
                        <td className="py-2 font-semibold tabular-nums text-gray-900">
                          {won(l.netPay)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-300 text-sm font-semibold">
                    <tr>
                      <td className="py-2 text-left">계</td>
                      <td className="py-2 tabular-nums">{won(declaration.totals.amount)}</td>
                      <td className="py-2 tabular-nums">
                        {won(declaration.totals.incomeTax)}
                      </td>
                      <td className="py-2 tabular-nums">{won(declaration.totals.localTax)}</td>
                      <td className="py-2 tabular-nums">{won(declaration.totals.taxTotal)}</td>
                      <td className="py-2 tabular-nums text-gray-900">
                        {won(declaration.totals.netPay)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className="mt-2 text-xs leading-relaxed text-gray-400">
                  ⚠️ 이 표의 <strong>실지급액은 사업소득액 − 소득세계</strong>입니다. 위 4번
                  표의 실지급(세전 − 세금)과는 값이 다릅니다 — 원본 엑셀도 같은 방식입니다.
                </p>
              </div>
            )}
          </section>

          {/* 6. 다운로드 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">6. 내역서 다운로드</h2>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-gray-500">정산 기간</span>
                <input
                  type="text"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  placeholder="26년6월"
                  className="rounded border border-gray-300 px-3 py-1.5 focus:border-gray-500 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={download}
                disabled={busy !== null || !analysis.canClose || splitBlocked}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'download' ? '생성 중…' : '엑셀 다운로드'}
              </button>
              {!analysis.canClose && (
                <span className="text-xs text-red-600">
                  매핑 누락을 해결해야 내역서를 만들 수 있습니다
                </span>
              )}
              {analysis.canClose && splitBlocked && (
                <span className="text-xs text-red-600">
                  분할 신고 합계를 신고액과 맞춰야 내역서를 만들 수 있습니다
                </span>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-gray-500">
              기존 <code className="rounded bg-gray-100 px-1">집계표_정산용</code> 시트와 같은
              레이아웃으로 만듭니다. 열 위치가 동일하니 나란히 놓고 대조해 보세요.
              <br />
              시트 3개가 들어갑니다 —{' '}
              <span className="font-medium text-gray-700">집계표_정산용</span> ·{' '}
              <span className="font-medium text-gray-700">사업자공제 상세</span> ·{' '}
              <span className="font-medium text-gray-700">사업소득 신고내역</span>
            </p>
          </section>
        </>
      )}
    </div>
  )
}

/**
 * 영업자 한 명의 분할 신고 명의 편집 (docs §4).
 *
 * 남은 금액을 항상 보여준다 — 합계가 신고액과 1원이라도 다르면 마감이 막히므로,
 * 사용자가 계산기를 두드리지 않아도 되게 한다.
 */
function SplitEditor({
  partnerName,
  declared,
  splits,
  onChange,
}: {
  partnerName: string
  declared: number
  splits: DeclarationSplit[]
  onChange: (splits: DeclarationSplit[]) => void
}) {
  const total = splits.reduce((sum, s) => sum + s.amount, 0)
  const remain = declared - total
  const active = splits.length > 0

  function update(index: number, patch: Partial<DeclarationSplit>) {
    onChange(splits.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-900">{partnerName}</span>
        <span className="text-sm tabular-nums text-gray-700">
          신고액 <span className="font-semibold">{won(declared)}</span>원
          {active && (
            <span className={remain === 0 ? 'ml-3 text-gray-500' : 'ml-3 text-red-600'}>
              {remain === 0 ? '분할 합계 일치' : `남은 금액 ${won(remain)}원`}
            </span>
          )}
        </span>
      </div>

      {active && (
        <ul className="mt-3 space-y-2">
          {splits.map((split, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={split.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="성명"
                className="w-32 rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
              />
              <input
                type="number"
                step={1}
                value={split.amount}
                onChange={(e) => update(i, { amount: Number(e.target.value) || 0 })}
                placeholder="금액"
                className="w-36 rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-gray-500 focus:outline-none"
              />
              {remain !== 0 && (
                <button
                  type="button"
                  onClick={() => update(i, { amount: split.amount + remain })}
                  className="text-xs text-gray-400 hover:text-gray-900"
                  title="남은 금액을 이 행에 채웁니다"
                >
                  남은 금액 채우기
                </button>
              )}
              <button
                type="button"
                onClick={() => onChange(splits.filter((_, x) => x !== i))}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() =>
          onChange([
            ...splits,
            // 첫 행은 영업자 본인 이름과 전액을 채워 둔다 — 대부분 본인 + 가족 형태다
            splits.length === 0
              ? { name: partnerName, amount: declared }
              : { name: '', amount: 0 },
          ])
        }
        className="mt-3 rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-600 transition hover:bg-gray-50"
      >
        {active ? '+ 명의 추가' : '분할 신고 설정'}
      </button>
    </div>
  )
}

/** 영업자 한 명의 공제 항목 편집 */
function DeductionEditor({
  partnerName,
  items,
  onChange,
}: {
  partnerName: string
  items: DeductionItem[]
  onChange: (items: DeductionItem[]) => void
}) {
  const total = sumDeductionItems(items)

  function update(index: number, patch: Partial<DeductionItem>) {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900">{partnerName}</span>
        <span className="text-sm tabular-nums text-gray-700">
          공제 합계 <span className="font-semibold">{won(total)}</span>원
        </span>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <select
                value={item.category}
                onChange={(e) => update(i, { category: e.target.value })}
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
              >
                {DEDUCTION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step={10}
                value={item.amount}
                onChange={(e) => update(i, { amount: Number(e.target.value) || 0 })}
                placeholder="금액"
                className="w-32 rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-gray-500 focus:outline-none"
              />
              <input
                type="text"
                value={item.note ?? ''}
                onChange={(e) => update(i, { note: e.target.value })}
                placeholder="비고 (예: 6월 2회)"
                className="min-w-[10rem] flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, x) => x !== i))}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => onChange([...items, { category: DEDUCTION_CATEGORIES[0], amount: 0 }])}
        className="mt-3 rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-600 transition hover:bg-gray-50"
      >
        + 공제 항목 추가
      </button>
    </div>
  )
}

function SourceCard({
  label,
  src,
}: {
  label: string
  src: { fileName: string; sheetName: string; venueCount: number } | null
}) {
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <dt className="text-xs text-gray-500">{label}</dt>
      {src ? (
        <dd className="mt-1 text-sm">
          <span className="font-medium text-gray-900">{src.sheetName}</span>
          <span className="ml-2 text-xs text-gray-400">사업장×식당 {src.venueCount}건</span>
          <div className="mt-0.5 truncate text-xs text-gray-400">{src.fileName}</div>
        </dd>
      ) : (
        <dd className="mt-1 text-sm text-red-600">찾지 못했습니다</dd>
      )}
    </div>
  )
}

/** 이번 달 기준 기본 기간 라벨 (예: 26년7월) */
function defaultPeriod(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  return `${yy}년${now.getMonth() + 1}월`
}
