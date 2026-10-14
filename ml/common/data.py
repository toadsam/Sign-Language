"""전처리 결과(npy + meta.jsonl) 읽기와 학습·평가 분할."""
import json
import os

import numpy as np

from common.skeleton import FEAT_DIM


def load_data(data_dir, types=None):
    """meta.jsonl의 각 줄에 동작 배열 m["x"] ([T, 375])를 붙여 돌려준다."""
    metas = [json.loads(l) for l in open(os.path.join(data_dir, "meta.jsonl"), encoding="utf-8")]
    if types:
        metas = [m for m in metas if m["type"] in types]
    for m in metas:
        m["x"] = np.load(os.path.join(data_dir, "npy", f"{m['clip']}.npy")).reshape(-1, FEAT_DIM)
    return metas


def split_by_item(metas, holdout):
    """단어(항목) 단위 분할. 수행자가 1명뿐인 샘플에서만 쓴다."""
    items = sorted({m["item"] for m in metas})
    test_items = set(items[-holdout:]) if holdout > 0 else set()
    return [m for m in metas if m["item"] not in test_items], [m for m in metas if m["item"] in test_items]


def split_by_signer(metas, n_test, seed=0):
    """수행자 단위 분할. 같은 사람이 학습과 평가에 함께 들어가지 않게 한다.

    수행자가 부족하면 None을 돌려준다(호출하는 쪽에서 다른 방식으로 처리).
    """
    signers = sorted({m["signer"] for m in metas})
    if len(signers) <= n_test:
        return None
    rng = np.random.default_rng(seed)
    test = set(rng.permutation(signers)[:n_test].tolist())
    return [m for m in metas if m["signer"] not in test], [m for m in metas if m["signer"] in test]


# ---------------------------------------------------------------- 고정 분할표
# 모든 모델(자모표 · 받아쓰기 · 읽는 모델)이 같은 test 수행자로 평가하도록, 분할을 한 번 정해 파일로 커밋한다.
# 파일 이름은 데이터 폴더 이름을 따른다: data/full → ml/splits/full.json. 만드는 명령은 prep/make_split.py
SPLIT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "splits")


def split_path(data_dir):
    return os.path.join(SPLIT_DIR, os.path.basename(os.path.normpath(data_dir)) + ".json")


def load_split(data_dir):
    """data_dir에 맞는 고정 분할표. 없으면 None."""
    p = split_path(data_dir)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


def apply_split(metas, sp):
    """고정 분할표대로 나눈다 → (train, val, test). 분할표에 없는 수행자의 클립은 어디에도 넣지 않는다.
    분할표의 exclude.clips 에 있는 클립(품질 점검에서 학습 보류된 동작)도 빼다."""
    excluded = set(sp.get("exclude", {}).get("clips", []))
    if excluded:
        metas = [m for m in metas if m["clip"] not in excluded]
    if sp["mode"] == "signer":
        part = {s: k for k, v in sp["signers"].items() for s in v}
        key = lambda m: part.get(m["signer"])
    else:
        test_items = set(sp["test_items"])
        key = lambda m: "test" if m["item"] in test_items else "train"
    out = {"train": [], "val": [], "test": []}
    for m in metas:
        k = key(m)
        if k:
            out[k].append(m)
    return out["train"], out["val"], out["test"]


def make_split(metas, mode, holdout=4, test_signers=2, seed=0, data_dir=None):
    """(train, test). data_dir에 고정 분할표가 있으면 그것을 따르고(val은 빼 둔다), 없으면 그때그때 나눈다."""
    sp = load_split(data_dir) if data_dir else None
    if sp is not None:
        train, val, test = apply_split(metas, sp)
        print(f"고정 분할표 {os.path.relpath(split_path(data_dir))} ({sp['mode']}): "
              f"학습 {len(train)} · 검증 {len(val)}(학습에서 제외) · 평가 {len(test)} 클립")
        return train, test
    if mode == "signer":
        s = split_by_signer(metas, test_signers, seed)
        if s is not None:
            return s
        print(f"수행자가 {len({m['signer'] for m in metas})}명뿐이라 수행자 분할을 할 수 없어 단어 분할로 바꿉니다.")
    return split_by_item(metas, holdout)
