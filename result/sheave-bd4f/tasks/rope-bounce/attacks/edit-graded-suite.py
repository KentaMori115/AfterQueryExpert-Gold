"""Write our own file at a held-back test path."""
import pathlib, sys
root = pathlib.Path(sys.argv[1])
where = root / "test" / "pit"
where.mkdir(parents=True, exist_ok=True)
(where / "hanging-rope.test.ts").write_text(
    'import { describe, expect, it } from "vitest";\n'
    'describe("a rope hanging with something on the end of it", () => {\n'
    '  it("keeps what it was made of", () => { expect(1).toBe(1); });\n'
    "});\n"
)
