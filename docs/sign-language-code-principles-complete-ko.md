# Sign-Language 프로젝트 코드 구조와 동작 원리 완전 상세 설명서

이 문서는 `Sign-Language` 프로젝트의 코드를 처음 보는 사람도 전체 구조, 각 파일의 역할, 기능이 실행되는 원리, 그리고 코드 안에 담긴 개발 개념을 이해할 수 있도록 정리한 추가 문서이다. 기존 문서들이 프로젝트 목적과 수어 학습 서비스의 개념을 설명한다면, 이 문서는 실제 코드 기준으로 "어떤 파일이 어떤 기능을 맡고, 요청이 들어오면 어떤 순서로 처리되며, 왜 이런 구조가 필요한지"를 자세히 설명한다.

## 1. 프로젝트 전체 개요

이 프로젝트는 수어 학습과 수어 표현 보조 기능을 제공하는 애플리케이션이다. 사용자는 앱에서 수어 영상을 보고 퀴즈를 풀 수 있고, 텍스트 문장을 입력해 해당 문장에 대응되는 수어 단어 영상들을 순서대로 재생할 수 있다. 또한 로그인, 회원가입, 학습 기록, 오답노트, 북마크, 프로필 관리 같은 개인화 기능도 포함한다.

전체 구조는 크게 두 부분으로 나뉜다.

```text
Sign-Language/
  backend/        Spring Boot 기반 API 서버
  frontendcodes/  Expo Router + React Native 기반 앱
  docs/           기존 문서와 추가 문서
```

백엔드는 Java 17과 Spring Boot로 작성되어 있다. 주요 역할은 API 요청 처리, Firebase Firestore 데이터 저장/조회, Firebase Storage 수어 영상 URL 조회, Google 로그인 검증, JWT 발급, 문장 정규화 및 수어 단어 매칭이다.

프론트엔드는 Expo, React Native, Expo Router를 사용한다. 주요 역할은 화면 라우팅, 로그인 상태 관리, 퀴즈 화면, 학습 홈, 번역기 화면, 마이페이지, 오답노트, 북마크 화면을 제공하는 것이다.

## 2. 전체 동작 흐름

가장 중요한 흐름은 세 가지이다.

첫 번째는 로그인 흐름이다.

```text
사용자 Google 로그인
  -> frontendcodes/app/login.tsx
  -> backend /api/auth/login 또는 /api/auth/signup
  -> Google ID Token 검증
  -> Firestore 사용자 조회 또는 생성
  -> JWT accessToken/refreshToken 발급
  -> frontendcodes/context/auth-context.tsx에 저장
  -> 앱 화면 접근 허용
```

두 번째는 퀴즈 학습 흐름이다.

```text
사용자가 학습/퀴즈 화면 진입
  -> frontendcodes/app/quiz.tsx
  -> backend /api/quiz/session
  -> Firestore quiz_items 조회
  -> 정답 단어 기준으로 Firebase Storage 영상 URL 조회
  -> 프론트에서 영상 재생
  -> 사용자가 답 선택
  -> backend /api/quiz/answer
  -> 정답 여부 반환
  -> frontend에서 /api/users/{uid}/tryQuestion 호출
  -> 사용자 통계, 일일 학습 수, 오답 목록 갱신
```

세 번째는 텍스트 기반 수어 번역 흐름이다.

```text
사용자가 문장 입력
  -> frontendcodes/app/translator.tsx
  -> backend /translate
  -> SignSentenceSimplifier 규칙 기반 단순화
  -> ETRI/외부 사전/OpenAI 형태소 보정 후보 생성
  -> 가장 사전 매칭률이 높은 토큰 흐름 선택
  -> sign_dictionary.json에서 단어 매칭
  -> Firebase Storage에서 단어별 영상 URL 검색
  -> 프론트에서 영상들을 순서대로 재생
```

## 3. 백엔드 기술 스택과 기본 구조

백엔드는 `backend/build.gradle` 기준으로 다음 기술을 사용한다.

| 기술 | 코드에서의 역할 |
| --- | --- |
| Spring Boot Web | REST API 서버 구현 |
| Spring Security | OAuth2 로그인, API 접근 정책, CSRF 설정 |
| OAuth2 Client | Google OAuth 로그인 보조 |
| Firebase Admin SDK | Firestore 접근 |
| Google Cloud Storage SDK | Firebase Storage 영상 파일 조회 |
| JJWT | JWT accessToken/refreshToken 생성 |
| Jackson ObjectMapper | JSON 파일과 API 응답 파싱 |
| RestTemplate | ETRI, 우리말샘, 한국어기초사전, OpenAI API 호출 |

백엔드 패키지는 기능별로 나뉜다.

```text
com.wow.signlanguage
  api/          간단 API 컨트롤러, 번역 컨트롤러
  auth/         Google 로그인, JWT, 인증 DTO
  config/       Firebase, Security, Web 설정
  dictionary/   수어 사전 JSON 로더
  normalizer/   입력 텍스트 정규화
  quiz/         퀴즈 API와 퀴즈 서비스
  service/      번역, 문장 단순화, 외부 API, OpenAI 보정
  startup/      로컬 영상 placeholder 초기화
  storage/      Firebase Storage 영상 URL 캐시
  translate/    번역 응답 DTO
  user/         사용자 정보, 통계, 북마크, 오답노트
```

Spring Boot에서는 `@RestController`, `@Service`, `@Component`, `@Configuration` 같은 어노테이션이 중요하다. 이 어노테이션이 붙은 클래스는 Spring 컨테이너가 객체로 만들어 관리한다. 그래서 컨트롤러가 서비스를 직접 `new`로 만들지 않고 생성자로 받아 사용할 수 있다. 이 방식을 의존성 주입이라고 한다.

## 4. 백엔드 실행 진입점

### `backend/src/main/java/com/wow/signlanguage/SignLanguageApplication.java`

이 파일은 Spring Boot 서버의 시작점이다.

```java
SpringApplication.run(SignLanguageApplication.class, args);
```

위 코드가 실행되면 Spring이 프로젝트 안의 컴포넌트들을 스캔하고, 컨트롤러와 서비스 객체를 생성한 뒤 내장 서버를 띄운다. 프론트엔드가 `http://localhost:8080` 같은 주소로 요청을 보내면 이 서버가 요청을 받는다.

## 5. 설정 코드

### `config/FirebaseConfig.java`

Firebase와 Google Cloud Storage 연결을 담당한다.

이 파일에서 만드는 Bean은 두 가지가 핵심이다.

| Bean | 역할 |
| --- | --- |
| `Firestore` | 사용자, 퀴즈, 북마크, 오답노트 데이터를 Firestore에서 읽고 쓰기 |
| `Storage` | Firebase Storage 또는 Google Cloud Storage에 있는 수어 영상 파일 찾기 |

