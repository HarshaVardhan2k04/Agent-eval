"""The runner must never name a problem id.

The catalogue has already been renumbered once (p6 and p39 removed, p1-p42
re-sequenced). Every detector is registered BY ID in detectors.py; if the runner
also hardcodes ids, a future renumber silently changes behaviour instead of
failing loudly. This guards that boundary.
"""
import pathlib
import re

FORGE = pathlib.Path(__file__).resolve().parents[1] / "src" / "forge"

# Modules that ORCHESTRATE. They ask detectors.py what is registered for an id; they
# must never carry their own copy of the catalogue. verify.py did — a private
# {"p20".."p24"} set duplicating the tools_on flag scenario_for already returns.
ORCHESTRATORS = ["runner.py", "verify.py", "toolchecks.py"]

# Exempt, deliberately: detectors.py and stress.py ARE the registries (that is the whole
# point — one place that maps id -> checker), and coach.py names ids only inside a JSON
# shape example in a prompt string.

_ID = re.compile(r"""['"]p\d+['"]""")


def test_orchestrators_name_no_problem_id():
    hits = [(mod, n, line.strip())
            for mod in ORCHESTRATORS
            for n, line in enumerate((FORGE / mod).read_text().splitlines(), 1)
            if _ID.search(line)]
    assert not hits, (
        "these modules hardcode problem ids — register them in detectors.py instead:\n"
        + "\n".join(f"  {m}:{n}: {t}" for m, n, t in hits))


if __name__ == "__main__":
    test_orchestrators_name_no_problem_id()
    print(f"PASS — {', '.join(ORCHESTRATORS)} name no problem id")
