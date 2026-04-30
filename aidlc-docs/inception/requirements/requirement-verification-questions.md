# 요구사항 확인 질문

알려조와 동일한 구조의 네이버 검색광고 전용 AI 분석·관리 서비스를 만들기 위해 몇 가지 확인이 필요합니다.
각 질문의 [Answer]: 뒤에 선택지 알파벳을 입력해 주세요.

---

## Question 1
서비스 이름은 어떻게 할까요?

A) 알려조와 동일하게 "알려조" 사용
B) 새로운 이름 사용 (아래 [Answer]: 뒤에 이름을 적어주세요)
C) 나중에 결정
X) Other (please describe after [Answer]: tag below)

[Answer]: 열끈 광고 분석기

## Question 2
인증 방식은 어떻게 할까요?

A) 카카오 OAuth + 이메일/비밀번호 (알려조와 동일)
B) 이메일/비밀번호만
C) 카카오 OAuth만
D) 네이버 OAuth + 이메일/비밀번호
X) Other (please describe after [Answer]: tag below)

[Answer]: a

## Question 3
네이버 검색광고 API 연동 시, 직접 조절 가능한 범위는 어디까지 원하시나요?

A) 캠페인 ON/OFF + 일예산 조정만
B) 캠페인 ON/OFF + 일예산 + 입찰가 조정
C) 캠페인/광고그룹/키워드 전체 ON/OFF + 일예산 + 입찰가 + 새 캠페인 생성
D) 네이버 검색광고 API가 지원하는 모든 조작 (캠페인/광고그룹/키워드/소재 CRUD + 예산 + 입찰가)
X) Other (please describe after [Answer]: tag below)

[Answer]: c

## Question 4
AI 이상 탐지 및 원인 진단 기능의 범위는?

A) 알려조와 동일 (이상 탐지 + 원인 진단 + 개선 제안 텍스트)
B) 알려조 + 개선 제안을 클릭하면 자동으로 적용 (예: "입찰가 15% 낮추기" 클릭 시 실제 반영)
C) 이상 탐지 알림만 (원인 진단 없이)
X) Other (please describe after [Answer]: tag below)

[Answer]: a

## Question 5
AI 리포트 기능은 어떤 수준으로 원하시나요?

A) 알려조와 동일 (일간 요약 + 성과 등급 + 액션 플랜)
B) 일간 요약만 (간단한 텍스트)
C) 일간 + 주간 + 월간 리포트 전부
D) 대행사용 클라이언트 보고서 자동 생성까지 포함
X) Other (please describe after [Answer]: tag below)

[Answer]: a

## Question 6
알림 채널은 어떤 것을 지원할까요?

A) 대시보드 내 알림만
B) 대시보드 + 이메일
C) 대시보드 + 이메일 + 카카오톡 알림톡
D) 대시보드 + 이메일 + 슬랙
X) Other (please describe after [Answer]: tag below)

[Answer]: c

## Question 7
요금제 구조는 어떻게 할까요?

A) 알려조와 동일한 4단계 (FREE/STARTER/PRO/ENTERPRISE)
B) 무료 + 유료 2단계만
C) 일단 무료로만 운영 (요금제는 나중에)
X) Other (please describe after [Answer]: tag below)

[Answer]: c

## Question 8
경쟁사 분석 기능 (Meta Ad Library 기반)은 포함할까요? 네이버 검색광고 전용이라 Meta 기반 경쟁사 분석은 맞지 않을 수 있습니다.

A) 제외 (네이버 검색광고에 집중)
B) 네이버 키워드 기반 경쟁사 분석으로 대체 (키워드별 경쟁 입찰가, 노출 순위 등)
C) 포함하되 나중에 구현
X) Other (please describe after [Answer]: tag below)

[Answer]: a

## Question 9
기술 스택은 어떤 것을 선호하시나요?

A) Next.js (프론트엔드) + Node.js (백엔드) — 알려조와 유사
B) Next.js (프론트엔드) + Python/FastAPI (백엔드)
C) React (프론트엔드) + Node.js (백엔드)
D) 기술 스택은 AI-DLC가 추천해주는 대로
X) Other (please describe after [Answer]: tag below)

[Answer]: a

## Question 10
AI 엔진은 어떤 것을 사용할까요?

A) OpenAI GPT-4.1 (알려조와 동일)
B) OpenAI GPT-4o
C) Claude (Anthropic)
D) AWS Bedrock (여러 모델 선택 가능)
X) Other (please describe after [Answer]: tag below)

[Answer]: a

## Question: Security Extensions
이 프로젝트에 보안 확장 규칙을 적용할까요?

A) Yes — 모든 SECURITY 규칙을 블로킹 제약으로 적용 (프로덕션 수준 애플리케이션에 권장)
B) No — 모든 SECURITY 규칙 건너뛰기 (PoC, 프로토타입, 실험적 프로젝트에 적합)
X) Other (please describe after [Answer]: tag below)

[Answer]: a

## Question: Property-Based Testing Extension
이 프로젝트에 속성 기반 테스팅(PBT) 규칙을 적용할까요?

A) Yes — 모든 PBT 규칙을 블로킹 제약으로 적용 (비즈니스 로직, 데이터 변환, 직렬화, 상태 관리 컴포넌트가 있는 프로젝트에 권장)
B) Partial — 순수 함수와 직렬화 라운드트립에만 PBT 규칙 적용 (알고리즘 복잡도가 제한적인 프로젝트에 적합)
C) No — 모든 PBT 규칙 건너뛰기 (단순 CRUD, UI 전용, 비즈니스 로직이 거의 없는 프로젝트에 적합)
X) Other (please describe after [Answer]: tag below)

[Answer]: a
