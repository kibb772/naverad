# Requirements Document

## Introduction

현재 시스템은 네이버 광고만 관리한다. 본 기능은 이 시스템을 멀티 플랫폼(구글, 메타, 당근) 광고 관리로 확장하기 위한 첫 단계로, **멀티 플랫폼 기반구조**와 **구글 광고 연동**을 구현한다.

핵심 원칙은 **기존 네이버 시스템 무손상**이다. 기존 네이버 관련 코드, DB 테이블, API 라우트, 서비스는 수정하지 않으며, 모든 변경은 추가(additive) 방식으로만 이루어진다. 새 플랫폼은 폴더 격리와 공통 추상화 인터페이스(AdPlatformAdapter)를 통해 기존 코드에 영향을 주지 않고 통합된다.

이번 단계의 범위는 (1) 공통 인터페이스, (2) 새 DB 테이블, (3) 통합 대시보드, (4) 플랫폼 네비게이션, (5) 계정 연동 탭 구조, (6) 구글 광고 연동(OAuth + 캠페인/통계 조회 + 구글 광고 관리 화면)까지다. 메타/당근은 구조만 확장 가능하게 두고, 실제 구현은 다음 단계 spec으로 분리한다.

## Glossary

- **System**: 멀티 플랫폼 광고 관리 시스템 전체.
- **Platform**: 광고를 집행하는 외부 채널. 식별자 값은 `NAVER`, `GOOGLE`, `META`, `DAANGN` 중 하나.
- **AdPlatformAdapter**: 모든 플랫폼이 구현하는 공통 추상화 인터페이스. `getCampaigns()`, `getStats()`, `getBalance()` 등의 메서드를 정의한다.
- **Google_Adapter**: 구글 광고를 위한 `AdPlatformAdapter` 구현체. `google-ads-api` npm 라이브러리를 사용한다.
- **PlatformAccount**: 사용자가 연동한 플랫폼별 광고 계정을 저장하는 신규 DB 테이블. `platform`, `userId` 필드를 가지며, 한 사용자가 플랫폼별로 N개 계정을 연동할 수 있다.
- **PlatformDailyStat**: 플랫폼별 일별 지표를 저장하는 신규 DB 테이블. 공통 지표 컬럼과 플랫폼별 특수 지표를 담는 JSON 컬럼을 가진다.
- **Common_Metrics**: 모든 플랫폼이 공유하는 공통 지표. 노출(impressions), 클릭(clicks), CTR, CPC, 소진(cost).
- **Google_Metrics**: 구글 전용 추가 지표. 전환수(conversions), CPA, ROAS, 전환가치(conversionValue).
- **Integrated_Dashboard**: 연동된 모든 플랫폼의 지표를 합산해 보여주는 통합 대시보드 화면.
- **Sidebar_Navigation**: 좌측 사이드바 네비게이션. 통합 대시보드, 플랫폼별 관리 메뉴, 계정 연동, 설정을 포함한다.
- **Account_Connection_Screen**: 계정 연동 화면. 플랫폼별 탭([네이버][구글][메타][당근])을 가진다.
- **OAuth_Credentials**: 구글 연동에 필요한 인증 정보. developer token, client_id, client_secret, refresh_token, customer_id로 구성된다.
- **Connection_Status**: 특정 플랫폼의 연동 여부 상태. 연동됨(connected) 또는 미연동(not connected).
- **Naver_Subsystem**: 기존 네이버 광고 관리 코드, DB 테이블(NaverAdsAccount, Campaign, AdGroup, Keyword, DailyMetric, KeywordDailyStat 등), API 라우트(`src/app/api/naver/*`), 서비스(`src/services/naver-ads.service.ts`)를 포함하는 기존 하위 시스템.

## Requirements

### Requirement 1: 기존 네이버 시스템 무손상

**User Story:** 운영자로서, 멀티 플랫폼 확장 작업이 기존 네이버 광고 관리 기능을 손상시키지 않기를 원한다. 그래야 현재 운영 중인 네이버 광고 관리가 중단 없이 유지된다.

#### Acceptance Criteria

