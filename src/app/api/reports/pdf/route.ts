import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { NaverAdsService } from '@/services/naver-ads.service';
import PDFDocument from 'pdfkit';
import path from 'path';

function cleanName(n: string) { return n.replace(/주식회사/g,'').replace(/\(주\)/g,'').replace(/㈜/g,'').replace(/\s+/g,' ').trim()||n; }
function splitRange(s: string, u: string) { const r:{since:string;until:string}[]=[]; let d=new Date(s); const e=new Date(u); while(d<=e){const c=new Date(d);c.setDate(c.getDate()+89);const a=c>e?e:c;r.push({since:d.toISOString().slice(0,10),until:a.toISOString().slice(0,10)});d=new Date(a);d.setDate(d.getDate()+1);} return r; }
function mapType(t: string) { const m: Record<string,string>={'POWER_LINK':'파워링크','POWER_CONTENTS':'파워컨텐츠','WEB_SITE':'파워링크','PLACE':'플레이스','SHOPPING':'쇼핑검색'}; return m[t]||''; }

export async function POST(req: NextRequest) {
  try {
    const { accountId, since, until } = await req.json();
    if (!accountId||!since||!until) return NextResponse.json({error:'필수 파라미터 누락'},{status:400});
    const account = await prisma.naverAdsAccount.findUnique({where:{id:accountId}});
    if (!account) return NextResponse.json({error:'계정 없음'},{status:404});

    const displayName = cleanName(account.accountName);
    const naver = new NaverAdsService({apiKey:account.apiKey,secretKey:account.secretKey,customerId:account.customerId});

    let bizmoney: number|null = null;
    try { const b=await Promise.race([naver.getBizmoney(),new Promise<never>((_,r)=>setTimeout(()=>r(new Error('t')),5000))]) as {success:boolean;data?:Record<string,unknown>}; if(b.success&&b.data) bizmoney=(b.data.bizmoney??b.data.balance??0) as number; } catch{}

    const cr=await naver.getCampaigns();
    const raw=(cr.success&&Array.isArray(cr.data))?cr.data as Record<string,unknown>[]:[];
    const camps=raw.map(c=>({id:(c.nccCampaignId||c.campaignId) as string,name:c.name as string,type:(c.campaignTp as string)||'',status:c.userLock?'PAUSED':'ACTIVE'}));

    const dateChunks=splitRange(since,until), fields=['impCnt','clkCnt','salesAmt'];
    const sm:Record<string,{imp:number;clk:number;cost:number}>={};
    await Promise.all(camps.map(async c=>{let ti=0,tc=0,ts=0;for(const ch of dateChunks){try{const r=await naver.getStats({id:c.id,fields,timeRange:ch});if(r.success&&r.data){const d=r.data as Record<string,unknown>;const rows:Record<string,unknown>[]=Array.isArray(d)?d:Array.isArray(d.data)?d.data as Record<string,unknown>[]:[];for(const row of rows){if(row.summary){const s=row.summary as Record<string,number>;ti+=s.impCnt||0;tc+=s.clkCnt||0;ts+=s.salesAmt||0;}else{ti+=(row.impCnt as number)||0;tc+=(row.clkCnt as number)||0;ts+=(row.salesAmt as number)||0;}}}}catch{}}sm[c.id]={imp:ti,clk:tc,cost:ts};}));

    const rows=camps.map(c=>{const s=sm[c.id]||{imp:0,clk:0,cost:0};return{...c,...s,ctr:s.imp>0?+((s.clk/s.imp)*100).toFixed(2):0,cpc:s.clk>0?Math.round(s.cost/s.clk):0};}).sort((a,b)=>b.cost-a.cost);
    const totCost=rows.reduce((a,r)=>a+r.cost,0),totImp=rows.reduce((a,r)=>a+r.imp,0),totClk=rows.reduce((a,r)=>a+r.clk,0);
    const totCtr=totImp>0?+((totClk/totImp)*100).toFixed(2):0,totCpc=totClk>0?Math.round(totCost/totClk):0;

    const sd2=new Date(since+'T00:00:00.000Z'),ud2=new Date(until+'T23:59:59.999Z');
    const kwRaw=await prisma.keywordDailyStat.groupBy({by:['keywordText','campaignName'],where:{accountId,date:{gte:sd2,lte:ud2}},_sum:{impressions:true,clicks:true,cost:true}});
    const kws=kwRaw.map(s=>({text:s.keywordText,camp:s.campaignName,clk:s._sum.clicks||0,imp:s._sum.impressions||0,cost:s._sum.cost||0,ctr:(s._sum.impressions||0)>0?+(((s._sum.clicks||0)/(s._sum.impressions||0))*100).toFixed(2):0,cpc:(s._sum.clicks||0)>0?Math.round((s._sum.cost||0)/(s._sum.clicks||0)):0})).sort((a,b)=>b.clk-a.clk||b.cost-a.cost).slice(0,15);

    // === PDF 생성 ===
    const doc = new PDFDocument({size:'A4',margin:0});
    const buf:Buffer[]=[]; doc.on('data',(c:Buffer)=>buf.push(c));

    const fR=path.join(process.cwd(),'public','fonts','NanumGothic.ttf');
    const fB=path.join(process.cwd(),'public','fonts','NanumGothic-Bold.ttf');
    doc.registerFont('R',fR); doc.registerFont('B',fB);

    const W=595,LM=32,RM=32,CW=W-LM-RM;
    const dark='#0F2044',accent='#1A56C4',greenC='#4AE0A0',sub='#7B9FCC',rowAlt='#F8F9FD',rowHi='#EFF4FF',muted='#9AAABB',footerTxt='#4A6A99';

    // ─── HEADER ───
    doc.rect(0,0,W,80).fill(dark);
    doc.font('B').fontSize(16).fillColor('#ffffff').text('열끈마케팅 광고 보고서',LM,24);
    doc.font('R').fontSize(10).fillColor(sub).text(`${since.replace(/-/g,'.')} ~ ${until.replace(/-/g,'.')}`,LM,48);
    doc.font('R').fontSize(9).fillColor(sub).text('비즈머니 잔액',W-RM-120,20,{width:120,align:'right'});
    const bizStr=bizmoney!==null?`₩${Math.floor(bizmoney).toLocaleString()}`:'조회불가';
    doc.font('B').fontSize(15).fillColor(greenC).text(bizStr,W-RM-120,38,{width:120,align:'right'});

    // ─── KPI ───
    let y=92;
    const kpiW=CW/5;
    const kpis=[{l:'소진',v:`₩${totCost.toLocaleString()}`},{l:'노출수',v:totImp.toLocaleString()},{l:'클릭수',v:totClk.toLocaleString()},{l:'CTR',v:`${totCtr}%`},{l:'CPC',v:`₩${totCpc.toLocaleString()}`}];
    kpis.forEach((k,i)=>{
      const x=LM+i*kpiW;
      if(i>0){doc.moveTo(x,y+4).lineTo(x,y+42).strokeColor('#E2E6EE').lineWidth(0.5).stroke();}
      doc.font('R').fontSize(8).fillColor('#6B7B8F').text(k.l,x+10,y+6);
      doc.font('B').fontSize(16).fillColor(k.l==='CTR'?accent:dark).text(k.v,x+10,y+22);
    });
    y+=56;

    // ─── 캠페인별 성과 ───
    y+=20;
    doc.rect(LM,y,3,13).fill(accent);
    doc.font('B').fontSize(10).fillColor(dark).text('캠페인별 성과',LM+12,y+1);
    y+=24;

    const cX=[LM,LM+72,LM+220,LM+285,LM+345,LM+395,LM+445,LM+490];
    const cW=[70,146,63,58,48,48,43,CW-(490-LM+LM)];
    // thead
    doc.rect(LM,y,CW,18).fill(dark);
    ['유형','캠페인','상태','소진','노출','클릭','CTR','CPC'].forEach((h,i)=>{doc.font('B').fontSize(6.5).fillColor(sub).text(h,cX[i],y+5);});
    y+=20;

    // 합계 행
    doc.rect(LM,y,CW,20).fill(rowHi);
    doc.font('B').fontSize(7).fillColor(dark);
    doc.text('합계',cX[0],y+6); doc.text(`${rows.length}개 캠페인`,cX[1],y+6); doc.text('—',cX[2],y+6);
    doc.fillColor(accent).text(`₩${totCost.toLocaleString()}`,cX[3],y+6);
    doc.fillColor(dark).text(totImp.toLocaleString(),cX[4],y+6); doc.text(totClk.toLocaleString(),cX[5],y+6);
    doc.fillColor(accent).text(`${totCtr}%`,cX[6],y+6); doc.fillColor(dark).text(`₩${totCpc.toLocaleString()}`,cX[7],y+6);
    y+=21;

    // 캠페인 행
    rows.forEach((r,i)=>{
      const hasCost=r.cost>0;
      const bg=hasCost?rowHi:(i%2===0?'#ffffff':rowAlt);
      doc.rect(LM,y,CW,20).fill(bg);
      const txtC=r.status==='PAUSED'?muted:dark;
      doc.font('R').fontSize(7).fillColor(txtC);
      doc.text(mapType(r.type),cX[0],y+6,{width:68});
      doc.text(r.name.length>22?r.name.slice(0,21)+'…':r.name,cX[1],y+6,{width:144});
      // 상태 뱃지
      const stBg=r.status==='ACTIVE'?'#E1F5EE':'#F1EFE8';
      const stTxt=r.status==='ACTIVE'?'#0F6E56':'#5F5E5A';
      const stLabel=r.status==='ACTIVE'?'운영중':'중지';
      doc.roundedRect(cX[2],y+4,32,13,3).fill(stBg);
      doc.font('R').fontSize(6).fillColor(stTxt).text(stLabel,cX[2]+4,y+7);
      // 수치
      doc.fillColor(hasCost?accent:txtC).text(`₩${r.cost.toLocaleString()}`,cX[3],y+6);
      doc.fillColor(txtC).text(r.imp.toLocaleString(),cX[4],y+6);
      doc.text(r.clk.toLocaleString(),cX[5],y+6);
      doc.fillColor(hasCost?accent:txtC).text(`${r.ctr}%`,cX[6],y+6);
      doc.fillColor(txtC).text(`₩${r.cpc.toLocaleString()}`,cX[7],y+6);
      y+=20;
    });

    // ─── 클릭 TOP 키워드 (고정 위치) ───
    y=460;
    doc.rect(LM,y,3,13).fill(accent);
    doc.font('B').fontSize(10).fillColor(dark).text('클릭 TOP 키워드',LM+12,y+1);
    y+=24;

    const kwX=[LM,LM+30,LM+140,LM+270,LM+320,LM+375,LM+430,LM+485];
    doc.rect(LM,y,CW,18).fill(dark);
    ['#','키워드','캠페인','클릭','노출','CTR','CPC','소진'].forEach((h,i)=>{doc.font('B').fontSize(6.5).fillColor(sub).text(h,kwX[i],y+5);});
    y+=20;

    kws.forEach((kw,i)=>{
      const bg=i%2===0?'#ffffff':rowAlt;
      doc.rect(LM,y,CW,22).fill(bg);

      // 원형 뱃지
      const badgeC=i<3?accent:dark;
      const bx=kwX[0]+9, by=y+11;
      doc.circle(bx,by,9).fill(badgeC);
      doc.font('B').fontSize(8).fillColor('#ffffff').text(`${i+1}`,bx-5,by-5,{width:10,align:'center'});

      // 키워드
      doc.font('R').fontSize(7.5).fillColor(dark).text(kw.text.length>15?kw.text.slice(0,14)+'…':kw.text,kwX[1],y+7,{width:128});
      // 캠페인 뱃지
      doc.font('R').fontSize(6.5).fillColor(accent).text(kw.camp||'-',kwX[2],y+7,{width:125});
      // 수치
      doc.font('R').fontSize(7.5).fillColor(dark);
      doc.text(kw.clk.toLocaleString(),kwX[3],y+7);
      doc.text(kw.imp.toLocaleString(),kwX[4],y+7);
      const ctrN=Number(kw.ctr);
      doc.fillColor(ctrN>=5?accent:dark).text(`${kw.ctr}%`,kwX[5],y+7);
      doc.fillColor(dark).text(`₩${kw.cpc.toLocaleString()}`,kwX[6],y+7);
      doc.text(`₩${kw.cost.toLocaleString()}`,kwX[7],y+7);
      y+=22;
    });

    // ─── FOOTER (A4 하단 고정) ───
    const footerY=814;
    doc.rect(0,footerY,W,28).fill(dark);
    doc.font('R').fontSize(7).fillColor(footerTxt).text('열끈마케팅 광고 관리 보고서',LM,footerY+9);
    const today=new Date().toISOString().slice(0,10).replace(/-/g,'.');
    doc.font('R').fontSize(7).fillColor(footerTxt).text(`생성일 ${today}`,W-RM-130,footerY+9,{width:130,align:'right'});

    doc.end();
    const pdfBuf=await new Promise<Buffer>(res=>{doc.on('end',()=>res(Buffer.concat(buf)));});

    return new NextResponse(new Uint8Array(pdfBuf),{headers:{
      'Content-Type':'application/pdf',
      'Content-Disposition':`attachment; filename="${encodeURIComponent(displayName)}_report_${since}_${until}.pdf"`,
    }});
  } catch(error) {
    console.error('PDF report error:',error);
    return NextResponse.json({error:'보고서 생성 중 오류'},{status:500});
  }
}
