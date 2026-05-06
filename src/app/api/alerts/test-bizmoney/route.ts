import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { NaverAdsService } from '@/services/naver-ads.service';

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  return data.access_token as string;
}

export async function GET() {
  const gmailUser = process.env.GMAIL_USER;
  if (!gmailUser || !process.env.GMAIL_CLIENT_ID) {
    return NextResponse.json({ error: 'Gmail OAuth 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    // 모든 활성 계정의 비즈머니 조회
    const accounts = await prisma.naverAdsAccount.findMany({ where: { isActive: true } });
    const results: { accountName: string; customerId: string; bizmoney: number }[] = [];

    for (const account of accounts) {
      try {
        const naverAds = new NaverAdsService({
          apiKey: account.apiKey,
          secretKey: account.secretKey,
          customerId: account.customerId,
        });
        const result = await naverAds.getBizmoney();
        if (result.success && result.data) {
          const data = result.data as Record<string, unknown>;
          const bizmoney = (data?.bizmoney ?? data?.balance ?? data?.amount ?? 0) as number;
          results.push({ accountName: account.accountName, customerId: account.customerId, bizmoney });
        } else {
          results.push({ accountName: account.accountName, customerId: account.customerId, bizmoney: -1 });
        }
      } catch {
        results.push({ accountName: account.accountName, customerId: account.customerId, bizmoney: -1 });
      }
    }

    // 이메일 HTML 생성
    const lowBalance = results.filter((r) => r.bizmoney >= 0 && r.bizmoney <= 10000);
    const normal = results.filter((r) => r.bizmoney > 10000);
    const failed = results.filter((r) => r.bizmoney < 0);
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    let html = `<h2>📊 비즈머니 잔액 리포트 (${today})</h2>`;

    if (lowBalance.length > 0) {
      html += `<h3 style="color: #dc2626;">⚠️ 잔액 부족 (1만원 이하) - ${lowBalance.length}개 계정</h3>`;
      html += `<table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">`;
      html += `<tr style="background: #fef2f2;"><th style="padding: 8px; border: 1px solid #ddd; text-align: left;">계정명</th><th style="padding: 8px; border: 1px solid #ddd; text-align: right;">잔액</th></tr>`;
      for (const r of lowBalance) {
        html += `<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${r.accountName}</td><td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: #dc2626; font-weight: bold;">₩${Math.floor(r.bizmoney).toLocaleString()}</td></tr>`;
      }
      html += `</table>`;
    }

    if (normal.length > 0) {
      html += `<h3 style="color: #16a34a;">✅ 정상 - ${normal.length}개 계정</h3>`;
      html += `<table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">`;
      html += `<tr style="background: #f0fdf4;"><th style="padding: 8px; border: 1px solid #ddd; text-align: left;">계정명</th><th style="padding: 8px; border: 1px solid #ddd; text-align: right;">잔액</th></tr>`;
      for (const r of normal) {
        html += `<tr><td style="padding: 8px; border: 1px solid #ddd;">${r.accountName}</td><td style="padding: 8px; border: 1px solid #ddd; text-align: right;">₩${Math.floor(r.bizmoney).toLocaleString()}</td></tr>`;
      }
      html += `</table>`;
    }

    if (failed.length > 0) {
      html += `<h3 style="color: #9ca3af;">❓ 조회 실패 - ${failed.length}개 계정</h3>`;
      html += `<p style="color: #6b7280;">${failed.map((r) => r.accountName).join(', ')}</p>`;
    }

    const subject = lowBalance.length > 0
      ? `⚠️ [열끈] 비즈머니 부족 ${lowBalance.length}개 계정 (${today})`
      : `✅ [열끈] 비즈머니 잔액 리포트 (${today})`;

    // Gmail API로 발송
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: 'Access token 발급 실패' }, { status: 500 });
    }

    const boundary = 'boundary_' + Date.now();
    const lines = [
      `From: 열끈 알림 <${gmailUser}>`,
      `To: ${gmailUser}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(html).toString('base64'),
      `--${boundary}--`,
    ];
    const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      return NextResponse.json({ error: `Gmail API 오류: ${err}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `비즈머니 리포트 발송 완료 → ${gmailUser}`, accounts: results.length });
  } catch (error) {
    console.error('Bizmoney report error:', error);
    return NextResponse.json({ error: `발송 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}` }, { status: 500 });
  }
}