1. THE System SHALL `Naver_Subsystem`에 속하는 다음 자산을 변경하지 않은 상태로 유지한다: 서비스 파일 `src/services/naver-ads.service.ts`, `src/app/api/naver/` 하위의 모든 API 라우트, DB 테이블(NaverAdsAccount, Campaign, AdGroup, Keyword, DailyMetric, KeywordDailyStat, SyncLog).
2. WHERE 데이터베이스 스키마 변경이 필요한 경우, THE System SHALL 신규 테이블 추가 또는 비(非)네이버 테이블에 대한 신규 컬럼 추가(additive)만 사용하며, 기존 네이버 테이블에 대한 ALTER/RENAME/DROP을 수행하지 않는다.
3. THE System SHALL 기존 네이버 DB 테이블의 관찰 가능한 스키마 속성(컬럼명, 타입, nullable 여부, 기본값, PK/FK/unique/index 제약)을 변경하지 않은 상태로 유지한다.
4. WHEN 동일한 입력으로 기존 네이버 광고 관리 화면과 API를 호출하면, THE System SHALL 확장 이전과 동일한 응답 데이터 구조와 값을 반환한다(확장 이전 회귀 테스트 통과로 검증).
5. IF 마이그레이션이 네이버 자산(테이블/컬럼)의 수정·이름변경·삭제를 시도하는 경우, THEN THE System SHALL 해당 마이그레이션을 실패 처리하고 기존 스키마를 보존하며 차단된 대상을 식별하는 오류를 보고한다.
6. WHILE 멀티 플랫폼 요청을 처리하는 동안, THE System SHALL 네이버 하위 시스템의 런타임 동작을 격리하여 영향을 주지 않는다.

### Requirement 2: 공통 추상화 레이어 (AdPlatformAdapter)

**User Story:** 개발자로서, 모든 광고 플랫폼이 공통 인터페이스를 구현하기를 원한다. 그래야 대시보드와 보고서가 플랫폼 구현 세부사항에 의존하지 않고 동작한다.

#### Acceptance Criteria

1. THE System SHALL `getCampaigns()`, `getStats()`, `getBalance()` 메서드를 정의하는 `AdPlatformAdapter` 인터페이스를 `src/services/platforms/types.ts`에 제공한다.
2. THE System SHALL 각 플랫폼별 어댑터 구현체를 플랫폼별 독립 폴더(예: `src/services/platforms/google/`)에 배치한다.
3. WHEN `Integrated_Dashboard` 또는 보고서가 플랫폼 데이터를 조회할 때, THE System SHALL `AdPlatformAdapter` 인터페이스를 통해서만 데이터를 조회한다.
4. WHERE 신규 플랫폼이 추가되는 경우, THE System SHALL `AdPlatformAdapter` 인터페이스 구현만으로 신규 플랫폼을 통합할 수 있는 구조를 제공한다.

### Requirement 3: 플랫폼별 폴더 격리

**User Story:** 개발자로서, 각 플랫폼 코드가 독립된 폴더로 격리되기를 원한다. 그래야 한 플랫폼의 변경이 다른 플랫폼에 영향을 주지 않는다.

#### Acceptance Criteria

1. THE System SHALL 각 플랫폼(구글/메타/당근)의 서비스 코드를 `src/services/platforms/{platform}/` 형태의 독립 폴더에 배치한다.
2. THE System SHALL 각 플랫폼의 API 라우트를 `src/app/api/{platform}/` 형태의 독립 경로에 배치한다.
3. THE System SHALL 구글 어댑터 구현을 `src/services/platforms/google/google-ads.service.ts`에 배치한다.
4. THE System SHALL 구글 전용 API 라우트를 `src/app/api/google/*` 경로에 배치한다.

### Requirement 4: 신규 DB 테이블 (PlatformAccount, PlatformDailyStat)

**User Story:** 운영자로서, 플랫폼별 연동 계정과 일별 지표가 새 테이블에 저장되기를 원한다. 그래야 기존 네이버 데이터에 영향 없이 멀티 플랫폼 데이터를 관리할 수 있다.

#### Acceptance Criteria

