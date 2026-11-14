"""사람 판정 화면 만들기: heldout 문장 n개의 한국어 · 번역기 글로스 · 사람 정답 글로스를 나란히 보여 주고
오류 종류를 고르는 로컬 HTML 한 장.

문장마다 하나 고른다: 정답과 같음 / 다른 표현이지만 뜻이 맞음 / 단어가 빠짐 / 엉뚱한 글로스가 있음 / 빠짐+엉뚱함 둘 다
선택: 번역기 글로스 칩을 누르면 "엉뚱함", 정답 글로스 칩을 누르면 "빠짐"으로 표시된다(다시 누르면 해제). 메모 칸 하나.
결과 JSON: 문장마다 {no, id, verdict, wrong: [{i, gloss}], missing: [{i, gloss}], note}.
종류별 비율은 python -m gen.translate.judge_summary <결과 JSON>.

    python -m gen.translate.judge_page --model <translator.json> --pairs <엑셀> --sen-meta <meta> \
        --out .local/review/translate_judge.html [--n 50] [--seed 0] [--synonyms <synonyms_v1.json>]

만든 HTML에는 원문이 들어가므로 **커밋하지 않고 .local에만 둔다**. 이 스크립트는 원문을 담지 않는다.
판정은 브라우저 localStorage에 자동 저장되고(막혀 있으면 저장 없이 동작), "결과 내려받기"로 JSON을 받는다.
외부 파일 · CDN을 쓰지 않는다.
"""
import argparse
import html
import json
import random
from pathlib import Path

from gen.translate.evaluate import all_references, load_split
from gen.translate.pairs import read_pairs
from gen.translate.translator import load_translator

CHOICES = [("same", "정답과 같음"), ("paraphrase", "다른 표현이지만 뜻이 맞음"), ("missing", "단어가 빠짐"),
           ("wrong", "엉뚱한 글로스가 있음"), ("both", "빠짐+엉뚱함 둘 다")]


def pick(test_pairs, n, seed):
    """id 순으로 정렬한 뒤 seed로 n개 (같은 seed면 늘 같은 문장)."""
    ordered = sorted(test_pairs, key=lambda p: p["id"])
    rng = random.Random(seed)
    return sorted(rng.sample(ordered, min(n, len(ordered))), key=lambda p: p["id"])


def build_items(translator, chosen, all_pairs):
    refs = all_references(chosen, all_pairs)
    items = []
    for p, r in zip(chosen, refs):
        out = translator.translate(p["korean"])
        items.append({"id": p["id"], "korean": p["korean"], "pred": out["gloss"], "ref": p["gloss"],
                      "other_refs": r[1:], "unknown": out["unknown"],
                      "substituted": out.get("substituted", [])})
    return items


