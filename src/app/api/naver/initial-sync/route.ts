import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId, accountId } = await req.json();

    if (!apiKey || !secretKey || !customerId || !accountId) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    // 즉시 응답 후 백그라운드에서 수집 (브라우저 안 기다려도 됨)
    // waitUntil이 없으므로 비동기로 시작하고 즉시 응답
    runBackgroundSync({ apiKey, secretKey, customerId, accountId }).catch((e) => {
      console.error('Background sync error:', e);
    });

    return NextResponse.json({ message: '백그라운드 수집을 시작했습니다. 창을 닫아도 됩니다.', started: true });
  } catch (error) {
    console.error('Initial sync error:', error);
    return NextResponse.json({ error: '수집 시작 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

async function runBackgroundSync({
  apiKey, secretKey, customerId, accountId,
}: { apiKey: string; secretKey: string; customerId: string; accountId: string }) {
  const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });
  const fields = ['impCnt', 'clkCnt', 'salesAmt'];

  // 최근 90일 날짜 목록 (어제부터)
  const dates: string[] = [];
  for (let i = 1; i <= 90; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // 이미 수집된 날짜 제외
  const existingLogs = await prisma.syncLog.findMany({
    where: { accountId, date: { gte: new Date(dates[dates.length - 1]) } },
    select: { date: true },
  });
  const existingDates = new Set(existingLogs.map((l) => l.date.toISOString().slice(0, 10)));
  const pendingDates = dates.filter((d) => !existingDates.has(d));

  if (pendingDates.length === 0) {
    await prisma.naverAdsAccount.update({
      where: { id: accountId },
      data: { isActive: true, syncStatus: 'ready' },
    });
    return;
  }

  // 캠페인 → 광고그룹 → 키워드 목록 가져오기
  const campResult = await naverAds.getCampaigns();
  if (!campResult.success || !Array.isArray(campResult.data)) return;

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

  // 날짜별로 순서대로 수집
  for (const syncDate of pendingDates) {
    try {
      const timeRange = { since: syncDate, until: syncDate };
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
            where: { keywordId_date: { keywordId: s.kwId, date: new Date(syncDate) } },
            update: { impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
            create: { accountId, campaignId: s.campId, campaignName: s.campName, adGroupId: s.agId, adGroupName: s.agName, keywordId: s.kwId, keywordText: s.kwText, date: new Date(syncDate), impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
          });
        }
      }

      await prisma.syncLog.upsert({
        where: { accountId_date: { accountId, date: new Date(syncDate) } },
        update: { status: 'SUCCESS', keywordCount: allKeywords.length },
        create: { accountId, date: new Date(syncDate), status: 'SUCCESS', keywordCount: allKeywords.length },
      });
    } catch {
      // 하루 실패해도 계속
    }
  }

  // 수집 완료 → DB 상태 업데이트
  await prisma.naverAdsAccount.update({
    where: { id: accountId },
    data: { isActive: true, syncStatus: 'ready', lastSyncAt: new Date() },
  });
}