1. THE System SHALL `platform`(허용 값: GOOGLE, META, DAANGN 중 정확히 하나), `userId`(필수, 비어 있지 않은 값), 계정 인증 정보(credentials) 필드를 포함하는 신규 테이블 `PlatformAccount`를 제공한다.
2. IF `PlatformAccount` 레코드의 `platform` 값이 GOOGLE, META, DAANGN 중 어느 것과도 일치하지 않거나 `userId`가 비어 있으면, THEN THE System SHALL 해당 레코드 저장을 거부하고 거부 사유를 나타내는 오류를 반환하며 데이터를 저장하지 않는다.
3. THE System SHALL 한 사용자(userId)가 단일 플랫폼에 대해 1개 이상 다수의 `PlatformAccount` 레코드를 보유하는 것을 허용한다.
4. THE System SHALL 공통 지표 컬럼(노출수 impressions: 0 이상의 정수, 클릭수 clicks: 0 이상의 정수, CTR: 0 이상 100 이하의 백분율, CPC: 0 이상의 값, 비용 cost: 0 이상의 값)과 플랫폼별 특수 지표를 저장하는 JSON 컬럼을 포함하는 신규 테이블 `PlatformDailyStat`을 제공한다.
5. THE System SHALL 각 `PlatformDailyStat` 레코드를 정확히 하나의 `PlatformAccount` 및 하나의 날짜(date)와 연관지어 저장하며, (PlatformAccount, date) 조합에 대해 유일성 제약(unique constraint)을 적용한다.
6. WHEN 이미 존재하는 (PlatformAccount, date) 조합에 대한 지표가 다시 저장될 때, THE System SHALL 중복 레코드를 생성하지 않고 해당 기존 레코드의 지표 값을 갱신한다.
7. THE System SHALL `PlatformAccount` 및 `PlatformDailyStat` 테이블의 생성과 데이터 변경이 기존 네이버 관련 테이블의 스키마 및 데이터에 어떠한 변경도 가하지 않도록 보장한다.

### Requirement 5: 멀티 플랫폼 다계정 연동

**User Story:** 광고주로서, 각 플랫폼마다 여러 광고 계정을 연동하기를 원한다. 그래야 운영 중인 모든 계정을 한 시스템에서 관리할 수 있다.

#### Acceptance Criteria

1. THE System SHALL `Account_Connection_Screen`에 [네이버], [구글], [메타], [당근] 4개의 탭을 좌측에서 우측 순서로 제공한다.
2. WHEN 사용자가 네이버 탭을 선택할 때, THE System SHALL 기존 네이버 계정 연동 폼을 필드 구성 및 동작 변경 없이 그대로 표시한다.
3. WHEN 사용자가 구글 탭을 선택할 때, THE System SHALL developer token, client_id, client_secret, refresh_token, customer_id 입력 필드로 구성된 `OAuth_Credentials` 입력 폼을 표시한다.
4. WHEN 사용자가 한 플랫폼에 대해 추가 계정 연동을 요청할 때, THE System SHALL 해당 플랫폼에 신규 `PlatformAccount` 레코드를 생성하고 기존 연동 계정과 함께 목록에 표시한다.
5. WHEN 사용자가 모든 필수 `OAuth_Credentials` 필드를 입력하고 구글 계정 연동을 제출할 때, THE System SHALL 30초 이내에 인증 정보를 검증하고, 검증에 성공하면 연동을 완료하여 연동 성공 상태를 표시한다.
6. IF 사용자가 제출한 `OAuth_Credentials`가 유효하지 않거나 30초 이내에 검증이 완료되지 않은 경우, THEN THE System SHALL 연동을 거부하고, 실패 사유를 포함한 오류 메시지를 표시하며, 사용자가 입력한 값을 유지한다.
7. IF 사용자가 필수 `OAuth_Credentials` 필드 중 하나 이상을 비운 채 연동을 제출하는 경우, THEN THE System SHALL 제출을 거부하고 누락된 필드를 표시한다.
8. IF 추가 연동을 요청한 계정이 동일 플랫폼에 이미 연동된 `PlatformAccount`와 식별자가 동일한 경우, THEN THE System SHALL 연동을 거부하고 중복 사유를 포함한 오류 메시지를 표시한다.

### Requirement 6: 사이드바 네비게이션

**User Story:** 사용자로서, 사이드바에서 통합 대시보드와 각 플랫폼 관리 화면으로 이동하기를 원한다. 그래야 플랫폼 간 이동이 명확하고 빠르다.

#### Acceptance Criteria

