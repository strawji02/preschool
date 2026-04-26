'use client'

/**
 * 검수 워크플로우 단계 표시 (2026-04-26)
 *
 * 사용자 정의 단계:
 *  ① 거래명세표 검수 (검수자) — OCR 결과 검증, 행 수정/추가/삭제, 합계 일치 확인
 *  ② 매칭 확인 (검수자) — AI가 매칭한 결과를 행별로 확인 + 후보 변경
 *  ③ 비교 보고서 — 신세계 전환 시 절감액 보고서
 *
 * 시스템 매핑:
 *  status='image_preview' → ①
 *  status='analysis' && currentStep='matching' → ②
 *  status='analysis' && currentStep='report' → ③
 */
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

interface WorkflowStepperProps {
  status: 'empty' | 'excel_preview' | 'image_preview' | 'processing' | 'analysis' | 'error'
  currentStep: 'matching' | 'report'
}

interface StepItem {
  index: number
  label: string
  description: string
}

const STEPS: StepItem[] = [
  { index: 1, label: '거래명세표 검수', description: 'OCR 결과 확인·수정' },
  { index: 2, label: '매칭 확인', description: '신세계 매칭 검수' },
  { index: 3, label: '비교 보고서', description: '절감액 산출' },
]

function getActiveIndex(status: WorkflowStepperProps['status'], currentStep: WorkflowStepperProps['currentStep']): number {
  if (status === 'image_preview' || status === 'processing' || status === 'excel_preview') return 1
  if (status === 'analysis') return currentStep === 'report' ? 3 : 2
  return 1
}

export function WorkflowStepper({ status, currentStep }: WorkflowStepperProps) {
  const active = getActiveIndex(status, currentStep)
  // empty/error에서는 표시 안 함
  if (status === 'empty' || status === 'error') return null

  return (
    <div className="border-b bg-white">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-2 px-4 py-2">
        {STEPS.map((s, i) => {
          const isActive = s.index === active
          const isComplete = s.index < active
          const isPending = s.index > active
          return (
            <div key={s.index} className="flex flex-1 items-center gap-2 last:flex-initial">
              <div
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition',
                  isActive && 'bg-blue-50 ring-1 ring-blue-300',
                  isComplete && 'text-gray-500',
                  isPending && 'text-gray-400',
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  {isComplete ? (
                    <CheckCircle2 size={18} className="text-green-600" />
                  ) : isActive && status === 'processing' ? (
                    <Loader2 size={16} className="animate-spin text-blue-600" />
                  ) : isActive ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                      {s.index}
                    </span>
                  ) : (
                    <Circle size={16} className="text-gray-300" />
                  )}
                </span>
                <div className="flex flex-col leading-tight">
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      isActive && 'text-blue-900',
                      isComplete && 'text-gray-700',
                      isPending && 'text-gray-400',
                    )}
                  >
                    {s.label}
                  </span>
                  <span
                    className={cn(
                      'text-[10px]',
                      isActive ? 'text-blue-700' : 'text-gray-400',
                    )}
                  >
                    {s.description}
                  </span>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-px flex-1 transition',
                    isComplete ? 'bg-green-300' : 'bg-gray-200',
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
