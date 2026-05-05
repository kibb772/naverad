import prisma from './prisma';
import { NaverAdsService } from '@/services/naver-ads.service';
import { processCSVQueue } from './csv-queue';

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

  // 이미 수집했는지 확인
  const existing = await prisma.syncLog.findUnique({
    where: { accountId_date: { accountId: account.id, date: new Date(syncDate) } },
  });
  if (existing) return { skipped: true, date: syncDate };

  // 1. StatReport 생성 요청 (AD_DETAIL = 키워드 단위 통계)
  console.log(`[Scheduler] ${account.customerId}: StatReport 생성 요청 (${syncDate})`);
  const createResult = await naverAds.createStatReport({
    reportTp: 'AD_DETAIL',
    statDt: syncDate,
  });

  if (!createResult.success || !createResult.data) {
    console.error(`[Scheduler] ${account.customerId}: StatReport 생성 실패`, createResult.error);
    // StatReport 실패 시 기존 방식으로 폴백
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  const reportData = createResult.data as Record<string, unknown>;
  const reportJobId = (reportData.reportJobId || reportData.id) as string;

  if (!reportJobId) {
    console.error(`[Scheduler] ${account.customerId}: reportJobId 없음`, reportData);
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  // 2. 보고서 준비 완료까지 폴링 (최대 2분)
  let reportReady = false;
  let downloadUrl = '';
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((r) => setTimeout(r, 5000)); // 5초 대기

    const statusResult = await naverAds.getStatReport(reportJobId);
    if (!statusResult.success || !statusResult.data) continue;

    const status = statusResult.data as Record<string, unknown>;
    const jobStatus = (status.status || status.reportJobStatus) as string;

    if (jobStatus === 'BUILT' || jobStatus === 'READY' || jobStatus === 'DONE') {
      downloadUrl = (status.downloadUrl || status.reportUrl || '') as string;
      reportReady = true;
      console.log(`[Scheduler] ${account.customerId}: StatReport 준비 완료`);
      break;
    } else if (jobStatus === 'FAILED' || jobStatus === 'ERROR') {
      console.error(`[Scheduler] ${account.customerId}: StatReport 실패 (${jobStatus})`);
      break;
    }
    // RUNNING, WAITING 등은 계속 대기
  }

  if (!reportReady || !downloadUrl) {
    console.log(`[Scheduler] ${account.customerId}: StatReport 폴백 → 기존 방식`);
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  // 3. 보고서 다운로드 (TSV 형식)
  let tsvText = '';
  try {
    const downloadResult = await naverAds.getStatReportDownload(reportJobId);
    if (downloadResult.success && downloadResult.data) {
      tsvText = typeof downloadResult.data === 'string'
        ? downloadResult.data
        : JSON.stringify(downloadResult.data);
    }
  } catch {
    // 다운로드 URL로 직접 fetch
    try {
      const res = await fetch(downloadUrl);
      tsvText = await res.text();
    } catch (e) {
      console.error(`[Scheduler] ${account.customerId}: 보고서 다운로드 실패`, e);
      return await syncAccountDataLegacy(naverAds, account, syncDate);
    }
  }

  if (!tsvText || tsvText.length < 10) {
    console.log(`[Scheduler] ${account.customerId}: 보고서 데이터 없음, 폴백`);
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  // 4. TSV 파싱 → DB 저장
  const lines = tsvText.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  // 첫 줄은 헤더
  const headers = lines[0].split('\t').map((h) => h.trim().replace(/"/g, ''));
  const rows: {
    accountId: string; campaignId: string; campaignName: string;
    adGroupId: string; adGroupName: string; keywordId: string;
    keywordText: string; date: Date; impressions: number;
    clicks: number; cost: number; cpc: number; ctr: number;
  }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t').map((c) => c.trim().replace(/"/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });

    // 키워드 관련 필드 매핑 (네이버 StatReport 필드명)
    const keywordId = row['nccKeywordId'] || row['keywordId'] || row['nccCriterionId'] || '';
    const keywordText = row['keyword'] || row['criterionValue'] || row['keywordName'] || '';
    if (!keywordId && !keywordText) continue;

    const impressions = parseInt(row['impCnt'] || row['impressions'] || '0') || 0;
    const clicks = parseInt(row['clkCnt'] || row['clicks'] || '0') || 0;
    const cost = parseInt(row['salesAmt'] || row['cost'] || row['ccnt'] || '0') || 0;

    rows.push({
      accountId: account.id,
      campaignId: row['nccCampaignId'] || row['campaignId'] || '',
      campaignName: row['campaignName'] || row['nccCampaignName'] || '',
      adGroupId: row['nccAdgroupId'] || row['adgroupId'] || '',
      adGroupName: row['adgroupName'] || row['nccAdgroupName'] || '',
      keywordId: keywordId || `report-${keywordText}`,
      keywordText,
      date: new Date(syncDate + 'T00:00:00.000Z'),
      impressions,
      clicks,
      cost,
      cpc: clicks > 0 ? Math.round(cost / clicks) : 0,
      ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0,
    });
  }

  console.log(`[Scheduler] ${account.customerId}: StatReport ${rows.length}행 파싱 완료`);

  // bulk insert
  if (rows.length > 0) {
    // 기존 데이터 삭제 (같은 날짜)
    await prisma.keywordDailyStat.deleteMany({
      where: { accountId: account.id, date: new Date(syncDate + 'T00:00:00.000Z'), keywordId: { not: { startsWith: 'csv-' } } },
    });

    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      await prisma.keywordDailyStat.createMany({
        data: rows.slice(i, i + BATCH),
        skipDuplicates: true,
      });
    }
  }

  await prisma.syncLog.upsert({
    where: { accountId_date: { accountId: account.id, date: new Date(syncDate) } },
    update: { status: 'SUCCESS', keywordCount: rows.length },
    create: { accountId: account.id, date: new Date(syncDate), status: 'SUCCESS', keywordCount: rows.length },
  });

  console.log(`[Scheduler] ${account.customerId}: StatReport 수집 완료! ${rows.length}개 키워드`);
  return { success: true, date: syncDate, keywordCount: rows.length };
}

// 폴백: 기존 키워드 개별 조회 방식
async function syncAccountDataLegacy(naverAds: NaverAdsService, account: { id: string; customerId: string }, syncDate: string) {
  console.log(`[Scheduler] ${account.customerId}: 기존 방식으로 수집 시작`);
  const fields = ['impCnt', 'clkCnt', 'salesAmt'];
  const timeRange = { since: syncDate, until: syncDate };

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

  await prisma.syncLog.upsert({
    where: { accountId_date: { accountId: account.id, date: new Date(syncDate) } },
    update: { status: 'SUCCESS', keywordCount: totalKeywords },
    create: { accountId: account.id, date: new Date(syncDate), status: 'SUCCESS', keywordCount: totalKeywords },
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

  // CSV 큐 처리 시작 (10초마다 확인)
  setInterval(() => {
    processCSVQueue();
  }, 10000);

  // 매일 오전 9시에 실행
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next.getTime() - now.getTime();
    console.log(`[Scheduler] 다음 수집: ${next.toLocaleString('ko-KR')} (${Math.round(delay / 1000 / 60)}분 후)`);

    setTimeout(() => {
      runDailySync().catch(console.error);
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}


