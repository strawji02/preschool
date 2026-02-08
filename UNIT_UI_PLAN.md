# 유닛(단위) UI 개선 구현 플랜 (수정)

## 핵심 요구사항

**거래명세서 행에 단위/수량 수정 UI 배치**
- OCR 인식 데이터가 틀릴 수 있음
- 사용자가 정규화된 단위로 수정
- 수정된 단위 기준으로 CJ/SSG 가격 환산 표시

## UI 구조

```
┌─────────────────────────────────────────────────────────────┐
│ 1행: [거래명세서]                                              │
│   품목: 깻잎 | 인식: "2kg/상" | 단가: 10,000원                   │
│   [드롭다운: g ▼] [입력: 500]  ← 사용자가 정규화 단위로 수정      │
├─────────────────────────────────────────────────────────────┤
│ 2행: [CJ] 깻잎 500g                                          │
│   → 500g 기준 환산가: 2,500원                                 │
├─────────────────────────────────────────────────────────────┤
│ 3행: [SSG] 깻잎 1kg                                          │
│   → 500g 기준 환산가: 2,750원                                 │
└─────────────────────────────────────────────────────────────┘
```

## 구현 태스크

### Task 1: 거래명세서 행에 단위 수정 UI 추가
**파일:** `MatchingRow.tsx`

```tsx
// 거래명세서 데이터 행에 추가
<div className="flex items-center gap-2">
  <select value={userUnit} onChange={...}>
    <option value="g">g</option>
    <option value="kg">kg</option>
    <option value="ml">ml</option>
    <option value="L">L</option>
    <option value="EA">개</option>
  </select>
  <input type="number" value={userQuantity} onChange={...} />
</div>
```

### Task 2: CJ/SSG 가격 환산 로직
**파일:** `MatchingRow.tsx` 또는 새 유틸 함수

```tsx
// 환산 가격 계산
function calcConvertedPrice(
  supplierPrice: number,      // CJ/SSG 원래 단가
  supplierUnit: string,       // CJ/SSG 단위 (예: "1kg")
  userUnit: string,           // 사용자 선택 단위 (예: "g")
  userQuantity: number        // 사용자 입력 수량 (예: 500)
): number {
  // 단위 환산 후 가격 계산
}
```

### Task 3: 상태 관리
**파일:** `MatchingView.tsx` 또는 상위 컴포넌트

- 각 품목별 `userUnit`, `userQuantity` 상태 추가
- 변경 시 CJ/SSG 환산가 재계산

### Task 4: UI 텍스트 변경
- "내 단가" → "현재 급식 단가"

---

## 정규화 단위 목록
- 무게: g, kg
- 부피: ml, L
- 개수: EA (개)

## 파일 목록
- `src/app/calc-food/components/MatchingStep/MatchingRow.tsx` - 메인 수정
- `src/app/calc-food/components/MatchingStep/UserSpecInput.tsx` - 참고/재활용
- `src/lib/unitConversion.ts` - 새로 생성 (단위 환산 유틸)
