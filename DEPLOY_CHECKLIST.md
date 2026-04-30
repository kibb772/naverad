# 배포 체크리스트

## DB 전환 (SQLite → PostgreSQL)
1. `prisma/schema.prisma`에서 provider를 `sqlite` → `postgresql`로 변경
2. `url`을 `"file:./dev.db"` → `env("DATABASE_URL")`로 변경
3. `.env`에 PostgreSQL 연결 URL 추가
4. `npx prisma db push` 실행

## 환경변수 설정 (.env)
- DATABASE_URL (PostgreSQL)
- NEXTAUTH_URL (배포 도메인)
- NEXTAUTH_SECRET
- KAKAO_CLIENT_ID / KAKAO_CLIENT_SECRET
- OPENAI_API_KEY
- 이메일/카카오 알림톡 설정

## 자동 데이터 수집 (Cron)
- Vercel 배포 시: vercel.json에 cron 설정 추가
- 매일 새벽 6시 `/api/naver/sync` 자동 호출
- 자체 서버 시: 현재 scheduler.ts가 자동 동작

## 카카오 로그인
- Kakao Developers에서 Redirect URI를 배포 도메인으로 변경
- 앱 대표 도메인을 실제 도메인으로 변경
