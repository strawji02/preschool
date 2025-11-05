import { COMPANY_INFO } from '@/lib/constants';

export default function Footer() {
  return (
    <footer className="mt-10 pt-8 border-t border-gray-200">
      <div className="flex flex-col md:flex-row justify-between items-center text-sm text-gray-600">
        <div className="mb-4 md:mb-0 text-center md:text-left">
          <p className="font-semibold">{COMPANY_INFO.name}</p>
          <p className="mt-1">주소: {COMPANY_INFO.address}</p>
          <p>
            <span className="mr-3">전화: {COMPANY_INFO.call}</span>
            <span className="mr-3">Fax: {COMPANY_INFO.fax}</span>
            <span className="mr-3">휴대전화: {COMPANY_INFO.phone}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
