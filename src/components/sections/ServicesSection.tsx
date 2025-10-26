import ServiceCard from '@/components/ui/ServiceCard';
import { SERVICES } from '@/lib/constants';

export default function ServicesSection() {
  return (
    <section id="services" className="mt-10 sm:mt-12">
      <h3 className="text-2xl sm:text-3xl font-bold text-center text-[#2c3e50]">
        핵심 서비스
      </h3>
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {SERVICES.map((service) => (
          <ServiceCard
            key={service.id}
            title={service.title}
            items={service.items}
          />
        ))}
      </div>
    </section>
  );
}
