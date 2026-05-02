'use client'

/**
 * 거래명세표 페이지 원본 스캔 이미지 뷰어 (2026-04-26 v2: 사이드 패널 + 회전)
 *
 * 사용자 피드백 반영:
 *  - 모달 전체화면이 본 화면을 가려서 동시 수정 불가 → 우측 사이드 패널로 전환
 *  - 카메라/스캔 방향이 다양해서 회전 필요 → ↺ ↻ 90° 회전 + 수평/수직 플립 옵션
 *
 * UX:
 *  - 우측 고정 사이드 패널 (모바일/좁은 화면: 50%, 데스크탑: 480px ~ 절반)
 *  - 본 화면 우측 padding 자동 조정 (콘텐츠 가려지지 않음)
 *  - 줌 / 팬 / 회전 / 닫기 컨트롤
 */
import { useEffect, useRef, useState } from 'react'
import {
  X, ZoomIn, ZoomOut, Maximize2, Loader2, AlertCircle,
  RotateCcw, RotateCw, Camera,
} from 'lucide-react'

interface PageImageViewerProps {
  sessionId: string
  pageNumber: number
  fileName?: string  // 표시용 (선택)
  // dataUrl이 있으면(새 OCR 직후) 즉시 사용, 없으면 API에서 signed URL fetch
  dataUrl?: string
  onClose: () => void
  // 회전 적용 후 재OCR — 같은 page_number로 ImagePreview의 replacePage 호출 (2026-05-04)
  onReplacePage?: (pageNumber: number, file: File) => Promise<void> | void
}

// 사이드 패널 너비 — 사용자가 드래그로 조정 가능 (2026-04-26)
const DEFAULT_WIDTH = 640
const MIN_WIDTH = 320
const STORAGE_KEY = 'pageImageViewer.width'

function getMaxWidth() {
  if (typeof window === 'undefined') return 1200
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.85))
}

function getInitialWidth() {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const saved = localStorage.getItem(STORAGE_KEY)
  const num = saved ? Number(saved) : NaN
  if (Number.isFinite(num) && num >= MIN_WIDTH) {
    return Math.min(num, getMaxWidth())
  }
  return DEFAULT_WIDTH
}

