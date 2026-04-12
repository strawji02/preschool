# Volume Adjustment UI Design Document

## Problem

거래명세표 (transaction statement) items have specific volumes (e.g., 2KG), but 신세계/CJ 단가표 (supplier price lists) may list items with different unit volumes (e.g., 1KG). To compare prices fairly, we need a volume multiplier to normalize quantities.

**Example:**
- 거래명세표: 전처리파인애플 스틱형 2KG at 15,000원
- 신세계: 후레쉬컷파인애플 1KG at 8,000원
- Fair comparison: 8,000원 x 2 = 16,000원 (adjusted price for 2KG)

Currently, the system compares raw unit prices without considering volume differences, leading to misleading savings calculations.

## Proposed UI

### 1. Auto-detection: Volume Difference Detection

When a match is established, the system parses volumes from both sides and calculates a suggested multiplier.

**Logic:**
1. Parse weight/volume from 거래명세표 규격 (invoice spec) using `spec-parser.ts` `parseSpec()`
2. Parse weight/volume from 신세계/CJ 규격 (`unit_normalized` field in DB)
3. If both have compatible units (both weight, both volume, etc.), calculate ratio
4. Display suggested multiplier: `invoice_weight / supplier_weight`

**Parsing sources:**
- Invoice side: `extracted_spec` field from `ComparisonItem` / `ExtractedItem.spec`
- Supplier side: `unit_normalized` field from `SupplierMatch` (already stored in DB products)

**Auto-detection rules:**
```
if (invoiceSpec.weight && supplierSpec.weight) {
  multiplier = invoiceSpec.weight / supplierSpec.weight
} else if (invoiceSpec.volume && supplierSpec.volume) {
  multiplier = invoiceSpec.volume / supplierSpec.volume
} else if (invoiceSpec.count && supplierSpec.count) {
  multiplier = invoiceSpec.count / supplierSpec.count
} else {
  multiplier = 1  // default, no auto-detection possible
}
```

### 2. Manual Override

Reviewer can manually input a quantity multiplier to override auto-detection.

**Behavior:**
- Input field next to each matched pair, pre-filled with auto-detected value (or 1)
- Editing recalculates the adjusted price in real-time
- Manual override persists for the session (saved in component state)
- Optional: save to DB for audit trail

### 3. Display Format

```
┌─────────────────────────────────────────────────────────────────┐
│ 거래명세표                                                       │
│   전처리파인애플 스틱형 2KG              단가: ₩15,000           │
│                                                                 │
│ 신세계                                                           │
│   후레쉬컷파인애플 1KG                   단가: ₩8,000            │
│                                                                 │
│ ┌──────────────────────────────────────────┐                    │
│ │ 수량 보정                                │                    │
│ │                                          │                    │
│ │ 자동감지: 2KG / 1KG = x2               │                    │
│ │ 보정 배수: [ 2 ]  <-- editable input    │                    │
│ │                                          │                    │
│ │ 보정 단가: ₩16,000  (₩8,000 x 2)       │                    │
│ │ 차이: +₩1,000 (+6.7%)                  │                    │
│ └──────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

**Color coding:**
- Green: supplier is cheaper (savings opportunity)
- Red: supplier is more expensive
- Gray: no volume data available, multiplier = 1

**Edge cases in display:**
- If auto-detection fails: show `수량 보정: [ 1 ] (자동감지 불가 - 수동 입력)` with yellow indicator
- If units are incompatible (weight vs volume): show warning icon with tooltip
- If multiplier is 1 (same spec): collapse the adjustment panel, show simple price comparison

### 4. Technical Approach

#### Volume Parsing

Reuse existing `spec-parser.ts` infrastructure:

```typescript
import { parseSpec, normalizeSpec } from '@/lib/spec-parser'

