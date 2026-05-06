import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function GET() {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const alertTo = process.env.ALERT_EMAIL_TO || smtpUser;

  if (!smtpUser || !smtpPass) {
    return NextResponse.json({ error: 'SMTP_USER 또는 SMTP_PASS가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: `열끈 알림 <${smtpUser}>`,
      to: alertTo,
      subject: '✅ [열끈] 테스트 메일 - 이메일 알림 정상 작동',
      html: `
        <h2>🎉 이메일 알림 테스트 성공!</h2>
        <p>이 메일이 도착했다면 Gmail SMTP 설정이 정상입니다.</p>
        <p>매일 오전 9시에 비즈머니 잔액 리포트가 이 주소로 발송됩니다.</p>
        <hr>
        <p style="color: #6b7280; font-size: 0.875rem;">발송 시간: ${new Date().toLocaleString('ko-KR')}</p>
      `,
    });

    return NextResponse.json({ success: true, message: `테스트 메일 발송 완료 → ${alertTo}` });
  } catch (error) {
    console.error('Test email error:', error);
    return NextResponse.json({ error: `메일 발송 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}` }, { status: 500 });
  }
}
