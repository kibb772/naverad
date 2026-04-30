import crypto from 'crypto';

interface NaverAdsConfig {
  apiKey: string;
  secretKey: string;
  customerId: string;
}

interface NaverApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export class NaverAdsService {
  private baseUrl = 'https://api.searchad.naver.com';
  private config: NaverAdsConfig;

  constructor(config: NaverAdsConfig) {
    this.config = config;
  }

  private generateSignature(timestamp: string, method: string, path: string): string {
    const message = `${timestamp}.${method}.${path}`;
    return crypto
      .createHmac('sha256', this.config.secretKey)
      .update(message)
      .digest('base64');
  }

  private getHeaders(method: string, path: string): Record<string, string> {
    const timestamp = String(Date.now());
    // 서명 생성 시 쿼리스트링 제외, path만 사용
    const signPath = path.split('?')[0];
    return {
      'X-Timestamp': timestamp,
      'X-API-KEY': this.config.apiKey,
      'X-Customer': this.config.customerId,
      'X-Signature': this.generateSignature(timestamp, method, signPath),
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<NaverApiResponse<T>> {
    try {
      const headers = this.getHeaders(method, path);
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { success: false, error: `API Error ${res.status}: ${errorText}` };
      }

      const data = await res.json();
      return { success: true, data: data as T };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getAccountInfo() {
    return this.request('GET', '/ncc/members');
  }

  async getCampaigns() {
    return this.request('GET', '/ncc/campaigns');
  }

  async getCampaign(campaignId: string) {
    return this.request('GET', `/ncc/campaigns/${campaignId}`);
  }

  async updateCampaignStatus(campaignId: string, status: 'ELIGIBLE' | 'PAUSED') {
    return this.request('PUT', `/ncc/campaigns/${campaignId}`, {
      userLock: status === 'PAUSED',
    });
  }

  async updateCampaignBudget(campaignId: string, dailyBudget: number) {
    return this.request('PUT', `/ncc/campaigns/${campaignId}`, { dailyBudget });
  }

  async getAdGroups(campaignId: string) {
    return this.request('GET', `/ncc/adgroups?nccCampaignId=${campaignId}`);
  }

  async updateAdGroupStatus(adGroupId: string, status: 'ELIGIBLE' | 'PAUSED') {
    return this.request('PUT', `/ncc/adgroups/${adGroupId}`, {
      userLock: status === 'PAUSED',
    });
  }

  async getKeywords(adGroupId: string) {
    return this.request('GET', `/ncc/keywords?nccAdgroupId=${adGroupId}`);
  }

  async updateKeywordBid(keywordId: string, bidAmount: number) {
    return this.request('PUT', `/ncc/keywords/${keywordId}`, {
      bidAmt: bidAmount,
    });
  }

  async updateKeywordStatus(keywordId: string, status: 'ELIGIBLE' | 'PAUSED') {
    return this.request('PUT', `/ncc/keywords/${keywordId}`, {
      userLock: status === 'PAUSED',
    });
  }

  async createCampaign(params: { name: string; dailyBudget: number; campaignType?: string }) {
    return this.request('POST', '/ncc/campaigns', {
      name: params.name,
      campaignTp: params.campaignType || 'WEB_SITE',
      dailyBudget: params.dailyBudget,
    });
  }

  async createAdGroup(campaignId: string, params: { name: string }) {
    return this.request('POST', '/ncc/adgroups', {
      nccCampaignId: campaignId,
      name: params.name,
    });
  }

  async addKeyword(adGroupId: string, params: { text: string; bidAmount: number; matchType?: string }) {
    return this.request('POST', '/ncc/keywords', {
      nccAdgroupId: adGroupId,
      keywords: [{
        keyword: params.text,
        bidAmt: params.bidAmount,
        matchType: params.matchType || 'EXACT',
      }],
    });
  }

  async getStats(params: {
    id: string;
    fields: string[];
    timeRange: { since: string; until: string };
  }) {
    const queryParams = new URLSearchParams({
      id: params.id,
      fields: JSON.stringify(params.fields),
      timeRange: JSON.stringify({ since: params.timeRange.since, until: params.timeRange.until }),
    });
    return this.request('GET', `/stats?${queryParams.toString()}`);
  }

  async getStatsBulk(params: {
    ids: string[];
    fields: string[];
    timeRange: { since: string; until: string };
  }) {
    const results = await Promise.all(
      params.ids.map((id) => this.getStats({ id, fields: params.fields, timeRange: params.timeRange }))
    );
    return results;
  }

  // 외부에서 직접 호출 가능한 request (ids 파라미터 등)
  async requestPublic<T>(method: string, path: string, body?: unknown): Promise<NaverApiResponse<T>> {
    return this.request<T>(method, path, body);
  }

  // StatReport: 한 번에 모든 키워드 통계를 가져오는 대용량 보고서
  async createStatReport(params: {
    reportTp: string; // AD_DETAIL, KEYWORD, NAVERPAY_CONVERSION 등
    statDt: string; // YYYY-MM-DD
    fields?: string[];
  }) {
    return this.request('POST', '/stat-reports', {
      reportTp: params.reportTp,
      statDt: params.statDt,
    });
  }

  async getStatReport(reportId: string) {
    return this.request('GET', `/stat-reports/${reportId}`);
  }

  async getStatReportDownload(reportJobId: string) {
    return this.request('GET', `/stat-reports/${reportJobId}/download`);
  }
}
