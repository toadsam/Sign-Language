Expo 배포 빌드의 로컬 검증
작성:2026-10-18

목적
개발 모드와 배포 모드의 경로·재생·성능 차이를 같은 Mac에서 확인합니다.
이 서버는127.0.0.1에만바인딩하며인터넷에공개하지않습니다.
기존로그인/게스트판정은바꾸지않습니다.

frontendcodes 터미널에서 빌드:
CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:9 ./node_modules/.bin/expo export --platform web --clear --output-dir /tmp/sign-production-preview

완료 후 새 터미널에서:
python3 tools/preview-sign-build.py /tmp/sign-production-preview

Chrome에서:
http://127.0.0.1:8084/Sign-Language/sign-lab

최초접속은로그인화면으로이동할수있습니다.기존'로그인없이시작'을누른후
위작업실주소로다시접속합니다.로그인절차를우회하는코드는추가하지않았습니다.
게스트상태는이로컬주소의브라우저저장소에기존앱방식으로저장됩니다.
서버종료는해당터미널Ctrl+C. /tmp산출물은재부팅등으로사라질수있습니다.

중요한실행조건
이검증용빌드는API주소를127.0.0.1:9로지정해실제백엔드연결을분리합니다.
HTTP API가필요한시험은/sign-generate의로컬목업API를명시적으로선택합니다.
홈의실제계정통계·퀴즈·번역API기능은이빌드에서검증하는대상이아닙니다.
--clear는이전환경변수가번들캐시에남지않게하기위해사용합니다.
실제팀통합/배포때는팀API주소로다시빌드해야하며이검증용빌드를그대로발행하지않습니다.
폰에서는127.0.0.1이PC를가리키지않으므로이서버로모바일시험을한것으로표시하지않습니다.

서버처리
/Sign-Language/sign-player 같은확장자없는경로를export된.html파일로연결합니다.
영상/WASM/모델은동일한접두사아래에서제공합니다.
접두사밖주소·숨김파일·폴더밖경로는404로거부합니다.
공개호스팅·HTTPS·실제API인증·브라우저버전별전체검증은별도입니다.

경로 처리 자동 검사 (서버 실행 불필요)
python3 tools/check-preview-paths.py
임시 합성 파일로 경로 접두사·정적 자산·숨김/상위 경로·외부 심볼릭 링크·목록 표시 차단을 검사합니다.
실제 배포 빌드 생성이나 브라우저 화면 검증을 대체하지 않습니다.
