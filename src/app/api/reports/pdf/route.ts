import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { NaverAdsService } from '@/services/naver-ads.service';
import PDFDocument from 'pdfkit';

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

    // 계정 정보
    const account = await prisma.naverAdsAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return NextResponse.json({ error: '계정을 찾을 수 없습니다.' }, { status: 404 });
    }

    const displayName = cleanAccountName(account.accountName);
    const sinceDate = new Date(since + 'T00:00:00.000Z');
    const untilDate = new Date(until + 'T23:59:59.999Z');

    // 비즈머니 잔액 조회 (5초 타임아웃)
    let bizmoney: number | null = null;
    try {
      const naverAds = new NaverAdsService({
        apiKey: account.apiKey,
        secretKey: account.secretKey,
        customerId: account.customerId,
      });
      const bizResult = await Promise.race([
        naverAds.getBizmoney(),
        new Promise<{ success: false }>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]) as { success: boolean; data?: { bizmoney?: number } };
      if (bizResult.success && bizResult.data) {
        const d = bizResult.data as Record<string, unknown>;
        bizmoney = (d.bizmoney ?? d.balance ?? d.amount ?? 0) as number;
      }
    } catch { /* 조회 실패 시 null 유지 */ }

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

    // 광고그룹별 합산
    const adGroupStats = await prisma.keywordDailyStat.groupBy({
      by: ['adGroupId', 'adGroupName'],
      where: { accountId, date: { gte: sinceDate, lte: untilDate } },
      _sum: { impressions: true, clicks: true, cost: true },
    });

    // 일별 추이 데이터
    const dailyStats = await prisma.keywordDailyStat.groupBy({
      by: ['date'],
      where: { accountId, date: { gte: sinceDate, lte: untilDate } },
      _sum: { impressions: true, clicks: true, cost: true },
      orderBy: { date: 'asc' },
    });

    // 캠페인 유형별 집계 (Campaign 테이블 조인)
    const campaigns = await prisma.campaign.findMany({
      where: { accountId },
      select: { id: true, name: true, campaignType: true },
    });
    const campaignTypeMap = new Map<string, string>();
    campaigns.forEach((c) => campaignTypeMap.set(c.name, c.campaignType || '기타'));

    // 캠페인 유형별 집계
    const typeStatsMap = new Map<string, { impressions: number; clicks: number; cost: number }>();
    campaignStats.forEach((cs) => {
      const type = campaignTypeMap.get(cs.campaignName) || '기타';
      const existing = typeStatsMap.get(type) || { impressions: 0, clicks: 0, cost: 0 };
      existing.impressions += cs._sum.impressions || 0;
      existing.clicks += cs._sum.clicks || 0;
      existing.cost += cs._sum.cost || 0;
      typeStatsMap.set(type, existing);
    });
    const typeStats = Array.from(typeStatsMap.entries())
      .map(([type, data]) => ({ type, ...data }))
      .sort((a, b) => b.cost - a.cost);

    // 전체 합산
    const totalImpressions = campaignStats.reduce((s, c) => s + (c._sum.impressions || 0), 0);
    const totalClicks = campaignStats.reduce((s, c) => s + (c._sum.clicks || 0), 0);
    const totalCost = campaignStats.reduce((s, c) => s + (c._sum.cost || 0), 0);
    const totalCtr = totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(2) : 0;
    const totalCpc = totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0;

    // Top 10 키워드 (클릭 순, 동일 클릭 시 소진 순)
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

    // 일별 데이터 빈 날짜 채우기
    const dailyData: { date: string; cost: number; clicks: number; impressions: number }[] = [];
    const startD = new Date(since);
    const endD = new Date(until);
    const dailyMap = new Map(dailyStats.map((d) => [
      d.date.toISOString().slice(0, 10),
      { cost: d._sum.cost || 0, clicks: d._sum.clicks || 0, impressions: d._sum.impressions || 0 },
    ]));
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const data = dailyMap.get(key) || { cost: 0, clicks: 0, impressions: 0 };
      dailyData.push({ date: key, ...data });
    }

    // PDF 생성
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    // 색상 정의
    const navy = '#1e2a4a';
    const blue = '#2563eb';
    const lightBg = '#f8fafc';
    const white = '#ffffff';
    const red = '#dc2626';

    // === 1페이지: 표지 + 비즈머니 잔액 + 핵심 지표 요약 ===
    // 헤더 배경
    doc.rect(0, 0, 595, 120).fill(navy);
    doc.fontSize(22).fillColor(white).text('열끈마케팅 광고 보고서', 40, 35);
    doc.fontSize(11).fillColor('#94a3b8').text('Ad Performance Report', 40, 62);
    doc.fontSize(11).fillColor(white).text(displayName, 400, 35, { align: 'right', width: 155 });
    doc.fontSize(9).fillColor('#94a3b8').text(`${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 400, 55, { align: 'right', width: 155 });

    // 비즈머니 잔액 (헤더 바로 아래)
    const bizY = 130;
    doc.fontSize(10).fillColor('#64748b').text('비즈머니 잔액', 40, bizY);
    if (bizmoney !== null) {
      const bizColor = bizmoney <= 0 ? red : navy;
      doc.fontSize(16).fillColor(bizColor).text(`₩${bizmoney.toLocaleString()}`, 40, bizY + 16);
    } else {
      doc.fontSize(12).fillColor('#94a3b8').text('조회 불가', 40, bizY + 16);
    }

    // 핵심 지표
    const metricsY = bizY + 50;
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

    // 캠페인유형별 노출 비중 (간단 바 차트)
    const chartY = boxY + 80;
    doc.fontSize(10).fillColor('#64748b').text('캠페인유형별 소진 비중', 40, chartY);

    const campColors: Record<string, string> = {
      '파워링크': '#2563eb', '파워컨텐츠': '#10b981', '플레이스': '#6b7280',
      '쇼핑검색': '#f59e0b', '브랜드검색': '#8b5cf6', '기타': '#94a3b8',
    };
    let barY = chartY + 20;
    for (const ts of typeStats.slice(0, 6)) {
      const ratio = totalCost > 0 ? ts.cost / totalCost : 0;
      const barWidth = Math.max(ratio * 350, 2);
      doc.fontSize(9).fillColor(navy).text(ts.type, 40, barY + 2);
      doc.rect(140, barY, barWidth, 14).fill(campColors[ts.type] || '#94a3b8');
      doc.fontSize(8).fillColor('#64748b').text(`${(ratio * 100).toFixed(1)}%`, 140 + barWidth + 5, barY + 3);
      barY += 22;
    }

    // === 2페이지: 일별 추이 차트 ===
    doc.addPage();
    doc.rect(0, 0, 595, 50).fill(navy);
    doc.fontSize(14).fillColor(white).text('일별 추이', 40, 18);
    doc.fontSize(9).fillColor('#94a3b8').text('Daily Trend', 40, 36);
    doc.fontSize(9).fillColor(white).text(displayName, 400, 18, { align: 'right', width: 155 });
    doc.fontSize(8).fillColor('#94a3b8').text(`${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 400, 32, { align: 'right', width: 155 });

    if (dailyData.every((d) => d.cost === 0 && d.clicks === 0 && d.impressions === 0)) {
      doc.fontSize(12).fillColor('#64748b').text('해당 기간에 데이터가 없습니다', 40, 150);
    } else {
      // 범례
      const legendY = 65;
      doc.rect(40, legendY, 10, 10).fill(blue);
      doc.fontSize(8).fillColor(navy).text('소진(바)', 55, legendY + 1);
      doc.rect(110, legendY, 10, 10).fill('#10b981');
      doc.fontSize(8).fillColor(navy).text('클릭(라인)', 125, legendY + 1);
      doc.rect(190, legendY, 10, 10).fill('#f59e0b');
      doc.fontSize(8).fillColor(navy).text('노출(라인)', 205, legendY + 1);

      // 차트 영역
      const cX = 60;
      const cY = 90;
      const cW = 490;
      const cH = 200;
      const days = dailyData.length;
      const maxCost = Math.max(...dailyData.map((d) => d.cost), 1);
      const maxClicks = Math.max(...dailyData.map((d) => d.clicks), 1);
      const maxImpressions = Math.max(...dailyData.map((d) => d.impressions), 1);

      // Y축 그리드
      doc.strokeColor('#e2e8f0').lineWidth(0.5);
      for (let i = 0; i <= 4; i++) {
        const y = cY + (cH / 4) * i;
        doc.moveTo(cX, y).lineTo(cX + cW, y).stroke();
      }

      // 바 차트 (소진)
      const barW = Math.max((cW / days) * 0.6, 2);
      dailyData.forEach((d, i) => {
        const x = cX + (cW / days) * i + (cW / days) * 0.2;
        const h = (d.cost / maxCost) * cH;
        doc.rect(x, cY + cH - h, barW, h).fill(blue).fillOpacity(0.6);
      });
      doc.fillOpacity(1);

      // 라인 차트 (클릭 - 초록)
      doc.strokeColor('#10b981').lineWidth(1.5);
      dailyData.forEach((d, i) => {
        const x = cX + (cW / days) * i + (cW / days) * 0.5;
        const y = cY + cH - (d.clicks / maxClicks) * cH;
        if (i === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      });
      doc.stroke();

      // 라인 차트 (노출 - 주황)
      doc.strokeColor('#f59e0b').lineWidth(1.5);
      dailyData.forEach((d, i) => {
        const x = cX + (cW / days) * i + (cW / days) * 0.5;
        const y = cY + cH - (d.impressions / maxImpressions) * cH;
        if (i === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      });
      doc.stroke();

      // X축 날짜 레이블
      const labelInterval = days > 30 ? 5 : 1;
      dailyData.forEach((d, i) => {
        if (i % labelInterval === 0) {
          const x = cX + (cW / days) * i;
          const label = d.date.slice(5).replace('-', '.');
          doc.fontSize(6).fillColor('#64748b').text(label, x, cY + cH + 5, { width: 30 });
        }
      });

      // Y축 레이블 (소진)
      doc.fontSize(7).fillColor('#64748b');
      doc.text(`₩${maxCost.toLocaleString()}`, 0, cY - 3, { width: 55, align: 'right' });
      doc.text('₩0', 0, cY + cH - 5, { width: 55, align: 'right' });
    }

    // === 3페이지: 캠페인 유형별 성과 ===
    doc.addPage();
    doc.rect(0, 0, 595, 50).fill(navy);
    doc.fontSize(14).fillColor(white).text('캠페인 유형별 성과', 40, 18);
    doc.fontSize(9).fillColor('#94a3b8').text('Campaign Type Performance', 40, 36);
    doc.fontSize(9).fillColor(white).text(displayName, 400, 18, { align: 'right', width: 155 });
    doc.fontSize(8).fillColor('#94a3b8').text(`${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 400, 32, { align: 'right', width: 155 });

    if (typeStats.length === 0) {
      doc.fontSize(12).fillColor('#64748b').text('해당 기간에 데이터가 없습니다', 40, 100);
    } else {
      const tTableY = 70;
      const tColHeaders = ['유형명', '소진', '노출', '클릭', 'CTR', 'CPC'];
      const tColX = [40, 180, 270, 340, 400, 460];

      doc.rect(40, tTableY, 515, 20).fill('#e2e8f0');
      tColHeaders.forEach((h, i) => {
        doc.fontSize(8).fillColor('#475569').text(h, tColX[i], tTableY + 6);
      });

      let tRowY = tTableY + 25;
      for (const ts of typeStats) {
        const ctr = ts.impressions > 0 ? ((ts.clicks / ts.impressions) * 100).toFixed(2) : '0.00';
        const cpc = ts.clicks > 0 ? Math.round(ts.cost / ts.clicks) : 0;

        doc.fontSize(8).fillColor(navy);
        doc.text(ts.type, tColX[0], tRowY);
        doc.text(`₩${ts.cost.toLocaleString()}`, tColX[1], tRowY);
        doc.text(ts.impressions.toLocaleString(), tColX[2], tRowY);
        doc.text(ts.clicks.toLocaleString(), tColX[3], tRowY);
        doc.text(`${ctr}%`, tColX[4], tRowY);
        doc.text(`₩${cpc.toLocaleString()}`, tColX[5], tRowY);
        tRowY += 18;
      }
    }

    // === 4페이지: 광고그룹별 성과 ===
    doc.addPage();
    doc.rect(0, 0, 595, 50).fill(navy);
    doc.fontSize(14).fillColor(white).text('광고그룹별 성과', 40, 18);
    doc.fontSize(9).fillColor('#94a3b8').text('Ad Group Performance', 40, 36);
    doc.fontSize(9).fillColor(white).text(displayName, 400, 18, { align: 'right', width: 155 });
    doc.fontSize(8).fillColor('#94a3b8').text(`${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 400, 32, { align: 'right', width: 155 });

    const sortedAdGroups = adGroupStats
      .map((ag) => ({
        name: ag.adGroupName,
        cost: ag._sum.cost || 0,
        impressions: ag._sum.impressions || 0,
        clicks: ag._sum.clicks || 0,
      }))
      .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks);

    if (sortedAdGroups.length === 0) {
      doc.fontSize(12).fillColor('#64748b').text('해당 기간에 광고그룹 데이터가 없습니다', 40, 100);
    } else {
      const agColHeaders = ['그룹명', '소진', '노출', '클릭', 'CTR', 'CPC'];
      const agColX = [40, 180, 270, 340, 400, 460];
      let agRowY = 70;
      let rowCount = 0;

      // 테이블 헤더 그리기 함수
      const drawAgHeader = (y: number) => {
        doc.rect(40, y, 515, 20).fill('#e2e8f0');
        agColHeaders.forEach((h, i) => {
          doc.fontSize(8).fillColor('#475569').text(h, agColX[i], y + 6);
        });
        return y + 25;
      };

      agRowY = drawAgHeader(agRowY);

      for (const ag of sortedAdGroups) {
        if (rowCount >= 36) {
          doc.addPage();
          doc.rect(0, 0, 595, 50).fill(navy);
          doc.fontSize(14).fillColor(white).text('광고그룹별 성과 (계속)', 40, 18);
          doc.fontSize(9).fillColor('#94a3b8').text('Ad Group Performance (cont.)', 40, 36);
          agRowY = 70;
          agRowY = drawAgHeader(agRowY);
          rowCount = 0;
        }

        const ctr = ag.impressions > 0 ? ((ag.clicks / ag.impressions) * 100).toFixed(2) : '0.00';
        const cpc = ag.clicks > 0 ? Math.round(ag.cost / ag.clicks) : 0;
        const groupName = ag.name.length > 30 ? ag.name.slice(0, 28) + '...' : ag.name;

        doc.fontSize(8).fillColor(navy);
        doc.text(groupName, agColX[0], agRowY, { width: 135 });
        doc.text(`₩${ag.cost.toLocaleString()}`, agColX[1], agRowY);
        doc.text(ag.impressions.toLocaleString(), agColX[2], agRowY);
        doc.text(ag.clicks.toLocaleString(), agColX[3], agRowY);
        doc.text(`${ctr}%`, agColX[4], agRowY);
        doc.text(`₩${cpc.toLocaleString()}`, agColX[5], agRowY);
        agRowY += 18;
        rowCount++;
      }
    }

    // === 5페이지: Top 10 키워드 ===
    doc.addPage();
    doc.rect(0, 0, 595, 50).fill(navy);
    doc.fontSize(14).fillColor(white).text('클릭 Top 10 키워드', 40, 18);
    doc.fontSize(9).fillColor('#94a3b8').text('Top 10 Click Keywords', 40, 36);
    doc.fontSize(9).fillColor(white).text(displayName, 400, 18, { align: 'right', width: 155 });
    doc.fontSize(8).fillColor('#94a3b8').text(`${since.replace(/-/g, '.')} ~ ${until.replace(/-/g, '.')}`, 400, 32, { align: 'right', width: 155 });

    if (keywords.length === 0) {
      doc.fontSize(12).fillColor('#64748b').text('해당 기간에 키워드 데이터가 없습니다', 40, 100);
    } else {
      const kwTableY = 70;
      const kwColHeaders = ['#', '키워드', '캠페인', '클릭', '노출', 'CTR', 'CPC', '소진'];
      const kwColX = [40, 60, 180, 270, 320, 380, 430, 480];

      doc.rect(40, kwTableY, 515, 20).fill('#e2e8f0');
      kwColHeaders.forEach((h, i) => {
        doc.fontSize(8).fillColor('#475569').text(h, kwColX[i], kwTableY + 6);
      });

      let kwRowY = kwTableY + 25;
      keywords.forEach((kw, i) => {
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

    }

    // 모든 페이지에 푸터 추가 (페이지 번호 + 저작권)
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor('#94a3b8');
      doc.text(`${i + 1} / ${totalPages}`, 40, 780, { width: 515, align: 'center' });
      doc.text('ⓒ 열끈마케팅 · 키로 광고 관리 시스템', 40, 790, { width: 515, align: 'center' });
    }

    doc.end();

    // Buffer로 변환
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
