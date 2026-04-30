import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId } = await req.json();

    if (!apiKey || !secretKey || !customerId) {
      return NextResponse.json({ error: '모든 필드를 입력해주세요.' }, { status: 400 });
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });

    // 1. 계정 정보 가져오기 (계정 이름 포함)
    let accountName = `네이버 광고 (${customerId})`;
    const memberResult = await naverAds.getAccountInfo();
    console.log('[Naver Verify] Member API response:', JSON.stringify(memberResult));
    if (memberResult.success && memberResult.data) {
      const memberData = memberResult.data as Record<string, unknown>;
      console.log('[Naver Verify] Member data keys:', Object.keys(memberData));
      // 네이버 API 응답에서 계정 이름 추출 - 다양한 필드 시도
      const nameCandidate = memberData.loginId || memberData.name || memberData.username 
        || memberData.memberName || memberData.nickName || memberData.displayName
        || memberData.advertiserName || memberData.companyName;
      if (nameCandidate) accountName = nameCandidate as string;
    }

    // 2. 캠페인 목록을 가져와서 API 키가 유효한지 확인
    const campaignsResult = await naverAds.getCampaigns();

    if (!campaignsResult.success) {
      return NextResponse.json({
        error: `네이버 API 연동 실패: ${campaignsResult.error}. 액세스 라이선스, Secret Key, Customer ID를 확인해주세요.`,
      }, { status: 400 });
    }

    // 3. 캠페인 데이터 파싱
    const campaigns = Array.isArray(campaignsResult.data) ? campaignsResult.data : [];

    return NextResponse.json({
      success: true,
      accountName,
      campaigns: campaigns.map((c: Record<string, unknown>) => ({
        naverCampaignId: c.nccCampaignId || c.campaignId,
        name: c.name,
        status: c.userLock ? 'PAUSED' : 'ACTIVE',
        dailyBudget: c.dailyBudget || 0,
        campaignType: c.campaignTp,
      })),
    });
  } catch (error) {
    console.error('Naver verify error:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
