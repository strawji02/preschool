-- 2026-05-04: 단일 품목 정밀 검수 (PrecisionView) — 검수자 조정값 저장
-- 매칭 검수자가 신세계 측 단위 중량/포장 단위/수량을 직접 조정하여
-- 동일 기준(1kg당)으로 단가 비교할 수 있도록 audit_items에 컬럼 추가.

ALTER TABLE audit_items
  ADD COLUMN IF NOT EXISTS adjusted_quantity NUMERIC,           -- 검수자가 조정한 신세계 발주 수량
  ADD COLUMN IF NOT EXISTS adjusted_unit_weight_g NUMERIC,      -- 포장 단위 중량 (g)
  ADD COLUMN IF NOT EXISTS adjusted_pack_unit TEXT,             -- BAG/BOX/EA/PAC/봉
  ADD COLUMN IF NOT EXISTS precision_reviewed_at TIMESTAMPTZ;   -- 정밀 검수 완료 시각

COMMENT ON COLUMN audit_items.adjusted_quantity IS
  '정밀 검수 시 검수자가 조정한 신세계 측 발주 수량. NULL이면 기본 매칭값 사용.';
COMMENT ON COLUMN audit_items.adjusted_unit_weight_g IS
  '정밀 검수 시 검수자가 조정한 포장 단위 중량 (g 단위). 환산 단가 계산에 사용.';
COMMENT ON COLUMN audit_items.adjusted_pack_unit IS
  '정밀 검수 시 검수자가 조정한 포장 단위 (BAG/BOX/EA/PAC/봉).';
COMMENT ON COLUMN audit_items.precision_reviewed_at IS
  '정밀 검수가 완료된 시각. NULL이면 빠른 검수만 거친 항목.';
