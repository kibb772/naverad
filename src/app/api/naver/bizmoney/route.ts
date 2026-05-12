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

    // 마지막 충전일 조회
    let lastChargeDate: string | null = null;
    try {
      const chargeResult = await naverAds.getBizmoneyCharges();
      if (chargeResult.success && Array.isArray(chargeResult.data) && chargeResult.data.length > 0) {
        const charges = chargeResult.data as Record<string, unknown>[];
        // 가장 최근 충전 날짜
        const latest = charges[0];
        lastChargeDate = (latest.chargeDt || latest.chargeDate || latest.regDt || latest.date || '') as string;
      }
    } catch { /* 충전 이력 조회 실패해도 잔액은 반환 */ }

    return NextResponse.json({ bizmoney, lastChargeDate });
  } catch (error) {
    console.error('Bizmoney error:', error);
    return NextResponse.json({ error: '비즈머니 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
