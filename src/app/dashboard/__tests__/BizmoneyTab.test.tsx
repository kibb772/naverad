import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import BizmoneyTab from '../BizmoneyTab';

// 실제 API 응답과 같은 모양 (운영 데이터 기준)
const payload = {
  lowBalance: [
    { accountName: '뽀득브라더스', customerId: '1', bizmoney: -1056.4, budgetLock: true, lastChargeDate: '2026-09-21' },
    { accountName: '포춘디자인', customerId: '2', bizmoney: 216.89, budgetLock: true, lastChargeDate: '2026-07-26' },
  ],
  normal: [
    { accountName: '화물대장', customerId: '3', bizmoney: 632104.1, budgetLock: false, lastChargeDate: '2026-09-18' },
  ],
  failed: [
    { accountName: '조회안됨', customerId: '4', bizmoney: null, budgetLock: false, lastChargeDate: '', error: 'API Error 401' },
  ],
  threshold: 10000,
  totalAccounts: 4,
  fetchedAt: '2026-09-29T05:00:00.000Z',
  cached: false,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
});

describe('BizmoneyTab', () => {
  it('잔액 부족 / 정상 / 조회 실패를 나눠서 보여준다', async () => {
    render(<BizmoneyTab />);

    await waitFor(() => expect(screen.getByText(/잔액 부족/)).toBeInTheDocument());
    expect(screen.getByText(/잔액 부족 \(10,000원 이하\) - 2개 계정/)).toBeInTheDocument();
    expect(screen.getByText(/정상 - 1개 계정/)).toBeInTheDocument();
    expect(screen.getByText(/조회 실패 - 1개 계정/)).toBeInTheDocument();
  });

  it('금액을 원화로 표시하고 마이너스도 그대로 보여준다', async () => {
    render(<BizmoneyTab />);

    await waitFor(() => expect(screen.getByText('₩-1,057')).toBeInTheDocument());
    expect(screen.getByText('₩216')).toBeInTheDocument();
    expect(screen.getByText('₩632,104')).toBeInTheDocument();
  });

  it('잔액이 없거나 budgetLock 이면 광고 정지로 표시한다', async () => {
    render(<BizmoneyTab />);

    await waitFor(() => expect(screen.getAllByText('(광고 정지)')).toHaveLength(2));
  });

  it('조회 실패는 사유를 함께 보여준다', async () => {
    render(<BizmoneyTab />);

    await waitFor(() => expect(screen.getByText('API Error 401')).toBeInTheDocument());
  });

  it('조회 실패 항목이 없으면 실패 구역을 그리지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...payload, failed: [] }) }));
    render(<BizmoneyTab />);

    await waitFor(() => expect(screen.getByText(/정상 - 1개 계정/)).toBeInTheDocument());
    expect(screen.queryByText(/조회 실패/)).not.toBeInTheDocument();
  });

  it('조회가 실패하면 오류를 화면에 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '인증이 필요합니다.' }) }));
    render(<BizmoneyTab />);

    await waitFor(() => expect(screen.getByText('인증이 필요합니다.')).toBeInTheDocument());
  });
});
