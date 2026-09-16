from ex import *

show("F1 first light", [M(i, 290) for i in FOUR],
     [{"id":"gate-watch","monsterXps":[200,200]},{"id":"rat-nest","monsterXps":[50]},{"id":"sewer-run","monsterXps":[50]}])
show("F7a one poisoned of four", [M("brann",0,["poisoned"]), M("sela",0), M("oskar",0), M("wren",0)],
     [{"id":"barrow","monsterXps":[250]}])
show("F7b one charmed of four", [M("brann",0,["charmed"]), M("sela",0), M("oskar",0), M("wren",0)],
     [{"id":"barrow","monsterXps":[250]}])
show("F7c one unconscious of four", [M("brann",0,["unconscious"]), M("sela",0), M("oskar",0), M("wren",0)],
     [{"id":"barrow","monsterXps":[250]}])
show("F7d one at exhaustion 3", [M("brann",0,[],3), M("sela",0), M("oskar",0), M("wren",0)],
     [{"id":"barrow","monsterXps":[250]}])
show("F9a three, one poisoned", [M("brann",0,["poisoned"]), M("sela",0), M("oskar",0)],
     [{"id":"pair","monsterXps":[60,60]}])
show("F9b three, none poisoned", [M("brann",0), M("sela",0), M("oskar",0)],
     [{"id":"pair","monsterXps":[60,60]}])
