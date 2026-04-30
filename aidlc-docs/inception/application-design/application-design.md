# Application Design: 열끈 광고 분석기

## 컴포넌트 구조

### 1. Auth Module
- 카카오 OAuth + 이메일/비밀번호 인증
- JWT 토큰 발급/검증
- 세션 관리

### 2. Naver Ads Integration Module
- 네이버 검색광고 API 클라이언트
- 데이터 수집 스케줄러
- 캠페인/광고그룹/키워드 CRUD 조작

### 3. Dashboard Module
- 핵심 지표 집계 서비스
- 기간별 비교 로직
- 실시간 데이터 표시

### 4. AI Analysis Module
- 이상 탐지 엔진 (통계 기반 기준값 비교)
- GPT-4.1 원인 진단
- 개선 제안 생성

### 5. Report Module
- 일간 AI 리포트 생성
- 성과 등급 산정

### 6. Notification Module
- 대시보드 알림
- 이메일 발송
- 카카오 알림톡

### 7. Campaign Management Module
- 캠페인/광고그룹/키워드 ON/OFF
- 예산/입찰가 조정
- 신규 캠페인/광고그룹/키워드 생성

## 서비스 레이어

```
Frontend (Next.js Pages/Components)
    ↓ API Routes
Backend API (Next.js API Routes)
    ↓
Services Layer
    ├── AuthService
    ├── NaverAdsService
    ├── DashboardService
    ├── AnomalyDetectionService
    ├── AIAnalysisService
    ├── ReportService
    ├── NotificationService
    └── CampaignManagementService
    ↓
Data Layer
    ├── PostgreSQL (Users, Accounts, Metrics, Alerts)
    └── Redis (Cache, Sessions)
```

## 데이터 모델 (핵심)

- User: id, email, password_hash, name, phone, kakao_id
- NaverAdsAccount: id, user_id, api_key, secret_key, customer_id
- Campaign: id, account_id, naver_campaign_id, name, status, daily_budget
- AdGroup: id, campaign_id, naver_adgroup_id, name, status
- Keyword: id, adgroup_id, naver_keyword_id, text, bid_amount, status
- DailyMetric: id, entity_type, entity_id, date, impressions, clicks, ctr, cpc, conversions, cost, roas
- Alert: id, user_id, type, severity, message, diagnosed, created_at
- AIDiagnosis: id, alert_id, causes_json, suggestions_json, created_at
