import { NextRequest, NextResponse } from 'next/server'
import {
  getAllConversions,
  createConversion,
  updateConversion,
  deleteConversion,
  UnitConversion,
} from '@/lib/unit-conversion-db'

/**
 * GET /api/admin/unit-conversions
 * 모든 환산 규칙 조회
 */
export async function GET() {
  try {
    const conversions = await getAllConversions()
    return NextResponse.json(conversions)
  } catch (error) {
    console.error('GET /api/admin/unit-conversions error:', error)
    return NextResponse.json({ error: 'Failed to fetch conversions' }, { status: 500 })
  }
}

/**
 * POST /api/admin/unit-conversions
 * 새로운 환산 규칙 추가
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { category, from_unit, to_unit, conversion_factor, source, confidence } = body

    // 필수 필드 검증
    if (!from_unit || !to_unit || !conversion_factor) {
      return NextResponse.json(
        { error: 'Missing required fields: from_unit, to_unit, conversion_factor' },
        { status: 400 }
      )
    }

    const conversion = await createConversion({
      category: category || null,
      from_unit,
      to_unit,
      conversion_factor: parseFloat(conversion_factor),
      source: source || 'manual',
      confidence: confidence ? parseFloat(confidence) : null,
    })

    if (!conversion) {
      return NextResponse.json({ error: 'Failed to create conversion' }, { status: 500 })
    }

    return NextResponse.json(conversion, { status: 201 })
  } catch (error) {
    console.error('POST /api/admin/unit-conversions error:', error)
    return NextResponse.json({ error: 'Failed to create conversion' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/unit-conversions?id=<id>
 * 환산 규칙 수정
 */
export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    const body = await request.json()
    const updated = await updateConversion(parseInt(id), body)

    if (!updated) {
      return NextResponse.json({ error: 'Failed to update conversion' }, { status: 500 })
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error('PATCH /api/admin/unit-conversions error:', error)
    return NextResponse.json({ error: 'Failed to update conversion' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/unit-conversions?id=<id>
 * 환산 규칙 삭제
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    const success = await deleteConversion(parseInt(id))

    if (!success) {
      return NextResponse.json({ error: 'Failed to delete conversion' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/admin/unit-conversions error:', error)
    return NextResponse.json({ error: 'Failed to delete conversion' }, { status: 500 })
  }
}
