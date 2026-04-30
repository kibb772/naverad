import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId, adGroupIds, since, until } = await req.json();

    if (!apiKey || !secretKey || !customerId || !adGroupIds?.length) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
    const timeRange = { since: since || fmtDate(yesterday), until: until || fmtDate(today) };
    const fields = ['impCnt', 'clkCnt', 'salesAmt'];

    // 1단계: 모든 광고그룹에서 키워드 목록 병렬로 가져오기
    const kwListResults = await Promise.all(
      adGroupIds.map(async (agId: string) => {
        try {
          const kwResult = await naverAds.getKeywords(agId);
          if (kwResult.success && Array.isArray(kwResult.data)) {
            return (kwResult.data as Record<string, unknown>[]).map((kw) => ({
              id: (kw.nccKeywordId || kw.keywordId) as string,
              text: (kw.keyword || kw.text || kw.name) as string,
            }));
          }
        } catch { /* 무시 */ }
        return [];
      })
    );

    const allKwList = kwListResults.flat();
    if (allKwList.length === 0) {
      return NextResponse.json({ keywords: [] });
    }

    // 2단계: 키워드 통계를 20개씩 병렬로 가져오기
    const statsMap: Record<string, { impCnt: number; clkCnt: number; salesAmt: number }> = {};
    const BATCH = 20;

    for (let i = 0; i < allKwList.length; i += BATCH) {
      const batch = allKwList.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (kw) => {
          try {
            const r = await naverAds.getStats({ id: kw.id, fields, timeRange });
            if (r.success && r.data) {
              const rawData = r.data as Record<string, unknown>;
              let rows: Record<string, unknown>[] = [];
              if (Array.isArray(rawData)) rows = rawData;
              else if (rawData.data && Array.isArray(rawData.data)) rows = rawData.data;

              let impCnt = 0, clkCnt = 0, salesAmt = 0;
              for (const row of rows) {
                const s = (row.summary || row) as Record<string, number>;
                impCnt += s.impCnt || 0;
                clkCnt += s.clkCnt || 0;
                salesAmt += s.salesAmt || 0;
              }
              return { id: kw.id, impCnt, clkCnt, salesAmt };
            }
          } catch { /* 무시 */ }
          return { id: kw.id, impCnt: 0, clkCnt: 0, salesAmt: 0 };
        })
      );
      for (const r of results) statsMap[r.id] = r;
    }

    // 3단계: 합치기 + 클릭 순 정렬
    const allKeywords = allKwList.map((kw) => {
      const s = statsMap[kw.id] || { impCnt: 0, clkCnt: 0, salesAmt: 0 };
      return {
        id: kw.id,
        text: kw.text,
        cost: s.salesAmt,
        impressions: s.impCnt,
        clicks: s.clkCnt,
        ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0,
        cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0,
      };
    });

    allKeywords.sort((a, b) => b.clicks - a.clicks);
    return NextResponse.json({ keywords: allKeywords.slice(0, 30) });
  } catch (error) {
    console.error('Naver keywords error:', error);
    return NextResponse.json({ error: '키워드 데이터를 가져오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
