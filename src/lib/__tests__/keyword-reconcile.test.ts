import { describe, it, expect } from 'vitest';
import { reconcileKeywordsWithLive, type KeywordRow, type LiveCampaign } from '../keyword-reconcile';

const kw = (text: string, campaignName: string, clicks: number, impressions = clicks * 10, cost = clicks * 100): KeywordRow => ({
  id: `${text}-${campaignName}`, text, campaignName, adGroupName: '',
  clicks, impressions, cost, ctr: 0, cpc: 0,
});

const sumClicks = (rows: KeywordRow[]) => rows.reduce((s, r) => s + r.clicks, 0);

describe('reconcileKeywordsWithLive', () => {
  // 회귀 방지: 예전 보정 코드는 DB 캠페인 합계 - DB 키워드 합계를 썼는데 둘 다 같은
  // 테이블이라 차이가 항상 0 이었다. 수집이 빠진 날이 있으면 키워드 합계만 적게 나왔다.
  it('수집이 빠진 날이 있어도 합계를 실시간 KPI 와 맞춘다', () => {
    const keywords = [kw('방충망', '파워링크', 40), kw('방충망교체', '파워링크', 30)];
    const campaigns: LiveCampaign[] = [{ campaignType: 'WEB_SITE', clicks: 100, impressions: 1000, cost: 10000 }];

    const rows = reconcileKeywordsWithLive(keywords, campaigns);

    expect(sumClicks(rows)).toBe(100);
    const missing = rows.find((r) => r.id === 'missing-파워링크');
    expect(missing?.clicks).toBe(30);
    expect(missing?.text).toBe('-');
  });

  it('캠페인 유형별로 나눠서 보정한다', () => {
    const keywords = [kw('a', '파워링크', 50), kw('b', '플레이스', 10)];
    const campaigns: LiveCampaign[] = [
      { campaignType: 'WEB_SITE', clicks: 60, impressions: 600, cost: 6000 },
      { campaignType: 'PLACE', clicks: 25, impressions: 250, cost: 2500 },
    ];

    const rows = reconcileKeywordsWithLive(keywords, campaigns);

    expect(sumClicks(rows)).toBe(85);
    expect(rows.find((r) => r.id === 'missing-파워링크')?.clicks).toBe(10);
    expect(rows.find((r) => r.id === 'missing-플레이스')?.clicks).toBe(15);
  });

  it('같은 유형의 캠페인이 여러 개면 합산해서 비교한다', () => {
    const keywords = [kw('a', '파워링크', 30)];
    const campaigns: LiveCampaign[] = [
      { campaignType: 'WEB_SITE', clicks: 20, impressions: 200, cost: 2000 },
      { campaignType: 'WEB_SITE', clicks: 25, impressions: 250, cost: 2500 },
    ];

    expect(sumClicks(reconcileKeywordsWithLive(keywords, campaigns))).toBe(45);
  });

  it('DB 가 실시간보다 많거나 같으면 보정 행을 만들지 않는다', () => {
    const keywords = [kw('a', '파워링크', 100)];
    const campaigns: LiveCampaign[] = [{ campaignType: 'WEB_SITE', clicks: 100, impressions: 1000, cost: 10000 }];

    const rows = reconcileKeywordsWithLive(keywords, campaigns);

    expect(rows.some((r) => r.id.startsWith('missing-'))).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it('실시간 값이 없으면(데모·API 실패) DB 값을 건드리지 않는다', () => {
    const keywords = [kw('a', '파워링크', 30)];

    expect(reconcileKeywordsWithLive(keywords, [])).toEqual(keywords);
    expect(reconcileKeywordsWithLive(keywords, undefined)).toEqual(keywords);
    expect(reconcileKeywordsWithLive(keywords, [{ campaignType: 'WEB_SITE', clicks: 0 }])).toEqual(keywords);
  });

  it('DB 에 해당 유형이 아예 없어도(전 기간 누락) 실시간 값만큼 채운다', () => {
    const campaigns: LiveCampaign[] = [{ campaignType: 'POWER_CONTENTS', clicks: 42, impressions: 420, cost: 4200 }];

    const rows = reconcileKeywordsWithLive([], campaigns);

    expect(rows).toHaveLength(1);
    expect(rows[0].campaignName).toBe('파워컨텐츠');
    expect(rows[0].clicks).toBe(42);
    expect(rows[0].cpc).toBe(100);
  });

  it('클릭 많은 순으로 정렬한다', () => {
    const keywords = [kw('적은', '파워링크', 5), kw('많은', '파워링크', 50)];
    const campaigns: LiveCampaign[] = [{ campaignType: 'WEB_SITE', clicks: 75, impressions: 750, cost: 7500 }];

    const rows = reconcileKeywordsWithLive(keywords, campaigns);

    expect(rows.map((r) => r.clicks)).toEqual([50, 20, 5]);
  });
});
