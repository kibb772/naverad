import Link from 'next/link';

export default function HomePage() {
  return (
    <div>
      <header style={{ borderBottom: '1px solid var(--border)', padding: '1rem 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>🔥 열끈 광고 분석기</h1>
          <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Link href="/services">서비스 소개</Link>
            <Link href="/about">회사 소개</Link>
            <Link href="/login" className="btn btn-outline" data-testid="nav-login-button">로그인</Link>
            <Link href="/signup" className="btn btn-primary" data-testid="nav-signup-button">무료로 시작하기</Link>
          </nav>
        </div>
      </header>

      <main>
        <section style={{ padding: '5rem 0', textAlign: 'center' }}>
          <div className="container">
            <p style={{ color: 'var(--primary)', fontWeight: 600, marginBottom: '0.5rem' }}>네이버 검색광고 전용</p>
            <h2 style={{ fontSize: '2.5rem', fontWeight: 800, lineHeight: 1.2, marginBottom: '1.5rem' }}>
              광고 성과를 아는 AI가<br />이상을 감지하고<br />원인을 진단합니다.
            </h2>
            <p style={{ fontSize: '1.125rem', color: 'var(--text-muted)', maxWidth: '600px', margin: '0 auto 2rem' }}>
              매일 네이버 검색광고 대시보드 확인, 엑셀 취합, 원인 추측하는 사이클.<br />
              이제 계정만 연결하면 끝납니다.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <Link href="/signup" className="btn btn-primary" style={{ padding: '0.875rem 2rem', fontSize: '1rem' }} data-testid="hero-signup-button">
                무료로 시작하기
              </Link>
              <Link href="/services" className="btn btn-outline" style={{ padding: '0.875rem 2rem', fontSize: '1rem' }}>
                서비스 자세히 보기
              </Link>
            </div>
          </div>
        </section>

        <section style={{ padding: '4rem 0', background: 'white' }}>
          <div className="container">
            <h3 style={{ fontSize: '1.75rem', fontWeight: 700, textAlign: 'center', marginBottom: '3rem' }}>
              핵심 기능
            </h3>
            <div className="grid grid-3">
              {[
                { icon: '📊', title: '통합 대시보드', desc: '네이버 검색광고 캠페인을 한 화면에서 한눈에 확인합니다.' },
                { icon: '🚨', title: 'AI 이상 탐지', desc: 'CTR, CPC, 전환율 급변을 AI가 24시간 모니터링합니다.' },
                { icon: '🔍', title: 'AI 원인 진단', desc: '이상 감지 시 데이터 기반으로 원인을 자동 분석합니다.' },
                { icon: '💡', title: 'AI 개선 제안', desc: '입찰가 조정, 키워드 관리 등 구체적 액션을 제안합니다.' },
                { icon: '🎛️', title: '캠페인 직접 관리', desc: '캠페인/광고그룹/키워드를 직접 켜고, 끄고, 조절합니다.' },
                { icon: '📋', title: 'AI 리포트', desc: '매일 아침 성과 요약과 액션 플랜을 자동 생성합니다.' },
              ].map((f) => (
                <div key={f.title} className="card" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{f.icon}</div>
                  <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{f.title}</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{ padding: '4rem 0', textAlign: 'center' }}>
          <div className="container">
            <h3 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '1rem' }}>
              지금 연결하고 내일 아침 첫 리포트를 받아보세요.
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
              API 키 입력 한 번이면 연결 끝. 무료로 바로 시작할 수 있습니다.
            </p>
            <Link href="/signup" className="btn btn-primary" style={{ padding: '0.875rem 2rem', fontSize: '1rem' }}>
              무료로 시작하기
            </Link>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontWeight: 600, color: 'var(--text)' }}>열끈 광고 분석기</p>
            <p>AI가 네이버 검색광고를 자동 분석해 이상 탐지, 원인 진단, 개선안을 매일 아침 전달합니다.</p>
          </div>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <Link href="/privacy">개인정보 처리방침</Link>
            <Link href="/terms">서비스 이용약관</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
