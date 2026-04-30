export interface MetricData {
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  cost: number;
  roas: number;
}

export interface AnomalyResult {
  metric: string;
  currentValue: number;
  avgValue: number;
  changePercent: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  direction: 'UP' | 'DOWN';
}

const THRESHOLDS = {
  INFO: 15,
  WARNING: 25,
  CRITICAL: 40,
};

const METRIC_LABELS: Record<string, string> = {
  ctr: 'CTR',
  cpc: 'CPC',
  conversions: '전환수',
  roas: 'ROAS',
  cost: '소진액',
};

export function detectAnomalies(
  current: MetricData,
  history: MetricData[],
  windowSize = 7
): AnomalyResult[] {
  if (history.length < 2) return [];

  const recent = history.slice(-windowSize);
  const anomalies: AnomalyResult[] = [];
  const metricsToCheck: (keyof MetricData)[] = ['ctr', 'cpc', 'conversions', 'roas', 'cost'];

  for (const metric of metricsToCheck) {
    const values = recent.map((d) => Number(d[metric])).filter((v) => !isNaN(v));
    if (values.length === 0) continue;

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    if (avg === 0) continue;

    const currentVal = Number(current[metric]);
    const changePercent = ((currentVal - avg) / avg) * 100;
    const absChange = Math.abs(changePercent);

    if (absChange >= THRESHOLDS.INFO) {
      const isNegativeChange =
        (metric === 'ctr' || metric === 'conversions' || metric === 'roas')
          ? changePercent < 0
          : changePercent > 0;

      let severity: AnomalyResult['severity'] = 'INFO';
      if (absChange >= THRESHOLDS.CRITICAL) severity = 'CRITICAL';
      else if (absChange >= THRESHOLDS.WARNING) severity = 'WARNING';

      if (isNegativeChange && severity === 'INFO') severity = 'WARNING';

      anomalies.push({
        metric: METRIC_LABELS[metric] || metric,
        currentValue: currentVal,
        avgValue: Math.round(avg * 100) / 100,
        changePercent: Math.round(changePercent * 10) / 10,
        severity,
        direction: changePercent > 0 ? 'UP' : 'DOWN',
      });
    }
  }

  return anomalies.sort((a, b) => {
    const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return order[a.severity] - order[b.severity];
  });
}

export function calculateMetricAverage(history: MetricData[], metric: keyof MetricData, days: number): number {
  const recent = history.slice(-days);
  if (recent.length === 0) return 0;
  const values = recent.map((d) => Number(d[metric]));
  return values.reduce((a, b) => a + b, 0) / values.length;
}
