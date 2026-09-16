from ex import *
posts = [{"id": f"post-{i}", "monsterXps":[199]} for i in range(1,7)]
show("F3 posts 1200", [M(i,0) for i in FOUR], posts + [{"id":"toll","monsterXps":[6]}])
show("F3b posts 1201", [M(i,0) for i in FOUR], posts + [{"id":"toll","monsterXps":[7]}])
mixed = [M("ilva",6500), M("brann",900), M("sela",287), M("oskar",310)]
show("F2 leftover 49", mixed, [{"id":"cellar-rats","monsterXps":[49]},{"id":"bridge-toll","monsterXps":[150,150,125]}])
show("F2b leftover 48", mixed, [{"id":"cellar-rats","monsterXps":[48]},{"id":"bridge-toll","monsterXps":[150,150,125]}])
show("F4 rounding", [M(i,0) for i in FOUR], [{"id":"odd","monsterXps":[51,50]}])
show("F4 zero monsters", [M(i,0) for i in FOUR], [{"id":"mob","monsterXps":[100,0,100]}])
show("F5 twins", [M(i,0) for i in FOUR], [{"id":"heavy","monsterXps":[350]},{"id":"twin-a","monsterXps":[250]},{"id":"twin-b","monsterXps":[250]}])
show("F5 camps", [M(i,0) for i in FOUR], [{"id":"empty-camp","monsterXps":[0,0]},{"id":"toll-bridge","monsterXps":[120]}])
show("F6 wyrm", [M(i,0) for i in FOUR], [{"id":"wyrm","monsterXps":[900]}])
show("F1b gate alone", [M(i,290) for i in FOUR], [{"id":"gate-watch","monsterXps":[200,200]}])
show("wide spread", [M("brann",0),M("sela",0),M("oskar",0),M("ilva",14000)], [{"id":"warband","monsterXps":[450,450]}])
show("three quarters", [M("brann",0),M("sela",300),M("oskar",300),M("wren",300)], [{"id":"crossroads","monsterXps":[380]}])
show("solo", [M("solo",0)], [{"id":"stray","monsterXps":[10]},{"id":"pack","monsterXps":[10,10]}])
