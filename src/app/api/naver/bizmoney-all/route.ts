import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { collectBizmoneyResults, classifyBizmoneyResults } from '@/lib/bizmoney-report';

export const dynamic = 'force-dynamic';

// 잔액은 자주 변하지 않는데 새로고침할 때마다 계정 수만큼 네이버를 두드리면
// 레이트 리밋에 걸린다. 짧게 캐시하고, 사용자가 명시적으로 새로고침하면 무시한다.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; payload: unknown }>();

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const force = new URL(req.url).searchParams.get('force') === '1';

  const cached = cache.get(userId);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...(cached.payload as object), cached: true });
  }

  try {
    const accounts = await prisma.naverAdsAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { accountName: true, apiKey: true, secretKey: true, customerId: true },
    });

    const results = await collectBizmoneyResults(accounts);
    const { lowBalance, normal, failed, threshold } = classifyBizmoneyResults(results);

    const payload = {
      lowBalance,
      normal,
      failed,
      threshold,
      totalAccounts: results.length,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(userId, { at: Date.now(), payload });

    return NextResponse.json({ ...payload, cached: false });
  } catch (error) {
    console.error('Bizmoney all error:', error);
    return NextResponse.json({ error: '잔액 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
