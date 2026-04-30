import Link from 'next/link';

export default function TermsPage() {
  return (
    <div>
      <header style={{ borderBottom: '1px solid var(--border)', padding: '1rem 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)' }}>🔥 열끈 광고 분석기</Link>
        </div>
      </header>
      <main className="container" style={{ padding: '4rem 0', maxWidth: '700px' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '2rem' }}>서비스 이용약관</h2>
        <div className="card" style={{ lineHeight: 1.8, color: 'var(--text-muted)' }}>
          <h3 style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem' }}>제1조 (목적)</h3>
          <p>이 약관은 열끈 광고 분석기 서비스 이용에 관한 조건과 절차를 규정합니다.</p>
          <h3 style={{ fontWeight: 600, color: 'var(--text)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>제2조 (서비스 내용)</h3>
          <p>네이버 검색광고 데이터 수집, AI 분석, 이상 탐지, 원인 진단, 개선 제안, 캠페인 관리 기능을 제공합니다.</p>
          <h3 style={{ fontWeight: 600, color: 'var(--text)', marginTop: '1.5rem', marginBottom: '0.5rem' }}>제3조 (이용자의 의무)</h3>
          <p>이용자는 정확한 정보를 제공하고, 타인의 계정을 무단으로 사용하지 않아야 합니다.</p>
        </div>
      </main>
    </div>
  );
}
