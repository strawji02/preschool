import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import HeroSection from '@/components/sections/HeroSection';
import IntroSection from '@/components/sections/IntroSection';
import ServicesSection from '@/components/sections/ServicesSection';
import ContactFormSection from '@/components/sections/ContactFormSection';
import PageviewTracker from '@/components/analytics/PageviewTracker';

export default function Home() {
  return (
    <div className="p-4 sm:p-8">
      <PageviewTracker />
      <div className="w-full max-w-7xl bg-white rounded-2xl shadow-xl p-6 sm:p-10 mx-auto">
        <Header />

        <main>
          <HeroSection />
          <IntroSection />
          <ServicesSection />
          <ContactFormSection />
        </main>

        <Footer />
      </div>
    </div>
  );
}
