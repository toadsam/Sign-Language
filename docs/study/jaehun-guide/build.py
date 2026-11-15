"""Build the offline study guide from a pinned Git snapshot. No ML execution."""
from pathlib import Path
import ast
import hashlib
import html
import json
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
REV = '2df9317c1f2edd86c39373b2626ea88d06d9b017'

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args]).decode('utf-8')

def esc(s):
    return html.escape(str(s), quote=True)

paths = git('ls-tree', '-r', '--name-only', REV, '--', 'ml/common', 'ml/prep', 'ml/vq').splitlines()
paths = [p for p in paths if p.endswith('.py') and '/story/' not in p and not p.endswith('__init__.py')]
paths.append('ml/gen/tokenize.py')
sources = {p: git('show', f'{REV}:{p}') for p in paths}
functions = {}
for path, source in sources.items():
    found = {}
    def walk(nodes, prefix=''):
        for n in nodes:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = prefix + n.name
                found[name] = (n.lineno, n.end_lineno)
                walk(n.body, name + '.')
    walk(ast.parse(source).body)
    functions[path] = found

def source_id(path):
    return 'src-' + path.replace('/', '-').replace('.', '-')

def snippet(match):
    path, name = match.group(1).split('|')
    start, end = functions[path][name]
    lines = sources[path].splitlines()[start-1:end]
    # A range suffix is never guessed: all excerpts are complete named AST nodes.
    code = ''.join(f'<span class="code-line"><b>{i}</b>{esc(line)}</span>' for i, line in enumerate(lines, start))
    return f'<figure class="code"><figcaption>실제 코드 · {esc(path)} · {esc(name)} <a href="#{source_id(path)}">전체 파일 보기</a></figcaption><pre><code>{code}</code></pre></figure>'

