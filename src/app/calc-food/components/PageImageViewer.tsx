'use client'

/**
 * 거래명세표 페이지 원본 스캔 이미지 뷰어 (2026-04-26)
 *
 * 검수자가 OCR 결과를 검증할 때 원본 스캔 이미지를 확인하기 위함.
 * - signed URL을 비동기로 가져와 표시
 * - 줌 인/아웃 (마우스 휠 + 버튼)
 * - 드래그 팬 (확대 시)
 * - ESC / 배경 클릭으로 닫기
 */
import { useEffect, useRef, useState } from 'react'
import { X, ZoomIn, ZoomOut, Maximize2, Loader2, AlertCircle } from 'lucide-react'

interface PageImageViewerProps {
  sessionId: string
  pageNumber: number
  fileName?: string  // 표시용 (선택)
  // dataUrl이 있으면(새 OCR 직후) 즉시 사용, 없으면 API에서 signed URL fetch
  dataUrl?: string
  onClose: () => void
}

export function PageImageViewer({
  sessionId,
  pageNumber,
  fileName,
  dataUrl,
  onClose,
}: PageImageViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(dataUrl ?? null)
  const [loading, setLoading] = useState(!dataUrl)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (dataUrl) return
    let cancelled = false
    fetch(`/api/sessions/${sessionId}/page-image/${pageNumber}`)
      .then(async (r) => {
        const data = await r.json()
        if (cancelled) return
        if (data.success && data.url) {
          setImageUrl(data.url)
        } else {
          setError(data.error || '이미지를 찾을 수 없습니다')
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '네트워크 오류')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, pageNumber, dataUrl])

  // ESC 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.25))
      if (e.key === '-') setZoom((z) => Math.max(0.5, z - 0.25))
      if (e.key === '0') {
        setZoom(1)
        setPan({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.max(0.5, Math.min(4, z + (e.deltaY < 0 ? 0.15 : -0.15))))
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
  }
  const handleMouseUp = () => setIsDragging(false)

  const reset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 상단 툴바 */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-white/20 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm text-white">
          <span className="font-semibold">페이지 {pageNumber}</span>
          {fileName && (
            <span className="ml-2 text-xs text-white/70" title={fileName}>
              {fileName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            className="rounded p-1.5 text-white hover:bg-white/10"
            title="축소 (-)"
          >
            <ZoomOut size={18} />
          </button>
          <span className="min-w-[3rem] text-center text-sm text-white">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            className="rounded p-1.5 text-white hover:bg-white/10"
            title="확대 (+)"
          >
            <ZoomIn size={18} />
          </button>
          <button
            onClick={reset}
            className="rounded p-1.5 text-white hover:bg-white/10"
            title="원본 크기 (0)"
          >
            <Maximize2 size={18} />
          </button>
          <div className="ml-2 h-6 w-px bg-white/30" />
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-white hover:bg-white/10"
            title="닫기 (ESC)"
          >
            <X size={18} />
            <span className="hidden sm:inline">닫기</span>
          </button>
        </div>
      </div>

      {/* 이미지 영역 */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {loading && (
          <div className="flex items-center gap-2 text-white">
            <Loader2 size={20} className="animate-spin" />
            <span>이미지 불러오는 중…</span>
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center gap-2 text-amber-300">
            <AlertCircle size={32} />
            <p>{error}</p>
            <p className="text-xs text-white/60">
              세션 {sessionId.slice(0, 8)}… / 페이지 {pageNumber}
            </p>
          </div>
        )}
        {imageUrl && (
          <img
            src={imageUrl}
            alt={`페이지 ${pageNumber} 스캔 이미지`}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain shadow-2xl transition-transform"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center',
            }}
          />
        )}
      </div>

      {/* 하단 단축키 안내 */}
      <div className="shrink-0 border-t border-white/10 px-4 py-2 text-center text-[11px] text-white/60">
        스크롤로 확대/축소 · 드래그로 이동 · <kbd className="rounded bg-white/10 px-1">+</kbd>/<kbd className="rounded bg-white/10 px-1">-</kbd> 줌 ·
        <kbd className="ml-1 rounded bg-white/10 px-1">0</kbd> 원본 ·
        <kbd className="ml-1 rounded bg-white/10 px-1">ESC</kbd> 닫기
      </div>
    </div>
  )
}
