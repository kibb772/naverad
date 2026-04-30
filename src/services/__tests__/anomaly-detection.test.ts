import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { detectAnomalies, calculateMetricAverage, MetricData } from '../anomaly-detection.service';

const makeMetric = (overrides: Partial<MetricData> = {}): MetricData => ({
  date: '2026-04-22',
  impressions: 1000,
  clicks: 50,
  ctr: 5.0,
  cpc: 500,
  conversions: 10,
  cost: 25000,
  roas: 400,
  ...overrides,
});

describe('detectAnomalies', () => {
  it('returns empty array when history is too short', () => {
    const current = makeMetric();
    expect(detectAnomalies(current, [])).toEqual([]);
    expect(detectAnomalies(current, [makeMetric()])).toEqual([]);
  });

  it('detects CPC increase above threshold', () => {
    const history = Array.from({ length: 7 }, () => makeMetric({ cpc: 500 }));
    const current = makeMetric({ cpc: 750 }); // +50%

    const anomalies = detectAnomalies(current, history);
    const cpcAnomaly = anomalies.find((a) => a.metric === 'CPC');

    expect(cpcAnomaly).toBeDefined();
    expect(cpcAnomaly!.severity).toBe('CRITICAL');
    expect(cpcAnomaly!.direction).toBe('UP');
  });

  it('detects CTR decrease', () => {
    const history = Array.from({ length: 7 }, () => makeMetric({ ctr: 5.0 }));
    const current = makeMetric({ ctr: 3.0 }); // -40%

    const anomalies = detectAnomalies(current, history);
    const ctrAnomaly = anomalies.find((a) => a.metric === 'CTR');

    expect(ctrAnomaly).toBeDefined();
    expect(ctrAnomaly!.direction).toBe('DOWN');
  });

  it('returns no anomalies when values are stable', () => {
    const history = Array.from({ length: 7 }, () => makeMetric());
    const current = makeMetric();

    const anomalies = detectAnomalies(current, history);
    expect(anomalies).toEqual([]);
  });

  it('sorts anomalies by severity (CRITICAL first)', () => {
    const history = Array.from({ length: 7 }, () => makeMetric({ cpc: 500, ctr: 5.0 }));
    const current = makeMetric({ cpc: 750, ctr: 2.5 }); // CPC +50%, CTR -50%

    const anomalies = detectAnomalies(current, history);
    if (anomalies.length >= 2) {
      const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
      for (let i = 1; i < anomalies.length; i++) {
        expect(severityOrder[anomalies[i].severity]).toBeGreaterThanOrEqual(
          severityOrder[anomalies[i - 1].severity]
        );
      }
    }
  });
});

describe('detectAnomalies - PBT', () => {
  const metricArb = fc.record({
    date: fc.constant('2026-04-22'),
    impressions: fc.integer({ min: 0, max: 100000 }),
    clicks: fc.integer({ min: 0, max: 10000 }),
    ctr: fc.float({ min: 0, max: 100, noNaN: true }),
    cpc: fc.float({ min: 0, max: 10000, noNaN: true }),
    conversions: fc.integer({ min: 0, max: 1000 }),
    cost: fc.integer({ min: 0, max: 10000000 }),
    roas: fc.float({ min: 0, max: 10000, noNaN: true }),
  }) as fc.Arbitrary<MetricData>;

  it('PBT: anomaly count is always non-negative and bounded', () => {
    fc.assert(
      fc.property(metricArb, fc.array(metricArb, { minLength: 2, maxLength: 30 }), (current, history) => {
        const anomalies = detectAnomalies(current, history);
        expect(anomalies.length).toBeGreaterThanOrEqual(0);
        expect(anomalies.length).toBeLessThanOrEqual(5); // max 5 metrics checked
      })
    );
  });

  it('PBT: all anomalies have valid severity', () => {
    fc.assert(
      fc.property(metricArb, fc.array(metricArb, { minLength: 2, maxLength: 30 }), (current, history) => {
        const anomalies = detectAnomalies(current, history);
        for (const a of anomalies) {
          expect(['INFO', 'WARNING', 'CRITICAL']).toContain(a.severity);
          expect(['UP', 'DOWN']).toContain(a.direction);
          expect(typeof a.changePercent).toBe('number');
          expect(typeof a.currentValue).toBe('number');
          expect(typeof a.avgValue).toBe('number');
        }
      })
    );
  });

  it('PBT: identical current and history produces no anomalies', () => {
    fc.assert(
      fc.property(metricArb, fc.integer({ min: 2, max: 10 }), (metric, count) => {
        const history = Array.from({ length: count }, () => ({ ...metric }));
        const anomalies = detectAnomalies(metric, history);
        expect(anomalies).toEqual([]);
      })
    );
  });
});

describe('calculateMetricAverage', () => {
  it('returns 0 for empty history', () => {
    expect(calculateMetricAverage([], 'ctr', 7)).toBe(0);
  });

  it('calculates correct average', () => {
    const history = [makeMetric({ ctr: 4 }), makeMetric({ ctr: 6 })];
    expect(calculateMetricAverage(history, 'ctr', 7)).toBe(5);
  });

  it('PBT: average is always between min and max of values', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 30 }),
        (values) => {
          const history = values.map((v) => makeMetric({ ctr: v }));
          const avg = calculateMetricAverage(history, 'ctr', 30);
          const min = Math.min(...values);
          const max = Math.max(...values);
          expect(avg).toBeGreaterThanOrEqual(min - 0.001);
          expect(avg).toBeLessThanOrEqual(max + 0.001);
        }
      )
    );
  });
});
