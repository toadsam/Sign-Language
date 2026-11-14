"""번역기(gen.translate) 시험. 예시 문장과 글로스는 모두 지어낸 것이다."""
import json
import math
import zipfile

import pytest

from gen.translate import Translator, load_translator
from gen.translate import metrics
from gen.translate.align import (build_phrase_table, extract_phrases, grow_diag_final_and, symmetric_alignments,
                                 train_ibm1)
from gen.translate.decode import decode
from gen.translate.lm import BOS, KneserNeyLM
from gen.translate.morph import CachedAnalyzer, FixedAnalyzer, MadiAnalyzer, RuleAnalyzer, _coarse, get_analyzer
from gen.translate.pairs import heldout_ids, pairs_from_rows, read_xlsx_rows, references, split_pairs
from gen.translate.rules import GlossLookup
from gen.translate.translator import build_translator
from gen.translate.units import to_units

# ------------------------------------------------------------------ 지어낸 글로스 표

TABLE = {"schema_version": 2, "glosses": {
    "학교": {"default": "S:학교", "alts": ["W:WORD0001"], "senses": {}},
    "가다": {"default": "S:가다", "alts": [], "senses": {}},
    "오늘": {"default": "S:오늘", "alts": [], "senses": {}},
    "친구": {"default": "W:WORD0002", "alts": [], "senses": {}},
    "만나다": {"default": "S:만나다", "alts": [], "senses": {}},
    "무엇": {"default": "S:무엇", "alts": [], "senses": {}},
    "공부": {"default": "S:공부", "alts": [], "senses": {}},
    "거지1": {"default": "W:WORD0010", "alts": [], "senses": {}},
    "거지2": {"default": "W:WORD0011", "alts": [], "senses": {}},
    "기타": {"default": "W:WORD0030", "alts": ["W:WORD0031"],
             "senses": {"W:WORD0030": "그 밖의", "W:WORD0031": "악기"}},
    "치다": {"default": "W:WORD0040", "alts": [], "senses": {}},
}}

TRAIN = [
    {"korean": "오늘 학교에 가요", "gloss": ["오늘", "학교", "가다"]},
    {"korean": "학교에 가요", "gloss": ["학교", "가다"]},
    {"korean": "친구를 만나요", "gloss": ["친구", "만나다"]},
    {"korean": "오늘 친구를 만나요", "gloss": ["오늘", "친구", "만나다"]},
    {"korean": "무엇을 공부해요?", "gloss": ["공부", "무엇"]},
    {"korean": "오늘 무엇을 공부해요?", "gloss": ["오늘", "공부", "무엇"]},
]


# ------------------------------------------------------------------ 형태소 · 단위

def test_rule_analyzer_basic_forms():
    a = RuleAnalyzer(["학교", "가다", "먹다", "공부", "덥다"])
    assert a.analyze("학교에 갔어요?") == [("학교", "N"), ("에", "J"), ("가다", "V"), ("ㅆ어요", "E"), ("?", "SF")]
    assert a.analyze("밥을 먹어요")[:2] == [("밥", "N"), ("을", "J")]
    assert a.analyze("공부해요")[0] == ("공부하다", "V")
    assert a.analyze("더워요")[0] == ("덥다", "V")
    assert a.analyze("3층")[0] == ("3", "NUM")


def test_fixed_and_cached_analyzer():
    fixed = FixedAnalyzer({"가": [["가다", "V"]]}, fallback=RuleAnalyzer())
    c = CachedAnalyzer(fixed)
    assert c.analyze("가") == [("가다", "V")]
    assert c.analyze("학교") == [("학교", "N")]
    with pytest.raises(KeyError):
        FixedAnalyzer({}).analyze("없음")


def test_get_analyzer_falls_back_without_madi():
    try:
        import madi  # noqa: F401
    except ImportError:
        assert get_analyzer("auto").name == "rule"
        with pytest.raises(ImportError):
            get_analyzer("madi")
    else:
        assert get_analyzer().name == "madi"  # 기본은 madi
    assert get_analyzer("rule").name == "rule"


def test_coarse_tags():
    assert [_coarse(t) for t in ("NNG", "VV", "JKS", "EF", "SN", "SF", "VCP")] == ["N", "V", "J", "E", "NUM", "SF", "J"]
    assert [_coarse(t) for t in ("일반명", "동사", "주격조", "종결어", "숫자", "마침", "긍정지", "묶음", "관형격조")] == \
        ["N", "V", "J", "E", "NUM", "SF", "J", "X", "J"]


