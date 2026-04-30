import { NextRequest, NextResponse } from 'next/server';
import { NaverAdsService } from '@/services/naver-ads.service';

// 날짜 범위를 최대 90일 단위로 분할 (네이버 검색광고 API 제한)
function splitDateRange(since: string, until: string): { since: string; until: string }[] {
  const ranges: { since: string; until: string }[] = [];
  let start = new Date(since);
  const end = new Date(until);

  while (start <= end) {
    const chunkEnd = new Date(start);
    chunkEnd.setDate(chunkEnd.getDate() + 89);
    const actualEnd = chunkEnd > end ? end : chunkEnd;

    ranges.push({
      since: start.toISOString().slice(0, 10),
      until: actualEnd.toISOString().slice(0, 10),
    });

    start = new Date(actualEnd);
    start.setDate(start.getDate() + 1);
  }

  return ranges;
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, secretKey, customerId, campaignIds, since, until } = await req.json();

    if (!apiKey || !secretKey || !customerId || !campaignIds?.length) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const naverAds = new NaverAdsService({ apiKey, secretKey, customerId });

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

    const sinceDate = since || fmtDate(yesterday);
    const untilDate = until || fmtDate(today);

    const fields = ['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc', 'ccnt'];

    // 날짜 범위를 31일 단위로 분할
    const dateChunks = splitDateRange(sinceDate, untilDate);

    const stats = await Promise.all(
      campaignIds.map(async (id: string) => {
        let totalImp = 0, totalClk = 0, totalSales = 0, totalCcnt = 0;

        // 각 날짜 청크별로 호출
        for (const chunk of dateChunks) {
          try {
            const result = await naverAds.getStats({ id, fields, timeRange: chunk });
            if (result.success && result.data) {
              const rawData = result.data as Record<string, unknown>;
              let rows: Record<string, unknown>[] = [];

              if (Array.isArray(rawData)) {
                rows = rawData;
              } else if (rawData.data && Array.isArray(rawData.data)) {
                rows = rawData.data;
              }

              for (const row of rows) {
                if (row.summary) {
                  const s = row.summary as Record<string, number>;
                  totalImp += s.impCnt || 0;
                  totalClk += s.clkCnt || 0;
                  totalSales += s.salesAmt || 0;
                  totalCcnt += s.ccnt || 0;
                } else {
                  totalImp += (row.impCnt as number) || 0;
                  totalClk += (row.clkCnt as number) || 0;
                  totalSales += (row.salesAmt as number) || 0;
                  totalCcnt += (row.ccnt as number) || 0;
                }
              }
            }
          } catch {
            // 개별 청크 실패 시 무시하고 계속
          }
        }

        return {
          id,
          impCnt: totalImp,
          clkCnt: totalClk,
          salesAmt: totalSales,
          ctr: totalImp > 0 ? +((totalClk / totalImp) * 100).toFixed(2) : 0,
          cpc: totalClk > 0 ? Math.round(totalSales / totalClk) : 0,
          ccnt: totalCcnt,
        };
      })
    );

    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Naver stats error:', error);
    return NextResponse.json({ error: '통계 데이터를 가져오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
