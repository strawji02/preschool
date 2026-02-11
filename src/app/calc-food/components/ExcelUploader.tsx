'use client'

import { useCallback, useState } from 'react'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { parseExcelFile, InvoiceItem, ParseResult } from '@/lib/funnel/excel-parser'

interface ExcelUploaderProps {
  onDataParsed: (items: InvoiceItem[]) => void
  className?: string
}

export function ExcelUploader({ onDataParsed, className }: ExcelUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const processFile = useCallback(
    async (file: File) => {
      setIsProcessing(true)
      setSelectedFile(file)

      try {
        const result = await parseExcelFile(file)
        setParseResult(result)

        if (result.success) {
          onDataParsed(result.data)
        }
      } catch (error) {
        setParseResult({
          success: false,
          data: [],
          mapping: {
            itemName: null,
            spec: null,
            quantity: null,
            unitPrice: null,
            amount: null,
            taxType: null,
          },
          error: '파일 처리 중 오류가 발생했습니다',
        })
      } finally {
        setIsProcessing(false)
      }
    },
    [onDataParsed]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      const droppedFiles = Array.from(e.dataTransfer.files)
      const excelFile = droppedFiles.find(
        file =>
          file.name.endsWith('.xlsx') ||
          file.name.endsWith('.xls') ||
          file.type ===
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          file.type === 'application/vnd.ms-excel'
      )

      if (excelFile) {
        processFile(excelFile)
      }
    },
    [processFile]
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files
      if (!selectedFiles || selectedFiles.length === 0) return

      const file = selectedFiles[0]
      processFile(file)
    },
    [processFile]
  )

  const handleReset = useCallback(() => {
    setParseResult(null)
    setSelectedFile(null)
  }, [])

  // 파싱 결과가 있으면 결과 표시
  if (parseResult) {
    return (
      <div className={cn('w-full max-w-4xl', className)}>
        {parseResult.success ? (
          // 성공 케이스
          <div className="rounded-2xl border-2 border-green-200 bg-green-50 p-8">
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-green-100 p-3">
                  <CheckCircle2 className="text-green-600" size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-green-900">
                    파일 업로드 완료
                  </h3>
                  <p className="text-sm text-green-700">
                    {selectedFile?.name} ({parseResult.data.length}개 항목)
                  </p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="rounded-lg p-2 text-green-600 hover:bg-green-100"
              >
                <X size={20} />
              </button>
            </div>

            {/* 컬럼 매핑 정보 */}
            <div className="mb-4 rounded-lg bg-white p-4">
              <h4 className="mb-2 text-sm font-medium text-gray-700">인식된 컬럼</h4>
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                {parseResult.mapping.itemName !== null && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-500" />
                    <span className="text-gray-600">
                      품명: {parseResult.headers?.[parseResult.mapping.itemName]}
                    </span>
                  </div>
                )}
                {parseResult.mapping.spec !== null && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-500" />
                    <span className="text-gray-600">
                      규격: {parseResult.headers?.[parseResult.mapping.spec]}
                    </span>
                  </div>
                )}
                {parseResult.mapping.quantity !== null && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-500" />
                    <span className="text-gray-600">
                      수량: {parseResult.headers?.[parseResult.mapping.quantity]}
                    </span>
                  </div>
                )}
                {parseResult.mapping.unitPrice !== null && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-500" />
                    <span className="text-gray-600">
                      단가: {parseResult.headers?.[parseResult.mapping.unitPrice]}
                    </span>
                  </div>
                )}
                {parseResult.mapping.amount !== null && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-500" />
                    <span className="text-gray-600">
                      금액: {parseResult.headers?.[parseResult.mapping.amount]}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 데이터 미리보기 */}
            <div className="rounded-lg bg-white p-4">
              <h4 className="mb-3 text-sm font-medium text-gray-700">데이터 미리보기</h4>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        품명
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        규격
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                        수량
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                        단가
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">
                        금액
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parseResult.data.slice(0, 10).map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900">{item.itemName}</td>
                        <td className="px-3 py-2 text-gray-600">{item.spec}</td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {item.quantity.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {item.unitPrice.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {item.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parseResult.data.length > 10 && (
                <p className="mt-2 text-xs text-gray-500">
                  ...외 {parseResult.data.length - 10}개 항목
                </p>
              )}
            </div>
          </div>
        ) : (
          // 실패 케이스
          <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-8">
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-red-100 p-3">
                  <AlertCircle className="text-red-600" size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-red-900">파싱 실패</h3>
                  <p className="text-sm text-red-700">{parseResult.error}</p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="rounded-lg p-2 text-red-600 hover:bg-red-100"
              >
                <X size={20} />
              </button>
            </div>

            {parseResult.headers && parseResult.headers.length > 0 && (
              <div className="rounded-lg bg-white p-4">
                <h4 className="mb-2 text-sm font-medium text-gray-700">
                  발견된 헤더
                </h4>
                <div className="flex flex-wrap gap-2">
                  {parseResult.headers.map((header, index) => (
                    <span
                      key={index}
                      className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600"
                    >
                      {header || '(빈 컬럼)'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <button
                onClick={handleReset}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                다시 업로드
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // 업로드 대기 상태
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <label
        className={cn(
          'flex w-full max-w-2xl cursor-pointer flex-col items-center justify-center',
          'rounded-2xl border-2 border-dashed p-16',
          'transition-all duration-200',
          isProcessing && 'pointer-events-none opacity-50',
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
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={handleFileChange}
          disabled={isProcessing}
        />

        <div
          className={cn(
            'mb-6 rounded-full p-6',
            isDragOver ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
          )}
        >
          {isProcessing ? (
            <div className="animate-spin">
              <FileSpreadsheet size={48} />
            </div>
          ) : isDragOver ? (
            <FileSpreadsheet size={48} />
          ) : (
            <Upload size={48} />
          )}
        </div>

        <h3 className="mb-2 text-xl font-semibold text-gray-900">
          {isProcessing
            ? '파일 처리 중...'
            : isDragOver
              ? '파일을 놓아주세요'
              : '거래명세표 업로드'}
        </h3>

        <p className="mb-6 text-center text-gray-500">
          엑셀 파일을 드래그하거나 클릭하여 선택하세요
          <br />
          <span className="text-sm text-gray-400">
            품명, 규격, 수량, 단가, 금액 컬럼이 자동으로 인식됩니다
          </span>
        </p>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-600">
            <FileSpreadsheet size={16} />
            <span>XLSX, XLS</span>
          </div>
        </div>
      </label>
    </div>
  )
}