class _FakeMadi:
    """madi.Analyzer().pos()의 모양만 흉내 낸다 (지어낸 분석 결과)."""

    TABLE = {
        "공부해요?": [("공부", "일반명"), ("하", "동접미"), ("아요", "종결어"), ("?", "마침")],
        "학교(본관)에 갔어요": [("학교", "일반명"), ("(", "묶음"), ("본관", "일반명"), (")", "묶음"), ("에", "부사조"),
                         ("가", "동사"), ("았", "선어말"), ("어요", "종결어")],
        "학생이에요": [("학생", "일반명"), ("이", "긍정지"), ("에요", "종결어")],
    }

    def pos(self, text):
        return self.TABLE[text]


def test_madi_analyzer_with_injected_engine():
    a = MadiAnalyzer(engine=_FakeMadi())
    assert a.analyze("공부해요?") == [("공부하다", "V"), ("아요", "E"), ("?", "SF")]
    m = a.analyze("학교(본관)에 갔어요")
    assert to_units(m, keep_endings=False)[0] == ["학교", "본관", "가다"]
    assert to_units(a.analyze("학생이에요"), keep_endings=False) == (["학생"], ["이", "에요"])
    assert a.tag_counts["일반명"] == 4


def test_units_keep_and_drop():
    m = [("학교", "N"), ("에", "J"), ("가다", "V"), ("어요", "E"), ("?", "SF"), (".", "SF")]
    assert to_units(m) == (["학교", "가다", "~어요", "?"], ["에"])
    assert to_units(m, keep_endings=False) == (["학교", "가다", "?"], ["에", "어요"])


# ------------------------------------------------------------------ 규칙 B0

def test_gloss_lookup_order():
    lk = GlossLookup(TABLE["glosses"])
    assert lk.lookup("학교") == "학교"
    assert lk.lookup("공부하다") == "공부"        # -하다 떼기
    assert lk.lookup("거지") == "거지1"           # 숫자 이름, 가장 작은 번호
    assert lk.lookup("만나 다") == "만나다"        # 띄어쓰기 제거
    assert lk.lookup("없는말") is None


# ------------------------------------------------------------------ 정렬 · 구 · LM

def test_ibm1_learns_obvious_pairs():
    pairs = [(["a", "b"], ["A", "B"]), (["a"], ["A"]), (["b", "c"], ["B", "C"]), (["c"], ["C"])]
    t = train_ibm1(pairs, iters=10)
    assert t[("a", "A")] > t[("a", "B")]
    assert t[("c", "C")] > t[("c", "B")]


def test_grow_diag_final_and():
    fwd = {(0, 0), (1, 1)}
    bwd = {(0, 0), (1, 1), (1, 2)}
    a = grow_diag_final_and(fwd, bwd, 2, 3)
    assert {(0, 0), (1, 1), (1, 2)} <= a


def test_extract_phrases_consistent_and_null():
    src, tgt = ["x", "y", "z"], ["X", "Y"]
    links = {(0, 0), (1, 1)}  # z는 정렬 없음 → 생략 후보
    ph = extract_phrases(src, tgt, links)
    assert (("x",), ("X",)) in ph and (("x", "y"), ("X", "Y")) in ph
    assert (("z",), ()) in ph
    assert (("y",), ("X",)) not in ph


def test_phrase_table_probs():
    pairs = [(["a"], ["A"]), (["a"], ["A"]), (["a"], ["B"])]
    al, _, _ = symmetric_alignments(pairs)
    pt = build_phrase_table(pairs, al)
    best = pt[("a",)][0]
    assert best[0] == ("A",) and math.isclose(math.exp(best[1]), 2 / 3)


def test_kn_lm_normalized():
    lm = KneserNeyLM().fit([["A", "B"], ["A", "C"], ["B", "C", "A"]])
    vocab = ["A", "B", "C", "</s>"]
    for ctx in [(BOS, BOS), (BOS, "A"), ("A", "B"), ("Z", "Q")]:
        total = sum(lm.prob(ctx[0], ctx[1], w) for w in vocab)
        assert total <= 1.0 + 1e-9 and total > 0.9 or ctx == ("Z", "Q")
    lm2 = KneserNeyLM.from_json(json.loads(json.dumps(lm.to_json())))
    assert math.isclose(lm2.score(["A", "B"]), lm.score(["A", "B"]))


