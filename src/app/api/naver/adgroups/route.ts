import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId, campaignId, since, until } = await req.json();

    if (!apiKey || !secretKey || !customerId || !campaignId) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });

    // 1. 광고그룹 목록 가져오기
    const agResult = await naverAds.getAdGroups(campaignId);
    if (!agResult.success || !Array.isArray(agResult.data)) {
      return NextResponse.json({ adGroups: [] });
    }

    const adGroups = agResult.data as Record<string, unknown>[];

    // 2. 각 광고그룹별 통계 가져오기
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

    const fields = ['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc', 'ccnt'];
    const timeRange = { since: since || fmtDate(yesterday), until: until || fmtDate(today) };

    const enriched = await Promise.all(
      adGroups.map(async (ag) => {
        const agId = (ag.nccAdgroupId || ag.adgroupId) as string;
        let impCnt = 0, clkCnt = 0, salesAmt = 0;

        try {
          const statResult = await naverAds.getStats({ id: agId, fields, timeRange });
          if (statResult.success && statResult.data) {
            const rawData = statResult.data as Record<string, unknown>;
            let rows: Record<string, unknown>[] = [];
            if (Array.isArray(rawData)) rows = rawData;
            else if (rawData.data && Array.isArray(rawData.data)) rows = rawData.data;

            for (const row of rows) {
              if (row.summary) {
                const s = row.summary as Record<string, number>;
                impCnt += s.impCnt || 0;
                clkCnt += s.clkCnt || 0;
                salesAmt += s.salesAmt || 0;
              } else {
                impCnt += (row.impCnt as number) || 0;
                clkCnt += (row.clkCnt as number) || 0;
                salesAmt += (row.salesAmt as number) || 0;
              }
            }
          }
        } catch {
          // 통계 실패 시 0으로
        }

        return {
          id: agId,
          name: ag.name as string,
          status: ag.userLock ? 'PAUSED' : 'ACTIVE',
          cost: salesAmt,
          impressions: impCnt,
          clicks: clkCnt,
          ctr: impCnt > 0 ? +((clkCnt / impCnt) * 100).toFixed(2) : 0,
          cpc: clkCnt > 0 ? Math.round(salesAmt / clkCnt) : 0,
        };
      })
    );

    return NextResponse.json({ adGroups: enriched });
  } catch (error) {
    console.error('Naver adgroups error:', error);
    return NextResponse.json({ error: '광고그룹 데이터를 가져오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
