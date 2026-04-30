import Link from 'next/link';

export default function ServicesPage() {
  return (
    <div>
      <header style={{ borderBottom: '1px solid var(--border)', padding: '1rem 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)' }}>🔥 열끈 광고 분석기</Link>
          <Link href="/signup" className="btn btn-primary">무료로 시작하기</Link>
        </div>
      </header>
      <main className="container" style={{ padding: '4rem 0' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, textAlign: 'center', marginBottom: '1rem' }}>
          열끈 광고 분석기가 하는 일
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '3rem' }}>
          네이버 검색광고 성과 관리에 필요한 모든 것을 AI가 자동으로 처리합니다.
        </p>
        <div className="grid grid-2" style={{ gap: '2rem' }}>
          {[
            { title: '네이버 검색광고 통합 분석', desc: '캠페인/광고그룹/키워드 단위의 상세 성과 데이터를 자동으로 수집하고 한 대시보드에서 확인합니다.' },
            { title: 'AI 이상 탐지', desc: 'CTR/CPC/전환율 등 핵심 지표 급변을 24시간 모니터링하여 즉시 감지합니다. 위험도에 따라 주의/경고/위험으로 분류합니다.' },
            { title: 'AI 원인 진단', desc: '이상 감지 시 키워드 경쟁 심화, 소재 피로도, 시즌 영향 등 원인을 자동 분석하고 기여도를 표시합니다.' },
            { title: 'AI 개선 제안', desc: '입찰가 조정, 키워드 일시중지, 예산 재배분 등 구체적인 액션 아이템을 우선순위별로 제안합니다.' },
            { title: '캠페인 직접 관리', desc: '캠페인/광고그룹/키워드를 직접 ON/OFF하고, 예산과 입찰가를 조절하고, 새 캠페인을 만들 수 있습니다.' },
            { title: 'AI 리포트 & 알림', desc: '매일 아침 성과 요약과 액션 플랜을 자동 생성합니다. 대시보드, 이메일, 카카오톡으로 알림을 받을 수 있습니다.' },
          ].map((s) => (
            <div key={s.title} className="card">
              <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{s.title}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
