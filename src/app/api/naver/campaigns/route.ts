import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId } = await req.json();

    if (!apiKey || !secretKey || !customerId) {
      return NextResponse.json({ error: '인증 정보가 누락되었습니다.', detail: { apiKey: !!apiKey, secretKey: !!secretKey, customerId: !!customerId } }, { status: 400 });
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });
    const result = await naverAds.getCampaigns();
    console.log('[Naver Campaigns] API result:', JSON.stringify(result).slice(0, 500));

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const campaigns = Array.isArray(result.data) ? result.data : [];

    // 각 캠페인의 광고그룹과 키워드도 가져오기
    const enrichedCampaigns = await Promise.all(
      campaigns.map(async (c: Record<string, unknown>) => {
        const campaignId = (c.nccCampaignId || c.campaignId) as string;
        const adGroupsResult = await naverAds.getAdGroups(campaignId);
        const adGroups = adGroupsResult.success && Array.isArray(adGroupsResult.data)
          ? adGroupsResult.data
          : [];

        return {
          naverCampaignId: campaignId,
          name: c.name,
          status: c.userLock ? 'PAUSED' : 'ACTIVE',
          dailyBudget: c.dailyBudget || 0,
          campaignType: c.campaignTp,
          adGroups: (adGroups as Record<string, unknown>[]).map((ag) => ({
            naverAdGroupId: ag.nccAdgroupId,
            name: ag.name,
            status: ag.userLock ? 'PAUSED' : 'ACTIVE',
          })),
        };
      })
    );

    return NextResponse.json({ campaigns: enrichedCampaigns });
  } catch (error) {
    console.error('Naver campaigns error:', error);
    return NextResponse.json({ error: '캠페인 데이터를 가져오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
