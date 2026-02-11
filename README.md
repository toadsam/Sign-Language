# Whims of Wonder - Sign Language

수어를 처음 접하는 사용자도 부담 없이 학습할 수 있도록, **퀴즈형 수어 읽기 학습**과 **텍스트 기반 수어 표현 확인**을 결합한 웹 서비스 프로토타입입니다.

## 프로젝트 개요
이 프로젝트는 "수어를 보여주는 것"에서 끝나지 않고, 사용자가 수어 동작과 의미를 반복적으로 연결하며 익히는 학습 경험을 만드는 데 초점을 둡니다.

- 수어 동작을 보고 의미를 맞히는 학습 흐름
- 텍스트 입력을 수어 표현 확인으로 연결하는 보조 흐름
- 프론트엔드/백엔드 분리 구조로 확장 가능한 기반 제공

## 핵심 기능
### 1) 수어 읽기 퀴즈
- 영상/아바타 동작 제시
- 사용자가 의미를 선택/입력
- 즉시 정답 피드백 제공

### 2) 텍스트 기반 표현 확인
- 한글/영어 단어(또는 짧은 문장) 입력
- 의미에 대응하는 수어 표현 확인(프로토타입 단계)

### 3) 백엔드 헬스체크 연동
- 프론트엔드에서 `/api/health` 호출
- 백엔드 상태를 UI에서 확인 가능

## 기술 스택
| 영역 | 스택 |
| --- | --- |
| Frontend | React 18, Vite 5, React Router |
| Backend | Spring Boot 3.2, Java 17, Gradle |
| Dev | Node.js, npm, Gradle |

## 프로젝트 구조
```text
Sign-Language/
|- frontend/
|  |- src/
|  |  |- App.jsx
|  |  |- pages/JjhTest.jsx
|  |  \- api/client.js
|  \- vite.config.js
|- backend/
|  |- src/main/java/com/wow/signlanguage/
|  |  |- api/HealthController.java
|  |  \- config/WebConfig.java
|  \- src/main/resources/application.yml
\- README.md
```

## 빠른 시작
### 사전 요구사항
- Node.js 18+
- npm
- Java 17
- Gradle

### 1. 백엔드 실행
```bash
cd backend
gradle bootRun
```
- 기본 실행 주소: `http://localhost:8080`

### 2. 프론트엔드 실행
```bash
cd frontend
npm install
npm run dev
```
- 기본 실행 주소: `http://localhost:5173`
- Vite 프록시 설정으로 `/api` 요청은 `http://localhost:8080`으로 전달됩니다.

### 3. 동작 확인
- 브라우저에서 `http://localhost:5173` 접속
- 메인 화면의 Backend 상태 표시 확인
- 또는 `http://localhost:8080/api/health` 직접 호출

예시 응답:
```json
{ "status": "ok" }
```

## 현재 구현 상태
- 메인 랜딩/소개 UI 구성 완료
- 임시 수어 퀴즈 페이지(`/jjhtest`) 구현
- 백엔드 헬스체크 API 구현 및 프론트 연동 완료

## 팀 목표 요약
- 수어 학습 접근성 향상
- 최소 30개 이상의 수어 학습 콘텐츠 확장
- 반복 학습 중심 UX 검증 및 개선

## 향후 계획
- 수어 표현 데이터셋 확장
- 정답 판별/피드백 로직 고도화
- 학습 기록(정확도, 반복 횟수) 저장 기능 추가
- 배포 환경 구성 및 사용자 테스트 확대

## 팀 구성
| 이름 | 역할 |
| --- | --- |
| 류태원 | 프론트엔드, UI/UX, API 연동 |
| 박지헌 | 백엔드, API 설계, 데이터 처리 |
| 박가원 | 3D 아바타/수어 애니메이션 |
| 정재훈 | 백엔드, API 설계, 데이터 처리 |

---
문의/협업 제안은 저장소 이슈를 통해 남겨주세요.
