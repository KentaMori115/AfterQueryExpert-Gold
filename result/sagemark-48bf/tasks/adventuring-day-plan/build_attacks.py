#!/usr/bin/env python3
"""Build each attack patch by writing its files over a fresh base tree."""
import pathlib, shutil, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE.parent.parent / "work"
SRC = HERE / "attack-src"
OUT = HERE / "attacks"


def base_tree(target):
    target.mkdir(parents=True, exist_ok=True)
    tar = subprocess.run(["git", "-C", str(WORK), "archive", "--format=tar", "HEAD"],
                         capture_output=True, check=True).stdout
    subprocess.run(["tar", "-x", "-C", str(target)], input=tar, check=True)
    subprocess.run(["git", "init", "-q", str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(target), "-c", "user.email=b@l", "-c", "user.name=b",
                    "commit", "-qm", "base"], check=True)


def build(name):
    with tempfile.TemporaryDirectory() as tmp:
        tree = pathlib.Path(tmp) / "t"
        base_tree(tree)
        for path in sorted((SRC / name).rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(SRC / name)
            dest = tree / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest)
        subprocess.run(["git", "-C", str(tree), "add", "-A", "-N"], check=True)
        diff = subprocess.run(["git", "-C", str(tree), "diff"], capture_output=True, text=True,
                              check=True).stdout
        (OUT / f"{name}.patch").write_text(diff)
        print(f"{name}: {len(diff.splitlines())} lines")


def main():
    OUT.mkdir(exist_ok=True)
    names = sys.argv[1:] or sorted(p.name for p in SRC.iterdir() if p.is_dir())
    for name in names:
        build(name)


if __name__ == "__main__":
    main()
