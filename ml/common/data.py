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


def make_split(metas, mode, holdout=4, test_signers=2, seed=0):
    if mode == "signer":
        s = split_by_signer(metas, test_signers, seed)
        if s is not None:
            return s
        print(f"수행자가 {len({m['signer'] for m in metas})}명뿐이라 수행자 분할을 할 수 없어 단어 분할로 바꿉니다.")
    return split_by_item(metas, holdout)
