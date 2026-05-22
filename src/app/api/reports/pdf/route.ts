import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import PDFDocument from 'pdfkit';

export async function POST(req: NextRequest) {
  try {
    const { accountId, since, until } = await req.json();

    if (!accountId || !since || !until) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    // 계정 정보
    const account = await prisma.naverAdsAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 });
    }

    const sinceDate = new Date(since + 'T00:00:00.000Z');
    const untilDate = new Date(until + 'T23:59:59.999Z');

    // 키워드 통계 조회
    const stats = await prisma.keywordDailyStat.groupBy({
      by: ['keywordText', 'campaignName'],
      where: { accountId, date: { gte: sinceDate, lte: untilDate } },
      _sum: { impressions: true, clicks: true, cost: true },
    });

    // 캠페인별 합산
    const campaignStats = await prisma.keywordDailyStat.groupBy({
      by: ['campaignName'],
      where: { accountId, date: { gte: sinceDate, lte: untilDate } },
      _sum: { impressions: true, clicks: true, cost: true },
    });

    // 전체 합산
    const totalImpressions = campaignStats.reduce((s, c) => s + (c._sum.impressions || 0), 0);
    const totalClicks = campaignStats.reduce((s, c) => s + (c._sum.clicks || 0), 0);
    const totalCost = campaignStats.reduce((s, c) => s + (c._sum.cost || 0), 0);
    const totalCtr = totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(2) : 0;
    const totalCpc = totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0;

    // Top 키워드 (클릭 순)
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
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 15);

    // PDF 생성
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    // 색상 정의
    const navy = '#1e2a4a';
    const blue = '#2563eb';
    const lightBg = '#f8fafc';
    const white = '#ffffff';

    // === 1페이지: 표지 + 요약 ===
    // 헤더 배경
    doc.rect(0, 0, 595, 120).fill(navy);
    doc.fontSize(22).fillColor(white).text('키로 광고 보고서', 40, 35);
    doc.fontSize(11).fillColor('#94a3b8').text(`Kiro Ad Performance Report`, 40, 62);
    doc.fontSize(11).fillColor(white).text(`${account.accountName} 주식회사`, 400, 35, { align: 'right', width: 155 });
    doc.fontSize(9).fillColor('#94a3b8').text(`${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 400, 55, { align: 'right', width: 155 });

    // 핵심 지표
    doc.fillColor(navy);
    const metricsY = 145;
    doc.fontSize(10).fillColor('#64748b').text('핵심 지표 요약', 40, metricsY);

    const metricBoxes = [
      { label: '소진', value: `₩${totalCost.toLocaleString()}` },
      { label: '노출수', value: totalImpressions.toLocaleString() },
      { label: '클릭수', value: totalClicks.toLocaleString() },
      { label: 'CTR', value: `${totalCtr}%` },
      { label: 'CPC', value: `₩${totalCpc.toLocaleString()}` },
    ];

    const boxWidth = 100;
    const boxStartX = 40;
    const boxY = metricsY + 20;

    metricBoxes.forEach((m, i) => {
      const x = boxStartX + i * (boxWidth + 5);
      doc.rect(x, boxY, boxWidth, 55).fill(lightBg);
      doc.fontSize(8).fillColor('#64748b').text(m.label, x + 10, boxY + 10);
      doc.fontSize(14).fillColor(navy).text(m.value, x + 10, boxY + 28);
    });

    // 캠페인유형별 비중
    const chartY = boxY + 80;
    doc.fontSize(10).fillColor('#64748b').text('캠페인유형별 노출 비중', 40, chartY);

    const campColors: Record<string, string> = { '파워링크': '#2563eb', '파워컨텐츠': '#10b981', '플레이스': '#6b7280', '쇼핑검색': '#f59e0b', '브랜드검색': '#8b5cf6' };
    let barY = chartY + 20;

    campaignStats.sort((a, b) => (b._sum.impressions || 0) - (a._sum.impressions || 0));
    for (const camp of campaignStats.slice(0, 5)) {
      const name = camp.campaignName || '-';
      const impressions = camp._sum.impressions || 0;
      const ratio = totalImpressions > 0 ? impressions / totalImpressions : 0;
      const barWidth = Math.max(ratio * 350, 2);

      doc.fontSize(9).fillColor(navy).text(name, 40, barY + 2);
      doc.rect(140, barY, barWidth, 14).fill(campColors[name] || '#94a3b8');
      doc.fontSize(8).fillColor('#64748b').text(`${(ratio * 100).toFixed(1)}%`, 140 + barWidth + 5, barY + 3);
      barY += 22;
    }

    // === 2페이지: 캠페인별 성과 ===
    doc.addPage();
    doc.rect(0, 0, 595, 50).fill(navy);
    doc.fontSize(14).fillColor(white).text('캠페인별 성과', 40, 18);
    doc.fontSize(9).fillColor('#94a3b8').text('Campaign Performance', 40, 36);
    doc.fontSize(9).fillColor(white).text(`${account.accountName}`, 400, 18, { align: 'right', width: 155 });
    doc.fontSize(8).fillColor('#94a3b8').text(`${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 400, 32, { align: 'right', width: 155 });

    // 테이블 헤더
    const tableY = 70;
    const colWidths = [120, 80, 80, 60, 60, 60, 60];
    const colHeaders = ['캠페인', '소진', '노출', '클릭', 'CTR', 'CPC', '비중'];
    const colX = [40, 160, 240, 320, 380, 430, 480];

    doc.rect(40, tableY, 515, 20).fill('#e2e8f0');
    colHeaders.forEach((h, i) => {
      doc.fontSize(8).fillColor('#475569').text(h, colX[i], tableY + 6, { width: colWidths[i] });
    });

    let rowY = tableY + 25;
    for (const camp of campaignStats) {
      const name = camp.campaignName || '-';
      const cost = camp._sum.cost || 0;
      const impressions = camp._sum.impressions || 0;
      const clicks = camp._sum.clicks || 0;
      const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0';
      const cpc = clicks > 0 ? Math.round(cost / clicks) : 0;
      const ratio = totalCost > 0 ? ((cost / totalCost) * 100).toFixed(1) : '0';

      if (rowY > 750) { doc.addPage(); rowY = 60; }

      doc.fontSize(8).fillColor(navy).text(name, colX[0], rowY);
      doc.text(`₩${cost.toLocaleString()}`, colX[1], rowY);
      doc.text(impressions.toLocaleString(), colX[2], rowY);
      doc.text(clicks.toLocaleString(), colX[3], rowY);
      doc.text(`${ctr}%`, colX[4], rowY);
      doc.text(`₩${cpc.toLocaleString()}`, colX[5], rowY);
      doc.text(`${ratio}%`, colX[6], rowY);
      rowY += 18;
    }

    // === 3페이지: Top 키워드 ===
    doc.addPage();
    doc.rect(0, 0, 595, 50).fill(navy);
    doc.fontSize(14).fillColor(white).text('클릭 Top 키워드', 40, 18);
    doc.fontSize(9).fillColor('#94a3b8').text('Top Click Keywords', 40, 36);
    doc.fontSize(9).fillColor(white).text(`${account.accountName}`, 400, 18, { align: 'right', width: 155 });
    doc.fontSize(8).fillColor('#94a3b8').text(`${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 400, 32, { align: 'right', width: 155 });

    // 키워드 테이블
    const kwTableY = 70;
    const kwColHeaders = ['#', '키워드', '캠페인', '클릭', '노출', 'CTR', 'CPC', '소진'];
    const kwColX = [40, 60, 180, 270, 320, 380, 430, 480];

    doc.rect(40, kwTableY, 515, 20).fill('#e2e8f0');
    kwColHeaders.forEach((h, i) => {
      doc.fontSize(8).fillColor('#475569').text(h, kwColX[i], kwTableY + 6);
    });

    let kwRowY = kwTableY + 25;
    keywords.forEach((kw, i) => {
      if (kwRowY > 750) { doc.addPage(); kwRowY = 60; }

      const rowColor = i < 3 ? blue : navy;
      doc.fontSize(8).fillColor(rowColor).text(`${i + 1}`, kwColX[0], kwRowY);
      doc.font('Helvetica-Bold').text(kw.text, kwColX[1], kwRowY, { width: 115 });
      doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(kw.campaignName || '-', kwColX[2], kwRowY, { width: 85 });
      doc.fontSize(8).fillColor(rowColor).text(kw.clicks.toLocaleString(), kwColX[3], kwRowY);
      doc.fillColor(navy).text(kw.impressions.toLocaleString(), kwColX[4], kwRowY);
      doc.text(`${kw.ctr}%`, kwColX[5], kwRowY);
      doc.text(`₩${kw.cpc.toLocaleString()}`, kwColX[6], kwRowY);
      doc.text(`₩${kw.cost.toLocaleString()}`, kwColX[7], kwRowY);
      kwRowY += 18;
    });

    // 키워드 소진 비중 차트
    if (kwRowY < 600) {
      kwRowY += 20;
      doc.fontSize(10).fillColor('#64748b').text('키워드별 소진 비중', 40, kwRowY);
      kwRowY += 18;

      const topCostKeywords = keywords.slice(0, 7);
      const maxCost = topCostKeywords[0]?.cost || 1;

      for (const kw of topCostKeywords) {
        const barWidth = Math.max((kw.cost / maxCost) * 300, 2);
        const ratio = totalCost > 0 ? ((kw.cost / totalCost) * 100).toFixed(1) : '0';

        doc.fontSize(8).fillColor(navy).text(kw.text, 40, kwRowY + 2, { width: 100 });
        doc.rect(145, kwRowY, barWidth, 12).fill(blue);
        doc.fontSize(7).fillColor('#64748b').text(`₩${kw.cost.toLocaleString()} (${ratio}%)`, 145 + barWidth + 5, kwRowY + 2);
        kwRowY += 18;
      }
    }

    // 푸터
    doc.fontSize(7).fillColor('#94a3b8').text('ⓒ 열끈마케팅 · 키로 광고 관리 시스템', 40, 780);

    doc.end();

    // Buffer로 변환
    const pdfBuffer = await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(account.accountName)}_report_${since}_${until}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF report error:', error);
    return NextResponse.json({ error: '보고서 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
