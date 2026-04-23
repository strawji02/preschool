'use client'

import { useCallback, useState } from 'react'
import { Upload, FileText, Image, Table } from 'lucide-react'
import { cn } from '@/lib/cn'

interface UploadZoneProps {
  onFileSelect: (files: File[]) => void
}

// 엑셀 파일 타입 체크
function isExcel(file: File): boolean {
  return (
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel' ||
    file.name.endsWith('.xlsx') ||
    file.name.endsWith('.xls')
  )
}

export function UploadZone({ onFileSelect }: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  // 여러 파일 선택 시 정규화 규칙 (2026-04-23 업데이트: PDF 여러 개 + 이미지 혼합 지원)
  const normalizeSelection = useCallback(
    (input: File[]): File[] => {
      const valid = input.filter(
        (f) => f.type === 'application/pdf' || f.type.startsWith('image/') || isExcel(f),
      )
      if (valid.length === 0) return []

      // 엑셀은 단일 파일로만 처리 (엑셀과 다른 파일이 섞이면 엑셀 우선)
      const excelFile = valid.find((f) => isExcel(f))
      if (excelFile) return [excelFile]

      // PDF + 이미지 혼합 모두 허용 (여러 파일 업로드)
      return valid.sort((a, b) => a.name.localeCompare(b.name))
    },
    [],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = normalizeSelection(Array.from(e.dataTransfer.files))
      if (files.length > 0) onFileSelect(files)
    },
    [normalizeSelection, onFileSelect],
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files
      if (!selectedFiles || selectedFiles.length === 0) return
      const files = normalizeSelection(Array.from(selectedFiles))
      if (files.length > 0) onFileSelect(files)
    },
    [normalizeSelection, onFileSelect],
  )

  return (
    <div className="flex min-h-[calc(100vh-200px)] items-center justify-center p-8">
      <label
        className={cn(
          'flex w-full max-w-2xl cursor-pointer flex-col items-center justify-center',
          'rounded-2xl border-2 border-dashed p-16',
          'transition-all duration-200',
          isDragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept="application/pdf,image/*,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <div
          className={cn(
            'mb-6 rounded-full p-6',
            isDragOver ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
          )}
        >
          {isDragOver ? <FileText size={48} /> : <Upload size={48} />}
        </div>

        <h3 className="mb-2 text-xl font-semibold text-gray-900">
          {isDragOver ? '파일을 놓아주세요' : '명세서 업로드'}
        </h3>

        <p className="mb-6 text-center text-gray-500">
          1개월치 거래명세표 파일들을 드래그하거나 클릭하여 선택하세요
          <br />
          <span className="text-sm text-gray-400">
            PDF / 이미지 여러 장 혼합 가능 · Excel은 단일 파일
          </span>
        </p>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-600">
            <FileText size={16} />
            <span>PDF</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-600">
            <Image size={16} />
            <span>JPG, PNG</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-green-100 px-4 py-2 text-sm text-green-700">
            <Table size={16} />
            <span>Excel</span>
          </div>
        </div>
      </label>
    </div>
  )
}
