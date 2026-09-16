from ex import *
twins = [{"id":"heavy","monsterXps":[350]},{"id":"twin-a","monsterXps":[250]},{"id":"twin-b","monsterXps":[250]},{"id":"twin-c","monsterXps":[250]}]
show("twins four", [M(i,0) for i in FOUR], twins)
rev = [twins[0], twins[3], twins[2], twins[1]]
show("twins reversed", [M(i,0) for i in FOUR], rev)
show("poisoned tires nobody", [M("brann",0,["poisoned"]), M("sela",0), M("oskar",0), M("wren",0)],
     [{"id":"barrow","monsterXps":[250]},{"id":"weir","monsterXps":[120]}])
