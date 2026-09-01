import { NaverAdsService } from '@/services/naver-ads.service';

// 조회 실패는 bizmoney: null 로 표시한다.
// 예전에는 -1을 실패 표시로 썼는데, 비즈머니 잔액은 실제로 음수가 될 수 있어서
// 잔액이 마이너스로 떨어진(=광고가 멈춘) 계정이 "조회 실패"로 분류돼 알림에서 묻혔다.
export interface BizmoneyResult {
  accountName: string;
  customerId: string;
  bizmoney: number | null;
  budgetLock: boolean;
  lastChargeDate: string;
  error?: string;
}

interface AccountCredentials {
  accountName: string;
  apiKey: string;
  secretKey: string;
  customerId: string;
}

const LOW_BALANCE_THRESHOLD = 10000;

export async function collectBizmoneyResults(accounts: AccountCredentials[]): Promise<BizmoneyResult[]> {
  const results: BizmoneyResult[] = [];

  for (const account of accounts) {
    const base = { accountName: account.accountName, customerId: account.customerId };
    try {
      const naverAds = new NaverAdsService({
        apiKey: account.apiKey,
        secretKey: account.secretKey,
        customerId: account.customerId,
      });
      const result = await naverAds.getBizmoney();

      if (!result.success || !result.data) {
        console.error(`[Bizmoney] ${account.accountName}: 조회 실패`, result.error);
        results.push({ ...base, bizmoney: null, budgetLock: false, lastChargeDate: '', error: result.error });
        continue;
      }

      const data = result.data as Record<string, unknown>;
      const raw = data?.bizmoney ?? data?.balance ?? data?.amount;
      const bizmoney = Number(raw);
      if (raw === undefined || raw === null || !Number.isFinite(bizmoney)) {
        results.push({ ...base, bizmoney: null, budgetLock: false, lastChargeDate: '', error: '잔액 필드 없음' });
        continue;
      }

      // 마지막 충전일 조회
      let lastChargeDate = '';
      try {
        const chargeResult = await naverAds.getBizmoneyCharges();
        if (chargeResult.success && Array.isArray(chargeResult.data) && chargeResult.data.length > 0) {
          const charges = chargeResult.data as Record<string, unknown>[];
          let latestDt = 0;
          for (const charge of charges) {
            const dt = Number(charge.statDt || charge.chargeDt || charge.date || 0);
            if (dt > latestDt) latestDt = dt;
          }
          if (latestDt > 0) lastChargeDate = new Date(latestDt).toISOString().slice(0, 10);
        }
      } catch { /* 무시 */ }

      results.push({ ...base, bizmoney, budgetLock: Boolean(data?.budgetLock), lastChargeDate });
      console.log(`[Bizmoney] ${account.accountName}: ₩${Math.floor(bizmoney).toLocaleString()}, 마지막 충전: ${lastChargeDate || '없음'}`);
    } catch (error) {
      console.error(`[Bizmoney] ${account.accountName}: 조회 오류`, error);
      results.push({
        ...base,
        bizmoney: null,
        budgetLock: false,
        lastChargeDate: '',
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      });
    }
  }

  return results;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function balanceRow(r: BizmoneyResult, highlight: boolean): string {
  const amount = Math.floor(r.bizmoney as number).toLocaleString();
  // 잔액이 0 이하로 떨어지면 네이버가 광고를 자동 정지시킨다(budgetLock).
  const stopped = r.budgetLock || (r.bizmoney as number) <= 0;
  const nameCell = `${escapeHtml(r.accountName)}${stopped ? ' <span style="color:#dc2626; font-size:12px;">(광고 정지)</span>' : ''}`;
  const amountStyle = highlight ? 'color: #dc2626; font-weight: bold;' : '';
  return `<tr><td style="padding: 8px; border: 1px solid #ddd;${highlight ? ' font-weight: bold;' : ''}">${nameCell}</td><td style="padding: 8px; border: 1px solid #ddd; text-align: right; ${amountStyle}">₩${amount}</td><td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${r.lastChargeDate ? r.lastChargeDate.replace(/-/g, '.') : '-'}</td></tr>`;
}

function balanceTable(rows: BizmoneyResult[], headerBg: string, highlight: boolean): string {
  let html = `<table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">`;
  html += `<tr style="background: ${headerBg};"><th style="padding: 8px; border: 1px solid #ddd; text-align: left;">계정명</th><th style="padding: 8px; border: 1px solid #ddd; text-align: right;">잔액</th><th style="padding: 8px; border: 1px solid #ddd; text-align: right;">마지막 충전</th></tr>`;
  for (const r of rows) html += balanceRow(r, highlight);
  html += `</table>`;
  return html;
}

export function buildBizmoneyReport(results: BizmoneyResult[]): { subject: string; html: string } {
  const fetched = results.filter((r) => r.bizmoney !== null);
  const lowBalance = fetched
    .filter((r) => (r.bizmoney as number) <= LOW_BALANCE_THRESHOLD)
    .sort((a, b) => (a.bizmoney as number) - (b.bizmoney as number));
  const normal = fetched.filter((r) => (r.bizmoney as number) > LOW_BALANCE_THRESHOLD);
  const failed = results.filter((r) => r.bizmoney === null);

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  let html = `<h2>📊 비즈머니 잔액 리포트 (${today})</h2>`;

  if (lowBalance.length > 0) {
    html += `<h3 style="color: #dc2626;">⚠️ 잔액 부족 (1만원 이하) - ${lowBalance.length}개 계정</h3>`;
    html += balanceTable(lowBalance, '#fef2f2', true);
  }

  if (normal.length > 0) {
    html += `<h3 style="color: #16a34a;">✅ 정상 - ${normal.length}개 계정</h3>`;
    html += balanceTable(normal, '#f0fdf4', false);
  }

  if (failed.length > 0) {
    html += `<h3 style="color: #9ca3af;">❓ 조회 실패 - ${failed.length}개 계정</h3>`;
    html += `<table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">`;
    html += `<tr style="background: #f9fafb;"><th style="padding: 8px; border: 1px solid #ddd; text-align: left;">계정명</th><th style="padding: 8px; border: 1px solid #ddd; text-align: left;">사유</th></tr>`;
    for (const r of failed) {
      html += `<tr><td style="padding: 8px; border: 1px solid #ddd; color: #6b7280;">${escapeHtml(r.accountName)}</td><td style="padding: 8px; border: 1px solid #ddd; color: #6b7280;">${escapeHtml(r.error || '알 수 없는 오류')}</td></tr>`;
    }
    html += `</table>`;
  }

  const subject = lowBalance.length > 0
    ? `⚠️ [열끈] 비즈머니 부족 ${lowBalance.length}개 계정 (${today})`
    : `✅ [열끈] 비즈머니 잔액 리포트 (${today})`;

  return { subject, html };
}
