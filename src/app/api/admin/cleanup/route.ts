import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    // 모든 키워드 통계 + 수집 로그 삭제
    const deletedStats = await prisma.keywordDailyStat.deleteMany({});
    const deletedLogs = await prisma.syncLog.deleteMany({});

    return NextResponse.json({
      success: true,
      deleted: { stats: deletedStats.count, logs: deletedLogs.count },
      message: '모든 키워드 통계 및 수집 로그가 삭제되었습니다. CSV를 다시 업로드하세요.',
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
