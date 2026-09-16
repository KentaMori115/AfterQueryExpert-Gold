#!/usr/bin/env python3
"""Break the reference solution one rule at a time and check the suite notices.

Each mutation is a wrong build a careful implementer could plausibly write.
Every one of them has to drop the reward to 0; a mutation that still scores 1
is a promise the graded suite does not enforce.
"""

import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
WORK = TASK.parent.parent / "work"

MUTATIONS = [
    ("exit prices at the middle, not the touch",
     "Engine/straddle/plan.py",
     """        if leg['instruction'] == 'BUY_TO_CLOSE':
            net += price
        else:
            net -= price""",
     """        other = _touch(quote_map, leg['instrument'].get('symbol'),
                       'bidPrice' if field == 'askPrice' else 'askPrice')
        middle = price if other is None else (price + other) / 2.0
        if leg['instruction'] == 'BUY_TO_CLOSE':
            net += middle
        else:
            net -= middle"""),

    ("a credit rounds down like a debit",
     "Engine/straddle/plan.py",
     "return _order('NET_CREDIT', legs, snap_up(-net, trading_symbol))",
     "return _order('NET_CREDIT', legs, snap_down(-net, trading_symbol))"),

    ("the tick grid is walked in floating point",
     "Engine/straddle/ticks.py",
     """    tick = _tick(trading_symbol)
    ticks = (amount / tick).quantize(Decimal(1), rounding=rounding)
    return float((ticks * tick).quantize(Decimal('0.01')))""",
     """    import math
    tick = float(_tick(trading_symbol))
    value = float(amount) / tick
    ticks = math.floor(value) if rounding == ROUND_FLOOR else math.ceil(value)
    return round(ticks * tick, 2)"""),

    ("closing legs assume one lot",
     "Engine/straddle/plan.py",
     "            'quantity': quantity,\n            'instrument': dict(instrument),",
     "            'quantity': 1,\n            'instrument': dict(instrument),"),

    ("the cushion itself still holds",
     "Engine/straddle/plan.py",
     "if minutes_left is None or minutes_left > cushion_min:",
     "if minutes_left is None or minutes_left >= cushion_min:"),

    ("a session that has run out still works a limit",
     "Engine/straddle/plan.py",
     "                               at_market=minutes_left <= 0)",
     "                               at_market=False)"),

    ("a target is always assumed",
     "Engine/straddle/plan.py",
     "        'cancel_child': bool(children),",
     "        'cancel_child': True,"),

    ("no clock reads as no time left",
     "Engine/straddle/plan.py",
     "    if minutes_left is None or minutes_left > cushion_min:",
     "    if minutes_left is not None and minutes_left > cushion_min:"),

    ("only short legs can be turned around",
     "Engine/straddle/plan.py",
     "    'BUY_TO_OPEN': 'SELL_TO_CLOSE',\n}",
     "}"),

    ("a market order still names a price",
     "Engine/straddle/plan.py",
     "        return _order('MARKET', legs)",
     "        return _order('MARKET', legs, 0.0)"),

    ("a user sized out of the run is still held",
     "Engine/straddle/entries.py",
     "            if sized <= 0:\n                continue",
     "            if sized < -1:\n                continue"),

    ("the group payload goes out unsized",
     "Engine/straddle/entries.py",
     "    for leg in user_payload['orderLegCollection']:\n        leg['quantity'] = lot_size",
     "    for leg in user_payload['orderLegCollection']:\n        pass"),

    ("the traded symbol is the whole group key",
     "Engine/straddle/entries.py",
     "        trading_symbol = str(trading_group).split('-')[0]",
     "        trading_symbol = str(trading_group)"),

    ("a target is booked filled like its entry",
     "Engine/offline.py",
     '            _store(_next_order_id(), username, "WORKING", "offline working",',
     '            _store(_next_order_id(), username, "FILLED", "offline fill",'),

    ("pulling an entry leaves its target working",
     "Engine/offline.py",
     """    for child in paper_child_orders(order_id):
        if child["status"] == "WORKING":
            child["status"] = "CANCELED"
            child["statusDescription"] = "offline cancel\"""",
     """    for child in []:
        if child["status"] == "WORKING":
            child["status"] = "CANCELED"
            child["statusDescription"] = "offline cancel\""""),

    ("a target is reported beside its entry",
     "Engine/offline.py",
     '''            if row.get("username") == username and row.get("parent_id") is None]''',
     '''            if row.get("username") == username]'''),

    ("an entry reports no target inside it",
     "Engine/offline.py",
     """                [_paper_summary(child, [])
                 for child in paper_child_orders(row["order_id"])],""",
     """                [],"""),

    ("pulling a target takes its entry with it",
     "Engine/offline.py",
     '''    row["status"] = "CANCELED"
    row["statusDescription"] = "offline cancel"
    for child in paper_child_orders(order_id):''',
     '''    row["status"] = "CANCELED"
    row["statusDescription"] = "offline cancel"
    parent = _PAPER_ORDERS.get(str(row.get("parent_id")))
    if parent is not None:
        parent["status"] = "CANCELED"
        parent["statusDescription"] = "offline cancel"
    for child in paper_child_orders(order_id):'''),
("the sweep never pulls the working target",
     "Engine/bot/bot02_engine.py",
     "            if plan['cancel_child'] and entry['order_id'] is not None:",
     "            if False and plan['cancel_child'] and entry['order_id'] is not None:"),

    ("the sweep plans but never sends",
     "Engine/bot/bot02_engine.py",
     """            print(f'closing the {trading_symbol} structure of {username}')
            order_result_dict = {}
            send_order(token_type, access_token, account_id, closing_payload,
                       trading_symbol, 'Exit', order_result_dict, username)""",
     """            print(f'closing the {trading_symbol} structure of {username}')
            order_result_dict = {}"""),

    ("a closed entry is still held",
     "Engine/bot/bot02_engine.py",
     """            }})
            self.live_entries.pop(username, None)

        return actions""",
     """            }})

        return actions"""),

    ("the sweep closes whatever the plan says",
     "Engine/bot/bot02_engine.py",
     "            if plan['action'] != 'close':\n                continue",
     "            if False:\n                continue"),

    ("the engine forgets the broker id",
     "Engine/bot/bot02_engine.py",
     "        self.live_entries = live_entries(signal_info, order_result_dict)",
     "        self.live_entries = live_entries(signal_info, None)"),

    ("the engine holds nothing after a run",
     "Engine/bot/bot02_engine.py",
     "        self.live_entries = live_entries(signal_info, order_result_dict)",
     "        self.live_entries = {}"),

    ("the run never tells the engine what it left open",
     "Engine/bot/bot02_engine.py",
     "            self.remember_live_entries(signal_info)",
     "            pass"),

    ("the run never leaves a sweep behind",
     "Engine/bot/bot02_manage.py",
     "        self.StartExitSweep()\n\n        time_zone = BOT2_TIME_ZONE",
     "        time_zone = BOT2_TIME_ZONE"),

    ("the sweep only ever gets to the first entry",
     "Engine/bot/bot02_engine.py",
     "        for username in list(self.live_entries.keys()):",
     "        for username in list(self.live_entries.keys())[:1]:"),

    ("one entry that cannot be unwound ends the sweep",
     "Engine/bot/bot02_engine.py",
     "                print(f'the live entry of {username} cannot be unwound')\n                continue",
     "                print(f'the live entry of {username} cannot be unwound')\n                break"),

    ("every run stacks another sweep",
     "Engine/bot/bot02_manage.py",
     "        if self.exit_sweep_job is not None:\n            return",
     "        pass"),

    ("the sweep keeps coming back with nothing left to do",
     "Engine/bot/bot02_manage.py",
     "        if not report['still_open']:\n            self.StopExitSweep()",
     "        if False:\n            self.StopExitSweep()"),
]


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def main():
    only = sys.argv[1:] 
    caught = []
    missed = []
    for index, (name, path, old, new) in enumerate(MUTATIONS):
        if only and str(index) not in only:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            clone = pathlib.Path(tmp) / "m"
            run(["git", "clone", "-q", "--no-hardlinks", str(WORK), str(clone)])
            run(["git", "checkout", "-q", "solution"], cwd=clone)
            target = clone / path
            text = target.read_text()
            if old not in text:
                print("SETUP FAIL %2d  %s (pattern not found in %s)" % (index, name, path))
                missed.append((index, name, "pattern"))
                continue
            target.write_text(text.replace(old, new, 1))
            diff = run(["git", "diff", "main"], cwd=clone).stdout
            patch = pathlib.Path(tmp) / "model.patch"
            patch.write_text(diff)
            out = run(["bash", str(HERE / "verify_task.sh"), str(patch)]).stdout
            line = [l for l in out.splitlines() if l.startswith("[verify] reward.json:")]
            reward = line[-1] if line else "(no reward)"
            if '"reward": 0' in reward:
                print("caught  %2d  %s" % (index, name))
                caught.append(index)
            else:
                print("MISSED  %2d  %s -> %s" % (index, name, reward))
                missed.append((index, name, reward))

    print("\n%d caught, %d missed" % (len(caught), len(missed)))
    for row in missed:
        print("  missed:", row)
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())
