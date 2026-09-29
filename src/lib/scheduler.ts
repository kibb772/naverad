import prisma from './prisma';
import { NaverAdsService } from '@/services/naver-ads.service';
import { processCSVQueue } from './csv-queue';
import { getCampaignTypeLabel } from './campaign-type';
import { collectBizmoneyResults, buildBizmoneyReport } from './bizmoney-report';

let schedulerStarted = false;

// Gmail REST API로 이메일 발송
async function sendEmailViaGmailAPI(subject: string, html: string) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const gmailUser = process.env.GMAIL_USER;

  if (!clientId || !clientSecret || !refreshToken || !gmailUser) {
    console.log('[Scheduler] Gmail OAuth 설정이 없어 이메일 발송을 건너뜁니다.');
    return false;
  }

  // Access Token 발급
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    console.error('[Scheduler] Access token 발급 실패:', tokenData);
    return false;
  }

  // 이메일 생성
  const boundary = 'boundary_' + Date.now();
  const lines = [
    `From: 열끈 알림 <${gmailUser}>`,
    `To: ${gmailUser}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html).toString('base64'),
    `--${boundary}--`,
  ];
  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

  // Gmail API로 발송
  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });

  if (!sendRes.ok) {
    const err = await sendRes.text();
    console.error('[Scheduler] Gmail API 발송 실패:', err);
    return false;
  }

  console.log(`[Scheduler] 이메일 발송 완료 → ${gmailUser}`);
  return true;
}

// 키워드 마스터(ID → 키워드명/캠페인유형) 캐시.
//
// 이 매핑은 네이버 계정의 '현재' 구성을 읽는 것이라 수집하려는 날짜와 무관하게 같은 값이다.
// 그런데 (계정 × 날짜) 마다 매번 새로 만들고 있었다. 광고그룹마다 키워드를 따로 조회하기
// 때문에 계정 하나에 수십 번의 API 호출이 들고, 정작 통계 다운로드보다 이쪽이 더 오래 걸린다.
// 누락일 백필처럼 한 계정의 여러 날짜를 연달아 수집할 때 같은 목록을 16번씩 다시 받게 된다.
// 짧은 TTL 을 둬서 연속 수집 중에만 재사용하고, 다음 날 수집에는 새로 받는다.
const KEYWORD_MASTER_TTL_MS = 30 * 60 * 1000;
const keywordMasterCache = new Map<string, { at: number; map: Record<string, { text: string; campaignType: string }> }>();

async function getKeywordMaster(
  naverAds: NaverAdsService,
  account: { id: string; customerId: string }
): Promise<Record<string, { text: string; campaignType: string }>> {
  const cached = keywordMasterCache.get(account.id);
  if (cached && Date.now() - cached.at < KEYWORD_MASTER_TTL_MS) {
    console.log(`[Scheduler] ${account.customerId}: 키워드 마스터 캐시 사용 (${Object.keys(cached.map).length}개)`);
    return cached.map;
  }

  console.log(`[Scheduler] ${account.customerId}: 키워드 마스터 매핑 구축 중...`);
  const keywordMap: Record<string, { text: string; campaignType: string }> = {};

  try {
    const campResult = await naverAds.getCampaigns();
    if (campResult.success && Array.isArray(campResult.data)) {
      for (const camp of campResult.data as Record<string, unknown>[]) {
        const campId = (camp.nccCampaignId || camp.campaignId) as string;
        const campType = (camp.campaignTp || camp.campaignType || '') as string;
        const typeLabel = getCampaignTypeLabel(campType);

        const agResult = await naverAds.getAdGroups(campId);
        if (!agResult.success || !Array.isArray(agResult.data)) continue;

        for (const ag of agResult.data as Record<string, unknown>[]) {
          const agId = (ag.nccAdgroupId || ag.adgroupId) as string;
          const kwResult = await naverAds.getKeywords(agId);
          if (!kwResult.success || !Array.isArray(kwResult.data)) continue;

          for (const kw of kwResult.data as Record<string, unknown>[]) {
            const kwId = (kw.nccKeywordId || kw.keywordId) as string;
            const kwText = (kw.keyword || kw.text || kw.name) as string;
            keywordMap[kwId] = { text: kwText, campaignType: typeLabel };
          }
        }

        // 캠페인 ID → 유형 매핑도 저장
        keywordMap[`camp-${campId}`] = { text: '', campaignType: typeLabel };
      }
    }
  } catch (e) {
    console.error(`[Scheduler] ${account.customerId}: 키워드 마스터 구축 실패`, e);
    return keywordMap; // 실패한 결과는 캐시하지 않는다
  }

  console.log(`[Scheduler] ${account.customerId}: 키워드 마스터 ${Object.keys(keywordMap).length}개 매핑 완료`);
  keywordMasterCache.set(account.id, { at: Date.now(), map: keywordMap });
  return keywordMap;
}

export async function syncAccountData(account: {
  id: string;
  apiKey: string;
  secretKey: string;
  customerId: string;
}, syncDate: string) {
  const naverAds = new NaverAdsService({
    apiKey: account.apiKey,
    secretKey: account.secretKey,
    customerId: account.customerId,
  });

  // 이미 수집했는지 확인 (FAILED는 다음 실행에서 재시도해야 하므로 스킵하지 않는다)
  const existing = await prisma.syncLog.findUnique({
    where: { accountId_date: { accountId: account.id, date: new Date(syncDate) } },
  });
  if (existing && existing.status !== 'FAILED') return { skipped: true, date: syncDate };

  // 1. StatReport 생성 요청 (AD_DETAIL = 키워드 단위 통계)
  console.log(`[Scheduler] ${account.customerId}: StatReport 생성 요청 (${syncDate})`);
  const createResult = await naverAds.createStatReport({
    reportTp: 'AD_DETAIL',
    statDt: syncDate,
  });

  if (!createResult.success || !createResult.data) {
    console.error(`[Scheduler] ${account.customerId}: StatReport 생성 실패`, createResult.error);
    // StatReport 실패 시 기존 방식으로 폴백
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  const reportData = createResult.data as Record<string, unknown>;
  const reportJobId = (reportData.reportJobId || reportData.id) as string;

  if (!reportJobId) {
    console.error(`[Scheduler] ${account.customerId}: reportJobId 없음`, reportData);
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  // 2. 보고서 준비 완료까지 폴링 (최대 2분)
  let reportReady = false;
  let downloadUrl = '';
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((r) => setTimeout(r, 5000)); // 5초 대기

    const statusResult = await naverAds.getStatReport(reportJobId);
    if (!statusResult.success || !statusResult.data) continue;

    const status = statusResult.data as Record<string, unknown>;
    const jobStatus = (status.status || status.reportJobStatus) as string;

    if (jobStatus === 'BUILT' || jobStatus === 'READY' || jobStatus === 'DONE') {
      downloadUrl = (status.downloadUrl || status.reportUrl || '') as string;
      reportReady = true;
      console.log(`[Scheduler] ${account.customerId}: StatReport 준비 완료 (downloadUrl: ${downloadUrl ? 'Y' : 'N'})`);
      break;
    } else if (jobStatus === 'FAILED' || jobStatus === 'ERROR') {
      console.error(`[Scheduler] ${account.customerId}: StatReport 실패 (${jobStatus})`);
      break;
    }
    // RUNNING, WAITING 등은 계속 대기
  }

  if (!reportReady) {
    console.log(`[Scheduler] ${account.customerId}: StatReport 준비 안됨 → 기존 방식`);
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  // 3. 보고서 다운로드 (API 다운로드 우선, URL 폴백)
  let tsvText = '';
  try {
    const downloadResult = await naverAds.getStatReportDownload(reportJobId);
    console.log(`[Scheduler] ${account.customerId}: 다운로드 API 응답 success=${downloadResult.success}, dataLength=${String(downloadResult.data || '').length}`);
    if (downloadResult.success && downloadResult.data) {
      tsvText = String(downloadResult.data);
    }
  } catch (dlErr) {
    console.error(`[Scheduler] ${account.customerId}: 다운로드 API 실패`, dlErr);
  }

  // API 다운로드 실패 시 URL로 직접 fetch
  if ((!tsvText || tsvText.length < 10) && downloadUrl) {
    try {
      const res = await fetch(downloadUrl);
      tsvText = await res.text();
      console.log(`[Scheduler] ${account.customerId}: URL 다운로드 결과: ${tsvText.length}자`);
    } catch (e) {
      console.error(`[Scheduler] ${account.customerId}: URL 다운로드 실패`, e);
    }
  }

  if (!tsvText || tsvText.length < 10) {
    console.log(`[Scheduler] ${account.customerId}: 보고서 데이터 없음 → 기존 방식`);
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  // 4. StatReport 파싱 → DB 저장
  const lines = tsvText.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 1) {
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  // 형식 감지: 헤더가 있는지 확인
  const firstLine = lines[0];
  const hasHeader = firstLine.includes('impCnt') || firstLine.includes('clkCnt') || firstLine.includes('keyword') || firstLine.includes('nccKeywordId');

  const rows: {
    accountId: string; campaignId: string; campaignName: string;
    adGroupId: string; adGroupName: string; keywordId: string;
    keywordText: string; date: Date; impressions: number;
    clicks: number; cost: number; cpc: number; ctr: number;
  }[] = [];

  if (hasHeader) {
    // 헤더 있는 형식 (TSV/CSV)
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    const headers = firstLine.split(delimiter).map((h) => h.trim().replace(/"/g, ''));

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).map((c) => c.trim().replace(/"/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });

      const keywordId = row['nccKeywordId'] || row['keywordId'] || row['nccCriterionId'] || '';
      const keywordText = row['keyword'] || row['criterionValue'] || row['keywordName'] || '';
      if (!keywordId && !keywordText) continue;

      const impressions = parseInt(row['impCnt'] || row['impressions'] || '0') || 0;
      const clicks = parseInt(row['clkCnt'] || row['clicks'] || '0') || 0;
      const cost = parseInt(row['salesAmt'] || row['cost'] || '0') || 0;
      if (impressions === 0 && clicks === 0 && cost === 0) continue; // 성과 0인 행은 저장하지 않음

      const rawCampType = row['campaignTp'] || row['campaignType'] || '';
      const campaignTypeLabel = getCampaignTypeLabel(rawCampType);

      rows.push({
        accountId: account.id, campaignId: row['nccCampaignId'] || '',
        campaignName: campaignTypeLabel, adGroupId: row['nccAdgroupId'] || '',
        adGroupName: '', keywordId: keywordId || `report-${i}`,
        keywordText: keywordText || '-',
        date: new Date(syncDate + 'T00:00:00.000Z'), impressions, clicks, cost,
        cpc: clicks > 0 ? Math.round(cost / clicks) : 0,
        ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0,
      });
    }
  } else {
    // 헤더 없는 고정 형식 (AD_DETAIL)
    // 키워드 마스터 매핑 (ID → 텍스트)
    const keywordMap = await getKeywordMaster(naverAds, account);

    // StatReport 고정 형식 파싱
    // 같은 keywordId의 통계를 합산 (디바이스별로 분리되어 있을 수 있음)
    const statMap: Record<string, { campId: string; agId: string; kwId: string; impressions: number; clicks: number; cost: number }> = {};

    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 15) continue;

      // ID 패턴으로 필드 찾기
      const campId = cols.find((c) => c.startsWith('cmp-')) || '';
      const agId = cols.find((c) => c.startsWith('grp-')) || '';
      const kwId = cols.find((c) => c.startsWith('nkw-')) || cols.find((c) => c.startsWith('crt-')) || '';

      if (!campId) continue;

      // AD_DETAIL(v2) 고정 형식 16컬럼:
      //   일자 고객ID 캠페인ID 광고그룹ID 키워드ID 광고ID 비즈채널ID 매체 지면 지역 PC/M 노출 클릭 광고비 평균노출순위 0
      // 통계는 뒤에서 5·4·3번째. 예전에는 광고비를 numFields[3](=평균노출순위)에서 읽어
      // 광고비가 순위 합계로 잘못 저장되고 있었다. /stats API 합계와 대조해 확정함.
      const numFields = cols.slice(-5).map((c) => parseInt(c) || 0);
      const impressions = numFields[0] || 0;
      const clicks = numFields[1] || 0;
      const cost = numFields[2] || 0;

      const key = kwId || `${campId}-${agId}-unknown`;
      if (!statMap[key]) {
        statMap[key] = { campId, agId, kwId: kwId || key, impressions: 0, clicks: 0, cost: 0 };
      }
      statMap[key].impressions += impressions;
      statMap[key].clicks += clicks;
      statMap[key].cost += cost;
    }

    // 지금은 없어진 캠페인의 과거 실적은 저장하지 않는다.
    // 보고서(StatReport)에는 당시 존재하던 캠페인이 전부 들어있는데, 대시보드 상단
    // KPI 는 살아있는 캠페인만 조회한다. 그대로 저장하면 키워드 표가 KPI 보다 많아진다.
    // 캠페인을 갈아엎은 계정에서 실제로 42% 가 어긋났다.
    //
    // 단, 캠페인 목록 조회 자체가 실패했을 때는 걸러내면 안 된다.
    // 그러면 멀쩡한 하루치가 통째로 0건이 되고, 수집은 '성공'으로 기록돼 아무도 모른다.
    const knownCampaigns = new Set(
      Object.keys(keywordMap).filter((k) => k.startsWith('camp-')).map((k) => k.slice(5))
    );
    if (knownCampaigns.size === 0) {
      console.warn(`[Scheduler] ${account.customerId}: 캠페인 목록을 못 받아 삭제된 캠페인 필터를 건너뜀`);
    }

    // 매핑 적용하여 rows 생성
    for (const [, stat] of Object.entries(statMap)) {
      if (stat.impressions === 0 && stat.clicks === 0 && stat.cost === 0) continue; // 성과 0인 행은 저장하지 않음
      if (knownCampaigns.size > 0 && !knownCampaigns.has(stat.campId)) continue;

      const master = keywordMap[stat.kwId] || keywordMap[`camp-${stat.campId}`];
      const campaignTypeLabel = master?.campaignType || '';
      const keywordText = master?.text || '-';

      rows.push({
        accountId: account.id,
        campaignId: stat.campId,
        campaignName: campaignTypeLabel,
        adGroupId: stat.agId,
        adGroupName: '',
        keywordId: stat.kwId,
        keywordText,
        date: new Date(syncDate + 'T00:00:00.000Z'),
        impressions: stat.impressions,
        clicks: stat.clicks,
        cost: stat.cost,
        cpc: stat.clicks > 0 ? Math.round(stat.cost / stat.clicks) : 0,
        ctr: stat.impressions > 0 ? +((stat.clicks / stat.impressions) * 100).toFixed(2) : 0,
      });
    }
  }

  console.log(`[Scheduler] ${account.customerId}: StatReport ${rows.length}행 파싱 완료`);

  // 파싱 결과가 0행이면 폴백
  if (rows.length === 0) {
    console.log(`[Scheduler] ${account.customerId}: StatReport 파싱 0행 → 기존 방식으로 폴백`);
    return await syncAccountDataLegacy(naverAds, account, syncDate);
  }

  // bulk insert
  if (rows.length > 0) {
    // 기존 데이터 삭제 (같은 날짜)
    await prisma.keywordDailyStat.deleteMany({
      where: { accountId: account.id, date: new Date(syncDate + 'T00:00:00.000Z'), keywordId: { not: { startsWith: 'csv-' } } },
    });

    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      await prisma.keywordDailyStat.createMany({
        data: rows.slice(i, i + BATCH),
        skipDuplicates: true,
      });
    }
  }

  await prisma.syncLog.upsert({
    where: { accountId_date: { accountId: account.id, date: new Date(syncDate) } },
    update: { status: 'SUCCESS', keywordCount: rows.length },
    create: { accountId: account.id, date: new Date(syncDate), status: 'SUCCESS', keywordCount: rows.length },
  });

  console.log(`[Scheduler] ${account.customerId}: StatReport 수집 완료! ${rows.length}개 키워드`);
  return { success: true, date: syncDate, keywordCount: rows.length };
}

// 폴백: 기존 키워드 개별 조회 방식
async function syncAccountDataLegacy(naverAds: NaverAdsService, account: { id: string; customerId: string }, syncDate: string) {
  console.log(`[Scheduler] ${account.customerId}: 기존 방식으로 수집 시작`);
  const fields = ['impCnt', 'clkCnt', 'salesAmt'];
  const timeRange = { since: syncDate, until: syncDate };

  const campResult = await naverAds.getCampaigns();
  if (!campResult.success || !Array.isArray(campResult.data)) {
    return { error: `campaigns failed: ${campResult.error || 'unknown'}` };
  }

  let totalKeywords = 0;

  for (const camp of campResult.data as Record<string, unknown>[]) {
    const campId = (camp.nccCampaignId || camp.campaignId) as string;
    const campName = camp.name as string;
    const campType = (camp.campaignTp || camp.campaignType || '') as string;
    const campaignTypeLabel = getCampaignTypeLabel(campType) || campName;

    const agResult = await naverAds.getAdGroups(campId);
    if (!agResult.success || !Array.isArray(agResult.data)) continue;

    for (const ag of agResult.data as Record<string, unknown>[]) {
      const agId = (ag.nccAdgroupId || ag.adgroupId) as string;
      const agName = ag.name as string;

      const kwResult = await naverAds.getKeywords(agId);
      if (!kwResult.success || !Array.isArray(kwResult.data)) continue;

      const keywords = kwResult.data as Record<string, unknown>[];
      const BATCH = 20;

      for (let i = 0; i < keywords.length; i += BATCH) {
        const batch = keywords.slice(i, i + BATCH);
        const stats = await Promise.all(
          batch.map(async (kw) => {
            const kwId = (kw.nccKeywordId || kw.keywordId) as string;
            const kwText = (kw.keyword || kw.text || kw.name) as string;
            let impCnt = 0, clkCnt = 0, salesAmt = 0;

            try {
              const r = await naverAds.getStats({ id: kwId, fields, timeRange });
              if (r.success && r.data) {
                const rawData = r.data as Record<string, unknown>;
                let rows: Record<string, unknown>[] = [];
                if (Array.isArray(rawData)) rows = rawData;
                else if (rawData.data && Array.isArray(rawData.data)) rows = rawData.data;

                for (const row of rows) {
                  const s = (row.summary || row) as Record<string, number>;
                  impCnt += s.impCnt || 0;
                  clkCnt += s.clkCnt || 0;
                  salesAmt += s.salesAmt || 0;
                }
              }
            } catch { /* 무시 */ }

            return { kwId, kwText, impCnt, clkCnt, salesAmt };
          })
        );

        for (const s of stats) {
          // 성과가 전혀 없는 키워드는 저장하지 않는다.
          // 계정의 모든 키워드를 매일 한 행씩 쌓으면 DB 용량이 폭증한다 (전체의 85%가 0행이었음)
          if (s.impCnt === 0 && s.clkCnt === 0 && s.salesAmt === 0) continue;

          await prisma.keywordDailyStat.upsert({
            where: { keywordId_date: { keywordId: s.kwId, date: new Date(syncDate) } },
            update: { impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
            create: { accountId: account.id, campaignId: campId, campaignName: campaignTypeLabel, adGroupId: agId, adGroupName: agName, keywordId: s.kwId, keywordText: s.kwText, date: new Date(syncDate), impressions: s.impCnt, clicks: s.clkCnt, cost: s.salesAmt, cpc: s.clkCnt > 0 ? Math.round(s.salesAmt / s.clkCnt) : 0, ctr: s.impCnt > 0 ? +((s.clkCnt / s.impCnt) * 100).toFixed(2) : 0 },
          });
          totalKeywords++;
        }
      }
    }
  }

  await prisma.syncLog.upsert({
    where: { accountId_date: { accountId: account.id, date: new Date(syncDate) } },
    update: { status: 'SUCCESS', keywordCount: totalKeywords },
    create: { accountId: account.id, date: new Date(syncDate), status: 'SUCCESS', keywordCount: totalKeywords },
  });

  return { success: true, date: syncDate, keywordCount: totalKeywords };
}

// 수집 실패를 SyncLog에 FAILED로 남긴다.
// 다음 실행에서 재시도할 수 있도록 syncAccountData()는 FAILED 로그를 "이미 수집됨"으로 보지 않는다.
async function recordSyncFailure(accountId: string, syncDate: string, reason: string) {
  try {
    await prisma.syncLog.upsert({
      where: { accountId_date: { accountId, date: new Date(syncDate) } },
      update: { status: 'FAILED', keywordCount: 0 },
      create: { accountId, date: new Date(syncDate), status: 'FAILED', keywordCount: 0 },
    });
    console.error(`[Scheduler] SyncLog FAILED 기록: ${accountId} ${syncDate} — ${reason.slice(0, 200)}`);
  } catch (e) {
    console.error('[Scheduler] SyncLog FAILED 기록 자체가 실패했습니다:', e);
  }
}

async function notifySyncFailure(
  syncDate: string,
  failures: { accountName: string; customerId: string; reason: string }[],
  totalAccounts: number
) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = `<h2>🚨 키워드 수집 실패 (${syncDate})</h2>`;
  html += `<p>전체 ${totalAccounts}개 계정 중 <b style="color:#dc2626;">${failures.length}개 실패</b></p>`;
  html += `<table style="border-collapse: collapse; width: 100%;">`;
  html += `<tr style="background:#fef2f2;"><th style="padding:8px;border:1px solid #ddd;text-align:left;">계정명</th><th style="padding:8px;border:1px solid #ddd;text-align:left;">CustomerID</th><th style="padding:8px;border:1px solid #ddd;text-align:left;">사유</th></tr>`;
  for (const f of failures) {
    html += `<tr><td style="padding:8px;border:1px solid #ddd;">${esc(f.accountName)}</td><td style="padding:8px;border:1px solid #ddd;">${esc(f.customerId)}</td><td style="padding:8px;border:1px solid #ddd;font-family:monospace;font-size:12px;">${esc(f.reason.slice(0, 300))}</td></tr>`;
  }
  html += `</table>`;
  html += `<p style="color:#6b7280;font-size:13px;margin-top:16px;">DB 용량 초과(<code>53100 project size limit</code>)라면 Neon 플랜 또는 보관 기간을 확인하세요.</p>`;

  await sendEmailViaGmailAPI(`🚨 [열끈] 키워드 수집 실패 ${failures.length}개 계정 (${syncDate})`, html);
}

async function runDailySync() {
  console.log('[Scheduler] 일일 데이터 수집 시작...');

  // DB에서 연동된 계정 가져오기 (NaverAdsAccount 테이블)
  const accounts = await prisma.naverAdsAccount.findMany({ where: { isActive: true } });

  if (accounts.length === 0) {
    console.log('[Scheduler] 연동된 계정이 없습니다.');
    return;
  }

  // KST 기준 어제 날짜 계산
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yesterdayKST = new Date(nowKST);
  yesterdayKST.setDate(yesterdayKST.getDate() - 1);
  const syncDate = yesterdayKST.toISOString().slice(0, 10);

  const failures: { accountName: string; customerId: string; reason: string }[] = [];

  for (const account of accounts) {
    try {
      console.log(`[Scheduler] 계정 ${account.customerId} - ${syncDate} 수집 중...`);
      const result = await syncAccountData({
        id: account.id,
        apiKey: account.apiKey,
        secretKey: account.secretKey,
        customerId: account.customerId,
      }, syncDate);
      console.log(`[Scheduler] 계정 ${account.customerId} 결과:`, result);

      if (result && 'error' in result && result.error) {
        await recordSyncFailure(account.id, syncDate, String(result.error));
        failures.push({ accountName: account.accountName, customerId: account.customerId, reason: String(result.error) });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[Scheduler] 계정 ${account.customerId} 수집 실패:`, error);
      await recordSyncFailure(account.id, syncDate, reason);
      failures.push({ accountName: account.accountName, customerId: account.customerId, reason });
    }
  }

  console.log('[Scheduler] 일일 데이터 수집 완료');

  // 실패한 계정이 있으면 메일로 알린다.
  // 예전에는 실패가 로그에만 남고 아무 흔적이 없어서 수집이 한 달간 멈춘 걸 아무도 몰랐다.
  if (failures.length > 0) {
    console.error(`[Scheduler] ⚠️ ${failures.length}/${accounts.length}개 계정 수집 실패`);
    await notifySyncFailure(syncDate, failures, accounts.length).catch((e) =>
      console.error('[Scheduler] 실패 알림 메일 발송 실패:', e)
    );
  }

  // 90일 이전 데이터 자동 삭제
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    const deletedStats = await prisma.keywordDailyStat.deleteMany({
      where: { date: { lt: new Date(cutoffStr + 'T00:00:00.000Z') } },
    });
    const deletedLogs = await prisma.syncLog.deleteMany({
      where: { date: { lt: new Date(cutoffStr + 'T00:00:00.000Z') } },
    });

    if (deletedStats.count > 0 || deletedLogs.count > 0) {
      console.log(`[Scheduler] 90일 이전 데이터 삭제: KeywordDailyStat ${deletedStats.count}행, SyncLog ${deletedLogs.count}행 (기준일: ${cutoffStr})`);
    }
  } catch (error) {
    console.error('[Scheduler] 데이터 정리 실패:', error);
  }
}

