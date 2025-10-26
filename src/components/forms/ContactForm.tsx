'use client';

import { useState } from 'react';
import type { ContactFormData, ContactFormErrors } from '@/types/form';
import { validateContactForm, isFormValid } from '@/lib/validation';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';

export default function ContactForm() {
  const [formData, setFormData] = useState<ContactFormData>({
    kindergartenName: '',
    contact: '',
    privacyAgreed: false,
  });

  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);

  // 전화번호 자동 포맷팅 함수
  const formatPhoneNumber = (value: string) => {
    // 숫자만 추출
    const numbers = value.replace(/[^\d]/g, '');

    // 최대 11자리까지만 허용
    const limitedNumbers = numbers.slice(0, 11);

    // 포맷팅 적용
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

    // 서버 연동 없이 클라이언트 사이드 처리
    try {
      // 시뮬레이션: 1초 대기
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // localStorage에 저장 (선택사항)
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
              placeholder="010-0000-0000"
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
          <label htmlFor="privacy_agree" className="ml-2 text-sm text-[#ecf0f1]">
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
            {isSubmitting ? '제출 중...' : '제출하기'}
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
            퍼스트 컨설팅(이하 &apos;회사&apos;라 함)은 이용자의 개인정보를 중요시하며,
            「개인정보 보호법」 등 관련 법령을 준수하고 있습니다. 회사는 본
            개인정보처리방침을 통하여 이용자가 제공하는 개인정보가 어떠한
            용도와 방식으로 이용되고 있으며, 개인정보보호를 위해 어떠한 조치가
            취해지고 있는지 알려드립니다.
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
              <li>보유 기간: 상담 종료 후 1년 (내부 방침에 따른 상담 이력 관리)</li>
              <li>
                단, 이용자의 삭제 요청이 있거나 관계 법령의 규정에 의하여
                보존할 필요가 있는 경우 해당 법령에서 정한 기간 동안
                보관합니다.
              </li>
            </ul>
          </div>

          <div>
            <h5 className="font-semibold text-gray-800">
              4. 정보주체의 권리·의무 및 행사방법
            </h5>
            <p className="mt-1">
              이용자는 언제든지 등록되어 있는 자신의 개인정보를 조회하거나
              수정, 삭제를 요청할 수 있습니다. 개인정보의 조회, 수정, 삭제
              요청은 회사의 대표 연락처(전화 또는 이메일)를 통해 본인 확인
              절차를 거친 후 가능합니다.
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
              <li>- 개인정보 보호책임자: [담당자 이름 입력]</li>
              <li>- 전화번호: 02-0000-0000</li>
              <li>- 휴대폰: 010-3033-3122</li>
              <li>
                - 주소: 서울시 송파구 충민로 66, 가든파이브라이프 F8100
              </li>
              <li>- 이메일: [회사 이메일 주소 입력]</li>
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
            <p className="mt-2 font-semibold">- 시행일자: 202X년 XX월 XX일</p>
          </div>
        </div>
      </Modal>
    </>
  );
}
