import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const accounts = await prisma.naverAdsAccount.findMany({
    where: { userId },
    select: {
      id: true,
      accountName: true,
      customerId: true,
      apiKey: true,
      secretKey: true,
      isActive: true,
      dailyBudgetGoal: true,
      syncStatus: true,
      lastSyncAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(accounts);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const body = await req.json();
  const { accountName, apiKey, secretKey, customerId } = body;

  if (!apiKey || !secretKey || !customerId) {
    return NextResponse.json({ error: '필수 항목을 입력해주세요.' }, { status: 400 });
  }

  const account = await prisma.naverAdsAccount.create({
    data: {
      userId,
      accountName: accountName || `네이버 광고 (${customerId})`,
      apiKey,
      secretKey,
      customerId,
      isActive: true,
      syncStatus: 'ready',
    },
  });

  return NextResponse.json({
    id: account.id,
    accountName: account.accountName,
    customerId: account.customerId,
    apiKey: account.apiKey,
    secretKey: account.secretKey,
    isActive: account.isActive,
    syncStatus: account.syncStatus,
    dailyBudgetGoal: account.dailyBudgetGoal,
    createdAt: account.createdAt,
  }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

  // 본인 계정인지 확인
  const account = await prisma.naverAdsAccount.findFirst({ where: { id, userId } });
  if (!account) return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 });

  const updated = await prisma.naverAdsAccount.update({
    where: { id },
    data: {
      ...(updates.accountName !== undefined && { accountName: updates.accountName }),
      ...(updates.dailyBudgetGoal !== undefined && { dailyBudgetGoal: updates.dailyBudgetGoal }),
      ...(updates.syncStatus !== undefined && { syncStatus: updates.syncStatus }),
      ...(updates.isActive !== undefined && { isActive: updates.isActive }),
    },
  });

  return NextResponse.json({ id: updated.id, syncStatus: updated.syncStatus });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

  const account = await prisma.naverAdsAccount.findFirst({ where: { id, userId } });
  if (!account) return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 });

  await prisma.naverAdsAccount.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
