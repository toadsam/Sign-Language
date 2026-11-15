import json

from gen.gloss_table import build_table, read_sen_counts, resolve

VOCAB = {
    "schema_version": 1,
    "mapping": {"학교": "WORD0010", "곳": "WORD0020"},
    "unmapped": [],
    "ambiguous": {"기타": ["WORD0031", "WORD0030"], "타다": ["WORD0041", "WORD0040"]},
}
META = [
    json.dumps({"type": "SEN", "segments": [{"name": "곳"}, {"name": "가다"}]}),
    json.dumps({"type": "SEN", "segments": [{"name": "곳"}]}),
    "",
]
MARKS = [
    {"name": "기타", "verdict": "homonym", "meanings": {"WORD0030": "악기", "WORD0031": " 그 밖의 "}},
    {"name": "타다", "verdict": "same", "meanings": {"WORD0040": "무시됨"}},
]


def test_counts_and_units():
    counts = read_sen_counts(META)
    assert counts == {"곳": 2, "가다": 1}
    t = build_table(VOCAB, counts, MARKS)
    s = t["stats"]
    assert (s["units_sen"], s["units_word"]) == (2, 6)
    assert s["overlap_sen_word"] == 1 and s["homonym_marked"] == 1 and s["word_multi_id"] == 2


def test_rules():
    t = build_table(VOCAB, read_sen_counts(META), MARKS)
    g = t["glosses"]
    assert g["곳"] == {"default": "S:곳", "alts": ["W:WORD0020"], "homonym": False, "senses": {}}
    assert g["학교"]["default"] == "W:WORD0010"
    assert g["기타"]["default"] == "W:WORD0030" and g["기타"]["alts"] == ["W:WORD0031"]
    assert g["기타"]["senses"] == {"W:WORD0030": "악기", "W:WORD0031": "그 밖의"}
    assert g["타다"]["homonym"] is False and g["타다"]["senses"] == {}


def test_resolve():
    t = build_table(VOCAB, read_sen_counts(META), MARKS)
    assert resolve(t, "기타") == "W:WORD0030"
    assert resolve(t, "기타", "그 밖의") == "W:WORD0031"
    assert resolve(t, "곳") == "S:곳"
    assert resolve(t, "없는말") is None


def test_without_marks_defaults_lowest_id():
    t = build_table(VOCAB, {}, None)
    assert t["glosses"]["타다"]["default"] == "W:WORD0040"
    assert t["stats"]["homonym_marked"] == 0
