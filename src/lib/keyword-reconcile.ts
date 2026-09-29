import { getCampaignTypeLabel } from './campaign-type';

export interface KeywordRow {
  id: string;
  text: string;
  campaignName?: string;
  adGroupName?: string;
  cost: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
}

export interface LiveCampaign {
  campaignType?: string;
  clicks: number;
  impressions?: number;
  cost?: number;
}

/**
 * 키워드 표(DB 캐시)의 합계를 상단 KPI(네이버 실시간 API)와 맞춘다.
 *
 * 두 영역이 서로 다른 출처를 보기 때문에, 수집이 빠진 날이 있으면 키워드 합계만
 * 조용히 적게 나왔다. 예전 보정 코드는 DB 캠페인 합계에서 DB 키워드 합계를 빼서
 * 차이를 구했는데 둘 다 같은 테이블이라 차이가 항상 0 이었다 — 즉 보정이 없었다.
 *
 * 실시간 캠페인 실적을 기준으로 모자란 만큼을 캠페인 유형별 '-' 행으로 채운다.
 * 실시간 값이 없으면(데모 모드·API 실패) 기준이 없으므로 DB 값을 그대로 둔다.
 */
export function reconcileKeywordsWithLive(keywords: KeywordRow[], campaigns: LiveCampaign[] | undefined): KeywordRow[] {
  const liveByType: Record<string, { clicks: number; impressions: number; cost: number }> = {};
  for (const c of campaigns || []) {
    const label = getCampaignTypeLabel(c.campaignType) || '';
    if (!liveByType[label]) liveByType[label] = { clicks: 0, impressions: 0, cost: 0 };
    liveByType[label].clicks += c.clicks || 0;
    liveByType[label].impressions += c.impressions || 0;
    liveByType[label].cost += c.cost || 0;
  }

  const hasLiveTotals = Object.values(liveByType).some((t) => t.clicks > 0);
  if (!hasLiveTotals) return [...keywords];

  const dbByType: Record<string, { clicks: number; impressions: number; cost: number }> = {};
  for (const kw of keywords) {
    const type = kw.campaignName || '';
    if (!dbByType[type]) dbByType[type] = { clicks: 0, impressions: 0, cost: 0 };
    dbByType[type].clicks += kw.clicks;
    dbByType[type].impressions += kw.impressions;
    dbByType[type].cost += kw.cost;
  }

  const result = [...keywords];
  for (const [type, live] of Object.entries(liveByType)) {
    const db = dbByType[type] || { clicks: 0, impressions: 0, cost: 0 };
    const diffClicks = live.clicks - db.clicks;
    if (diffClicks <= 0) continue;

    const diffImpressions = Math.max(0, live.impressions - db.impressions);
    const diffCost = Math.max(0, live.cost - db.cost);
    result.push({
      id: `missing-${type}`,
      text: '-',
      campaignName: type,
      adGroupName: '',
      clicks: diffClicks,
      impressions: diffImpressions,
      cost: diffCost,
      ctr: diffImpressions > 0 ? +((diffClicks / diffImpressions) * 100).toFixed(2) : 0,
      cpc: Math.round(diffCost / diffClicks),
    });
  }

  result.sort((a, b) => b.clicks - a.clicks);
  return result;
}
