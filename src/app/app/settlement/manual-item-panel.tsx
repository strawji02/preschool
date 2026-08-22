'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { calculateChargeTotal, type ManualItemRecord } from '@/features/settlement/client'

export interface ManualItemVenue {
  source: 'shinsegae' | 'cj'
  businessCode: string
  businessName: string
  restaurantCode: string
  restaurantName: string
  partnerName: string | null
  cost?: { total: number }
  price?: { total: number }
  manualItemId?: string
}

interface FormState {
  kind: 'billable' | 'partner_service' | 'hq_service' | 'custom'
  venueKey: string
  transactionDate: string
  deliveryDate: string
  productName: string
  invoiceItemName: string
  specification: string
  unit: string
  quantity: string
  vendorName: string
  orderNumber: string
  purchaseTaxKind: 'taxable' | 'exempt'
  purchaseTotal: string
  chargeMarginPercent: string
  autoCharge: boolean
  chargeTaxKind: 'taxable' | 'exempt'
  chargeTotal: string
  burden: 'venue' | 'partner' | 'hq'
  partnerIncluded: boolean
  platformFeeApplies: boolean
  invoiceMode: 'merge' | 'separate'
  reason: string
  requestedBy: string
  duplicateOverrideReason: string
  exactTax: boolean
  purchaseSupply: string
  purchaseVat: string
  purchaseExempt: string
  chargeSupply: string
  chargeVat: string
  chargeExempt: string
}

const KIND_LABEL = {
  billable: '유치원 청구용 외부 사입',
  partner_service: '파트너 부담 서비스',
  hq_service: '본사 부담 서비스',
  custom: '기타 직접 지정',
} as const

const STATUS_LABEL = { draft: '승인대기', approved: '승인', cancelled: '취소' } as const

function initialForm(period: string): FormState {
  return {
    kind: 'billable',
    venueKey: '',
    transactionDate: `${period}-01`,
    deliveryDate: '',
    productName: '',
    invoiceItemName: '',
    specification: '',
    unit: '개',
    quantity: '1',
    vendorName: '',
    orderNumber: '',
    purchaseTaxKind: 'taxable',
    purchaseTotal: '',
    chargeMarginPercent: '',
    autoCharge: true,
    chargeTaxKind: 'taxable',
    chargeTotal: '',
    burden: 'venue',
    partnerIncluded: true,
    platformFeeApplies: true,
    invoiceMode: 'separate',
    reason: '',
    requestedBy: '',
    duplicateOverrideReason: '',
    exactTax: false,
    purchaseSupply: '',
    purchaseVat: '',
    purchaseExempt: '',
    chargeSupply: '',
    chargeVat: '',
    chargeExempt: '',
  }
}

const won = (n: number) => n.toLocaleString('ko-KR')

