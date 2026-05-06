import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function GET() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const gmailUser = process.env.GMAIL_USER;

  if (!clientId || !clientSecret || !refreshToken || !gmailUser) {
    return NextResponse.json({ error: 'Gmail OAuth 환경변수가 설정되지 않았습니다. (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_USER)' }, { status: 500 });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: gmailUser,
        clientId,
        clientSecret,
        refreshToken,
      },
    });

    await transporter.sendMail({
      from: `열끈 알림 <${gmailUser}>`,
      to: gmailUser,
      subject: '✅ [열끈] 테스트 메일 - 이메일 알림 정상 작동',
      html: `
        <h2>🎉 이메일 알림 테스트 성공!</h2>
        <p>이 메일이 도착했다면 Gmail API 설정이 정상입니다.</p>
        <p>매일 오전 9시에 비즈머니 잔액 리포트가 이 주소로 발송됩니다.</p>
        <hr>
        <p style="color: #6b7280; font-size: 0.875rem;">발송 시간: ${new Date().toLocaleString('ko-KR')}</p>
      `,
    });

    return NextResponse.json({ success: true, message: `테스트 메일 발송 완료 → ${gmailUser}` });
  } catch (error) {
    console.error('Test email error:', error);
    return NextResponse.json({ error: `메일 발송 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}` }, { status: 500 });
  }
}
