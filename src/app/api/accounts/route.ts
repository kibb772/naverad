import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { naverAdsAccountSchema } from '@/lib/validators';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const accounts = await prisma.naverAdsAccount.findMany({
    where: { userId },
    select: { id: true, customerId: true, isActive: true, lastSyncAt: true, createdAt: true },
  });

  return NextResponse.json(accounts);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const body = await req.json();
  const parsed = naverAdsAccountSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const account = await prisma.naverAdsAccount.create({
    data: { userId, ...parsed.data },
  });

  return NextResponse.json({ id: account.id, customerId: account.customerId }, { status: 201 });
}
