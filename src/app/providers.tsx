'use client';

import { AccountProvider } from '@/context/AccountContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return <AccountProvider>{children}</AccountProvider>;
}
