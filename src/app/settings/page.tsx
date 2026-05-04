'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAccounts } from '@/context/AccountContext';

export default function SettingsPage() {
  const { accounts, addAccount, removeAccount, updateAccount } = useAccounts();
  const [form, setForm] = useState({ accountName: '', apiKey: '', secretKey: '', customerId: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // CSV 업로드 상태
  const [uploadingAccountId, setUploadingAccountId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // 업로드 중 페이지 이탈 방지
  useEffect(() => {
    if (!uploadingAccountId) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [uploadingAccountId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.apiKey || !form.secretKey || !form.customerId) {
      setMessage('모든 필드를 입력해주세요.');
      return;
    }
    setLoading(true);
    setMessage('');

    try {
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

      const savedAccountName = form.accountName || data.accountName || `네이버 광고 (${form.customerId})`;

      const accountRes = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountName: savedAccountName,
          apiKey: form.apiKey,
          secretKey: form.secretKey,
          customerId: form.customerId,
        }),
      });
      const accountData = await accountRes.json();
      const dbAccountId = accountData.id || `acc-${Date.now()}`;

      addAccount({
        id: dbAccountId,
        accountName: savedAccountName,
        customerId: form.customerId,
        apiKey: form.apiKey,
        secretKey: form.secretKey,
        isActive: true,
        syncStatus: 'ready',
        syncProgress: 100,
        connectedAt: new Date().toISOString(),
        campaigns: data.campaigns || [],
      });
      setForm({ accountName: '', apiKey: '', secretKey: '', customerId: '' });
      setMessage('✅ 계정이 연동되었습니다. 아래에서 키워드 보고서 CSV를 업로드하면 과거 데이터를 바로 볼 수 있습니다.');
    } catch {
      setMessage('서버 오류가 발생했습니다.');
    }
    setLoading(false);
  };

  const handleCSVUpload = async (accountId: string, file: File) => {
    setUploadingAccountId(accountId);
    setUploadMessage((prev) => ({ ...prev, [accountId]: '업로드 및 처리 중... (최대 1~2분 소요)' }));

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('accountId', accountId);

      const res = await fetch('/api/naver/upload-csv', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setUploadMessage((prev) => ({ ...prev, [accountId]: `❌ ${data.error}` }));
      } else {
        setUploadMessage((prev) => ({ ...prev, [accountId]: `✅ ${data.message}` }));
        updateAccount(accountId, { isActive: true, syncStatus: 'ready', syncProgress: 100 });
      }
    } catch {
      setUploadMessage((prev) => ({ ...prev, [accountId]: '❌ 업로드 중 오류가 발생했습니다.' }));
    }
    setUploadingAccountId(null);
  };

  const handleDrop = (accountId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragging(null);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.name.endsWith('.CSV'))) {
      handleCSVUpload(accountId, file);
    } else {
      setUploadMessage((prev) => ({ ...prev, [accountId]: '❌ CSV 파일만 업로드 가능합니다.' }));
    }
  };

  const handleFileSelect = (accountId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleCSVUpload(accountId, file);
    e.target.value = '';
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: '240px', background: 'white', borderRight: '1px solid var(--border)', padding: '1.5rem 1rem', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '2rem' }}>🔥 열끈</h1>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
          <Link href="/dashboard" onClick={(e) => { if (uploadingAccountId) { if (!confirm('CSV 업로드가 진행 중입니다. 페이지를 떠나시겠습니까?')) e.preventDefault(); } }}
            style={{ padding: '0.625rem 0.875rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 400, color: 'var(--text)' }}>📊 대시보드</Link>
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
            API 키를 입력해 계정을 연동한 뒤, 키워드 보고서 CSV를 업로드하면 바로 데이터를 확인할 수 있습니다.
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
            {message && <p style={{ fontSize: '0.875rem', marginBottom: '1rem', color: message.includes('실패') || message.includes('입력') || message.includes('❌') ? 'var(--danger)' : 'var(--success)' }} role="alert">{message}</p>}
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
                          {a.syncStatus === 'importing' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, background: '#fef3c7', color: '#92400e' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                              CSV 처리 중...
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.625rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, background: '#dbeafe', color: '#1e40af' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2563eb', display: 'inline-block' }} />
                              연동 완료
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

                  {/* 일 예산 목표 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 500, whiteSpace: 'nowrap' }}>일 예산 목표:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.8125rem' }}>₩</span>
                      <input type="number" className="input" style={{ width: '150px', padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                        value={a.dailyBudgetGoal || ''} onChange={(e) => updateAccount(a.id, { dailyBudgetGoal: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder="예: 500000" data-testid={`budget-goal-${a.id}`} />
                    </div>
                    {a.dailyBudgetGoal && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({a.dailyBudgetGoal >= 10000 ? `${(a.dailyBudgetGoal / 10000).toFixed(1).replace(/\.0$/, '')}만원` : `${a.dailyBudgetGoal.toLocaleString()}원`}/일)</span>}
                  </div>

                  {/* CSV 업로드 영역 */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(a.id); }}
                    onDragLeave={() => setDragging(null)}
                    onDrop={(e) => handleDrop(a.id, e)}
                    onClick={() => fileInputRefs.current[a.id]?.click()}
                    style={{
                      marginTop: '0.75rem', padding: '1.25rem', borderRadius: '0.5rem', cursor: 'pointer', textAlign: 'center',
                      border: `2px dashed ${dragging === a.id ? 'var(--primary)' : 'var(--border)'}`,
                      background: dragging === a.id ? '#eff6ff' : '#fafafa',
                      transition: 'all 0.15s',
                    }}
                  >
                    <input type="file" accept=".csv" ref={(el) => { fileInputRefs.current[a.id] = el; }} onChange={(e) => handleFileSelect(a.id, e)} style={{ display: 'none' }} />
                    {uploadingAccountId === a.id ? (
                      <p style={{ fontSize: '0.875rem', color: 'var(--primary)' }}>📤 업로드 중...</p>
                    ) : (
                      <>
                        <p style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>📄</p>
                        <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>키워드 보고서 CSV 파일을 드래그하거나 클릭해서 업로드</p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>네이버 검색광고 → 보고서 → 키워드 보고서 다운로드</p>
                      </>
                    )}
                  </div>
                  {uploadMessage[a.id] && (
                    <p style={{ fontSize: '0.8125rem', marginTop: '0.5rem', color: uploadMessage[a.id].includes('❌') ? 'var(--danger)' : 'var(--success)' }}>
                      {uploadMessage[a.id]}
                    </p>
                  )}
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
