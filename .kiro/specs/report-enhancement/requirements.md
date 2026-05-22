# Requirements Document

## Introduction

광고 보고서(PDF) 개선 기능. 현재 보고서에 비즈머니 잔액 표시, 광고그룹별 성과, 일별 추이 차트, 캠페인 유형별 성과, Top 10 키워드 조정, 계정명 표기 정리 등의 항목을 추가 및 수정하여 보고서의 정보 밀도와 가독성을 향상시킨다.

## Glossary

- **PDF_Report_Generator**: PDFKit을 사용하여 광고 성과 보고서를 PDF 형식으로 생성하는 시스템 모듈 (src/app/api/reports/pdf/route.ts)
- **Bizmoney_Service**: 네이버 광고 API를 통해 비즈머니 잔액 정보를 조회하는 서비스 모듈 (src/app/api/naver/bizmoney/route.ts)
- **KeywordDailyStat**: 키워드별 일간 통계 데이터를 저장하는 데이터베이스 테이블 (accountId, campaignId, campaignName, adGroupId, adGroupName, keywordId, keywordText, date, impressions, clicks, cost, cpc, ctr)
- **Campaign**: 캠페인 정보를 저장하는 데이터베이스 테이블 (campaignType 필드 포함)
- **AdGroup**: 광고그룹 정보를 저장하는 데이터베이스 테이블
- **비즈머니(Bizmoney)**: 네이버 광고 시스템에서 광고비 결제에 사용되는 선불 충전금
- **CTR**: Click-Through Rate, 클릭률 (클릭수 / 노출수 × 100)
- **CPC**: Cost Per Click, 클릭당 비용 (소진 / 클릭수)
- **소진(Cost)**: 해당 기간 동안 사용된 광고비 총액
- **Daily_Trend_Chart**: 보고서 기간 내 날짜별 지표 변화를 시각적으로 표현하는 라인/바 차트

## Requirements

### Requirement 1: 비즈머니 잔액 최상단 표시

**User Story:** 광고주로서, 보고서 최상단에서 현재 비즈머니 잔액을 즉시 확인하고 싶다. 이를 통해 잔액 부족 여부를 빠르게 판단할 수 있다.

#### Acceptance Criteria

1. WHEN 보고서 생성 요청이 수신되면, THE PDF_Report_Generator SHALL 해당 계정의 인증 정보(apiKey, secretKey, customerId)를 사용하여 Bizmoney_Service를 호출하고, 최대 5초 이내에 현재 비즈머니 잔액을 조회한다.
2. WHEN 비즈머니 잔액 조회가 성공하면, THE PDF_Report_Generator SHALL 보고서 1페이지 헤더 영역과 핵심 지표 요약 사이(헤더 하단 직후, 핵심 지표 상단 직전)에 "비즈머니 잔액: ₩{천 단위 쉼표가 포함된 정수 금액}" 형식으로 잔액을 표시한다.
3. IF 비즈머니 잔액 조회가 실패하면(네트워크 오류, 타임아웃 5초 초과, 또는 API 응답 오류 포함), THEN THE PDF_Report_Generator SHALL 동일 위치에 "비즈머니 잔액: 조회 불가" 텍스트를 표시하고 보고서의 나머지 섹션 생성을 중단 없이 계속 진행한다.
4. WHEN 비즈머니 잔액이 0원 이하인 경우, THE PDF_Report_Generator SHALL 잔액 텍스트를 경고 색상(붉은 계열)으로 표시하여 잔액 부족 상태를 시각적으로 구분한다.

### Requirement 2: 광고그룹별 성과 테이블

**User Story:** 광고주로서, 광고그룹 단위의 성과를 확인하고 싶다. 이를 통해 어떤 광고그룹이 효율적인지 비교 분석할 수 있다.

#### Acceptance Criteria

1. WHEN 보고서가 생성될 때, THE PDF_Report_Generator SHALL KeywordDailyStat 테이블에서 선택된 계정(accountId)과 보고서 기간(since~until) 내의 데이터를 adGroupId 기준으로 집계하여 각 광고그룹의 소진(cost 합계), 노출(impressions 합계), 클릭(clicks 합계), CTR(클릭수÷노출수×100, 소수점 둘째 자리), CPC(소진÷클릭수, 정수 반올림)를 산출한다.
2. THE PDF_Report_Generator SHALL 광고그룹별 성과 테이블에 다음 컬럼을 포함한다: 그룹명(adGroupName, 최대 30자 초과 시 말줄임 처리), 소진(₩ 접두사 + 천 단위 콤마), 노출(천 단위 콤마), 클릭(천 단위 콤마), CTR(소수점 둘째 자리 + % 접미사), CPC(₩ 접두사 + 천 단위 콤마).
3. THE PDF_Report_Generator SHALL 광고그룹별 성과 테이블을 소진 금액 내림차순으로 정렬하며, 소진 금액이 동일한 경우 클릭수 내림차순으로 정렬하여 표시한다.
4. IF 광고그룹 수가 한 페이지 최대 행 수(36행)를 초과하면, THEN THE PDF_Report_Generator SHALL 자동으로 다음 페이지에 테이블 헤더를 포함하여 이어서 렌더링한다.
5. IF 보고서 기간 내 해당 계정의 KeywordDailyStat 데이터가 존재하지 않으면, THEN THE PDF_Report_Generator SHALL 광고그룹별 성과 테이블 영역에 "해당 기간에 광고그룹 데이터가 없습니다"라는 안내 문구를 표시한다.
6. IF 특정 광고그룹의 노출수가 0이면, THEN THE PDF_Report_Generator SHALL 해당 광고그룹의 CTR을 0.00%로, CPC를 ₩0으로 표시한다.

