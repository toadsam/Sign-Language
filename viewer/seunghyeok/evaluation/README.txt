수어링고 — 승혁 파트: 평가 영상 정리 도구

프로젝트 적용:
viewer/seunghyeok/evaluation/prepare_videos.py

기본 모드: 20문장×B1/B2/Ours-H/Ours-HF=80개 영상 필요.
입력 폴더 예:
input/B1/sentence-01.mp4 ... sentence-20.mp4
input/B2/sentence-01.mp4 ... sentence-20.mp4
input/Ours-H/sentence-01.mp4 ... sentence-20.mp4
input/Ours-HF/sentence-01.mp4 ... sentence-20.mp4
WebM도 지원. 같은 조건·문장의 MP4/WebM중복은 거부.

실행(프로젝트 루트 기준):
python3 viewer/seunghyeok/evaluation/prepare_videos.py --input /입력폴더 --output /새출력폴더
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
