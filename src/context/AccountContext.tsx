'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

export interface LinkedAccount {
  id: string;
  accountName: string;
  customerId: string;
  apiKey: string;
  secretKey?: string;
  dailyBudgetGoal?: number;
  isActive: boolean;
  syncStatus: 'pending' | 'syncing' | 'ready';
  syncProgress?: number;
  connectedAt: string;
  campaigns?: {
    naverCampaignId: string;
    name: string;
    status: string;
    dailyBudget: number;
    campaignType?: string;
  }[];
}

interface AccountContextType {
  accounts: LinkedAccount[];
  addAccount: (account: LinkedAccount) => void;
  removeAccount: (id: string) => void;
  updateAccount: (id: string, updates: Partial<LinkedAccount>) => void;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  loading: boolean;
}

const AccountContext = createContext<AccountContextType | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 로그인 시 DB에서 계정 목록 불러오기
  useEffect(() => {
    if (status === 'authenticated') {
      fetch('/api/accounts')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            const mapped: LinkedAccount[] = data.map((a) => ({
              id: a.id,
              accountName: a.accountName,
              customerId: a.customerId,
              apiKey: a.apiKey,
              secretKey: a.secretKey,
              dailyBudgetGoal: a.dailyBudgetGoal ?? undefined,
              isActive: a.isActive,
              syncStatus: (a.syncStatus as 'pending' | 'syncing' | 'ready') || 'pending',
              connectedAt: a.createdAt,
              campaigns: [],
            }));
            setAccounts(mapped);
            if (mapped.length > 0) setSelectedAccountId(mapped[0].id);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else if (status === 'unauthenticated') {
      setAccounts([]);
      setLoading(false);
    }
  }, [status]);

  const addAccount = (account: LinkedAccount) => {
    setAccounts((prev) => [...prev, account]);
    if (!selectedAccountId) setSelectedAccountId(account.id);
  };

  const removeAccount = async (id: string) => {
    await fetch(`/api/accounts?id=${id}`, { method: 'DELETE' });
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    if (selectedAccountId === id) {
      const remaining = accounts.filter((a) => a.id !== id);
      setSelectedAccountId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const updateAccount = async (id: string, updates: Partial<LinkedAccount>) => {
    setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, ...updates } : a));
    // DB에도 저장 (syncStatus, dailyBudgetGoal, isActive만)
    const dbUpdates: Record<string, unknown> = { id };
    if (updates.syncStatus !== undefined) dbUpdates.syncStatus = updates.syncStatus;
    if (updates.dailyBudgetGoal !== undefined) dbUpdates.dailyBudgetGoal = updates.dailyBudgetGoal;
    if (updates.isActive !== undefined) dbUpdates.isActive = updates.isActive;

    if (Object.keys(dbUpdates).length > 1) {
      await fetch('/api/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbUpdates),
      }).catch(() => {});
    }
  };

  return (
    <AccountContext.Provider value={{ accounts, addAccount, removeAccount, updateAccount, selectedAccountId, setSelectedAccountId, loading }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccounts() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccounts must be used within AccountProvider');
  return ctx;
}
