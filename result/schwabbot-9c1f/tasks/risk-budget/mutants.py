#!/usr/bin/env python3
"""Break the reference one rule at a time and check the held-back cases notice.

Each row rewrites one decision in the solution tree, runs the two held-back
modules in the environment image, and prints how many cases failed. A row that
fails nothing is a rule nobody is grading.

    ./mutants.py
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE.parent.parent / "work"
IMAGE = "schwab-env-9c1f:v2"

MUTANTS = [
    ("floor of one lot survives the cap", "Engine/risk.py",
     "    if allowed < 1:\n        return 0\n\n    lot_debit", "    if allowed < 1:\n        return 1\n\n    lot_debit"),
    ("affordable lots rounded up", "Engine/risk.py",
     "affordable = int(math.floor(remaining / lot_debit))", "affordable = int(math.ceil(remaining / lot_debit))"),
    ("day lot cap ignored", "Engine/risk.py",
     "    lots_left_today = limit_obj.max_lots_per_day - committed_lots(user_id)",
     "    lots_left_today = limit_obj.max_lots_per_day"),
    ("order lot cap ignored", "Engine/risk.py",
     "    allowed = min(int(lots), limit_obj.max_lots_per_order)", "    allowed = int(lots)"),
    ("percentage cap read as dollars", "Engine/risk.py",
     "        return account_equity(user_id) * (limit_obj.cap_percentage / 100.0)",
     "        return limit_obj.daily_debit_cap"),
    ("trading day taken in UTC", "Engine/risk.py",
     "    trading_tz = pytz.timezone(TRADING_TIME_ZONE)\n    return moment.astimezone(trading_tz).strftime(\"%Y-%m-%d\")",
     "    return moment.strftime(\"%Y-%m-%d\")"),
    ("naive moment read as local", "Engine/risk.py",
     "        moment = moment.replace(tzinfo = datetime_timezone.utc)",
     "        moment = moment.replace(tzinfo = pytz.timezone(TRADING_TIME_ZONE))"),
    ("cancel keeps holding the debit", "Engine/risk.py",
     "    BotRiskCommitment.objects.filter(order_id = f\"{order_id}\").delete()",
     "    return"),
    ("cancel hands back every time", "Engine/risk.py",
     "def release_order(order_id):", "def release_order_unused(order_id):"),
    ("skipped send writes no message", "Engine/risk.py",
     "    UserMessage.objects.create(\n        user_id = user_id,",
     "    UserMessage.objects.filter(user_id = user_id).exclude(user_id = user_id).count()\n    return\n    UserMessage.objects.create(\n        user_id = user_id,"),
    ("skipped send leaves the bot running", "Engine/risk.py",
     "    stop_bot(user_id)", "    return"),
    ("a limit that is off still meters", "Engine/risk.py",
     "    if limit_obj is None or not limit_obj.enabled:\n        return None", "    if limit_obj is None:\n        return None"),
    ("orders that are not combos are metered", "Engine/server_api.py",
     "    lot_size = payload['orderLegCollection'][0]['quantity']\n    #update the detailed run setting for the curent user and current bot\n    if order_type == 'combo_order':",
     "    lot_size = payload['orderLegCollection'][0]['quantity']\n    #update the detailed run setting for the curent user and current bot\n    if True:"),
    ("nothing is held against the day", "Engine/server_api.py",
     "        if order_type == 'combo_order':\n            risk.commit_order(user_id, order_id, payload['price'], lot_size)\n        return order_id, order_state, lot_size, status_description",
     "        return order_id, order_state, lot_size, status_description"),
    ("negative numbers are saved", "AdminCustom/views.py",
     "        if daily_debit_cap < 0 or cap_percentage < 0:\n            return JsonResponse({'error':\"invalid risk budget\"}, status = 400)",
     "        if False:\n            return JsonResponse({'error':\"invalid risk budget\"}, status = 400)"),
    ("any cap type is saved", "AdminCustom/views.py",
     "        if cap_type not in [risk.CAP_FIXED, risk.CAP_BY_ACCOUNT_BALANCE]:",
     "        if False:"),
    ("the day cannot be released", "AdminCustom/views.py",
     "        risk.release_day(user_obj.id)", "        pass"),
    ("a spent trader still starts the bot", "BotList/views.py",
     "        if spent_money or spent_lots:", "        if False:"),
    ("a trader out of lots still starts the bot", "BotList/views.py",
     "        if spent_money or spent_lots:", "        if spent_money:"),
    ("a trader out of money still starts the bot", "BotList/views.py",
     "        if spent_money or spent_lots:", "        if spent_lots:"),
    ("the skip message says nothing useful", "Engine/risk.py",
     "SKIP_MESSAGE = (\n    \"Your bot order was skipped: today's risk budget has no room left for \"\n    \"another lot. Ask the administrator to raise the daily cap.\"\n)",
     "SKIP_MESSAGE = \"Your bot order was skipped.\""),
    ("the ledger is not day scoped", "Engine/risk.py",
     "    commitment_objs = BotRiskCommitment.objects.filter(user_id = user_id, trade_date = day)\n    for commitment_obj in commitment_objs:\n        total += commitment_obj.debit",
     "    commitment_objs = BotRiskCommitment.objects.filter(user_id = user_id)\n    for commitment_obj in commitment_objs:\n        total += commitment_obj.debit"),
    ("the lot ledger is not day scoped", "Engine/risk.py",
     "    commitment_objs = BotRiskCommitment.objects.filter(user_id = user_id, trade_date = day)\n    for commitment_obj in commitment_objs:\n        total += commitment_obj.lots",
     "    commitment_objs = BotRiskCommitment.objects.filter(user_id = user_id)\n    for commitment_obj in commitment_objs:\n        total += commitment_obj.lots"),
    ("anyone may save a budget", "AdminCustom/views.py",
     "@login_required\n@user_passes_test(lambda u: u.is_superuser)\n@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)\ndef risk_budget_change(request):",
     "@login_required\n@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)\ndef risk_budget_change(request):"),
    ("anyone may release a day", "AdminCustom/views.py",
     "@login_required\n@user_passes_test(lambda u: u.is_superuser)\n@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)\ndef risk_budget_release(request):",
     "@login_required\n@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)\ndef risk_budget_release(request):"),
    ("contract multiplier shrunk", "Engine/risk.py",
     "CONTRACT_MULTIPLIER = 100", "CONTRACT_MULTIPLIER = 10"),
    ("day lot cap off by one", "Engine/risk.py",
     "    if lots_left_today < allowed:", "    if lots_left_today < allowed - 1:"),
    ("an exhausted day still shows money", "Engine/risk.py",
     "    remaining = daily_cap(limit_obj, user_id) - committed_debit(user_id)\n    if remaining < 0:\n        remaining = 0.0\n    return remaining",
     "    return daily_cap(limit_obj, user_id)"),
    ("a cap that exactly fits buys one lot less", "Engine/risk.py",
     "    affordable = int(math.floor(remaining / lot_debit))",
     "    affordable = int(math.floor(remaining / lot_debit)) - 1 if remaining % lot_debit == 0 else int(math.floor(remaining / lot_debit))"),
]


def run(tree: Path) -> tuple[int, int, str]:
    proc = subprocess.run(
        ["docker", "run", "--rm", "--network", "none", "-v", f"{tree}:/app", "-w", "/app",
         IMAGE, "python3", "manage.py", "test",
         "tests.test_risk_budget", "tests.test_risk_budget_admin"],
        capture_output=True, text=True,
    )
    tail = proc.stdout[-400:] + proc.stderr[-2000:]
    ran = re.search(r"Ran (\d+) tests", tail)
    bad = re.search(r"failures=(\d+)", tail)
    err = re.search(r"errors=(\d+)", tail)
    failed = (int(bad.group(1)) if bad else 0) + (int(err.group(1)) if err else 0)
    return (int(ran.group(1)) if ran else -1), failed, tail


def main() -> int:
    losses = 0
    for name, rel, old, new in MUTANTS:
        tree = Path(tempfile.mkdtemp(prefix="mutant-"))
        shutil.rmtree(tree)
        shutil.copytree(WORK, tree)
        path = tree / rel
        text = path.read_text()
        if text.count(old) != 1:
            print(f"SKIP  {name}: anchor not unique in {rel}")
            losses += 1
            continue
        path.write_text(text.replace(old, new))
        ran, failed, tail = run(tree)
        verdict = "caught" if failed > 0 else "SURVIVED"
        if failed <= 0:
            losses += 1
        print(f"{verdict:9} {name}: ran {ran}, failed {failed}")
        if failed <= 0:
            print(tail[-300:])
        shutil.rmtree(tree, ignore_errors=True)
    print("survivors:", losses)
    return 1 if losses else 0


if __name__ == "__main__":
    sys.exit(main())
