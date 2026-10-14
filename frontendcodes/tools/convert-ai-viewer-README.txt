AI 팀 viewer.html → 원본/복원 동작 JSON 변환

프로젝트 frontendcodes 폴더에서 실행합니다.

1. 클립 목록 확인
python3 tools/convert-ai-viewer.py --input /경로/viewer.html --list

2. 0번 클립 변환 (번호는 0부터)
python3 tools/convert-ai-viewer.py --input /경로/viewer.html --clip 0 --output /경로/새출력폴더

3. /sign-reconstruct 화면에서 원본 칸에 original.json, 복원 칸에 reconstructed.json 선택.
/Sign-Language 아래 배포 시 /Sign-Language/sign-reconstruct에서 사용합니다.

출력
original.json: 원본 참조 (source=baseline; tokens 빈 목록)
reconstructed.json: 복원 (source=model; 팀 결과 토큰 유지)
manifest.json: 입력 파일 이름, 클립 번호/이름, split, active, down 및 변환 설명

지원 범위
로컬에 저장된 origin/feature/ai-motion-vq의 ml/vq/train.py export_viewer 형식.
const DATA 선언의 JSON 데이터만 읽으며 HTML/JavaScript를 실행하지 않습니다.
125관절: 상체13, 왼손21, 오른손21, 얼굴70. 어깨너비 정규화를 전제.
fps는 내보낸 파일의 값을 유지. start/active 구간을 자르거나 자막을 생성하지 않음.
float32 little-endian base64로 변환. 입력 파일의 반올림된 정밀도를 복원하지 않음.
기존 출력 폴더를 덮어쓰지 않으며 입력 HTML은 수정하지 않음.
다른 형식이나 관절 순서는 변환을 거부합니다. 범용 HTML 변환기가 아닙니다.

시험 입력은 --demo 옵션을 반드시 사용합니다.
실제 학습 결과에는 합성 시험 파일을 대체해서 넣어주세요.
원본 source=baseline은 플레이어가 허용하는 출처 값으로, B1/B2 결과를 의미하지 않습니다.
JSON만으로 정규화의 실제 수행 여부나 모델 성능은 검증할 수 없습니다.
