import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { NaverAdsService } from '@/services/naver-ads.service';
import { budgetAdjustSchema } from '@/lib/validators';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const { id } = await params;
  const body = await req.json();

  const parsed = budgetAdjustSchema.safeParse({ campaignId: id, dailyBudget: body.dailyBudget });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const campaign = await prisma.campaign.findFirst({
    where: { id, account: { userId } },
    include: { account: true },
  });

  if (!campaign) return NextResponse.json({ error: '캠페인을 찾을 수 없습니다.' }, { status: 404 });

  const naverAds = new NaverAdsService({
    apiKey: campaign.account.apiKey,
    secretKey: campaign.account.secretKey,
    customerId: campaign.account.customerId,
  });

  const result = await naverAds.updateCampaignBudget(campaign.naverCampaignId, parsed.data.dailyBudget);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

  const updated = await prisma.campaign.update({
    where: { id },
    data: { dailyBudget: parsed.data.dailyBudget },
  });

  await prisma.actionLog.create({
    data: {
      userId,
      action: 'UPDATE_BUDGET',
      entityType: 'CAMPAIGN',
      entityId: id,
      details: JSON.stringify({ oldBudget: campaign.dailyBudget, newBudget: parsed.data.dailyBudget }),
    },
  });

  return NextResponse.json(updated);
}
