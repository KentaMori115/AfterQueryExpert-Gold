Shows get designed against house catalog and fired from whatever sits in magazine, and only `inventory` notices. substitutesFor knows what could stand in, nothing calls it. Make compile fire from stock.

compile takes a magazine plus pull, lot numbers quarantined before drawing, without touching the book passed in. Show commands gain `--magazine book.csv` and `--pull vn2405,vn2413`.

Draw in firing order, visible time then script order, each shot taking its own effect while stock lasts. Later cues go without. Only once every cue has drawn its own go back for those left short, same order. Candidates are what substitutesFor offers by default, same calibre ahead of band match, nearest lead next, then id. A unit lent is gone, so one shortfall may span several stand-ins. Nothing covers a shot, it keeps what was written and show is not ready.

Within one effect drain the lot received earliest, undated last, ties by lot number.

A covered shot keeps its cue time and lifts on stand-in's lead, height clause and all. Its event carries stand-in as effectId and effect, script's ask as substitutedFor, lot drawn as lot. Own draw carries lot alone. Pins and safety checks see stand-in.

One PF1601 note per asked-for and stand-in pair on calibre match, PF1602 warning on band only, each counted, one PF1600 error per effect left short. Cue sheet grows a lot column once a magazine is given.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
