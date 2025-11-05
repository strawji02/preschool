export const COLORS = {
  primary: '#38549C',
  secondary: '#F3921E',
  accent: '#e67e22',
  accentHover: '#d35400',
  background: '#f4f6f9',
  text: {
    dark: '#2c3e50',
    medium: '#795548',
    light: '#555',
  },
} as const;

export const SERVICES = [
  {
    id: 'accounting',
    title: '회계 컨설팅',
    items: [
      '예/결산서 작성 및 1:1 계정 맞춤 관리',
      '에듀파인 입력 및 월별 장부 출력 점검',
      '원비 인상률 준수 및 수익자 부담금 예산 편성',
      '공사, 물품 등 계약 절차 관리 자문',
      '매월 방문 재정 현황 브리핑 및 주요 이슈 안내',
    ],
  },
  {
    id: 'labor',
    title: '노무 컨설팅',
    items: [
      '취업규칙 컨설팅',
      '근로계약서 필수 표기사항 및 부당 계약내용 검토',
      '교직원 보수 규정 관리 및 4대 보험 자문',
      '연차휴가 관리 및 퇴직금 적립/정산 자문',
    ],
  },
  {
    id: 'management',
    title: '관리 컨설팅',
    items: [
      '유치원 운영위원회 구성 및 운영 자문',
      '정보공시(본예산, 원비 등) 항목 및 시기 관리',
      '세외통장 활용',
      '교재/교구, 급식, 차량 등 계약서 검토',
    ],
  },
] as const;

export const COMPANY_INFO = {
  name: '퍼스트 컨설팅',
  representative: '김 중 영',
  address: '서울시 송파구 충민로 66, 가든파이브라이프 F8100 ~ F8101',
  call: '02-2157-8085',
  fax: '02-2157-8086',
  phone: '010-3033-3122',
  email: 'ilsinkim0616@gmail.com',
} as const;

export const NAVIGATION_ITEMS = [
  { label: '소개', href: '#intro' },
  { label: '핵심 서비스', href: '#services' },
  { label: '상담 신청', href: '#contact' },
] as const;
