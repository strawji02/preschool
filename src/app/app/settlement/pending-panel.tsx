'use client'

import { useState } from 'react'
// ⚠️ 클라이언트 전용 배럴을 쓴다 (CLAUDE.md 모듈 경계 규칙 2).
import { formatBizRegNo, isValidBizRegNo } from '@/features/settlement/client'

/**
 * 마감 전 미해결 항목을 **정산 화면 안에서 그 자리에서** 해결한다 (docs §14-3).
 *
 * 별도 마스터 화면으로 내보내지 않는 이유: 담당자는 "왜 마감이 안 되지?"에서 막히고,
 * 화면을 옮기면 업로드한 파일과 맥락을 잃는다. 저장하면 즉시 재분석한다.
 *
 * 모달이 아니라 **인라인 확장**으로 연다 — 여러 건을 연속 처리해야 하므로
 * 모달은 방해가 된다.
 */

/** API 응답 형태. 서버 타입을 그대로 쓰지 않고 화면 계약으로 따로 둔다. */
export interface UnmappedVenue {
  source: string
  businessCode: string
  businessName: string
  costTotal: number
}

export interface PendingBuyerRow {
  source: string
  businessCode: string
  businessName: string
  restaurantCount: number
  priceTotal: number
}

export interface PendingItemRow {
  source: string
  businessCode: string
  businessName: string
  restaurantCode: string
  restaurantName: string
  taxKind: 'taxable' | 'exempt'
  amount: number
}

export interface PartnerOption {
  partnerId: string
  partnerName: string
}

const won = (n: number) => n.toLocaleString('ko-KR')

const SOURCE_LABEL: Record<string, string> = { shinsegae: '신세계', cj: 'CJ' }

/** 계산서 발행 정보 — 홈택스 양식이 요구하는 항목 (docs §6-1) */
interface InvoiceForm {
  bizRegNo: string
  companyName: string
  ceoName: string
  address: string
  bizType: string
  bizItem: string
  email: string
  email2: string
}

/** 유치원은 16곳 모두 업태·종목이 `유치원`이었다 — 기본값으로 채워 입력을 줄인다 */
const EMPTY_INVOICE: InvoiceForm = {
  bizRegNo: '',
  companyName: '',
  ceoName: '',
  address: '',
  bizType: '유치원',
  bizItem: '유치원',
  email: '',
  email2: '',
}

