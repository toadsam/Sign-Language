"""공용 분할을 우선 사용하고 test 수행자를 학습/모델 선택에서 제외한다."""
import numpy as np

from common.data import apply_split, load_split


def partition(metas, data_dir, test_signers=2, seed=0, smoke=False):
    if smoke:
        return metas, [], [], {"mode": "smoke", "signers": {"train": sorted({m['signer'] for m in metas}), "val": [], "test": []}}
    sp = load_split(data_dir)
    if sp is not None:
        if sp["mode"] != "signer":
            raise ValueError("단어 분할표로 처음 보는 표현자 평가를 할 수 없습니다. 샘플 확인은 --smoke를 쓰세요.")
        groups = [set(sp["signers"].get(k, [])) for k in ("train", "val", "test")]
        if any(groups[i] & groups[j] for i in range(3) for j in range(i + 1, 3)):
            raise ValueError("공용 분할표에 겹치는 표현자가 있습니다.")
        if {m["signer"] for m in metas} - set.union(*groups):
            raise ValueError("공용 분할표에 없는 표현자가 있습니다.")
    else:
        signers = sorted({m["signer"] for m in metas})
        if test_signers < 1 or len(signers) < test_signers + 2:
            raise ValueError("train/val/test 표현자 분할에 필요한 사람이 부족합니다. 샘플 확인은 --smoke를 쓰세요.")
        order = np.random.default_rng(seed).permutation(signers).tolist()
        sp = {"mode": "signer", "signers": {"test": order[:test_signers],
              "val": order[test_signers:test_signers + 1], "train": order[test_signers + 1:]}}
    train, val, test = apply_split(metas, sp)
    if not train or not test:
        raise ValueError("train과 test 클립이 모두 필요합니다.")
    return train, val, test, sp
