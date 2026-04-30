import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId, accountId, date } = await req.json();

    if (!apiKey || !secretKey || !customerId || !accountId) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    // 수집할 날짜 (기본: 어제)
    const syncDate = date || (() => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return y.toISOString().slice(0, 10);
    })();

    // 이미 수집했는지 확인
    const existing = await prisma.syncLog.findUnique({
      where: { accountId_date: { accountId, date: new Date(syncDate) } },
    });
    if (existing) {
      return NextResponse.json({ message: `${syncDate} 데이터는 이미 수집되었습니다.`, skipped: true });
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });
    const fields = ['impCnt', 'clkCnt', 'salesAmt'];
    const timeRange = { since: syncDate, until: syncDate };

    // 1. 캠페인 목록
    const campResult = await naverAds.getCampaigns();
    if (!campResult.success || !Array.isArray(campResult.data)) {
      return NextResponse.json({ error: '캠페인 목록을 가져올 수 없습니다.' }, { status: 500 });
    }

    const campaigns = campResult.data as Record<string, unknown>[];
    let totalKeywords = 0;

    // 2. 캠페인별 → 광고그룹별 → 키워드별 통계 수집
    for (const camp of campaigns) {
      const campId = (camp.nccCampaignId || camp.campaignId) as string;
      const campName = camp.name as string;

      const agResult = await naverAds.getAdGroups(campId);
      if (!agResult.success || !Array.isArray(agResult.data)) continue;

      for (const ag of agResult.data as Record<string, unknown>[]) {
        const agId = (ag.nccAdgroupId || ag.adgroupId) as string;
        const agName = ag.name as string;

        const kwResult = await naverAds.getKeywords(agId);
        if (!kwResult.success || !Array.isArray(kwResult.data)) continue;

        const keywords = kwResult.data as Record<string, unknown>[];

        // 키워드 통계 20개씩 병렬
        const BATCH = 20;
        for (let i = 0; i < keywords.length; i += BATCH) {
          const batch = keywords.slice(i, i + BATCH);
          const stats = await Promise.all(
            batch.map(async (kw) => {
              const kwId = (kw.nccKeywordId || kw.keywordId) as string;
              const kwText = (kw.keyword || kw.text || kw.name) as string;
              let impCnt = 0, clkCnt = 0, salesAmt = 0;

              try {
                const r = await naverAds.getStats({ id: kwId, fields, timeRange });
                if (r.success && r.data) {
                  const rawData = r.data as Record<string, unknown>;
                  let rows: Record<string, unknown>[] = [];
                  if (Array.isArray(rawData)) rows = rawData;
                  else if (rawData.data && Array.isArray(rawData.data)) rows = rawData.data;

                  for (const row of rows) {
                    const s = (row.summary || row) as Record<string, number>;
                    impCnt += s.impCnt || 0;
                    clkCnt += s.clkCnt || 0;
                    salesAmt += s.salesAmt || 0;
                  }
                }
              } catch { /* 무시 */ }

              return { kwId, kwText, impCnt, clkCnt, salesAmt };
            })
          );

          // DB에 저장
          for (const s of stats) {
            await prisma.keywordDailyStat.upsert({
              where: { keywordId_date: { keywordId: s.kwId, date: new Date(syncDate) } },
              update: {
                impressions: s.impCnt,
                clicks: s.clkCnt,
                cost: s.salesAmt,
                cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0,
                ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0,
              },
              create: {
                accountId,
                campaignId: campId,
                campaignName: campName,
                adGroupId: agId,
                adGroupName: agName,
                keywordId: s.kwId,
                keywordText: s.kwText,
                date: new Date(syncDate),
                impressions: s.impCnt,
                clicks: s.clkCnt,
                cost: s.salesAmt,
                cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0,
                ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0,
              },
            });
            totalKeywords++;
          }
        }
      }
    }

    // 수집 로그 기록
    await prisma.syncLog.create({
      data: { accountId, date: new Date(syncDate), status: 'SUCCESS', keywordCount: totalKeywords },
    });

    return NextResponse.json({ message: `${syncDate} 데이터 수집 완료`, keywordCount: totalKeywords });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: '데이터 수집 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
