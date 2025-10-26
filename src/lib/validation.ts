import type { ContactFormData, ContactFormErrors } from '@/types/form';

export function validateContactForm(data: ContactFormData): ContactFormErrors {
  const errors: ContactFormErrors = {};

  // 유치원명 검증
  if (!data.kindergartenName.trim()) {
    errors.kindergartenName = '유치원명 또는 성함을 입력해주세요.';
  } else if (data.kindergartenName.trim().length < 2) {
    errors.kindergartenName = '최소 2자 이상 입력해주세요.';
  }

  // 연락처 검증
  const contactDigits = data.contact.replace(/[^0-9]/g, '');
  if (!data.contact.trim()) {
    errors.contact = '연락처를 입력해주세요.';
  } else if (!/^[0-9]+$/.test(contactDigits)) {
    errors.contact = '숫자만 입력해주세요.';
  } else if (contactDigits.length < 10 || contactDigits.length > 11) {
    errors.contact = '올바른 연락처를 입력해주세요. (10-11자리)';
  }

  // 개인정보 동의 검증
  if (!data.privacyAgreed) {
    errors.privacyAgreed = '개인정보 수집 및 이용에 동의해주세요.';
  }

  return errors;
}

export function isFormValid(errors: ContactFormErrors): boolean {
  return Object.keys(errors).length === 0;
}
