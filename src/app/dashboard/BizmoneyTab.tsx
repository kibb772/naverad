'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { BizmoneyResult } from '@/lib/bizmoney-report';

interface Payload {
  lowBalance: BizmoneyResult[];
  normal: BizmoneyResult[];
  failed: BizmoneyResult[];
  threshold: number;
  totalAccounts: number;
  fetchedAt: string;
  cached: boolean;
}

const th: React.CSSProperties = { padding: '0.625rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', fontWeight: 600, fontSize: '0.8125rem' };
const td: React.CSSProperties = { padding: '0.625rem 0.75rem', border: '1px solid var(--border)', fontSize: '0.875rem' };
const tdRight: React.CSSProperties = { ...td, textAlign: 'right' };

// 잔액이 0 이하이거나 budgetLock 이면 네이버가 광고를 세운 상태다.
const isStopped = (r: BizmoneyResult) => r.budgetLock || (r.bizmoney ?? 0) <= 0;

const formatCharge = (d: string) => (d ? d.replace(/-/g, '.') : '-');

function BalanceTable({ rows, headerBg, danger }: { rows: BizmoneyResult[]; headerBg: string; danger?: boolean }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: headerBg }}>
            <th style={th}>계정명</th>
            <th style={{ ...th, textAlign: 'right' }}>잔액</th>
            <th style={{ ...th, textAlign: 'right' }}>마지막 충전</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customerId}>
              <td style={{ ...td, fontWeight: danger ? 700 : 400 }}>
                {r.accountName}
                {isStopped(r) && (
                  <span style={{ marginLeft: '0.375rem', fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600 }}>
                    (광고 정지)
                  </span>
                )}
              </td>
              <td style={{ ...tdRight, color: danger ? 'var(--danger)' : undefined, fontWeight: danger ? 700 : 400 }}>
                ₩{Math.floor(r.bizmoney ?? 0).toLocaleString()}
              </td>
              <td style={tdRight}>{formatCharge(r.lastChargeDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BizmoneyTab() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/naver/bizmoney-all${force ? '?force=1' : ''}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '조회 실패');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>📊 비즈머니 잔액 리포트 ({today})</h3>
          {data && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {data.totalAccounts}개 계정 · 조회 시각 {new Date(data.fetchedAt).toLocaleTimeString('ko-KR')}
              {data.cached && ' (캐시)'}
            </span>
          )}
        </div>
        <button onClick={() => load(true)} className="btn btn-outline" style={{ fontSize: '0.75rem' }} disabled={loading} data-testid="refresh-bizmoney-btn">
          {loading ? '조회 중...' : '🔄 새로고침'}
        </button>
      </div>

      {loading && !data && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          계정별 잔액을 불러오는 중입니다...
        </div>
      )}

      {error && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '0.5rem', background: '#fef2f2', color: '#991b1b', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {data.lowBalance.length > 0 && (
            <>
              <h4 style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '0.625rem' }}>
                ⚠️ 잔액 부족 ({data.threshold.toLocaleString()}원 이하) - {data.lowBalance.length}개 계정
              </h4>
              <BalanceTable rows={data.lowBalance} headerBg="#fef2f2" danger />
            </>
          )}

          {data.normal.length > 0 && (
            <>
              <h4 style={{ color: 'var(--success)', fontWeight: 600, marginBottom: '0.625rem' }}>
                ✅ 정상 - {data.normal.length}개 계정
              </h4>
              <BalanceTable rows={data.normal} headerBg="#f0fdf4" />
            </>
          )}

          {data.failed.length > 0 && (
            <>
              <h4 style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.625rem' }}>
                ❓ 조회 실패 - {data.failed.length}개 계정
              </h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      <th style={th}>계정명</th>
                      <th style={th}>사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.failed.map((r) => (
                      <tr key={r.customerId}>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{r.accountName}</td>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{r.error || '알 수 없는 오류'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
