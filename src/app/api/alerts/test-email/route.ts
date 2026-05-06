import { NextResponse } from 'next/server';

async function getAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken!,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  return data.access_token as string;
}

function createRawEmail(to: string, from: string, subject: string, html: string): string {
  const boundary = 'boundary_' + Date.now();
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
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
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

export async function GET() {
  const gmailUser = process.env.GMAIL_USER;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken || !gmailUser) {
    return NextResponse.json({ error: 'Gmail OAuth 환경변수가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: 'Access token 발급 실패' }, { status: 500 });
    }

    const html = `
      <h2>🎉 이메일 알림 테스트 성공!</h2>
      <p>이 메일이 도착했다면 Gmail API 설정이 정상입니다.</p>
      <p>매일 오전 9시에 비즈머니 잔액 리포트가 이 주소로 발송됩니다.</p>
      <hr>
      <p style="color: #6b7280; font-size: 0.875rem;">발송 시간: ${new Date().toLocaleString('ko-KR')}</p>
    `;

    const raw = createRawEmail(gmailUser, `열끈 알림 <${gmailUser}>`, '✅ [열끈] 테스트 메일 - 이메일 알림 정상 작동', html);

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Gmail API 오류: ${err}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `테스트 메일 발송 완료 → ${gmailUser}` });
  } catch (error) {
    console.error('Test email error:', error);
    return NextResponse.json({ error: `메일 발송 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}` }, { status: 500 });
  }
}
