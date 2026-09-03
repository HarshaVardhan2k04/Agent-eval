"""No class may define the same method name twice.

A second `def` silently REPLACES the first: the call sites of the shadowed method
keep type-checking and keep importing, then fail at runtime with a confusing
signature error. This actually happened — two different `_grade_sims` in
ForgeRunner, so every tiered run generated all of its conversations and then died
with "missing 1 required positional argument: 'direction'" before grading any of
them. Nothing but running it caught that. This does.
"""
import ast
import collections
import pathlib

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"


def _duplicates():
    for path in sorted(SRC.rglob("*.py")):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, (ast.ClassDef, ast.Module)):
                continue
            seen = collections.defaultdict(list)
            for body in node.body:
                if isinstance(body, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    seen[body.name].append(body.lineno)
            for name, lines in seen.items():
                if len(lines) > 1:
                    scope = getattr(node, "name", "<module>")
                    yield f"{path.relative_to(SRC.parent)}: {scope}.{name}() at lines {lines}"


def test_no_shadowed_definitions():
    dupes = sorted(_duplicates())
    assert not dupes, (
        "a later def silently shadows an earlier one — rename one of them:\n"
        + "\n".join(f"  {d}" for d in dupes))


if __name__ == "__main__":
    test_no_shadowed_definitions()
    print("PASS — no shadowed method definitions")
