import ContactForm from '@/components/forms/ContactForm';

export default function ContactFormSection() {
  return (
    <section id="contact" className="mt-10 sm:mt-12 bg-[#34495e] rounded-lg p-6 sm:p-8">
      <h3 className="text-xl sm:text-2xl font-bold text-white">
        궁금한 점이 있으신가요?
      </h3>
      <p className="text-base text-[#ecf0f1] mt-2">
        신청서를 남겨주시면 빠르게 연락드립니다.
      </p>
      <ContactForm />
    </section>
  );
}