def test_decode_prefers_phrase_and_reports_oov():
    pt = {("오늘",): [(("오늘",), 0.0, 0.0, 3)], ("가다",): [(("가다",), 0.0, 0.0, 3)]}
    lm = KneserNeyLM().fit([["오늘", "가다"]])
    gl, path = decode(["오늘", "모름", "가다", "~어요"], pt, lm, lookup=lambda u: None)
    assert gl == ["오늘", "가다"]
    kinds = {tuple(p[0:2]): p[3] for p in path}
    assert kinds[(1, 2)] == "oov" and kinds[(3, 4)] == "drop"


# ------------------------------------------------------------------ 채점

def test_metrics_worked_example():
    s = metrics.sentence_stats(["오늘1", "비내리다1", "비내리다1", "조심1"], ["오늘1", "밤1", "비내리다1", "많다1"])
    r = metrics.aggregate([s])
    assert s["tp"] == 2 and math.isclose(r["f1"], 0.5) and math.isclose(r["precision"], 0.5)


def test_semantic_matcher_rules():
    m = metrics.Matcher(units={"가다": "S:가다", "가다2": "S:가다", "오다": "S:오다", "없음": None, "없음2": None},
                        synonyms={"학교": ["학원"], "학원": [], "병원": ["의원"], "의원": ["의사당"]})
    assert m.same("가다", "가다2")             # 같은 동작 단위
    assert not m.same("가다", "오다")
    assert not m.same("없음", "없음2")          # 단위가 None끼리는 같다고 치지 않는다
    assert m.same("학교", "학원") and m.same("학원", "학교")   # 동의어는 어느 쪽 목록이든
    assert not m.same("병원", "의사당")         # 한 단계만 (이어 가지 않는다)
    s = metrics.sentence_stats(["학원", "가다2"], [["학교", "가다"]], m)
    assert s["tp"] == 2 and s["edits"] == 0 and s["exact"]
    assert metrics.sentence_stats(["가다2", "학원"], [["학교", "가다"]], m)["edits"] == 2  # 순서는 본다
    assert metrics.sentence_stats(["가다2", "학원"], [["학교", "가다"]])["tp"] == 0  # 판정기 없으면 이름만


def test_overlap_matching_is_maximal():
    m = metrics.Matcher(units={"A": "u1", "B": "u1", "C": "u2"})
    # 탐욕적으로 A-A를 먼저 잡아도 B가 남은 A 자리에 갈 수 없으면 최대 매칭이 다시 짝을 바꾼다
    assert metrics.overlap(["A", "B"], ["B", "A"], m) == 2
    assert metrics.overlap(["A", "A", "C"], ["B", "C"], m) == 2


def test_human_baseline_leave_one_out():
    groups = [[["A", "B"], ["A", "C"]], [["X"]]]  # 두 번째는 번역이 하나라 빠진다
    hb = metrics.human_baseline(groups, metrics.Matcher(units={"B": "u", "C": "u"}))
    assert hb["groups"] == 1
    assert math.isclose(hb["single"]["f1"], 0.5) and math.isclose(hb["multi"]["f1"], 0.5)
    assert hb["semantic"]["f1"] == 1.0


def test_all_references_gathers_every_split():
    from gen.translate.evaluate import all_references, human_groups

    allp = [{"korean": "가", "gloss": ["A"]}, {"korean": "가", "gloss": ["B"]}, {"korean": "가", "gloss": ["A"]},
            {"korean": "나", "gloss": ["C"]}]
    assert all_references([allp[1]], allp) == [[["B"], ["A"]]]
    assert human_groups(allp) == [[["A"], ["B"]]]
    assert human_groups(allp, {"나"}) == []


def test_judge_page_pick_and_render():
    from gen.translate.judge_page import build_items, pick, render

    test = [{"id": f"SEN{i:04d}", "korean": "오늘 학교에 가요", "gloss": ["오늘", "학교", "가다"]} for i in range(10)]
    a, b = pick(test, 4, seed=1), pick(list(reversed(test)), 4, seed=1)
    assert [p["id"] for p in a] == [p["id"] for p in b] and len(a) == 4   # 입력 순서와 상관없이 같은 문장
    items = build_items(_translator(), a[:1], test + [{"korean": "오늘 학교에 가요", "gloss": ["학교", "가다"]}])
    assert items[0]["pred"] == ["오늘", "학교", "가다"] and items[0]["other_refs"] == [["학교", "가다"]]
    items[0]["korean"] = "</script><b>"  # 데이터 안의 태그가 페이지를 깨지 않게
    page = render(items, "x/model.json", 1)
    assert "<\\/script><b>" in page and page.count("</script>") == 2
    assert "localStorage" in page and "try {" in page and "http" not in page.split("<body>")[1]


