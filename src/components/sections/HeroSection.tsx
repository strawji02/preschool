'use client';

import Button from '@/components/ui/Button';

export default function HeroSection() {
  const handleConsultationClick = () => {
    const contactSection = document.getElementById('contact');
    if (contactSection) {
      contactSection.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section className="mt-8 bg-[#ffecd1] rounded-lg p-6 sm:p-8">
      <h1 className="text-2xl lg:text-3xl font-bold text-[#795548]">
        복잡하고 어려운 행정업무,
      </h1>
      <h2 className="text-2xl lg:text-3xl font-bold text-[#795548] mt-1">
        전문가가 해결해드립니다.
      </h2>
      <p className="text-base text-[#795548] mt-4">
        10년 경력의 유치원 전문 컨설팅
      </p>
      <div className="text-right mt-4">
        <Button onClick={handleConsultationClick}>상담 신청하기</Button>
      </div>
    </section>
  );
}
