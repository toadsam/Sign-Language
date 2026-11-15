"""문장 GPT 데이터: 토큰 조건 붙이기, 나누기, 누출 검사, 일정표 (모두 지어낸 자료)."""
import unittest

from gen.sentence_data import (CONN, NONE, PAUSE, SentenceDataError, build_vocab, check_no_leak,
                               condition_rows, encode_condition, make_schedule, regions_of,
                               schedule_stats, select)


def sen_meta(clip, item, signer, segs, frames=40, label="ok"):
    return {"clip": clip, "item": item, "signer": signer, "type": "SEN", "frames": frames, "label": label,
            "dur_ratio": 1.0, "segments": [{"name": n, "f0": a, "f1": b} for n, a, b in segs]}


def word_meta(clip, item, signer):
    return {"clip": clip, "item": item, "signer": signer, "type": "WORD", "frames": 20, "label": "ok",
            "dur_ratio": 1.0, "segments": []}


def token(meta, n):
    return {"item": meta["item"], "signer": meta["signer"], "type": meta["type"],
            "frames": [0, 4 * n], "tokens": list(range(n))}


SPLIT = {"signers": {"train": ["A", "B"], "val": ["V"], "test": ["T"]}, "exclude": {"clips": ["X_A"]},
         "heldout_sentences": {"items": ["SEN9"], "question_items": ["SEN8"], "sequences": [["가", "다"]]}}
SEN_VAL = {"items": ["SEN7"]}