notes = {
'common/skeleton.py': ('관절 번호 사전', '몸·손·얼굴의 이름과 연결 관계 → 125점 번호·뼈 연결 목록', '관절 순서를 바꾸면 저장 데이터와 모든 모델의 해석이 달라진다.'),
'common/data.py': ('데이터 읽기와 분할', 'npy·meta·분할표 → 동작 배열을 가진 train/val/test 목록', 'apply_split은 품질 제외와 사람 분할만 처리한다. 라벨 조건·문장 holdout은 별도다.'),
'common/fs.py': ('Windows 경로 처리', '파일 경로 → 긴 경로도 열 수 있는 형태', '모델 정확도를 높이는 코드가 아니라 파일 접근을 돕는 코드다.'),
'common/metrics.py': ('공통 채점 도구', '두 동작·단위 정보 → 거리, DTW, 움직임 크기·매끄러움 등', '단위·관절 범위·시간 정렬이 같아야 점수를 비교할 수 있다.'),
'common/viewer.py': ('재생 화면 만들기', '좌표·라벨·토큰 + 뷰어 템플릿 → HTML', '화면 출력 도구다. HTML을 만들었다고 모델을 새로 학습한 것은 아니다.'),
'prep/inspect_dataset.py': ('받은 데이터 조사', '폴더·ZIP 목록과 일부 표본 → 데이터 구성 보고서', '전수 품질 검사가 아니라 무엇을 받았는지 먼저 파악하는 단계다.'),
'prep/preprocess.py': ('원본을 학습 형식으로 변환', '프레임 JSON → float32 npy·메타', '결측 보간, 평활화, 뼈 길이 보정, 좌표 정규화, active 검출의 중심 파일.'),
'prep/batch_word.py': ('대용량 작업 순서 관리', '파일 목록·다운로드 설정 → ZIP별 처리 결과·검증 로그', '다운로드·변환·검증·정리 순서를 자동화했다. 실제로 실행하면 파일과 네트워크에 영향을 준다.'),
'prep/audit_word.py': ('좌표와 라벨 대응 검사', '변환 좌표·라벨 ZIP → 구조·누락·손목 간격 통계', '검사와 수리는 다르다. 이상을 발견했다고 자동으로 수정하지 않는다.'),
'prep/diagnose_word.py': ('이상 원인 후보 좁히기', '기존 점검 결과·좌표·라벨 → 세부 진단 보고서', 'REAL02/REAL25 번호·길이가 비슷해도 같은 사람이라고 확정할 수 없다.'),
'prep/scan_spikes.py': ('순간 튐 전수 조사', '모든 클립 → 최대 손목 간격·프레임 이동량', '평균이 정상이어도 한 프레임만 크게 튈 수 있다.'),
'prep/review_spikes.py': ('튀는 구간 자세히 보기', '이상 후보 → 프레임·부위별 검토 자료', '전체 클립 검사와 특정 후보 상세 검토의 범위를 구분한다.'),
'prep/plot_review.py': ('진단 결과를 그림으로', '검토 자료 → 좌표·시간 변화 그림', '그림은 오류 후보를 해석하는 근거이지 의미 정확성의 자동 판정이 아니다.'),
'prep/quality_lists.py': ('품질 기준을 목록으로', '점검 통계·임계값 → usable/review/hold 목록', '초기 v0.1 목록과 최종 학습 제외 목록은 같지 않다.'),
'prep/repair_ears.py': ('귀·눈 좌표 수리', '좌표·진단 기준 → 백업과 보정된 귀·눈, 수리 기록', '반대쪽 대칭 → 클립 안 보간 → 수행자 평균 순으로 대안을 사용한다. 손·팔을 고친 코드가 아니다.'),
'prep/attach_labels.py': ('좌표에 단어·문장 설명 붙이기', 'meta·형태소 라벨 ZIP → gloss/segments/label/dur_ratio, sentences.jsonl', 'clip ID로 연결한다. 비어 있거나 대응 안 되는 라벨은 표시하고 임의 추정하지 않는다.'),
'prep/make_split.py': ('공통 분할표 고정', '메타·제외 목록·수행자 설정 → splits/*.json', '누가 학습/검증/평가에 들어가는지 파일로 공유한다.'),
'prep/holdout_sentences.py': ('새 조합 시험문제 만들기', '문장 메타·사람 분할 → holdout 문장 열과 항목 목록', '문장 번호만 다르고 gloss 열이 같으면 새 조합이 아니다.'),
'vq/model.py': ('자모표 모델 구조', '동작 ↔ 잠재 특징 ↔ 토큰 ↔ 복원 동작', '모델 설계도다. 이 파일만으로 학습 결과가 생기지 않는다.'),
'vq/train.py': ('모델 학습·저장·기본 평가', '학습 데이터·설정 → model.pt, config, log, summary, viewer', '학습 반복과 평가 반복을 구분한다. 평가는 가중치를 갱신하지 않는다.'),
'vq/eval_clips.py': ('단어·전환·대기 구간별 평가', '학습된 모델·평가 클립·라벨 → 프레임 평균 mm', 'train.evaluate의 클립 평균과 집계 방식이 다르다.'),
'vq/baseline_b1.py': ('이어붙이기 비교 기준', '학습 사람의 대표 단어·평가 동작 → B1 점수와 조합 비교', 'B1은 생성 신경망이 아니다. 저장한 클립을 사용하는 기준선이다.'),
'vq/render_figures.py': ('실험 예시 그림', '모델·동작·학습 로그 → 원본/복원·시간순·토큰열·학습 곡선', '한 예시가 좋아 보인다는 것과 전체 평가 성능은 별개다.'),
'vq/plot_experiments.py': ('실험 비교 그림', '실험 결과 → 비교 그래프', '같은 데이터·집계 방식끼리 묶어서 읽어야 한다.'),
'vq/token_atlas.py': ('512개 토큰 펼쳐 보기', '디코더·토큰 사용 통계 → 격자 PNG·HTML', '토큰 하나의 반복 예시는 전체 문맥 속 수어 의미와 같지 않다.'),
'vq/audit_handoff.py': ('전달 파일 호환성 검사', '토큰·모델·메타·분할표 → 검사 요약과 SHA-256', '8만 개 구조 검사와 36개 좌표 재인코딩 검사는 검사 범위가 다르다.'),
'gen/tokenize.py': ('학습된 모델로 토큰 파일 생성', '동작 클립 + 고정 VQ → tokens.json', '인수인계와 연결된 코드다. 현재 소유 영역은 지헌이며, 버전 필드는 이 코드에서 자동 저장되지 않는다.'),
}
atlas=[]
for path, source in sources.items():
    short=path.removeprefix('ml/')
    title, io, caution=notes[short]
    sid=source_id(path)
    funcs=' · '.join(f'<a href="#{sid}-L{a}">{esc(n)}</a>' for n,(a,b) in functions[path].items()) or '상수와 연결 관계 정의'
    numbered=''.join(f'<span id="{sid}-L{i}" class="code-line"><b>{i}</b>{esc(line)}</span>' for i,line in enumerate(source.splitlines(),1))
    atlas.append(f'<article class="file-entry" id="{sid}"><h3>{esc(short)} <small>{esc(title)}</small></h3><p>{esc(io)}</p><p class="note">{esc(caution)}</p><details class="full-source"><summary>실제 코드 펼치기 · {len(source.splitlines())}줄</summary><p class="function-list">{funcs}</p><pre><code>{numbered}</code></pre></details></article>')

template=(HERE/'content.html').read_text(encoding='utf-8')
template=re.sub(r'\{\{code:([^}]+)\}\}',snippet,template)
template=template.replace('{{ATLAS}}',''.join(atlas)).replace('{{FILE_COUNT}}',str(len(paths))).replace('{{REV}}',REV)
template=template.replace('{{CSS}}',(HERE/'style.css').read_text(encoding='utf-8')).replace('{{JS}}',(HERE/'guide.js').read_text(encoding='utf-8'))
assert not re.search(r'\{\{(?:code:|ATLAS|CSS|JS|REV|FILE_COUNT)',template)
(HERE/'index.html').write_text(template,encoding='utf-8')
manifest={'created':'2026-10-27','source_commit':REV,'branch':'feature/ai-motion-vq','files':{p:hashlib.sha256(s.encode()).hexdigest() for p,s in sources.items()},'scope':'Read-only code snapshot; no dataset, tokens or model weights embedded; synthetic teaching demos.'}
(HERE/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'output':str(HERE/'index.html'),'source_files':len(paths),'bytes':(HERE/'index.html').stat().st_size},ensure_ascii=False))
