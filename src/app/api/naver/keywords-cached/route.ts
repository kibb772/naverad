import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { accountId, since, until } = await req.json();

    if (!accountId || !since || !until) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    // DB에서 날짜 범위의 키워드 통계 합산
    const stats = await prisma.keywordDailyStat.groupBy({
      by: ['keywordId', 'keywordText', 'campaignName', 'adGroupName'],
      where: {
        accountId,
        date: { gte: new Date(since), lte: new Date(until) },
      },
      _sum: { impressions: true, clicks: true, cost: true },
    });

    const keywords = stats.map((s) => ({
      id: s.keywordId,
      text: s.keywordText,
      campaignName: s.campaignName,
      adGroupName: s.adGroupName,
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
      where: { accountId, date: { gte: new Date(since), lte: new Date(until) } },
      orderBy: { date: 'desc' },
    });

    return NextResponse.json({
      keywords: keywords.slice(0, 30),
      totalKeywords: keywords.length,
      syncedDays: syncLogs.length,
      lastSync: syncLogs[0]?.date || null,
    });
  } catch (error) {
    console.error('Keywords cached error:', error);
    return NextResponse.json({ error: '키워드 데이터 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
