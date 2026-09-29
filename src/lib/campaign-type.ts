// 네이버 캠페인 유형 코드 → 화면/DB 표기 라벨.
// 이 매핑이 sync 라우트와 scheduler 에 3벌 복사돼 있었고 각각 조금씩 달랐다
// (PLACE 의 '7' 을 한 곳만 처리하는 등). KeywordDailyStat.campaignName 에 저장되는 값이자
// 대시보드가 실시간 캠페인과 DB 를 맞춰보는 기준이라, 한 곳에서만 정의한다.
export function getCampaignTypeLabel(campType: string | undefined | null): string {
  const t = String(campType ?? '');
  if (t === 'WEB_SITE' || t === '1') return '파워링크';
  if (t === 'SHOPPING' || t === '2') return '쇼핑검색';
  if (t === 'POWER_CONTENTS' || t === '3') return '파워컨텐츠';
  if (t === 'BRAND_SEARCH' || t === '4') return '브랜드검색';
  if (t === 'PLACE' || t === '6' || t === '7') return '플레이스';
  return t;
}
