import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div>
      <header style={{ borderBottom: '1px solid var(--border)', padding: '1rem 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)' }}>🔥 열끈 광고 분석기</Link>
        </div>
      </header>
      <main className="container" style={{ padding: '4rem 0', maxWidth: '700px' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '2rem' }}>개인정보 처리방침</h2>
        <div className="card" style={{ lineHeight: 1.8, color: 'var(--text-muted)' }}>
          <p>열끈 광고 분석기(이하 &quot;서비스&quot;)는 이용자의 개인정보를 중요시하며, 개인정보보호법을 준수합니다.</p>
          <h3 style={{ fontWeight: 600, color: 'var(--text)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>1. 수집하는 개인정보</h3>
          <p>이메일, 이름, 전화번호, 카카오 계정 정보, 네이버 검색광고 API 인증 정보</p>
          <h3 style={{ fontWeight: 600, color: 'var(--text)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>2. 수집 목적</h3>
          <p>서비스 제공, 광고 데이터 분석, AI 리포트 생성, 알림 발송</p>
          <h3 style={{ fontWeight: 600, color: 'var(--text)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>3. 보유 기간</h3>
          <p>회원 탈퇴 시 즉시 파기. 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관.</p>
        </div>
      </main>
    </div>
  );
}
