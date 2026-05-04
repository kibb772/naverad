import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// 백그라운드 처리 함수 (응답 후 실행)
async function processCSV(accountId: string, text: string) {
  try {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    if (lines.length < 3) {
      console.error('[CSV Import] 데이터가 부족합니다.');
      return;
    }

    const dataLines = lines.slice(2);
    let imported = 0;
    const syncDates = new Set<string>();

    const BATCH = 100;
    for (let i = 0; i < dataLines.length; i += BATCH) {
      const batch = dataLines.slice(i, i + BATCH);
      const operations = [];

      for (const line of batch) {
        const cols = parseCSVLine(line);
        if (cols.length < 7) continue;

        const [keyword, dateStr, impressionsStr, clicksStr, ctrStr, cpcStr, costStr] = cols;
        if (keyword === '-') continue;

        const dateParts = dateStr.replace(/\.$/, '').split('.');
        if (dateParts.length < 3) continue;
        const dateFormatted = `${dateParts[0]}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`;
        const date = new Date(dateFormatted + 'T00:00:00.000Z');
        if (isNaN(date.getTime())) continue;

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

      // 진행률 로그
      if (i % 500 === 0) {
        console.log(`[CSV Import] ${accountId}: ${i}/${dataLines.length} 처리 중...`);
      }
    }

    // 수집된 날짜별 SyncLog 기록
    for (const dateStr of syncDates) {
      const date = new Date(dateStr + 'T00:00:00.000Z');
      await prisma.syncLog.upsert({
        where: { accountId_date: { accountId, date } },
        update: { status: 'CSV_IMPORT', keywordCount: imported },
        create: { accountId, date, status: 'CSV_IMPORT', keywordCount: imported },
      });
    }

    // 완료: 계정 상태 업데이트
    await prisma.naverAdsAccount.update({
      where: { id: accountId },
      data: { isActive: true, syncStatus: 'ready', lastSyncAt: new Date() },
    });

    console.log(`[CSV Import] ${accountId}: 완료! ${imported}개 키워드, ${syncDates.size}일치`);
  } catch (error) {
    console.error(`[CSV Import] ${accountId}: 실패`, error);
    // 실패해도 계정 상태를 ready로 복구 (재업로드 가능하도록)
    await prisma.naverAdsAccount.update({
      where: { id: accountId },
      data: { syncStatus: 'ready' },
    }).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const accountId = formData.get('accountId') as string | null;

    if (!file || !accountId) {
      return NextResponse.json({ error: '파일과 accountId가 필요합니다.' }, { status: 400 });
    }

    // 파일 내용을 먼저 읽어두기
    const text = await file.text();
    const lineCount = text.split('\n').filter((l) => l.trim().length > 0).length;

    if (lineCount < 3) {
      return NextResponse.json({ error: '데이터가 부족합니다.' }, { status: 400 });
    }

    // 계정 상태를 importing으로 변경
    await prisma.naverAdsAccount.update({
      where: { id: accountId },
      data: { syncStatus: 'importing' },
    });

    // 백그라운드로 처리 시작 (응답은 바로 돌려줌)
    processCSV(accountId, text).catch(console.error);

    return NextResponse.json({
      success: true,
      message: `CSV 파일 접수 완료 (${lineCount - 2}행). 서버에서 처리 중입니다. 창을 닫아도 됩니다.`,
      lines: lineCount - 2,
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
