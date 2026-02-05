# PPU 기반 가격 비교 기능 추가

## 현재 상태
- DB에 ppu, standard_unit 컬럼 있음
- 현재 비교는 단순 가격 비교

## 작업
1. src/types/audit.ts - SupplierMatch에 ppu, standard_unit 추가
2. src/lib/matching.ts - PPU 기반 비교 함수 추가  
3. MatchingRow.tsx에 유저 규격 입력 UI 추가
4. 마이그레이션 파일로 search_products_fuzzy RPC에 ppu 반환 추가

하나씩 해줘.
