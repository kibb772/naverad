import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { enqueueCSV } from '@/lib/csv-queue';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const accountId = formData.get('accountId') as string | null;

    if (!file || !accountId) {
      return NextResponse.json({ error: '파일과 accountId가 필요합니다.' }, { status: 400 });
    }

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

    // 큐에 넣고 바로 응답 (서버 프로세스에서 백그라운드 처리)
    enqueueCSV(accountId, text);
    console.log(`[CSV Upload] ${accountId}: 파일 접수 완료, ${lineCount - 2}행, 큐에 추가됨`);

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
