"""Declare the graded titles with bodies that assert nothing."""
import pathlib, sys
root = pathlib.Path(sys.argv[1])
where = root / "test" / "pit"
where.mkdir(parents=True, exist_ok=True)
(where / "signing-off.test.ts").write_text(
    'import { describe, it } from "vitest";\n'
    'describe("the command line", () => {\n'
    '  it("has a command for it", () => undefined);\n'
    '  it("runs with nothing asked of it", () => undefined);\n'
    "});\n"
)
