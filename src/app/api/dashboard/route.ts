import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const userId = (session.user as { id: string }).id;

  try {
    const accounts = await prisma.naverAdsAccount.findMany({
      where: { userId, isActive: true },
      include: {
        campaigns: {
          include: {
            metrics: {
              where: { entityType: 'CAMPAIGN' },
              orderBy: { date: 'desc' },
              take: 30,
            },
          },
        },
      },
    });

    const alerts = await prisma.alert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { diagnosis: true },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayMetrics = await prisma.dailyMetric.findMany({
      where: { date: today, entityType: 'CAMPAIGN' },
    });

    const totalImpressions = todayMetrics.reduce((sum: number, m) => sum + m.impressions, 0);
    const totalClicks = todayMetrics.reduce((sum: number, m) => sum + m.clicks, 0);
    const totalCost = todayMetrics.reduce((sum: number, m) => sum + m.cost, 0);
    const totalConversions = todayMetrics.reduce((sum: number, m) => sum + m.conversions, 0);

    return NextResponse.json({
      summary: {
        impressions: totalImpressions,
        clicks: totalClicks,
        ctr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0',
        cpc: totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0,
        conversions: totalConversions,
        cost: totalCost,
        roas: totalCost > 0 ? Math.round((totalConversions * 10000 / totalCost) * 100) : 0,
      },
      accounts,
      alerts,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: '데이터를 불러오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
