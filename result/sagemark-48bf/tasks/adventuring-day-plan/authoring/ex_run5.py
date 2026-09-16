from ex import *
show("a nobody-left day", [M(i,0,[],3) for i in FOUR], [{"id":"stoat","monsterXps":[5]}])
show("one still fresh", [M("brann",0,[],3),M("sela",0,[],3),M("oskar",0,[],3),M("wren",0)], [{"id":"stoat","monsterXps":[5]}])
show("veteran frightened", [M("brann",0),M("sela",0),M("oskar",0),M("ilva",14000,["frightened"])],
     [{"id":"barrow","monsterXps":[250]}])
show("veteran fine", [M("brann",0),M("sela",0),M("oskar",0),M("ilva",14000)],
     [{"id":"barrow","monsterXps":[250]}])
show("two steps in, three picks", [M(i,0,[],2) for i in FOUR],
     [{"id":"barrow","monsterXps":[250]},{"id":"weir","monsterXps":[150]},{"id":"lane","monsterXps":[90]}])
show("ledger lite", [M(i,0) for i in FOUR], [{"id":"ledger-lite","monsterXps":[67,65]},{"id":"gully","monsterXps":[150]}])
show("ledger", [M(i,0) for i in FOUR], [{"id":"ledger","monsterXps":[67,66]},{"id":"gully","monsterXps":[150]}])
