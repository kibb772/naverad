import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { NaverAdsService } from '@/services/naver-ads.service';
import PDFDocument from 'pdfkit';
import path from 'path';

function cleanAccountName(name: string): string {
  return name.replace(/주식회사/g, '').replace(/\(주\)/g, '').replace(/㈜/g, '').replace(/\s+/g, ' ').trim() || name;
}

function splitDateRange(since: string, until: string): { since: string; until: string }[] {
  const ranges: { since: string; until: string }[] = [];
  let start = new Date(since);
  const end = new Date(until);
  while (start <= end) {
    const chunkEnd = new Date(start);
    chunkEnd.setDate(chunkEnd.getDate() + 89);
    const actualEnd = chunkEnd > end ? end : chunkEnd;
    ranges.push({ since: start.toISOString().slice(0, 10), until: actualEnd.toISOString().slice(0, 10) });
    start = new Date(actualEnd);
    start.setDate(start.getDate() + 1);
  }
  return ranges;
}

export async function POST(req: NextRequest) {
  try {
    const { accountId, since, until } = await req.json();
    if (!accountId || !since || !until) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const account = await prisma.naverAdsAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 });
    }

    const displayName = cleanAccountName(account.accountName);
    const naverAds = new NaverAdsService({
      apiKey: account.apiKey, secretKey: account.secretKey, customerId: account.customerId,
    });

    // 비즈머니 잔액
    let bizmoney: number | null = null;
    try {
      const biz = await Promise.race([
        naverAds.getBizmoney(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]) as { success: boolean; data?: Record<string, unknown> };
      if (biz.success && biz.data) bizmoney = (biz.data.bizmoney ?? biz.data.balance ?? 0) as number;
    } catch { /* */ }

    // 캠페인 목록 (네이버 API 직접 호출 - 대시보드와 동일)
    const campResult = await naverAds.getCampaigns();
    const rawCampaigns = (campResult.success && Array.isArray(campResult.data)) ? campResult.data as Record<string, unknown>[] : [];

    const campaignList = rawCampaigns.map((c) => ({
      id: (c.nccCampaignId || c.campaignId) as string,
      name: c.name as string,
      type: (c.campaignTp as string) || '-',
      status: c.userLock ? 'PAUSED' : 'ACTIVE',
      dailyBudget: (c.dailyBudget as number) || 0,
    }));

    // 캠페인별 통계 (네이버 Stats API - 대시보드와 동일)
    const fields = ['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc', 'ccnt'];
    const dateChunks = splitDateRange(since, until);

    const statsMap: Record<string, { impressions: number; clicks: number; cost: number }> = {};
    await Promise.all(campaignList.map(async (camp) => {
      let totalImp = 0, totalClk = 0, totalCost = 0;
      for (const chunk of dateChunks) {
        try {
          const r = await naverAds.getStats({ id: camp.id, fields, timeRange: chunk });
          if (r.success && r.data) {
            const raw = r.data as Record<string, unknown>;
            const rows: Record<string, unknown>[] = Array.isArray(raw) ? raw : (Array.isArray(raw.data) ? raw.data as Record<string, unknown>[] : []);
            for (const row of rows) {
              if (row.summary) {
                const s = row.summary as Record<string, number>;
                totalImp += s.impCnt || 0; totalClk += s.clkCnt || 0; totalCost += s.salesAmt || 0;
              } else {
                totalImp += (row.impCnt as number) || 0; totalClk += (row.clkCnt as number) || 0; totalCost += (row.salesAmt as number) || 0;
              }
            }
          }
        } catch { /* */ }
      }
      statsMap[camp.id] = { impressions: totalImp, clicks: totalClk, cost: totalCost };
    }));

    // 캠페인 행 데이터
    const campaignRows = campaignList.map((c) => {
      const s = statsMap[c.id] || { impressions: 0, clicks: 0, cost: 0 };
      return {
        type: c.type, name: c.name, status: c.status,
        cost: s.cost, impressions: s.impressions, clicks: s.clicks,
        ctr: s.impressions > 0 ? +((s.clicks / s.impressions) * 100).toFixed(2) : 0,
        cpc: s.clicks > 0 ? Math.round(s.cost / s.clicks) : 0,
      };
    }).sort((a, b) => b.cost - a.cost);

    const totalCost = campaignRows.reduce((s, c) => s + c.cost, 0);
    const totalImpressions = campaignRows.reduce((s, c) => s + c.impressions, 0);
    const totalClicks = campaignRows.reduce((s, c) => s + c.clicks, 0);
    const totalCtr = totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(2) : 0;
    const totalCpc = totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0;

    // Top 10 키워드 (KeywordDailyStat DB에서)
    const sinceDate = new Date(since + 'T00:00:00.000Z');
    const untilDate = new Date(until + 'T23:59:59.999Z');
    const kwStats = await prisma.keywordDailyStat.groupBy({
      by: ['keywordText', 'campaignName'],
      where: { accountId, date: { gte: sinceDate, lte: untilDate } },
      _sum: { impressions: true, clicks: true, cost: true },
    });
    const keywords = kwStats
      .map((s) => ({
        text: s.keywordText, campaignName: s.campaignName,
        clicks: s._sum.clicks || 0, impressions: s._sum.impressions || 0, cost: s._sum.cost || 0,
        ctr: (s._sum.impressions || 0) > 0 ? +(((s._sum.clicks || 0) / (s._sum.impressions || 0)) * 100).toFixed(2) : 0,
        cpc: (s._sum.clicks || 0) > 0 ? Math.round((s._sum.cost || 0) / (s._sum.clicks || 0)) : 0,
      }))
      .sort((a, b) => b.clicks - a.clicks || b.cost - a.cost)
      .slice(0, 10);

    // === PDF 생성 (1페이지 단일) ===
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NanumGothic.ttf');
    doc.registerFont('Korean', fontPath);
    doc.font('Korean');

    const navy = '#1e2a4a';
    const blue = '#2563eb';
    const gray = '#64748b';
    const lightBg = '#f8fafc';
    const white = '#ffffff';
    const red = '#dc2626';
    const green = '#16a34a';

    // 헤더
    doc.rect(0, 0, 595, 70).fill(navy);
    doc.font('Korean').fontSize(16).fillColor(white).text('열끈마케팅 광고 보고서', 40, 20);
    doc.fontSize(9).fillColor('#94a3b8').text(`${displayName}  |  ${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 40, 45);

    // 핵심 지표 카드 (6개 가로)
    const cardY = 82;
    const cardW = 82;
    const cardGap = 5;
    const cards = [
      { label: '소진', value: `₩${totalCost.toLocaleString()}` },
      { label: '노출수', value: totalImpressions.toLocaleString() },
      { label: '클릭수', value: totalClicks.toLocaleString() },
      { label: 'CTR', value: `${totalCtr}%` },
      { label: 'CPC', value: `₩${totalCpc.toLocaleString()}` },
      { label: '비즈머니', value: bizmoney !== null ? `₩${Math.floor(bizmoney).toLocaleString()}` : '조회불가' },
    ];
    cards.forEach((c, i) => {
      const x = 40 + i * (cardW + cardGap);
      doc.rect(x, cardY, cardW, 40).fill(lightBg);
      doc.font('Korean').fontSize(6.5).fillColor(gray).text(c.label, x + 6, cardY + 6);
      const color = (c.label === '비즈머니' && bizmoney !== null && bizmoney <= 0) ? red : navy;
      doc.font('Korean').fontSize(10).fillColor(color).text(c.value, x + 6, cardY + 20, { width: cardW - 12 });
    });

    // 캠페인별 성과 테이블
    const tY = 135;
    doc.font('Korean').fontSize(8).fillColor(navy).text('캠페인별 성과', 40, tY);
    const cH = ['유형', '캠페인', '상태', '소진', '노출', '클릭', 'CTR', 'CPC'];
    const cX = [40, 90, 230, 275, 335, 390, 435, 485];
    const hY = tY + 14;
    doc.rect(40, hY, 515, 14).fill('#e2e8f0');
    cH.forEach((h, i) => { doc.font('Korean').fontSize(6).fillColor('#475569').text(h, cX[i], hY + 4); });

    let rY = hY + 17;
    // 합계 행
    doc.font('Korean').fontSize(6).fillColor(navy);
    doc.text('—', cX[0], rY);
    doc.text('합계', cX[1], rY);
    doc.text(`${campaignRows.length}개`, cX[2], rY);
    doc.text(`₩${totalCost.toLocaleString()}`, cX[3], rY);
    doc.text(totalImpressions.toLocaleString(), cX[4], rY);
    doc.text(totalClicks.toLocaleString(), cX[5], rY);
    doc.text(`${totalCtr}%`, cX[6], rY);
    doc.text(`₩${totalCpc.toLocaleString()}`, cX[7], rY);
    rY += 14;

    const maxRows = Math.min(campaignRows.length, 15);
    for (let i = 0; i < maxRows; i++) {
      const c = campaignRows[i];
      doc.font('Korean').fontSize(6).fillColor(navy);
      doc.text(c.type.length > 8 ? c.type.slice(0, 7) + '..' : c.type, cX[0], rY, { width: 48 });
      doc.text(c.name.length > 18 ? c.name.slice(0, 17) + '..' : c.name, cX[1], rY, { width: 138 });
      doc.fillColor(c.status === 'ACTIVE' ? green : red).text(c.status === 'ACTIVE' ? '운영중' : '중지', cX[2], rY);
      doc.fillColor(navy);
      doc.text(`₩${c.cost.toLocaleString()}`, cX[3], rY);
      doc.text(c.impressions.toLocaleString(), cX[4], rY);
      doc.text(c.clicks.toLocaleString(), cX[5], rY);
      doc.text(`${c.ctr}%`, cX[6], rY);
      doc.text(`₩${c.cpc.toLocaleString()}`, cX[7], rY);
      rY += 13;
    }
    if (campaignRows.length > maxRows) {
      doc.font('Korean').fontSize(5.5).fillColor(gray).text(`... 외 ${campaignRows.length - maxRows}개`, 40, rY);
      rY += 10;
    }

    // 클릭 Top 키워드 테이블
    const kwY = rY + 14;
    doc.font('Korean').fontSize(8).fillColor(navy).text('클릭 Top 키워드', 40, kwY);
    const kwH = ['#', '키워드', '캠페인', '클릭', '노출', 'CTR', 'CPC', '소진'];
    const kwX = [40, 55, 160, 280, 330, 385, 430, 480];
    const kwHY = kwY + 14;
    doc.rect(40, kwHY, 515, 14).fill('#e2e8f0');
    kwH.forEach((h, i) => { doc.font('Korean').fontSize(6).fillColor('#475569').text(h, kwX[i], kwHY + 4); });

    let kwRY = kwHY + 17;
    keywords.forEach((kw, i) => {
      const color = i < 3 ? blue : navy;
      doc.font('Korean').fontSize(6).fillColor(color);
      doc.text(`${i + 1}`, kwX[0], kwRY);
      doc.text(kw.text.length > 14 ? kw.text.slice(0, 13) + '..' : kw.text, kwX[1], kwRY, { width: 100 });
      doc.fillColor(gray).text(
        (kw.campaignName || '-').length > 15 ? (kw.campaignName || '-').slice(0, 14) + '..' : (kw.campaignName || '-'),
        kwX[2], kwRY, { width: 115 }
      );
      doc.fillColor(color);
      doc.text(kw.clicks.toLocaleString(), kwX[3], kwRY);
      doc.text(kw.impressions.toLocaleString(), kwX[4], kwRY);
      doc.text(`${kw.ctr}%`, kwX[5], kwRY);
      doc.text(`₩${kw.cpc.toLocaleString()}`, kwX[6], kwRY);
      doc.text(`₩${kw.cost.toLocaleString()}`, kwX[7], kwRY);
      kwRY += 13;
    });

    // 푸터
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    doc.font('Korean').fontSize(6).fillColor('#94a3b8');
    doc.text(`생성일: ${today}  |  ⓒ 열끈마케팅 · 키로 광고 관리 시스템`, 40, 800, { width: 515, align: 'center' });

    doc.end();
    const pdfBuffer = await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(displayName)}_report_${since}_${until}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF report error:', error);
    return NextResponse.json({ error: '보고서 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
