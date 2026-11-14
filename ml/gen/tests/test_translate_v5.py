"""번역기 v5 (원형 맞추기, 대체어 표) 시험. 예시 문장 · 분석 결과 · 글로스는 모두 지어낸 것이다."""
import json

from gen.translate import load_translator
from gen.translate.morph import MadiAnalyzer, _strip_epenthetic, fix_unknown_stems
from gen.translate.rules import GlossLookup
from gen.translate.subst import SubstTable, build_subst, eojeols, load_subst, save_subst, spans
from gen.translate.translator import build_translator
from gen.translate.units import to_units


class _FakeMadi:
    """문맥에 따라 어간을 '불능'으로 내는 madi 흉내 (지어낸 분석 결과)."""

    TABLE = {
        "여권 있으세요?": [("여권", "일반명"), ("있으", "불능"), ("시", "선어말"), ("어요", "종결어"), ("?", "마침")],
        "있으세요?": [("있", "형용사"), ("으시", "선어말"), ("어요", "종결어"), ("?", "마침")],
        "표 있으세요?": [("표", "일반명"), ("있", "형용사"), ("으시", "선어말"), ("어요", "종결어"), ("?", "마침")],
        "책 받으세요": [("책", "일반명"), ("받으", "불능"), ("시", "선어말"), ("어요", "종결어")],
        "받으세요": [("받으", "불능"), ("시", "선어말"), ("어요", "종결어")],  # 다시 분석해도 못 하는 경우
        "제 표": [("제", "불능"), ("표", "일반명")],
    }

    def pos(self, text):
        return self.TABLE[text]


# ------------------------------------------------------------------ 원형 맞추기

def test_strip_epenthetic():
    assert _strip_epenthetic("있으") == "있"
    assert _strip_epenthetic("받으") == "받"
    assert _strip_epenthetic("크") == "크"
    assert _strip_epenthetic("으") == "으"
    assert _strip_epenthetic("가으") == "가으"  # 앞 글자에 받침이 없으면 매개 모음이 아니다


def test_fix_unknown_stems_uses_madi_reanalysis_then_rule():
    eng = _FakeMadi()
    pairs, n = fix_unknown_stems(eng.TABLE["여권 있으세요?"], "여권 있으세요?", eng)
    assert n == 1 and pairs[1] == ("있", "형용사")  # 어절만 다시 분석한 madi 결과
    pairs, n = fix_unknown_stems(eng.TABLE["책 받으세요"], "책 받으세요", eng)
    assert n == 1 and pairs[1] == ("받", "동사")  # 다시 분석해도 불능이면 매개 모음 떼기
    pairs, n = fix_unknown_stems(eng.TABLE["제 표"], "제 표", eng)
    assert n == 0 and pairs == eng.TABLE["제 표"]  # 뒤가 어미가 아니면 그대로


def test_madi_analyzer_fix_stems_makes_units_consistent():
    old = MadiAnalyzer(engine=_FakeMadi())
    new = MadiAnalyzer(engine=_FakeMadi(), fix_stems=True)
    assert to_units(old.analyze("여권 있으세요?"), False)[0] == ["여권", "있으", "?"]  # 예전 동작 그대로
    assert to_units(new.analyze("여권 있으세요?"), False)[0] == ["여권", "있다", "?"]
    assert to_units(new.analyze("표 있으세요?"), False)[0] == ["표", "있다", "?"]
    assert new.stems_fixed == 1


# ------------------------------------------------------------------ 대체어 표

GLOSSES = {n: {"default": f"S:{n}", "alts": [], "senses": {}} for n in ("신분증", "있다", "카페", "가다", "시간", "걸리다")}
TABLE = {"glosses": GLOSSES}


def test_eojeols_and_spans():
    assert eojeols("(주민등록증) 있어요?") == ["주민등록증", "있어요?"]
    sp = spans(["주민", "등록증", "있다", "?"], "주민등록증이 있어요?")
    keys = {k for _i, _j, k in sp}
    assert "주민등록증" in keys and "주민" in keys
    assert "등록증있다" not in keys  # 한 어절 안에 없는 것은 붙이지 않는다
    assert all(k != "?" for k in keys)


def test_subst_apply_longest_first_and_eojeol_rule():
    st = SubstTable({"주민등록증": "신분증", "주민": "가다", "커피숍": "카페"})
    for text in ("주민등록증 있으세요?", "(주민등록증) 있으세요?", "주민등록증이 있으세요?"):
        units, subst = st.apply(["주민", "등록증", "있다", "?"], text)
        assert units == ["신분증", "있다", "?"]
        assert subst == [{"from": "주민등록증", "to": "신분증", "how": "subst"}]
    # 띄어 쓴 두 어절은 합성어가 아니다: 한 단위 키만 바뀐다
    units, subst = st.apply(["주민", "등록증"], "주민 등록증")
    assert units == ["가다", "등록증"] and len(subst) == 1
    assert st.apply(["~어요", "커피숍"], "커피숍")[0] == ["~어요", "카페"]
    assert SubstTable({}).apply(["a"], "a") == (["a"], [])


