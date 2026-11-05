import os


def long_path(p):
    """Windows 경로 260자 제한 우회. 데이터가 OneDrive처럼 깊은 폴더에 있어도 읽히게 한다."""
    if os.name != "nt":
        return p
    p = os.path.abspath(p)
    if p.startswith("\\\\?\\") or len(p) < 240:
        return p
    return "\\\\?\\" + p.replace("/", "\\")
