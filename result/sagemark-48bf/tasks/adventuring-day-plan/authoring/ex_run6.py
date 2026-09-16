from ex import *
posts = [{"id": f"post-{i}", "monsterXps":[199]} for i in range(1,7)]
show("toll 5", [M(i,0) for i in FOUR], posts + [{"id":"toll","monsterXps":[5]}])
show("mean 2.5", [M("brann",300),M("sela",300),M("oskar",900),M("wren",900)], [{"id":"keep","monsterXps":[700]}])
show("levels not totals", [M("brann",299),M("sela",299),M("oskar",299),M("ilva",6500)], [{"id":"keep","monsterXps":[700]}])
show("thinning allowance", [M("brann",0,[],2),M("sela",0,[],2),M("oskar",0),M("wren",0)],
     [{"id":"barrow","monsterXps":[250]},{"id":"weir","monsterXps":[250]}])
show("order matters twice", [M(i,0,[],2) for i in FOUR],
     [{"id":"big","monsterXps":[350]},{"id":"small","monsterXps":[40]}])
