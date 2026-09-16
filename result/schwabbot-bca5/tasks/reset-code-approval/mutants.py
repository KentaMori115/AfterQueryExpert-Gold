#!/usr/bin/env python3
"""Build a patch per mutation, one defect each, and grade every one.

Each entry rewrites the reference solution in a single place. The verifier is
supposed to answer 0 to all of them: a suite that lets one through is a rule
the tests state and do not enforce.

    ./mutants.py            build and grade every mutant
    ./mutants.py m06        one of them
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent / "repo"
WORK = HERE / "work"

MUTATIONS = [
    ("m01 approval is never stamped", "Users/resetcodes.py",
     "    request.approved_at = timezone.now()\n    request.approvals = request.approvals + 1\n    request.save(update_fields=['approved_at', 'approvals'])\n    return True",
     "    return False"),
    ("m02 revoke keeps the attempt count", "Users/resetcodes.py",
     "    request.call_count = 0\n    request.approved_at = None",
     "    request.approved_at = None"),
    ("m03 revoke reuses the same code", "Users/resetcodes.py",
     "    request.secret_code = new_secret_code(avoid=request.secret_code)\n    request.created_at = timezone.now()",
     "    request.created_at = timezone.now()"),
    ("m04 revoke leaves the approval time", "Users/resetcodes.py",
     "    request.approved_at = None\n    request.secret_code",
     "    request.secret_code"),
    ("m05 revoke does not restart the request date", "Users/resetcodes.py",
     "    request.created_at = timezone.now()\n    request.save(update_fields=[",
     "    request.save(update_fields=["),
    ("m06 four tries instead of three", "Users/resetcodes.py",
     "ATTEMPT_LIMIT = 3", "ATTEMPT_LIMIT = 4"),
    ("m07 exactly the notice is not enough", "Users/resetwindow.py",
     "            if close - moment >= MINIMUM_NOTICE:",
     "            if close - moment > MINIMUM_NOTICE:"),
    ("m08 weekends count as trading days", "Users/resetwindow.py",
     "    return day.weekday() not in WEEKEND_DAYS", "    return True"),
    ("m09 deadline always runs from the request date", "Users/resetcodes.py",
     "    anchor = request.approved_at or request.created_at",
     "    anchor = request.created_at"),
    ("m10 deadline is read in UTC", "Users/resetwindow.py",
     "RESET_TIME_ZONE = 'US/Eastern'", "RESET_TIME_ZONE = 'UTC'"),
    ("m11 the code is read after the password rules", "Users/forms.py",
     """        if not resetcodes.code_matches(user_allow_obj, cleaned_data.get('secret_code')):
            if resetcodes.register_failed_attempt(user_allow_obj):
                raise ValidationError(resetcodes.SPENT_MESSAGE)
            raise ValidationError(resetcodes.WRONG_CODE_MESSAGE)

        # Password matching
        new_password = cleaned_data.get("new_password")
        confirm_password = cleaned_data.get("confirm_password")
        if new_password and confirm_password and new_password != confirm_password:
            raise ValidationError("Passwords don't match")
""",
     """        # Password matching
        new_password = cleaned_data.get("new_password")
        confirm_password = cleaned_data.get("confirm_password")
        if new_password and confirm_password and new_password != confirm_password:
            raise ValidationError("Passwords don't match")

        if not resetcodes.code_matches(user_allow_obj, cleaned_data.get('secret_code')):
            if resetcodes.register_failed_attempt(user_allow_obj):
                raise ValidationError(resetcodes.SPENT_MESSAGE)
            raise ValidationError(resetcodes.WRONG_CODE_MESSAGE)
