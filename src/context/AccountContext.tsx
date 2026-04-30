'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface LinkedAccount {
  id: string;
  accountName: string;
  customerId: string;
  apiKey: string;
  secretKey?: string;
  dailyBudgetGoal?: number;
  isActive: boolean;
  syncStatus: 'pending' | 'syncing' | 'ready';
  syncProgress?: number; // 0~100
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
}

const AccountContext = createContext<AccountContextType | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // localStorage에서 복원
  useEffect(() => {
    const saved = localStorage.getItem('linked-accounts');
    if (saved) {
      const parsed = JSON.parse(saved) as LinkedAccount[];
      setAccounts(parsed);
      if (parsed.length > 0) setSelectedAccountId(parsed[0].id);
    }
  }, []);

  // localStorage에 저장
  useEffect(() => {
    localStorage.setItem('linked-accounts', JSON.stringify(accounts));
  }, [accounts]);

  const addAccount = (account: LinkedAccount) => {
    setAccounts((prev) => [...prev, account]);
    if (!selectedAccountId) setSelectedAccountId(account.id);
  };

  const removeAccount = (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    if (selectedAccountId === id) {
      const remaining = accounts.filter((a) => a.id !== id);
      setSelectedAccountId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const updateAccount = (id: string, updates: Partial<LinkedAccount>) => {
    setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, ...updates } : a));
  };

  return (
    <AccountContext.Provider value={{ accounts, addAccount, removeAccount, updateAccount, selectedAccountId, setSelectedAccountId }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccounts() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccounts must be used within AccountProvider');
  return ctx;
}
