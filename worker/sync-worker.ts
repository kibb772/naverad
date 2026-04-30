import { PrismaClient } from '@prisma/client';
import { NaverAdsService } from '../src/services/naver-ads.service';

const prisma = new PrismaClient();

async function syncAccount(account: {
  id: string;
  accountName: string;
  apiKey: string;
  secretKey: string;
  customerId: string;
}) {
  console.log(`[Worker] 수집 시작: ${account.accountName}`);

  const allDates: string[] = [];
  for (let i = 1; i <= 90; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    allDates.push(d.toISOString().slice(0, 10));
  }

  const existingLogs = await prisma.syncLog.findMany({
    where: { accountId: account.id, date: { gte: new Date(allDates[allDates.length - 1]) } },
    select: { date: true },
  });
  const existingDates = new Set(existingLogs.map((l) => l.date.toISOString().slice(0, 10)));
  const pendingDates = allDates.filter((d) => !existingDates.has(d));

  if (pendingDates.length === 0) {
    console.log(`[Worker] ${account.accountName}: 이미 완료됨`);
    await prisma.naverAdsAccount.update({
      where: { id: account.id },
      data: { isActive: true, syncStatus: 'ready', lastSyncAt: new Date() },
    });
    return;
  }

  console.log(`[Worker] ${account.accountName}: ${pendingDates.length}일치 수집 예정`);

  const naverAds = new NaverAdsService({
    apiKey: account.apiKey,
    secretKey: account.secretKey,
    customerId: account.customerId,
  });
  const fields = ['impCnt', 'clkCnt', 'salesAmt'];

  // 캠페인 → 광고그룹 → 키워드 목록
  const campResult = await naverAds.getCampaigns();
  if (!campResult.success || !Array.isArray(campResult.data)) {
    console.error(`[Worker] ${account.accountName}: 캠페인 조회 실패`);
    return;
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

  console.log(`[Worker] ${account.accountName}: 키워드 ${allKeywords.length}개 발견`);

  for (const syncDate of pendingDates) {
    try {
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
            create: { accountId: account.id, campaignId: s.campId, campaignName: s.campName, adGroupId: s.agId, adGroupName: s.agName, keywordId: s.kwId, keywordText: s.kwText, date: new Date(syncDate), impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
          });
        }
      }

      await prisma.syncLog.upsert({
        where: { accountId_date: { accountId: account.id, date: new Date(syncDate) } },
        update: { status: 'SUCCESS', keywordCount: allKeywords.length },
        create: { accountId: account.id, date: new Date(syncDate), status: 'SUCCESS', keywordCount: allKeywords.length },
      });

      console.log(`[Worker] ${account.accountName}: ${syncDate} 완료`);
    } catch (e) {
      console.error(`[Worker] ${account.accountName}: ${syncDate} 실패`, e);
    }
  }

  await prisma.naverAdsAccount.update({
    where: { id: account.id },
    data: { isActive: true, syncStatus: 'ready', lastSyncAt: new Date() },
  });

  console.log(`[Worker] ${account.accountName}: 전체 완료!`);
}

async function main() {
  console.log('[Worker] 시작');

  // syncStatus가 syncing인 계정 모두 수집
  const accounts = await prisma.naverAdsAccount.findMany({
    where: { syncStatus: 'syncing' },
  });

  console.log(`[Worker] 수집 대기 계정: ${accounts.length}개`);

  for (const account of accounts) {
    await syncAccount(account);
  }

  console.log('[Worker] 완료. 5분 후 재확인...');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[Worker] 오류:', e);
  process.exit(1);
});
