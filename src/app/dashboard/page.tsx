'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccounts, LinkedAccount } from '@/context/AccountContext';

function getDemoDataForAccount(account: LinkedAccount) {
  // 계정별로 다른 데모 데이터 생성 (customerId 기반 시드)
  const seed = account.customerId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = (seed % 50) + 30;
  return {
    summary: {
      impressions: 40000 + (seed * 137) % 60000, impressionsDelta: ((seed % 30) - 10),
      clicks: 1500 + (seed * 43) % 3000, clicksDelta: ((seed % 20) - 5),
      ctr: +(3 + (seed % 30) / 10).toFixed(2), ctrDelta: +((seed % 10) - 5).toFixed(1),
      cpc: 400 + (seed * 7) % 600, cpcDelta: +((seed % 16) - 8).toFixed(1),
      conversions: 50 + (seed * 3) % 150, conversionsDelta: ((seed % 40) - 10),
      cost: 300000 + (seed * 97) % 700000,
      roas: 200 + (seed * 11) % 300, roasDelta: ((seed % 30) - 10),
    },
    campaigns: [
      { id: `${account.id}-c1`, name: '봄 신상품_리타겟', status: 'ACTIVE', campaignType: 'WEB_SITE', dailyBudget: 50000 + base * 1000, cost: 382000 + base * 100, roas: 350 + base, roasDelta: 14, impressions: 42100 + base * 50, clicks: 1820 + base * 5, ctr: 4.32, cpc: 518 + base, conversions: 89 + (base % 20) },
      { id: `${account.id}-c2`, name: '브랜드 키워드', status: 'ACTIVE', campaignType: 'WEB_SITE', dailyBudget: 30000 + base * 500, cost: 128500 + base * 80, roas: 250 + base, roasDelta: 5, impressions: 15200 + base * 30, clicks: 620 + base * 3, ctr: 4.08, cpc: 741 + base, conversions: 32 + (base % 10) },
      { id: `${account.id}-c3`, name: '신규 고객 유치', status: 'ACTIVE', campaignType: 'SHOPPING', dailyBudget: 20000 + base * 300, cost: 274100 + base * 60, roas: 150 + base, roasDelta: -3, impressions: 9940 + base * 20, clicks: 370 + base * 2, ctr: 3.72, cpc: 892 + base, conversions: 21 + (base % 8) },
      { id: `${account.id}-c4`, name: '시즌 할인 프로모션', status: 'PAUSED', campaignType: 'WEB_SITE', dailyBudget: 0, cost: 0, roas: 0, roasDelta: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, conversions: 0 },
    ],
    alerts: [
      { id: `${account.id}-a1`, severity: 'CRITICAL', title: `봄 신상품_리타겟 CPC +32% 급등`, message: `CPC가 7일 평균 ₩518 대비 ₩${518 + base}으로 상승했습니다.`, time: '5분 전' },
      { id: `${account.id}-a2`, severity: 'WARNING', title: '브랜드 키워드 전환율 -18% 하락', message: '전환율이 30일 평균 대비 -18% 하락했습니다.', time: '24분 전' },
    ],
    diagnosis: {
      campaignName: '봄 신상품_리타겟',
      date: new Date().toISOString().slice(0, 10),
      anomaly: { metric: 'CPC', change: '+32%', avg: '₩518', current: `₩${518 + base}` },
      causes: [
        { name: '오디언스 피로도 누적', detail: '빈도 4.2 → 6.8 (주간)', probability: 72 },
        { name: '입찰 경쟁 증가', detail: '카테고리 내 광고주 +12%', probability: 58 },
        { name: '소재 CTR 하락', detail: '2.1% → 1.3% (5일간)', probability: 44 },
      ],
      suggestions: [
        { icon: '🎨', action: '신규 소재 3종 제작 후 A/B 테스트 시작' },
        { icon: '👥', action: '오디언스 익스클루드 설정 (최근 30일 노출자)' },
        { icon: '💰', action: '일예산 15% 축소 후 성과 재평가' },
      ],
    },
    report: {
      grade: '매우 좋음' as const,
      date: new Date().toISOString().slice(0, 10),
      summary: `어제 전체 광고 성과는 기준 대비 +14% 개선됐습니다. 특히 "봄 신상품" 캠페인이 ROAS ${350 + base}%를 기록하며 전체 전환의 63%를 견인했습니다.`,
      metrics: { impressions: `${Math.round((42100 + base * 50) / 1000)}K`, clicks: `${((1820 + base * 5) / 1000).toFixed(1)}K`, conversions: `${89 + (base % 20)}` },
      deltas: { impressions: '+12%', clicks: '+8%', conversions: '+21%' },
      actions: ['"봄 신상품" 일예산 30% 증액', '저효율 키워드 3개 일시중지'],
    },
  };
}

