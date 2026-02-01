'use client'

import dynamic from 'next/dynamic'
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useAuditSession } from './hooks/useAuditSession'

// SSR 비활성화 - PDF.js가 클라이언트에서만 동작
const UploadZone = dynamic(() => import('./components/UploadZone').then(mod => ({ default: mod.UploadZone })), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

const ProcessingView = dynamic(() => import('./components/ProcessingView').then(mod => ({ default: mod.ProcessingView })), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

const AnalysisDashboard = dynamic(() => import('./components/AnalysisDashboard').then(mod => ({ default: mod.AnalysisDashboard })), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

function LoadingFallback() {
  return (
    <div className="flex min-h-[calc(100vh-200px)] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
    </div>
  )
}

export default function CalcFoodPage() {
  const { state, processFile, setCurrentPage, updateItemMatch, reset } = useAuditSession()

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 헤더 */}
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={20} />
              <span>홈으로</span>
            </Link>

            <div className="h-6 w-px bg-gray-300" />

            <h1 className="text-lg font-semibold text-gray-900">식자재 단가 감사</h1>
          </div>

          {state.status !== 'empty' && (
            <button
              onClick={reset}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <RefreshCw size={16} />
              새로 시작
            </button>
          )}
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main>
        {state.status === 'empty' && <UploadZone onFileSelect={processFile} />}

        {state.status === 'processing' && (
          <ProcessingView
            fileName={state.fileName || ''}
            currentPage={state.processingPage}
            totalPages={state.totalPages}
          />
        )}

        {state.status === 'analysis' && (
          <AnalysisDashboard
            pages={state.pages}
            currentPage={state.currentPage}
            onPageSelect={setCurrentPage}
            items={state.items}
            stats={state.stats}
            fileName={state.fileName || '명세서'}
            onItemMatchUpdate={updateItemMatch}
          />
        )}

        {state.status === 'error' && (
          <div className="flex min-h-[calc(100vh-200px)] flex-col items-center justify-center p-8">
            <div className="rounded-lg bg-red-50 p-8 text-center">
              <h3 className="mb-2 text-lg font-semibold text-red-900">오류가 발생했습니다</h3>
              <p className="mb-4 text-red-600">{state.error}</p>
              <button
                onClick={reset}
                className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
              >
                다시 시도
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
