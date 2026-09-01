import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { collectBizmoneyResults, buildBizmoneyReport } from '@/lib/bizmoney-report';

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
    // 모든 활성 계정의 비즈머니 조회 (스케줄러와 동일한 로직 사용)
    const accounts = await prisma.naverAdsAccount.findMany({ where: { isActive: true } });
    const results = await collectBizmoneyResults(accounts);
    const { subject, html } = buildBizmoneyReport(results);

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

    return NextResponse.json({
      success: true,
      message: `비즈머니 리포트 발송 완료 → ${gmailUser}`,
      accounts: results.length,
      failed: results.filter((r) => r.bizmoney === null).length,
    });
  } catch (error) {
    console.error('Bizmoney report error:', error);
    return NextResponse.json({ error: `발송 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}` }, { status: 500 });
  }
}
