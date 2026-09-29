'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import BizmoneyTab from '../dashboard/BizmoneyTab';
import { SideNav, LogoutButton } from '@/components/SideNav';

export default function BizmoneyPage() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: '240px', background: 'white', borderRight: '1px solid var(--border)', padding: '1.5rem 1rem', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.5rem' }}>🔥 열끈</h1>
        <SideNav current="/bizmoney" />
        <LogoutButton />
      </aside>
      <main style={{ flex: 1, padding: '2rem', background: 'var(--bg)' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>잔액 확인</h2>
        <BizmoneyTab />
      </main>
    </div>
  );
}
