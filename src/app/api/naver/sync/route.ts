import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';
import prisma from '@/lib/prisma';

// 백그라운드에서 StatReport 수집 실행
async function syncViaStatReport(naverAds: NaverAdsService, accountId: string, customerId: string, syncDate: string) {
  try {
    // 1. StatReport 생성 요청
    console.log(`[Sync] ${customerId}: StatReport 생성 요청 (${syncDate})`);
    const createResult = await naverAds.createStatReport({
      reportTp: 'AD_DETAIL',
      statDt: syncDate,
    });

    if (!createResult.success || !createResult.data) {
      console.error(`[Sync] ${customerId}: StatReport 생성 실패`, createResult.error);
      // 폴백: 키워드 개별 조회
      return await syncViaKeywords(naverAds, accountId, customerId, syncDate);
    }

    const reportData = createResult.data as Record<string, unknown>;
    const reportJobId = (reportData.reportJobId || reportData.id) as string;

    if (!reportJobId) {
      console.error(`[Sync] ${customerId}: reportJobId 없음`);
      return await syncViaKeywords(naverAds, accountId, customerId, syncDate);
    }

    // 2. 보고서 준비 완료까지 폴링 (최대 2분)
    let reportReady = false;
    let downloadUrl = '';
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));

      const statusResult = await naverAds.getStatReport(reportJobId);
      if (!statusResult.success || !statusResult.data) continue;

      const status = statusResult.data as Record<string, unknown>;
      const jobStatus = (status.status || status.reportJobStatus) as string;

      if (jobStatus === 'BUILT' || jobStatus === 'READY' || jobStatus === 'DONE') {
        downloadUrl = (status.downloadUrl || status.reportUrl || '') as string;
        reportReady = true;
        console.log(`[Sync] ${customerId}: StatReport 준비 완료 (downloadUrl: ${downloadUrl ? 'Y' : 'N'})`);
        break;
      } else if (jobStatus === 'FAILED' || jobStatus === 'ERROR') {
        console.error(`[Sync] ${customerId}: StatReport 실패 (${jobStatus})`);
        break;
      }
    }

    if (!reportReady) {
      console.log(`[Sync] ${customerId}: StatReport 준비 안됨 → 키워드 개별 조회`);
      return await syncViaKeywords(naverAds, accountId, customerId, syncDate);
    }

    // 3. 보고서 다운로드 (API 다운로드 우선, URL 폴백)
    let tsvText = '';
    try {
      const downloadResult = await naverAds.getStatReportDownload(reportJobId);
      console.log(`[Sync] ${customerId}: 다운로드 API 응답 success=${downloadResult.success}, dataType=${typeof downloadResult.data}, dataLength=${String(downloadResult.data || '').length}`);
      if (downloadResult.success && downloadResult.data) {
        tsvText = typeof downloadResult.data === 'string'
          ? downloadResult.data
          : JSON.stringify(downloadResult.data);
      }
    } catch (dlErr) {
      console.error(`[Sync] ${customerId}: 다운로드 API 실패`, dlErr);
    }

    // API 다운로드 실패 시 URL로 직접 fetch
    if ((!tsvText || tsvText.length < 10) && downloadUrl) {
      try {
        console.log(`[Sync] ${customerId}: URL로 직접 다운로드 시도: ${downloadUrl.substring(0, 80)}`);
        const res = await fetch(downloadUrl);
        tsvText = await res.text();
        console.log(`[Sync] ${customerId}: URL 다운로드 결과: ${tsvText.length}자`);
      } catch (e) {
        console.error(`[Sync] ${customerId}: URL 다운로드 실패`, e);
      }
    }

    if (!tsvText || tsvText.length < 10) {
      console.log(`[Sync] ${customerId}: 보고서 데이터 없음 (${tsvText?.length || 0}자) → 키워드 개별 조회`);
      return await syncViaKeywords(naverAds, accountId, customerId, syncDate);
    }

    // 4. TSV 파싱
    const lines = tsvText.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      return await syncViaKeywords(naverAds, accountId, customerId, syncDate);
    }

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

      const keywordId = row['nccKeywordId'] || row['keywordId'] || row['nccCriterionId'] || '';
      const keywordText = row['keyword'] || row['criterionValue'] || row['keywordName'] || '';
      if (!keywordId && !keywordText) continue;

      const impressions = parseInt(row['impCnt'] || row['impressions'] || '0') || 0;
      const clicks = parseInt(row['clkCnt'] || row['clicks'] || '0') || 0;
      const cost = parseInt(row['salesAmt'] || row['cost'] || '0') || 0;

      // 캠페인 유형 매핑
      const rawCampType = row['campaignTp'] || row['campaignType'] || '';
      const campaignTypeLabel = rawCampType === 'WEB_SITE' || rawCampType === '1' ? '파워링크'
        : rawCampType === 'SHOPPING' || rawCampType === '2' ? '쇼핑검색'
        : rawCampType === 'POWER_CONTENTS' || rawCampType === '3' ? '파워컨텐츠'
        : rawCampType === 'BRAND_SEARCH' || rawCampType === '4' ? '브랜드검색'
        : rawCampType === 'PLACE' || rawCampType === '6' ? '플레이스'
        : rawCampType || row['campaignName'] || '';

      rows.push({
        accountId,
        campaignId: row['nccCampaignId'] || row['campaignId'] || '',
        campaignName: campaignTypeLabel,
        adGroupId: row['nccAdgroupId'] || row['adgroupId'] || '',
        adGroupName: row['adgroupName'] || row['nccAdgroupName'] || '',
        keywordId: keywordId || `report-${keywordText}`,
        keywordText: keywordText || '-',
        date: new Date(syncDate + 'T00:00:00.000Z'),
        impressions,
        clicks,
        cost,
        cpc: clicks > 0 ? Math.round(cost / clicks) : 0,
        ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0,
      });
    }

    console.log(`[Sync] ${customerId}: StatReport ${rows.length}행 파싱 완료`);

    // 5. DB 저장
    if (rows.length > 0) {
      await prisma.keywordDailyStat.deleteMany({
        where: { accountId, date: new Date(syncDate + 'T00:00:00.000Z'), keywordId: { not: { startsWith: 'csv-' } } },
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
      where: { accountId_date: { accountId, date: new Date(syncDate) } },
      update: { status: 'SUCCESS', keywordCount: rows.length },
      create: { accountId, date: new Date(syncDate), status: 'SUCCESS', keywordCount: rows.length },
    });

    console.log(`[Sync] ${customerId}: StatReport 수집 완료! ${rows.length}개 키워드`);
    return { success: true, keywordCount: rows.length };
  } catch (error) {
    console.error(`[Sync] ${customerId}: StatReport 오류`, error);
    return await syncViaKeywords(naverAds, accountId, customerId, syncDate);
  }
}