def test_build_subst_thresholds_and_filters():
    lookup = GlossLookup(GLOSSES).lookup
    ex, al = [], []

    def add(units, gloss, text, links):
        ex.append((units, gloss, text))
        al.append(set(links))

    # 주민등록증 → 신분증: 서로 다른 문장 2개, 3번
    add(["주민", "등록증", "있다"], ["신분증"], "주민등록증 있어요", [(1, 0)])
    add(["주민", "등록증", "있다"], ["신분증"], "주민등록증 있어요", [(0, 0), (1, 0)])
    add(["주민", "등록증"], ["신분증"], "주민등록증이요", [(1, 0)])
    # 커피숍 → 카페: 한 문장뿐이라 넣지 않는다
    add(["커피숍", "가다"], ["카페", "가다"], "커피숍 가요", [(0, 0), (1, 1)])
    add(["커피숍", "가다"], ["카페", "가다"], "커피숍 가요", [(0, 0), (1, 1)])
    # 많이 → 시간: 같은 문장의 "시간" 단위가 규칙으로 내는 글로스라 "많이" 몫이 아니다
    add(["시간", "많이", "걸리다"], ["시간", "걸리다"], "시간 많이 걸려요", [(1, 0), (2, 1)])
    add(["시간", "많이", "걸리다"], ["시간", "걸리다"], "시간이 많이 걸려", [(1, 0), (2, 1)])
    # 숫자 키는 넣지 않는다
    add(["2", "가다"], ["카페", "가다"], "2 가요", [(0, 0), (1, 1)])
    add(["2", "가다"], ["카페", "가다"], "2 가", [(0, 0), (1, 1)])
    stats = {}
    st = build_subst(ex, al, lookup, stats=stats)
    assert st.map["주민등록증"] == "신분증"
    assert "커피숍" not in st.map and "많이" not in st.map and "2" not in st.map
    assert "있다" not in st.map  # 표에서 찾아지는 말
    assert stats["subst_entries"] == len(st)
    loose = build_subst(ex, al, lookup, min_count=1)
    assert loose.map.get("커피숍") == "카페"


def test_subst_save_load(tmp_path):
    st = SubstTable({"커피숍": "카페"})
    save_subst(st, tmp_path / "s.json")
    assert load_subst(str(tmp_path / "s.json")).map == {"커피숍": "카페"}
    assert load_subst(str(tmp_path / "none.json")) is None


# ------------------------------------------------------------------ Translator

TRAIN = [
    {"korean": "커피숍", "gloss": ["카페"]},
    {"korean": "커피숍이요", "gloss": ["카페"]},
    {"korean": "커피숍에 가요", "gloss": ["카페", "가다"]},
    {"korean": "시간 걸려요", "gloss": ["시간", "걸리다"]},
]


def test_translator_subst_roundtrip_and_backward_compat(tmp_path):
    t = build_translator(TRAIN, TABLE, config={"analyzer": "rule", "keep_endings": False, "use_subst": True})
    assert t.subst.map == {"커피숍": "카페"} and t.info["subst_entries"] == 1
    out = t.translate("커피숍에서 기다려요")
    assert out["gloss"][0] == "카페"
    assert {"from": "커피숍", "to": "카페", "how": "subst"} in out["substituted"]
    assert t.translate("커피숍", mode="rules")["substituted"][0]["how"] == "subst"
    t.save(tmp_path / "v5.json")
    t2 = load_translator(str(tmp_path / "v5.json"))
    assert t2.subst.map == t.subst.map and t2.translate("커피숍에서 기다려요") == out
    # 예전 파일 (subst · lemma_fix 키 없음)은 예전처럼: 대체어 없음
    old = build_translator(TRAIN, TABLE, config={"analyzer": "rule", "keep_endings": False})
    obj = old.to_json()
    obj.pop("subst")
    for k in ("lemma_fix", "use_subst", "subst_min_count", "subst_min_share", "subst_min_keep"):
        obj["config"].pop(k)
    (tmp_path / "v4.json").write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    t3 = load_translator(str(tmp_path / "v4.json"))
    assert t3.subst is None and t3.config["use_subst"] is False and t3.config["lemma_fix"] is False
    assert t3.translate("커피숍에서 기다려요")["substituted"] == []
    # 대체어 표를 직접 줄 수도 있다
    t4 = build_translator(TRAIN, TABLE, config={"analyzer": "rule", "keep_endings": False, "use_subst": True}, subst={"커피": "카페"})
    assert t4.subst.map == {"커피": "카페"}