const MAX_DAYS = 90; // 네이버 검색광고 Stats API 최대 조회 기간

const formatDate = (d: Date) => d.toISOString().slice(0, 10);

function getDefaultDateRange() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return { since: formatDate(yesterday), until: formatDate(yesterday) };
}

function getDaysDiff(since: string, until: string): number {
  const s = new Date(since);
  const u = new Date(until);
  return Math.round((u.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

export default function DashboardPage() {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccounts();
  const [activeTab, setActiveTab] = useState<'overview' | 'diagnosis' | 'report'>('overview');
  const [loading, setLoading] = useState(false);
  const [campaignData, setCampaignData] = useState<ReturnType<typeof getDemoDataForAccount> | null>(null);
  const [dataSource, setDataSource] = useState<'live' | 'demo'>('demo');
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [bizmoney, setBizmoney] = useState<number | null>(null);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  // 비즈머니 잔액 조회
  useEffect(() => {
    if (!selectedAccount) return;
    setBizmoney(null);

    fetch('/api/naver/bizmoney', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: selectedAccount.apiKey,
        secretKey: selectedAccount.secretKey,
        customerId: selectedAccount.customerId,
      }),
    })
      .then((r) => r.json())
      .then((data) => { if (data.bizmoney !== undefined) setBizmoney(data.bizmoney); })
      .catch(() => {});
  }, [selectedAccount?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 계정이 바뀌거나 날짜가 바뀔 때마다 실제 API 호출 시도
  useEffect(() => {
    if (!selectedAccount) return;

    const fetchLiveData = async () => {
      setLoading(true);
      try {
        // 1. 캠페인 목록 가져오기
        const campRes = await fetch('/api/naver/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: selectedAccount.apiKey,
            secretKey: selectedAccount.secretKey,
            customerId: selectedAccount.customerId,
          }),
        });

        if (campRes.ok) {
          const campData = await campRes.json();
          if (campData.campaigns && campData.campaigns.length > 0) {
            const campaignIds = campData.campaigns.map((c: Record<string, unknown>) => c.naverCampaignId as string);

            // 2. 선택된 날짜 범위로 통계 데이터 가져오기
            let statsMap: Record<string, Record<string, number>> = {};
            try {
              const statsRes = await fetch('/api/naver/stats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  apiKey: selectedAccount.apiKey,
                  secretKey: selectedAccount.secretKey,
                  customerId: selectedAccount.customerId,
                  campaignIds,
                  since: dateRange.since,
                  until: dateRange.until,
                }),
              });
              if (statsRes.ok) {
                const statsData = await statsRes.json();
                if (Array.isArray(statsData.stats)) {
                  for (const s of statsData.stats) {
                    statsMap[s.id] = {
                      impressions: s.impCnt || 0,
                      clicks: s.clkCnt || 0,
                      cost: s.salesAmt || 0,
                      ctr: s.ctr || 0,
                      cpc: s.cpc || 0,
                      conversions: s.ccnt || 0,
                    };
                  }
                }
              }
            } catch {
              // 통계 실패해도 캠페인 목록은 표시
            }

            const liveCampaigns = campData.campaigns.map((c: Record<string, unknown>) => {
              const cid = c.naverCampaignId as string;
              const stats = statsMap[cid] || {};
              const cost = stats.cost || 0;
              const conversions = stats.conversions || 0;
              return {
                id: cid,
                name: c.name as string,
                status: c.status as string,
                campaignType: (c.campaignType as string) || 'WEB_SITE',
                dailyBudget: (c.dailyBudget as number) || 0,
                cost,
                impressions: stats.impressions || 0,
                clicks: stats.clicks || 0,
                ctr: stats.ctr ? +stats.ctr.toFixed(2) : 0,
                cpc: stats.cpc ? Math.round(stats.cpc) : 0,
                conversions,
                roas: cost > 0 ? Math.round((conversions * 10000 / cost) * 100) : 0,
                roasDelta: 0,
              };
            });

            // 전체 합산
            const totalImpressions = liveCampaigns.reduce((s: number, c: { impressions: number }) => s + c.impressions, 0);
            const totalClicks = liveCampaigns.reduce((s: number, c: { clicks: number }) => s + c.clicks, 0);
            const totalCost = liveCampaigns.reduce((s: number, c: { cost: number }) => s + c.cost, 0);
            const totalConversions = liveCampaigns.reduce((s: number, c: { conversions: number }) => s + c.conversions, 0);

            const demoBase = getDemoDataForAccount(selectedAccount);
            setCampaignData({
              ...demoBase,
              summary: {
                impressions: totalImpressions, impressionsDelta: 0,
                clicks: totalClicks, clicksDelta: 0,
                ctr: totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(2) : 0, ctrDelta: 0,
                cpc: totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0, cpcDelta: 0,
                conversions: totalConversions, conversionsDelta: 0,
                cost: totalCost,
                roas: totalCost > 0 ? Math.round((totalConversions * 10000 / totalCost) * 100) : 0, roasDelta: 0,
              },
              campaigns: liveCampaigns,
              alerts: [],
            });
            setDataSource('live');
            setLoading(false);
            return;
          }
        }
      } catch {
        // API 실패 시 데모 데이터로 폴백
      }

      setCampaignData(getDemoDataForAccount(selectedAccount));
      setDataSource('demo');
      setLoading(false);
    };

    fetchLiveData();
  }, [selectedAccount?.id, dateRange.since, dateRange.until]); // eslint-disable-line react-hooks/exhaustive-deps

  // 연동된 계정이 없을 때
  if (accounts.length === 0) {
    return (
      <DashboardLayout accounts={accounts} selectedAccountId={selectedAccountId} onSelectAccount={setSelectedAccountId}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>대시보드</h2>
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <p style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔗</p>
          <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>연동된 광고 계정이 없습니다</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            네이버 검색광고 계정을 연동하면 AI가 자동으로 성과를 분석합니다.
          </p>
          <Link href="/settings" className="btn btn-primary" data-testid="go-connect-button">계정 연동하기</Link>
        </div>
      </DashboardLayout>
    );
  }

  if (!selectedAccount) return null;
  const d = campaignData || getDemoDataForAccount(selectedAccount);

  return (
    <DashboardLayout accounts={accounts} selectedAccountId={selectedAccountId} onSelectAccount={setSelectedAccountId}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>대시보드</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <select value={selectedAccountId || ''} onChange={(e) => setSelectedAccountId(e.target.value)} data-testid="account-selector"
            style={{ padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--border)', fontSize: '0.875rem', background: 'white', cursor: 'pointer' }}>
            {accounts.map((a) => (<option key={a.id} value={a.id}>{a.accountName}</option>))}
          </select>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            {dataSource === 'live' ? '🟢 실시간 · 네이버 검색광고' : '🟡 데모 데이터 · 네이버 API 연결 시 실제 데이터 표시'}
          </span>
        </div>
      </div>

      {/* 날짜 선택 */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>📅 조회 기간:</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {[
            { label: '오늘', fn: () => { const t = new Date(); setDateRange({ since: formatDate(t), until: formatDate(t) }); } },
            { label: '어제', fn: () => { const y = new Date(); y.setDate(y.getDate() - 1); setDateRange({ since: formatDate(y), until: formatDate(y) }); } },
            { label: '최근 7일', fn: () => { const t = new Date(); const s = new Date(t); s.setDate(s.getDate() - 6); setDateRange({ since: formatDate(s), until: formatDate(t) }); } },
            { label: '최근 30일', fn: () => { const t = new Date(); const s = new Date(t); s.setDate(s.getDate() - 29); setDateRange({ since: formatDate(s), until: formatDate(t) }); } },
            { label: '최근 90일', fn: () => { const t = new Date(); const s = new Date(t); s.setDate(s.getDate() - 89); setDateRange({ since: formatDate(s), until: formatDate(t) }); } },
            { label: '이번 달', fn: () => { const t = new Date(); const s = new Date(t.getFullYear(), t.getMonth(), 1); setDateRange({ since: formatDate(s), until: formatDate(t) }); } },
            { label: '지난 달', fn: () => { const t = new Date(); const s = new Date(t.getFullYear(), t.getMonth() - 1, 1); const e = new Date(t.getFullYear(), t.getMonth(), 0); setDateRange({ since: formatDate(s), until: formatDate(e) }); } },
          ].map((btn) => (
            <button key={btn.label} onClick={btn.fn} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }} data-testid={`date-${btn.label}`}>
              {btn.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginLeft: 'auto' }}>
          <input type="date" value={dateRange.since}
            max={dateRange.until}
            onChange={(e) => {
              const newSince = e.target.value;
              const days = getDaysDiff(newSince, dateRange.until);
              if (days > MAX_DAYS) {
                const maxUntil = new Date(newSince);
                maxUntil.setDate(maxUntil.getDate() + MAX_DAYS);
                setDateRange({ since: newSince, until: formatDate(maxUntil) });
              } else {
                setDateRange({ ...dateRange, since: newSince });
              }
            }}
            style={{ padding: '0.375rem 0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border)', fontSize: '0.8125rem' }} data-testid="date-since" />
          <span style={{ color: 'var(--text-muted)' }}>~</span>
          <input type="date" value={dateRange.until}
            min={dateRange.since}
            max={(() => {
              const maxDate = new Date(dateRange.since);
              maxDate.setDate(maxDate.getDate() + MAX_DAYS);
              const today = new Date();
              return formatDate(maxDate > today ? today : maxDate);
            })()}
            onChange={(e) => setDateRange({ ...dateRange, until: e.target.value })}
            style={{ padding: '0.375rem 0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border)', fontSize: '0.8125rem' }} data-testid="date-until" />
        </div>
        {getDaysDiff(dateRange.since, dateRange.until) > 0 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            ({getDaysDiff(dateRange.since, dateRange.until)}일 / 최대 {MAX_DAYS}일)
          </span>
        )}
      </div>

      {/* 선택된 계정 정보 배너 */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', marginBottom: '1.5rem' }}>
          <p>네이버 검색광고 데이터를 불러오는 중...</p>
        </div>
      ) : (
      <>
      <div className="card" style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '0.375rem', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#166534' }}>N</div>
        <div>
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{selectedAccount.accountName}</span>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>Customer ID: {selectedAccount.customerId} · 연동일: {new Date(selectedAccount.connectedAt).toLocaleDateString('ko-KR')}</span>
        </div>
        <span className="badge badge-success" style={{ marginLeft: 'auto' }}>연동됨</span>
      </div>

      {/* 예산 & 핵심 지표 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        {[
          { label: '소진', value: `₩${d.summary.cost.toLocaleString()}` },
          { label: '노출수', value: d.summary.impressions.toLocaleString() },
          { label: '클릭수', value: d.summary.clicks.toLocaleString() },
          { label: 'CTR', value: `${d.summary.ctr}%` },
          { label: 'CPC', value: `${d.summary.cpc.toLocaleString()}원` },
        ].map((m) => (
          <div key={m.label} className="card" data-testid={`metric-${m.label}`}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{m.label}</span>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.25rem 0' }}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* 비즈머니 잔액 표시 */}
      {bizmoney !== null && (
        <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: bizmoney <= 10000 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${bizmoney <= 10000 ? '#fecaca' : '#bbf7d0'}` }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
            💰 남은 비즈머니
          </span>
          <span style={{ fontSize: '1.125rem', fontWeight: 700, color: bizmoney <= 10000 ? '#dc2626' : '#16a34a' }}>
            ₩{Math.floor(bizmoney).toLocaleString()}
            {bizmoney <= 10000 && <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem', color: '#dc2626' }}>⚠️ 충전 필요</span>}
          </span>
        </div>
      )}

      {selectedAccount?.dailyBudgetGoal && (
        <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
              기간 예산 ({getDaysDiff(dateRange.since, dateRange.until) || 1}일)
            </span>
            <span style={{ fontSize: '0.875rem' }}>
              <span style={{ fontWeight: 700 }}>₩{d.summary.cost.toLocaleString()}</span>
              <span style={{ color: 'var(--text-muted)' }}> / ₩{(selectedAccount.dailyBudgetGoal * (getDaysDiff(dateRange.since, dateRange.until) || 1)).toLocaleString()}</span>
              <span style={{ marginLeft: '0.5rem', fontWeight: 600, color: (d.summary.cost / (selectedAccount.dailyBudgetGoal * (getDaysDiff(dateRange.since, dateRange.until) || 1))) > 0.9 ? 'var(--danger)' : (d.summary.cost / (selectedAccount.dailyBudgetGoal * (getDaysDiff(dateRange.since, dateRange.until) || 1))) > 0.7 ? 'var(--warning)' : 'var(--success)' }}>
                ({Math.round((d.summary.cost / (selectedAccount.dailyBudgetGoal * (getDaysDiff(dateRange.since, dateRange.until) || 1))) * 100)}%)
              </span>
            </span>
          </div>
          <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min((d.summary.cost / (selectedAccount.dailyBudgetGoal * (getDaysDiff(dateRange.since, dateRange.until) || 1))) * 100, 100)}%`,
              background: (d.summary.cost / (selectedAccount.dailyBudgetGoal * (getDaysDiff(dateRange.since, dateRange.until) || 1))) > 0.9 ? 'var(--danger)' : (d.summary.cost / (selectedAccount.dailyBudgetGoal * (getDaysDiff(dateRange.since, dateRange.until) || 1))) > 0.7 ? 'var(--warning)' : 'var(--primary)',
              borderRadius: '4px',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.375rem' }}>
            일 예산 ₩{selectedAccount.dailyBudgetGoal.toLocaleString()} × {getDaysDiff(dateRange.since, dateRange.until) || 1}일 = ₩{(selectedAccount.dailyBudgetGoal * (getDaysDiff(dateRange.since, dateRange.until) || 1)).toLocaleString()}
          </div>
        </div>
      )}

      {/* 탭 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        {([['overview', '📊 캠페인 현황']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key as 'overview' | 'diagnosis' | 'report')} data-testid={`tab-${key}`}
            style={{ padding: '0.5rem 1rem', border: 'none', background: activeTab === key ? 'var(--primary)' : 'transparent', color: activeTab === key ? 'white' : 'var(--text-muted)', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <OverviewTab campaigns={d.campaigns} account={selectedAccount} dateRange={dateRange} />
          <KeywordTopSection account={selectedAccount} dateRange={dateRange} />
        </>
      )}
      </>
      )}
    </DashboardLayout>
  );
}

/* ── 키워드 Top 30 섹션 ── */
function KeywordTopSection({ account, dateRange }: { account?: LinkedAccount | null; dateRange?: { since: string; until: string } }) {
  const [keywords, setKeywords] = useState<{ id: string; text: string; campaignName?: string; adGroupName?: string; cost: number; impressions: number; clicks: number; ctr: number; cpc: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [syncInfo, setSyncInfo] = useState<{ syncedDays: number; lastSync: string | null }>({ syncedDays: 0, lastSync: null });

  // DB에서 캐시된 데이터 즉시 조회
  useEffect(() => {
    if (!account?.id || !dateRange?.since || !dateRange?.until) return;
    setLoading(true);

    fetch('/api/naver/keywords-cached', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.id, since: dateRange.since, until: dateRange.until }),
    })
      .then((r) => r.json())
      .then((data) => {
        setKeywords(data.keywords || []);
        setSyncInfo({ syncedDays: data.syncedDays || 0, lastSync: data.lastSync });
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); })
      .finally(() => setLoading(false));
  }, [account?.id, dateRange?.since, dateRange?.until]);

  // 데이터 수집 (네이버 API → DB 저장)
  const syncData = async () => {
    if (!account?.apiKey || !account?.secretKey) return;
    setSyncing(true);

    try {
      // 어제 날짜 수집
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const syncDate = yesterday.toISOString().slice(0, 10);

      const res = await fetch('/api/naver/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: account.apiKey, secretKey: account.secretKey,
          customerId: account.customerId, accountId: account.id,
          date: syncDate,
        }),
      });

      const data = await res.json();
      if (data.skipped) {
        alert(`${syncDate} 데이터는 이미 수집되었습니다.`);
      } else {
        alert(`${syncDate} 데이터 수집 완료! (키워드 ${data.keywordCount}개)`);
        // 다시 조회
        const kwRes = await fetch('/api/naver/keywords-cached', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: account.id, since: dateRange?.since, until: dateRange?.until }),
        });
        if (kwRes.ok) {
          const kwData = await kwRes.json();
          setKeywords(kwData.keywords || []);
          setSyncInfo({ syncedDays: kwData.syncedDays || 0, lastSync: kwData.lastSync });
        }
      }
    } catch {
      alert('데이터 수집 중 오류가 발생했습니다.');
    }

    setSyncing(false);
  };

  const displayed = showAll ? keywords : keywords.slice(0, 10);

  return (
    <div style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>🔑 클릭 Top 키워드</h3>
          {syncInfo.syncedDays > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              수집된 날짜: {syncInfo.syncedDays}일 · 마지막 수집: {syncInfo.lastSync ? new Date(syncInfo.lastSync).toLocaleDateString('ko-KR') : '-'}
            </span>
          )}
        </div>
        <button onClick={syncData} className="btn btn-outline" style={{ fontSize: '0.75rem' }} disabled={syncing} data-testid="sync-keywords-btn">
          {syncing ? '수집 중...' : '🔄 수동 수집'}
        </button>
      </div>

      {loading && <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>키워드 통계를 불러오는 중... (키워드가 많으면 시간이 걸릴 수 있습니다)</div>}

      {loaded && keywords.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>키워드 데이터가 없습니다.</div>
      )}

      {displayed.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500, width: '40px' }}>#</th>
                <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>키워드</th>
                <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'right' }}>클릭</th>
                <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'right' }}>노출</th>
                <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'right' }}>CTR</th>
                <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'right' }}>CPC</th>
                <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'right' }}>소진</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((kw, i) => (
                <tr key={kw.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.625rem 0.5rem', color: i < 3 ? 'var(--primary)' : 'var(--text-muted)', fontWeight: i < 3 ? 700 : 400 }}>{i + 1}</td>
                  <td style={{ padding: '0.625rem 0.5rem', fontWeight: 600 }}>{kw.text}</td>
                  <td style={{ padding: '0.625rem 0.5rem', textAlign: 'right', fontWeight: 600, color: 'var(--primary)' }}>{kw.clicks.toLocaleString()}</td>
                  <td style={{ padding: '0.625rem 0.5rem', textAlign: 'right' }}>{kw.impressions.toLocaleString()}</td>
                  <td style={{ padding: '0.625rem 0.5rem', textAlign: 'right' }}>{kw.ctr}%</td>
                  <td style={{ padding: '0.625rem 0.5rem', textAlign: 'right' }}>₩{kw.cpc.toLocaleString()}</td>
                  <td style={{ padding: '0.625rem 0.5rem', textAlign: 'right' }}>₩{kw.cost.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {keywords.length > 10 && (
            <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <button onClick={() => setShowAll(!showAll)} className="btn btn-outline" style={{ fontSize: '0.8125rem' }} data-testid="toggle-keywords-btn">
                {showAll ? `접기 (10개만 보기)` : `더보기 (${keywords.length}개 전체)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ campaigns, account, dateRange }: { campaigns: ReturnType<typeof getDemoDataForAccount>['campaigns']; account?: LinkedAccount | null; dateRange?: { since: string; until: string } }) {
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchText, setSearchText] = useState('');
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [adGroupsData, setAdGroupsData] = useState<Record<string, { id: string; name: string; status: string; cost: number; impressions: number; clicks: number; ctr: number; cpc: number }[]>>({});
  const [loadingAdGroups, setLoadingAdGroups] = useState<string | null>(null);

  const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
    WEB_SITE: '파워링크',
    SHOPPING: '쇼핑검색',
    POWER_CONTENTS: '파워컨텐츠',
    BRAND_SEARCH: '브랜드검색',
    PERFORMANCE_MAX: '성과형',
    CATALOG: '카탈로그',
  };

  const CAMPAIGN_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
    WEB_SITE: { bg: '#dbeafe', color: '#1e40af' },
    SHOPPING: { bg: '#fce7f3', color: '#9d174d' },
    POWER_CONTENTS: { bg: '#d1fae5', color: '#065f46' },
    BRAND_SEARCH: { bg: '#fef3c7', color: '#92400e' },
    PERFORMANCE_MAX: { bg: '#ede9fe', color: '#5b21b6' },
    CATALOG: { bg: '#ffedd5', color: '#9a3412' },
  };

  // 존재하는 타입 목록
  const existingTypes = [...new Set(campaigns.map((c) => c.campaignType || 'WEB_SITE'))];

  // 필터 적용
  const filtered = campaigns.filter((c) => {
    if (typeFilter !== 'ALL' && (c.campaignType || 'WEB_SITE') !== typeFilter) return false;
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
    if (searchText && !c.name.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const totalCost = filtered.reduce((s, c) => s + c.cost, 0);
  const totalImpressions = filtered.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = filtered.reduce((s, c) => s + c.clicks, 0);
  const totalCtr = totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(2) : 0;
  const totalCpc = totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>캠페인별 성과</h3>
        <Link href="/campaigns" className="btn btn-outline" style={{ fontSize: '0.8125rem' }}>캠페인 관리 →</Link>
      </div>

      {/* 필터 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="캠페인 검색..." value={searchText} onChange={(e) => setSearchText(e.target.value)}
          className="input" style={{ width: '200px', padding: '0.375rem 0.75rem', fontSize: '0.8125rem' }} data-testid="campaign-search" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} data-testid="type-filter"
          style={{ padding: '0.375rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--border)', fontSize: '0.8125rem', background: 'white' }}>
          <option value="ALL">전체 유형</option>
          {existingTypes.map((t) => (<option key={t} value={t}>{CAMPAIGN_TYPE_LABELS[t] || t}</option>))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} data-testid="status-filter"
          style={{ padding: '0.375rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--border)', fontSize: '0.8125rem', background: 'white' }}>
          <option value="ALL">전체 상태</option>
          <option value="ACTIVE">ON</option>
          <option value="PAUSED">OFF</option>
        </select>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {filtered.length}/{campaigns.length}개 캠페인
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
              {['유형', '캠페인', '상태', '소진', '노출', '클릭', 'CTR', 'CPC'].map((h) => (
                <th key={h} style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500, textAlign: h === '유형' || h === '캠페인' || h === '상태' ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '2px solid var(--primary)', background: '#f0f9ff' }}>
              <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>—</td>
              <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700 }}>합계</td>
              <td style={{ padding: '0.75rem 0.5rem' }}><span className="badge badge-info">{filtered.length}개</span></td>
              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 700 }}>₩{totalCost.toLocaleString()}</td>
              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 700 }}>{totalImpressions.toLocaleString()}</td>
              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 700 }}>{totalClicks.toLocaleString()}</td>
              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 700 }}>{totalCtr}%</td>
              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 700 }}>₩{totalCpc.toLocaleString()}</td>
            </tr>
            {filtered.map((c) => {
              const typeColor = CAMPAIGN_TYPE_COLORS[c.campaignType || 'WEB_SITE'] || { bg: '#e2e8f0', color: '#475569' };
              const isExpanded = expandedCampaign === c.id;

              const handleClick = async () => {
                if (isExpanded) { setExpandedCampaign(null); return; }
                setExpandedCampaign(c.id);

                if (adGroupsData[c.id]) return; // 이미 로드됨

                if (!account?.apiKey || !account?.secretKey) return;
                setLoadingAdGroups(c.id);
                try {
                  const res = await fetch('/api/naver/adgroups', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      apiKey: account.apiKey,
                      secretKey: account.secretKey,
                      customerId: account.customerId,
                      campaignId: c.id,
                      since: dateRange?.since,
                      until: dateRange?.until,
                    }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setAdGroupsData((prev) => ({ ...prev, [c.id]: data.adGroups || [] }));
                  }
                } catch { /* 무시 */ }
                setLoadingAdGroups(null);
              };

              return (
              <React.Fragment key={c.id}>
              <tr style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isExpanded ? '#f8fafc' : undefined }} onClick={handleClick} data-testid={`campaign-row-${c.id}`}>
                <td style={{ padding: '0.75rem 0.5rem' }}>
                  <span style={{ display: 'inline-block', padding: '0.2rem 0.5rem', borderRadius: '9999px', fontSize: '0.6875rem', fontWeight: 600, background: typeColor.bg, color: typeColor.color }}>{CAMPAIGN_TYPE_LABELS[c.campaignType || 'WEB_SITE'] || c.campaignType}</span>
                </td>
                <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>
                  <span style={{ marginRight: '0.375rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{isExpanded ? '▼' : '▶'}</span>
                  {c.name}
                </td>
                <td style={{ padding: '0.75rem 0.5rem' }}><span className={`badge ${c.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>{c.status === 'ACTIVE' ? 'ON' : 'OFF'}</span></td>
                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>₩{c.cost.toLocaleString()}</td>
                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{c.impressions.toLocaleString()}</td>
                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{c.clicks.toLocaleString()}</td>
                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{c.ctr}%</td>
                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>₩{c.cpc.toLocaleString()}</td>
              </tr>
              {isExpanded && (
                loadingAdGroups === c.id ? (
                  <tr><td colSpan={8} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>광고그룹 불러오는 중...</td></tr>
                ) : (adGroupsData[c.id] || []).length > 0 ? (
                  (adGroupsData[c.id] || []).map((ag) => (
                    <tr key={ag.id} style={{ borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                      <td style={{ padding: '0.5rem 0.5rem' }}></td>
                      <td style={{ padding: '0.5rem 0.5rem', paddingLeft: '2rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        ↳ {ag.name}
                      </td>
                      <td style={{ padding: '0.5rem 0.5rem' }}><span className={`badge ${ag.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.6875rem' }}>{ag.status === 'ACTIVE' ? 'ON' : 'OFF'}</span></td>
                      <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontSize: '0.8125rem' }}>₩{ag.cost.toLocaleString()}</td>
                      <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontSize: '0.8125rem' }}>{ag.impressions.toLocaleString()}</td>
                      <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontSize: '0.8125rem' }}>{ag.clicks.toLocaleString()}</td>
                      <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontSize: '0.8125rem' }}>{ag.ctr}%</td>
                      <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontSize: '0.8125rem' }}>₩{ag.cpc.toLocaleString()}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={8} style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem', background: '#f8fafc' }}>광고그룹이 없습니다</td></tr>
                )
              )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiagnosisTab({ diagnosis }: { diagnosis: ReturnType<typeof getDemoDataForAccount>['diagnosis'] }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontWeight: 600 }}>AI 진단 리포트</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>네이버 · {diagnosis.campaignName} · {diagnosis.date}</p>
        </div>
        <span className="badge badge-danger">CRITICAL</span>
      </div>
      <div className="card" style={{ background: '#fef2f2', border: '1px solid #fecaca', marginBottom: '1.5rem' }}>
        <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>감지된 이상</p>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--danger)' }}>{diagnosis.anomaly.metric} {diagnosis.anomaly.change}</span>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>7일 평균 대비</p>
          </div>
          <div style={{ fontSize: '0.875rem' }}>
            <p>평균: {diagnosis.anomaly.avg}</p>
            <p>현재: <span style={{ fontWeight: 600, color: 'var(--danger)' }}>{diagnosis.anomaly.current}</span></p>
          </div>
        </div>
      </div>
      <h4 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>추정 원인</h4>
      {diagnosis.causes.map((cause, i) => (
        <div key={i} style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{cause.name}</span>
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--primary)' }}>{cause.probability}%</span>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{cause.detail}</p>
          <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '3px' }}>
            <div style={{ height: '100%', width: `${cause.probability}%`, background: 'var(--primary)', borderRadius: '3px' }} />
          </div>
        </div>
      ))}
      <h4 style={{ fontWeight: 600, marginTop: '1.5rem', marginBottom: '0.75rem' }}>권장 액션</h4>
      {diagnosis.suggestions.map((s, i) => (
        <div key={i} className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', padding: '0.75rem 1rem' }}>
          <span style={{ fontSize: '1.25rem' }}>{s.icon}</span>
          <span style={{ fontSize: '0.875rem' }}>{s.action}</span>
        </div>
      ))}
    </div>
  );
}

function ReportTab({ report }: { report: ReturnType<typeof getDemoDataForAccount>['report'] }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontWeight: 600 }}>일간 리포트</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{report.date}</p>
        </div>
        <span className="badge badge-success" style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}>{report.grade}</span>
      </div>
      <p style={{ fontSize: '0.9375rem', lineHeight: 1.7, marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg)', borderRadius: '0.5rem' }}>{report.summary}</p>
      <div className="grid grid-3" style={{ marginBottom: '1.5rem' }}>
        {[
          { label: '노출', value: report.metrics.impressions, delta: report.deltas.impressions },
          { label: '클릭', value: report.metrics.clicks, delta: report.deltas.clicks },
          { label: '전환', value: report.metrics.conversions, delta: report.deltas.conversions },
        ].map((m) => (
          <div key={m.label} className="card" style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{m.label}</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>{m.value}</p>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--success)' }}>{m.delta}</p>
          </div>
        ))}
      </div>
      <h4 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>오늘의 액션</h4>
      {report.actions.map((action, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', fontSize: '0.875rem' }}>
          <span style={{ color: 'var(--primary)' }}>·</span><span>{action}</span>
        </div>
      ))}
    </div>
  );
}

function DashboardLayout({ children, accounts, selectedAccountId, onSelectAccount }: {
  children: React.ReactNode;
  accounts: LinkedAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (id: string | null) => void;
}) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: '240px', background: 'white', borderRight: '1px solid var(--border)', padding: '1.5rem 1rem', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.5rem' }}>🔥 열끈</h1>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
          {[
            { href: '/dashboard', label: '📊 대시보드', active: true },
            { href: '/settings', label: '🔗 계정 연동', active: false },
          ].map((item) => (
            <Link key={item.href} href={item.href} data-testid={`nav-${item.href.slice(1)}`}
              style={{ padding: '0.625rem 0.875rem', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: item.active ? 600 : 400, background: item.active ? 'var(--bg)' : 'transparent', color: item.active ? 'var(--primary)' : 'var(--text)' }}>
              {item.label}
            </Link>
          ))}
        </nav>
        <button onClick={() => { import('next-auth/react').then(m => m.signOut({ callbackUrl: '/login' })); }}
          style={{ padding: '0.625rem 0.875rem', borderRadius: '0.5rem', fontSize: '0.875rem', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'left' }}>
          🚪 로그아웃
        </button>
      </aside>
      <main style={{ flex: 1, padding: '2rem', background: 'var(--bg)' }}>{children}</main>
    </div>
  );
}
