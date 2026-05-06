import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId } = await req.json();

    if (!apiKey || !secretKey || !customerId) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });
    const result = await naverAds.getBizmoney();

    if (!result.success) {
      return NextResponse.json({ error: result.error || '비즈머니 조회 실패' }, { status: 500 });
    }

    const data = result.data as Record<string, unknown>;
    const bizmoney = (data?.bizmoney ?? data?.balance ?? data?.amount ?? 0) as number;

    return NextResponse.json({ bizmoney });
  } catch (error) {
    console.error('Bizmoney error:', error);
    return NextResponse.json({ error: '비즈머니 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
