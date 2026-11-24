수어링고 — 승혁 파트: 평가 영상 정리 도구

프로젝트 적용:
viewer/seunghyeok/evaluation/export_motion_json.py  (1단계: 저장 동작 npy → 비교 화면용 JSON)
viewer/seunghyeok/evaluation/prepare_videos.py      (3단계: 녹화 영상 → 무작위 번호 묶음)

출처 표기(팀 규칙 RULES.md 2절): 한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용
  두 도구의 출력 README와 대응표(clip-map.json, condition-map.json)에 자동으로 들어간다.
  평가 안내문·발표 자료·영상 설명에도 같은 문구를 적는다.
  막대인간 그림·영상은 발표에 써도 되지만, 변환한 JSON·원본 좌표는 승인된 사람의 컴퓨터 밖으로 내보내지 않는다.

전체 순서:
1. VM에서 export_motion_json.py로 조건별 sentence-NN.json을 만든다.
   입력은 ml/eval/compare.py와 같은 records 목록(generated.json). 모델은 돌리지 않는다.
   python3 viewer/seunghyeok/evaluation/export_motion_json.py --manifest runs/generated.json --output /새출력폴더
   옵션: --conditions B1,Ours-H / --clips 클립목록.txt(이 순서가 문장 번호) / --sample 0
   결과: <조건>/sentence-NN.json, private/clip-map.json(문장 번호↔클립, 참가자에게 주지 않음)
   B1은 baseline, 나머지는 model로 표시. 토큰·자막 구간은 비어 있음.
   주의: AI Hub 좌표에서 나온 파일이다. 저장소에 커밋하거나 외부에 올리지 않는다.
2. 일괄 녹화 화면(/sign-batch-record, 2026-11-18)에서 1의 출력 폴더를 고르고 "일괄 녹화 시작".
   모든 영상을 같은 크기(640×480, 화면 배율 2면 1280×960) · 시점 · 표시 설정(얼굴 기본 끔)으로,
   앞뒤 0.5초 정지 화면을 넣어 1배속으로 녹화하고 <조건>/sentence-NN.webm 구조의 ZIP 하나로 내려 준다.
   ZIP 안의 recording-info.json에는 조건 · 원본 파일 이름이 있으므로 참가자에게 주지 않는다.
   녹화 중에는 그 브라우저 창을 가리거나 최소화하지 않는다. 영상이 기대 길이의 80%보다 짧거나 크기가 바뀌면 멈추고 ZIP을 만들지 않는다.
   (한두 개만 다시 볼 때는 비교 화면 /sign-compare에서 칸마다 녹화해도 된다.)
3. ZIP을 새 폴더에 풀고 prepare_videos.py로 무작위 번호 묶음을 만든다 (아래).
   python3 viewer/seunghyeok/evaluation/prepare_videos.py --input <푼 폴더> --output <새 출력 폴더> --conditions B1,Ours-H
VM에서 실제로 한 순서 (2026-11-23, 지헌 자료 /data/work/jiheon/eval/sentence_heldout_20261118/):
  - 같은 단어 열이면 문장 번호 · 화자가 달라도 B1 · Ours-H 동작이 똑같다(43개 단어 열 모두 확인).
    그래서 평가 문장은 단어 열 기준으로 고르고, 단어 열마다 클립 하나만 쓴다.
  - 도구 올리기: /data/work/yuseunghyeok/tools/ 에 export_motion_json.py · prepare_videos.py · make_candidates.py
    (zsh에서 gcloud 옵션을 변수에 담을 때는 배열로: O=(--project=... --zone=...); gcloud compute scp "${O[@]}" ...)
  - 후보 표: python3 make_candidates.py --manifest <generated.json> --out /data/work/yuseunghyeok/eval --exclude SEN0892_REAL12
    → candidates.tsv(단어 열 42개: 2낱말 13 · 3낱말 12 · 4낱말 8 · 5낱말 4 · 6낱말 5), clips_all.txt
    (지헌 11/23: SEN0892의 REAL12 클립만 라벨이 "내리다"(다른 화자는 "차내리다")라 빼고 42개. 화자는 REAL03 우선, 없으면 REAL12.
     평가는 끼워 넣기 없는 순수 생성이 최종이고 B2는 계획이 없어 B1 · Ours-H 두 조건.)
    검사: python3 -I viewer/seunghyeok/evaluation/test_make_candidates.py (합성 자료 5항목)
    후보 표는 팀원이 경로로 읽을 수 있게 644, 변환한 좌표 폴더는 700으로 둔다.
  - 승현이 20개를 고르면 그 줄의 "고른 클립"만 clips_20.txt에 한 줄씩 적고:
    source /data/venv/activate
    python3 tools/export_motion_json.py --manifest <generated.json> --output eval/export_20_<날짜> --conditions B1,Ours-H --clips eval/clips_20.txt
  - 승인된 Mac으로 가져오기: gcloud compute scp --recurse "${O[@]}" yuseunghyeok@sign-ml:/data/work/yuseunghyeok/eval/export_20_<날짜> <Mac 폴더>
    → /sign-batch-record 일괄 녹화 → prepare_videos.py --conditions B1,Ours-H
  - 43개 전체 변환 시험(eval/export_all43_20261123, 86개 JSON, 15MB)은 성공했다.
  - 2026-11-24 실제 평가 20문장 변환 (VM 안에서만):
    · 42개 표: eval/candidates_42.tsv · clips_all42.txt (43표의 16번이 빠짐)
    · 승현 번호 20개(1, 5, 7, 8, 9, 13, 18, 19, 20, 21, 22, 25, 27, 28, 29, 34, 37, 38, 40, 43)는 43개 표 기준이라,
      번호가 아니라 단어 열(글로스)로 42개 표의 클립을 찾았다. 14개는 42표 번호가 달랐다. 이 순서가 sentence-01~20.
      → eval/selection_20.tsv(문장 · 승현 번호 · 42표 번호 · 낱말수 · 글로스 · 클립), eval/clips_20.txt
    · 낱말 수별 2낱말 6 · 3낱말 6 · 4낱말 4 · 5낱말 2 · 6낱말 2 (승현이 비례 무작위 seed 0으로 뽑음), 화자 REAL03 19 · REAL12 1
    · 변환: eval/export_20_20261124 (B1 · Ours-H 각 20개, 700 권한, 6.6MB). B1 37~137프레임, Ours-H 36~144프레임.
      clip-map의 문장 순서가 clips_20.txt와 같음을 확인. 좌표 파일은 확인될 때까지 VM 밖으로 내보내지 않는다.
