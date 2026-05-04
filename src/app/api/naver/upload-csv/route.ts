import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const maxDuration = 300; // Vercel/Next.js 함수 타임아웃 5분

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const accountId = formData.get('accountId') as string | null;

    if (!file || !accountId) {
      return NextResponse.json({ error: '파일과 accountId가 필요합니다.' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    if (lines.length < 3) {
      return NextResponse.json({ error: '데이터가 부족합니다.' }, { status: 400 });
    }

    // 계정 상태를 importing으로 변경
    await prisma.naverAdsAccount.update({
      where: { id: accountId },
      data: { syncStatus: 'importing' },
    });

    const dataLines = lines.slice(2);
    let imported = 0;
    let skipped = 0;
    const syncDates = new Set<string>();

    // 배치 크기를 500으로 키워서 속도 향상
    const BATCH = 500;
    for (let i = 0; i < dataLines.length; i += BATCH) {
      const batch = dataLines.slice(i, i + BATCH);
      const operations = [];

      for (const line of batch) {
        const cols = parseCSVLine(line);
        if (cols.length < 7) { skipped++; continue; }

        const [keyword, dateStr, impressionsStr, clicksStr, ctrStr, cpcStr, costStr] = cols;
        if (keyword === '-') { skipped++; continue; }

        const dateParts = dateStr.replace(/\.$/, '').split('.');
        if (dateParts.length < 3) { skipped++; continue; }
        const dateFormatted = `${dateParts[0]}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`;
        const date = new Date(dateFormatted + 'T00:00:00.000Z');
        if (isNaN(date.getTime())) { skipped++; continue; }

        const impressions = parseInt(impressionsStr) || 0;
        const clicks = parseInt(clicksStr) || 0;
        const ctr = parseFloat(ctrStr) || 0;
        const cpc = parseInt(cpcStr) || 0;
        const cost = parseInt(costStr) || 0;
        const keywordId = `csv-${keyword}`;

        operations.push(
          prisma.keywordDailyStat.upsert({
            where: { keywordId_date: { keywordId, date } },
            update: { impressions, clicks, cost, cpc, ctr },
            create: {
              accountId, campaignId: '', campaignName: '', adGroupId: '', adGroupName: '',
              keywordId, keywordText: keyword, date, impressions, clicks, cost, cpc, ctr,
            },
          })
        );

        syncDates.add(dateFormatted);
        imported++;
      }

      if (operations.length > 0) {
        await prisma.$transaction(operations);
      }
    }

    // 수집된 날짜별 SyncLog 기록
    const syncDateArray = Array.from(syncDates);
    for (let i = 0; i < syncDateArray.length; i += 50) {
      const batch = syncDateArray.slice(i, i + 50);
      await prisma.$transaction(
        batch.map((dateStr) => {
          const date = new Date(dateStr + 'T00:00:00.000Z');
          return prisma.syncLog.upsert({
            where: { accountId_date: { accountId, date } },
            update: { status: 'CSV_IMPORT', keywordCount: imported },
            create: { accountId, date, status: 'CSV_IMPORT', keywordCount: imported },
          });
        })
      );
    }

    // 계정 상태 업데이트
    await prisma.naverAdsAccount.update({
      where: { id: accountId },
      data: { isActive: true, syncStatus: 'ready', lastSyncAt: new Date() },
    });

    console.log(`[CSV Import] ${accountId}: 완료! ${imported}개 키워드, ${syncDates.size}일치`);

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      dates: syncDates.size,
      message: `${imported}개 키워드 데이터 가져오기 완료 (${syncDates.size}일치)`,
    });
  } catch (error) {
    console.error('CSV upload error:', error);
    return NextResponse.json({ error: 'CSV 업로드 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}
