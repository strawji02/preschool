'use client'

/**
 * 저장된 세션 목록 (2026-04-26)
 *
 * 메인 진입 화면에 표시. 사용자가 이전에 업로드한 거래명세표 작업을 이어가기 위한 진입점.
 * 매번 OCR을 새로 돌리지 않도록 DB에 저장된 세션을 그대로 불러옴.
 */
import { useEffect, useState } from 'react'
import { Folder, FileText, MoreVertical, Trash2, Edit3, Loader2 } from 'lucide-react'
import { formatNumber } from '@/lib/format'

interface SessionSummary {
  id: string
  name: string
  kindergarten_name: string | null
  total_pages: number
  total_files: number
  total_items: number
  matched_items: number
  current_step: 'image_preview' | 'matching' | 'report' | 'completed' | string
  created_at: string
  updated_at: string
}

interface SessionListProps {
  onSelect: (sessionId: string) => void
}

const STEP_LABEL: Record<string, { label: string; color: string }> = {
  image_preview: { label: '거래명세표 확인', color: 'bg-blue-100 text-blue-700' },
  matching: { label: '매칭 진행 중', color: 'bg-amber-100 text-amber-800' },
  report: { label: '리포트 단계', color: 'bg-green-100 text-green-700' },
  completed: { label: '완료', color: 'bg-gray-100 text-gray-700' },
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}일 전`
  return new Date(iso).toLocaleDateString('ko-KR')
}

export function SessionList({ onSelect }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const fetchSessions = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/sessions')
      const data = await res.json()
      if (data.success) setSessions(data.sessions ?? [])
    } catch (e) {
      console.warn('세션 목록 조회 실패:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSessions()
  }, [])

  const handleRename = async (s: SessionSummary) => {
    setOpenMenu(null)
    const newName = window.prompt('새 업체명을 입력하세요', s.kindergarten_name || s.name)
    if (!newName || newName === (s.kindergarten_name || s.name)) return
    try {
      await fetch(`/api/sessions/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kindergarten_name: newName }),
      })
      await fetchSessions()
    } catch (e) {
      console.warn('이름 변경 실패:', e)
    }
  }

  const handleDelete = async (s: SessionSummary) => {
    setOpenMenu(null)
    if (!window.confirm(`"${s.kindergarten_name || s.name}" 작업을 삭제하시겠습니까?\n(데이터는 보존되며 목록에서만 숨겨집니다)`)) return
    try {
      await fetch(`/api/sessions/${s.id}`, { method: 'DELETE' })
      await fetchSessions()
    } catch (e) {
      console.warn('삭제 실패:', e)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">저장된 작업 목록 불러오는 중…</span>
        </div>
      </div>
    )
  }

  if (sessions.length === 0) return null

  return (
    <div className="mx-auto max-w-4xl px-4 pb-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
        <Folder size={16} className="text-gray-500" />
        <span>이전 작업 이어가기 ({sessions.length})</span>
      </div>

      <div className="space-y-2">
        {sessions.map((s) => {
          const stepInfo = STEP_LABEL[s.current_step] || { label: s.current_step, color: 'bg-gray-100 text-gray-700' }
          const matchProgress =
            s.total_items > 0 ? Math.round((s.matched_items / s.total_items) * 100) : 0
          return (
            <div
              key={s.id}
              className="group relative flex items-center gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm transition hover:border-blue-300 hover:shadow"
            >
              <button
                onClick={() => onSelect(s.id)}
                className="flex flex-1 items-center gap-3 text-left"
              >
                <div className="rounded-full bg-blue-50 p-2">
                  <FileText size={20} className="text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-gray-900">
                      {s.kindergarten_name || s.name}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${stepInfo.color}`}>
                      {stepInfo.label}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                    <span>파일 {formatNumber(s.total_files)} · 페이지 {formatNumber(s.total_pages)}</span>
                    <span>품목 {formatNumber(s.total_items)}</span>
                    {s.total_items > 0 && (
                      <span>매칭 {formatNumber(s.matched_items)}/{formatNumber(s.total_items)} ({matchProgress}%)</span>
                    )}
                    <span className="text-gray-400">· {formatRelativeTime(s.updated_at)}</span>
                  </div>
                </div>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenMenu(openMenu === s.id ? null : s.id)
                }}
                className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="메뉴"
              >
                <MoreVertical size={18} />
              </button>

              {openMenu === s.id && (
                <div
                  className="absolute right-3 top-12 z-10 w-32 rounded-lg border bg-white py-1 shadow-lg"
                  onMouseLeave={() => setOpenMenu(null)}
                >
                  <button
                    onClick={() => handleRename(s)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Edit3 size={14} /> 이름 변경
                  </button>
                  <button
                    onClick={() => handleDelete(s)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={14} /> 삭제
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
