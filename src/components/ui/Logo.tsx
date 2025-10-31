import Image from 'next/image';

export default function Logo() {
  return (
    <Image
      src="/logo.png"
      alt="퍼스트 컨설팅"
      width={300}
      height={60}
      className="h-8 w-auto"
      priority
    />
  );
}
