'use client';

import { SessionProvider } from 'next-auth/react';
import { AccountProvider } from '@/context/AccountContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AccountProvider>{children}</AccountProvider>
    </SessionProvider>
  );
}
