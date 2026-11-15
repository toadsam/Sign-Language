"""한국어 문장 → 수어 글로스 열 번역기 (P2).

흐름: 형태소 분석(morph) → 원문 단위(units) → 구 대응표 + 글로스 3-gram + 비터비(decode) → 글로스 이름 열
     → 글로스 표 v2(resolve)로 동작 단위.

설계 참고: sign-motion-gloss (코드 복사 없음)
"""
from gen.translate.translator import Translator, load_translator

__all__ = ["Translator", "load_translator"]
