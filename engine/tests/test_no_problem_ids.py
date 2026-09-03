"""The runner must never name a problem id.

The catalogue has already been renumbered once (p6 and p39 removed, p1-p42
re-sequenced). Every detector is registered BY ID in detectors.py; if the runner
also hardcodes ids, a future renumber silently changes behaviour instead of
failing loudly. This guards that boundary.
"""
import pathlib
import re

RUNNER = pathlib.Path(__file__).resolve().parents[1] / "src" / "forge" / "runner.py"
_ID = re.compile(r"""['"]p\d+['"]""")


def test_runner_names_no_problem_id():
    hits = [(n, line.strip())
            for n, line in enumerate(RUNNER.read_text().splitlines(), 1)
            if _ID.search(line)]
    assert not hits, (
        "runner.py hardcodes problem ids — register them in detectors.py instead:\n"
        + "\n".join(f"  line {n}: {t}" for n, t in hits))


if __name__ == "__main__":
    test_runner_names_no_problem_id()
    print("PASS — runner.py names no problem id")