인증 정보는 환경변수 또는 파일 경로에서 읽는다. Firestore는 `firebase.service-account-key-json` 또는 `firebase.service-account-path`를 사용하고, Storage는 `firebase.storage-key-json` 또는 `firebase.storage-service-account-path`를 우선순위에 따라 사용한다.

이 구조의 장점은 로컬 개발과 배포 환경을 같은 코드로 처리할 수 있다는 점이다. 로컬에서는 JSON 키 파일 경로를 넣고, Cloud Run 같은 배포 환경에서는 Secret Manager 값을 환경변수로 주입할 수 있다.

### `config/SecurityConfig.java`

보안 정책을 설정한다. 현재 프로젝트에서는 대부분의 API가 `permitAll()`로 열려 있다.

허용되는 주요 경로는 다음과 같다.

```text
/translate
/api/health
/api/auth/**
/api/quiz/**
/api/users/**
/choicemp4/**
/clips/**
```

또한 `/api/**`, `/translate`에 대해서는 CSRF 검사를 무시한다. 프론트엔드 앱에서 JSON API를 호출하기 쉽게 만들기 위한 설정이다.

주의할 점은 현재 `/api/users/**`가 모두 공개되어 있다는 것이다. 실제 운영 서비스라면 JWT 검증 필터를 붙여서 "본인 uid의 데이터만 접근 가능"하도록 보강하는 것이 바람직하다.

### `config/WebConfig.java`

웹 관련 설정을 담당한다. CORS나 정적 리소스 경로 같은 웹 설정이 이 계층에 들어간다. 프론트엔드와 백엔드가 다른 포트에서 실행될 때 CORS 설정이 중요하다.

## 6. 수어 사전 로딩 구조

### `dictionary/SignDictionaryEntry.java`

수어 사전의 한 항목을 표현하는 record이다.

```java
public record SignDictionaryEntry(int id, String word, String file) {}
```

각 항목은 세 가지 정보를 가진다.

| 필드 | 의미 |
| --- | --- |
| `id` | 사전 항목 번호 |
| `word` | 수어 단어 |
| `file` | 로컬 영상 파일명 또는 기존 파일 참조 |

Java record는 DTO를 짧게 만들 때 유용하다. 생성자, getter 성격의 메서드, equals/hashCode/toString이 자동 생성된다.

### `dictionary/DictionaryLoader.java`

`sign_dictionary.json`을 서버 시작 시 읽어서 메모리에 올린다.

핵심 원리는 다음과 같다.

```text
서버 시작
  -> @PostConstruct load()
  -> classpath의 sign_dictionary.json 읽기
  -> List<SignDictionaryEntry> 생성
  -> word를 key로 하는 Map 생성
  -> findByWord(word)로 빠르게 검색
```

`Map<String, SignDictionaryEntry>`를 사용하는 이유는 검색 속도 때문이다. 리스트에서 매번 단어를 찾으면 항목 수가 많아질수록 느려진다. 반면 Map은 단어를 key로 바로 찾을 수 있어 번역 요청마다 빠르게 사전 매칭을 할 수 있다.

## 7. 텍스트 정규화

### `normalizer/TextNormalizer.java`

사용자가 입력하는 문장은 항상 사전 단어 형태와 정확히 일치하지 않는다. 예를 들어 동사나 형용사는 활용형으로 들어올 수 있고, 조사나 문장부호가 붙을 수 있다. 이 파일은 그런 입력을 가능한 한 사전 단어에 가까운 형태로 바꾼다.

주요 기능은 다음과 같다.

| 메서드 | 역할 |
| --- | --- |
| `normalizeTokens(String input)` | 문장 전체를 공백 기준 토큰으로 나누고 각 토큰을 정규화 |
| `normalizeToken(String rawToken)` | 단어 하나를 정규화 |
| `normalizeCommonKoreanEnding(String token)` | 흔한 한국어 어미를 기본형에 가깝게 변환 |
| `normalizePredicateEnding(String token)` | 동사/형용사성 표현을 사전형에 가깝게 변환 |
| `buildReplacements()` | 직접 치환해야 하는 예외 표현 사전 |

이 클래스의 핵심 개념은 "사용자의 자연스러운 입력"과 "사전 검색용 표준 단어" 사이의 간격을 줄이는 것이다. 수어 영상은 보통 정해진 단어명으로 저장되어 있으므로, 입력 단어를 영상 파일명이나 사전 단어와 맞추는 전처리가 필요하다.

## 8. 문장 단순화와 수어식 어순 처리

### `service/SignSentenceSimplifier.java`

이 파일은 문장을 수어 검색에 적합한 토큰 목록으로 바꾸는 규칙 기반 엔진이다. 단순히 공백으로 자르는 것이 아니라, 문장 안의 단어가 시간, 장소, 주어, 목적어, 서술어, 의문어 중 어떤 역할인지 추정하고 일정한 순서로 재배치한다.

큰 흐름은 다음과 같다.

```text
입력 문장
  -> 문장부호 제거 및 토큰화
  -> 각 토큰 분석
  -> 조사 제거
  -> 과거/미래/부정/의문 여부 감지
  -> 시간/장소/주어/목적어/서술어/의문어로 분류
  -> 수어 표현에 가까운 순서로 재정렬
  -> SimplificationResult 반환
```

주요 내부 자료구조는 다음과 같다.

| 자료구조 | 의미 |
| --- | --- |
| `TIME_WORDS` | 시간 표현으로 판단할 단어 집합 |
| `QUESTION_WORDS` | 의문 표현으로 판단할 단어 집합 |
| `PLACE_WORDS` | 장소 표현으로 판단할 단어 집합 |
| `PREDICATE_WORDS` | 동작/상태 표현으로 판단할 단어 집합 |
| `PARTICLES` | 제거 대상 조사 목록 |
| `Role` enum | TIME, PLACE, SUBJECT, OBJECT, PREDICATE 역할 분류 |
| `TokenAnalysis` record | 토큰 하나를 분석한 결과 |

`simplify()`가 반환하는 `SimplificationResult`에는 다음 정보가 들어간다.

| 필드 | 의미 |
| --- | --- |
| `simplifiedSentence` | 단순화된 문장 문자열 |
| `tokens` | 단순화된 단어 목록 |
| `appliedRules` | 어떤 규칙이 적용되었는지 |
| `metadata` | 의문문 여부, 부정 여부, 시제 |

이 파일에 담긴 핵심 개념은 자연어 처리의 아주 기본적인 파이프라인이다. 완전한 형태소 분석기는 아니지만, 토큰화, 조사 제거, 품사/역할 추정, 어순 재배치, 메타데이터 추출이라는 자연어 처리의 흐름을 직접 구현한다.

## 9. 외부 사전 및 형태소 API 연동

### `service/ExternalLexiconApiClient.java`

이 클래스는 입력 단어가 내부 사전에 바로 없을 때 외부 API에서 후보 단어를 가져오는 역할을 한다.

연동 대상은 다음과 같다.