검사: python3 -I viewer/seunghyeok/evaluation/test_export_motion_json.py
  (합성 동작 5항목. 출력 JSON을 frontendcodes의 motion.ts decodeMotion에 넣어 좌표가 같게 돌아오는지 포함)

기본 모드: 설계서의 필수 3조건 B1/B2/Ours-H × 20문장 = 60개 영상 필요 (2026-11-15부터).
Ours-HF(얼굴 포함)는 확장 실험이라 --conditions에 넣을 때만 쓴다 (4조건 80개).
B2가 아직 없으면 --conditions B1,Ours-H 처럼 2개 이상 골라 쓸 수 있다.
고르지 않은 조건 폴더가 입력에 있으면 빠뜨린 실수를 막으려고 멈춘다.
입력 폴더 예(기본 3조건):
input/B1/sentence-01.mp4 ... sentence-20.mp4
input/B2/sentence-01.mp4 ... sentence-20.mp4
input/Ours-H/sentence-01.mp4 ... sentence-20.mp4
WebM도 지원. 같은 조건·문장의 MP4/WebM중복은 거부.

실행(프로젝트 루트 기준):
python3 viewer/seunghyeok/evaluation/prepare_videos.py --input /입력폴더 --output /새출력폴더
python3 viewer/seunghyeok/evaluation/prepare_videos.py --input /입력폴더 --output /새출력폴더 --conditions B1,Ours-H
python3 viewer/seunghyeok/evaluation/prepare_videos.py --input /입력폴더 --output /새출력폴더 --conditions B1,B2,Ours-H,Ours-HF
검사: python3 -I viewer/seunghyeok/evaluation/test_prepare_videos.py (합성 1초 영상, 7항목)
현재 PC에는 python3/ffmpeg/ffprobe가 설치되어 있음.
출력 폴더는 입력 폴더 바깥, 기존에 없는 새 경로여야 함.

결과:
videos/001.mp4 ... : 순서를 무작위로 섞어 번호 지정. 조건명이 파일 이름에 없음.
evaluation-videos.zip : 참가자 공유용 번호 영상만 포함.
private/condition-map.json : 번호↔문장번호↔조건↔입력파일↔영상정보 매핑.
조건표는 최종 역할 분담대로 승현에게 별도 전달할 자료. 다른 도구로 전송하지 않았음.

검사·정리:
누락/중복/잘못된 이름/읽을 수 없는 영상/해상도 불일치 검사.
입력 영상 원본 유지. 영상 재인코딩 없이 영상 트랙만 저장, 오디오·컨테이너메타데이터·챕터 제외.
출력 전후 프레임수/해상도/코덱 확인.
출력 폴더 덮어쓰기 금지. 완료 전에는 임시 폴더에 생성.
같은 클립을 다른 조건에 넣었는지/실제모델출력인지/화면에 조건명이 박혀있는지/시점 일치/정확한30fps는 자동검증하지 않음.
매핑에 단어·문장 내용은 기록하지 않음. 문장번호와 실제 평가문장은 통합 때 확정.

이번 검증:
80슬롯 정상검사 및 누락/중복/잘못된파일이름거부.
합성 영상4개(1문장×4조건)로 실제 실행; --test-mode 사용.
ZIP에는001~004영상만 포함, 조건표 제외 확인.
입력에 넣은 오디오와조건제목메타데이터 제거 확인.
원본보존/기존출력덮어쓰기방지/누락시출력미생성 확인.
test-bundle은 같은 합성 영상을 복제한 기능점검 자료이며 실제 평가자료가 아님.
실제80개영상은 아직 만들지 않았음.

2026-11-15 조건 선택 추가 검증 (test_prepare_videos.py 7항목 통과):
기본 3조건 묶음(ZIP 001~003, 조건표 3조건), B2 없이 2조건, Ours-HF 포함 4조건,
고르지 않은 조건 폴더·빠진 조건 폴더 거부(출력 미생성), 잘못된 이름·중복·1개 조건 거부, 명령줄 기본값·오류 종료.
실제 평가 영상은 아직 없음.
