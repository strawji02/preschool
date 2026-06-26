'use client'

/**
 * 페이지당 행이 많은 PDF가 Vercel function timeout(60s)에 걸려
 * 일부 페이지가 0 items로 들어왔을 때 검수 화면 상단에 띄우는 fallback 안내.
 *
 * 사용자가 취할 수 있는 조치 3가지를 모달 가이드로 제시.
 */
import { useState } from 'react'
import { AlertTriangle, FileSpreadsheet, FileText, X } from 'lucide-react'

type GuideKind = null | 'excel' | 'split'

interface Props {
  failedPages: number[]
  totalPages: number
}

export function BigPdfFallbackBanner({ failedPages, totalPages }: Props) {
  const [guide, setGuide] = useState<GuideKind>(null)
  if (failedPages.length === 0) return null

  return (
    <>
      <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <div className="flex-1">
            <p className="font-semibold text-red-800">
              {failedPages.length}개 페이지 처리 실패 — 페이지 {failedPages.join(', ')} (총 {totalPages}p 중)
            </p>
            <p className="mt-1 text-xs text-red-700">
              해당 페이지는 행이 많아 시스템 처리 한도(60초)를 넘었습니다. 아래 방법 중 하나로 해결할 수 있습니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setGuide('excel')}
                className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-green-700"
              >
                <FileSpreadsheet size={14} />
                엑셀로 변환 (권장 · 100% 성공)
              </button>
              <button
                type="button"
                onClick={() => setGuide('split')}
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
              >
                <FileText size={14} />
                PDF를 잘게 분할
              </button>
            </div>
          </div>
        </div>
      </div>

      {guide && <GuideModal kind={guide} onClose={() => setGuide(null)} />}
    </>
  )
}

function GuideModal({ kind, onClose }: { kind: Exclude<GuideKind, null>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-gray-500 hover:bg-gray-100"
          aria-label="닫기"
        >
          <X size={18} />
        </button>

        {kind === 'excel' ? <ExcelGuide /> : <SplitGuide />}
      </div>
    </div>
  )
}

function ExcelGuide() {
  return (
    <div className="p-6">
      <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900">
        <FileSpreadsheet size={20} className="text-green-600" />
        엑셀로 받기 — 가장 빠른 해결
      </h3>
      <p className="mb-4 text-sm text-gray-600">
        엑셀 파일은 OCR 없이 직접 파싱하므로 페이지 수·행 수에 관계없이 100% 처리됩니다.
      </p>

      <ol className="space-y-3 text-sm text-gray-800">
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700">
            1
          </span>
          <span>
            거래 공급사에 <strong>“거래내역서를 엑셀(xlsx) 파일로 보내주세요”</strong>로 요청
            <br />
            <span className="text-xs text-gray-500">대부분의 식자재 공급사는 ERP에서 엑셀 출력 지원</span>
          </span>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700">
            2
          </span>
          <span>
            받은 엑셀 파일을 그대로 이 화면에 업로드
          </span>
        </li>
      </ol>

      <div className="mt-5 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
        <p className="font-medium text-gray-700">PDF밖에 못 받는 경우 — 변환 도구</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <a className="text-blue-600 underline" href="https://smallpdf.com/pdf-to-excel" target="_blank" rel="noreferrer">
              smallpdf.com/pdf-to-excel
            </a>{' '}
            (무료, 매일 2회 한도)
          </li>
          <li>
            <a className="text-blue-600 underline" href="https://www.ilovepdf.com/pdf_to_excel" target="_blank" rel="noreferrer">
              ilovepdf.com/pdf_to_excel
            </a>{' '}
            (무료)
          </li>
          <li>Adobe Acrobat Pro: 파일 → 내보내기 형식 → 스프레드시트</li>
        </ul>
      </div>
    </div>
  )
}

function SplitGuide() {
  return (
    <div className="p-6">
      <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900">
        <FileText size={20} className="text-blue-600" />
        PDF를 잘게 분할 — 페이지당 행 수 줄이기
      </h3>
      <p className="mb-4 text-sm text-gray-600">
        한 페이지에 행이 많으면 60초 안에 처리하기 어렵습니다. 페이지를 잘게 나눠서 올리면 통과합니다.
        <br />
        <span className="text-xs text-amber-700">권장: 페이지당 15행 이하</span>
      </p>

      <div className="space-y-4 text-sm text-gray-800">
        <section>
          <p className="mb-1 font-semibold">🍎 macOS — Preview 사용</p>
          <ol className="ml-5 list-decimal space-y-1 text-xs text-gray-700">
            <li>PDF를 Preview로 열기</li>
            <li>왼쪽 사이드바에서 페이지 선택 (Shift/Cmd 클릭으로 여러 장)</li>
            <li>메뉴: 파일 → 인쇄 → PDF로 저장 (선택 페이지만)</li>
            <li>여러 PDF로 나눠 저장 후 각각 업로드</li>
          </ol>
        </section>

        <section>
          <p className="mb-1 font-semibold">🪟 Windows / 웹 도구</p>
          <ul className="ml-5 list-disc space-y-1 text-xs text-gray-700">
            <li>
              <a className="text-blue-600 underline" href="https://smallpdf.com/split-pdf" target="_blank" rel="noreferrer">
                smallpdf.com/split-pdf
              </a>{' '}
              — 페이지별 분할
            </li>
            <li>
              <a className="text-blue-600 underline" href="https://www.ilovepdf.com/split_pdf" target="_blank" rel="noreferrer">
                ilovepdf.com/split_pdf
              </a>
            </li>
            <li>PDFsam Basic (오프라인 무료)</li>
          </ul>
        </section>

        <section className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">⚠ 주의 — 분할 시 페이지 footer 보존</p>
          <p className="mt-1">
            거래명세표의 페이지별 합계가 footer에 인쇄되어 있는 경우, 페이지를 잘랐다면 잘린 페이지에는
            합계가 없을 수 있습니다. 검수 화면에서 직접 합계를 입력해야 할 수 있습니다.
          </p>
        </section>
      </div>
    </div>
  )
}
