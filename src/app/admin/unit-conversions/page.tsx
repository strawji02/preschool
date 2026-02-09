'use client'

import { useEffect, useState } from 'react'
import { UnitConversion } from '@/lib/unit-conversion-db'

export default function UnitConversionsPage() {
  const [conversions, setConversions] = useState<UnitConversion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  // 폼 상태
  const [formData, setFormData] = useState({
    category: '',
    from_unit: '',
    to_unit: '',
    conversion_factor: '',
    source: 'manual' as 'manual' | 'learned',
    confidence: '',
  })

  // 데이터 로드
  useEffect(() => {
    fetchConversions()
  }, [])

  const fetchConversions = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/unit-conversions')
      if (!response.ok) throw new Error('Failed to fetch conversions')
      const data = await response.json()
      setConversions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // 추가
  const handleAdd = async () => {
    try {
      const response = await fetch('/api/admin/unit-conversions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: formData.category || null,
          from_unit: formData.from_unit,
          to_unit: formData.to_unit,
          conversion_factor: parseFloat(formData.conversion_factor),
          source: formData.source,
          confidence: formData.confidence ? parseFloat(formData.confidence) : null,
        }),
      })

      if (!response.ok) throw new Error('Failed to create conversion')

      await fetchConversions()
      resetForm()
      setIsAdding(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create conversion')
    }
  }

  // 수정
  const handleUpdate = async (id: number) => {
    try {
      const response = await fetch(`/api/admin/unit-conversions?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: formData.category || null,
          from_unit: formData.from_unit,
          to_unit: formData.to_unit,
          conversion_factor: parseFloat(formData.conversion_factor),
          source: formData.source,
          confidence: formData.confidence ? parseFloat(formData.confidence) : null,
        }),
      })

      if (!response.ok) throw new Error('Failed to update conversion')

      await fetchConversions()
      resetForm()
      setEditingId(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update conversion')
    }
  }

  // 삭제
  const handleDelete = async (id: number) => {
    if (!confirm('정말 삭제하시겠습니까?')) return

    try {
      const response = await fetch(`/api/admin/unit-conversions?id=${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete conversion')

      await fetchConversions()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete conversion')
    }
  }

  // 편집 시작
  const startEdit = (conversion: UnitConversion) => {
    setEditingId(conversion.id)
    setFormData({
      category: conversion.category || '',
      from_unit: conversion.from_unit,
      to_unit: conversion.to_unit,
      conversion_factor: conversion.conversion_factor.toString(),
      source: conversion.source,
      confidence: conversion.confidence?.toString() || '',
    })
    setIsAdding(false)
  }

  // 폼 초기화
  const resetForm = () => {
    setFormData({
      category: '',
      from_unit: '',
      to_unit: '',
      conversion_factor: '',
      source: 'manual',
      confidence: '',
    })
  }

  if (loading) {
    return (
      <div className="container mx-auto p-8">
        <div className="text-center">로딩 중...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto p-8">
        <div className="text-center text-red-600">에러: {error}</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">단위 환산 관리</h1>

      {/* 추가 버튼 */}
      <div className="mb-4">
        <button
          onClick={() => {
            setIsAdding(true)
            setEditingId(null)
            resetForm()
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          새 환산 규칙 추가
        </button>
      </div>

      {/* 추가/수정 폼 */}
      {(isAdding || editingId !== null) && (
        <div className="mb-6 p-4 border rounded bg-gray-50">
          <h2 className="text-xl font-semibold mb-4">
            {isAdding ? '새 환산 규칙 추가' : '환산 규칙 수정'}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">카테고리 (선택)</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="예: 양파, 감자 (비워두면 범용)"
                className="w-full px-3 py-2 border rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">원본 단위 *</label>
              <input
                type="text"
                value={formData.from_unit}
                onChange={(e) => setFormData({ ...formData, from_unit: e.target.value })}
                placeholder="예: 망, 박스, 봉"
                className="w-full px-3 py-2 border rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">변환 단위 *</label>
              <input
                type="text"
                value={formData.to_unit}
                onChange={(e) => setFormData({ ...formData, to_unit: e.target.value })}
                placeholder="예: KG, G"
                className="w-full px-3 py-2 border rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">환산 계수 *</label>
              <input
                type="number"
                step="0.01"
                value={formData.conversion_factor}
                onChange={(e) => setFormData({ ...formData, conversion_factor: e.target.value })}
                placeholder="예: 15.0 (1망 = 15kg)"
                className="w-full px-3 py-2 border rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">출처</label>
              <select
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value as 'manual' | 'learned' })}
                className="w-full px-3 py-2 border rounded"
              >
                <option value="manual">수동 입력</option>
                <option value="learned">학습 기반</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">신뢰도 (선택, 0-1)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={formData.confidence}
                onChange={(e) => setFormData({ ...formData, confidence: e.target.value })}
                placeholder="예: 0.95"
                className="w-full px-3 py-2 border rounded"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                if (isAdding) {
                  handleAdd()
                } else if (editingId !== null) {
                  handleUpdate(editingId)
                }
              }}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              {isAdding ? '추가' : '수정'}
            </button>
            <button
              onClick={() => {
                setIsAdding(false)
                setEditingId(null)
                resetForm()
              }}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 환산 규칙 목록 */}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-4 py-2 border">ID</th>
              <th className="px-4 py-2 border">카테고리</th>
              <th className="px-4 py-2 border">원본 단위</th>
              <th className="px-4 py-2 border">변환 단위</th>
              <th className="px-4 py-2 border">환산 계수</th>
              <th className="px-4 py-2 border">출처</th>
              <th className="px-4 py-2 border">신뢰도</th>
              <th className="px-4 py-2 border">작업</th>
            </tr>
          </thead>
          <tbody>
            {conversions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-2 border text-center text-gray-500">
                  환산 규칙이 없습니다
                </td>
              </tr>
            ) : (
              conversions.map((conversion) => (
                <tr key={conversion.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 border text-center">{conversion.id}</td>
                  <td className="px-4 py-2 border">{conversion.category || '(범용)'}</td>
                  <td className="px-4 py-2 border">{conversion.from_unit}</td>
                  <td className="px-4 py-2 border">{conversion.to_unit}</td>
                  <td className="px-4 py-2 border text-right">{conversion.conversion_factor}</td>
                  <td className="px-4 py-2 border text-center">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        conversion.source === 'manual'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {conversion.source === 'manual' ? '수동' : '학습'}
                    </span>
                  </td>
                  <td className="px-4 py-2 border text-center">
                    {conversion.confidence !== null ? (
                      <span className="text-sm">{(conversion.confidence * 100).toFixed(1)}%</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-2 border text-center">
                    <button
                      onClick={() => startEdit(conversion)}
                      className="px-2 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 mr-2 text-sm"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(conversion.id)}
                      className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 설명 */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
        <h3 className="font-semibold mb-2">💡 사용 방법</h3>
        <ul className="list-disc list-inside text-sm space-y-1">
          <li>비정량 단위(망, 박스, 봉 등)를 정량 단위(KG, G 등)로 환산하는 규칙을 관리합니다.</li>
          <li>카테고리를 비워두면 모든 품목에 적용되는 범용 규칙이 됩니다.</li>
          <li>특정 카테고리 규칙이 범용 규칙보다 우선 적용됩니다.</li>
          <li>학습 기반 규칙은 실제 납품 데이터에서 자동으로 생성됩니다.</li>
        </ul>
      </div>
    </div>
  )
}