export default function PendingPanel({
  unmapped,
  pendingBuyers,
  pendingItems,
  splitBlocked,
  partners,
  itemNameOptions,
  onResolved,
}: {
  unmapped: UnmappedVenue[]
  pendingBuyers: PendingBuyerRow[]
  pendingItems: PendingItemRow[]
  splitBlocked: boolean
  partners: PartnerOption[]
  itemNameOptions: string[]
  onResolved: () => void
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checks = [
    { label: '담당 영업자 배정', done: unmapped.length === 0, count: unmapped.length },
    { label: '유치원 사업자 정보', done: pendingBuyers.length === 0, count: pendingBuyers.length },
    { label: '식당 품목명', done: pendingItems.length === 0, count: pendingItems.length },
    { label: '분할 신고 합계 일치', done: !splitBlocked, count: splitBlocked ? 1 : 0 },
  ]
  const remaining = checks.filter((c) => !c.done).length

  async function save(payload: Record<string, unknown>, key: string) {
    setBusy(key)
    setError(null)
    try {
      const res = await fetch('/api/settlement/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => null)) as
        | { success: boolean; error?: string }
        | null
      if (!res.ok || !json?.success) {
        setError(json?.error ?? '저장에 실패했습니다.')
        return
      }
      setOpenKey(null)
      // 파일은 이미 브라우저에 있다 — 다시 올리지 않고 재분석한다
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  if (remaining === 0) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="font-semibold text-emerald-900">마감 전 확인 — 4개 항목 모두 통과</h2>
        <ul className="mt-3 grid gap-1 text-sm text-emerald-800 sm:grid-cols-2">
          {checks.map((c) => (
            <li key={c.label}>✅ {c.label}</li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border-2 border-red-200 bg-white p-6">
      <h2 className="font-semibold text-gray-900">
        마감 전 해결할 항목 — {remaining}가지 남았습니다
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        여기서 바로 고칠 수 있습니다. 저장하면 자동으로 다시 분석하니 파일을 다시 올리지
        않아도 됩니다.
      </p>

      <ul className="mt-4 grid gap-1 text-sm sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.label} className={c.done ? 'text-emerald-700' : 'text-red-700'}>
            {c.done ? '✅' : '❌'} {c.label}
            {!c.done && c.count > 0 && (
              <span className="ml-1 text-xs">({c.count}건)</span>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {/* ── 1. 미배정 사업장 ───────────────────────────── */}
      {unmapped.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-900">
            담당 영업자가 없는 사업장 {unmapped.length}건
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            신규 유치원이면 담당자를 지정하고, 본사 마케팅비처럼 정산 대상이 아니면
            제외로 처리하세요.
          </p>
          <ul className="mt-3 space-y-2">
            {unmapped.map((v) => {
              const key = `unmapped:${v.source}:${v.businessCode}`
              return (
                <li key={key} className="rounded-xl border border-gray-200 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium text-gray-900">{v.businessName}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {SOURCE_LABEL[v.source] ?? v.source} {v.businessCode} · 원가{' '}
                        {won(v.costTotal)}원
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenKey(openKey === key ? null : key)}
                        className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 transition hover:bg-gray-50"
                      >
                        담당 영업자 지정
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenKey(openKey === `${key}:exclude` ? null : `${key}:exclude`)
                        }
                        className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-500 transition hover:bg-gray-50"
                      >
                        정산 제외
                      </button>
                    </div>
                  </div>

                  {openKey === key && (
                    <AssignForm
                      venue={v}
                      partners={partners}
                      busy={busy === key}
                      onSubmit={(payload) => save({ ...payload, action: 'assign-venue' }, key)}
                    />
                  )}
                  {openKey === `${key}:exclude` && (
                    <ExcludeForm
                      venue={v}
                      busy={busy === `${key}:exclude`}
                      onSubmit={(reason) =>
                        save(
                          {
                            action: 'exclude-venue',
                            source: v.source,
                            businessCode: v.businessCode,
                            businessName: v.businessName,
                            reason,
                          },
                          `${key}:exclude`
                        )
                      }
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ── 2. 사업자 정보 미비 ────────────────────────── */}
      {pendingBuyers.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-900">
            계산서 정보가 없는 유치원 {pendingBuyers.length}곳
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            홈택스 계산서에 그대로 찍히는 값입니다. 사업자등록번호는 입력하면 즉시
            검증합니다.
          </p>
          <ul className="mt-3 space-y-2">
            {pendingBuyers.map((b) => {
              const key = `buyer:${b.source}:${b.businessCode}`
              return (
                <li key={key} className="rounded-xl border border-gray-200 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium text-gray-900">{b.businessName}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {SOURCE_LABEL[b.source] ?? b.source} {b.businessCode} · 식당{' '}
                        {b.restaurantCount}개 · 청구 {won(b.priceTotal)}원
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenKey(openKey === key ? null : key)}
                      className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 transition hover:bg-gray-50"
                    >
                      계산서 정보 입력
                    </button>
                  </div>
                  {openKey === key && (
                    <InvoiceFields
                      initialCompanyName={b.businessName}
                      busy={busy === key}
                      onSubmit={(invoice) =>
                        save(
                          {
                            // 계산서 열만 UPDATE한다 — upsert를 쓰면 담당 영업자가
                            // 지워질 수 있고, 그러면 그 사업장 금액이 조용히 빠진다.
                            action: 'update-invoice',
                            source: b.source,
                            businessCode: b.businessCode,
                            invoice,
                          },
                          key
                        )
                      }
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ── 3. 품목명 미지정 ───────────────────────────── */}
      {pendingItems.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-900">
            품목명이 없는 식당 {pendingItems.length}건
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            홈택스 계산서의 <code className="rounded bg-gray-100 px-1">품목1</code>에
            들어갑니다. <strong>같은 유치원·같은 품목이면 한 장으로 합쳐지므로</strong>{' '}
            기존 품목명을 그대로 쓰는 게 좋습니다 — 오타로 새 이름이 생기면 계산서가
            둘로 쪼개집니다.
          </p>
          <ul className="mt-3 space-y-2">
            {pendingItems.map((it) => {
              const key = `item:${it.source}:${it.businessCode}:${it.restaurantCode}:${it.taxKind}`
              return (
                <li key={key} className="rounded-xl border border-gray-200 px-4 py-3">
                  <ItemNameForm
                    item={it}
                    options={itemNameOptions}
                    busy={busy === key}
                    onSubmit={(invoiceItemName) =>
                      save(
                        {
                          action: 'set-item-name',
                          source: it.source,
                          businessCode: it.businessCode,
                          restaurantCode: it.restaurantCode,
                          restaurantName: it.restaurantName,
                          taxKind: it.taxKind,
                          invoiceItemName,
                        },
                        key
                      )
                    }
                  />
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {splitBlocked && (
        <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
          분할 신고 합계가 신고액과 맞지 않습니다. 아래{' '}
          <span className="font-medium">사업소득 지급명세서</span> 항목에서 금액을 맞춰
          주세요.
        </p>
      )}
    </section>
  )
}

function AssignForm({
  venue,
  partners,
  busy,
  onSubmit,
}: {
  venue: UnmappedVenue
  partners: PartnerOption[]
  busy: boolean
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const [partnerId, setPartnerId] = useState('')
  const [newName, setNewName] = useState('')
  const [withInvoice, setWithInvoice] = useState(false)
  const [invoice, setInvoice] = useState<InvoiceForm>({
    ...EMPTY_INVOICE,
    companyName: venue.businessName,
  })

  const creating = partnerId === '__new__'
  const bizOk = invoice.bizRegNo === '' || isValidBizRegNo(invoice.bizRegNo)

  return (
    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">담당 영업자</span>
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">선택하세요</option>
            {partners.map((p) => (
              <option key={p.partnerId} value={p.partnerId}>
                {p.partnerName}
              </option>
            ))}
            <option value="__new__">+ 새 영업자 등록</option>
          </select>
        </label>
        {creating && (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-500">
              새 영업자 이름 (유형은 일반으로 등록됩니다)
            </span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="이름"
              className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
            />
          </label>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={withInvoice}
          onChange={(e) => setWithInvoice(e.target.checked)}
        />
        계산서 정보도 지금 입력 (나중에 따로 입력해도 됩니다)
      </label>

      {withInvoice && <InvoiceInputs value={invoice} onChange={setInvoice} />}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={
            busy ||
            (creating ? newName.trim() === '' : partnerId === '') ||
            (withInvoice && !bizOk)
          }
          onClick={() =>
            onSubmit({
              source: venue.source,
              businessCode: venue.businessCode,
              businessName: venue.businessName,
              partnerId: creating ? null : partnerId,
              newPartnerName: creating ? newName.trim() : null,
              invoice: withInvoice ? invoice : null,
            })
          }
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        {withInvoice && !bizOk && (
          <span className="text-xs text-red-600">사업자등록번호를 확인해 주세요</span>
        )}
      </div>
    </div>
  )
}

function ExcludeForm({
  venue,
  busy,
  onSubmit,
}: {
  venue: UnmappedVenue
  busy: boolean
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-gray-500">
          제외 사유 (필수) — 왜 빼는지 남겨야 다음 담당자가 실수로 되살리지 않습니다
        </span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="예: 마케팅비 — 본사 자체 소비분"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
      </label>
      <p className="text-xs text-gray-400">
        {venue.businessName}는 정산·계산서에서 모두 빠집니다. 경고도 나오지 않습니다.
      </p>
      <button
        type="button"
        disabled={busy || reason.trim() === ''}
        onClick={() => onSubmit(reason.trim())}
        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? '저장 중…' : '정산 제외로 저장'}
      </button>
    </div>
  )
}

function InvoiceFields({
  initialCompanyName,
  busy,
  onSubmit,
}: {
  initialCompanyName: string
  busy: boolean
  onSubmit: (invoice: InvoiceForm) => void
}) {
  const [invoice, setInvoice] = useState<InvoiceForm>({
    ...EMPTY_INVOICE,
    companyName: initialCompanyName,
  })
  const bizOk = isValidBizRegNo(invoice.bizRegNo)
  const filled =
    bizOk &&
    invoice.companyName.trim() !== '' &&
    invoice.ceoName.trim() !== '' &&
    invoice.address.trim() !== '' &&
    invoice.bizType.trim() !== '' &&
    invoice.bizItem.trim() !== '' &&
    invoice.email.trim() !== ''

  return (
    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      <InvoiceInputs value={invoice} onChange={setInvoice} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !filled}
          onClick={() => onSubmit(invoice)}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        {invoice.bizRegNo !== '' && !bizOk && (
          <span className="text-xs text-red-600">사업자등록번호를 확인해 주세요</span>
        )}
      </div>
    </div>
  )
}

/** 계산서 정보 입력 필드 묶음 — 신규 등록과 정보 보강에서 같이 쓴다 */
function InvoiceInputs({
  value,
  onChange,
}: {
  value: InvoiceForm
  onChange: (v: InvoiceForm) => void
}) {
  const set = (patch: Partial<InvoiceForm>) => onChange({ ...value, ...patch })
  const bizOk = value.bizRegNo === '' || isValidBizRegNo(value.bizRegNo)

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-500">사업자등록번호</span>
        <input
          type="text"
          value={value.bizRegNo}
          onChange={(e) => set({ bizRegNo: e.target.value })}
          placeholder="1248011407 또는 124-80-11407"
          className={`w-full rounded border px-2 py-1 text-sm tabular-nums focus:outline-none ${
            bizOk
              ? 'border-gray-300 focus:border-gray-500'
              : 'border-red-400 bg-red-50 focus:border-red-500'
          }`}
        />
        {value.bizRegNo !== '' && (
          <span className={`mt-1 block text-xs ${bizOk ? 'text-gray-400' : 'text-red-600'}`}>
            {bizOk ? formatBizRegNo(value.bizRegNo) : '체크섬이 맞지 않습니다'}
          </span>
        )}
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-500">
          상호 (계산서에 찍히는 이름)
        </span>
        <input
          type="text"
          value={value.companyName}
          onChange={(e) => set({ companyName: e.target.value })}
          placeholder="해밀유치원"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-500">대표자</span>
        <input
          type="text"
          value={value.ceoName}
          onChange={(e) => set({ ceoName: e.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-500">이메일</span>
        <input
          type="email"
          value={value.email}
          onChange={(e) => set({ email: e.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-xs text-gray-500">사업장주소</span>
        <input
          type="text"
          value={value.address}
          onChange={(e) => set({ address: e.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-500">업태</span>
        <input
          type="text"
          value={value.bizType}
          onChange={(e) => set({ bizType: e.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-500">종목</span>
        <input
          type="text"
          value={value.bizItem}
          onChange={(e) => set({ bizItem: e.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
      </label>
    </div>
  )
}

function ItemNameForm({
  item,
  options,
  busy,
  onSubmit,
}: {
  item: PendingItemRow
  options: string[]
  busy: boolean
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState('')
  const trimmed = name.trim()
  /** 앞뒤 공백만 다른 기존 이름이 있으면 알려준다 — 계산서가 쪼개지는 원인이다 */
  const nearMiss =
    trimmed !== '' &&
    !options.includes(name) &&
    options.find((o) => o === trimmed || o.replace(/\s/g, '') === name.replace(/\s/g, ''))

  return (
    <div className="space-y-2">
      <div className="text-sm">
        <span className="font-medium text-gray-900">{item.restaurantName}</span>
        <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
          {item.taxKind === 'taxable' ? '과세' : '면세'}
        </span>
        <span className="ml-2 text-xs text-gray-400">
          {item.businessName} · {won(item.amount)}원
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          list={`item-names-${item.taxKind}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="품목명 (예: 급식재료)"
          className="w-56 rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
        <datalist id={`item-names-${item.taxKind}`}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <button
          type="button"
          disabled={busy || trimmed === ''}
          onClick={() => onSubmit(trimmed)}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        {nearMiss && (
          <span className="text-xs text-amber-700">
            기존 <span className="font-medium">{nearMiss}</span>와 다릅니다 — 계산서가 2장으로
            쪼개집니다
          </span>
        )}
      </div>
    </div>
  )
}
