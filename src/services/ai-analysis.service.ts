import OpenAI from 'openai';
import { AnomalyResult } from './anomaly-detection.service';

function getOpenAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export interface DiagnosisResult {
  causes: { name: string; description: string; probability: number }[];
  suggestions: { action: string; priority: 'HIGH' | 'MEDIUM' | 'LOW'; expectedEffect: string }[];
  summary: string;
}

export interface DailyReportResult {
  grade: '매우 좋음' | '좋음' | '보통' | '경고' | '위험';
  summary: string;
  highlights: string[];
  actionPlan: string[];
}

export async function diagnoseCause(
  anomalies: AnomalyResult[],
  campaignName: string,
  context?: string
): Promise<DiagnosisResult> {
  const anomalyDesc = anomalies
    .map((a) => `- ${a.metric}: ${a.changePercent > 0 ? '+' : ''}${a.changePercent}% (현재: ${a.currentValue}, 평균: ${a.avgValue}, 심각도: ${a.severity})`)
    .join('\n');

  const prompt = `네이버 검색광고 캠페인 "${campaignName}"에서 다음 이상이 감지되었습니다:

${anomalyDesc}

${context ? `추가 컨텍스트: ${context}` : ''}

다음 JSON 형식으로 원인 진단과 개선 제안을 제공해주세요:
{
  "causes": [
    { "name": "원인명", "description": "상세 설명", "probability": 0-100 }
  ],
  "suggestions": [
    { "action": "구체적 액션", "priority": "HIGH|MEDIUM|LOW", "expectedEffect": "예상 효과" }
  ],
  "summary": "한 문단 요약"
}

원인은 최대 4개, 제안은 최대 5개로 제한해주세요. 네이버 검색광고 특성을 반영해주세요.`;

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: '당신은 네이버 검색광고 전문 분석가입니다. 데이터 기반으로 정확한 원인 진단과 실행 가능한 개선 제안을 제공합니다.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');

    return JSON.parse(content) as DiagnosisResult;
  } catch (error) {
    return {
      causes: [{ name: '분석 실패', description: 'AI 분석 중 오류가 발생했습니다.', probability: 0 }],
      suggestions: [{ action: '수동으로 캠페인을 확인해주세요.', priority: 'HIGH', expectedEffect: '직접 확인' }],
      summary: 'AI 분석을 완료하지 못했습니다. 수동 확인이 필요합니다.',
    };
  }
}

export async function generateDailyReport(
  metrics: { campaignName: string; today: Record<string, number>; avg7d: Record<string, number>; avg30d: Record<string, number> }[]
): Promise<DailyReportResult> {
  const metricsDesc = metrics
    .map((m) => `캠페인 "${m.campaignName}": 오늘 노출 ${m.today.impressions}, 클릭 ${m.today.clicks}, CTR ${m.today.ctr}%, CPC ${m.today.cpc}원, 전환 ${m.today.conversions}, ROAS ${m.today.roas}% (7일 평균 CTR ${m.avg7d.ctr}%, 30일 평균 CTR ${m.avg30d.ctr}%)`)
    .join('\n');

  const prompt = `오늘의 네이버 검색광고 성과를 분석해주세요:

${metricsDesc}

다음 JSON 형식으로 일간 리포트를 작성해주세요:
{
  "grade": "매우 좋음|좋음|보통|경고|위험",
  "summary": "전체 성과 요약 (2-3문장)",
  "highlights": ["주요 포인트 1", "주요 포인트 2"],
  "actionPlan": ["내일 액션 1", "내일 액션 2"]
}`;

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: '당신은 네이버 검색광고 성과 분석 전문가입니다. 간결하고 실행 가능한 리포트를 작성합니다.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');

    return JSON.parse(content) as DailyReportResult;
  } catch {
    return {
      grade: '보통',
      summary: 'AI 리포트 생성 중 오류가 발생했습니다.',
      highlights: ['수동 확인이 필요합니다.'],
      actionPlan: ['대시보드에서 직접 성과를 확인해주세요.'],
    };
  }
}
