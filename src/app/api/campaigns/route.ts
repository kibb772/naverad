import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { NaverAdsService } from '@/services/naver-ads.service';
import { campaignCreateSchema } from '@/lib/validators';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const campaigns = await prisma.campaign.findMany({
    where: { account: { userId } },
    include: {
      adGroups: { include: { keywords: true } },
      metrics: { orderBy: { date: 'desc' }, take: 7, where: { entityType: 'CAMPAIGN' } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json(campaigns);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const body = await req.json();
  const parsed = campaignCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const account = await prisma.naverAdsAccount.findFirst({ where: { userId, isActive: true } });
  if (!account) return NextResponse.json({ error: '연동된 광고 계정이 없습니다.' }, { status: 404 });

  const naverAds = new NaverAdsService({
    apiKey: account.apiKey,
    secretKey: account.secretKey,
    customerId: account.customerId,
  });

  const result = await naverAds.createCampaign(parsed.data);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

  const naverData = result.data as { nccCampaignId: string };

  const campaign = await prisma.campaign.create({
    data: {
      accountId: account.id,
      naverCampaignId: naverData.nccCampaignId,
      name: parsed.data.name,
      dailyBudget: parsed.data.dailyBudget,
      campaignType: parsed.data.campaignType,
    },
  });

  await prisma.actionLog.create({
    data: { userId, action: 'CREATE_CAMPAIGN', entityType: 'CAMPAIGN', entityId: campaign.id, details: JSON.stringify(parsed.data) },
  });

  return NextResponse.json(campaign, { status: 201 });
}
