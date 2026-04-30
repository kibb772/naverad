import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId, accountId, date } = await req.json();

    if (!apiKey || !secretKey || !customerId || !accountId || !date) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    // 이미 수집된 날짜면 스킵
    const existing = await prisma.syncLog.findUnique({
      where: { accountId_date: { accountId, date: new Date(date) } },
    });
    if (existing) {
      return NextResponse.json({ skipped: true, date, ready: false });
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });
    const fields = ['impCnt', 'clkCnt', 'salesAmt'];

    // 캠페인 → 광고그룹 → 키워드 목록 가져오기
    const campResult = await naverAds.getCampaigns();
    if (!campResult.success || !Array.isArray(campResult.data)) {
      return NextResponse.json({ error: '캠페인 목록을 가져올 수 없습니다.' }, { status: 500 });
    }

    const allKeywords: { kwId: string; kwText: string; campId: string; campName: string; agId: string; agName: string }[] = [];

    for (const camp of campResult.data as Record<string, unknown>[]) {
      const campId = (camp.nccCampaignId || camp.campaignId) as string;
      const campName = camp.name as string;

      const agResult = await naverAds.getAdGroups(campId);
      if (!agResult.success || !Array.isArray(agResult.data)) continue;

      for (const ag of agResult.data as Record<string, unknown>[]) {
        const agId = (ag.nccAdgroupId || ag.adgroupId) as string;
        const agName = ag.name as string;

        const kwResult = await naverAds.getKeywords(agId);
        if (!kwResult.success || !Array.isArray(kwResult.data)) continue;

        for (const kw of kwResult.data as Record<string, unknown>[]) {
          allKeywords.push({
            kwId: (kw.nccKeywordId || kw.keywordId) as string,
            kwText: (kw.keyword || kw.text || kw.name) as string,
            campId, campName, agId, agName,
          });
        }
      }
    }

    // 해당 날짜 통계 수집
    const timeRange = { since: date, until: date };
    const BATCH = 20;

    for (let i = 0; i < allKeywords.length; i += BATCH) {
      const batch = allKeywords.slice(i, i + BATCH);
      const stats = await Promise.all(
        batch.map(async (kw) => {
          let impCnt = 0, clkCnt = 0, salesAmt = 0;
          try {
            const r = await naverAds.getStats({ id: kw.kwId, fields, timeRange });
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
          return { ...kw, impCnt, clkCnt, salesAmt };
        })
      );

      for (const s of stats) {
        await prisma.keywordDailyStat.upsert({
          where: { keywordId_date: { keywordId: s.kwId, date: new Date(date) } },
          update: { impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
          create: { accountId, campaignId: s.campId, campaignName: s.campName, adGroupId: s.agId, adGroupName: s.agName, keywordId: s.kwId, keywordText: s.kwText, date: new Date(date), impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
        });
      }
    }

    await prisma.syncLog.upsert({
      where: { accountId_date: { accountId, date: new Date(date) } },
      update: { status: 'SUCCESS', keywordCount: allKeywords.length },
      create: { accountId, date: new Date(date), status: 'SUCCESS', keywordCount: allKeywords.length },
    });

    return NextResponse.json({
      message: `${date} 데이터 수집 완료 (키워드 ${allKeywords.length}개)`,
      date,
      keywordCount: allKeywords.length,
      ready: false,
    });
  } catch (error) {
    console.error('Initial sync error:', error);
    return NextResponse.json({ error: '데이터 수집 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