def test_metrics_edges():
    assert metrics.aggregate([metrics.sentence_stats([], ["A"])])["f1"] == 0.0
    r = metrics.aggregate([metrics.sentence_stats(["A", "B"], ["A", "B"])])
    assert r["f1"] == 1.0 and r["wer"] == 0.0 and r["exact"] == 1.0
    best = metrics.sentence_stats(["A", "B"], [["C"], ["B", "A"]])
    assert best["tp"] == 2 and not best["exact"]
    assert metrics.normalize(["먹다1#", " ", "가다"]) == ["먹다1", "가다"]
    assert metrics.edit_distance(["A", "B", "C"], ["A", "C"]) == 1
    assert metrics.drawable_ratio([["S:a", None], ["W:b"]]) == pytest.approx(2 / 3)


# ------------------------------------------------------------------ 엑셀 · 나누기

def _write_xlsx(path, rows):
    shared = []

    def sidx(s):
        if s not in shared:
            shared.append(s)
        return shared.index(s)

    cells = []
    for r, row in enumerate(rows, 1):
        cs = []
        for c, v in enumerate(row):
            ref = chr(65 + c) + str(r)
            if v is None:
                continue
            if isinstance(v, int):
                cs.append(f'<c r="{ref}"><v>{v}</v></c>')
            else:
                cs.append(f'<c r="{ref}" t="s"><v>{sidx(v)}</v></c>')
        cells.append(f'<row r="{r}">{"".join(cs)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns}><sheets><sheet name="s" sheetId="1"/></sheets></workbook>')
        z.writestr("xl/worksheets/sheet1.xml", f'<worksheet {ns}><sheetData>{"".join(cells)}</sheetData></worksheet>')
        z.writestr("xl/sharedStrings.xml",
                   f'<sst {ns}>' + "".join(f"<si><t>{s}</t></si>" for s in shared) + "</sst>")


def test_read_xlsx_and_pairs(tmp_path):
    p = tmp_path / "x.xlsx"
    _write_xlsx(p, [["영상 번호", "한국어 번역", "형태소 개수", "한국수어 형태소"],
                    ["1", "오늘 가요", 2, "오늘", "가다"],
                    ["2", "학교", 1, "학교 "]])
    pairs = pairs_from_rows(read_xlsx_rows(p))
    assert pairs == [{"id": "SEN0001", "korean": "오늘 가요", "gloss": ["오늘", "가다"]},
                     {"id": "SEN0002", "korean": "학교", "gloss": ["학교"]}]


def test_split_rules():
    pairs = [{"id": f"SEN{i:04d}", "korean": k, "gloss": g} for i, (k, g) in enumerate(
        [("가", ["A"]), ("나", ["B"]), ("다", ["C", "D"]), ("가", ["A", "B"]), ("라", ["E"])], 1)]
    held = {"items": ["SEN0001"], "question_items": [], "sequences": [["C", "D"]]}
    assert heldout_ids(pairs, held) == {"SEN0001", "SEN0003"}
    parts = split_pairs(pairs, held, ["SEN0002"])
    assert [p["id"] for p in parts["train"]] == ["SEN0004", "SEN0005"]
    strict = split_pairs(pairs, held, ["SEN0002"], strict=True)
    assert [p["id"] for p in strict["train"]] == ["SEN0005"]  # 같은 한국어 "가"도 뺀다
    assert references(parts["test"]) == [[["A"]], [["C", "D"]]]


# ------------------------------------------------------------------ Translator

def _translator():
    return build_translator(TRAIN, TABLE, config={"analyzer": "rule"})


def test_translate_contract_shape():
    t = _translator()
    out = t.translate("오늘 학교에 가요")
    assert set(out) == {"gloss", "units", "senses", "unknown", "dropped", "substituted"}
    assert out["substituted"] == []
    assert out["gloss"] == ["오늘", "학교", "가다"]
    assert out["units"] == ["S:오늘", "S:학교", "S:가다"]
    assert len(out["units"]) == len(out["gloss"]) == len(out["senses"])
    assert "에" in out["dropped"]


