"""형태소 → 원문 단위.

| 형태소 | 단위 |
|---|---|
| 내용어 N, 용언 V | 원형 그대로 (`먹다`) |
| 어미 E | `~` + 겉모양 (`~어요`). keep_endings=False면 뺀다 |
| 문장 부호 `?` | `?` (의문 글로스의 단서). 다른 부호는 뺀다 |
| 숫자 NUM | 숫자 그대로 |
| 조사 J, 그 밖 | 뺀다 (dropped) |

어미를 남기는 이유: 의문·청유 글로스가 어미에서 나올 수 있다. 번역 모델이 쓸모없으면 생략으로 배운다.
설계 참고: sign-motion-gloss (코드 복사 없음)
"""

ENDING_MARK = "~"


def is_marker(unit):
    """어미·부호 단위(내용어가 아님)."""
    return unit.startswith(ENDING_MARK) or unit == "?"


def to_units(morphs, keep_endings=True):
    """[(form, tag)] → (units, dropped)."""
    units, dropped = [], []
    for form, tag in morphs:
        if not form:
            continue
        if tag in ("N", "V", "NUM"):
            units.append(form)
        elif tag == "E":
            if keep_endings:
                units.append(ENDING_MARK + form)
            else:
                dropped.append(form)
        elif tag == "SF":
            if form == "?":
                units.append("?")
        else:  # J, X
            dropped.append(form)
    return units, dropped