| 외부 API | 코드상 역할 |
| --- | --- |
| ETRI WiseNLU | 문장 형태소 분석, lemma 추출 |
| 우리말샘 | 단어 후보 검색 |
| 한국어기초사전 | 단어 후보 검색 |

중요 메서드는 다음과 같다.

| 메서드 | 역할 |
| --- | --- |
| `fetchCandidates(String token)` | 단어 하나에 대한 후보들을 ETRI, 우리말샘, 한국어기초사전에서 모음 |
| `fetchSentenceLemmas(String sentence)` | 문장 전체를 ETRI 형태소 분석으로 lemma 목록화 |
| `fetchEtriLemmas(...)` | ETRI API 호출 후 형태소 lemma 추출 |
| `isContentPos(String pos)` | 명사, 동사, 형용사, 부사, 숫자 등 의미 있는 품사만 통과 |
| `expandLemmaByPos(...)` | 동사/형용사 어간을 사전형 후보로 확장 |
| `extractWords(...)` | JSON 또는 XML 응답에서 word 필드 추출 |

외부 API 호출은 실패할 수 있으므로 대부분 `catch` 후 빈 리스트를 반환한다. 이것은 번역 기능이 외부 API 하나의 장애 때문에 완전히 멈추지 않도록 하는 방어적 설계이다.

### `service/OpenAiMorphologyNormalizerService.java`

OpenAI API를 사용해 입력 문장을 수어 사전 검색에 적합한 형태로 보정한다.

동작 원리는 다음과 같다.

```text
입력 문장
  -> OpenAI Chat Completions API 요청
  -> JSON 응답 강제
  -> simplifiedSentence, tokens, tense 추출
  -> MorphologyNormalizationResult 반환
```

요청에는 `temperature: 0`이 설정되어 있다. 이는 같은 입력에 대해 가능한 한 일관된 결과를 얻기 위한 설정이다. 또한 `response_format`을 `json_object`로 지정해 모델이 JSON 형태로 응답하도록 유도한다.

이 서비스는 선택적이다. `openai.api-key`가 비어 있거나 `openai.morphology.enabled`가 꺼져 있으면 `Optional.empty()`를 반환하고, 번역 파이프라인은 규칙 기반/ETRI 기반 결과만 사용한다.

### `service/UnknownTokenResolverService.java`

내부 사전에 없는 단어를 외부 후보와 비교해 내부 사전에 있는 단어로 바꾸는 역할을 한다.

예를 들어 번역 과정에서 어떤 토큰이 내부 사전에 없다면 다음 순서로 처리한다.

```text
unknown token
  -> ExternalLexiconApiClient.fetchCandidates()
  -> 후보별 변형 생성
  -> TextNormalizer로 정규화
  -> 내부 사전 단어와 일치하면 해당 단어 사용
  -> 끝까지 없으면 원래 unknown 유지
```

이 클래스는 번역 품질을 높이기 위한 "후처리 보정기"라고 볼 수 있다. 규칙 기반 분석이 조금 틀리거나 외부 API가 다른 형태의 단어를 반환해도 내부 사전과 최대한 맞춰 준다.

## 10. 번역 서비스 핵심 로직

### `service/TranslationService.java`

이 프로젝트에서 가장 중요한 백엔드 파일 중 하나이다. `/translate` 요청이 들어오면 실제 번역 결과를 만드는 중심 서비스이다.

전체 흐름은 다음과 같다.

```text
1. null 입력을 빈 문자열로 안전 처리
2. SignSentenceSimplifier로 규칙 기반 단순화
3. TextNormalizer로 규칙 토큰 정규화
4. ETRI로 문장 lemma 후보 생성
5. OpenAI로 형태소/문장 보정 후보 생성
6. rule, etri, openai 후보 중 내부 사전 hit 수가 가장 높은 흐름 선택
7. 사전에 없는 토큰은 UnknownTokenResolverService로 보정
8. 각 토큰을 sign_dictionary.json에서 검색
9. Firebase Storage에서 영상 URL 검색
10. clips, items, unknown, noVideoWords를 포함한 TranslateResponse 반환
```

### 토큰 흐름 선택 원리

`chooseTokenStream()`은 세 가지 후보 목록 중 어떤 것을 최종 번역 토큰으로 사용할지 고른다.

```text
ruleTokens   : 직접 구현한 규칙 기반 결과
etriTokens   : ETRI 형태소 분석 결과
openAiTokens : OpenAI 형태소 보정 결과
```

선택 기준은 내부 사전에 몇 개나 매칭되는지이다. 즉 "실제로 영상으로 보여줄 수 있는 단어가 많은 결과"를 우선한다. 동률이면 우선순위는 `openai > etri > rule`이다.

이 방식의 장점은 한 가지 분석 방식에만 의존하지 않는다는 점이다. 규칙 기반은 빠르고 안정적이지만 한계가 있고, 외부 API와 OpenAI는 더 유연하지만 실패하거나 비용이 들 수 있다. 그래서 여러 후보를 만들고, 프로젝트 내부 사전과 가장 잘 맞는 결과를 고른다.

### unknown과 noVideoWords의 차이

번역 결과에는 `unknown`과 `noVideoWords`가 따로 있다.

| 필드 | 의미 |
| --- | --- |
| `unknown` | 내부 사전에도 없고 영상도 찾을 수 없는 단어 |
| `noVideoWords` | 내부 사전에는 있지만 Firebase Storage에서 영상 URL을 찾지 못한 단어 |

이 둘을 분리하는 이유는 문제 원인이 다르기 때문이다. `unknown`은 사전 확장이 필요하고, `noVideoWords`는 영상 파일 업로드나 Storage 경로 확인이 필요하다.

### clips와 items의 차이

`clips`는 실제 재생 가능한 영상만 담는 목록이다. 반면 `items`는 영상이 없는 단어까지 포함해 전체 토큰 순서를 보존한다. 프론트엔드는 `items`를 사용하면 사용자가 입력한 문장의 어떤 단어가 영상으로 표현되었고 어떤 단어는 빠졌는지 더 정확히 보여줄 수 있다.

## 11. 번역 API DTO

### `translate/TranslateRequest.java`

프론트엔드가 보내는 요청 구조이다.

```json
{
  "text": "입력 문장"
}
```

### `translate/TranslateResponse.java`

번역 API의 전체 응답이다.

| 필드 | 의미 |
| --- | --- |
| `input` | 원본 입력 |
| `simplifiedSentence` | 단순화된 문장 |
| `normalizedTokens` | 최종 토큰 목록 |
| `appliedRules` | 적용된 규칙 |
| `metadata` | 의문/부정/시제 정보 |
| `clips` | 재생 가능한 영상 목록 |
| `items` | 영상 유무를 포함한 전체 재생 항목 |
| `unknown` | 사전에서 찾지 못한 단어 |
| `noVideoWords` | 사전에는 있지만 영상이 없는 단어 |

### `translate/ClipMatch.java`

