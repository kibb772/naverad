import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { NaverAdsService } from '@/services/naver-ads.service';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const { id } = await params;
  const { status } = await req.json();

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

  const result = await naverAds.updateCampaignStatus(
    campaign.naverCampaignId,
    status === 'ACTIVE' ? 'ELIGIBLE' : 'PAUSED'
  );

  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

  const updated = await prisma.campaign.update({
    where: { id },
    data: { status },
  });

  await prisma.actionLog.create({
    data: { userId, action: 'TOGGLE_CAMPAIGN', entityType: 'CAMPAIGN', entityId: id, details: JSON.stringify({ status }) },
  });

  return NextResponse.json(updated);
}