def test_translate_reorders_by_phrase_and_unknown():
    t = _translator()
    out = t.translate("무엇을 공부해요?")
    assert out["gloss"] == ["공부", "무엇"]
    out = t.translate("오늘 우주선을 만나요")
    assert out["unknown"] == ["우주선"] and out["gloss"] == ["오늘", "만나다"]


def test_rules_mode_is_b0():
    t = _translator()
    out = t.translate("오늘 학교에 가요", mode="rules")
    assert out["gloss"] == ["오늘", "학교", "가다"]
    out = t.translate("거지가 와요", mode="rules")
    assert out["gloss"][0] == "거지1" and out["units"][0] == "W:WORD0010"


def test_homonym_sense_only_when_marked():
    t = Translator(TABLE["glosses"], analyzer=RuleAnalyzer(TABLE["glosses"]))
    out = t.translate("악기 기타를 쳐요", mode="rules")
    i = out["gloss"].index("기타")
    assert out["senses"][i] == "악기" and out["units"][i] == "W:WORD0031"
    out = t.translate("기타", mode="rules")
    assert out["senses"] == [None] and out["units"] == ["W:WORD0030"]


def test_snow_eye_homonym_cues():
    glosses = {"눈": {"default": "W:WORD0005", "alts": ["W:WORD1372"],
                     "senses": {"W:WORD0005": "내리는 눈", "W:WORD1372": "보는 눈"}},
               "오다": {"default": "S:오다", "alts": [], "senses": {}},
               "아프다": {"default": "S:아프다", "alts": [], "senses": {}}}
    t = Translator(glosses, analyzer=RuleAnalyzer(glosses))
    out = t.translate("눈이 와요", mode="rules")
    assert out["gloss"][0] == "눈" and out["senses"][0] == "내리는 눈" and out["units"][0] == "W:WORD0005"
    out = t.translate("눈이 아파요", mode="rules")
    assert out["senses"][0] == "보는 눈" and out["units"][0] == "W:WORD1372"
    out = t.translate("눈", mode="rules")
    assert out["senses"] == [None] and out["units"] == ["W:WORD0005"]
    out = t.translate("눈이 와서 눈이 아파요", mode="rules")  # 단서가 둘 다면 기본값
    assert out["senses"][0] is None and out["units"][0] == "W:WORD0005"


def test_save_and_load_roundtrip(tmp_path):
    t = _translator()
    path = tmp_path / "tr.json"
    t.save(path)
    with pytest.raises(FileExistsError):
        t.save(path)
    t2 = load_translator(str(path))
    for text in ("오늘 학교에 가요", "무엇을 공부해요?", "친구를 만나요"):
        assert t2.translate(text) == t.translate(text)
    assert t2.config["analyzer"] == "rule"
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError):
        load_translator(str(bad))


def test_tune_and_evaluate_on_toy_data():
    from gen.translate.evaluate import evaluate
    from gen.translate.train import objective, tune

    t = _translator()
    val = [{"korean": "오늘 학교에 가요", "gloss": ["오늘", "학교", "가다"]},
           {"korean": "친구를 만나요", "gloss": ["친구", "만나다"]}]
    before, _ = objective(t, val)
    after = tune(t, val, rounds=1, grid={"lm": [0.0, 1.0], "drop": [-4.0]}, log=lambda *_: None)
    assert after >= before
    row, outs = evaluate(t, val, n_boot=20)
    assert row["n"] == 2 and row["f1"] == 1.0 and row["drawable"] == 1.0 and len(outs) == 2
    assert {"f1_lo", "f1_hi", "ms_per_sent", "unknown_per_sent"} <= set(row)


# ------------------------------------------------------------------ 재현율 개선: 내용어 지키기 · 합성어 · 동의어

def test_content_drop_min_removes_unsure_drop():
    from gen.translate.decode import span_candidates

    pt = {("오늘",): [((), math.log(0.6), 0.0, 6), (("오늘",), math.log(0.4), 0.0, 4)]}
    keep = span_candidates(["오늘"], 0, 1, pt, None)
    assert any(t == () and k == "phrase" for t, k, _ in keep)
    strict = span_candidates(["오늘"], 0, 1, pt, None, content_drop_min=0.8)
    assert not any(k == "phrase" and t == () for t, k, _ in strict)
    assert any(k == "drop" for _t, k, _ in strict)  # 벌점 있는 버림은 남는다