### Requirement 3: 일별 추이 차트

**User Story:** 광고주로서, 보고서 기간 내 날짜별 소진/클릭/노출 변화 추이를 시각적으로 확인하고 싶다. 이를 통해 성과 트렌드를 파악할 수 있다.

#### Acceptance Criteria

1. WHEN 보고서가 생성될 때, THE PDF_Report_Generator SHALL KeywordDailyStat 테이블에서 보고서 기간(since~until) 내 날짜(date) 기준으로 소진(cost), 클릭(clicks), 노출(impressions) 데이터를 일별로 합산 집계하며, 데이터가 없는 날짜는 0으로 채워 기간 내 모든 날짜를 포함한다.
2. WHEN 일별 집계 데이터가 준비되면, THE PDF_Report_Generator SHALL 차트 영역을 가로 515pt(A4 좌우 마진 40pt 제외), 세로 200pt 크기로 배치하고, 일별 소진 금액을 바(rect) 차트로 시각화한다.
3. WHEN 일별 집계 데이터가 준비되면, THE PDF_Report_Generator SHALL 동일 차트 영역에 일별 클릭수를 라인 차트로, 일별 노출수를 별도 색상의 라인 차트로 소진 바 차트 위에 겹쳐서 시각화한다.
4. THE Daily_Trend_Chart SHALL X축에 날짜를 "MM.DD" 형식으로, 좌측 Y축에 소진 금액(원 단위)을, 우측 Y축에 클릭수/노출수를 표시하여 스케일이 다른 지표를 구분한다.
5. IF 보고서 기간이 30일을 초과하면, THEN THE PDF_Report_Generator SHALL X축 날짜 레이블을 5일 간격으로 표시한다.
6. IF 보고서 기간이 30일 이하이면, THEN THE PDF_Report_Generator SHALL X축 날짜 레이블을 모든 날짜에 대해 표시한다.
7. IF 보고서 기간 내 모든 날짜의 집계 값이 0이면, THEN THE PDF_Report_Generator SHALL 차트 대신 "해당 기간에 데이터가 없습니다"라는 안내 문구를 차트 영역에 표시한다.
8. THE Daily_Trend_Chart SHALL 차트 상단에 범례를 표시하여 소진(바), 클릭(라인), 노출(라인) 각 지표의 색상을 구분할 수 있도록 한다.

### Requirement 4: 캠페인 유형별 성과 테이블

**User Story:** 광고주로서, 캠페인 유형(파워링크, 쇼핑검색 등)별로 구분된 성과를 확인하고 싶다. 이를 통해 어떤 광고 유형이 효과적인지 판단할 수 있다.

#### Acceptance Criteria

1. WHEN 보고서가 생성될 때, THE PDF_Report_Generator SHALL Campaign 테이블의 campaignType 필드를 기준으로 동일 유형에 속한 캠페인들의 소진(cost 합산), 노출(impressions 합산), 클릭(clicks 합산)을 집계하고, CTR은 (총 클릭 ÷ 총 노출 × 100)으로, CPC는 (총 소진 ÷ 총 클릭)으로 산출한다.
2. THE PDF_Report_Generator SHALL 캠페인 유형별 성과 테이블에 다음 컬럼을 포함한다: 유형명, 소진(원 단위, 천 단위 콤마 구분), 노출(정수, 천 단위 콤마 구분), 클릭(정수, 천 단위 콤마 구분), CTR(소수점 둘째 자리까지 표시, % 단위), CPC(원 단위, 천 단위 콤마 구분).
3. THE PDF_Report_Generator SHALL 캠페인 유형별 성과 테이블을 소진 금액 내림차순으로 정렬하여 표시한다.
4. IF campaignType 값이 null이거나 빈 문자열(공백만 포함된 문자열 포함)이면, THEN THE PDF_Report_Generator SHALL 해당 캠페인을 "기타" 유형으로 분류하여 집계에 포함한다.
5. IF 특정 캠페인 유형의 총 노출이 0이면, THEN THE PDF_Report_Generator SHALL 해당 유형의 CTR을 0.00%로, 총 클릭이 0이면 CPC를 ₩0으로 표시한다.
6. IF 조회 기간 내 해당 계정에 캠페인 성과 데이터가 존재하지 않으면, THEN THE PDF_Report_Generator SHALL 캠페인 유형별 성과 테이블 영역에 "해당 기간에 데이터가 없습니다" 메시지를 표시한다.

