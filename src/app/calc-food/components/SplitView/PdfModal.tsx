'use client'

import { useState, useRef, useEffect } from 'react'
import { X, ZoomIn, ZoomOut, RotateCw, Move } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { PageImage } from '@/lib/pdf-processor'

interface PdfModalProps {
  isOpen: boolean
  onClose: () => void
  pages: PageImage[]
  currentPage: number
  onPageChange: (page: number) => void
  highlightRowIndex?: number // 하이라이트할 행 인덱스 (선택적)
}

export function PdfModal({
  isOpen,
  onClose,
  pages,
  currentPage,
  onPageChange,
  highlightRowIndex,
}: PdfModalProps) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const currentPageData = pages.find((p) => p.pageNumber === currentPage)

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // 모달 열릴 때 뷰 초기화
  useEffect(() => {
    if (isOpen) {
      setZoom(1)
      setRotation(0)
      setPosition({ x: 0, y: 0 })
    }
  }, [isOpen, currentPage])

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3))
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5))
  const handleRotate = () => setRotation((r) => (r + 90) % 360)
  const handleReset = () => {
    setZoom(1)
    setRotation(0)
    setPosition({ x: 0, y: 0 })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
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

  // 마우스 휠로 줌
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom((z) => Math.max(0.5, Math.min(3, z + delta)))
  }

  // 배경 클릭으로 닫기
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={handleBackdropClick}
    >
      <div className="flex h-[85vh] w-[85vw] flex-col overflow-hidden rounded-xl bg-gray-900 shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-3">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-semibold text-white">📄 거래명세서 원본</h3>
            <span className="text-sm text-gray-400">
              {currentPage} / {pages.length} 페이지
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* 줌 컨트롤 */}
            <button
              onClick={handleZoomOut}
              className="rounded p-2 text-gray-300 hover:bg-gray-700 hover:text-white"
              title="축소"
            >
              <ZoomOut size={18} />
            </button>

            <span className="w-14 text-center text-sm text-gray-300">
              {Math.round(zoom * 100)}%
            </span>

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

            <div className="mx-2 h-5 w-px bg-gray-600" />

            {/* 닫기 버튼 */}
            <button
              onClick={onClose}
              className="rounded p-2 text-gray-300 hover:bg-red-600 hover:text-white"
              title="닫기 (ESC)"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 이미지 뷰어 */}
        <div
          ref={containerRef}
          className={cn(
            'flex-1 overflow-hidden bg-gray-800',
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          )}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {currentPageData ? (
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
          ) : (
            <div className="flex h-full items-center justify-center text-gray-500">
              페이지를 불러올 수 없습니다
            </div>
          )}
        </div>

        {/* 페이지 썸네일 (페이지가 2개 이상일 때만) */}
        {pages.length > 1 && (
          <div className="flex gap-2 overflow-x-auto border-t border-gray-700 bg-gray-800 p-3">
            {pages.map((page) => (
              <button
                key={page.pageNumber}
                onClick={() => onPageChange(page.pageNumber)}
                className={cn(
                  'relative h-16 w-12 flex-shrink-0 overflow-hidden rounded border-2 transition-all',
                  page.pageNumber === currentPage
                    ? 'border-blue-500 ring-2 ring-blue-400'
                    : 'border-gray-600 hover:border-gray-500'
                )}
              >
                <img
                  src={page.dataUrl}
                  alt={`Thumbnail ${page.pageNumber}`}
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-center text-xs text-white">
                  {page.pageNumber}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
