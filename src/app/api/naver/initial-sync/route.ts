import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';
import prisma from '@/lib/prisma';

// 하루치 수집 후 다음 날짜를 스스로 호출하는 방식
export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId, accountId, dates } = await req.json();

    if (!apiKey || !secretKey || !customerId || !accountId) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    // dates가 없으면 최초 호출 - 90일치 날짜 생성
    let pendingDates: string[] = dates;
    if (!pendingDates) {
      const allDates: string[] = [];
      for (let i = 1; i <= 90; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        allDates.push(d.toISOString().slice(0, 10));
      }
      // 이미 수집된 날짜 제외
      const existingLogs = await prisma.syncLog.findMany({
        where: { accountId, date: { gte: new Date(allDates[allDates.length - 1]) } },
        select: { date: true },
      });
      const existingDates = new Set(existingLogs.map((l) => l.date.toISOString().slice(0, 10)));
      pendingDates = allDates.filter((d) => !existingDates.has(d));
    }

    if (pendingDates.length === 0) {
      // 모두 완료 - DB 상태 업데이트
      await prisma.naverAdsAccount.update({
        where: { id: accountId },
        data: { isActive: true, syncStatus: 'ready', lastSyncAt: new Date() },
      });
      return NextResponse.json({ done: true, message: '90일치 수집 완료' });
    }

    // 첫 번째 날짜 수집
    const syncDate = pendingDates[0];
    const remainingDates = pendingDates.slice(1);

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });
    const fields = ['impCnt', 'clkCnt', 'salesAmt'];

    // 캠페인 → 광고그룹 → 키워드 목록
    const campResult = await naverAds.getCampaigns();
    if (campResult.success && Array.isArray(campResult.data)) {
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

      const timeRange = { since: syncDate, until: syncDate };
      const BATCH = 20;
      for (let i = 0; i < allKeywords.length; i += BATCH) {
        const batch = allKeywords.slice(i, i + BATCH);
        const stats = await Promise.all(batch.map(async (kw) => {
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
                impCnt += s.impCnt || 0; clkCnt += s.clkCnt || 0; salesAmt += s.salesAmt || 0;
              }
            }
          } catch { /* 무시 */ }
          return { ...kw, impCnt, clkCnt, salesAmt };
        }));

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
    }

    // 다음 날짜 호출 (자기 자신을 재귀 호출)
    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    fetch(`${protocol}://${host}/api/naver/initial-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, secretKey, customerId, accountId, dates: remainingDates }),
    }).catch(() => {});

    return NextResponse.json({
      message: `${syncDate} 수집 완료. 남은 날짜: ${remainingDates.length}일`,
      remaining: remainingDates.length,
      done: false,
    });
  } catch (error) {
    console.error('Initial sync error:', error);
    return NextResponse.json({ error: '수집 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
