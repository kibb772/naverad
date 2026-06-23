/**
 * 구글 광고 API refresh_token 발급 스크립트
 *
 * 사용법:
 *   1. Google Cloud Console에서 OAuth 클라이언트(데스크톱 앱) 생성 후
 *      client_id, client_secret 확보
 *   2. 아래 명령으로 실행:
 *        node scripts/get-google-refresh-token.mjs <client_id> <client_secret>
 *   3. 출력된 URL을 브라우저에서 열고 MCC 계정으로 로그인 → 권한 허용
 *   4. 리디렉션된 주소(localhost)에서 자동으로 refresh_token이 출력됨
 *
 * 발급된 refresh_token을 .env 의 GOOGLE_ADS_REFRESH_TOKEN 에 넣으면 됨.
 */

import http from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';

const clientId = process.argv[2];
const clientSecret = process.argv[3];

if (!clientId || !clientSecret) {
  console.error('사용법: node scripts/get-google-refresh-token.mjs <client_id> <client_secret>');
  process.exit(1);
}

const PORT = 3939;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

// CSRF 방지용 state
const state = crypto.randomBytes(16).toString('hex');

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // refresh_token 항상 받기
authUrl.searchParams.set('state', state);

console.log('\n=== 1) 아래 URL을 브라우저에서 여세요 (MCC 계정으로 로그인) ===\n');
console.log(authUrl.toString());
console.log('\n로그인 후 권한을 허용하면 이 창에 refresh_token이 출력됩니다.\n');

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  if (reqUrl.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = reqUrl.searchParams.get('code');
  const returnedState = reqUrl.searchParams.get('state');

  if (returnedState !== state) {
    res.writeHead(400);
    res.end('state 불일치 (CSRF 방지). 다시 시도하세요.');
    return;
  }
  if (!code) {
    res.writeHead(400);
    res.end('authorization code가 없습니다.');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();

    if (data.refresh_token) {
      console.log('\n=== ✅ refresh_token 발급 성공 ===\n');
      console.log(data.refresh_token);
      console.log('\n위 값을 .env 의 GOOGLE_ADS_REFRESH_TOKEN 에 넣으세요.\n');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>refresh_token 발급 완료. 터미널을 확인하세요. 이 창은 닫아도 됩니다.</h2>');
    } else {
      console.error('\n❌ refresh_token이 응답에 없습니다. 응답:', JSON.stringify(data, null, 2));
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>refresh_token 발급 실패. 터미널을 확인하세요.</h2>');
    }
  } catch (e) {
    console.error('토큰 교환 오류:', e);
    res.writeHead(500);
    res.end('토큰 교환 중 오류');
  } finally {
    setTimeout(() => server.close(() => process.exit(0)), 1000);
  }
});

server.listen(PORT, () => {
  console.log(`(로컬 콜백 서버가 http://localhost:${PORT} 에서 대기 중...)`);
});