// 폴백: 키워드 개별 조회 방식
async function syncViaKeywords(naverAds: NaverAdsService, accountId: string, customerId: string, syncDate: string) {
  console.log(`[Sync] ${customerId}: 키워드 개별 조회 방식으로 수집`);
  const fields = ['impCnt', 'clkCnt', 'salesAmt'];
  const timeRange = { since: syncDate, until: syncDate };

  const campResult = await naverAds.getCampaigns();
  if (!campResult.success || !Array.isArray(campResult.data)) {
    return { error: '캠페인 목록 조회 실패' };
  }

  const campaigns = campResult.data as Record<string, unknown>[];
  let totalKeywords = 0;

  for (const camp of campaigns) {
    const campId = (camp.nccCampaignId || camp.campaignId) as string;
    const campType = (camp.campaignTp || camp.campaignType || '') as string;
    const campaignTypeLabel = campType === 'WEB_SITE' ? '파워링크'
      : campType === 'SHOPPING' ? '쇼핑검색'
      : campType === 'POWER_CONTENTS' ? '파워컨텐츠'
      : campType === 'BRAND_SEARCH' ? '브랜드검색'
      : campType === 'PLACE' ? '플레이스'
      : campType || (camp.name as string) || '';

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

    // KST 기준 어제 날짜
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const yesterdayKST = new Date(nowKST);
    yesterdayKST.setDate(yesterdayKST.getDate() - 1);
    const syncDate = date || yesterdayKST.toISOString().slice(0, 10);

    // 이미 수집했는지 확인
    const existing = await prisma.syncLog.findUnique({
      where: { accountId_date: { accountId, date: new Date(syncDate) } },
    });

    if (existing && !force) {
      return NextResponse.json({ message: `${syncDate} 데이터는 이미 수집되었습니다.`, skipped: true });
    }

    // 강제 재수집: 기존 데이터 삭제
    if (existing && force) {
      await prisma.syncLog.delete({ where: { accountId_date: { accountId, date: new Date(syncDate) } } });
      await prisma.keywordDailyStat.deleteMany({
        where: { accountId, date: new Date(syncDate + 'T00:00:00.000Z'), keywordId: { not: { startsWith: 'csv-' } } },
      });
      console.log(`[Sync] ${customerId}: ${syncDate} 기존 데이터 삭제 (강제 재수집)`);
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });

    // 백그라운드에서 StatReport 수집 실행 (응답은 바로 반환)
    syncViaStatReport(naverAds, accountId, customerId, syncDate).catch((e) => {
      console.error(`[Sync] ${customerId}: 백그라운드 수집 실패`, e);
    });

    return NextResponse.json({
      message: `${syncDate} 데이터 수집을 시작했습니다. 백그라운드에서 처리 중입니다.`,
      processing: true,
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: '데이터 수집 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
