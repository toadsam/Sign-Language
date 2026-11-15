"""엑셀 2,000쌍 읽기와 학습 · 검증 · 시험 나누기.

엑셀 열: 영상 번호(1~2000 → SEN0001…), 한국어 번역, 형태소 개수, 한국수어 형태소(4열부터 셀 하나에 글로스 하나).
openpyxl 없이 표준 라이브러리(zipfile + XML)로 첫 시트만 읽는다.

나누기 (지시서 규칙)
  시험 heldout: full_sen.json의 heldout_sentences에서 items · question_items에 있거나,
                글로스 열(엑셀 또는 문장 메타)이 sequences에 있는 문장
  검증: gen/splits/sen_val_v1.json의 items
  학습: 나머지
strict=True면 학습에서 검증 · 시험 문장과 **한국어 문장이 같은 것**도 뺀다(같은 문장의 다른 번역이 학습에 들어가는 것을 막음).

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
import json
import re
import zipfile
import xml.etree.ElementTree as ET

_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def _col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_xlsx_rows(path):
    """첫 시트의 행들 (값 목록, 빈 칸은 None)."""
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", _NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{_NS['m']}}}t")))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        first = wb.find("m:sheets/m:sheet", _NS)
        target = "xl/worksheets/sheet1.xml"
        if first is not None and "xl/_rels/workbook.xml.rels" in z.namelist():
            rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
            rid = first.get(_REL)
            for r in rels:
                if r.get("Id") == rid:
                    t = r.get("Target").lstrip("/")
                    target = t if t.startswith("xl/") else "xl/" + t
        sheet = ET.fromstring(z.read(target))
    rows = []
    for row in sheet.iter(f"{{{_NS['m']}}}row"):
        vals = {}
        for c in row.findall("m:c", _NS):
            kind = c.get("t")
            if kind == "inlineStr":
                v = "".join(t.text or "" for t in c.iter(f"{{{_NS['m']}}}t"))
            else:
                node = c.find("m:v", _NS)
                if node is None:
                    continue
                v = node.text
                if kind == "s":
                    v = shared[int(v)]
                elif kind not in ("str", "b", "e"):
                    v = float(v) if any(ch in v for ch in ".eE") else int(v)
            vals[_col_index(c.get("r"))] = v
        if vals:
            rows.append([vals.get(i) for i in range(max(vals) + 1)])
    return rows


def sen_id(number):
    return "SEN%04d" % int(float(number))


def pairs_from_rows(rows):
    """[{id, korean, gloss}] (머리줄과 빈 줄은 건너뛴다)."""
    out = []
    for r in rows:
        if not r or r[0] is None or not str(r[0]).strip().replace(".", "").isdigit():
            continue
        korean = str(r[1] or "").strip()
        gloss = [str(c).strip() for c in r[3:] if c is not None and str(c).strip()]
        out.append({"id": sen_id(r[0]), "korean": korean, "gloss": gloss})
    return out


def read_pairs(path):
    return pairs_from_rows(read_xlsx_rows(path))


def heldout_ids(pairs, heldout, meta_gloss=None):
    """heldout: full_sen.json의 heldout_sentences dict. meta_gloss: {item: 글로스 열} (선택)."""
    seqs = {tuple(s) for s in heldout.get("sequences", [])}
    ids = set(heldout.get("items", [])) | set(heldout.get("question_items", []))
    for p in pairs:
        if tuple(p["gloss"]) in seqs or (meta_gloss and tuple(meta_gloss.get(p["id"], ())) in seqs):
            ids.add(p["id"])
    return ids


def split_pairs(pairs, heldout, val_ids, meta_gloss=None, strict=False):
    """{'train': [...], 'val': [...], 'test': [...]}"""
    test = heldout_ids(pairs, heldout, meta_gloss)
    val = set(val_ids) - test
    out = {"train": [], "val": [], "test": []}
    for p in pairs:
        if p["id"] in test:
            out["test"].append(p)
        elif p["id"] in val:
            out["val"].append(p)
        else:
            out["train"].append(p)
    if strict:
        banned = {p["korean"] for p in out["val"] + out["test"]}
        out["train"] = [p for p in out["train"] if p["korean"] not in banned]
    return out


def load_meta_gloss(path):
    out = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                r = json.loads(line)
                out.setdefault(r["item"], r.get("gloss", []))
    return out


def references(eval_pairs, multi=False):
    """정답 목록. multi=True면 같은 세트 안의 같은 한국어 문장의 글로스 열을 모두 정답으로 둔다."""
    if not multi:
        return [[p["gloss"]] for p in eval_pairs]
    by_ko = {}
    for p in eval_pairs:
        by_ko.setdefault(p["korean"], [])
        if p["gloss"] not in by_ko[p["korean"]]:
            by_ko[p["korean"]].append(p["gloss"])
    return [by_ko[p["korean"]] for p in eval_pairs]
