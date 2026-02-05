-- Add PPU (Price Per Unit) columns to products table
-- standard_unit: standardized unit ('g', 'ml', 'ea')
-- ppu: price per standardized unit (always per 1g, 1ml, or 1ea)

ALTER TABLE products
ADD COLUMN standard_unit TEXT CHECK (standard_unit IN ('g', 'ml', 'ea')),
ADD COLUMN ppu DECIMAL(10, 4);

COMMENT ON COLUMN products.standard_unit IS 'Standardized unit: g (grams), ml (milliliters), ea (each)';
COMMENT ON COLUMN products.ppu IS 'Price per unit: price per 1g, 1ml, or 1ea';

-- Add index for PPU-based queries (e.g., finding cheapest items per unit)
CREATE INDEX idx_products_ppu ON products(standard_unit, ppu) WHERE ppu IS NOT NULL;
