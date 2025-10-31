'use client';

import { useState, useEffect } from 'react';
import type { ContactFormData, ContactFormErrors } from '@/types/form';
import { validateContactForm, isFormValid } from '@/lib/validation';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { COMPANY_INFO } from '@/lib/constants';

export default function ContactForm() {
  const [formData, setFormData] = useState<ContactFormData>({
    kindergartenName: '',
    contact: '',
    privacyAgreed: false,
  });

  const [adSource, setAdSource] = useState<string>('direct');

  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);

  // 유입경로 추적
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const source =
      urlParams.get('ad') ||
      urlParams.get('source') ||
      urlParams.get('utm_source') ||
      'direct';
    setAdSource(source);
  }, []);

  // 전화번호 자동 포맷팅 함수 (지역번호 지원)
  const formatPhoneNumber = (value: string) => {
    // 숫자만 추출
    const numbers = value.replace(/[^\d]/g, '');

    // 최대 12자리까지 허용 (지역번호 4자리 + 8자리)
    const limitedNumbers = numbers.slice(0, 12);

    // 포맷팅 적용
    if (limitedNumbers.length <= 2) {
      return limitedNumbers;
    }

    // 02 지역번호 (서울)
    if (limitedNumbers.startsWith('02')) {
      if (limitedNumbers.length <= 2) {
        return limitedNumbers;
      } else if (limitedNumbers.length <= 5) {
        return `${limitedNumbers.slice(0, 2)}-${limitedNumbers.slice(2)}`;
      } else if (limitedNumbers.length <= 9) {
        return `${limitedNumbers.slice(0, 2)}-${limitedNumbers.slice(2, 5)}-${limitedNumbers.slice(5)}`;
      } else {
        return `${limitedNumbers.slice(0, 2)}-${limitedNumbers.slice(2, 6)}-${limitedNumbers.slice(6, 10)}`;
      }
    }

    // 010, 011, 016, 017, 018, 019 (휴대폰)
    if (limitedNumbers.startsWith('01')) {
      if (limitedNumbers.length <= 3) {
        return limitedNumbers;
      } else if (limitedNumbers.length <= 7) {
        return `${limitedNumbers.slice(0, 3)}-${limitedNumbers.slice(3)}`;
      } else {
        return `${limitedNumbers.slice(0, 3)}-${limitedNumbers.slice(3, 7)}-${limitedNumbers.slice(7, 11)}`;
      }
    }

    // 3자리 지역번호 (031, 032, 033, 041, 042, 043, 051, 052, 053, 054, 055, 061, 062, 063, 064 등)
    if (limitedNumbers.length >= 3 && /^0[3-6]/.test(limitedNumbers)) {
      if (limitedNumbers.length <= 3) {
        return limitedNumbers;
      } else if (limitedNumbers.length <= 6) {
        return `${limitedNumbers.slice(0, 3)}-${limitedNumbers.slice(3)}`;
      } else if (limitedNumbers.length <= 10) {
        return `${limitedNumbers.slice(0, 3)}-${limitedNumbers.slice(3, 6)}-${limitedNumbers.slice(6)}`;
      } else {
        return `${limitedNumbers.slice(0, 3)}-${limitedNumbers.slice(3, 7)}-${limitedNumbers.slice(7, 11)}`;
      }
    }

    // 4자리 지역번호 (1544, 1588 등 대표번호)
    if (limitedNumbers.startsWith('15') || limitedNumbers.startsWith('16') || limitedNumbers.startsWith('18')) {
      if (limitedNumbers.length <= 4) {
        return limitedNumbers;
      } else {
        return `${limitedNumbers.slice(0, 4)}-${limitedNumbers.slice(4, 8)}`;
      }
    }

    // 기본 포맷 (3-4-4)
    if (limitedNumbers.length <= 3) {
      return limitedNumbers;
    } else if (limitedNumbers.length <= 7) {
      return `${limitedNumbers.slice(0, 3)}-${limitedNumbers.slice(3)}`;
    } else {
      return `${limitedNumbers.slice(0, 3)}-${limitedNumbers.slice(3, 7)}-${limitedNumbers.slice(7)}`;
    }
  };

  // 전화번호 입력 핸들러
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setFormData({ ...formData, contact: formatted });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setSubmitSuccess(false);

    // 유효성 검사
    const validationErrors = validateContactForm(formData);
    if (!isFormValid(validationErrors)) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      // Google Sheets로 데이터 전송
      const response = await fetch(
        'https://script.google.com/macros/s/AKfycbxIRP7vUsVjLpg5KA457Qu_wEZC6hDvaIQuBT1XJrxvvMN0hPsmN28iZMK8xvs7dnOmTg/exec',
        {
          method: 'POST',
          mode: 'no-cors', // Google Apps Script CORS 우회
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'contact',
            kindergartenName: formData.kindergartenName,
            contact: formData.contact,
            source: adSource,
            timestamp: new Date().toISOString(),
          }),
        }
      );

      // no-cors 모드에서는 응답을 읽을 수 없으므로 성공으로 간주
      // localStorage에도 백업 저장 (선택사항)
      const submissions = JSON.parse(
        localStorage.getItem('contactSubmissions') || '[]'
      );
      submissions.push({
        ...formData,
        timestamp: new Date().toISOString(),
      });
      localStorage.setItem('contactSubmissions', JSON.stringify(submissions));

      // 성공 처리
      setSubmitSuccess(true);
      setFormData({
        kindergartenName: '',
        contact: '',
        privacyAgreed: false,
      });

      // 3초 후 성공 메시지 숨김
      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (error) {
      console.error('Form submission error:', error);
      setErrors({ kindergartenName: '제출 중 오류가 발생했습니다.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="mt-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 유치원명 */}
          <div>
            <label
              htmlFor="kindergarten_name"
              className="block text-sm text-[#bdc3c7] mb-1"
            >
              유치원명 (또는 성함)
            </label>
            <input
              type="text"
              id="kindergarten_name"
              value={formData.kindergartenName}
              onChange={(e) =>
                setFormData({ ...formData, kindergartenName: e.target.value })
              }
              className={`w-full h-10 px-3 rounded-md border-0 text-base ${
                errors.kindergartenName ? 'ring-2 ring-red-500' : ''
              }`}
            />
            {errors.kindergartenName && (
              <p className="text-red-500 text-sm mt-1">
                {errors.kindergartenName}
              </p>
            )}
          </div>

          {/* 연락처 */}
          <div>
            <label
              htmlFor="contact"
              className="block text-sm text-[#bdc3c7] mb-1"
            >
              연락처
            </label>
            <input
              type="text"
              id="contact"
              value={formData.contact}
              onChange={handlePhoneChange}
              placeholder="010-1234-5678 또는 02-123-4567"
              inputMode="numeric"
              className={`w-full h-10 px-3 rounded-md border-0 text-base ${
                errors.contact ? 'ring-2 ring-red-500' : ''
              }`}
            />
            {errors.contact && (
              <p className="text-red-500 text-sm mt-1">{errors.contact}</p>
            )}
          </div>
        </div>

        {/* 개인정보 동의 */}
        <div className="mt-5 flex items-center">
          <input
            type="checkbox"
            id="privacy_agree"
            checked={formData.privacyAgreed}
            onChange={(e) =>
              setFormData({ ...formData, privacyAgreed: e.target.checked })
            }
            className="h-4 w-4 text-[#e67e22] border-gray-300 rounded focus:ring-[#e67e22]"
          />
          <label
            htmlFor="privacy_agree"
            className="ml-2 text-sm text-[#ecf0f1]"
          >
            개인정보 수집 및 이용에 동의합니다.
          </label>
          <button
            type="button"
            onClick={() => setIsPrivacyModalOpen(true)}
            className="ml-2 text-sm text-[#bdc3c7] underline hover:text-white transition-colors"
          >
            [내용보기]
          </button>
        </div>
        {errors.privacyAgreed && (
          <p className="text-red-500 text-sm mt-1">{errors.privacyAgreed}</p>
        )}

        {/* 성공 메시지 */}
        {submitSuccess && (
          <div className="mt-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
            상담 신청이 완료되었습니다. 빠른 시일 내에 연락드리겠습니다.
          </div>
        )}

        {/* 제출 버튼 */}
        <div className="text-right mt-5">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Spinner size="sm" className="text-white" />
                제출 중...
              </span>
            ) : (
              '제출하기'
            )}
          </Button>
        </div>
      </form>

      {/* 개인정보처리방침 모달 */}
      <Modal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
        title="개인정보처리방침"
      >
        <div className="space-y-4">
          <p>
            퍼스트 컨설팅(이하 &apos;회사&apos;라 함)은 이용자의 개인정보를
            중요시하며, 「개인정보 보호법」 등 관련 법령을 준수하고 있습니다.
            회사는 본 개인정보처리방침을 통하여 이용자가 제공하는 개인정보가
            어떠한 용도와 방식으로 이용되고 있으며, 개인정보보호를 위해 어떠한
            조치가 취해지고 있는지 알려드립니다.
          </p>

          <div>
            <h5 className="font-semibold text-gray-800">
              1. 수집하는 개인정보 항목
            </h5>
            <p className="mt-1">
              회사는 원활한 상담 서비스 제공을 위해 아래와 같은 최소한의
              개인정보를 수집하고 있습니다.
            </p>
            <ul className="list-disc list-inside mt-1 pl-2">
              <li>수집 항목: 유치원명 또는 이름, 연락처(전화번호)</li>
            </ul>
          </div>

          <div>
            <h5 className="font-semibold text-gray-800">
              2. 개인정보의 수집 및 이용 목적
            </h5>
            <p className="mt-1">
              회사는 수집한 개인정보를 다음의 목적을 위해 활용합니다.
            </p>
            <ul className="list-disc list-inside mt-1 pl-2">
              <li>
                목적: 상담 신청 접수, 상담 진행을 위한 본인 확인, 원활한
                의사소통 경로 확보 및 상담 결과 안내
              </li>
            </ul>
          </div>

          <div>
            <h5 className="font-semibold text-gray-800">
              3. 개인정보의 보유 및 이용기간
            </h5>
            <p className="mt-1">
              이용자의 개인정보는 원칙적으로 개인정보의 수집 및 이용 목적이
              달성되면 지체 없이 파기합니다.
            </p>
            <ul className="list-disc list-inside mt-1 pl-2">
              <li>
                보유 기간: 상담 종료 후 1년 (내부 방침에 따른 상담 이력 관리)
              </li>
              <li>
                단, 이용자의 삭제 요청이 있거나 관계 법령의 규정에 의하여 보존할
                필요가 있는 경우 해당 법령에서 정한 기간 동안 보관합니다.
              </li>
            </ul>
          </div>

          <div>
            <h5 className="font-semibold text-gray-800">
              4. 정보주체의 권리·의무 및 행사방법
            </h5>
            <p className="mt-1">
              이용자는 언제든지 등록되어 있는 자신의 개인정보를 조회하거나 수정,
              삭제를 요청할 수 있습니다. 개인정보의 조회, 수정, 삭제 요청은
              회사의 대표 연락처(전화 또는 이메일)를 통해 본인 확인 절차를 거친
              후 가능합니다.
            </p>
          </div>

          <div>
            <h5 className="font-semibold text-gray-800">
              5. 개인정보 보호책임자
            </h5>
            <p className="mt-1">
              회사는 이용자의 개인정보를 보호하고 개인정보와 관련한 불만을
              처리하기 위하여 아래와 같이 개인정보 보호책임자를 지정하고
              있습니다.
            </p>
            <ul className="list-none mt-1 pl-2 space-y-1">
              <li>- 개인정보 보호책임자: {COMPANY_INFO.representative}</li>
              <li>- 전화: {COMPANY_INFO.call}</li>
              <li>- Fax: {COMPANY_INFO.fax}</li>
              <li>- 주소: {COMPANY_INFO.address}</li>
              <li>- 이메일: {COMPANY_INFO.email}</li>
            </ul>
          </div>

          <div>
            <h5 className="font-semibold text-gray-800">
              6. 개인정보처리방침의 고지 의무
            </h5>
            <p className="mt-1">
              본 개인정보처리방침의 내용 추가, 삭제 및 수정이 있을 경우, 시행
              최소 7일 전에 홈페이지를 통해 고지할 것입니다.
            </p>
            <p className="mt-2 font-semibold">- 시행일자: 2025년 11월 1일</p>
          </div>
        </div>
      </Modal>
    </>
  );
}
