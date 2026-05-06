import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { accountId, since, until } = await req.json();

    if (!accountId || !since || !until) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    // DB에서 날짜 범위의 키워드 통계 합산
    // 날짜를 UTC 자정으로 맞춰서 비교 (시간대 이슈 방지)
    const sinceDate = new Date(since + 'T00:00:00.000Z');
    const untilDate = new Date(until + 'T23:59:59.999Z');

    // 키워드 텍스트 + 캠페인유형 기준으로 합산 (캠페인별 구분)
    const stats = await prisma.keywordDailyStat.groupBy({
      by: ['keywordText', 'campaignName'],
      where: {
        accountId,
        date: { gte: sinceDate, lte: untilDate },
      },
      _sum: { impressions: true, clicks: true, cost: true },
    });

    const keywords = stats.map((s) => ({
      id: `${s.keywordText}-${s.campaignName}`,
      text: s.keywordText,
      campaignName: s.campaignName || '',
      adGroupName: '',
      cost: s._sum.cost || 0,
      impressions: s._sum.impressions || 0,
      clicks: s._sum.clicks || 0,
      ctr: (s._sum.impressions || 0) > 0 ? +(((s._sum.clicks || 0) / (s._sum.impressions || 0)) * 100).toFixed(2) : 0,
      cpc: (s._sum.clicks || 0) > 0 ? Math.round((s._sum.cost || 0) / (s._sum.clicks || 0)) : 0,
    }));

    // 클릭 순 정렬, 상위 30개
    keywords.sort((a, b) => b.clicks - a.clicks);

    // 수집된 날짜 목록 확인
    const syncLogs = await prisma.syncLog.findMany({
      where: { accountId, date: { gte: sinceDate, lte: untilDate } },
      orderBy: { date: 'desc' },
    });

    console.log(`[Keywords Cached] accountId=${accountId}, since=${sinceDate.toISOString()}, until=${untilDate.toISOString()}, keywords=${keywords.length}, syncDays=${syncLogs.length}`);

    // 디버그: 해당 계정의 전체 KeywordDailyStat 개수 확인
    const totalRows = await prisma.keywordDailyStat.count({ where: { accountId } });
    const csvRows = await prisma.keywordDailyStat.count({ where: { accountId, keywordId: { startsWith: 'csv-' } } });
    console.log(`[Keywords Cached] DB 확인: accountId=${accountId}, 전체=${totalRows}행, CSV=${csvRows}행`);

    return NextResponse.json({
      keywords: keywords.slice(0, 30),
      totalKeywords: keywords.length,
      syncedDays: syncLogs.length,
      lastSync: syncLogs[0]?.date || null,
      debug: { accountId, since: sinceDate.toISOString(), until: untilDate.toISOString() },
    });
  } catch (error) {
    console.error('Keywords cached error:', error);
    return NextResponse.json({ error: '키워드 데이터 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
