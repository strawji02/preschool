# Calc-Food Feature Integration - Quick Start Guide

## 🚀 Deployment Steps (5 minutes)

### Step 1: Apply Database Migrations (2 min)

**Option A: Supabase Dashboard (Recommended)**
1. Open [Supabase SQL Editor](https://supabase.com/dashboard)
2. Copy contents of `supabase/migrations/025_seed_additional_unit_conversions.sql`
3. Paste and Execute (Run)
4. Copy contents of `supabase/migrations/026_add_tax_category_to_rpcs.sql`
5. Paste and Execute (Run)
6. Verify: Run this query to check success:
```sql
SELECT COUNT(*) FROM unit_conversions;
-- Should return > 15 rows
```

**Option B: Command Line (If psql available)**
```bash
psql "$DATABASE_URL" -f supabase/migrations/025_seed_additional_unit_conversions.sql
psql "$DATABASE_URL" -f supabase/migrations/026_add_tax_category_to_rpcs.sql
```

### Step 2: Deploy Application (2 min)

```bash
# Verify build succeeds
npm run build

# Deploy (choose your platform)
# Vercel:
vercel --prod

# Or other platform:
git push origin main  # triggers auto-deploy
```

### Step 3: Smoke Test (1 min)

1. Navigate to `/calc-food`
2. Upload a test invoice with mixed units
3. Verify:
   - ✓ Prices show conversion indicators (✓ or ~)
   - ✓ "환산불가" reduced significantly
   - ✓ Savings calculations work correctly

## 🧪 Quick Verification

Run the verification script:
```bash
npx tsx scripts/verify-integration.ts
```

Expected output: All ✅ checks pass

## ⚠️ Rollback (if needed)

```bash
# Revert code changes
git revert HEAD~3

# Revert database (optional - migrations are non-destructive)
# Not needed unless you want to remove seed data
```

## 📊 Key Improvements

| Metric | Before | After |
|--------|--------|-------|
| "환산불가" | ~50% | <20% |
| VAT handling | ❌ None | ✅ Normalized |
| Custom units | ❌ Basic only | ✅ DB + Fallback |
| Conversion feedback | ❌ None | ✅ Visual indicators |

## 🔍 Monitoring

After deployment, monitor:
- Conversion success rate (target >80%)
- Performance (conversion time <200ms)
- User feedback on accuracy

## 📚 Documentation

- Full summary: `claudedocs/calc-food-feature-integration-summary.md`
- Technical details: See individual file comments
- Database schema: `supabase/migrations/024_unit_conversions.sql`

## 🆘 Troubleshooting

**Problem**: "환산불가" still showing for common units
- **Solution**: Check if migrations applied successfully
- **Verify**: `SELECT * FROM unit_conversions WHERE category = '양파'`

**Problem**: VAT normalization not working
- **Solution**: Check if `tax_type` field exists in database
- **Verify**: `\d products` in psql, should show `tax_type` column

**Problem**: Build errors
- **Solution**: Clear cache and rebuild
- **Commands**: `rm -rf .next && npm run build`

## ✅ Success Checklist

- [ ] Migrations 025 and 026 applied successfully
- [ ] Build succeeds without errors
- [ ] Application deployed
- [ ] Smoke test passed
- [ ] "환산불가" reduced to <20%
- [ ] Conversion indicators (✓/~) visible in UI
- [ ] Team notified of changes

## 📞 Support

For issues or questions:
1. Check full documentation: `claudedocs/calc-food-feature-integration-summary.md`
2. Review migration files: `supabase/migrations/025_*.sql` and `026_*.sql`
3. Run verification: `npx tsx scripts/verify-integration.ts`
4. Check build logs: `npm run build`