export default function ManualItemPanel({
  period,
  venues,
  items,
  locked,
  isAdmin,
  onChanged,
}: {
  period: string
  venues: ManualItemVenue[]
  items: ManualItemRecord[]
  locked: boolean
  isAdmin: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(() => initialForm(period))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const venueOptions = useMemo(() => {
    const map = new Map<
      string,
      { venue: ManualItemVenue; costTotal: number; priceTotal: number }
    >()
    for (const venue of venues) {
      // 기존 원천의 유치원별 실적에서 추천 마진율을 만든다. 외부 사입 자체를 다시
      // 기준에 넣으면 입력할 때마다 추천값이 움직이므로 합성 행은 제외한다.
      if (venue.manualItemId) continue
      const key = `${venue.source}:${venue.businessCode}`
      const current = map.get(key)
      if (current) {
        current.costTotal += venue.cost?.total ?? 0
        current.priceTotal += venue.price?.total ?? 0
      } else {
        map.set(key, {
          venue,
          costTotal: venue.cost?.total ?? 0,
          priceTotal: venue.price?.total ?? 0,
        })
      }
    }
    return [...map.entries()]
      .map(([key, value]) => {
        const suggestedMarginPercent = value.priceTotal > 0
          ? ((value.priceTotal - value.costTotal) / value.priceTotal) * 100
          : null
        return [key, { ...value.venue, suggestedMarginPercent }] as const
      })
      .sort((a, b) => a[1].businessName.localeCompare(b[1].businessName))
  }, [venues])

  const selectedVenue = venueOptions.find(([key]) => key === form.venueKey)?.[1] ?? null
  const approvedTotal = items
    .filter((i) => i.status === 'approved' && i.burden === 'venue')
    .reduce((sum, i) => sum + i.charge.total, 0)

  function change<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function changeKind(kind: FormState['kind']) {
    const burden = kind === 'partner_service' ? 'partner' : kind === 'hq_service' ? 'hq' : 'venue'
    setForm((prev) => ({
      ...prev,
      kind,
      burden,
      partnerIncluded: burden === 'venue',
      platformFeeApplies: burden === 'venue',
      chargeTotal: burden === 'venue' ? prev.chargeTotal : '',
      autoCharge: burden === 'venue',
    }))
  }

  function selectVenue(key: string) {
    const venue = venueOptions.find(([value]) => value === key)?.[1]
    setForm((prev) => ({
      ...prev,
      venueKey: key,
      requestedBy: prev.requestedBy || venue?.partnerName || '',
      chargeMarginPercent: venue?.suggestedMarginPercent == null
        ? prev.chargeMarginPercent
        : venue.suggestedMarginPercent.toFixed(2),
      chargeTotal:
        prev.burden === 'venue' && prev.autoCharge && venue?.suggestedMarginPercent != null
          ? String(calculateChargeTotal(Number(prev.purchaseTotal), venue.suggestedMarginPercent) || '')
          : prev.chargeTotal,
      exactTax: false,
    }))
  }

  function changePurchaseTotal(value: string) {
    setForm((prev) => ({
      ...prev,
      purchaseTotal: value,
      chargeTotal:
        prev.burden === 'venue' && prev.autoCharge
          ? String(calculateChargeTotal(Number(value), Number(prev.chargeMarginPercent)) || '')
          : prev.chargeTotal,
      exactTax: false,
    }))
  }

  function changeMarginPercent(value: string) {
    setForm((prev) => ({
      ...prev,
      chargeMarginPercent: value,
      chargeTotal:
        prev.burden === 'venue' && prev.autoCharge
          ? String(calculateChargeTotal(Number(prev.purchaseTotal), Number(value)) || '')
          : prev.chargeTotal,
      exactTax: false,
    }))
  }

  function toggleAutoCharge(enabled: boolean) {
    setForm((prev) => ({
      ...prev,
      autoCharge: enabled,
      chargeTotal:
        enabled && prev.burden === 'venue'
          ? String(
              calculateChargeTotal(
                Number(prev.purchaseTotal),
                Number(prev.chargeMarginPercent)
              ) || ''
            )
          : prev.chargeTotal,
      exactTax: enabled ? false : prev.exactTax,
    }))
  }

  function startEdit(item: ManualItemRecord) {
    setEditingId(item.id)
    setOpen(true)
    setForm({
      kind: item.kind,
      venueKey: `${item.source}:${item.businessCode}`,
      transactionDate: item.transactionDate,
      deliveryDate: item.deliveryDate ?? '',
      productName: item.productName,
      invoiceItemName: item.invoiceItemName,
      specification: item.specification,
      unit: item.unit,
      quantity: String(item.quantity),
      vendorName: item.vendorName,
      orderNumber: item.orderNumber ?? '',
      purchaseTaxKind: item.purchaseTaxKind,
      purchaseTotal: String(item.purchase.total),
      chargeMarginPercent: item.charge.total > 0
        ? (((item.charge.total - item.purchase.total) / item.charge.total) * 100).toFixed(2)
        : '',
      autoCharge: false,
      chargeTaxKind: item.chargeTaxKind,
      chargeTotal: String(item.charge.total),
      burden: item.burden,
      partnerIncluded: item.partnerIncluded,
      platformFeeApplies: item.platformFeeApplies,
      invoiceMode: item.invoiceMode,
      reason: item.reason,
      requestedBy: item.requestedBy,
      duplicateOverrideReason: item.duplicateOverrideReason ?? '',
      exactTax: true,
      purchaseSupply: String(item.purchase.taxableSupply),
      purchaseVat: String(item.purchase.vat),
      purchaseExempt: String(item.purchase.exempt),
      chargeSupply: String(item.charge.taxableSupply),
      chargeVat: String(item.charge.vat),
      chargeExempt: String(item.charge.exempt),
    })
  }

  function reset() {
    setEditingId(null)
    setForm(initialForm(period))
    setOpen(false)
    setError(null)
  }

  async function save() {
    if (!selectedVenue) {
      setError('유치원을 선택해 주세요.')
      return
    }
    setBusy('save')
    setError(null)
    try {
      const body = {
        ...(editingId ? { id: editingId, action: 'update' } : {}),
        period,
        kind: form.kind,
        source: selectedVenue.source,
        businessCode: selectedVenue.businessCode,
        businessName: selectedVenue.businessName,
        transactionDate: form.transactionDate,
        deliveryDate: form.deliveryDate || null,
        productName: form.productName,
        invoiceItemName: form.invoiceItemName || form.productName,
        specification: form.specification,
        unit: form.unit,
        quantity: Number(form.quantity),
        vendorName: form.vendorName,
        orderNumber: form.orderNumber || null,
        purchaseTaxKind: form.purchaseTaxKind,
        purchaseTotal: Number(form.purchaseTotal),
        chargeTaxKind: form.chargeTaxKind,
        chargeTotal: form.burden === 'venue' ? Number(form.chargeTotal) : 0,
        burden: form.burden,
        partnerIncluded: form.partnerIncluded,
        platformFeeApplies: form.platformFeeApplies,
        invoiceMode: form.invoiceMode,
        reason: form.reason,
        requestedBy: form.requestedBy,
        duplicateOverrideReason: form.duplicateOverrideReason || null,
        ...(form.exactTax
          ? {
              purchaseSupply: Number(form.purchaseSupply),
              purchaseVat: Number(form.purchaseVat),
              purchaseExempt: Number(form.purchaseExempt),
              chargeSupply: Number(form.chargeSupply),
              chargeVat: Number(form.chargeVat),
              chargeExempt: Number(form.chargeExempt),
            }
          : {}),
      }
      const res = await fetch('/api/settlement/manual-item', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null
      if (!res.ok) {
        setError(json?.error ?? '저장하지 못했습니다.')
        return
      }
      reset()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function action(id: string, actionName: 'approve' | 'cancel') {
    if (actionName === 'cancel' && !cancelReason.trim()) {
      setCancelTarget(id)
      return
    }
    setBusy(`${actionName}:${id}`)
    setError(null)
    try {
      const res = await fetch('/api/settlement/manual-item', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: actionName, cancelReason }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(json?.error ?? '처리하지 못했습니다.')
        return
      }
      setCancelTarget(null)
      setCancelReason('')
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function uploadEvidence(itemId: string, files: FileList | null) {
    if (!files?.length) return
    setBusy(`evidence:${itemId}`)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('itemId', itemId)
      for (const file of Array.from(files)) fd.append('files', file)
      const res = await fetch('/api/settlement/manual-item/evidence', { method: 'POST', body: fd })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(json?.error ?? '증빙을 저장하지 못했습니다.')
        return
      }
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">4. 외부 사입·임의 청구</h2>
          <p className="mt-1 text-xs text-gray-500">
            승인된 건만 유치원 청구·홈택스·파트너 정산에 반영됩니다. 승인 청구액{' '}
            <strong className="font-medium text-gray-700">{won(approvedTotal)}원</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={locked}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {open ? '입력 닫기' : '외부 사입 추가'}
        </button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {open && (
        <div className="mt-4 space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="유형">
              <select value={form.kind} onChange={(e) => changeKind(e.target.value as FormState['kind'])} className="input">
                {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="유치원">
              <select value={form.venueKey} onChange={(e) => selectVenue(e.target.value)} className="input">
                <option value="">선택</option>
                {venueOptions.map(([key, venue]) => <option key={key} value={key}>{venue.businessName}</option>)}
              </select>
            </Field>
            <Field label="부담 주체">
              <select value={form.burden} onChange={(e) => change('burden', e.target.value as FormState['burden'])} className="input" disabled={form.kind !== 'custom'}>
                <option value="venue">유치원</option><option value="partner">파트너</option><option value="hq">본사</option>
              </select>
            </Field>
            <Field label="거래일"><input type="date" value={form.transactionDate} onChange={(e) => change('transactionDate', e.target.value)} className="input" /></Field>
            <Field label="납품일"><input type="date" value={form.deliveryDate} onChange={(e) => change('deliveryDate', e.target.value)} className="input" /></Field>
            <Field label="품목명"><input value={form.productName} onChange={(e) => change('productName', e.target.value)} className="input" /></Field>
            <Field label="계산서 품목명"><input value={form.invoiceItemName} onChange={(e) => change('invoiceItemName', e.target.value)} placeholder="비우면 품목명" className="input" /></Field>
            <Field label="규격"><input value={form.specification} onChange={(e) => change('specification', e.target.value)} className="input" /></Field>
            <Field label="수량·단위"><div className="flex gap-2"><input type="number" step="any" value={form.quantity} onChange={(e) => change('quantity', e.target.value)} className="input" /><input value={form.unit} onChange={(e) => change('unit', e.target.value)} className="input" /></div></Field>
            <Field label="매입처"><input value={form.vendorName} onChange={(e) => change('vendorName', e.target.value)} className="input" /></Field>
            <Field label="주문번호"><input value={form.orderNumber} onChange={(e) => change('orderNumber', e.target.value)} className="input" /></Field>
            <Field label="매입 총액·세금"><div className="flex gap-2"><input type="number" value={form.purchaseTotal} onChange={(e) => changePurchaseTotal(e.target.value)} className="input" /><select value={form.purchaseTaxKind} onChange={(e) => change('purchaseTaxKind', e.target.value as FormState['purchaseTaxKind'])} className="input"><option value="taxable">과세</option><option value="exempt">면세</option></select></div></Field>
            <Field label="청구 마진율(%)">
              <div className="space-y-1">
                <input type="number" min="0" max="99.99" step="0.01" value={form.chargeMarginPercent} onChange={(e) => changeMarginPercent(e.target.value)} disabled={form.burden !== 'venue'} className="input" />
                <label className="flex items-center gap-1 font-normal text-gray-500"><input type="checkbox" checked={form.autoCharge} onChange={(e) => toggleAutoCharge(e.target.checked)} disabled={form.burden !== 'venue'} /> 매입가 변경 시 자동 계산</label>
              </div>
            </Field>
            <Field label="유치원 청구 총액·세금"><div className="flex gap-2"><input type="number" value={form.chargeTotal} onChange={(e) => setForm((prev) => ({ ...prev, chargeTotal: e.target.value, autoCharge: false, exactTax: false }))} disabled={form.burden !== 'venue'} className="input" /><select value={form.chargeTaxKind} onChange={(e) => change('chargeTaxKind', e.target.value as FormState['chargeTaxKind'])} disabled={form.burden !== 'venue'} className="input"><option value="taxable">과세</option><option value="exempt">면세</option></select></div></Field>
            <Field label="사유"><input value={form.reason} onChange={(e) => change('reason', e.target.value)} className="input" /></Field>
            <Field label="요청자"><input value={form.requestedBy} onChange={(e) => change('requestedBy', e.target.value)} className="input" /></Field>
          </div>
          {form.burden === 'venue' && (
            <div className="flex flex-wrap gap-4 text-sm text-gray-700">
              <label><input type="checkbox" checked={form.partnerIncluded} onChange={(e) => change('partnerIncluded', e.target.checked)} /> 파트너 정산 포함</label>
              <label><input type="checkbox" checked={form.platformFeeApplies} onChange={(e) => change('platformFeeApplies', e.target.checked)} /> 적립금 적용</label>
              <label><input type="checkbox" checked={form.invoiceMode === 'merge'} onChange={(e) => change('invoiceMode', e.target.checked ? 'merge' : 'separate')} /> 기존 계산서 품목에 합산</label>
            </div>
          )}
          <details className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-700">영수증 금액에 맞게 공급가·부가세 직접 수정</summary>
            <label className="mt-3 flex items-center gap-2">
              <input type="checkbox" checked={form.exactTax} onChange={(e) => change('exactTax', e.target.checked)} /> 직접 입력 사용
            </label>
            {form.exactTax && (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label="매입 공급가"><input type="number" value={form.purchaseSupply} onChange={(e) => change('purchaseSupply', e.target.value)} className="input" /></Field>
                <Field label="매입 부가세"><input type="number" value={form.purchaseVat} onChange={(e) => change('purchaseVat', e.target.value)} className="input" /></Field>
                <Field label="매입 면세"><input type="number" value={form.purchaseExempt} onChange={(e) => change('purchaseExempt', e.target.value)} className="input" /></Field>
                <Field label="청구 공급가"><input type="number" value={form.chargeSupply} onChange={(e) => change('chargeSupply', e.target.value)} className="input" /></Field>
                <Field label="청구 부가세"><input type="number" value={form.chargeVat} onChange={(e) => change('chargeVat', e.target.value)} className="input" /></Field>
                <Field label="청구 면세"><input type="number" value={form.chargeExempt} onChange={(e) => change('chargeExempt', e.target.value)} className="input" /></Field>
              </div>
            )}
          </details>
          <Field label="중복 저장 사유 (중복 경고가 있을 때만)"><input value={form.duplicateOverrideReason} onChange={(e) => change('duplicateOverrideReason', e.target.value)} className="input" /></Field>
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} disabled={busy !== null} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === 'save' ? '저장 중…' : editingId ? '수정 후 재승인 요청' : '승인 요청 저장'}</button>
            <button type="button" onClick={reset} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">취소</button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {items.length === 0 && <p className="text-sm text-gray-400">등록된 외부 사입이 없습니다.</p>}
        {items.map((item) => (
          <div key={item.id} className={`rounded-xl border px-4 py-3 ${item.status === 'approved' ? 'border-emerald-200 bg-emerald-50/40' : item.status === 'cancelled' ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-amber-200 bg-amber-50/40'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{item.businessName} · {item.productName}</p>
                <p className="mt-1 text-xs text-gray-500">{item.transactionDate} · 매입 {won(item.purchase.total)}원 · 청구 {won(item.charge.total)}원 · {STATUS_LABEL[item.status]} · 증빙 {item.evidence.length}개</p>
                {item.evidence.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-2 text-xs">
                    {item.evidence.map((evidence) => (
                      <a key={evidence.id} href={`/api/settlement/manual-item/evidence?id=${encodeURIComponent(evidence.id)}`} className="text-teal-700 underline">
                        {evidence.fileName}
                      </a>
                    ))}
                  </p>
                )}
              </div>
              {item.status !== 'cancelled' && !locked && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => startEdit(item)} className="rounded border border-gray-300 px-2 py-1 text-xs">수정</button>
                  {item.status === 'draft' && isAdmin && <button type="button" onClick={() => void action(item.id, 'approve')} disabled={busy !== null} className="rounded bg-emerald-700 px-2 py-1 text-xs text-white">승인</button>}
                  <label className="cursor-pointer rounded border border-gray-300 px-2 py-1 text-xs">{busy === `evidence:${item.id}` ? '첨부 중…' : '증빙 첨부'}<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx" className="hidden" onChange={(e) => void uploadEvidence(item.id, e.target.files)} /></label>
                  <button type="button" onClick={() => setCancelTarget(item.id)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700">취소</button>
                </div>
              )}
            </div>
            {cancelTarget === item.id && (
              <div className="mt-3 flex gap-2"><input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="취소 사유" className="input" /><button type="button" onClick={() => void action(item.id, 'cancel')} className="rounded bg-red-700 px-3 py-2 text-xs text-white">취소 확정</button></div>
            )}
          </div>
        ))}
      </div>

      <style jsx>{`.input{width:100%;border:1px solid #d1d5db;border-radius:.5rem;background:white;padding:.5rem .65rem;font-size:.875rem}.input:disabled{background:#f3f4f6;color:#9ca3af}`}</style>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-xs font-medium text-gray-600"><span className="mb-1 block">{label}</span>{children}</label>
}
