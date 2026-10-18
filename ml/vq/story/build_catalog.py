"""Export only repository Python source, never motion data or checkpoints.

Run with Python 3.11+. AST supplies exact source ranges and structural reading
notes. Human-authored explanations live in src/content.js, separately marked.
"""
import ast
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ML = HERE.parents[1]


def describe(node):
    """Describe syntax without pretending to infer scientific intent."""
    expr = lambda n: ast.unparse(n)[:180]
    if isinstance(node, (ast.Assign, ast.AnnAssign)):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        return f"{', '.join(expr(t) for t in targets)}에 계산 결과를 저장합니다. 오른쪽 식을 먼저 계산합니다."
    if isinstance(node, ast.AugAssign):
        return f"기존 {expr(node.target)} 값을 새 계산 결과로 갱신합니다."
    if isinstance(node, ast.Return):
        return f"호출한 곳에 {expr(node.value) if node.value else '값 없이 제어'}를 돌려주고 함수를 끝냅니다."
    if isinstance(node, ast.If):
        return f"{expr(node.test)} 조건이 참일 때 아래 블록을 실행합니다. else가 있으면 거짓일 때 실행합니다."
    if isinstance(node, (ast.For, ast.AsyncFor)):
        return f"{expr(node.iter)}에서 값을 하나씩 꺼내 {expr(node.target)}에 넣으며 반복합니다."
    if isinstance(node, ast.While):
        return f"{expr(node.test)} 조건이 참인 동안 반복합니다. 종료 조건을 확인하세요."
    if isinstance(node, (ast.With, ast.AsyncWith)):
        return "파일·작업자 등 자원을 정해진 범위에서 사용합니다. 블록이 끝나면 컨텍스트가 정리됩니다."
    if isinstance(node, ast.Try):
        return "오류가 날 수 있는 처리를 시도합니다. except는 지정한 오류만 처리하며 finally는 항상 실행됩니다."
    if isinstance(node, ast.Raise):
        return "정상 진행이 불가능함을 예외로 알립니다. 호출한 곳의 오류 처리와 함께 읽으세요."
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
        return f"{expr(node.value.func)}를 호출합니다. 괄호 안이 입력이며 파일 저장 등 부수 효과가 있을 수 있습니다."
    return None


def functions(body, source, prefix=""):
    found = []
    for node in body:
        if isinstance(node, ast.ClassDef):
            found.extend(functions(node.body, source, prefix + node.name + "."))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            steps = []
            for child in ast.walk(node):
                note = describe(child)
                if note:
                    steps.append({"line": child.lineno, "end": child.end_lineno, "text": note})
            found.append({"name": prefix + node.name, "line": node.lineno, "end": node.end_lineno,
                          "signature": ast.unparse(node.args), "doc": ast.get_docstring(node) or "",
                          "calls": sorted({ast.unparse(n.func) for n in ast.walk(node) if isinstance(n, ast.Call)}),
                          "steps": sorted(steps, key=lambda x: x["line"]),
                          "source": "\n".join(source.splitlines()[node.lineno - 1:node.end_lineno])})
            found.extend(functions(node.body, source, prefix + node.name + "."))
    return found


def main():
    files = []
    for folder in ("prep", "common", "vq"):
        for path in sorted((ML / folder).glob("*.py")):
            if path.name == "__init__.py":
                continue
            source = path.read_text(encoding="utf-8-sig")
            tree = ast.parse(source)
            files.append({"path": path.relative_to(ML).as_posix(), "doc": ast.get_docstring(tree) or "",
                          "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "source": source,
                          "functions": functions(tree.body, source)})
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ML, text=True).strip()
    result = {"commit": commit, "files": files,
              "scope": "ml/prep, ml/common, ml/vq의 최상위 Python 파일. story 자체와 팀원 소유 코드는 제외."}
    (HERE / "catalog.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"{len(files)} files, {sum(len(f['functions']) for f in files)} functions; {commit[:7]}")


if __name__ == "__main__":
    main()
