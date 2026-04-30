import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const alerts = await prisma.alert.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { diagnosis: true },
  });

  return NextResponse.json(alerts);
}