PAGE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>번역 판정</title>
<style>
:root { --bg:#f7f7f5; --card:#ffffff; --ink:#1d1d1f; --muted:#6b6b70; --line:#e2e2e0; --accent:#2f5bd3;
        --ok:#1f8a4c; --partial:#b7791f; --bad:#c0392b; --chip:#eef1f8; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg:#141416; --card:#1e1e22; --ink:#ececf0; --muted:#a0a0a8; --line:#2e2e34; --accent:#7b9cff;
  --ok:#4cc27e; --partial:#e0a84a; --bad:#ef6b5e; --chip:#262a36; } }
:root[data-theme="dark"] { --bg:#141416; --card:#1e1e22; --ink:#ececf0; --muted:#a0a0a8; --line:#2e2e34;
  --accent:#7b9cff; --ok:#4cc27e; --partial:#e0a84a; --bad:#ef6b5e; --chip:#262a36; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 system-ui, -apple-system, "Malgun Gothic", sans-serif; }
header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); padding:12px 16px; z-index:1; }
.bar { max-width:860px; margin:0 auto; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
h1 { font-size:17px; margin:0; flex:1 1 auto; }
.count { color:var(--muted); font-variant-numeric:tabular-nums; }
button { font:inherit; cursor:pointer; border:1px solid var(--line); background:var(--card); color:var(--ink);
         border-radius:8px; padding:6px 12px; }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
main { max-width:860px; margin:0 auto; padding:16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin:0 0 12px; }
.card.done { border-left:4px solid var(--accent); }
.meta { color:var(--muted); font-size:12px; }
.ko { font-size:16px; margin:4px 0 10px; }
.row { display:grid; grid-template-columns:88px 1fr; gap:6px 10px; margin:4px 0; }
.lab { color:var(--muted); font-size:13px; padding-top:2px; }
.chips { display:flex; flex-wrap:wrap; gap:4px; }
.chip { background:var(--chip); border-radius:6px; padding:1px 8px; }
.note { color:var(--muted); font-size:13px; }
.choices { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
.choices button[aria-pressed="true"] { background:var(--accent); border-color:var(--accent); color:#fff; }
.choices button[aria-pressed="true"][data-v="same"], .choices button[aria-pressed="true"][data-v="paraphrase"] {
  background:var(--ok); border-color:var(--ok); }
.choices button[aria-pressed="true"][data-v="missing"] { background:var(--partial); border-color:var(--partial); }
.choices button[aria-pressed="true"][data-v="wrong"], .choices button[aria-pressed="true"][data-v="both"] {
  background:var(--bad); border-color:var(--bad); }
button.chip { border:1px solid transparent; padding:1px 8px; border-radius:6px; background:var(--chip); }
button.chip.mark-wrong { border-color:var(--bad); color:var(--bad); text-decoration:line-through; }
button.chip.mark-missing { border-color:var(--partial); color:var(--partial); font-weight:600; }
.hint { color:var(--muted); font-size:12px; margin-top:2px; }
textarea { width:100%; margin-top:8px; font:inherit; color:var(--ink); background:var(--bg); border:1px solid var(--line);
           border-radius:8px; padding:6px 8px; min-height:34px; resize:vertical; }
details summary { cursor:pointer; color:var(--muted); font-size:13px; }
@media (max-width:520px) { .row { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header><div class="bar">
  <h1>번역 판정 <span class="meta">__META__</span></h1>
  <span class="count" id="count"></span>
  <button id="dl" class="primary">결과 내려받기</button>
</div></header>
<main id="list"></main>
<script id="data" type="application/json">__DATA__</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var KEY = 'translate_judge_' + DATA.tag;
  var CHOICES = DATA.choices;
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} updateCount(); }
  function chips(list, id, field, cls) {
    var d = document.createElement('div'); d.className = 'chips';
    if (!list.length) { var s = document.createElement('span'); s.className = 'note'; s.textContent = '(없음)'; d.appendChild(s); }
    list.forEach(function (g, i) {
      if (!field) { var s = document.createElement('span'); s.className = 'chip'; s.textContent = g; d.appendChild(s); return; }
      var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = g;
      function marked() { return ((state[id] || {})[field] || []).indexOf(i) >= 0; }
      function paint() { b.classList.toggle(cls, marked()); b.setAttribute('aria-pressed', String(marked())); }
      b.addEventListener('click', function () {
        state[id] = state[id] || {}; var arr = state[id][field] || [];
        var k = arr.indexOf(i); if (k >= 0) arr.splice(k, 1); else arr.push(i);
        state[id][field] = arr; paint(); save();
      });
      paint(); d.appendChild(b);
    });
    return d;
  }
  function row(label, node) {
    var r = document.createElement('div'); r.className = 'row';
    var l = document.createElement('div'); l.className = 'lab'; l.textContent = label;
    r.appendChild(l); r.appendChild(node); return r;
  }
  function updateCount() {
    var n = DATA.items.filter(function (it) { return state[it.id] && state[it.id].verdict; }).length;
    document.getElementById('count').textContent = n + ' / ' + DATA.items.length + ' 판정';
  }
  var list = document.getElementById('list');
  DATA.items.forEach(function (it, i) {
    var c = document.createElement('section'); c.className = 'card';
    var m = document.createElement('div'); m.className = 'meta'; m.textContent = (i + 1) + '. ' + it.id; c.appendChild(m);
    var ko = document.createElement('div'); ko.className = 'ko'; ko.textContent = it.korean; c.appendChild(ko);
    c.appendChild(row('번역기', chips(it.pred, it.id, 'wrong', 'mark-wrong')));
    c.appendChild(row('사람 정답', chips(it.ref, it.id, 'missing', 'mark-missing')));
    if (i === 0) { var h = document.createElement('div'); h.className = 'hint';
      h.textContent = '선택: 번역기 글로스를 누르면 "엉뚱함", 정답 글로스를 누르면 "빠짐"으로 표시됩니다.'; c.appendChild(row('', h)); }
    if (it.unknown.length) { var u = document.createElement('div'); u.className = 'note'; u.textContent = '못 찾은 말: ' + it.unknown.join(', '); c.appendChild(row('', u)); }
    if (it.substituted.length) { var sb = document.createElement('div'); sb.className = 'note';
      sb.textContent = '바꾼 말: ' + it.substituted.map(function (s) { return s.from + '→' + s.to; }).join(', '); c.appendChild(row('', sb)); }
    if (it.other_refs.length) {
      var det = document.createElement('details'); var sm = document.createElement('summary');
      sm.textContent = '다른 사람 번역 ' + it.other_refs.length + '개'; det.appendChild(sm);
      it.other_refs.forEach(function (r) { det.appendChild(chips(r)); });
      c.appendChild(row('', det));
    }
    var ch = document.createElement('div'); ch.className = 'choices';
    CHOICES.forEach(function (pair) {
      var b = document.createElement('button'); b.type = 'button'; b.dataset.v = pair[0]; b.textContent = pair[1];
      b.setAttribute('aria-pressed', String((state[it.id] || {}).verdict === pair[0]));
      b.addEventListener('click', function () {
        state[it.id] = state[it.id] || {}; state[it.id].verdict = pair[0];
        ch.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        c.classList.add('done'); save();
      });
      ch.appendChild(b);
    });
    c.appendChild(ch);
    var ta = document.createElement('textarea'); ta.placeholder = '메모 (선택)'; ta.value = (state[it.id] || {}).note || '';
    ta.addEventListener('input', function () { state[it.id] = state[it.id] || {}; state[it.id].note = ta.value; save(); });
    c.appendChild(ta);
    if ((state[it.id] || {}).verdict) c.classList.add('done');
    list.appendChild(c);
  });
  updateCount();
  document.getElementById('dl').addEventListener('click', function () {
    var counts = {}; CHOICES.forEach(function (p) { counts[p[0]] = 0; });
    var results = DATA.items.map(function (it, n) {
      var s = state[it.id] || {}; if (s.verdict) counts[s.verdict] += 1;
      function pick(list, idx) { return (idx || []).slice().sort(function (a, b) { return a - b; })
        .map(function (i) { return { i: i, gloss: list[i] }; }); }
      return { no: n + 1, id: it.id, verdict: s.verdict || null, wrong: pick(it.pred, s.wrong),
               missing: pick(it.ref, s.missing), note: s.note || '' };
    });
    var blob = new Blob([JSON.stringify({ tag: DATA.tag, model: DATA.model, seed: DATA.seed, choices: CHOICES, counts: counts,
      judged: results.filter(function (r) { return r.verdict; }).length, results: results }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'translate_judge_' + DATA.tag + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  });
})();
</script>
</body>
</html>
"""


def render(items, model, seed):
    tag = f"{Path(model).stem}_seed{seed}_n{len(items)}"
    data = {"tag": tag, "model": Path(model).name, "seed": seed, "choices": CHOICES, "items": items}
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    meta = html.escape(f"{Path(model).name} · seed {seed} · {len(items)}문장")
    return PAGE.replace("__META__", meta).replace("__DATA__", blob)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True)
    p.add_argument("--pairs", required=True)
    p.add_argument("--sen-meta")
    p.add_argument("--synonyms")
    p.add_argument("--out", required=True)
    p.add_argument("--n", type=int, default=50)
    p.add_argument("--seed", type=int, default=0)
    a = p.parse_args()
    t = load_translator(a.model, synonyms=a.synonyms)
    test = load_split(a.pairs, "test", sen_meta=a.sen_meta)
    items = build_items(t, pick(test, a.n, a.seed), read_pairs(a.pairs))
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(items, a.model, a.seed), encoding="utf-8")
    print(f"wrote {out} items={len(items)}")


if __name__ == "__main__":
    main()
