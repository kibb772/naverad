'use client';

import React from 'react';
import Link from 'next/link';

// 사이드 메뉴가 대시보드와 설정 페이지에 각각 복사돼 있었다.
// 메뉴를 하나 추가할 때마다 빠뜨리는 곳이 생기므로 여기서만 정의한다.
export const NAV_ITEMS = [
  { href: '/dashboard', label: '📊 대시보드' },
  { href: '/settings', label: '🔗 계정 연동' },
  { href: '/bizmoney', label: '💰 잔액 확인' },
] as const;

export function SideNav({
  current,
  onNavigate,
}: {
  current: string;
  onNavigate?: (e: React.MouseEvent) => void;
}) {
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
      {NAV_ITEMS.map((item) => {
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            data-testid={`nav-${item.href.slice(1)}`}
            style={{
              padding: '0.625rem 0.875rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: active ? 600 : 400,
              background: active ? 'var(--bg)' : 'transparent',
              color: active ? 'var(--primary)' : 'var(--text)',
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function LogoutButton() {
  return (
    <button
      onClick={() => { import('next-auth/react').then((m) => m.signOut({ callbackUrl: '/login' })); }}
      style={{ padding: '0.625rem 0.875rem', borderRadius: '0.5rem', fontSize: '0.875rem', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'left' }}
    >
      🚪 로그아웃
    </button>
  );
}
