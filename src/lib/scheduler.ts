import prisma from './prisma';
import { NaverAdsService } from '@/services/naver-ads.service';

let schedulerStarted = false;

async function syncAccountData(account: {
  id: string;
  apiKey: string;
  secretKey: string;
  customerId: string;
}, syncDate: string) {
  const naverAds = new NaverAdsService({
    apiKey: account.apiKey,
    secretKey: account.secretKey,
    customerId: account.customerId,
  });

  const fields = ['impCnt', 'clkCnt', 'salesAmt'];
  const timeRange = { since: syncDate, until: syncDate };

  // 이미 수집했는지 확인
  const existing = await prisma.syncLog.findUnique({
    where: { accountId_date: { accountId: account.id, date: new Date(syncDate) } },
  });
  if (existing) return { skipped: true, date: syncDate };

  const campResult = await naverAds.getCampaigns();
  if (!campResult.success || !Array.isArray(campResult.data)) return { error: 'campaigns failed' };

  let totalKeywords = 0;

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

      const keywords = kwResult.data as Record<string, unknown>[];
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

        for (const s of stats) {
          await prisma.keywordDailyStat.upsert({
            where: { keywordId_date: { keywordId: s.kwId, date: new Date(syncDate) } },
            update: { impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
            create: { accountId: account.id, campaignId: campId, campaignName: campName, adGroupId: agId, adGroupName: agName, keywordId: s.kwId, keywordText: s.kwText, date: new Date(syncDate), impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
          });
          totalKeywords++;
        }
      }
    }
  }

  await prisma.syncLog.create({
    data: { accountId: account.id, date: new Date(syncDate), status: 'SUCCESS', keywordCount: totalKeywords },
  });

  return { success: true, date: syncDate, keywordCount: totalKeywords };
}

async function runDailySync() {
  console.log('[Scheduler] 일일 데이터 수집 시작...');

  // DB에서 연동된 계정 가져오기 (NaverAdsAccount 테이블)
  const accounts = await prisma.naverAdsAccount.findMany({ where: { isActive: true } });

  if (accounts.length === 0) {
    console.log('[Scheduler] 연동된 계정이 없습니다.');
    return;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const syncDate = yesterday.toISOString().slice(0, 10);

  for (const account of accounts) {
    try {
      console.log(`[Scheduler] 계정 ${account.customerId} - ${syncDate} 수집 중...`);
      const result = await syncAccountData({
        id: account.id,
        apiKey: account.apiKey,
        secretKey: account.secretKey,
        customerId: account.customerId,
      }, syncDate);
      console.log(`[Scheduler] 계정 ${account.customerId} 결과:`, result);
    } catch (error) {
      console.error(`[Scheduler] 계정 ${account.customerId} 수집 실패:`, error);
    }
  }

  console.log('[Scheduler] 일일 데이터 수집 완료');
}

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  console.log('[Scheduler] 스케줄러 시작됨');

  // 서버 시작 시 즉시 한 번 실행 (10초 후)
  setTimeout(() => {
    runDailySync().catch(console.error);
  }, 10000);

  // 초기 수집 (syncing 상태 계정) - 15초 후 시작
  setTimeout(() => {
    runInitialSync().catch(console.error);
  }, 15000);

  // 매일 새벽 6시에 실행
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(6, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next.getTime() - now.getTime();
    console.log(`[Scheduler] 다음 수집: ${next.toLocaleString('ko-KR')} (${Math.round(delay / 1000 / 60)}분 후)`);

    setTimeout(() => {
      runDailySync().catch(console.error);
      scheduleNext();
    }, delay);
  };

  scheduleNext();

  // 5분마다 syncing 계정 확인
  setInterval(() => {
    runInitialSync().catch(console.error);
  }, 5 * 60 * 1000);
}

async function runInitialSync() {
  const accounts = await prisma.naverAdsAccount.findMany({ where: { syncStatus: 'syncing' } });
  if (accounts.length === 0) return;

  console.log(`[InitialSync] syncing 계정 ${accounts.length}개 발견`);

  for (const account of accounts) {
    // 90일치 날짜 중 미수집 날짜 찾기
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
      await prisma.naverAdsAccount.update({
        where: { id: account.id },
        data: { isActive: true, syncStatus: 'ready', lastSyncAt: new Date() },
      });
      console.log(`[InitialSync] ${account.accountName}: 완료!`);
      continue;
    }

    console.log(`[InitialSync] ${account.accountName}: ${pendingDates.length}일 남음`);

    // 하루치씩 수집
    for (const date of pendingDates) {
      try {
        console.log(`[InitialSync] ${account.accountName}: ${date} 수집 중...`);
        await syncAccountData({
          id: account.id,
          apiKey: account.apiKey,
          secretKey: account.secretKey,
          customerId: account.customerId,
        }, date);
        console.log(`[InitialSync] ${account.accountName}: ${date} 완료`);
      } catch (e) {
        console.error(`[InitialSync] ${account.accountName}: ${date} 실패`, e);
      }
    }

    await prisma.naverAdsAccount.update({
      where: { id: account.id },
      data: { isActive: true, syncStatus: 'ready', lastSyncAt: new Date() },
    });
    console.log(`[InitialSync] ${account.accountName}: 전체 완료!`);
  }
}