### Requirement 5: Top 10 키워드 테이블 조정

**User Story:** 광고주로서, 클릭 기준 상위 10개 키워드만 보고서에 표시하고 싶다. 이를 통해 핵심 키워드에 집중하여 보고서를 간결하게 유지할 수 있다.

#### Acceptance Criteria

1. WHEN 보고서가 생성될 때, THE PDF_Report_Generator SHALL KeywordDailyStat 데이터를 keywordText 기준으로 그룹화한 후 클릭수 합산 내림차순으로 정렬하여 상위 10개 키워드를 선별한다. 클릭수가 동일한 키워드가 존재할 경우, 소진액(cost) 내림차순을 2차 정렬 기준으로 적용한다.
2. THE PDF_Report_Generator SHALL Top 키워드 테이블에 다음 컬럼을 순서대로 포함한다: 순위(1~10 정수), 키워드명(keywordText), 캠페인명(campaignName), 클릭(합산 정수, 천 단위 구분자 포함), 노출(합산 정수, 천 단위 구분자 포함), CTR(소수점 2자리 백분율), CPC(원화 정수, ₩ 접두사), 소진(원화 정수, ₩ 접두사).
3. IF 보고서 기간 내 키워드 데이터가 10개 미만인 경우, THEN THE PDF_Report_Generator SHALL 존재하는 키워드 전체를 표시하고, 빈 행 없이 테이블을 구성한다.
4. WHEN 보고서가 생성될 때, THE PDF_Report_Generator SHALL Top 키워드 테이블의 상위 3개 키워드(순위 1~3)를 강조 색상(blue)으로 표시하고, 나머지 키워드(순위 4~10)는 기본 색상(navy)으로 표시한다.

### Requirement 6: 계정명 '주식회사' 표기 제거

**User Story:** 광고주로서, 보고서에 표시되는 계정명에서 '주식회사' 텍스트가 제거되기를 원한다. 이를 통해 보고서 내 계정명 표시가 간결해진다.

#### Acceptance Criteria

1. WHEN 보고서에 계정명을 표시할 때, THE PDF_Report_Generator SHALL accountName 문자열에서 '주식회사', '(주)', '㈜' 텍스트를 위치(접두, 접미, 중간)에 관계없이 모두 제거한다.
2. WHEN '주식회사', '(주)', '㈜' 텍스트를 제거한 후, THE PDF_Report_Generator SHALL 연속된 공백을 단일 공백으로 치환하고, 문자열 앞뒤의 공백을 제거하여 불필요한 공백이 남지 않도록 한다.
3. THE PDF_Report_Generator SHALL 원본 데이터베이스의 accountName 값은 변경하지 않고, PDF 헤더 표시 및 파일명 생성 시에만 '주식회사', '(주)', '㈜' 텍스트를 제거한다.
4. IF 제거 후 accountName이 빈 문자열이 되는 경우, THEN THE PDF_Report_Generator SHALL 원본 accountName을 그대로 표시한다.

### Requirement 7: 보고서 페이지 구조 재배치

**User Story:** 광고주로서, 개선된 보고서가 논리적인 순서로 정보를 제공하기를 원한다. 이를 통해 보고서를 순차적으로 읽으며 전체 성과를 파악할 수 있다.

#### Acceptance Criteria

1. THE PDF_Report_Generator SHALL 보고서를 다음 순서로 구성한다: (1) 표지 + 비즈머니 잔액 + 핵심 지표 요약(소진액, 노출수, 클릭수, CTR, CPC), (2) 일별 추이 차트, (3) 캠페인 유형별 성과, (4) 광고그룹별 성과, (5) Top 10 키워드(클릭수 기준 내림차순).
2. THE PDF_Report_Generator SHALL 각 주요 섹션((2)~(5))을 새 페이지에서 시작하며, 섹션 시작 부분에 14pt 이상의 섹션 제목과 영문 부제를 페이지 상단 헤더 영역에 표시한다.
3. THE PDF_Report_Generator SHALL 모든 페이지 하단에 "현재 페이지 / 전체 페이지" 형식의 페이지 번호와 "ⓒ 열끈마케팅 · 키로 광고 관리 시스템" 푸터 텍스트를 표시한다.
4. IF 특정 섹션에 해당하는 데이터가 존재하지 않는 경우(예: 키워드 데이터 없음), THEN THE PDF_Report_Generator SHALL 해당 섹션에 "데이터 없음"을 표시하고 섹션 구조는 유지한다.
5. THE PDF_Report_Generator SHALL A4 크기(210mm × 297mm) 세로 방향으로 보고서를 생성하며, 전체 보고서는 최소 5페이지로 구성한다.
