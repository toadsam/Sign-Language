"""기존 명령 호환. 정식 평가는 python -m eval.compare를 사용한다."""
import warnings
from eval.legacy_compare import main

if __name__ == "__main__":
    warnings.warn("기존 비교는 표현자 분리 없는 샘플 진단용입니다. 정식 평가는 eval.compare를 사용하세요.", stacklevel=1)
    main()
