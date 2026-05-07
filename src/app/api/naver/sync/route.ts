import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';
import prisma from '@/lib/prisma';

// 캠페인 유형 코드 → 한글 라벨
function getCampaignTypeLabel(camp: Record<string, unknown>): string {
  const campType = (camp.campaignTp || camp.campaignType || '') as string;
  if (campType === 'WEB_SITE') return '파워링크';
  if (campType === 'SHOPPING') return '쇼핑검색';
  if (campType === 'POWER_CONTENTS') return '파워컨텐츠';
  if (campType === 'BRAND_SEARCH') return '브랜드검색';
  if (campType === 'PLACE') return '플레이스';
  // 숫자 코드
  if (campType === '1') return '파워링크';
  if (campType === '2') return '쇼핑검색';
  if (campType === '3') return '파워컨텐츠';
  if (campType === '4') return '브랜드검색';
  if (campType === '6') return '플레이스';
  return campType || '';
}

// 백그라운드에서 키워드 수집 실행
async function syncKeywords(naverAds: NaverAdsService, accountId: string, customerId: string, syncDate: string) {
  try {
    console.log(`[Sync] ${customerId}: 키워드 수집 시작 (${syncDate})`);
    const fields = ['impCnt', 'clkCnt', 'salesAmt'];
    const timeRange = { since: syncDate, until: syncDate };

    const campResult = await naverAds.getCampaigns();
    if (!campResult.success || !Array.isArray(campResult.data)) {
      console.error(`[Sync] ${customerId}: 캠페인 목록 조회 실패`);
      return { error: '캠페인 목록 조회 실패' };
    }

    const campaigns = campResult.data as Record<string, unknown>[];
    let totalKeywords = 0;

    for (const camp of campaigns) {
      const campId = (camp.nccCampaignId || camp.campaignId) as string;
      const campaignTypeLabel = getCampaignTypeLabel(camp);

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

    console.log(`[Sync] ${customerId}: 수집 완료! ${totalKeywords}개 키워드`);
    return { success: true, keywordCount: totalKeywords };
  } catch (error) {
    console.error(`[Sync] ${customerId}: 수집 오류`, error);
    return { error: '수집 실패' };
  }
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

    // 백그라운드에서 수집 실행 (응답은 바로 반환)
    syncKeywords(naverAds, accountId, customerId, syncDate).catch((e) => {
      console.error(`[Sync] ${customerId}: 백그라운드 수집 실패`, e);
    });

    return NextResponse.json({
      message: `${syncDate} 데이터 수집을 시작했습니다. 잠시 후 새로고침하면 반영됩니다.`,
      processing: true,
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: '데이터 수집 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
