"""Translator: 한국어 문장 → 글로스 열 (공유 인터페이스).

    t = load_translator(".local/translate/translator_v1.json")
    t.translate("...") ->
      {"gloss":   [글로스 이름, ...],          글로스 표의 glosses 키
       "units":   ["S:..." | "W:..." | None],  같은 길이, 표에 없으면 None
       "senses":  [None | 뜻, ...],            동음이의어 뜻을 골랐을 때만
       "unknown": [한국어 조각, ...],          동작을 못 찾은 내용어
       "dropped": [한국어 조각, ...],         일부러 뺀 조사 · 어미 · 생략
       "substituted": [{"from": 원형, "to": 글로스 이름, "how": "synonym"|"split"|"join"}, ...]}
                                                표에 없는 말을 동의어 · 합성어 나누기 · 이웃 단위 붙이기로 찾은 것
                                                (사람 검토용, 11-14 추가. join의 from은 붙인 단위들을 띄어 쓴 것)

학습 결과는 JSON 한 파일이다(구 대응표, 글로스 LM, 가중치, 글로스 표의 glosses 부분을 함께 담는다).
AI Hub 데이터에서 나온 파생물이라 커밋하지 않는다(.local/ 또는 runs/).

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import json
import time
from pathlib import Path

from gen.gloss_table import resolve
from gen.translate.align import build_phrase_table, symmetric_alignments
from gen.translate.decode import DEFAULT_WEIGHTS, decode
from gen.translate.lm import KneserNeyLM
from gen.translate.morph import CachedAnalyzer, RuleAnalyzer, get_analyzer
from gen.translate.rules import GlossLookup
from gen.translate.synonyms import SynonymTable
from gen.translate.units import ENDING_MARK, is_marker, to_units

SCHEMA = "translator_v1"
DEFAULT_CONFIG = {"analyzer": "madi", "keep_endings": True, "max_src": 3, "max_tgt": 4, "top_k": 8,
                  "ibm_iters": 10, "beam": 32, "use_lm": True, "use_phrases": True, "use_rules": True,
                  "anchor": True,
                  # 11-14 재현율 개선. 기본값은 끈 상태라 예전 학습 파일은 예전처럼 동작한다
                  "content_drop_min": 0.0, "use_split": False, "use_synonyms": False,
                  # 11-14 저녁: 그릴 수 있는 내용어는 버리지 않기, 쪼개진 이웃 단위 붙여 찾기
                  "content_keep": False, "keep_drop_prob": 1.01, "use_join": False}


# 동음이의어 문맥 단서: 글로스 이름 → 뜻(글로스 표 senses의 값) → 그 뜻을 가리키는 원문 단위(원형).
# 11-14 지헌 표시 결과 진짜 동음이의어는 "눈" 하나다.
SENSE_CUES = {
    "눈": {"내리는 눈": ("내리다", "오다", "쌓이다", "녹다", "펑펑"),
           "보는 눈": ("보다", "감다", "뜨다", "아프다", "깜빡이다", "안경")},
}


def _glosses_of(table):
    """글로스 표에서 번역기가 쓰는 부분만."""
    return {n: {"default": g["default"], "alts": list(g.get("alts", [])), "senses": dict(g.get("senses", {}))}
            for n, g in table["glosses"].items()}


def _fragment(unit):
    return unit[len(ENDING_MARK):] if unit.startswith(ENDING_MARK) else unit


class Translator:
    def __init__(self, glosses, phrase_table=None, lm=None, weights=None, config=None, analyzer=None, info=None,
                 synonyms=None):
        self.glosses = glosses
        if synonyms is not None and not isinstance(synonyms, SynonymTable):
            synonyms = SynonymTable(synonyms)
        self.synonyms = synonyms
        self.table = {"glosses": glosses}
        self.phrase_table = phrase_table or {}
        self.lm = lm or KneserNeyLM().fit([])
        self.weights = dict(DEFAULT_WEIGHTS)
        self.weights.update(weights or {})
        self.config = dict(DEFAULT_CONFIG)
        self.config.update(config or {})
        self.info = info or {}
        self.lookup = GlossLookup(glosses)
        if analyzer is None:
            analyzer = get_analyzer(self.config["analyzer"], lexicon=glosses)
        self.analyzer = analyzer if isinstance(analyzer, CachedAnalyzer) else CachedAnalyzer(analyzer)
        self.config["analyzer"] = self.analyzer.name

    # ------------------------------------------------------------ 단위

    def units_of(self, text):
        return to_units(self.analyzer.analyze(text), self.config["keep_endings"])

    # ------------------------------------------------------------ 번역

    def _rules_only(self, units):
        gloss, unknown, dropped, subst = [], [], [], []
        for u in units:
            if is_marker(u):
                dropped.append(_fragment(u))
                continue
            hit = self.lookup.lookup(u)
            if hit is not None:
                gloss.append(hit)
                continue
            parts = self._split(u)
            syn = None if parts else self._synonym(u)
            if parts:
                gloss.extend(parts)
                subst.append({"from": u, "to": "+".join(parts), "how": "split"})
            elif syn:
                gloss.append(syn)
                subst.append({"from": u, "to": syn, "how": "synonym"})
            else:
                unknown.append(u)
        return gloss, unknown, dropped, subst

    def _split(self, u):
        return self.lookup.split(u) if self.config["use_split"] else None

    def _synonym(self, u):
        if not (self.config["use_synonyms"] and self.synonyms):
            return None
        g = self.synonyms.lookup(u)
        return g if g in self.glosses else None

    def _lattice(self, units):
        pt = self.phrase_table if self.config["use_phrases"] else {}
        lookup = self.lookup.lookup if self.config["use_rules"] else None
        split = self.lookup.split if (self.config["use_split"] and lookup) else None
        syn = self._synonym if (self.config["use_synonyms"] and self.synonyms) else None
        gloss, path = decode(units, pt, self.lm, self.weights, lookup, max_src=self.config["max_src"],
                             beam=self.config["beam"], use_lm=self.config["use_lm"], split=split, synonyms=syn,
                             content_drop_min=self.config["content_drop_min"],
                             join=self.lookup.join if (self.config["use_join"] and lookup) else None,
                             content_keep=self.config["content_keep"], keep_drop_prob=self.config["keep_drop_prob"])
        unknown, dropped, subst = [], [], []
        for i, j, tgt, kind in path:
            if kind in ("split", "synonym", "join"):
                subst.append({"from": " ".join(units[i:j]), "to": "+".join(tgt), "how": kind})
            if tgt:
                continue
            for u in units[i:j]:
                if kind == "oov" and not is_marker(u):
                    unknown.append(u)
                else:
                    dropped.append(_fragment(u))
        return gloss, unknown, dropped, subst

    def _sense(self, name, text, units=()):
        """글로스 표에 senses가 있는 이름만 뜻을 고른다. 뜻 문자열이 문장에 있거나, 그 뜻의 문맥 단서(SENSE_CUES)가
        원문 단위에 있으면 그 뜻. 맞는 뜻이 없거나 둘 이상이면 None(기본값)."""
        g = self.glosses.get(name)
        if not g or not g["senses"]:
            return None
        lemmas = set(units)
        hits = []
        for _unit, meaning in g["senses"].items():
            if not meaning:
                continue
            cues = SENSE_CUES.get(name, {}).get(meaning, ())
            if meaning in text or lemmas.intersection(cues):
                hits.append(meaning)
        return hits[0] if len(hits) == 1 else None

    def translate(self, text: str, mode: str | None = None) -> dict:
        """mode: None(격자 디코딩) | 'rules'(B0 규칙만)."""
        units, dropped = self.units_of(text)
        if mode == "rules":
            gloss, unknown, more, subst = self._rules_only(units)
        else:
            gloss, unknown, more, subst = self._lattice(units)
        senses = [self._sense(g, text, units) for g in gloss]
        return {"gloss": gloss,
                "units": [resolve(self.table, g, s) for g, s in zip(gloss, senses)],
                "senses": senses,
                "unknown": unknown,
                "dropped": dropped + more,
                "substituted": subst}

    # ------------------------------------------------------------ 저장

    def to_json(self):
        return {"schema": SCHEMA, "config": self.config, "weights": self.weights, "info": self.info,
                "phrase_table": [[list(s), [[list(t), lf, lb, c] for t, lf, lb, c in cands]]
                                 for s, cands in sorted(self.phrase_table.items())],
                "lm": self.lm.to_json(), "glosses": self.glosses,
                "synonyms": self.synonyms.map if self.synonyms else None}

    def save(self, path, overwrite=False):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w" if overwrite else "x", encoding="utf-8") as fh:
            json.dump(self.to_json(), fh, ensure_ascii=False)
            fh.write("\n")


def build_translator(train_pairs, gloss_table, config=None, weights=None, analyzer=None, info=None, synonyms=None):
    """train_pairs: [{korean, gloss}] → Translator (대응표 + LM 학습). synonyms: SynonymTable | {낱말: [이름]} | None."""
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(config or {})
    glosses = _glosses_of(gloss_table)
    t = Translator(glosses, config=cfg, weights=weights, analyzer=analyzer, info=dict(info or {}), synonyms=synonyms)
    t0 = time.perf_counter()
    pairs = []
    for p in train_pairs:
        units, _ = t.units_of(p["korean"])
        if units and p["gloss"]:
            pairs.append((units, list(p["gloss"])))
    anchor = (lambda s, g: t.lookup.lookup(s) == g) if cfg["anchor"] else None
    alignments, _f, _b = symmetric_alignments(pairs, cfg["ibm_iters"], anchor=anchor)
    t.phrase_table = build_phrase_table(pairs, alignments, cfg["max_src"], cfg["max_tgt"], cfg["top_k"])
    t.lm = KneserNeyLM().fit([p["gloss"] for p in train_pairs if p["gloss"]])
    t.info.update({"train_pairs": len(pairs), "phrase_sources": len(t.phrase_table),
                   "train_sec": round(time.perf_counter() - t0, 2)})
    return t


def load_translator(path: str, analyzer=None, synonyms: str | None = None) -> Translator:
    """synonyms: 동의어 표 파일 경로. 있으면 학습 파일에 담긴 것 대신 이것을 쓰고 동의어 단계를 켠다
    (파일이 없으면 학습 파일 그대로). 다시 학습하지 않고 동의어 표만 바꿀 때 쓴다."""
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    if synonyms:
        from gen.translate.synonyms import load_synonyms  # noqa: PLC0415

        table = load_synonyms(synonyms)
        if table is not None:
            obj["synonyms"] = table.map
            obj["config"]["use_synonyms"] = True
    if obj.get("schema") != SCHEMA:
        raise ValueError(f"not a {SCHEMA} file: {path}")
    pt = {tuple(s): [(tuple(t), lf, lb, c) for t, lf, lb, c in cands] for s, cands in obj["phrase_table"]}
    cfg = dict(obj["config"])
    if analyzer is None:
        name = cfg.get("analyzer", "auto")
        # 학습 때 쓴 분석기와 같은 것을 쓴다. madi로 배웠는데 madi가 없으면 실패시킨다(단위가 달라짐)
        analyzer = get_analyzer(name, lexicon=obj["glosses"]) if name in ("madi", "rule") else None
    return Translator(obj["glosses"], pt, KneserNeyLM.from_json(obj["lm"]), obj["weights"], cfg, analyzer,
                      obj.get("info"), synonyms=obj.get("synonyms"))


__all__ = ["Translator", "build_translator", "load_translator", "RuleAnalyzer"]