export function PageImageViewer({
  sessionId,
  pageNumber,
  fileName,
  dataUrl,
  onClose,
  onReplacePage,
}: PageImageViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(dataUrl ?? null)
  const [loading, setLoading] = useState(!dataUrl)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)  // 0, 90, 180, 270
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [panelWidth, setPanelWidth] = useState<number>(() => getInitialWidth())
  const [isResizing, setIsResizing] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panelRef = useRef<HTMLDivElement | null>(null)

  // 본 화면이 패널에 가려지지 않도록 body padding-right 자동 조정 (2026-04-26: 리사이즈 반영)
  useEffect(() => {
    document.body.style.paddingRight = `${panelWidth}px`
    return () => {
      document.body.style.paddingRight = ''
    }
  }, [panelWidth])

  // 너비 변경 시 localStorage 저장 (다음 진입 시 같은 너비로 시작)
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEY, String(panelWidth))
  }, [panelWidth])

  // 윈도우 리사이즈 시 max 너비 초과하지 않도록 조정
  useEffect(() => {
    const onWinResize = () => {
      const max = getMaxWidth()
      setPanelWidth((w) => Math.min(max, w))
    }
    window.addEventListener('resize', onWinResize)
    return () => window.removeEventListener('resize', onWinResize)
  }, [])

  // 리사이즈 핸들 — 패널 좌측 가장자리 드래그
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'
  }

  useEffect(() => {
    if (!isResizing) return
    const handleMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX
      setPanelWidth(Math.min(getMaxWidth(), Math.max(MIN_WIDTH, newWidth)))
    }
    const handleUp = () => {
      setIsResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isResizing])

  // signed URL fetch — 페이지 변경 시 stale 이미지 방지를 위해 즉시 리셋 (2026-05-04)
  useEffect(() => {
    // 페이지가 바뀌면 이전 이미지/조작 상태를 즉시 초기화
    if (dataUrl) {
      setImageUrl(dataUrl)
    } else {
      setImageUrl(null)
      setLoading(true)
    }
    setError(null)
    setZoom(1)
    setRotation(0)
    setPan({ x: 0, y: 0 })

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

  // 키보드 단축키 (다른 입력 필드에 포커스 있을 땐 ESC만 처리)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (inEditable) return
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.25))
      else if (e.key === '-') setZoom((z) => Math.max(0.5, z - 0.25))
      else if (e.key === '0') {
        setZoom(1)
        setPan({ x: 0, y: 0 })
        setRotation(0)
      } else if (e.key === 'r' || e.key === 'R') {
        setRotation((r) => (r + 90) % 360)
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
    setRotation(0)
  }

  // 회전 적용 후 재OCR — Canvas로 회전된 이미지 생성 → File → onReplacePage (2026-05-04)
  const [applying, setApplying] = useState(false)
  const handleApplyRotationAndReanalyze = async () => {
    if (!imageUrl || !onReplacePage) return
    if (rotation === 0) {
      window.alert('회전이 적용되어 있지 않습니다. ↺ 또는 ↻ 버튼으로 먼저 회전하세요.')
      return
    }
    if (!window.confirm(
      `이 페이지를 ${rotation}° 회전된 이미지로 다시 OCR하시겠습니까?\n` +
      `기존 OCR 결과는 새 결과로 덮어씌워집니다.`
    )) return

    setApplying(true)
    try {
      // 1. 이미지를 fetch로 받아 Blob → ImageBitmap (CORS-safe)
      let bitmap: ImageBitmap
      if (imageUrl.startsWith('data:')) {
        // 새 OCR 직후 dataUrl인 경우 — 직접 변환
        const blob = await (await fetch(imageUrl)).blob()
        bitmap = await createImageBitmap(blob)
      } else {
        const response = await fetch(imageUrl)
        if (!response.ok) throw new Error(`이미지 다운로드 실패 (HTTP ${response.status})`)
        const blob = await response.blob()
        bitmap = await createImageBitmap(blob)
      }

      // 2. 회전된 캔버스 생성
      const radians = (rotation * Math.PI) / 180
      const isPerpendicular = rotation === 90 || rotation === 270
      const canvas = document.createElement('canvas')
      canvas.width = isPerpendicular ? bitmap.height : bitmap.width
      canvas.height = isPerpendicular ? bitmap.width : bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context 생성 실패')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(radians)
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)

      // 3. Blob → File 변환 (jpeg 0.92 quality)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Blob 생성 실패'))),
          'image/jpeg',
          0.92,
        )
      })
      const safeFileName = (fileName || `page-${pageNumber}.jpg`).replace(/\.\w+$/, '') + `_rotated_${rotation}.jpg`
      const file = new File([blob], safeFileName, { type: 'image/jpeg' })

      // 4. 부모로 위임 (replacePage 호출)
      await onReplacePage(pageNumber, file)
      onClose()
    } catch (e) {
      window.alert('회전 적용 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setApplying(false)
    }
  }

  const rotateLeft = () => setRotation((r) => (r + 270) % 360)  // -90
  const rotateRight = () => setRotation((r) => (r + 90) % 360)

  return (
    <div
      ref={panelRef}
      className="fixed right-0 top-0 bottom-0 z-[60] flex flex-col border-l border-gray-300 bg-gray-900 shadow-2xl"
      style={{ width: `${panelWidth}px` }}
    >
      {/* 리사이즈 핸들 — 좌측 가장자리 드래그 (2026-04-26) */}
      <div
        onMouseDown={startResize}
        className={`absolute left-0 top-0 bottom-0 z-10 w-1.5 cursor-ew-resize transition ${
          isResizing ? 'bg-blue-500/70' : 'bg-transparent hover:bg-blue-500/40'
        }`}
        title="드래그하여 패널 너비 조정"
      />
      {/* 상단 툴바 */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/20 bg-gray-900 px-3 py-2">
        <div className="min-w-0 text-sm text-white">
          <div className="font-semibold">페이지 {pageNumber}</div>
          {fileName && (
            <div className="truncate text-[10px] text-white/60" title={fileName}>
              {fileName}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-white hover:bg-white/10"
          title="닫기 (ESC)"
        >
          <X size={16} />
          <span>닫기</span>
        </button>
      </div>

      {/* 컨트롤 툴바 (회전 + 줌) */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/10 bg-gray-800 px-2 py-1.5">
        {/* 회전 */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={rotateLeft}
            className="rounded p-1 text-white hover:bg-white/10"
            title="좌로 90° 회전 (R)"
          >
            <RotateCcw size={16} />
          </button>
          <button
            onClick={rotateRight}
            className="rounded p-1 text-white hover:bg-white/10"
            title="우로 90° 회전"
          >
            <RotateCw size={16} />
          </button>
          <span className="ml-1 text-[10px] text-white/60">{rotation}°</span>
        </div>

        <div className="mx-1 h-5 w-px bg-white/20" />

        {/* 줌 */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            className="rounded p-1 text-white hover:bg-white/10"
            title="축소 (-)"
          >
            <ZoomOut size={16} />
          </button>
          <span className="min-w-[2.5rem] text-center text-[11px] text-white/80">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            className="rounded p-1 text-white hover:bg-white/10"
            title="확대 (+)"
          >
            <ZoomIn size={16} />
          </button>
        </div>

        <div className="mx-1 h-5 w-px bg-white/20" />

        {/* 리셋 */}
        <button
          onClick={reset}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white/80 hover:bg-white/10"
          title="원본 (0)"
        >
          <Maximize2 size={14} />
          원본
        </button>

        {/* 회전 적용 후 재OCR — rotation > 0이고 onReplacePage prop이 있을 때만 활성 (2026-05-04) */}
        {onReplacePage && (
          <>
            <div className="mx-1 h-5 w-px bg-white/20" />
            <button
              onClick={handleApplyRotationAndReanalyze}
              disabled={applying || rotation === 0 || !imageUrl}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition ${
                rotation === 0 || !imageUrl
                  ? 'cursor-not-allowed text-white/30'
                  : applying
                  ? 'cursor-wait bg-white/10 text-white/70'
                  : 'bg-orange-500 text-white hover:bg-orange-600'
              }`}
              title={
                rotation === 0
                  ? '먼저 ↺/↻로 회전한 후 사용하세요'
                  : `${rotation}° 회전 적용된 이미지로 OCR 재실행 (기존 결과 덮어쓰기)`
              }
            >
              {applying ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> 처리 중…
                </>
              ) : (
                <>
                  <Camera size={12} /> 회전 적용 후 재OCR
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* 이미지 영역 */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden bg-gray-900/95"
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
          <div className="flex flex-col items-center gap-2 px-4 text-center text-amber-300">
            <AlertCircle size={32} />
            <p className="text-sm">{error}</p>
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
            className="max-h-full max-w-full select-none object-contain shadow-lg transition-transform"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
              transformOrigin: 'center',
            }}
          />
        )}
      </div>

      {/* 하단 단축키 안내 */}
      <div className="shrink-0 border-t border-white/10 bg-gray-900 px-2 py-1.5 text-center text-[10px] text-white/50">
        휠: 확대/축소 · 드래그: 이동 ·
        <kbd className="mx-1 rounded bg-white/10 px-1">R</kbd>회전 ·
        <kbd className="mx-1 rounded bg-white/10 px-1">0</kbd>리셋 ·
        <kbd className="mx-1 rounded bg-white/10 px-1">ESC</kbd>닫기
      </div>
    </div>
  )
}
