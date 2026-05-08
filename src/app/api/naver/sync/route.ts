import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';
import prisma from '@/lib/prisma';

// 캠페인 유형 코드 → 한글 라벨
function getCampaignTypeLabel(campType: string): string {
  if (campType === 'WEB_SITE' || campType === '1') return '파워링크';
  if (campType === 'SHOPPING' || campType === '2') return '쇼핑검색';
  if (campType === 'POWER_CONTENTS' || campType === '3') return '파워컨텐츠';
  if (campType === 'BRAND_SEARCH' || campType === '4') return '브랜드검색';
  if (campType === 'PLACE' || campType === '6' || campType === '7') return '플레이스';
  return campType || '';
}

// StatReport 방식으로 수집
async function syncViaStatReport(naverAds: NaverAdsService, accountId: string, customerId: string, syncDate: string): Promise<{ success: boolean; keywordCount: number } | null> {
  try {
    console.log(`[Sync] ${customerId}: StatReport 생성 요청 (${syncDate})`);
    const createResult = await naverAds.createStatReport({ reportTp: 'AD_DETAIL', statDt: syncDate });

    if (!createResult.success || !createResult.data) {
      console.log(`[Sync] ${customerId}: StatReport 생성 실패 - ${createResult.error}`);
      return null;
    }

    const reportData = createResult.data as Record<string, unknown>;
    const reportJobId = (reportData.reportJobId || reportData.id) as string;
    if (!reportJobId) return null;

    // 보고서 준비 대기 (최대 2분)
    let reportReady = false;
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      const statusResult = await naverAds.getStatReport(reportJobId);
      if (!statusResult.success || !statusResult.data) continue;
      const status = statusResult.data as Record<string, unknown>;
      const jobStatus = (status.status || status.reportJobStatus) as string;
      if (jobStatus === 'BUILT' || jobStatus === 'READY' || jobStatus === 'DONE') {
        reportReady = true;
        console.log(`[Sync] ${customerId}: StatReport 준비 완료`);
        break;
      } else if (jobStatus === 'FAILED' || jobStatus === 'ERROR') {
        console.log(`[Sync] ${customerId}: StatReport 실패 (${jobStatus})`);
        return null;
      }
    }

    if (!reportReady) return null;

    // 다운로드
    const downloadResult = await naverAds.getStatReportDownload(reportJobId);
    if (!downloadResult.success || !downloadResult.data) {
      console.log(`[Sync] ${customerId}: StatReport 다운로드 실패`);
      return null;
    }

    const tsvText = String(downloadResult.data);
    if (tsvText.length < 10) return null;

    const lines = tsvText.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 1) return null;

    // 헤더 유무 확인
    const hasHeader = lines[0].includes('impCnt') || lines[0].includes('clkCnt') || lines[0].includes('nccKeywordId');

    if (hasHeader) {
      // 헤더 있는 형식은 스케줄러와 동일하게 처리 (여기선 생략 - 고정 형식만 처리)
    }

    // 키워드 마스터 매핑 구축
    console.log(`[Sync] ${customerId}: 키워드 마스터 매핑 구축 중...`);
    const keywordMap: Record<string, { text: string; campaignType: string }> = {};
    const campTypeMap: Record<string, string> = {};

    try {
      const campResult = await naverAds.getCampaigns();
      if (campResult.success && Array.isArray(campResult.data)) {
        for (const camp of campResult.data as Record<string, unknown>[]) {
          const campId = (camp.nccCampaignId || camp.campaignId) as string;
          const campType = (camp.campaignTp || camp.campaignType || '') as string;
          const typeLabel = getCampaignTypeLabel(campType);
          campTypeMap[campId] = typeLabel;

          const agResult = await naverAds.getAdGroups(campId);
          if (!agResult.success || !Array.isArray(agResult.data)) continue;

          for (const ag of agResult.data as Record<string, unknown>[]) {
            const agId = (ag.nccAdgroupId || ag.adgroupId) as string;
            const kwResult = await naverAds.getKeywords(agId);
            if (!kwResult.success || !Array.isArray(kwResult.data)) continue;

            for (const kw of kwResult.data as Record<string, unknown>[]) {
              const kwId = (kw.nccKeywordId || kw.keywordId) as string;
              const kwText = (kw.keyword || kw.text || kw.name) as string;
              keywordMap[kwId] = { text: kwText, campaignType: typeLabel };
            }
          }
        }
      }
    } catch (e) {
      console.error(`[Sync] ${customerId}: 키워드 마스터 구축 실패`, e);
    }

    console.log(`[Sync] ${customerId}: 키워드 마스터 ${Object.keys(keywordMap).length}개 매핑`);

    // 고정 형식 파싱 + 합산
    const statMap: Record<string, { campId: string; agId: string; kwId: string; impressions: number; clicks: number; cost: number }> = {};

    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 15) continue;

      const campId = cols.find((c) => c.startsWith('cmp-')) || '';
      const agId = cols.find((c) => c.startsWith('grp-')) || '';
      const kwId = cols.find((c) => c.startsWith('nkw-')) || cols.find((c) => c.startsWith('crt-')) || '';

      if (!campId) continue;

      const numFields = cols.slice(-5).map((c) => parseInt(c) || 0);
      const impressions = numFields[0] || 0;
      const clicks = numFields[1] || 0;
      const cost = numFields[3] || 0;

      const key = kwId || `${campId}-${agId}-unknown`;
      if (!statMap[key]) {
        statMap[key] = { campId, agId, kwId: kwId || key, impressions: 0, clicks: 0, cost: 0 };
      }
      statMap[key].impressions += impressions;
      statMap[key].clicks += clicks;
      statMap[key].cost += cost;
    }

    // DB 저장용 rows 생성
    const rows: {
      accountId: string; campaignId: string; campaignName: string;
      adGroupId: string; adGroupName: string; keywordId: string;
      keywordText: string; date: Date; impressions: number;
      clicks: number; cost: number; cpc: number; ctr: number;
    }[] = [];

    for (const [, stat] of Object.entries(statMap)) {
      const master = keywordMap[stat.kwId];
      const campaignTypeLabel = master?.campaignType || campTypeMap[stat.campId] || '';
      const keywordText = master?.text || '-';

      rows.push({
        accountId, campaignId: stat.campId, campaignName: campaignTypeLabel,
        adGroupId: stat.agId, adGroupName: '',
        keywordId: stat.kwId, keywordText,
        date: new Date(syncDate + 'T00:00:00.000Z'),
        impressions: stat.impressions, clicks: stat.clicks, cost: stat.cost,
        cpc: stat.clicks > 0 ? Math.round(stat.cost / stat.clicks) : 0,
        ctr: stat.impressions > 0 ? +((stat.clicks / stat.impressions) * 100).toFixed(2) : 0,
      });
    }

    console.log(`[Sync] ${customerId}: StatReport ${rows.length}행 파싱 완료`);

    if (rows.length === 0) return null;

    // DB 저장
    await prisma.keywordDailyStat.deleteMany({
      where: { accountId, date: new Date(syncDate + 'T00:00:00.000Z'), keywordId: { not: { startsWith: 'csv-' } } },
    });

    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      await prisma.keywordDailyStat.createMany({ data: rows.slice(i, i + BATCH), skipDuplicates: true });
    }

    await prisma.syncLog.upsert({
      where: { accountId_date: { accountId, date: new Date(syncDate) } },
      update: { status: 'SUCCESS', keywordCount: rows.length },
      create: { accountId, date: new Date(syncDate), status: 'SUCCESS', keywordCount: rows.length },
    });

    console.log(`[Sync] ${customerId}: StatReport 수집 완료! ${rows.length}개 키워드`);
    return { success: true, keywordCount: rows.length };
  } catch (error) {
    console.error(`[Sync] ${customerId}: StatReport 오류`, error);
    return null;
  }
}