class ConditionTests(unittest.TestCase):
    def test_regions_and_labels(self):
        # 휴지 0-7, 가 8-15(끝 포함), 연결 16-19, 나 20-31, 휴지 32-39
        regions = regions_of([("S:가", 8, 15), ("S:나", 20, 31)], 40)
        self.assertEqual([r[0] for r in regions], ["pause", "word", "conn", "word", "pause"])
        cond, phase, spans = condition_rows(10, 0, 4, regions)
        self.assertEqual(cond[0], (PAUSE, NONE, "S:가"))
        self.assertEqual(cond[2], ("S:가", NONE, NONE))
        self.assertEqual(cond[4], (CONN, "S:가", "S:나"))
        self.assertEqual(cond[9], (PAUSE, "S:나", NONE))
        self.assertEqual(spans, [("S:가", 2, 4), ("S:나", 5, 8)])
        self.assertEqual(phase[2:4], [(0, 1), (1, 0)])

    def test_boundary_token_goes_to_larger_overlap(self):
        # 토큰 1 = 프레임 4-7: 단어(6-)와 2프레임, 휴지와 2프레임 → 같으면 단어
        regions = regions_of([("S:가", 6, 13)], 16)
        cond, _, _ = condition_rows(4, 0, 4, regions)
        self.assertEqual(cond[1][0], "S:가")
        # 단어 5-7: 토큰 1과 3프레임 → 단어, 토큰 2(8-11)는 뒤 휴지
        cond, _, spans = condition_rows(4, 0, 4, regions_of([("S:가", 5, 7)], 16))
        self.assertEqual([c[0] for c in cond], [PAUSE, "S:가", PAUSE, PAUSE])

    def test_tiny_word_keeps_a_token(self):
        # 2프레임 단어가 연결/휴지에 밀려도 토큰 하나는 받는다
        regions = regions_of([("S:가", 4, 10), ("S:나", 13, 14), ("S:다", 17, 30)], 32)
        cond, _, spans = condition_rows(8, 0, 4, regions)
        self.assertIn("S:나", [s[0] for s in spans])

    def test_schedule(self):
        stats = {"unit_tokens": {"S:가": 3, "W:WORD1": 2}, "conn_tokens": 1, "lead_tokens": 2, "tail_tokens": 1}
        cond, phase, spans = make_schedule(["S:가", "W:WORD1"], stats)
        self.assertEqual(len(cond), 2 + 3 + 1 + 2 + 1)
        self.assertEqual(spans, [("S:가", 2, 5), ("W:WORD1", 6, 8)])
        self.assertEqual(cond[5], (CONN, "S:가", "W:WORD1"))
        self.assertEqual(phase[2], (0, 2))
        cond, _, spans = make_schedule(["S:가"], {**stats, "conn_tokens": 0}, pauses=False)
        self.assertEqual(spans, [("S:가", 0, 3)])
        with self.assertRaises(SentenceDataError):
            make_schedule(["S:없음"], stats)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        metas = [
            sen_meta("S1_A", "SEN1", "A", [("가", 4, 12), ("나", 16, 30)]),
            sen_meta("S1_B", "SEN1", "B", [("가", 4, 12), ("나", 16, 30)]),
            sen_meta("S9_A", "SEN9", "A", [("가", 4, 12), ("라", 16, 30)]),   # heldout item
            sen_meta("S5_A", "SEN5", "A", [("가", 4, 12), ("다", 16, 30)]),   # heldout sequence
            sen_meta("S7_A", "SEN7", "A", [("나", 4, 12), ("가", 16, 30)]),   # sen_val
            sen_meta("S6_A", "SEN6", "A", [("나", 4, 12), ("가", 16, 30)]),   # sen_val과 같은 글로스 열
            sen_meta("S9_T", "SEN9", "T", [("가", 4, 12), ("라", 16, 30)]),   # test signer heldout
            sen_meta("S1_V", "SEN1", "V", [("가", 4, 12), ("나", 16, 30)]),   # val signer: 안 씀
            sen_meta("X_A", "SEN1", "A", [("가", 4, 12), ("나", 16, 30)]),    # exclude
            sen_meta("E_A", "SEN1", "A", []),                                # 구간 없음
            word_meta("W1_A", "WORD1", "A"), word_meta("W1_T", "WORD1", "T"),
        ]
        self.metas = {m["clip"]: m for m in metas}
        self.tokens = {"nb_code": 8, "down": 4, "clips": {m["clip"]: token(m, 10 if m["type"] == "SEN" else 5)
                                                           for m in metas}}

    def test_buckets(self):
        sel = select(self.tokens, self.metas, SPLIT, SEN_VAL)
        clips = {k: sorted(r["clip"] for r in sel[k]) for k in ("train", "val", "test", "test_signer")}
        self.assertEqual(clips["train"], ["S1_A", "S1_B", "W1_A"])
        self.assertEqual(clips["val"], ["S6_A", "S7_A"])
        self.assertEqual(clips["test"], ["S5_A", "S9_A"])
        self.assertEqual(clips["test_signer"], ["S9_T"])
        self.assertEqual(sel["dropped"], {"quality": 1, "no_segments": 1})
        w = next(r for r in sel["train"] if r["type"] == "WORD")
        self.assertEqual(set(w["cond"]), {("W:WORD1", NONE, NONE)})

    def test_leak_check_raises(self):
        sel = select(self.tokens, self.metas, SPLIT, SEN_VAL)
        bad = sel["train"] + sel["test"][:1]
        with self.assertRaises(SentenceDataError):
            check_no_leak(bad, SPLIT, SEN_VAL)
        with self.assertRaises(SentenceDataError):
            check_no_leak(sel["train"] + [r for r in sel["val"] if r["item"] == "SEN7"], SPLIT, SEN_VAL)
        with self.assertRaises(SentenceDataError):
            check_no_leak(sel["train"] + sel["test_signer"], SPLIT, SEN_VAL)

    def test_vocab_stats_encode(self):
        sel = select(self.tokens, self.metas, SPLIT, SEN_VAL)
        vocab, signers, context = build_vocab(sel["train"], sel["train_signers"])
        self.assertEqual(list(vocab)[:4], ["<null>", "<none>", "<conn>", "<pause>"])
        self.assertEqual(set(vocab) - {"<null>", "<none>", "<conn>", "<pause>"}, {"S:가", "S:나", "W:WORD1"})
        self.assertEqual(signers, {"A": 0, "B": 1})
        self.assertNotIn("W:WORD1", context)
        stats = schedule_stats(sel["train"])
        self.assertEqual(stats["unit_tokens"]["W:WORD1"], 5)
        self.assertEqual(stats["sentences"], 2)
        cond, _, _ = make_schedule(["W:WORD1", "S:가"], stats)
        cur, prev, nxt = encode_condition(cond, vocab, context)
        conn = [i for i, c in enumerate(cond) if c[0] == CONN][0]
        self.assertEqual(prev[conn], vocab[NONE])   # W:WORD1은 연결 앞뒤로 배운 적 없음
        self.assertEqual(nxt[conn], vocab["S:가"])


if __name__ == "__main__":
    unittest.main()
