# PPU (Price Per Unit) Implementation

## Overview
Implemented standardized price per unit calculation for product comparison across different suppliers (CJ and Shinsegae).

## Database Schema Changes

### Migration: 015_add_ppu_columns.sql
```sql
ALTER TABLE products
ADD COLUMN standard_unit TEXT CHECK (standard_unit IN ('g', 'ml', 'ea')),
ADD COLUMN ppu DECIMAL(10, 4);
```

**New Columns:**
- `standard_unit`: Standardized unit ('g', 'ml', 'ea')
  - `g` - Grams (for weight-based products)
  - `ml` - Milliliters (for volume-based products)
  - `ea` - Each (for count-based products or parse failures)
- `ppu`: Price per standardized unit (DECIMAL(10, 4))
  - Always per 1g, 1ml, or 1ea
  - NULL if calculation fails

**Index:**
- `idx_products_ppu`: Composite index on (standard_unit, ppu) for efficient price comparison queries

## PPU Calculation Logic

### Unit Standardization
All units are converted to base units:
- Weight: kg → g (multiply by 1000)
- Volume: L → ml (multiply by 1000)
- Count: ea, 개, 입, 마리 → ea

### CJ Products
**Priority Logic:**
1. **Use existing "단가(g당)" column** if value > 0 (most accurate)
   - Column comes pre-calculated from supplier
   - Directly use as PPU with standard_unit='g'
2. **Calculate from parsed spec** if "단가(g당)" is 0 or null
   - Parse spec from product name
   - Apply unit standardization
   - Calculate: price / standardized_capacity

**Function:** `calculateCJPPU(price, pricePerGram, specQuantity, specUnit)`

### Shinsegae Products
**Always Calculate from Spec:**
- No pre-calculated g당 column available
- Parse spec from dedicated "규격" column
- Apply unit standardization
- Calculate: price / standardized_capacity

**Function:** `calculateShinsegaePPU(price, specQuantity, specUnit)`

## Files Modified

### New Files
1. **scripts/lib/ppu-calculator.ts** - Core PPU calculation logic
2. **scripts/lib/ppu-calculator.test.ts** - Test suite (all tests passing)
3. **supabase/migrations/015_add_ppu_columns.sql** - Schema migration

### Modified Files
1. **scripts/seed.ts**
   - Updated `ProductInsert` interface with standard_unit and ppu
   - Modified `seedCJ()` to calculate PPU with priority logic
   - Modified `seedShinsegae()` to calculate PPU from spec
   - Added PPU statistics logging

## Usage Examples

### Querying Cheapest Products per Unit
```sql
-- Find cheapest milk products per ml
SELECT product_name, standard_price, ppu, standard_unit
FROM products
WHERE standard_unit = 'ml'
  AND category LIKE '%유제품%'
ORDER BY ppu ASC
LIMIT 10;

-- Find cheapest weight-based products per gram
SELECT product_name, standard_price, ppu, standard_unit
FROM products
WHERE standard_unit = 'g'
  AND ppu IS NOT NULL
ORDER BY ppu ASC
LIMIT 10;
```

### Comparing Same Product Across Suppliers
```sql
-- Compare price per unit for similar products
SELECT
  supplier,
  product_name,
  standard_price,
  ppu,
  standard_unit
FROM products
WHERE product_name_normalized LIKE '%당면%'
  AND standard_unit = 'g'
ORDER BY ppu ASC;
```

## Testing

Run the test suite:
```bash
npx tsx scripts/lib/ppu-calculator.test.ts
```

All 7 tests pass:
1. ✅ CJ with valid 단가(g당) column
2. ✅ CJ with zero 단가(g당) - calculate from spec
3. ✅ CJ with kg spec (convert to g)
4. ✅ Shinsegae with L spec (convert to ml)
5. ✅ Shinsegae with ml spec
6. ✅ Parse failure - fallback to ea
7. ✅ EA unit (count items)

## Seeding Process

Run the updated seed script:
```bash
npx tsx scripts/seed.ts
```

The seed script now:
1. Parses product specs (unchanged)
2. Calculates PPU based on supplier logic (NEW)
3. Logs PPU statistics by unit type (NEW)

Expected output:
```
📊 규격 파싱: 성공 XXX개, 실패 YYY개
💰 PPU 단위별: g XXX개, ml YYY개, ea ZZZ개
```

## Edge Cases Handled

1. **Parse Failures**: Defaults to ea with price as PPU
2. **Zero/Null Values**: Returns null PPU
3. **Unknown Units**: Treated as ea
4. **CJ Missing g당**: Falls back to spec calculation
5. **Invalid Spec**: Graceful fallback to ea

## Performance Considerations

- Added index on (standard_unit, ppu) for efficient filtering
- PPU calculated once during seeding
- No runtime calculation overhead
- Supports fast price comparison queries

## Next Steps

After running migration and re-seeding:
1. Update product search to include PPU-based sorting
2. Add PPU display in product comparison UI
3. Create price trend analysis based on PPU
4. Implement "best value" recommendations using PPU