// 폴백: 키워드 개별 조회
async function syncViaKeywords(naverAds: NaverAdsService, accountId: string, customerId: string, syncDate: string) {
  console.log(`[Sync] ${customerId}: 키워드 개별 조회 방식으로 수집`);
  const fields = ['impCnt', 'clkCnt', 'salesAmt'];
  const timeRange = { since: syncDate, until: syncDate };

  const campResult = await naverAds.getCampaigns();
  if (!campResult.success || !Array.isArray(campResult.data)) return { error: '캠페인 조회 실패' };

  let totalKeywords = 0;
  for (const camp of campResult.data as Record<string, unknown>[]) {
    const campId = (camp.nccCampaignId || camp.campaignId) as string;
    const campType = (camp.campaignTp || camp.campaignType || '') as string;
    const campaignTypeLabel = getCampaignTypeLabel(campType);

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
        const stats = await Promise.all(batch.map(async (kw) => {
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
              for (const row of rows) { const s = (row.summary || row) as Record<string, number>; impCnt += s.impCnt || 0; clkCnt += s.clkCnt || 0; salesAmt += s.salesAmt || 0; }
            }
          } catch { /* 무시 */ }
          return { kwId, kwText, impCnt, clkCnt, salesAmt };
        }));

        for (const s of stats) {
          await prisma.keywordDailyStat.upsert({
            where: { keywordId_date: { keywordId: s.kwId, date: new Date(syncDate) } },
            update: { impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
            create: { accountId, campaignId: campId, campaignName: campaignTypeLabel, adGroupId: agId, adGroupName: agName, keywordId: s.kwId, keywordText: s.kwText, date: new Date(syncDate), impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
          });
          totalKeywords++;
        }
      }
    }
  }

  await prisma.syncLog.upsert({
    where: { accountId_date: { accountId, date: new Date(syncDate) } },
    update: { status: 'SUCCESS', keywordCount: totalKeywords },
    create: { accountId, date: new Date(syncDate), status: 'SUCCESS', keywordCount: totalKeywords },
  });

  console.log(`[Sync] ${customerId}: 키워드 개별 수집 완료! ${totalKeywords}개`);
  return { success: true, keywordCount: totalKeywords };
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId, accountId, date, force } = await req.json();

    if (!apiKey || !secretKey || !customerId || !accountId) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const yesterdayKST = new Date(nowKST);
    yesterdayKST.setDate(yesterdayKST.getDate() - 1);
    const syncDate = date || yesterdayKST.toISOString().slice(0, 10);

    const existing = await prisma.syncLog.findUnique({
      where: { accountId_date: { accountId, date: new Date(syncDate) } },
    });

    if (existing && !force) {
      return NextResponse.json({ message: `${syncDate} 데이터는 이미 수집되었습니다.`, skipped: true });
    }

    if (existing && force) {
      await prisma.syncLog.delete({ where: { accountId_date: { accountId, date: new Date(syncDate) } } });
      await prisma.keywordDailyStat.deleteMany({
        where: { accountId, date: new Date(syncDate + 'T00:00:00.000Z'), keywordId: { not: { startsWith: 'csv-' } } },
      });
      console.log(`[Sync] ${customerId}: ${syncDate} 기존 데이터 삭제 (강제 재수집)`);
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });

    // 백그라운드에서 수집 (StatReport 우선, 실패 시 폴백)
    (async () => {
      const result = await syncViaStatReport(naverAds, accountId, customerId, syncDate);
      if (!result) {
        await syncViaKeywords(naverAds, accountId, customerId, syncDate);
      }
    })().catch((e) => console.error(`[Sync] ${customerId}: 백그라운드 수집 실패`, e));

    return NextResponse.json({
      message: `${syncDate} 데이터 수집을 시작했습니다. 잠시 후 새로고침하면 반영됩니다.`,
      processing: true,
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: '데이터 수집 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