function calculateVolumeMultiplier(
  invoiceSpec: string,
  supplierSpec: string
): { multiplier: number; autoDetected: boolean; reason?: string } {
  const invoiceNorm = normalizeSpec(invoiceSpec)
  const supplierNorm = normalizeSpec(supplierSpec)

  if (!invoiceNorm || !supplierNorm) {
    return { multiplier: 1, autoDetected: false, reason: '규격 파싱 불가' }
  }

  if (invoiceNorm.category !== supplierNorm.category) {
    return { multiplier: 1, autoDetected: false, reason: '단위 불일치' }
  }

  const multiplier = invoiceNorm.value / supplierNorm.value
  return { multiplier: Math.round(multiplier * 100) / 100, autoDetected: true }
}
```

Supported unit patterns (from `spec-parser.ts`):
- Weight: KG, G, T, 톤, 근
- Volume: L, ML
- Count: 개, 입, EA, 수

#### State Management

```typescript
// Per-item adjustment state
interface VolumeAdjustment {
  itemId: string
  autoMultiplier: number      // auto-detected value
  manualMultiplier: number    // user override (defaults to autoMultiplier)
  isManualOverride: boolean   // true if user changed the value
  autoDetected: boolean       // true if auto-detection succeeded
  reason?: string             // explanation if auto-detection failed
}

// Store in parent component state (ComparisonTable or similar)
const [adjustments, setAdjustments] = useState<Record<string, VolumeAdjustment>>({})
```

#### Component Structure

```
ComparisonTable
  └── ComparisonRow (per item)
        ├── InvoiceItemCell
        ├── SupplierMatchCell (CJ)
        │     └── VolumeAdjuster  <-- new component
        ├── SupplierMatchCell (SSG)
        │     └── VolumeAdjuster  <-- new component
        └── SavingsCell (recalculated with multiplier)
```

**VolumeAdjuster component props:**
```typescript
interface VolumeAdjusterProps {
  invoiceSpec: string           // 거래명세표 규격
  supplierSpec: string          // 공급사 규격
  supplierUnitPrice: number     // 공급사 단가
  onChange: (adjustedPrice: number, multiplier: number) => void
}
```

#### Savings Recalculation

The existing `calculateComparisonSavings` function needs to accept an optional multiplier:

```typescript
function calculateAdjustedSavings(
  invoiceUnitPrice: number,
  quantity: number,
  supplierPrice: number,
  volumeMultiplier: number = 1,
  taxType?: '과세' | '면세'
): number {
  const adjustedSupplierPrice = supplierPrice * volumeMultiplier
  const normalizedPrice = taxType === '과세' ? adjustedSupplierPrice * 1.1 : adjustedSupplierPrice
  return Math.max(0, (invoiceUnitPrice - normalizedPrice) * quantity)
}
```

#### Database Considerations (Optional, Phase 2)

If we want to persist adjustments:
- Add `volume_multiplier` column to `audit_items` table (FLOAT, default 1.0)
- Add `multiplier_auto_detected` column (BOOLEAN)
- Save on user confirmation/review completion

For MVP, local state is sufficient.

## Implementation Plan

### Phase 1: Core Logic (No UI changes)
1. Add `calculateVolumeMultiplier()` to `src/lib/spec-parser.ts` or new `src/lib/volume-adjustment.ts`
2. Unit tests for various spec parsing scenarios
3. Verify with real data: 2KG vs 1KG, 500g vs 1kg, 10EA vs 5EA

### Phase 2: UI Component
1. Create `VolumeAdjuster` component in `src/components/`
2. Integrate into `ComparisonRow` / comparison table
3. Wire up state management for manual overrides
4. Update savings display to use adjusted prices

### Phase 3: Polish
1. Add visual indicators (auto-detected badge, manual override indicator)
2. Add tooltips explaining the calculation
3. Keyboard navigation for multiplier input
4. Optional: persist adjustments to DB

## Test Scenarios

| Invoice Spec | Supplier Spec | Expected Multiplier | Notes |
|---|---|---|---|
| 2KG | 1KG | 2.0 | Standard weight ratio |
| 500g | 1kg | 0.5 | Cross-unit weight |
| 1L | 500ml | 0.5 | Volume ratio |
| 10개 | 5개 | 2.0 | Count ratio |
| 2KG | 500ml | 1 (fail) | Incompatible units |
| (empty) | 1KG | 1 (fail) | Missing invoice spec |
| 알수없음 | 1KG | 1 (fail) | Unparseable spec |
