'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAccounts } from '@/context/AccountContext';

export default function SettingsPage() {
  const { accounts, addAccount, removeAccount, updateAccount } = useAccounts();
  const [form, setForm] = useState({ accountName: '', apiKey: '', secretKey: '', customerId: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.apiKey || !form.secretKey || !form.customerId) {
      setMessage('모든 필드를 입력해주세요.');
      return;
    }
    setLoading(true);
    setMessage('');

    try {
      // 실제 네이버 API 호출하여 계정 검증 + 캠페인 가져오기
      const res = await fetch('/api/naver/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: form.apiKey,
          secretKey: form.secretKey,
          customerId: form.customerId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || '연동에 실패했습니다.');
        setLoading(false);
        return;
      }

      const newAccountId = `acc-${Date.now()}`;
      const savedApiKey = form.apiKey;
      const savedSecretKey = form.secretKey;
      const savedCustomerId = form.customerId;
      const savedAccountName = form.accountName || data.accountName || `네이버 광고 (${form.customerId})`;

      // DB에 계정 저장
      const accountRes = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountName: savedAccountName,
          apiKey: savedApiKey,
          secretKey: savedSecretKey,
          customerId: savedCustomerId,
        }),
      });
      const accountData = await accountRes.json();
      const dbAccountId = accountData.id || newAccountId;

      addAccount({
        id: dbAccountId,
        accountName: savedAccountName,
        customerId: savedCustomerId,
        apiKey: savedApiKey,
        secretKey: savedSecretKey,
        isActive: false,
        syncStatus: 'syncing',
        syncProgress: 0,
        connectedAt: new Date().toISOString(),
        campaigns: data.campaigns || [],
      });
      setForm({ accountName: '', apiKey: '', secretKey: '', customerId: '' });
      setMessage('계정이 연동되었습니다. 90일치 데이터를 수집하는 중입니다...');

      // 완료될 때까지 반복 호출 (하루치씩)
      const runSync = async () => {
        let remaining = 90;
        while (remaining > 0) {
          try {
            const r = await fetch('/api/naver/initial-sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                apiKey: savedApiKey,
                secretKey: savedSecretKey,
                customerId: savedCustomerId,
                accountId: dbAccountId,
              }),
            });
            const result = await r.json();
            if (result.done) {
              updateAccount(dbAccountId, { isActive: true, syncStatus: 'ready', syncProgress: 100 });
              setMessage('✅ 연동 완료! 90일치 데이터 준비됨');
              break;
            }
            remaining = result.remaining ?? remaining - 1;
            const progress = Math.round(((90 - remaining) / 90) * 100);
            updateAccount(dbAccountId, { syncProgress: progress });
            setMessage(`데이터 수집 중... ${90 - remaining}/90일 완료`);
          } catch {
            // 에러 나도 계속 시도
            await new Promise((res) => setTimeout(res, 3000));
          }
        }
      };
      runSync();
    } catch {
      setMessage('서버 오류가 발생했습니다.');
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: '240px', background: 'white', borderRight: '1px solid var(--border)', padding: '1.5rem 1rem', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '2rem' }}>🔥 열끈</h1>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
          <Link href="/dashboard" style={{ padding: '0.625rem 0.875rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 400, color: 'var(--text)' }}>📊 대시보드</Link>
          <Link href="/settings" style={{ padding: '0.625rem 0.875rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 600, background: 'var(--bg)', color: 'var(--primary)' }}>🔗 계정 연동</Link>
        </nav>
        <button onClick={() => { import('next-auth/react').then(m => m.signOut({ callbackUrl: '/login' })); }}
          style={{ padding: '0.625rem 0.875rem', borderRadius: '0.5rem', fontSize: '0.875rem', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'left' }}>
          🚪 로그아웃
        </button>
      </aside>
      <main style={{ flex: 1, padding: '2rem', background: 'var(--bg)' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>계정 연동</h2>

        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>네이버 검색광고 계정 연동</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            네이버 검색광고 API 키를 입력하면 캠페인 데이터를 자동으로 수집합니다.
          </p>
          <form onSubmit={handleSubmit}>
            {(['accountName', 'apiKey', 'secretKey', 'customerId'] as const).map((field) => (
              <div key={field} style={{ marginBottom: '1rem' }}>
                <label htmlFor={field} style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                  {{ accountName: '계정 이름 (네이버 광고에서 사용하는 이름)', apiKey: '액세스 라이선스', secretKey: 'Secret Key', customerId: 'Customer ID' }[field]}
                </label>
                <input id={field} type={field === 'secretKey' ? 'password' : 'text'} className="input" value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                  placeholder={{ accountName: '예: 열끈마케팅', apiKey: '액세스 라이선스를 입력하세요', secretKey: 'Secret Key를 입력하세요', customerId: 'Customer ID를 입력하세요' }[field]}
                  required={field !== 'accountName'} data-testid={`settings-${field}-input`} autoComplete="off" />
              </div>
            ))}
            {message && <p style={{ fontSize: '0.875rem', marginBottom: '1rem', color: message.includes('실패') || message.includes('입력') ? 'var(--danger)' : 'var(--success)' }} role="alert">{message}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading} data-testid="settings-connect-button">
              {loading ? '연동 중...' : '계정 연동'}
            </button>
          </form>
        </div>

        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: '1rem' }}>연동된 계정</h3>
          {accounts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔗</p>
              <p>연동된 계정이 없습니다.</p>
              <p style={{ fontSize: '0.8125rem' }}>위에서 네이버 검색광고 API 키를 입력해 연동해주세요.</p>
            </div>
          ) : (
            <div>
              {accounts.map((a) => (
                <div key={a.id} style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }} data-testid={`account-${a.id}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '0.5rem', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 700, color: '#166534' }}>N</div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 600 }}>{a.accountName}</span>
                          {(a.syncStatus === 'ready' || (!a.syncStatus && a.isActive)) ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, background: '#dbeafe', color: '#1e40af' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2563eb', display: 'inline-block' }} />
                              연동 완료
                            </span>
                          ) : a.syncStatus === 'syncing' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, background: '#fef3c7', color: '#92400e' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                              데이터 수집 중...
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, background: '#f1f5f9', color: '#64748b' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />
                              준비 중
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                          Customer ID: {a.customerId} · 연동일: {new Date(a.connectedAt).toLocaleDateString('ko-KR')}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => removeAccount(a.id)} className="btn btn-outline" style={{ fontSize: '0.8125rem', color: 'var(--danger)', borderColor: 'var(--danger)' }} data-testid={`remove-account-${a.id}`}>
                      연동 해제
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 500, whiteSpace: 'nowrap' }}>일 예산 목표:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.8125rem' }}>₩</span>
                      <input
                        type="number"
                        className="input"
                        style={{ width: '150px', padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                        value={a.dailyBudgetGoal || ''}
                        onChange={(e) => updateAccount(a.id, { dailyBudgetGoal: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder="예: 500000"
                        data-testid={`budget-goal-${a.id}`}
                      />
                    </div>
                    {a.dailyBudgetGoal && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({a.dailyBudgetGoal >= 10000 ? `${(a.dailyBudgetGoal / 10000).toFixed(1).replace(/\.0$/, '')}만원` : `${a.dailyBudgetGoal.toLocaleString()}원`}/일)</span>}
                  </div>
                </div>
              ))}
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>총 {accounts.length}개 계정 연동됨</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
