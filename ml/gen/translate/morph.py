"""형태소 분석기 감싸기.

모든 분석기는 `analyze(text) -> list[(form, tag)]`를 돌려준다. tag는 우리끼리 쓰는 거친 품사다.
  N   체언·수식언 등 내용어 (form 그대로)
  V   용언 (form은 원형, "-다"로 끝남)
  J   조사
  E   어미 (form은 겉모양, 예: "어요")
  NUM 숫자
  SF  문장 부호 (? . ! ,)
  X   그 밖

분석기 세 가지
  MadiAnalyzer     기본. madi(`pip install madipy`, import madi, 0.4.0). pos()의 한국어 태그(일반명, 동사, 주격조 …)를
                   위 품사로 줄인다(MADI_TAGS, 11-14 실제 출력으로 확인).
  RuleAnalyzer     madi가 없는 환경용 대체 규칙 분석기. 어절마다 조사·어미를 뒤에서 떼고, 어휘 목록(글로스 이름)에
                   있는 쪽을 고른다. 정확한 형태소 분석이 아니라 "같은 낱말은 늘 같은 단위가 되게" 하는 것이 목적이다.
  FixedAnalyzer    미리 받은 분석 결과를 주입한다(테스트, 캐시).

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import re

PUNCT = set("?.!,~…")

# ---------------------------------------------------------------- 한글 자모

_BASE, _JUNG, _JONG = 0xAC00, 21, 28
JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ",
        "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]
JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ",
        "ㅡ", "ㅢ", "ㅣ"]


def is_hangul(ch):
    return 0xAC00 <= ord(ch) <= 0xD7A3


def split_syllable(ch):
    """'각' → (초성 번호, 중성 번호, 종성 번호)."""
    code = ord(ch) - _BASE
    return code // (_JUNG * _JONG), (code // _JONG) % _JUNG, code % _JONG


def join_syllable(cho, jung, jong=0):
    return chr(_BASE + (cho * _JUNG + jung) * _JONG + jong)


def drop_final(ch):
    """'갔' → '가' (받침을 뗀다)."""
    cho, jung, _ = split_syllable(ch)
    return join_syllable(cho, jung, 0)


def final_of(ch):
    return JONG[split_syllable(ch)[2]] if is_hangul(ch) else ""


# ---------------------------------------------------------------- 규칙 분석기

# 조사 (긴 것부터 맞춘다). 한 글자 조사는 남는 부분이 어휘에 있거나 두 글자 이상일 때만 뗀다.
PARTICLES = sorted("""
은 는 이 가 을 를 에 의 도 만 와 과 로 랑 께 나 요
에서 에게 한테 께서 으로 이랑 까지 부터 보다 처럼 마다 이나 이든 든지 밖에 하고 이요 이며
에서는 에게는 으로는 에서도 까지는 부터는 한테는 이라도 라도 에는 에도 로는 로도 과는 와는 이랑은 만큼
""".split(), key=len, reverse=True)

# 체언 뒤 "이다" (조사처럼 뺀다)
COPULA = sorted("인가요 인데요 이죠 이에요 예요 입니다 이다 이야 이었어요 였어요 이었다 였다 인데 이고 이지만 이라서 라서 이면".split(),
                key=len, reverse=True)
_AFTER_FINAL = {"을", "은", "이", "과", "으로", "이랑", "이나"}
_AFTER_VOWEL = {"를", "는", "가", "와", "로", "랑", "나"}


def _agrees(rest, particle):
    """한 글자 조사가 앞 글자 받침과 맞는지 (밥+을, 사과+를)."""
    if not rest or not is_hangul(rest[-1]):
        return False
    jong = split_syllable(rest[-1])[2]
    if particle in _AFTER_FINAL:
        return jong != 0
    if particle in _AFTER_VOWEL:
        return jong == 0 or (particle == "로" and JONG[jong] == "ㄹ")
    return False


# 용언 어미 겉모양. 앞에 "ㅂ"/"ㅆ"/"ㄹ"/"ㄴ"이 붙은 것은 앞 글자의 받침으로 찾는다.
ENDINGS = sorted("""
요 어요 아요 여요 에요 예요 이에요 이예요 세요 으세요 셔요 습니다 니다 습니까 니까 다 는다 는데 은데 데
고 지 지요 죠 지만 네 네요 나요 니 냐 자 면 으면 서 어서 아서 니까 으니까 려고 으려고 러 으러 게 도록
어도 아도 겠어요 겠다 겠습니다 고싶어요 고싶다 고싶습니다 주세요 어주세요 아주세요 줘요 줄래요 래요 을래요
까요 을까요 는지 은지 던 는 은 을 기 음 어 아 여 시다 십시오 으십시오 셨어요 으셨어요 어라 아라
시죠 으시죠 셨나요 으셨나요 셨습니까 으셨습니까 려면 으려면 드릴까요 어드릴까요 아드릴까요 드리겠습니다 시겠어요 으시겠어요
""".split(), key=len, reverse=True)
# 받침으로 붙는 어미: 그 받침을 떼고 남은 어미 겉모양
FINAL_ENDINGS = {"ㅂ": ["니다", "니까", "시다"], "ㅆ": ["어요", "다", "습니다", "어", "고", "는데", "지만", "네요", "나요", "니"],
                 "ㄹ": ["까요", "래요", "게요", "거예요", "수", ""], "ㄴ": ["다", "데", "가요", "지", ""]}

# 줄어든 마지막 글자 되돌리기 (첫 번째가 기본값)
#   해→하, 봐→보, 와→오, 줘→주, 돼→되, 셔→시, 려→리  (모음이 줄어든 것: 되돌린 쪽이 기본)
#   써→쓰, 바빠→바쁘                                  (ㅡ 탈락: 원래 모양이 기본, 되돌린 것은 후보)
_BACK_FIRST = {"ㅘ": "ㅗ", "ㅝ": "ㅜ", "ㅙ": "ㅚ", "ㅕ": "ㅣ"}
_BACK_LATER = {"ㅓ": "ㅡ", "ㅏ": "ㅡ"}


def _uncontract(stem):
    """줄어든 어간의 원래 모양 후보. 첫 번째가 기본값."""
    if not stem or not is_hangul(stem[-1]):
        return [stem]
    cho, jung, jong = split_syllable(stem[-1])
    if jong:
        return [stem]
    if stem[-1] == "해":
        return [stem[:-1] + "하", stem]
    v = JUNG[jung]
    out = [stem]
    if v in _BACK_FIRST:
        out.insert(0, stem[:-1] + join_syllable(cho, JUNG.index(_BACK_FIRST[v])))
    elif v in _BACK_LATER:
        out.append(stem[:-1] + join_syllable(cho, JUNG.index(_BACK_LATER[v])))
    if stem[-1] == "워" and len(stem) >= 2 and is_hangul(stem[-2]) and split_syllable(stem[-2])[2] == 0:
        c, j, _ = split_syllable(stem[-2])  # ㅂ 불규칙: 더워 → 덥
        out.append(stem[:-2] + join_syllable(c, j, JONG.index("ㅂ")))
    return out


def _ending_splits(word):
    """어절을 (어간 후보들, 어미 겉모양)으로 나누는 후보를 긴 어미부터."""
    out = []
    for e in ENDINGS:
        if len(word) > len(e) and word.endswith(e):
            out.append((_uncontract(word[: -len(e)]), e))
    for fin, tails in FINAL_ENDINGS.items():
        for t in tails:
            body = word[: len(word) - len(t)] if t else word
            if not body or (t and not word.endswith(t)) or not is_hangul(body[-1]) or final_of(body[-1]) != fin:
                continue
            stem = body[:-1] + drop_final(body[-1])
            # 과거 "ㅆ"은 줄어든 어간(갔→가, 했→하, 왔→오)
            out.append((_uncontract(stem), fin + t))
    return out


class RuleAnalyzer:
    """madi 없이 쓰는 규칙 분석기. lexicon: 알고 있는 낱말 원형(글로스 이름 등)."""

    name = "rule"

    def __init__(self, lexicon=()):
        self.lexicon = set(lexicon)
        self.stems = {w[:-1] for w in self.lexicon if w.endswith("다") and len(w) >= 2}

    def _known(self, w):
        return w in self.lexicon

    def analyze_word(self, word):
        morphs = []
        tail = []
        while word and word[-1] in PUNCT:
            tail.insert(0, (word[-1], "SF"))
            word = word[:-1]
        m = re.match(r"^(\d+)(.*)$", word)
        if m:
            morphs.append((m.group(1), "NUM"))
            word = m.group(2)
        if word:
            morphs.extend(self._content(word))
        return morphs + tail

    def _content(self, w):
        if not all(is_hangul(c) for c in w):
            return [(w, "N")]
        if self._known(w):
            return [(w, "V" if w.endswith("다") and w[:-1] in self.stems else "N")]
        # 1) 체언 + 조사 / 체언 + 이다
        noun = None
        for p in COPULA + PARTICLES:
            if len(w) > len(p) and w.endswith(p):
                rest = w[: -len(p)]
                if self._known(rest):
                    return [(rest, "N"), (p, "J")]
                if noun is None and p != "요" and (len(rest) >= 2 or len(p) >= 2 or _agrees(rest, p)):
                    noun = [(rest, "N"), (p, "J")]
        # 2) 용언 + 어미: 어휘에 있는 원형을 먼저 고른다
        splits = _ending_splits(w)
        for stems, e in splits:
            for s in stems:
                for lemma in (s + "다",):
                    if self._known(lemma):
                        return [(lemma, "V"), (e, "E")]
                # 명사 + 하다: "공부해요" → 공부하다 (어휘에 "공부"만 있어도)
                if s.endswith("하") and self._known(s[:-1]):
                    return [(s + "다", "V"), (e, "E")]
        if noun is not None and self._known(noun[0][0]):
            return noun
        strong = [sp for sp in splits if sp[1] in _STRONG_ENDINGS]
        if strong:
            stems, e = strong[0]
            return [(stems[0] + "다", "V"), (e, "E")]
        if noun is not None:
            return noun
        return [(w, "N")]

    def analyze(self, text):
        out = []
        for word in str(text).split():
            out.extend(self.analyze_word(word))
        return out


# 이 어미로 끝나면 어휘에 없어도 용언으로 본다
_STRONG_ENDINGS = {"요", "어요", "아요", "여요", "세요", "으세요", "습니다", "ㅂ니다", "ㅆ어요", "ㅆ습니다", "ㅆ다", "는다", "ㄴ다",
                   "겠어요", "주세요", "어주세요", "아주세요", "고싶어요", "고싶다", "까요", "ㄹ까요", "을까요", "나요", "네요",
                   "지요", "죠", "셨어요", "시죠", "으시죠", "셨나요", "으셨나요", "드릴까요", "려면", "으려면", "ㄹ래요", "을래요", "ㅂ시다", "십시오"}


# ---------------------------------------------------------------- madi

# madipy 0.4.0의 한국어 태그 → 거친 품사 (11-14 엑셀 문장 590종으로 확인한 29종 + 비슷한 이름)
MADI_TAGS = {
    "일반명": "N", "고유명": "N", "의존명": "N", "대명사": "N", "수사": "N", "일반부": "N", "접속부": "N",
    "관형사": "N", "감탄사": "N", "불능": "N",
    "동사": "V", "형용사": "V", "보조용": "V", "부정지": "V",
    "긍정지": "J",  # 서술격 "이다"는 조사처럼 뺀다
    "종결어": "E", "연결어": "E", "선어말": "E", "관형어": "E", "명사형": "E",
    "동접미": "XSV", "형접미": "XSA", "명접미": "XSN", "체접두": "XPN", "접두사": "XPN",
    "숫자": "NUM", "마침": "SF", "쉼표": "X", "묶음": "X",
}


def _coarse(tag):
    """madi 한국어 태그(또는 세종 태그) → 거친 품사."""
    t = str(tag)
    if t in MADI_TAGS:
        return MADI_TAGS[t]
    if t.endswith("조"):
        return "J"
    u = t.upper()  # 세종 계열 (다른 분석기 결과를 주입할 때)
    if u.startswith("NN") or u in ("NP", "NR", "MAG", "MAJ", "MM", "IC", "XR", "SL", "SH"):
        return "N"
    if u in ("VV", "VA", "VX", "VCN"):
        return "V"
    if u == "VCP" or u.startswith("J"):
        return "J"
    if u in ("XSV", "XSA", "XSN", "XPN"):
        return u
    if u.startswith("E"):
        return "E"
    if u == "SN":
        return "NUM"
    if u == "SF":
        return "SF"
    return "X"


def coarse_morphs(pairs):
    """[(form, 태그)] → [(form, 거친 품사)]. 용언은 "-다" 원형, 명사 + 하(동접미) → "명사하다"."""
    out = []
    prefix = None
    for form, tag in pairs:
        c = _coarse(tag)
        if c in ("XSV", "XSA"):
            if out and out[-1][1] == "N":
                out[-1] = (out[-1][0] + form + "다", "V")
            else:
                out.append((form + "다", "V"))
        elif c == "V":
            out.append((form + "다", "V"))
        elif c == "XSN":
            if out and out[-1][1] == "N":
                out[-1] = (out[-1][0] + form, "N")
            else:
                out.append((form, "N"))
        elif c == "XPN":
            prefix = form
            continue
        else:
            if prefix and c == "N":
                form = prefix + form
            out.append((form, c))
        prefix = None
    return out


# 원형 맞추기 (11-15, v5). madi는 문맥에 따라 용언 어간을 분석하지 못하고 "불능"으로 낸다.
#   "여권 있으세요?" → 있으/불능 + 시/선어말 + 어요   (같은 낱말이 "표 있으세요?"에서는 있/형용사 + 으시/선어말)
# 그러면 단위가 원형(있다)이 아니라 조각(있으)이 되어 학습 · 서비스 단위가 어긋난다.
# 고치는 법: "불능" 바로 뒤가 어미(선어말 · 종결어 · 연결어 · 관형어 · 명사형)면 용언 어간으로 본다.
#   1) 그 조각이 든 어절만 madi로 다시 분석해서, 조각의 앞부분인 용언 형태소가 나오면 그것을 쓴다(madi 자신의 원형)
#   2) 그래도 없으면 받침 뒤 매개 모음 "으"를 뗀다 (있으 → 있, 받으 → 받)
_STEM_NEXT = {"선어말", "종결어", "연결어", "관형어", "명사형"}
_VERB_TAGS = {"동사", "형용사", "보조용"}


def _strip_epenthetic(form):
    """받침 뒤 매개 모음 '으' 떼기: 있으 → 있. 아니면 그대로."""
    if len(form) >= 2 and form[-1] == "으" and is_hangul(form[-2]) and final_of(form[-2]):
        return form[:-1]
    return form


def fix_unknown_stems(pairs, text, engine=None):
    """[(form, madi 태그)]에서 어미 앞 "불능" 조각을 용언 어간으로 바꾼다. 돌려주는 것: (새 pairs, 바꾼 개수)."""
    out, n = [], 0
    for k, (f, t) in enumerate(pairs):
        nxt = pairs[k + 1][1] if k + 1 < len(pairs) else None
        if t != "불능" or nxt not in _STEM_NEXT or not f or not all(is_hangul(c) for c in f):
            out.append((f, t))
            continue
        stem, tag = None, "동사"
        if engine is not None:
            for word in str(text).split():
                if f not in word:
                    continue
                again = [(str(a), str(b)) for a, b in engine.pos(word)]
                for a, b in again:
                    if b in _VERB_TAGS and f.startswith(a):
                        stem, tag = a, b
                        break
                if stem is not None:
                    break
        if stem is None:
            stem = _strip_epenthetic(f)
        out.append((stem, tag))
        n += 1
    return out, n


class MadiAnalyzer:
    """madi 감싸기: Analyzer().pos(text) → [(form, 한국어 태그)] → 거친 품사.
    engine을 주면 그것을 쓴다(테스트에서 pos()만 있는 가짜를 넣는다).
    fix_stems=True면 어미 앞 "불능" 조각을 용언 원형으로 맞춘다(fix_unknown_stems). 기본은 끔(예전 학습 파일과 같게)."""

    name = "madi"

    def __init__(self, engine=None, fix_stems=False):
        if engine is None:
            import madi  # noqa: PLC0415 (없을 때 바로 ImportError)

            engine = madi.Analyzer()
        self._m = engine
        self.fix_stems = fix_stems
        self.tag_counts = {}
        self.stems_fixed = 0

    def analyze(self, text):
        pairs = [(str(f), str(t)) for f, t in self._m.pos(text)]
        for _f, t in pairs:
            self.tag_counts[t] = self.tag_counts.get(t, 0) + 1
        if self.fix_stems:
            pairs, n = fix_unknown_stems(pairs, text, self._m)
            self.stems_fixed += n
        return coarse_morphs(pairs)


class FixedAnalyzer:
    """미리 받은 분석 결과: {text: [(form, tag), ...]}. 없는 문장은 fallback으로."""

    name = "fixed"

    def __init__(self, table, fallback=None):
        self.table = {k: [tuple(x) for x in v] for k, v in table.items()}
        self.fallback = fallback

    def analyze(self, text):
        if text in self.table:
            return list(self.table[text])
        if self.fallback is None:
            raise KeyError(text)
        return self.fallback.analyze(text)


def get_analyzer(name="madi", lexicon=(), fix_stems=False):
    """'madi'(기본, 없으면 ImportError) | 'rule' | 'auto'(madi가 있으면 madi, 없으면 rule).
    fix_stems: madi의 어미 앞 "불능" 조각을 원형으로 맞춘다 (v5)."""
    if name in ("madi", "auto"):
        try:
            return MadiAnalyzer(fix_stems=fix_stems)
        except ImportError:
            if name == "madi":
                raise
    if name in ("rule", "auto"):
        return RuleAnalyzer(lexicon)
    raise ValueError(f"unknown analyzer {name!r}")


class CachedAnalyzer:
    """같은 문장은 한 번만 분석한다."""

    def __init__(self, inner):
        self.inner = inner
        self.name = inner.name
        self._cache = {}

    def analyze(self, text):
        if text not in self._cache:
            self._cache[text] = self.inner.analyze(text)
        return list(self._cache[text])
