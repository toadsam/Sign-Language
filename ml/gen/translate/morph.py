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
  MadiAnalyzer     madi(`pip install madipy`, import madi). 세종 계열 태그를 위 품사로 줄인다.
                   **실제 태그 이름은 아직 돌려 확인하지 못했다** (11-14 설치 권한이 막힘). 첫 실행 때 tag_counts로 확인할 것.
  RuleAnalyzer     madi가 없을 때 쓰는 규칙 분석기. 어절마다 조사·어미를 뒤에서 떼고, 어휘 목록(글로스 이름)에
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
COPULA = sorted("이에요 예요 입니다 이다 이야 이었어요 였어요 이었다 였다 인데 이고 이지만 이라서 라서 이면".split(),
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
                   "지요", "죠", "셨어요", "ㄹ래요", "을래요", "ㅂ시다", "십시오"}


# ---------------------------------------------------------------- madi

def _coarse(tag):
    t = str(tag).upper()
    if t.startswith("NN") or t in ("NP", "NR", "MAG", "MAJ", "MM", "IC", "XR", "SL", "SH"):
        return "N"
    if t in ("VV", "VA", "VX", "VCN"):
        return "V"
    if t == "VCP":
        return "J"  # 서술격 조사 "이다"는 조사처럼 뺀다
    if t.startswith("J"):
        return "J"
    if t.startswith("E") or t in ("XSV", "XSA", "XSN", "XPN"):
        return "E" if t.startswith("E") else t
    if t == "SN":
        return "NUM"
    if t == "SF" or t.startswith("S"):
        return "SF"
    return "X"


class MadiAnalyzer:
    """madi 감싸기. 태그 이름은 세종 계열이라고 가정했다(확인 필요)."""

    name = "madi"

    def __init__(self):
        import madi  # noqa: PLC0415 (없을 때 바로 ImportError)

        self._m = madi.Analyzer()
        self.tag_counts = {}

    @staticmethod
    def _pairs(raw):
        for item in raw:
            if isinstance(item, (tuple, list)) and len(item) >= 2:
                yield str(item[0]), str(item[1])
            else:
                form = getattr(item, "form", None) or getattr(item, "surface", None)
                tag = getattr(item, "tag", None) or getattr(item, "pos", None)
                if form is not None and tag is not None:
                    yield str(form), str(tag)

    def analyze(self, text):
        out = []
        prev = None
        for form, tag in self._pairs(self._m.pos(text)):
            self.tag_counts[tag] = self.tag_counts.get(tag, 0) + 1
            c = _coarse(tag)
            if c in ("XSV", "XSA"):  # 명사 + 하다 → "명사하다"
                if out and out[-1][1] == "N":
                    out[-1] = (out[-1][0] + form + "다", "V")
                else:
                    out.append((form + "다", "V"))
            elif c == "V":
                out.append((form if form.endswith("다") else form + "다", "V"))
            elif c == "XSN":
                if out and out[-1][1] == "N":
                    out[-1] = (out[-1][0] + form, "N")
            elif c == "XPN":
                prev = form
                continue
            else:
                if prev and c == "N":
                    form = prev + form
                out.append((form, c))
            prev = None
        return out


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


def get_analyzer(name="auto", lexicon=()):
    """'madi' | 'rule' | 'auto'(madi가 있으면 madi)."""
    if name in ("madi", "auto"):
        try:
            return MadiAnalyzer()
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