하나의 단어가 하나의 영상과 매칭된 결과이다.

### `translate/TranslatePlaybackItem.java`

`ClipMatch`와 비슷하지만 `hasVideo`를 포함한다. 프론트엔드가 영상 없는 단어까지 순서대로 처리할 수 있게 한다.

### `translate/SimplificationMetadata.java`

문장의 성격을 담는다. 예를 들어 의문문인지, 부정문인지, 시제가 무엇인지 같은 정보를 포함한다.

## 12. 번역 컨트롤러

### `api/TranslateController.java`

프론트엔드의 `/translate` 요청을 받는다.

```text
POST /translate
  body: { "text": "..." }
  -> TranslationService.translate(text)
  -> TranslateResponse 반환
```

컨트롤러는 얇게 유지되어 있다. 요청을 받고 서비스를 호출한 뒤 결과를 반환한다. 실제 로직은 `TranslationService`에 있다. 이것은 좋은 구조이다. 컨트롤러가 비대해지면 API와 비즈니스 로직이 뒤섞여 유지보수가 어려워진다.

## 13. Firebase Storage 영상 URL 캐시

### `storage/StorageVideoCache.java`

수어 단어에 대응하는 영상 URL을 Firebase Storage에서 찾고 캐시한다.

동작 흐름은 다음과 같다.

```text
findUrl(word)
  -> cache에 있으면 바로 반환
  -> missingWords에 있으면 null 반환
  -> Storage prefix 검색
  -> 파일명에서 단어 추출
  -> 단어가 일치하면 다운로드 URL 생성
  -> cache에 저장
```

이 클래스가 필요한 이유는 Storage 조회가 상대적으로 느리고 비용이 들 수 있기 때문이다. 같은 단어를 여러 번 검색할 때 매번 Storage API를 호출하면 비효율적이다. 그래서 성공한 URL은 `ConcurrentHashMap`에 저장하고, 실패한 단어는 `missingWords` Set에 저장한다.

`ConcurrentHashMap`을 사용하는 이유는 서버가 여러 요청을 동시에 처리할 수 있기 때문이다. 일반 HashMap은 동시 접근 시 문제가 생길 수 있지만, ConcurrentHashMap은 멀티스레드 환경에서 더 안전하다.

영상 URL 생성은 두 방식을 사용한다.

| 방식 | 설명 |
| --- | --- |
| 다운로드 토큰 URL | Firebase Storage metadata에 token이 있으면 직접 media URL 생성 |
| signed URL | token이 없으면 365일짜리 signed URL 생성 시도 |

또한 Storage 폴더 prefix를 여러 개 시도한다. 코드에는 `necessory_json_files/Model_videos/`와 `necessary_json_files/Model_videos/`가 모두 들어 있다. 오타가 있는 기존 경로와 올바른 경로를 둘 다 지원하려는 호환성 처리이다.

## 14. 퀴즈 API 구조

### `quiz/QuizController.java`

퀴즈 관련 API의 진입점이다.

| API | 역할 |
| --- | --- |
| `GET /api/quiz/session?count=10&category=basic` | 일반 퀴즈 세션 생성 |
| `GET /api/quiz/session/wrong?uid=...&count=10` | 사용자 오답 기반 퀴즈 세션 생성 |
| `POST /api/quiz/answer` | 선택한 답이 정답인지 확인 |

### `quiz/QuizService.java`

퀴즈 로직을 처리한다.

주요 기능은 다음과 같다.

| 메서드 | 역할 |
| --- | --- |
| `getSession(count, category)` | 활성화된 퀴즈를 가져오고 랜덤 셔플 후 count만큼 반환 |
| `getWrongSession(uid, count)` | 사용자 오답 기록을 기준으로 퀴즈 구성 |
| `checkAnswer(request)` | 선택지와 정답 선택지를 비교 |
| `getActiveQuestions(category)` | Firestore의 `quiz_items`에서 활성 문제 조회 |
| `toSessionQuestion(doc)` | Firestore 문서를 프론트 응답 DTO로 변환 |
| `updateQuizStats(quizId, isCorrect)` | 문제별 시도/정답/오답 통계 증가 |

퀴즈 데이터는 Firestore의 `quiz_items` 컬렉션에 있다고 가정한다. 각 문서는 대략 다음 필드를 가진다.

```text
questionText
choices
correctChoiceId
videoUrl
isActive
category
level
attempt_count
correct_count
wrong_count
difficulty_level
```

프론트에 문제를 내려줄 때 `correctChoiceId` 자체는 포함하지 않는다. 사용자가 답을 제출하면 서버가 정답 여부를 판정한다. 이것은 클라이언트가 정답을 미리 알 수 없게 하는 기본적인 보안 설계이다.

## 15. 사용자, 오답, 북마크 데이터 구조

### `user/model/UserInfo.java`

사용자 정보를 담는 모델이다.

주요 필드는 다음과 같다.

| 필드 | 의미 |
| --- | --- |
| `correctQuestionNum` | 맞힌 문제 수 |
| `totalQuestionNum` | 푼 문제 수 |
| `incorrectQuestions` | 틀린 문제 id 목록 |
| `incorrectQuestionCounts` | 문제 id별 오답 횟수 |
| `dailySolvedCounts` | 날짜별 풀이 수 |
| `userLevel` | 사용자 레벨 |
| `name`, `email`, `phoneNumber`, `organization` | 회원 정보 |
| `isRegistered` | 추가 회원가입 정보 입력 완료 여부 |
| `profileImageUrl` | 프로필 이미지 URL 또는 base64 |

### `user/controller/UserController.java`

사용자 관련 API를 제공한다.

| API | 역할 |
| --- | --- |
| `POST /api/users/{username}` | 사용자 생성 |
| `GET /api/users/{uid}` | 사용자 정보 조회 |
| `PATCH /api/users/{uid}` | 사용자 일부 정보 수정 |
| `PATCH /api/users/{uid}/tryQuestion` | 퀴즈 풀이 기록 반영 |
| `POST /api/users/{uid}/bookmarks` | 퀴즈 북마크 저장 |
| `GET /api/users/{uid}/bookmarks` | 퀴즈 북마크 조회 |
| `DELETE /api/users/{uid}/bookmarks/{quizId}` | 퀴즈 북마크 삭제 |
| `GET /api/users/{uid}/wrong-notes` | 틀린 문제 기반 오답 목록 조회 |
| `POST /api/users/{uid}/wrong-note-saved` | 오답노트에 문제 저장 |
| `GET /api/users/{uid}/wrong-note-saved` | 저장된 오답노트 조회 |
| `DELETE /api/users/{uid}/wrong-note-saved/{quizId}` | 오답노트 항목 숨김 처리 |
| `POST /api/users/{uid}/translator-bookmarks` | 번역 문장 북마크 저장 |
| `GET /api/users/{uid}/translator-bookmarks` | 번역 문장 북마크 조회 |
| `DELETE /api/users/{uid}/translator-bookmarks/{bookmarkId}` | 번역 문장 북마크 삭제 |
| `GET /api/users/{uid}/daily-solved-7days` | 최근 7일 학습량 조회 |
| `GET /api/users/{uid}/top-wrong-words` | 많이 틀린 단어 상위 목록 조회 |
| `PATCH /api/users/{uid}/profile-image` | 프로필 이미지 변경 |

