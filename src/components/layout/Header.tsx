import Logo from '@/components/ui/Logo';
import { NAVIGATION_ITEMS } from '@/lib/constants';

export default function Header() {
  return (
    <header className="flex flex-col sm:flex-row justify-between items-center pb-6 border-b border-gray-200">
      <div className="mb-4 sm:mb-0">
        <Logo />
      </div>
      <nav className="flex items-center space-x-6 text-base text-gray-600">
        {NAVIGATION_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="hover:text-black transition-colors"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
