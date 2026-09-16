#!/usr/bin/env python3
"""Break the reference one way at a time and confirm the graded suites notice.

A check nobody can fail is a check that grades nothing. Each mutant below is a
plausible wrong reading of the request; every one of them has to take at least
one graded id down with it.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE / "build"

MUTANTS = [
    ("jump base is the opcode, not the instruction after it",
     "src/verify/mod.rs",
     "let target = body.next_offset(insn) as i32 + body.i16_at(insn, 0) as i32;",
     "let target = insn.offset as i32 + body.i16_at(insn, 0) as i32;"),
    ("a closure does not widen the frame it names",
     "src/verify/mod.rs",
     ".map(|(f, over)| f.param_count as u16 + f.local_count as u16 + u16::from(over))",
     ".map(|(f, _over)| f.param_count as u16 + f.local_count as u16)"),
    ("arity is weighed before the function that would declare it",
     "src/verify/mod.rs",
     """            let Some(callee) = chunk.funcs.get(target) else {
                return Some(FlawKind::Function);
            };
            if body.u8_at(insn, 2) != callee.param_count {
                return Some(FlawKind::Arity);
            }""",
     """            let Some(callee) = chunk.funcs.get(target) else {
                return Some(FlawKind::Arity);
            };
            if body.u8_at(insn, 2) != callee.param_count {
                return Some(FlawKind::Arity);
            }"""),
    ("a dictionary key is only checked for being in the pool",
     "src/verify/mod.rs",
     """            match constant(chunk, body.u16_at(insn, 0)) {
                Some(Constant::Str(_)) => {}
                _ => return Some(FlawKind::Constant),
            }""",
     """            if constant(chunk, body.u16_at(insn, 0)).is_none() {
                return Some(FlawKind::Constant);
            }"""),
    ("the walk carries on past a byte that is not an opcode",
     "src/verify/decode.rs",
     """        let Some(width) = operand_width(op) else {
            stop = Some((pos, Stop::Unknown));
            break;
        };""",
     """        let Some(width) = operand_width(op) else {
            stop = Some((pos, Stop::Unknown));
            pos += 1;
            continue;
        };"""),
    ("the end of a body is not a place to land",
     "src/verify/decode.rs",
     "    starts[code.len()] = true;",
     "    starts[code.len()] = false;"),
    ("a call leaves what the caller had, less its arguments",
     "src/verify/depth.rs",
     """            Effect::Call { needs } => {
                if depth >= needs {
                    go(&mut work, &mut reached, body.next_offset(&insn) as i32, 1);
                }
            }""",
     """            Effect::Call { needs } => {
                if depth >= needs {
                    let after = depth - needs + 1;
                    go(&mut work, &mut reached, body.next_offset(&insn) as i32, after);
                }
            }"""),
    ("an invocation reads only its arguments",
     "src/verify/depth.rs",
     "            needs: body.u8_at(insn, 0) as u16 + 1,",
     "            needs: body.u8_at(insn, 0) as u16,"),
    ("the depth flaw reported is the first one reached, not the lowest",
     "src/verify/depth.rs",
     """    for (i, insn) in body.insns.iter().enumerate() {
        let depths: Vec<u16> = (0..=ceiling).filter(|d| reached[i][*d as usize]).collect();""",
     """    let mut order: Vec<usize> = (0..body.insns.len()).collect();
    order.reverse();
    for i in order {
        let insn = &body.insns[i];
        let depths: Vec<u16> = (0..=ceiling).filter(|d| reached[i][*d as usize]).collect();"""),
    ("paths that disagree are not worth reporting",
     "src/verify/depth.rs",
     """        if depths.len() > 1 {
            return Some(insn.offset);
        }
        let depth = depths[0];""",
     """        let depth = depths[0];"""),
    ("the stack may hold one more than it holds",
     "src/verify/depth.rs",
     "    let ceiling = VM_STACK_MAX as u16;",
     "    let ceiling = VM_STACK_MAX as u16 + 1;"),
    ("a body that stopped decoding still has its stack read",
     "src/verify/mod.rs",
     """        match body.stop {
            Some((offset, stop)) => found.push(Flaw {""",
     """        if let Some(offset) = entry_flaw(body, &entries[func]) {
            found.push(Flaw {
                func: func as u16,
                offset,
                kind: FlawKind::Depth,
            });
        }
        match body.stop {
            Some((offset, stop)) => found.push(Flaw {"""),
    ("flaws come out in the order they were found",
     "src/verify/mod.rs",
     "        found.sort_by_key(|f| f.offset);",
     "        found.sort_by_key(|_f| 0);"),
    ("every function is read from an empty stack",
     "src/verify/mod.rs",
     """    depths[chunk.entry_idx as usize].insert(0);
    for (func, names) in called.iter().enumerate() {
        if !names {
            depths[func].insert(0);
        }
    }""",
     """    for func in 0..count {
        depths[func].insert(0);
    }
    let _ = &called;"""),
    ("calls that disagree quietly take the first depth",
     "src/verify/mod.rs",
     """            if set.len() == 1 {
                Entry::At(*set.iter().next().unwrap())
            } else {
                Entry::Conflict
            }""",
     """            match set.iter().next() {
                Some(depth) => Entry::At(*depth),
                None => Entry::Conflict,
            }"""),
    ("a callee inherits the depth at the call, arguments and all",
     "src/verify/depth.rs",
     """                if insn.op == OP_CALL {
                    sites.push((body.u16_at(&insn, 0), depth - needs));
                }""",
     """                if insn.op == OP_CALL {
                    sites.push((body.u16_at(&insn, 0), depth));
                }"""),
    ("a call nothing reaches still settles where its callee starts",
     "src/verify/depth.rs",
     """        match effect(body, &insn) {
            Effect::End => {}
            Effect::Call { needs } => {
                if depth < needs {
                    continue;
                }
                if insn.op == OP_CALL {""",
     """        match effect(body, &insn) {
            Effect::End => {}
            Effect::Call { needs } => {
                if insn.op == OP_CALL {"""),
    ("a stack flaw is reported even where the instruction already answered",
     "src/verify/mod.rs",
     """                if let Some(offset) = entry_flaw(body, &entries[func]) {
                    if !found.iter().any(|f| f.offset == offset) {""",
     """                if let Some(offset) = entry_flaw(body, &entries[func]) {
                    if true {"""),
]


def run(tree: pathlib.Path) -> tuple[int, str]:
    proc = subprocess.run(
        ["cargo", "test", "--offline", "--locked", "--test", "image_faults", "--test", "stack_shape"],
        cwd=tree, capture_output=True, text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main() -> int:
    bad = []
    for name, path, before, after in MUTANTS:
        with tempfile.TemporaryDirectory() as tmp:
            tree = pathlib.Path(tmp) / "build"
            shutil.copytree(BUILD, tree, ignore=shutil.ignore_patterns("target", ".git"))
            f = tree / path
            text = f.read_text()
            if before not in text:
                print(f"SKIP  {name}: pattern not found in {path}")
                bad.append(name)
                continue
            f.write_text(text.replace(before, after, 1))
            code, out = run(tree)
            failed = [l.split()[1] for l in out.splitlines() if l.startswith("test ") and l.endswith("FAILED")]
            compiled = "error[E" not in out and "error: could not compile" not in out
            if not compiled:
                print(f"SKIP  {name}: mutant does not compile")
                bad.append(name)
            elif code == 0:
                print(f"MISS  {name}: every graded id still passed")
                bad.append(name)
            else:
                print(f"caught {name}: {len(failed)} ids failed, first {failed[:2]}")
    print()
    if bad:
        print(f"{len(bad)} of {len(MUTANTS)} mutants were not caught")
        return 1
    print(f"all {len(MUTANTS)} mutants caught")
    return 0


if __name__ == "__main__":
    sys.exit(main())