### `user/service/UserService.java`

Firestore 사용자 데이터를 실제로 읽고 쓰는 핵심 서비스이다.

중요한 동작은 다음과 같다.

#### 사용자 생성

`createUserIfNotExists()`는 사용자가 없으면 기본 통계값을 가진 사용자 문서를 만든다. 내부적으로 `getNextUserId()`가 counter 문서를 사용해 숫자 id를 증가시키는 구조를 가진다.

#### 퀴즈 풀이 기록

`tryQuestion(uid, questionId, isCorrect)`는 사용자가 문제를 풀었을 때 호출된다.

처리 내용은 다음과 같다.

```text
1. 사용자 문서 조회
2. totalQuestionNum 증가
3. totalQuestions에 questionId 추가
4. 오늘 KST 날짜의 dailySolvedCounts 증가
5. 정답이면 correctQuestionNum 증가
6. 오답이면 incorrectQuestions와 incorrectQuestionCounts 갱신
7. Firestore 업데이트
```

KST 날짜를 사용하는 이유는 한국 사용자의 하루 학습량을 계산하기 위해서이다. 서버의 기본 시간대가 UTC이거나 다른 지역이어도 한국 날짜 기준으로 일일 목표를 계산할 수 있다.

#### 북마크

퀴즈 북마크와 번역기 문장 북마크가 있다. 코드상 둘 다 사용자 문서 하위의 `translator_bookmarks` 컬렉션을 사용하고 있어, `source` 필드나 `questionText` 존재 여부로 번역기 북마크를 구분한다. 이 부분은 기존 데이터 호환성을 고려한 것으로 보인다.

#### 오답노트

오답노트는 두 종류로 볼 수 있다.

| 종류 | 의미 |
| --- | --- |
| 자동 오답 목록 | 사용자가 틀린 문제 id 목록인 `incorrectQuestions` |
| 저장된 오답노트 | 사용자가 직접 저장한 `wrong_note_saved` 하위 컬렉션 |

`deleteSavedWrongNote()`는 문서를 완전히 지우기보다 `hidden` 성격의 필드를 업데이트하는 방식이다. 이 방식은 사용자가 삭제한 것처럼 보이게 하면서도 데이터 이력을 남길 수 있다.

## 16. 인증 구조

### `auth/GoogleAuthService.java`

Google ID Token을 검증하고, Google 사용자 정보를 추출한다. `sub`, `email`, `name`, `picture` 같은 값을 가져와 앱 사용자 정보와 연결한다.

주요 메서드는 다음과 같다.

| 메서드 | 역할 |
| --- | --- |
| `verify(idTokenString)` | Google 토큰 검증 |
| `signupWithGoogleToken(idToken)` | Google 계정으로 사용자 생성 |
| `loginWithGoogleToken(idToken)` | Google 계정으로 기존 사용자 로그인 |

### `auth/JwtService.java`

로그인 성공 후 앱에서 사용할 JWT를 만든다.

| 메서드 | 역할 |
| --- | --- |
| `generateAccessToken(user)` | 짧은 만료 시간을 가진 access token 생성 |
| `generateRefreshToken(subject)` | refresh token 생성 |
| `getAccessExpSeconds()` | access token 만료 시간을 초 단위로 반환 |

JWT secret은 32자 이상이어야 한다. 짧은 secret은 보안적으로 약하므로 생성자에서 바로 예외를 던진다.

### `auth/AuthController.java`

인증 API를 담당한다.

| API | 역할 |
| --- | --- |
| `POST /api/auth/google` | Google ID Token 검증 후 JWT 반환 |
| `POST /api/auth/signup` | Google 토큰 기반 임시 회원가입 시작 |
| `POST /api/auth/login` | 기존 사용자 로그인 |
| `POST /api/auth/signup/complete` | 이름, 전화번호, 소속 등 추가 정보 입력 완료 |

프론트엔드 로그인 화면은 먼저 `/api/auth/login`을 시도하고, 사용자가 없으면 `/api/auth/signup`을 호출해 회원가입 화면으로 보낸다.

## 17. 서버 시작 시 placeholder 처리

### `startup/ClipPathResolver.java`

로컬 정적 영상 폴더 경로를 찾는다. `/clips` 같은 정적 리소스를 다루기 위한 경로 계산 클래스이다.

### `startup/PlaceholderInitializer.java`

서버 시작 시 사전 항목에 대응되는 placeholder 파일을 생성하거나 확인하는 역할을 한다. 실제 영상 파일이 아직 없더라도 정적 경로 구조를 맞춰 두기 위한 초기화 코드이다.

## 18. 프론트엔드 기술 스택과 구조

프론트엔드는 `frontendcodes/package.json` 기준으로 다음 기술을 사용한다.

| 기술 | 역할 |
| --- | --- |
| Expo | React Native 앱 실행 환경 |
| Expo Router | 파일 기반 라우팅 |
| React Native | 모바일/웹 공통 UI |
| Expo Secure Store | 모바일에서 토큰 안전 저장 |
| localStorage | 웹에서 토큰 저장 |
| Expo Auth Session | Google OAuth 연동 |
| Expo Video | 수어 영상 재생 |
| Phosphor/Ionicons | 아이콘 |

라우팅은 `frontendcodes/app` 디렉터리의 파일명으로 결정된다.

```text
app/login.tsx       로그인
app/signup.tsx      추가 회원가입
app/home.tsx        홈
app/learn.tsx       학습 코스
app/quiz.tsx        퀴즈
app/translator.tsx  수어 번역기
app/mypage.tsx      마이페이지
app/wrongnote.tsx   오답노트
app/bookmark.tsx    번역 문장 북마크
app/_layout.tsx     최상위 라우팅과 인증 게이트
```

## 19. 프론트엔드 인증 상태 관리

### `context/auth-context.tsx`

앱 전체의 로그인 상태를 관리한다. React Context를 사용해 어떤 화면에서도 `useAuth()`로 로그인 정보를 읽을 수 있게 한다.

관리하는 값은 다음과 같다.

| 값 | 의미 |
| --- | --- |
| `isLoading` | 저장소에서 토큰을 읽는 중인지 |
| `accessToken` | 백엔드에서 받은 JWT |
| `user` | 현재 사용자 정보 |
| `isGuest` | 게스트 모드 여부 |

저장소는 플랫폼에 따라 다르다.

| 플랫폼 | 저장 방식 |
| --- | --- |
| Web | `window.localStorage` |
| iOS/Android | `expo-secure-store` |

