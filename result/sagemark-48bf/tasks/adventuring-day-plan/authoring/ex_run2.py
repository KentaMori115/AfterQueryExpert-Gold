from ex import *
seven = ["brann","sela","oskar","wren","ilva","tarn","mira"]
show("F9c seven strong", [M(i,0) for i in seven], [{"id":"trio","monsterXps":[100,100,100]}])
show("F9d seven, two down", [M("brann",0,["prone"]), M("sela",0,["restrained"])] + [M(i,0) for i in seven[2:]],
     [{"id":"trio","monsterXps":[100,100,100]}])
show("F8a thinning day", [M("brann",0,[],2), M("sela",0,[],1), M("oskar",0), M("wren",0)],
     [{"id":"barrow","monsterXps":[250]},{"id":"weir","monsterXps":[150]},{"id":"lane","monsterXps":[90]}])
show("F8b everybody at two", [M(i,0,[],2) for i in FOUR],
     [{"id":"barrow","monsterXps":[250]},{"id":"weir","monsterXps":[150]}])
show("F8c everybody spent", [M(i,0,[],3) for i in FOUR], [{"id":"lane","monsterXps":[90]}])
