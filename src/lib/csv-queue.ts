import prisma from './prisma';

interface CSVJob {
  accountId: string;
  text: string;
  addedAt: Date;
}

const queue: CSVJob[] = [];
let processing = false;

export function enqueueCSV(accountId: string, text: string) {
  queue.push({ accountId, text, addedAt: new Date() });
  console.log(`[CSV Queue] 작업 추가: ${accountId}, 대기 ${queue.length}개`);
  processCSVQueue();
}

export async function processCSVQueue() {
  if (processing) return;
  if (queue.length === 0) return;
  processing = true;

  while (queue.length > 0) {
    const job = queue.shift()!;
    try {
      console.log(`[CSV Queue] 처리 시작: ${job.accountId}`);
      await processCSV(job.accountId, job.text);
      console.log(`[CSV Queue] 처리 완료: ${job.accountId}`);
    } catch (error) {
      console.error(`[CSV Queue] 처리 실패: ${job.accountId}`, error);
      await prisma.naverAdsAccount.update({
        where: { id: job.accountId },
        data: { syncStatus: 'ready' },
      }).catch(() => {});
    }
  }

  processing = false;
}

async function processCSV(accountId: string, text: string) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length < 3) {
    console.error(`[CSV Queue] ${accountId}: 데이터가 부족합니다.`);
    return;
  }

  const dataLines = lines.slice(2);
  const syncDates = new Set<string>();

  // 1. CSV 전체 파싱 (메모리에서 처리 — 순식간)
  const rows: {
    accountId: string; campaignId: string; campaignName: string;
    adGroupId: string; adGroupName: string; keywordId: string;
    keywordText: string; date: Date; impressions: number;
    clicks: number; cost: number; cpc: number; ctr: number;
  }[] = [];

  for (const line of dataLines) {
    const cols = parseCSVLine(line);
    if (cols.length < 7) continue;

    // 8컬럼: 키워드, 일별, 캠페인유형, 노출수, 클릭수, 클릭률, 평균CPC, 총비용
    // 7컬럼(구형): 키워드, 일별, 노출수, 클릭수, 클릭률, 평균CPC, 총비용
    let keyword: string, dateStr: string, campaignType: string, impressionsStr: string, clicksStr: string, ctrStr: string, cpcStr: string, costStr: string;

    if (cols.length >= 8) {
      [keyword, dateStr, campaignType, impressionsStr, clicksStr, ctrStr, cpcStr, costStr] = cols;
    } else {
      [keyword, dateStr, impressionsStr, clicksStr, ctrStr, cpcStr, costStr] = cols;
      campaignType = '';
    }

    const dateParts = dateStr.replace(/\.$/, '').split('.');
    if (dateParts.length < 3) continue;
    const dateFormatted = `${dateParts[0]}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`;
    const date = new Date(dateFormatted + 'T00:00:00.000Z');
    if (isNaN(date.getTime())) continue;

    rows.push({
      accountId,
      campaignId: '',
      campaignName: campaignType,
      adGroupId: '',
      adGroupName: '',
      keywordId: `csv-${campaignType}-${keyword}`,
      keywordText: keyword,
      date,
      impressions: parseInt(impressionsStr) || 0,
      clicks: parseInt(clicksStr) || 0,
      cost: parseInt(costStr) || 0,
      cpc: parseInt(cpcStr) || 0,
      ctr: parseFloat(ctrStr) || 0,
    });

    syncDates.add(dateFormatted);
  }

  console.log(`[CSV Queue] ${accountId}: ${rows.length}행 파싱 완료, DB 저장 시작`);

  // 2. 기존 CSV 데이터 삭제 (해당 계정의 csv- 접두사 데이터만)
  const deleted = await prisma.keywordDailyStat.deleteMany({
    where: { accountId, keywordId: { startsWith: 'csv-' } },
  });
  console.log(`[CSV Queue] ${accountId}: 기존 CSV 데이터 ${deleted.count}행 삭제`);

  // 2-1. 같은 계정+같은 날짜의 API 수집 데이터도 삭제 (중복 방지)
  // CSV에 있는 날짜에 대해서만 API 데이터 제거
  for (const dateStr of syncDates) {
    const date = new Date(dateStr + 'T00:00:00.000Z');
    await prisma.keywordDailyStat.deleteMany({
      where: { accountId, date, keywordId: { not: { startsWith: 'csv-' } } },
    });
  }
  console.log(`[CSV Queue] ${accountId}: CSV 날짜 범위의 API 데이터 삭제 완료`);

  // 3. bulk insert (createMany — DB 1번 호출)
  const BATCH = 1000;
  let totalInserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batchData = rows.slice(i, i + BATCH);
    try {
      const result = await prisma.keywordDailyStat.createMany({
        data: batchData,
      });
      totalInserted += result.count;
      console.log(`[CSV Queue] ${accountId}: batch ${i}~${i + batchData.length}, inserted=${result.count}`);
    } catch (batchError) {
      console.error(`[CSV Queue] ${accountId}: batch ${i} 실패:`, batchError);
      // 실패한 배치는 개별 upsert로 재시도
      for (const row of batchData) {
        try {
          await prisma.keywordDailyStat.create({ data: row });
          totalInserted++;
        } catch { /* 개별 실패 무시 */ }
      }
    }
  }
  console.log(`[CSV Queue] ${accountId}: DB 저장 완료, 총 ${totalInserted}행 insert됨`);

  // 4. SyncLog 기록
  const syncDateArray = Array.from(syncDates);
  for (let i = 0; i < syncDateArray.length; i += 50) {
    const batch = syncDateArray.slice(i, i + 50);
    await prisma.$transaction(
      batch.map((dateStr) => {
        const date = new Date(dateStr + 'T00:00:00.000Z');
        return prisma.syncLog.upsert({
          where: { accountId_date: { accountId, date } },
          update: { status: 'CSV_IMPORT', keywordCount: rows.length },
          create: { accountId, date, status: 'CSV_IMPORT', keywordCount: rows.length },
        });
      })
    );
  }

  // 5. 완료
  await prisma.naverAdsAccount.update({
    where: { id: accountId },
    data: { isActive: true, syncStatus: 'ready', lastSyncAt: new Date() },
  });

  console.log(`[CSV Queue] ${accountId}: 완료! ${rows.length}개 키워드, ${syncDates.size}일치`);
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
