import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: '열끈 광고 분석기 - AI 네이버 검색광고 분석',
  description: 'AI가 네이버 검색광고를 24시간 분석합니다. 이상 탐지, 원인 진단, 개선 제안까지 전부 자동으로.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
