import type { Metadata } from 'next';
import { Noto_Sans_KR } from 'next/font/google';
import './globals.css';

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-noto-sans-kr',
});

export const metadata: Metadata = {
  title: '퍼스트 컨설팅 | 유치원 전문 행정 컨설팅',
  description:
    '10년 경력의 유치원 전문 컨설팅. 회계, 노무, 관리 컨설팅 서비스를 제공합니다.',
  keywords: '유치원, 컨설팅, 행정, 회계, 노무, 관리, 퍼스트컨설팅',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${notoSansKr.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