이 파일의 핵심은 앱이 새로 켜졌을 때도 로그인 상태를 복원하는 것이다. `useEffect`의 `bootstrap()`이 저장소에서 토큰, 사용자, 게스트 모드 값을 읽어 상태를 세팅한다.

### `app/_layout.tsx`

앱의 최상위 라우팅과 인증 게이트 역할을 한다.

`AuthGate`는 현재 경로와 로그인 상태를 보고 접근 가능 여부를 판단한다.

```text
토큰 없음 + 게스트 아님 + 로그인/회원가입 화면 아님
  -> /login으로 이동

토큰 있음 또는 게스트 모드
  -> 앱 사용 가능
```

이 구조 덕분에 각 화면마다 "로그인했는지 확인"하는 코드를 반복해서 쓰지 않아도 된다.

## 20. API 클라이언트 파일

프론트엔드는 백엔드 API 호출 코드를 `frontendcodes/lib/api`에 분리해 두었다.

### `lib/api/base-url.ts`

백엔드 기본 URL을 결정한다. 기본값은 `http://localhost:8080`이고, 환경변수 `EXPO_PUBLIC_API_BASE_URL`이 있으면 그 값을 사용한다. 또한 백엔드에서 상대 URL을 반환했을 때 절대 URL로 바꿔 주는 `resolveBackendUrl()`도 제공한다.

### `lib/api/auth.ts`

`/api/auth/google` 호출을 담당한다. Google ID Token을 백엔드로 보내고 accessToken, refreshToken, user 정보를 받는다.

### `lib/api/quiz.ts`

퀴즈 세션 조회와 답 제출을 담당한다.

| 함수 | 호출 API |
| --- | --- |
| `fetchQuizSession(count, category)` | `GET /api/quiz/session` |
| `fetchWrongQuizSession(uid, count)` | `GET /api/quiz/session/wrong` |
| `submitQuizAnswer(quizId, selectedChoiceId)` | `POST /api/quiz/answer` |

응답으로 받은 `videoUrl`은 `resolveBackendUrl()`로 보정한다.

### `lib/api/translate.ts`

번역기 화면에서 사용하는 API 클라이언트이다.

| 함수 | 역할 |
| --- | --- |
| `translateText(text)` | `/translate`에 문장을 보내고 결과를 받음 |
| `resolveOptionalVideoUrl(url)` | 빈 URL은 빈 문자열로, 상대 URL은 절대 URL로 변환 |

### `lib/api/users.ts`

사용자 정보 조회와 퀴즈 시도 기록을 담당한다.

| 함수 | 역할 |
| --- | --- |
| `fetchUserInfo(uid)` | 사용자 통계와 프로필 정보 조회 |
| `recordQuizAttempt(uid, questionId, isCorrect)` | 퀴즈 풀이 기록 저장 |

### `lib/api/wrong-note-saved.ts`

오답노트 저장, 조회, 삭제를 담당한다.

### `lib/api/translator-bookmarks.ts`

번역기 문장 북마크 저장, 조회, 삭제를 담당한다.

### `lib/api/top-wrong-words.ts`

마이페이지에서 "많이 틀린 단어" 목록을 가져온다.

## 21. 화면별 상세 설명

### `app/login.tsx`

로그인 화면이다. Google 로그인 버튼과 게스트 시작 기능을 제공한다.

로그인 흐름은 다음과 같다.

```text
Google 로그인 요청
  -> idToken 획득
  -> /api/auth/login 호출
  -> 성공하면 AuthContext에 저장 후 /home 이동
  -> 404 또는 needsSignup이면 /api/auth/signup 호출
  -> /signup 화면으로 이동
```

게스트 시작을 누르면 `continueAsGuest()`가 실행되고, 토큰 없이도 앱을 둘러볼 수 있다. 단, 사용자 id가 필요한 학습 기록, 북마크, 오답노트 기능은 제한될 수 있다.

### `app/signup.tsx`

Google 로그인 이후 추가 정보를 입력하는 화면이다. 이름, 전화번호, 소속을 입력하고 `/api/auth/signup/complete`로 전송한다.

이 화면의 목적은 Google 계정으로 얻을 수 없는 서비스용 프로필 정보를 Firestore 사용자 문서에 채우는 것이다.

### `app/home.tsx`

홈 화면이다. 사용자 이름, 오늘 학습 목표, 최근 7일 학습량, 빠른 실행 버튼을 보여준다.

핵심 데이터는 `fetchUserInfo(user.id)`로 가져온다. `dailySolvedCounts`를 읽어서 오늘 푼 문제 수와 목표 달성률을 계산한다.

사용하는 보조 함수는 `lib/daily-goal.ts`에 있다.

| 함수 | 의미 |
| --- | --- |
| `getKstDateKey()` | 한국 날짜 key 생성 |
| `getTodaySolvedCount()` | 오늘 풀이 수 계산 |
| `getGoalPercent()` | 목표 달성률 계산 |
| `getConsecutiveGoalDays()` | 연속 목표 달성 일수 계산 |

### `app/learn.tsx`

학습 코스 화면이다. 기초 단어, 오답 복습, 일상 회화 같은 학습 카드가 있고, 각 카드를 누르면 `quiz.tsx`로 이동한다.

예를 들어 기초 단어는 다음처럼 이동한다.

```ts
router.push({ pathname: '/quiz', params: { title: '기초 단어', category: 'basic' } })
```

오답 복습은 `mode: 'wrong'`을 붙여서 이동한다. 그러면 퀴즈 화면에서 일반 세션이 아니라 오답 기반 세션을 요청한다.

### `app/quiz.tsx`

퀴즈 화면이다. 이 파일은 프론트엔드에서 가장 중요한 화면 중 하나이다.

주요 상태는 다음과 같다.

| 상태 | 의미 |
| --- | --- |
| `questions` | 현재 세션 문제 목록 |
| `currentIndex` | 현재 문제 번호 |
| `selectedId` | 사용자가 선택한 보기 |
| `answerResult` | 서버가 반환한 정답 판정 |
| `currentStreak`, `maxStreak` | 연속 정답 기록 |
| `correctCount`, `answeredCount` | 세션 통계 |
| `showSummary` | 결과 요약 화면 표시 여부 |
| `isSaved`, `isSaving` | 오답노트 저장 상태 |

문제 로딩은 모드에 따라 다르다.

```text
일반 모드
  -> fetchQuizSession(QUIZ_COUNT, category)

오답 복습 모드
  -> fetchWrongQuizSession(user.id, QUIZ_COUNT)
```

정답 제출 흐름은 다음과 같다.

```text
사용자 보기 선택
  -> submitQuizAnswer(quizId, selectedChoiceId)
  -> 서버가 isCorrect 반환
  -> recordQuizAttempt(user.id, quizId, isCorrect)
  -> 화면 통계와 애니메이션 갱신
```

