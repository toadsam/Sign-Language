승혁 — 통합 전 JSON 데이터 계약 검사
작성: 2026-10-18

목적
다른 조원의 서버를 연결하기 전에, 내 PC에 있는 JSON이 현재 뷰어 형식에 맞는지 확인합니다.
네트워크에 접속하지 않고 원본 파일을 수정하지 않습니다.
화면에서 사용하는 motion.ts/playback.ts/codebook.ts 검사 코드를 그대로 실행합니다.
실제 팀 계약이 바뀌면 뷰어의 어댑터와 검사 기준도 함께 조정해야 합니다.
검사기는 기존 형식을 바꾸거나 팀 API를 확정하는 도구가 아닙니다.

VSCode 실행 순서
1. 프로젝트 폴더에서 터미널 → 새 터미널을 엽니다.
2. 아래 명령을 한 줄씩 실행합니다.

cd /Users/yuseunghyeok/Downloads/Sign-Language-main/frontendcodes
node tools/validate-sign-data.cjs components/sign-player/demo-motion.json components/sign-player/demo-codebook.json

3. 결과의 valid:true는 현재 데이터 형식 검사를 통과했다는 뜻입니다.
   demo 표식이 있으면 합성 시험 자료 경고가 표시됩니다.
4. 나중에 실제 JSON을 받으면 명령 끝의 파일 경로를 받은 파일 경로로 바꿉니다.
   공백이 있는 경로는 큰따옴표로 감싸세요.
5. 보고서로 저장하려면 뒤에 --report와 새 파일 경로를 붙입니다.

node tools/validate-sign-data.cjs components/sign-player/demo-motion.json --report /tmp/sign-data-report.json

같은 보고서 파일이 이미 있으면 덮어쓰지 않습니다. 다른 이름을 지정하세요.
복수 입력 중 하나가 잘못되어도 나머지 파일은 계속 검사합니다.
파일 하나당40MB까지 받습니다. frontendcodes의 node_modules와 TypeScript가 필요합니다.
outputs에 보관한 스크립트 복사본 대신 프로젝트의 tools 안에서 실행하세요.

지원 범위
동작: source model/baseline,125관절,어깨너비 단위,fps,프레임 수,
float32 little-endian base64 길이·유한 좌표,토큰·미지원 목록,자막 start포함/end미포함.
영상: source video + items 배열(word,id,file,url,hasVideo),기존 단일 videoUrl.
코드북: 로컬 가져오기 형식 version1/entries,중복 토큰,토큰별 정확히4프레임.
추가 경고: 합성 자료,영상 없는/빈 목록,상대 영상 주소,겹치는 자막 구간.

보고서
입력 크기/SHA-256과 검사에 사용한 뷰어 모듈의 SHA-256을 기록합니다.
확인일·원본·검사 기준 버전을 나중에 대조할 수 있습니다.
큰 좌표 배열이나 영상 파일 자체는 보고서에 복사하지 않습니다.
valid는 전체 입력이 형식상 유효한지,results는 파일별 결과입니다.
종료 코드0: 전체 유효 /1: 입력 파일 검사 실패 /2:명령 또는 보고서 저장 오류.

검증 결과의 한계
형식 통과는 실제 수어 정확도·모델 성능·영상 파일 존재·코덱 재생·브라우저 호환을 보장하지 않습니다.
상대 영상 주소는 실제 API/배포 주소와 연결할 때 확인해야 합니다.
codebook 형식은 내 로컬 어댑터이며, 최종 팀 내보내기 형식 확정과 별개입니다.
이 JSON 검사기의 자체 검사는 합성 샘플을 사용합니다.
실제 팀 HTML은 별도의 check-token-atlas.cjs와 check-ai-viewer.cjs로 512토큰/8클립을 검사했습니다.
이 검사기는 HTML 입력이나 최신 팀 계약 전체를 검증하지 않습니다.
브라우저 재생과 성능은 별도 기록을 참조하며 JSON 형식 통과만으로 완료 판정하지 않습니다.

도구 자체 검사
node tools/check-sign-data-validator.cjs
정상·잘못된 자료,복수 파일,보고서 저장/덮어쓰기 방지,원본 보존을 검사합니다.
