import Link from 'next/link';

export default function AboutPage() {
  return (
    <div>
      <header style={{ borderBottom: '1px solid var(--border)', padding: '1rem 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)' }}>🔥 열끈 광고 분석기</Link>
          <Link href="/signup" className="btn btn-primary">무료로 시작하기</Link>
        </div>
      </header>
      <main className="container" style={{ padding: '4rem 0', maxWidth: '700px' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, textAlign: 'center', marginBottom: '2rem' }}>회사 소개</h2>
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontWeight: 600, marginBottom: '1rem' }}>열끈 광고 분석기</h3>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.8 }}>
            네이버 검색광고를 운영하는 소상공인과 마케터를 위해 만들어진 AI 기반 광고 성과 분석 서비스입니다.
            매일 반복되는 수동 분석 작업을 자동화하고, 데이터 기반의 의사결정을 돕습니다.
          </p>
        </div>
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: '1rem' }}>핵심 가치</h3>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <li>📊 데이터 기반 의사결정 — 감이 아닌 데이터로 광고 성과를 판단합니다.</li>
            <li>🎯 누구나 쉽게 — 전문 마케터가 아니어도 쉽게 사용할 수 있습니다.</li>
            <li>🔔 놓치지 않는 알림 — 이상이 감지되면 즉시 알려드립니다.</li>
            <li>⚡ 완전 자동화 — 연동 한 번이면 분석부터 리포트까지 모두 자동입니다.</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
