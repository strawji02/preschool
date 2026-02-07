'use client'

import { useState, useRef, useLayoutEffect } from 'react'
import { ZoomIn, ZoomOut, RotateCw, Move, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { PageImage } from '@/lib/pdf-processor'
import { PageThumbnails } from './PageThumbnails'

interface InvoiceViewerProps {
  pages: PageImage[]
  currentPage: number
  onPageSelect: (page: number) => void
  onReanalyze?: (pageNumber: number) => void
  isReanalyzing?: boolean
}

export function InvoiceViewer({ pages, currentPage, onPageSelect, onReanalyze, isReanalyzing }: InvoiceViewerProps) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const currentPageData = pages.find((p) => p.pageNumber === currentPage)

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3))
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5))
  const handleRotate = () => setRotation((r) => (r + 90) % 360)
  const handleReset = () => {
    setZoom(1)
    setRotation(0)
    setPosition({ x: 0, y: 0 })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => setIsDragging(false)

  // 페이지 변경 시 뷰 초기화 - 의도적인 상태 리셋 패턴
  const prevPageRef = useRef(currentPage)
  useLayoutEffect(() => {
    if (prevPageRef.current !== currentPage) {
      prevPageRef.current = currentPage
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 페이지 변경 시 뷰 상태 리셋은 의도적 패턴
      setZoom(1)
      setRotation(0)
      setPosition({ x: 0, y: 0 })
    }
  }, [currentPage])

  if (!currentPageData) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-100">
        <p className="text-gray-500">페이지를 선택하세요</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-gray-900">
      {/* 툴바 */}
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-2">
        <div className="text-sm text-white">
          {currentPage} / {pages.length} 페이지
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="rounded p-2 text-gray-300 hover:bg-gray-700 hover:text-white"
            title="축소"
          >
            <ZoomOut size={18} />
          </button>

          <span className="w-16 text-center text-sm text-gray-300">{Math.round(zoom * 100)}%</span>

          <button
            onClick={handleZoomIn}
            className="rounded p-2 text-gray-300 hover:bg-gray-700 hover:text-white"
            title="확대"
          >
            <ZoomIn size={18} />
          </button>

          <div className="mx-2 h-5 w-px bg-gray-600" />

          <button
            onClick={handleRotate}
            className="rounded p-2 text-gray-300 hover:bg-gray-700 hover:text-white"
            title="회전"
          >
            <RotateCw size={18} />
          </button>

          <button
            onClick={handleReset}
            className="rounded p-2 text-gray-300 hover:bg-gray-700 hover:text-white"
            title="초기화"
          >
            <Move size={18} />
          </button>

          {onReanalyze && (
            <>
              <div className="mx-2 h-5 w-px bg-gray-600" />
              <button
                onClick={() => onReanalyze(currentPage)}
                disabled={isReanalyzing}
                className={cn(
                  'rounded p-2 transition-colors',
                  isReanalyzing
                    ? 'cursor-not-allowed text-gray-500'
                    : 'text-blue-400 hover:bg-gray-700 hover:text-blue-300'
                )}
                title="페이지 재분석"
              >
                <RefreshCw size={18} className={cn(isReanalyzing && 'animate-spin')} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 이미지 뷰어 */}
      <div
        ref={containerRef}
        className={cn(
          'flex-1 overflow-hidden',
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          className="flex h-full w-full items-center justify-center p-4"
          style={{
            transform: `translate(${position.x}px, ${position.y}px)`,
          }}
        >
          <img
            src={currentPageData.dataUrl}
            alt={`Page ${currentPage}`}
            className="max-h-full shadow-2xl"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transition: isDragging ? 'none' : 'transform 0.2s',
            }}
            draggable={false}
          />
        </div>
      </div>

      {/* 썸네일 */}
      <PageThumbnails pages={pages} currentPage={currentPage} onPageSelect={onPageSelect} />
    </div>
  )
}