"""),
    ("m12 an expired request is reported but not sent back", "Users/resetcodes.py",
     "    if has_run_out(request):\n        revoke(request)\n        return EXPIRED",
     "    if has_run_out(request):\n        return EXPIRED"),
    ("m13 step one restarts a queued request every visit", "Users/forms.py",
     "        state = resetcodes.evaluate(user_allow_obj)\n        if state in (resetcodes.EXPIRED, resetcodes.WITHDRAWN):\n            raise ValidationError(resetcodes.EXPIRED_MESSAGE)\n        if state != resetcodes.OPEN:\n            raise ValidationError(resetcodes.REQUEST_PENDING_MESSAGE)",
     "        resetcodes.revoke(user_allow_obj)\n        state = resetcodes.evaluate(user_allow_obj)\n        if state != resetcodes.OPEN:\n            raise ValidationError(resetcodes.REQUEST_PENDING_MESSAGE)"),
    ("m14 the password in force does not count as used", "Users/pwdhistory.py",
     "    current = getattr(user, 'password', '')\n    if current:\n        hashes.append(current)",
     "    current = ''"),
    ("m15 only two passwords are remembered", "Users/pwdhistory.py",
     "REMEMBERED_PASSWORDS = 5", "REMEMBERED_PASSWORDS = 2"),
    ("m16 the settings page skips the reuse rule", "BotList/views.py",
     "            if isStrong and isNew:", "            if isStrong:"),
    ("m17 nothing is remembered on the reset page", "Users/views.py",
     "                pwdhistory.remember(user.id, replaced)", "                pass"),
    ("m19 the replacement code repeats the old one", "Users/resetcodes.py",
     "    code = random.randint(SECRET_CODE_LOWEST, SECRET_CODE_HIGHEST)\n    while avoid is not None and code == int(avoid):\n        code = random.randint(SECRET_CODE_LOWEST, SECRET_CODE_HIGHEST)\n    return code",
     "    if avoid is not None:\n        return int(avoid)\n    return random.randint(SECRET_CODE_LOWEST, SECRET_CODE_HIGHEST)"),
    ("m20 a withdrawn approval reads as merely waiting", "Users/resetcodes.py",
     "        if request.approved_at is not None:\n            revoke(request)\n            return WITHDRAWN\n        return WAITING",
     "        return WAITING"),
    ("m21 sending a request back forgets the approvals", "Users/resetcodes.py",
     "    request.created_at = timezone.now()\n    request.save(update_fields=[",
     "    request.created_at = timezone.now()\n    request.approvals = 0\n    request.save(update_fields=['approvals',"),
    ("m22 a second approval is worth three tries again", "Users/resetcodes.py",
     "    if request.approvals > 1:\n        return REPEAT_ATTEMPT_LIMIT\n    return ATTEMPT_LIMIT",
     "    return ATTEMPT_LIMIT"),
    ("m23 approvals are counted on every look", "Users/resetcodes.py",
     "    if request.approved_at is not None:\n        return False\n    request.approved_at = timezone.now()",
     "    if request.approved_at is not None:\n        request.approvals = request.approvals + 1\n        request.save(update_fields=['approvals'])\n        return False\n    request.approved_at = timezone.now()"),
    ("m24 no minimum notice before the bell", "Users/resetwindow.py",
     "            if close - moment >= MINIMUM_NOTICE:", "            if close > moment:"),
    ("m25 the notice is only an hour", "Users/resetwindow.py",
     "MINIMUM_NOTICE = timedelta(hours=2)", "MINIMUM_NOTICE = timedelta(hours=1)"),
    ("m18 a wrong code costs nothing", "Users/resetcodes.py",
     "    request.call_count = request.call_count + 1", "    request.call_count = request.call_count"),
]


def build(name, relpath, old, new):
    """A repo at the snapshot, the reference solution on top, one line moved."""
    tree = pathlib.Path(tempfile.mkdtemp(prefix="mutant-", dir=str(HERE / "local")))
    root = tree / "t"
    shutil.copytree(REPO, root, symlinks=True,
                    ignore=shutil.ignore_patterns("__pycache__", ".git"))
    git = ["git", "-C", str(root)]
    subprocess.run(git + ["init", "-q", "-b", "main"], check=True)
    subprocess.run(git + ["add", "-A"], check=True)
    subprocess.run(git + ["-c", "user.name=b", "-c", "user.email=b@l",
                          "commit", "-q", "-m", "base"], check=True)
    for item in WORK.rglob("*"):
        if "__pycache__" in item.parts or ".git" in item.parts:
            continue
        if item.is_file():
            dest = root / item.relative_to(WORK)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, dest)
    target = root / relpath
    text = target.read_text()
    if old not in text:
        return None, None
    target.write_text(text.replace(old, new, 1))
    subprocess.run(git + ["add", "-A"], check=True)
    patch = tree / "mutant.patch"
    with patch.open("w") as handle:
        subprocess.run(git + ["diff", "--cached"], stdout=handle, check=True)
    return tree, patch


def grade(patch):
    out = subprocess.run(
        ["bash", str(HERE / "verify_task.sh"), str(patch)],
        capture_output=True, text=True, env={"SKIP_BUILD": "1", "PATH": "/usr/bin:/bin:/usr/local/bin"},
    ).stdout
    for line in out.splitlines():
        if line.startswith('{"reward"'):
            return line
    return out.strip()[-200:] or "no reward line"


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    caught = 0
    total = 0
    for name, relpath, old, new in MUTATIONS:
        if only and not name.startswith(only):
            continue
        total += 1
        tree, patch = build(name, relpath, old, new)
        if patch is None:
            print("%-6s %-52s %s" % ("STALE", name, "anchor no longer in " + relpath))
            continue
        line = grade(patch)
        ok = line.startswith('{"reward": 0')
        caught += 1 if ok else 0
        print("%-6s %-52s %s" % ("CAUGHT" if ok else "MISSED", name, line))
        shutil.rmtree(tree, ignore_errors=True)
    print("\n%d of %d mutants caught" % (caught, total))
    return 0 if caught == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
