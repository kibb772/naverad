import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { NaverAdsService } from '@/services/naver-ads.service';
import PDFDocument from 'pdfkit';
import path from 'path';

// 계정명에서 '주식회사', '(주)', '㈜' 제거
function cleanAccountName(name: string): string {
  const cleaned = name
    .replace(/주식회사/g, '')
    .replace(/\(주\)/g, '')
    .replace(/㈜/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || name;
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
    const sinceDate = new Date(since + 'T00:00:00.000Z');
    const untilDate = new Date(until + 'T23:59:59.999Z');

    // 비즈머니 잔액 조회
    let bizmoney: number | null = null;
    try {
      const naverAds = new NaverAdsService({
        apiKey: account.apiKey,
        secretKey: account.secretKey,
        customerId: account.customerId,
      });
      const bizResult = await Promise.race([
        naverAds.getBizmoney(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]) as { success: boolean; data?: Record<string, unknown> };
      if (bizResult.success && bizResult.data) {
        bizmoney = (bizResult.data.bizmoney ?? bizResult.data.balance ?? 0) as number;
      }
    } catch { /* 조회 실패 */ }

    // 캠페인별 성과 (Campaign 테이블에서 유형 포함)
    const campaigns = await prisma.campaign.findMany({
      where: { accountId },
      select: { id: true, name: true, campaignType: true, status: true },
    });

    // 키워드 통계에서 캠페인별 합산
    const campaignStats = await prisma.keywordDailyStat.groupBy({
      by: ['campaignName'],
      where: { accountId, date: { gte: sinceDate, lte: untilDate } },
      _sum: { impressions: true, clicks: true, cost: true },
    });

    // 캠페인 유형/상태 매핑
    const campaignInfoMap = new Map(campaigns.map((c) => [c.name, { type: c.campaignType || '-', status: c.status }]));

    const campaignRows = campaignStats
      .map((cs) => {
        const info = campaignInfoMap.get(cs.campaignName) || { type: '-', status: 'ACTIVE' };
        const cost = cs._sum.cost || 0;
        const impressions = cs._sum.impressions || 0;
        const clicks = cs._sum.clicks || 0;
        return {
          type: info.type,
          name: cs.campaignName,
          status: info.status,
          cost, impressions, clicks,
          ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0,
          cpc: clicks > 0 ? Math.round(cost / clicks) : 0,
        };
      })
      .sort((a, b) => b.cost - a.cost);

    // 전체 합산
    const totalImpressions = campaignRows.reduce((s, c) => s + c.impressions, 0);
    const totalClicks = campaignRows.reduce((s, c) => s + c.clicks, 0);
    const totalCost = campaignRows.reduce((s, c) => s + c.cost, 0);
    const totalCtr = totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(2) : 0;
    const totalCpc = totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0;

    // Top 10 키워드
    const stats = await prisma.keywordDailyStat.groupBy({
      by: ['keywordText', 'campaignName'],
      where: { accountId, date: { gte: sinceDate, lte: untilDate } },
      _sum: { impressions: true, clicks: true, cost: true },
    });

    const keywords = stats
      .map((s) => ({
        text: s.keywordText,
        campaignName: s.campaignName,
        clicks: s._sum.clicks || 0,
        impressions: s._sum.impressions || 0,
        cost: s._sum.cost || 0,
        ctr: (s._sum.impressions || 0) > 0 ? +(((s._sum.clicks || 0) / (s._sum.impressions || 0)) * 100).toFixed(2) : 0,
        cpc: (s._sum.clicks || 0) > 0 ? Math.round((s._sum.cost || 0) / (s._sum.clicks || 0)) : 0,
      }))
      .sort((a, b) => b.clicks - a.clicks || b.cost - a.cost)
      .slice(0, 10);

    // PDF 생성 - 1페이지 단일 보고서
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    // 한글 폰트 등록
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NanumGothic.ttf');
    doc.registerFont('Korean', fontPath);
    doc.font('Korean');

    const navy = '#1e2a4a';
    const blue = '#2563eb';
    const gray = '#64748b';
    const lightBg = '#f8fafc';
    const white = '#ffffff';
    const red = '#dc2626';

    // === 헤더 (광고주명 + 기간) ===
    doc.rect(0, 0, 595, 70).fill(navy);
    doc.font('Korean').fontSize(16).fillColor(white).text('열끈마케팅 광고 보고서', 40, 20);
    doc.fontSize(9).fillColor('#94a3b8').text(`${displayName}  |  ${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 40, 45);

    // === 핵심 지표 카드 (가로 1줄, 6개) ===
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
      const valColor = (c.label === '비즈머니' && bizmoney !== null && bizmoney <= 0) ? red : navy;
      doc.font('Korean').fontSize(10).fillColor(valColor).text(c.value, x + 6, cardY + 20, { width: cardW - 12 });
    });

    // === 캠페인별 성과 테이블 ===
    const campTableY = 135;
    doc.font('Korean').fontSize(8).fillColor(navy).text('캠페인별 성과', 40, campTableY);

    const cHeaders = ['유형', '캠페인', '상태', '소진', '노출', '클릭', 'CTR', 'CPC'];
    const cColX = [40, 90, 220, 270, 330, 385, 430, 480];
    const cHeaderY = campTableY + 14;

    doc.rect(40, cHeaderY, 515, 14).fill('#e2e8f0');
    cHeaders.forEach((h, i) => {
      doc.font('Korean').fontSize(6).fillColor('#475569').text(h, cColX[i], cHeaderY + 4);
    });

    let cRowY = cHeaderY + 17;
    const maxCampRows = Math.min(campaignRows.length, 12);
    for (let i = 0; i < maxCampRows; i++) {
      const c = campaignRows[i];
      const statusLabel = c.status === 'ACTIVE' ? '운영중' : '중지';
      doc.font('Korean').fontSize(6).fillColor(navy);
      doc.text(c.type.length > 6 ? c.type.slice(0, 6) : c.type, cColX[0], cRowY, { width: 48 });
      doc.text(c.name.length > 16 ? c.name.slice(0, 15) + '..' : c.name, cColX[1], cRowY, { width: 128 });
      doc.fillColor(c.status === 'ACTIVE' ? '#16a34a' : '#dc2626').text(statusLabel, cColX[2], cRowY);
      doc.fillColor(navy);
      doc.text(`₩${c.cost.toLocaleString()}`, cColX[3], cRowY);
      doc.text(c.impressions.toLocaleString(), cColX[4], cRowY);
      doc.text(c.clicks.toLocaleString(), cColX[5], cRowY);
      doc.text(`${c.ctr}%`, cColX[6], cRowY);
      doc.text(`₩${c.cpc.toLocaleString()}`, cColX[7], cRowY);
      cRowY += 13;
    }
    if (campaignRows.length > maxCampRows) {
      doc.font('Korean').fontSize(5.5).fillColor(gray).text(`... 외 ${campaignRows.length - maxCampRows}개 캠페인`, 40, cRowY);
      cRowY += 10;
    }

    // === 클릭 Top 키워드 테이블 ===
    const kwStartY = cRowY + 12;
    doc.font('Korean').fontSize(8).fillColor(navy).text('클릭 Top 키워드', 40, kwStartY);

    const kwHeaders = ['#', '키워드', '캠페인', '클릭', '노출', 'CTR', 'CPC', '소진'];
    const kwColX = [40, 55, 155, 270, 320, 375, 420, 470];
    const kwHeaderY = kwStartY + 14;

    doc.rect(40, kwHeaderY, 515, 14).fill('#e2e8f0');
    kwHeaders.forEach((h, i) => {
      doc.font('Korean').fontSize(6).fillColor('#475569').text(h, kwColX[i], kwHeaderY + 4);
    });

    let kwRowY = kwHeaderY + 17;
    keywords.forEach((kw, i) => {
      const rowColor = i < 3 ? blue : navy;
      doc.font('Korean').fontSize(6).fillColor(rowColor);
      doc.text(`${i + 1}`, kwColX[0], kwRowY);
      doc.text(kw.text.length > 12 ? kw.text.slice(0, 11) + '..' : kw.text, kwColX[1], kwRowY, { width: 110 });
      doc.fillColor(gray).text(
        (kw.campaignName || '-').length > 14 ? (kw.campaignName || '-').slice(0, 13) + '..' : (kw.campaignName || '-'),
        kwColX[2], kwRowY, { width: 110 }
      );
      doc.fillColor(rowColor);
      doc.text(kw.clicks.toLocaleString(), kwColX[3], kwRowY);
      doc.text(kw.impressions.toLocaleString(), kwColX[4], kwRowY);
      doc.text(`${kw.ctr}%`, kwColX[5], kwRowY);
      doc.text(`₩${kw.cpc.toLocaleString()}`, kwColX[6], kwRowY);
      doc.text(`₩${kw.cost.toLocaleString()}`, kwColX[7], kwRowY);
      kwRowY += 13;
    });

    // === 푸터 ===
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
