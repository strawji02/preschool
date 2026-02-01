'use client'

import { useCallback, useState } from 'react'
import { Upload, FileText, Image } from 'lucide-react'
import { cn } from '@/lib/cn'

interface UploadZoneProps {
  onFileSelect: (files: File[]) => void
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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      const droppedFiles = Array.from(e.dataTransfer.files)
      const validFiles = droppedFiles.filter(
        file => file.type === 'application/pdf' || file.type.startsWith('image/')
      )

      if (validFiles.length > 0) {
        // PDF는 단일 파일만, 이미지는 여러 장 허용
        const hasPDF = validFiles.some(f => f.type === 'application/pdf')
        if (hasPDF) {
          // PDF가 있으면 첫 번째 PDF만 사용
          const pdfFile = validFiles.find(f => f.type === 'application/pdf')!
          onFileSelect([pdfFile])
        } else {
          // 이미지만 있으면 모두 사용
          onFileSelect(validFiles)
        }
      }
    },
    [onFileSelect]
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files
      if (!selectedFiles || selectedFiles.length === 0) return

      const filesArray = Array.from(selectedFiles)
      const hasPDF = filesArray.some(f => f.type === 'application/pdf')

      if (hasPDF) {
        // PDF가 있으면 첫 번째 PDF만 사용
        const pdfFile = filesArray.find(f => f.type === 'application/pdf')!
        onFileSelect([pdfFile])
      } else {
        // 이미지만 있으면 모두 사용
        onFileSelect(filesArray)
      }
    },
    [onFileSelect]
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
          accept="application/pdf,image/*"
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
          식자재 명세서 파일을 드래그하거나 클릭하여 선택하세요
          <br />
          <span className="text-sm text-gray-400">이미지는 여러 장 선택 가능</span>
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
        </div>
      </label>
    </div>
  )
}
