import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { generateDailyReport } from '@/services/ai-analysis.service';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const campaigns = await prisma.campaign.findMany({
    where: { account: { userId }, status: 'ACTIVE' },
    include: {
      metrics: { where: { entityType: 'CAMPAIGN' }, orderBy: { date: 'desc' }, take: 30 },
    },
  });

  const metricsForReport = campaigns.map((c) => {
    const today = c.metrics[0] || { impressions: 0, clicks: 0, ctr: 0, cpc: 0, conversions: 0, roas: 0 };
    const last7 = c.metrics.slice(0, 7);
    const last30 = c.metrics;

    const avg = (arr: typeof last7, field: keyof typeof today) =>
      arr.length > 0 ? arr.reduce((s, m) => s + Number(m[field] ?? 0), 0) / arr.length : 0;

    return {
      campaignName: c.name,
      today: {
        impressions: today.impressions,
        clicks: today.clicks,
        ctr: Number(today.ctr),
        cpc: Number(today.cpc),
        conversions: today.conversions,
        roas: Number(today.roas),
      },
      avg7d: {
        impressions: avg(last7, 'impressions'),
        clicks: avg(last7, 'clicks'),
        ctr: avg(last7, 'ctr'),
        cpc: avg(last7, 'cpc'),
        conversions: avg(last7, 'conversions'),
        roas: avg(last7, 'roas'),
      },
      avg30d: {
        impressions: avg(last30, 'impressions'),
        clicks: avg(last30, 'clicks'),
        ctr: avg(last30, 'ctr'),
        cpc: avg(last30, 'cpc'),
        conversions: avg(last30, 'conversions'),
        roas: avg(last30, 'roas'),
      },
    };
  });

  const report = await generateDailyReport(metricsForReport);
  return NextResponse.json(report);
}