// 비즈머니 잔액 체크 + 이메일 발송
async function checkBizmoneyAndNotify() {
  console.log('[Scheduler] 비즈머니 잔액 체크 시작...');

  const accounts = await prisma.naverAdsAccount.findMany({ where: { isActive: true } });
  if (accounts.length === 0) {
    console.log('[Scheduler] 연동된 계정이 없습니다.');
    return;
  }

  const results = await collectBizmoneyResults(accounts);
  const { subject, html } = buildBizmoneyReport(results);
  await sendEmailViaGmailAPI(subject, html);
}


// 과거 누락일 백필.
// runDailySyncIfMissing() 은 '어제' 하루만 확인해서, 이틀 이상 지난 구멍은 영영 안 메워졌다.
// 그 탓에 대시보드에서 과거 기간을 보면 키워드 합계가 네이버 실시간 값보다 적게 나왔다.
// 네이버 StatReport 는 100일 이전 날짜도 내주므로 뒤늦게라도 채울 수 있다.
// 한 번에 몰아 돌면 API 부담이 크므로 maxSyncs 로 끊고, 남은 구멍은 다음 실행이 이어서 채운다.
export async function backfillMissingDates(options: { lookbackDays?: number; maxSyncs?: number; maxDurationMs?: number } = {}) {
  const lookbackDays = options.lookbackDays ?? 14;
  const maxSyncs = options.maxSyncs ?? 20;
  const maxDurationMs = options.maxDurationMs ?? 30 * 60 * 1000;

  const accounts = await prisma.naverAdsAccount.findMany({ where: { isActive: true } });
  if (accounts.length === 0) return { attempted: 0, filled: 0, failed: 0, remaining: 0 };

  // KST 기준 어제부터 과거로 lookbackDays 일. 최신 날짜부터 메운다.
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dates: string[] = [];
  for (let i = 1; i <= lookbackDays; i++) {
    const d = new Date(nowKST);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // 이미 수집된 (계정, 날짜) 조합을 한 번에 읽어 둔다
  const oldest = new Date(dates[dates.length - 1]);
  const logs = await prisma.syncLog.findMany({
    where: { date: { gte: oldest } },
    select: { accountId: true, date: true, status: true },
  });
  const done = new Set(
    logs
      .filter((l) => l.status !== 'FAILED')
      .map((l) => `${l.accountId}|${l.date.toISOString().slice(0, 10)}`)
  );

  // 계정을 연동하기 전 날짜는 채울 의무가 없다. 가드가 없으면 매일 밤 수집 예산을
  // 연동 이전 날짜에 다 써버려서 정작 진짜 구멍이 안 메워진다.
  const missing: { account: (typeof accounts)[number]; date: string }[] = [];
  for (const date of dates) {
    for (const account of accounts) {
      const linkedFrom = account.createdAt.toISOString().slice(0, 10);
      if (date < linkedFrom) continue;
      if (!done.has(`${account.id}|${date}`)) missing.push({ account, date });
    }
  }

  if (missing.length === 0) {
    console.log(`[Backfill] 최근 ${lookbackDays}일 누락 없음`);
    return { attempted: 0, filled: 0, failed: 0, remaining: 0 };
  }

  const target = missing.slice(0, maxSyncs);
  console.log(`[Backfill] 누락 ${missing.length}건 발견 → 이번 실행에서 최대 ${target.length}건 수집 (제한 ${Math.round(maxDurationMs / 60000)}분)`);

  // 건수 외에 시간으로도 끊는다.
  // 실패한 건은 다시 누락으로 잡혀 재시도되는데, 어떤 계정이 계속 실패하면
  // (API 키 만료 등) 매일 밤 90일치를 붙잡고 늘어질 수 있다. 한 건이 느린 경로로
  // 빠지면 몇 분씩 걸리기도 한다. 서버 비용이 예측 가능하도록 상한을 둔다.
  const startedAt = Date.now();
  let filled = 0;
  let failed = 0;
  let stoppedEarly = 0;
  for (const [idx, { account, date }] of target.entries()) {
    if (Date.now() - startedAt > maxDurationMs) {
      stoppedEarly = target.length - idx;
      console.log(`[Backfill] 시간 제한 도달 - ${stoppedEarly}건은 다음 실행으로 넘김`);
      break;
    }
    try {
      const result = await syncAccountData(account, date);
      if (result && 'error' in result && result.error) {
        failed++;
        await recordSyncFailure(account.id, date, String(result.error));
        console.error(`[Backfill] 실패: ${account.accountName} ${date} - ${result.error}`);
      } else {
        filled++;
        console.log(`[Backfill] 완료: ${account.accountName} ${date}`);
      }
    } catch (error) {
      failed++;
      const reason = error instanceof Error ? error.message : String(error);
      await recordSyncFailure(account.id, date, reason).catch(() => {});
      console.error(`[Backfill] 오류: ${account.accountName} ${date}`, error);
    }
  }

  const remaining = missing.length - target.length;
  console.log(`[Backfill] 종료 - 채움 ${filled}건, 실패 ${failed}건, 남은 누락 ${remaining}건`);
  return { attempted: target.length, filled, failed, remaining };
}

// 서버 시작 시 어제 데이터가 수집 안 됐으면 즉시 수집 (Railway 슬립/재시작 대응)
async function runDailySyncIfMissing() {
  // KST 기준 어제 날짜 계산
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yesterdayKST = new Date(nowKST);
  yesterdayKST.setDate(yesterdayKST.getDate() - 1);
  const syncDate = yesterdayKST.toISOString().slice(0, 10);

  const accounts = await prisma.naverAdsAccount.findMany({ where: { isActive: true } });
  if (accounts.length === 0) return;

  for (const account of accounts) {
    const existing = await prisma.syncLog.findUnique({
      where: { accountId_date: { accountId: account.id, date: new Date(syncDate) } },
    });

    if (!existing || existing.status === 'FAILED') {
      console.log(`[Scheduler] 서버 시작 시 누락 감지: ${account.customerId} - ${syncDate} 수집 시작`);
      try {
        const result = await syncAccountData({
          id: account.id,
          apiKey: account.apiKey,
          secretKey: account.secretKey,
          customerId: account.customerId,
        }, syncDate);
        console.log(`[Scheduler] 누락 수집 완료: ${account.customerId}`, result);
        if (result && 'error' in result && result.error) {
          await recordSyncFailure(account.id, syncDate, String(result.error));
        }
      } catch (error) {
        console.error(`[Scheduler] 누락 수집 실패: ${account.customerId}`, error);
        await recordSyncFailure(account.id, syncDate, error instanceof Error ? error.message : String(error));
      }
    }
  }
}

// 서버 시작 시 오늘 9시가 지났는데 메일을 안 보냈으면 즉시 발송
let lastAlertDate = '';
async function runBizmoneyAlertIfMissing() {
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const currentHour = nowKST.getUTCHours(); // KST 시간

  // 오전 9시 이후이고, 오늘 아직 메일을 안 보냈으면
  if (currentHour >= 0 && lastAlertDate !== todayStr) { // UTC 0시 = KST 9시
    console.log(`[Scheduler] 서버 시작 시 잔액 알림 누락 감지 (${todayStr}) - 즉시 발송`);
    lastAlertDate = todayStr;
    await checkBizmoneyAndNotify();
  }
}

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  console.log('[Scheduler] 스케줄러 시작됨 (수집: 매일 새벽 4시, 잔액 알림: 매일 오전 9시 KST)');

  // CSV 큐 처리 시작 (10초마다 확인)
  setInterval(() => {
    processCSVQueue();
  }, 10000);

  // 매일 새벽 2시(KST)에 키워드 수집
  // KST 2시 = UTC 17시 (전날)
  const scheduleSync = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(19, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next.getTime() - now.getTime();
    console.log(`[Scheduler] 다음 수집: ${next.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST (${Math.round(delay / 1000 / 60)}분 후)`);

    setTimeout(() => {
      runDailySync()
        // 보관 기간(90일) 전체를 훑는다. 평소에는 채울 게 없어 비용이 들지 않고,
        // 수집이 며칠 멈췄다 복구된 경우에는 하룻밤에 따라잡는다.
        .then(() => backfillMissingDates({ lookbackDays: 90, maxSyncs: 250 }))
        .catch(console.error);
      scheduleSync();
    }, delay);
  };

  // 매일 오전 9시(KST)에 비즈머니 잔액 체크 + 이메일 발송
  // KST 9시 = UTC 0시
  const scheduleBizmoneyAlert = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(0, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next.getTime() - now.getTime();
    console.log(`[Scheduler] 다음 잔액 알림: ${next.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST (${Math.round(delay / 1000 / 60)}분 후)`);

    setTimeout(() => {
      const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
      lastAlertDate = nowKST.toISOString().slice(0, 10);
      checkBizmoneyAndNotify().catch(console.error);
      scheduleBizmoneyAlert();
    }, delay);
  };

  // 서버 시작 시 어제 데이터가 수집 안 됐으면 즉시 수집 (Railway 슬립 대응)
  // 이어서 과거 누락일도 채운다. 평소에는 채울 게 없어 바로 끝나고,
  // 수집이 멈췄다 복구된 뒤에는 다음 새벽까지 기다리지 않고 바로 따라잡는다.
  runDailySyncIfMissing()
    .then(() => backfillMissingDates({ lookbackDays: 90, maxSyncs: 250 }))
    .catch(console.error);

  // 서버 시작 시 오늘 9시가 지났는데 메일을 안 보냈으면 즉시 발송
  runBizmoneyAlertIfMissing().catch(console.error);

  scheduleSync();
  scheduleBizmoneyAlert();
}