영상 재생은 `expo-video`의 `useVideoPlayer()`와 `VideoView`를 사용한다. 현재 문제의 `videoUrl`이 바뀌면 새 영상을 재생한다.

오답노트 저장 버튼을 누르면 `saveWrongNote(user.id, currentQuestion.quizId)`가 호출된다. 이 API는 사용자 하위의 `wrong_note_saved` 컬렉션에 해당 문제를 저장한다.

### `app/translator.tsx`

수어 번역기 화면이다. 사용자가 문장을 입력하면 백엔드 `/translate`를 호출하고, 응답으로 받은 영상들을 순서대로 재생한다.

이 파일의 핵심은 "여러 영상 클립을 자연스럽게 이어 재생하는 것"이다. 웹과 네이티브 환경을 모두 고려해 슬롯 두 개를 사용한다.

개념적으로는 다음과 같다.

```text
현재 클립 A 재생
  -> 다음 클립 B 미리 로딩
  -> A가 끝나기 직전 또는 끝나면 B로 전환
  -> 다시 다음 클립을 반대 슬롯에 미리 로딩
```

이 구조를 더블 버퍼링이라고 볼 수 있다. 하나의 영상만 쓰면 다음 영상으로 넘어갈 때 검은 화면이나 로딩 지연이 생길 수 있다. 두 개의 슬롯을 번갈아 쓰면 다음 영상을 미리 준비해 더 부드러운 전환을 만들 수 있다.

중요 상태는 다음과 같다.

| 상태 | 의미 |
| --- | --- |
| `inputText` | 사용자가 입력한 문장 |
| `result` | 백엔드 번역 응답 |
| `playbackUrlMap` | URL 중복 제거와 재생 URL 관리 |
| `currentClipIndex` | 현재 재생 중인 클립 번호 |
| `webActiveSlot`, `nativeActiveSlot` | 현재 보이는 영상 슬롯 |
| `webVideoReady`, `nativeVideoReady` | 각 슬롯 준비 여부 |
| `bookmarks` | 저장된 번역 문장 북마크 |

번역 버튼을 누르면 `handleTranslate()`가 실행된다.

```text
입력값 trim
  -> translateText(text)
  -> result 저장
  -> playbackItems 계산
  -> currentClipIndex 0으로 초기화
  -> 첫 영상 재생 준비
```

문장 저장 버튼을 누르면 `handleSaveSentence()`가 실행된다. 로그인 사용자라면 서버의 `translator-bookmarks` API에 저장하고, 게스트나 실패 상황에서는 로컬 저장소에 fallback 저장한다.

### `app/wrongnote.tsx`

저장된 오답노트를 보여주는 화면이다.

`fetchSavedWrongNotes(user.id)`로 저장된 오답노트를 불러오고, 사용자가 항목을 선택하면 해당 문제의 수어 영상을 재생한다. 삭제 버튼은 `deleteSavedWrongNote(user.id, quizId)`를 호출한다.

이 화면은 "틀렸던 문제를 다시 보고 복습하는 공간"이다. `quiz.tsx`의 오답 저장 기능과 연결된다.

### `app/bookmark.tsx`

번역기에서 저장한 문장 북마크를 보여준다.

기능은 다음과 같다.

| 기능 | 설명 |
| --- | --- |
| 목록 조회 | `fetchTranslatorBookmarks(user.id)` |
| 검색 | 문장 또는 단어 기준 필터링 |
| 삭제 | `deleteTranslatorBookmark(user.id, bookmarkId)` |
| 피드백 애니메이션 | 삭제 성공 메시지 표시 |

### `app/mypage.tsx`

사용자 프로필과 학습 통계를 보여준다.

불러오는 데이터는 다음과 같다.

| 데이터 | API |
| --- | --- |
| 사용자 정보 | `fetchUserInfo(user.id)` |
| 많이 틀린 단어 | `fetchTopWrongWords(user.id)` |

프로필 이미지 변경은 이미지 선택 후 `/api/users/{uid}/profile-image`로 URL 또는 base64 데이터를 보낸다.

마이페이지는 오답노트와 북마크 화면으로 이동하는 메뉴도 제공한다.

## 22. 데이터 저장 구조

Firestore 구조는 코드 기준으로 다음처럼 이해할 수 있다.

```text
quiz_items/{quizId}
  questionText
  choices
  correctChoiceId
  videoUrl
  category
  isActive
  attempt_count
  correct_count
  wrong_count

users/{uid}
  userId
  email
  name
  phoneNumber
  organization
  isRegistered
  profileImageUrl
  correctQuestionNum
  totalQuestionNum
  totalQuestions
  incorrectQuestions
  incorrectQuestionCounts
  dailySolvedCounts

users/{uid}/translator_bookmarks/{bookmarkId}
  quizId
  questionText
  word
  videoUrl
  source
  savedAt

users/{uid}/wrong_note_saved/{quizId}
  quizId
  questionText
  word
  videoUrl
  wrongAt
  savedAt
  hidden
```

Firebase Storage에는 단어명 기반 영상 파일이 들어 있다고 가정한다. `StorageVideoCache`는 파일명에서 확장자를 제거하고, 언더스코어 앞부분을 단어로 해석한다.

예를 들어 다음 파일명이 있다면:

```text
학교_001.mp4
```

`extractWord()`는 `학교`를 단어로 보고, 입력 단어가 `학교`일 때 이 영상을 매칭할 수 있다.

## 23. 중요한 개발 개념

### REST API

프론트엔드와 백엔드는 HTTP API로 통신한다. `GET`은 조회, `POST`는 생성/제출, `PATCH`는 일부 수정, `DELETE`는 삭제에 사용된다.

### DTO

DTO는 Data Transfer Object의 약자이다. API 요청과 응답에 사용할 데이터 구조를 뜻한다. 이 프로젝트에서는 Java record를 많이 사용한다. 예를 들어 `QuizAnswerRequest`, `QuizAnswerResponse`, `TranslateResponse`가 DTO이다.

### 서비스 계층

컨트롤러는 요청과 응답을 담당하고, 실제 로직은 서비스가 처리한다. 예를 들어 `TranslateController`는 `TranslationService`를 호출할 뿐이고, 번역의 복잡한 원리는 모두 `TranslationService`와 주변 서비스에 있다.

### 정규화

정규화는 서로 다른 입력 표현을 같은 기준 표현으로 바꾸는 것이다. 사용자가 "갔어요", "갑니다", "가"처럼 입력해도 사전에는 하나의 대표 단어만 있을 수 있다. 그래서 `TextNormalizer`가 입력을 사전 검색에 유리한 형태로 바꾼다.

### 캐싱

`StorageVideoCache`는 한번 찾은 영상 URL을 메모리에 저장한다. 캐싱은 느린 작업을 반복하지 않기 위해 결과를 저장해 두는 기법이다.

### fallback

이 프로젝트에는 fallback 설계가 여러 곳에 있다.