1. THE System SHALL `Sidebar_Navigation`에 통합 대시보드 메뉴를 최상단에 제공한다.
2. THE System SHALL `Sidebar_Navigation`에 플랫폼별 관리 메뉴(네이버/구글/메타/당근), 계정 연동 메뉴, 설정 메뉴를 제공한다.
3. WHERE 특정 플랫폼의 `Connection_Status`가 연동됨인 경우, THE System SHALL 해당 플랫폼 메뉴에 초록색 상태 점을 표시한다.
4. WHERE 특정 플랫폼의 `Connection_Status`가 미연동인 경우, THE System SHALL 해당 플랫폼 메뉴에 회색 상태 점을 표시한다.
5. THE System SHALL 각 플랫폼을 고유 색상(네이버=초록, 구글=파랑, 메타=보라, 당근=주황)으로 표시한다.

### Requirement 7: 통합 대시보드 표시 규칙

**User Story:** 광고주로서, 통합 대시보드에서 연동된 플랫폼의 광고 지표를 합산해서 보기를 원한다. 그래야 전체 광고 집행 현황을 한눈에 파악할 수 있다.

#### Acceptance Criteria

1. WHERE 특정 플랫폼의 `Connection_Status`가 미연동인 경우, THE `Integrated_Dashboard` SHALL 해당 플랫폼 카드에 광고 지표 값(광고비, 노출수, 클릭수 등)을 표시하지 않고, 흐리게(비활성 시각 상태) 처리된 "연동하기" 안내 카드를 표시한다.
2. WHERE 특정 플랫폼의 `Connection_Status`가 연동됨이고 해당 플랫폼의 소진 금액이 0인 경우, THE `Integrated_Dashboard` SHALL 해당 플랫폼의 소진 금액을 "₩0"으로 표시한다.
3. THE `Integrated_Dashboard` SHALL `Connection_Status`가 연동됨인 플랫폼의 소진 금액만 합산하여 전체 광고비로 표시하고, 미연동 플랫폼의 값은 합산에서 제외한다.
4. THE `Integrated_Dashboard` SHALL 각 연동된 플랫폼의 비중을 (해당 플랫폼 소진 금액 ÷ 전체 광고비 × 100)으로 계산하여 소수점 첫째 자리에서 반올림한 백분율로 표시하고, 미연동 플랫폼은 비중 계산에서 제외한다.
5. IF 연동된 플랫폼이 하나도 없는 경우, THEN THE `Integrated_Dashboard` SHALL 전체 광고비를 "₩0"으로 표시하고 모든 플랫폼별 비중을 0%로 표시한다.
6. WHEN 사용자가 연동된 플랫폼 카드를 클릭할 때, THE `Integrated_Dashboard` SHALL 해당 플랫폼의 관리 화면으로 이동한다.
7. WHEN 사용자가 미연동 플랫폼의 "연동하기" 안내 카드를 클릭할 때, THE System SHALL `Account_Connection_Screen`의 해당 플랫폼 탭으로 이동한다.

### Requirement 8: 플랫폼별 지표 차이 처리

**User Story:** 광고주로서, 각 플랫폼이 제공하는 고유 지표를 정확히 보기를 원한다. 그래야 플랫폼별 성과를 올바르게 비교할 수 있다.

#### Acceptance Criteria

1. THE System SHALL 네이버와 구글에 대해 `Common_Metrics`(노출, 클릭, CTR, CPC, 소진)를 제공한다.
2. THE System SHALL 구글에 대해 `Common_Metrics`에 더해 `Google_Metrics`(전환수, CPA, ROAS, 전환가치)를 제공한다.
3. THE System SHALL 플랫폼별 특수 지표를 `PlatformDailyStat`의 JSON 컬럼에 저장한다.
4. WHERE 메타 또는 당근 플랫폼에 대한 지표 표시 요청이 발생하는 경우, THE System SHALL 미구현 상태임을 안내하고 구조 확장이 가능한 형태를 유지한다.

### Requirement 9: 구글 광고 연동 (캠페인/통계 조회)

**User Story:** 광고주로서, 연동된 구글 계정의 캠페인과 통계를 조회하기를 원한다. 그래야 구글 광고 성과를 시스템 내에서 확인할 수 있다.

#### Acceptance Criteria