def test_shrink_feature_counts_lost_content():
    from gen.translate.decode import span_candidates

    pt = {("학교", "가다"): [(("가다",), 0.0, 0.0, 3)], ("~요",): [((), 0.0, 0.0, 3)]}
    (tgt, kind, feats), = span_candidates(["학교", "가다"], 0, 2, pt, None)
    assert feats["shrink"] == 1
    (_t, _k, f2), = span_candidates(["~요"], 0, 1, pt, None)
    assert f2["shrink"] == 0  # 어미 생략은 줄임이 아니다


def test_compound_split_lookup():
    lk = GlossLookup({"지하철": 1, "출구": 1, "가다": 1})
    assert lk.split("지하철출구") == ("지하철", "출구")
    assert lk.split("지하철") is None or lk.lookup("지하철") == "지하철"
    assert lk.split("모르는말") is None and lk.split("가다가다") is None


def test_synonym_table_and_substituted():
    from gen.translate.synonyms import SynonymTable, invert, load_synonyms

    by_gloss = {"학교": ["학원^1", "학교"], "친구": ["벗", "동무"], "만나다": ["보다"], "가다": ["동무"]}
    m = invert(by_gloss, set(TABLE["glosses"]))
    assert m["학원"] == ["학교"] and "학교" not in m and "보다" in m
    st = SynonymTable(m)
    assert st.lookup("학원") == "학교" and st.lookup("동무") is None  # 후보가 둘이면 바꾸지 않는다
    t = build_translator(TRAIN, TABLE, config={"analyzer": "rule", "use_synonyms": True}, synonyms=m)
    out = t.translate("벗을 만나요")
    assert out["gloss"] == ["친구", "만나다"]
    assert out["substituted"] == [{"from": "벗", "to": "친구", "how": "synonym"}]
    out = t.translate("벗을 만나요", mode="rules")
    assert out["substituted"][0]["to"] == "친구"
    off = build_translator(TRAIN, TABLE, config={"analyzer": "rule"}, synonyms=m)
    assert off.translate("벗을 만나요")["unknown"] == ["벗"]
    assert load_synonyms("없는/파일.json") is None


def test_synonym_saved_with_translator(tmp_path):
    t = build_translator(TRAIN, TABLE, config={"analyzer": "rule", "use_synonyms": True}, synonyms={"벗": ["친구"]})
    t.save(tmp_path / "s.json")
    t2 = load_translator(str(tmp_path / "s.json"))
    assert t2.translate("벗을 만나요")["substituted"][0]["to"] == "친구"
    # 동의어 없이 학습한 파일에 나중에 동의어 표만 붙이기
    plain = build_translator(TRAIN, TABLE, config={"analyzer": "rule"})
    plain.save(tmp_path / "p.json")
    (tmp_path / "syn.json").write_text(json.dumps({"schema": "synonyms_v1", "map": {"벗": ["친구"]}}), encoding="utf-8")
    assert load_translator(str(tmp_path / "p.json")).translate("벗을 만나요")["substituted"] == []
    t3 = load_translator(str(tmp_path / "p.json"), synonyms=str(tmp_path / "syn.json"))
    assert t3.translate("벗을 만나요")["gloss"] == ["친구", "만나다"]
    assert load_translator(str(tmp_path / "p.json"), synonyms=str(tmp_path / "none.json")).synonyms is None


def test_synonym_fetch_parsers_with_fake_api():
    from gen.translate.synonyms import SEARCH_URL, build, parse_similar, parse_target_codes

    # 11-14 실제로 확인한 모양 (값은 지어낸 것)
    search = {"channel": {"item": [{"word": "학교", "sense": [{"target_code": "11", "pos": "명사"}]},
                                   {"word": "학교장", "sense": [{"target_code": "12"}]}]}}
    view = {"channel": {"item": {"senseInfo": {"relation_info": [{"word": "학원002", "type": "비슷한말"},
                                                                  {"word": "교실", "type": "참고어"}],
                                               "proverb_info": [{"word": "학교 가다", "type": "관용구"}]}}}}
    assert parse_target_codes(search, "학교") == ["11"]
    assert parse_similar(view) == ["학원"]
    sent = []

    def fake_get(url, params):
        sent.append(params["q"])
        return search if url == SEARCH_URL else view

    obj = build({"학교": {}, "W1": {}}, "KEY", get=fake_get, sleep=0, log=lambda *_: None)
    assert obj["map"] == {"학원": ["학교"]} and obj["queried"] == 1
    assert sent == ["학교", "11"]  # 보내는 것은 글로스 이름과 사전 번호뿐