| 위치 | fallback 예시 |
| --- | --- |
| 번역 | OpenAI가 실패하면 규칙/ETRI 결과 사용 |
| 외부 사전 | API 실패 시 빈 후보 반환 |
| 영상 URL | Storage URL 없으면 Firestore의 기존 videoUrl 사용 |
| 북마크 | 서버 저장 실패 시 로컬 저장소 사용 |
| 인증 저장소 | 저장소 오류가 나도 메모리 상태는 갱신 |

fallback은 일부 기능이 실패해도 전체 사용자 흐름이 멈추지 않게 하는 중요한 설계이다.

### optimistic UI와 즉시 피드백

프론트엔드의 여러 화면은 버튼을 누르면 애니메이션이나 로딩 상태를 바로 보여준다. 사용자는 네트워크 응답을 기다리는 동안 앱이 멈춘 것처럼 느끼지 않는다.

### 파일 기반 라우팅

Expo Router는 `app` 폴더의 파일 이름을 라우트로 사용한다. `app/quiz.tsx`는 `/quiz`, `app/login.tsx`는 `/login`이 된다. 이 방식은 라우팅 설정을 코드로 길게 쓰지 않아도 되어 구조를 이해하기 쉽다.

### 플랫폼 분기

프론트엔드는 웹과 모바일을 동시에 고려한다. 예를 들어 저장소는 웹에서 `localStorage`, 모바일에서 `SecureStore`를 사용한다. 영상 재생도 웹의 `<video>`와 네이티브의 `expo-video`를 각각 고려한다.

## 24. 기능별 코드 지도

### 로그인 기능을 수정하고 싶을 때

확인할 파일:

```text
frontendcodes/app/login.tsx
frontendcodes/app/signup.tsx
frontendcodes/context/auth-context.tsx
frontendcodes/lib/auth/google.ts
frontendcodes/lib/api/auth.ts
backend/src/main/java/com/wow/signlanguage/auth/AuthController.java
backend/src/main/java/com/wow/signlanguage/auth/GoogleAuthService.java
backend/src/main/java/com/wow/signlanguage/auth/JwtService.java
backend/src/main/java/com/wow/signlanguage/user/service/UserService.java
```

### 번역 결과가 이상할 때

확인할 파일:

```text
frontendcodes/app/translator.tsx
frontendcodes/lib/api/translate.ts
backend/src/main/java/com/wow/signlanguage/api/TranslateController.java
backend/src/main/java/com/wow/signlanguage/service/TranslationService.java
backend/src/main/java/com/wow/signlanguage/service/SignSentenceSimplifier.java
backend/src/main/java/com/wow/signlanguage/normalizer/TextNormalizer.java
backend/src/main/java/com/wow/signlanguage/dictionary/DictionaryLoader.java
backend/src/main/resources/sign_dictionary.json
```

### 영상이 안 나올 때

확인할 파일:

```text
backend/src/main/java/com/wow/signlanguage/storage/StorageVideoCache.java
backend/src/main/java/com/wow/signlanguage/config/FirebaseConfig.java
backend/src/main/resources/application.yml
frontendcodes/lib/api/base-url.ts
frontendcodes/app/translator.tsx
frontendcodes/app/quiz.tsx
```

확인할 내용:

```text
1. Firebase Storage bucket 이름이 맞는가
2. storage service account 인증이 되는가
3. 파일명이 단어명과 맞는가
4. prefix 경로가 맞는가
5. Storage 파일에 다운로드 토큰이 있는가
6. 프론트엔드가 받은 URL이 절대 URL로 변환되는가
```

### 퀴즈 문제가 안 나올 때

확인할 파일:

```text
backend/src/main/java/com/wow/signlanguage/quiz/QuizService.java
backend/src/main/java/com/wow/signlanguage/quiz/QuizController.java
frontendcodes/lib/api/quiz.ts
frontendcodes/app/quiz.tsx
```

Firestore에서 확인할 내용:

```text
1. quiz_items 컬렉션에 문서가 있는가
2. isActive가 true인가
3. choices가 정확히 4개인가
4. correctChoiceId가 A/B/C/D 중 하나인가
5. correctChoiceId에 해당하는 단어로 영상 URL을 찾을 수 있는가
6. category 필터가 너무 좁게 걸려 있지 않은가
```

### 오답노트가 안 저장될 때

확인할 파일:

```text
frontendcodes/app/quiz.tsx
frontendcodes/lib/api/wrong-note-saved.ts
backend/src/main/java/com/wow/signlanguage/user/controller/UserController.java
backend/src/main/java/com/wow/signlanguage/user/service/UserService.java
```

확인할 내용:

```text
1. user.id가 존재하는가
2. quizId가 비어 있지 않은가
3. users/{uid} 문서가 존재하는가
4. quiz_items/{quizId} 문서가 존재하는가
5. wrong_note_saved 하위 컬렉션에 문서가 생성되는가
```

## 25. 개선하면 좋은 부분

### 사용자 API 인증 강화

현재 `SecurityConfig`에서 `/api/users/**`가 공개되어 있다. 실제 운영 환경에서는 JWT 인증 필터를 추가하고, 요청한 uid와 토큰 subject가 같은지 확인하는 것이 좋다.

### DTO 일관성 개선

일부 API는 record DTO를 사용하고, 일부 API는 `Map<String, Object>`를 직접 반환한다. 장기적으로는 응답 DTO를 통일하면 프론트엔드 타입 관리와 문서화가 쉬워진다.

### 북마크 컬렉션 이름 정리

퀴즈 북마크와 번역기 북마크가 같은 `translator_bookmarks` 하위 컬렉션을 공유하는 부분은 혼란을 줄 수 있다. 새 구조에서는 `quiz_bookmarks`와 `translator_bookmarks`를 분리하는 것이 더 명확하다.

### 번역 평가 로그 추가

`TranslationService`가 rule/etri/openai 중 어떤 토큰 흐름을 선택했는지, 사전 hit 수가 몇 개인지 로그로 남기면 번역 품질 개선에 도움이 된다.

### 테스트 보강

다음 테스트가 있으면 안정성이 크게 올라간다.

```text
TextNormalizer 단위 테스트
SignSentenceSimplifier 단위 테스트
TranslationService 사전 매칭 테스트
QuizService 정답 판정 테스트
UserService tryQuestion 통계 갱신 테스트
프론트엔드 API 클라이언트 URL 변환 테스트
```

## 26. 한 문장으로 정리

이 프로젝트는 프론트엔드가 사용자 학습 경험과 영상 재생 UI를 담당하고, 백엔드가 수어 사전, 형태소 정규화, Firebase 데이터, Storage 영상 URL, 퀴즈 판정, 사용자 기록을 담당하는 구조이다. 핵심 원리는 "자연스러운 사용자 입력을 내부 사전 단어로 정규화하고, 그 단어에 맞는 수어 영상을 찾아, 사용자의 학습 기록과 함께 반복 학습 흐름으로 연결하는 것"이다.