1. WHEN 사용자가 연동된 구글 계정의 캠페인 조회를 요청할 때, THE `Google_Adapter` SHALL `google-ads-api` 라이브러리를 통해 해당 계정의 캠페인 목록(각 캠페인의 식별자, 이름, 상태 포함)을 조회하여 반환한다.
2. WHEN 캠페인 조회 결과 해당 계정에 캠페인이 0건일 때, THE `Google_Adapter` SHALL 빈 목록을 반환한다.
3. WHEN 사용자가 시작일과 종료일을 지정하여 통계 조회를 요청할 때, THE `Google_Adapter` SHALL 해당 기간의 `Common_Metrics`(노출수, 클릭수, CTR, CPC, 소진금액)와 `Google_Metrics`(전환수, CPA, ROAS, 전환가치)를 조회하여 반환한다.
4. IF 통계 조회 요청의 시작일이 종료일보다 이후이거나, 시작일 또는 종료일이 미래 날짜인 경우, THEN THE `Google_Adapter` SHALL 통계를 조회하지 않고 기간이 유효하지 않음을 나타내는 오류 메시지를 반환한다.
5. WHEN 구글 통계 조회가 성공할 때, THE System SHALL 조회된 지표를 캠페인별·일자별 단위로 `PlatformDailyStat`에 저장하며, 동일 캠페인·동일 일자의 기존 레코드가 존재하는 경우 해당 레코드를 새 값으로 갱신한다.
6. IF 구글 API 호출이 실패하는 경우, THEN THE System SHALL 실패 사유를 식별할 수 있는 오류 메시지를 반환하고, 이번 조회분에 대한 부분 저장 없이 `PlatformDailyStat`에 기존에 저장된 지표를 변경 없이 유지한다.
7. IF 구글 계정의 `refresh_token`이 만료되거나 무효하여 인증에 실패한 경우, THEN THE System SHALL 인증 오류임을 나타내는 메시지를 사용자에게 표시하고 계정 재연동 절차를 안내한다.

### Requirement 10: 구글 광고 관리 화면

**User Story:** 광고주로서, 구글 전용 관리 화면에서 캠페인과 통계를 보기를 원한다. 그래야 구글 광고를 플랫폼 맥락에 맞게 관리할 수 있다.

#### Acceptance Criteria

1. WHERE 사용자가 사이드바에서 구글 관리 메뉴를 선택한 경우, THE System SHALL 구글 광고 관리 화면을 표시한다.
2. THE 구글 광고 관리 화면 SHALL 연동된 구글 계정의 캠페인 목록(이름, 상태, 예산 포함)을 표시한다.
3. THE 구글 광고 관리 화면 SHALL 선택된 구글 계정의 `Common_Metrics`와 `Google_Metrics`를 표시한다.
4. WHERE 사용자가 다수의 구글 계정을 연동한 경우, THE 구글 광고 관리 화면 SHALL 계정 선택기를 제공하고 최초 진입 시 목록의 첫 번째 계정을 기본 선택한다.
5. WHEN 사용자가 계정 선택기에서 다른 계정을 선택할 때, THE 구글 광고 관리 화면 SHALL 선택된 계정의 캠페인 목록과 지표로 화면을 갱신한다.
6. WHERE 선택된 구글 계정에 캠페인이 0건인 경우, THE 구글 광고 관리 화면 SHALL 캠페인이 없음을 안내하는 빈 상태를 표시한다.
7. IF 연동된 구글 계정이 없는 경우, THEN THE 구글 광고 관리 화면 SHALL 연동 안내와 `Account_Connection_Screen` 구글 탭으로 이동하는 수단을 표시한다.

### Requirement 11: 메타/당근 구조 확장성 (이번 단계 미구현)

**User Story:** 개발자로서, 메타와 당근이 이번 단계에서는 미구현이지만 향후 추가 가능한 구조이기를 원한다. 그래야 다음 단계에서 기반구조 변경 없이 플랫폼을 추가할 수 있다.

#### Acceptance Criteria

1. THE System SHALL 메타와 당근을 `Platform` 식별자(`META`, `DAANGN`)로 정의한다.
2. THE System SHALL 메타와 당근 메뉴를 `Sidebar_Navigation`에 표시하되 미구현 상태로 노출한다.
3. THE System SHALL 메타와 당근 탭을 `Account_Connection_Screen`에 표시하되 미구현 상태로 노출한다.
4. THE System SHALL 메타와 당근 어댑터를 `AdPlatformAdapter` 인터페이스 구현만으로 추가할 수 있는 폴더 구조를 제공한다.
