import { describe, it, expect } from 'vitest';
import { buildBizmoneyReport, type BizmoneyResult } from '../bizmoney-report';

// 회귀 방지: 예전에는 조회 실패를 bizmoney = -1 로 표시했는데,
// 비즈머니 잔액은 실제로 음수가 될 수 있어서 잔액이 마이너스로 떨어진
// (= 광고가 이미 멈춘) 계정이 "조회 실패"로 분류돼 알림에서 묻혔다.
const results: BizmoneyResult[] = [
  { accountName: '모드도어', customerId: '3296142', bizmoney: -40.32, budgetLock: true, lastChargeDate: '2026-07-02' },
  { accountName: '스테이빌더', customerId: '4480481', bizmoney: -373.25, budgetLock: true, lastChargeDate: '2026-08-11' },
  { accountName: '포춘디자인', customerId: '4109986', bizmoney: 216.89, budgetLock: true, lastChargeDate: '' },
  { accountName: '화물대장', customerId: '4406110', bizmoney: 657016.13, budgetLock: false, lastChargeDate: '2026-08-30' },
  { accountName: '조회안됨', customerId: '999', bizmoney: null, budgetLock: false, lastChargeDate: '', error: 'API Error 401: invalid' },
];

describe('buildBizmoneyReport', () => {
  it('마이너스 잔액을 조회 실패가 아닌 잔액 부족으로 분류한다', () => {
    const { subject, html } = buildBizmoneyReport(results);
    const lowSection = html.split('✅ 정상')[0];

    expect(subject).toContain('비즈머니 부족 3개 계정');
    expect(html).toContain('잔액 부족 (1만원 이하) - 3개 계정');
    expect(lowSection).toContain('모드도어');
    expect(lowSection).toContain('스테이빌더');
    expect(lowSection).toContain('₩-374');
  });

  it('잔액이 0 이하이거나 budgetLock이면 광고 정지로 표시한다', () => {
    const { html } = buildBizmoneyReport(results);
    const lowSection = html.split('✅ 정상')[0];
    expect(lowSection).toContain('광고 정지');
    // 잔액 정상 계정에는 정지 표시가 붙지 않는다
    const normalSection = html.split('✅ 정상')[1].split('❓ 조회 실패')[0];
    expect(normalSection).not.toContain('광고 정지');
  });

  it('실제 조회 실패만 실패 목록에 넣고 사유를 함께 보여준다', () => {
    const { html } = buildBizmoneyReport(results);
    expect(html).toContain('조회 실패 - 1개 계정');
    expect(html).toContain('조회안됨');
    expect(html).toContain('API Error 401: invalid');
  });

  it('전 계정 정상이면 부족 알림 제목을 쓰지 않는다', () => {
    const { subject, html } = buildBizmoneyReport([results[3]]);
    expect(subject).toContain('비즈머니 잔액 리포트');
    expect(html).not.toContain('잔액 부족');
    expect(html).not.toContain('조회 실패');
  });
});
