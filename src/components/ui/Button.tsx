import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  children: React.ReactNode;
}

export default function Button({
  variant = 'primary',
  children,
  className = '',
  ...props
}: ButtonProps) {
  const baseStyles =
    'font-bold py-2 px-6 rounded-full text-base transition-colors';
  const variantStyles = {
    primary: 'bg-[#e67e22] text-white hover:bg-[#d35400]',
    secondary: 'bg-gray-500 text-white hover:bg-gray-600',
  };

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
