import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { NaverAdsService } from '@/services/naver-ads.service';
import PDFDocument from 'pdfkit';
import path from 'path';

function cleanName(name: string): string {
  return name.replace(/주식회사/g, '').replace(/\(주\)/g, '').replace(/㈜/g, '').replace(/\s+/g, ' ').trim() || name;
}
function splitRange(since: string, until: string) {
  const ranges: { since: string; until: string }[] = [];
  let s = new Date(since); const e = new Date(until);
  while (s <= e) { const c = new Date(s); c.setDate(c.getDate() + 89); const a = c > e ? e : c; ranges.push({ since: s.toISOString().slice(0,10), until: a.toISOString().slice(0,10) }); s = new Date(a); s.setDate(s.getDate()+1); }
  return ranges;
}

export async function POST(req: NextRequest) {
  try {
    const { accountId, since, until } = await req.json();
    if (!accountId || !since || !until) return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });

    const account = await prisma.naverAdsAccount.findUnique({ where: { id: accountId } });
    if (!account) return NextResponse.json({ error: '계정 없음' }, { status: 404 });

    const displayName = cleanName(account.accountName);
    const naver = new NaverAdsService({ apiKey: account.apiKey, secretKey: account.secretKey, customerId: account.customerId });

    // 비즈머니
    let bizmoney: number | null = null;
    try {
      const b = await Promise.race([naver.getBizmoney(), new Promise<never>((_,r)=>setTimeout(()=>r(new Error('t')),5000))]) as {success:boolean;data?:Record<string,unknown>};
      if (b.success && b.data) bizmoney = (b.data.bizmoney ?? b.data.balance ?? 0) as number;
    } catch {}

    // 캠페인 + 통계
    const cr = await naver.getCampaigns();
    const raw = (cr.success && Array.isArray(cr.data)) ? cr.data as Record<string,unknown>[] : [];
    const camps = raw.map(c => ({ id: (c.nccCampaignId||c.campaignId) as string, name: c.name as string, type: (c.campaignTp as string)||'-', status: c.userLock ? 'PAUSED' : 'ACTIVE' }));

    const chunks2 = splitRange(since, until);
    const fields = ['impCnt','clkCnt','salesAmt','ctr','cpc'];
    const sm: Record<string,{imp:number;clk:number;cost:number}> = {};
    await Promise.all(camps.map(async c => { let ti=0,tc=0,ts=0; for(const ch of chunks2){try{const r=await naver.getStats({id:c.id,fields,timeRange:ch});if(r.success&&r.data){const d=r.data as Record<string,unknown>;const rows:Record<string,unknown>[]=Array.isArray(d)?d:Array.isArray(d.data)?d.data as Record<string,unknown>[]:[];for(const row of rows){if(row.summary){const s=row.summary as Record<string,number>;ti+=s.impCnt||0;tc+=s.clkCnt||0;ts+=s.salesAmt||0;}else{ti+=(row.impCnt as number)||0;tc+=(row.clkCnt as number)||0;ts+=(row.salesAmt as number)||0;}}}}catch{}} sm[c.id]={imp:ti,clk:tc,cost:ts}; }));

    const rows = camps.map(c => { const s=sm[c.id]||{imp:0,clk:0,cost:0}; return {...c,...s,ctr:s.imp>0?+((s.clk/s.imp)*100).toFixed(2):0,cpc:s.clk>0?Math.round(s.cost/s.clk):0}; }).sort((a,b)=>b.cost-a.cost);
    const totCost=rows.reduce((a,r)=>a+r.cost,0), totImp=rows.reduce((a,r)=>a+r.imp,0), totClk=rows.reduce((a,r)=>a+r.clk,0);
    const totCtr=totImp>0?+((totClk/totImp)*100).toFixed(2):0, totCpc=totClk>0?Math.round(totCost/totClk):0;

    // Top 10 키워드
    const sd = new Date(since+'T00:00:00.000Z'), ud = new Date(until+'T23:59:59.999Z');
    const kwRaw = await prisma.keywordDailyStat.groupBy({ by:['keywordText','campaignName'], where:{accountId,date:{gte:sd,lte:ud}}, _sum:{impressions:true,clicks:true,cost:true} });
    const kws = kwRaw.map(s=>({text:s.keywordText,camp:s.campaignName,clk:s._sum.clicks||0,imp:s._sum.impressions||0,cost:s._sum.cost||0,ctr:(s._sum.impressions||0)>0?+(((s._sum.clicks||0)/(s._sum.impressions||0))*100).toFixed(2):0,cpc:(s._sum.clicks||0)>0?Math.round((s._sum.cost||0)/(s._sum.clicks||0)):0})).sort((a,b)=>b.clk-a.clk||b.cost-a.cost).slice(0,10);

    // PDF
    const doc = new PDFDocument({ size:'A4', margin:0 });
    const buf: Buffer[] = []; doc.on('data',(c:Buffer)=>buf.push(c));

    const fontR = path.join(process.cwd(),'public','fonts','NanumGothic.ttf');
    const fontB = path.join(process.cwd(),'public','fonts','NanumGothic-Bold.ttf');
    doc.registerFont('K', fontR); doc.registerFont('KB', fontB); doc.font('K');

    const W=595, dark='#0F2044', accent='#1A56C4', green='#4AE0A0', subText='#7B9FCC', rowAlt='#F8F9FD', rowHi='#EFF4FF', muted='#9AAABB';
    const LM=40, RW=W-80; // left margin, row width

    // === HEADER ===
    doc.rect(0,0,W,75).fill(dark);
    doc.font('KB').fontSize(16).fillColor('#ffffff').text('열끈마케팅 광고 보고서', LM, 22);
    doc.font('K').fontSize(9).fillColor(subText).text(`${since.replace(/-/g,'.')} ~ ${until.replace(/-/g,'.')}`, LM, 46);
    // 비즈머니 우측
    doc.font('K').fontSize(8).fillColor(subText).text('비즈머니 잔액', 440, 22, {width:115,align:'right'});
    const bizVal = bizmoney!==null ? `₩${Math.floor(bizmoney).toLocaleString()}` : '조회불가';
    doc.font('KB').fontSize(14).fillColor(green).text(bizVal, 440, 38, {width:115,align:'right'});

    // === KPI CARDS ===
    const kpiY=85, kpiH=50, kpiW=RW/5;
    const kpis=[{l:'소진',v:`₩${totCost.toLocaleString()}`},{l:'노출수',v:totImp.toLocaleString()},{l:'클릭수',v:totClk.toLocaleString()},{l:'CTR',v:`${totCtr}%`},{l:'CPC',v:`₩${totCpc.toLocaleString()}`}];
    kpis.forEach((k,i)=>{
      const x=LM+i*kpiW;
      if(i>0) doc.moveTo(x,kpiY+8).lineTo(x,kpiY+kpiH-8).strokeColor('#E5E9F0').lineWidth(0.5).stroke();
      doc.font('K').fontSize(7).fillColor('#6B7B8F').text(k.l, x+8, kpiY+8);
      const color = k.l==='CTR' ? accent : dark;
      doc.font('KB').fontSize(14).fillColor(color).text(k.v, x+8, kpiY+24);
    });

    // === SECTION: 캠페인별 성과 ===
    let y=148;
    doc.rect(LM, y, 3, 12).fill(accent);
    doc.font('KB').fontSize(9).fillColor(dark).text('캠페인별 성과', LM+10, y+1);
    y+=22;

    // thead
    const cCols=[LM, LM+70, LM+210, LM+270, LM+330, LM+385, LM+435, LM+480];
    const cHdrs=['유형','캠페인','상태','소진','노출','클릭','CTR','CPC'];
    doc.rect(LM, y, RW, 16).fill(dark);
    cHdrs.forEach((h,i)=>{ doc.font('KB').fontSize(6).fillColor('#ffffff').text(h, cCols[i], y+5); });
    y+=18;

    // 합계 행
    doc.rect(LM, y, RW, 15).fill(rowHi);
    doc.font('KB').fontSize(6.5).fillColor(dark);
    doc.text('합계', cCols[0], y+4); doc.text(`${rows.length}개 캠페인`, cCols[1], y+4);
    doc.text('—', cCols[2], y+4);
    doc.text(`₩${totCost.toLocaleString()}`, cCols[3], y+4);
    doc.text(totImp.toLocaleString(), cCols[4], y+4);
    doc.text(totClk.toLocaleString(), cCols[5], y+4);
    doc.fillColor(accent).text(`${totCtr}%`, cCols[6], y+4);
    doc.fillColor(dark).text(`₩${totCpc.toLocaleString()}`, cCols[7], y+4);
    y+=16;

    // 캠페인 행
    rows.forEach((r,i)=>{
      const bg = r.cost>0 ? rowHi : (i%2===0 ? '#ffffff' : rowAlt);
      doc.rect(LM, y, RW, 15).fill(bg);
      const color = r.status==='PAUSED' ? muted : dark;
      doc.font('K').fontSize(6).fillColor(color);
      doc.text(r.type.length>10?r.type.slice(0,9)+'..':r.type, cCols[0], y+4, {width:68});
      doc.text(r.name.length>20?r.name.slice(0,19)+'..':r.name, cCols[1], y+4, {width:138});
      // 상태 뱃지
      const stColor = r.status==='ACTIVE' ? '#16a34a' : '#dc2626';
      const stText = r.status==='ACTIVE' ? '운영중' : '중지';
      doc.font('K').fontSize(5.5).fillColor(stColor).text(stText, cCols[2], y+4);
      doc.fillColor(color);
      doc.text(`₩${r.cost.toLocaleString()}`, cCols[3], y+4);
      doc.text(r.imp.toLocaleString(), cCols[4], y+4);
      doc.text(r.clk.toLocaleString(), cCols[5], y+4);
      doc.fillColor(r.status==='PAUSED'?muted:accent).text(`${r.ctr}%`, cCols[6], y+4);
      doc.fillColor(color).text(`₩${r.cpc.toLocaleString()}`, cCols[7], y+4);
      y+=15;
    });

    // === SECTION: 클릭 TOP 키워드 ===
    y+=14;
    doc.rect(LM, y, 3, 12).fill(accent);
    doc.font('KB').fontSize(9).fillColor(dark).text('클릭 TOP 키워드', LM+10, y+1);
    y+=22;

    // thead
    const kwCols=[LM, LM+25, LM+120, LM+250, LM+300, LM+355, LM+410, LM+465];
    const kwHdrs=['#','키워드','캠페인','클릭','노출','CTR','CPC','소진'];
    doc.rect(LM, y, RW, 16).fill(dark);
    kwHdrs.forEach((h,i)=>{ doc.font('KB').fontSize(6).fillColor('#ffffff').text(h, kwCols[i], y+5); });
    y+=18;

    kws.forEach((kw,i)=>{
      const bg = i%2===0 ? '#ffffff' : rowAlt;
      doc.rect(LM, y, RW, 16).fill(bg);

      // 순위 뱃지 (원형)
      const badgeColor = i<3 ? accent : dark;
      const cx = kwCols[0]+7, cy = y+8;
      doc.circle(cx, cy, 7).fill(badgeColor);
      doc.font('KB').fontSize(6).fillColor('#ffffff').text(`${i+1}`, cx-4, cy-4, {width:8,align:'center'});

      // 키워드
      doc.font('K').fontSize(6.5).fillColor(dark).text(kw.text.length>14?kw.text.slice(0,13)+'..':kw.text, kwCols[1], y+5, {width:125});
      // 캠페인 뱃지
      doc.font('K').fontSize(5.5).fillColor(accent).text(kw.camp||'-', kwCols[2], y+5, {width:125});
      // 수치
      doc.font('K').fontSize(6.5).fillColor(dark);
      doc.text(kw.clk.toLocaleString(), kwCols[3], y+5);
      doc.text(kw.imp.toLocaleString(), kwCols[4], y+5);
      // CTR 강조
      const ctrVal = Number(kw.ctr);
      doc.fillColor(ctrVal>=5 ? accent : dark).text(`${kw.ctr}%`, kwCols[5], y+5);
      doc.fillColor(dark).text(`₩${kw.cpc.toLocaleString()}`, kwCols[6], y+5);
      doc.text(`₩${kw.cost.toLocaleString()}`, kwCols[7], y+5);
      y+=16;
    });

    // === FOOTER ===
    const fY = 820;
    doc.rect(0, fY, W, 22).fill(dark);
    doc.font('K').fontSize(6.5).fillColor(subText).text('열끈마케팅 광고 관리 보고서', LM, fY+7);
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'.');
    doc.font('K').fontSize(6.5).fillColor(subText).text(`생성일 ${today}`, 400, fY+7, {width:155,align:'right'});

    doc.end();
    const pdfBuf = await new Promise<Buffer>(res=>{ doc.on('end',()=>res(Buffer.concat(buf))); });

    return new NextResponse(new Uint8Array(pdfBuf), { headers: {
      'Content-Type':'application/pdf',
      'Content-Disposition':`attachment; filename="${encodeURIComponent(displayName)}_report_${since}_${until}.pdf"`,
    }});
  } catch(error) {
    console.error('PDF report error:', error);
    return NextResponse.json({ error:'보고서 생성 중 오류' }, { status:500 });
  }
}
