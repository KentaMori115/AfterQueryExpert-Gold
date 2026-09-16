from explore3 import show, green
show("ledger rounding", green(), [{"id":"ledger","monsterXps":[67,66]},{"id":"gully","monsterXps":[150]}])
show("long-road", [{"id":i,"xp":290} for i in ["brann","sela","oskar","wren"]],
     [{"id":"gate-watch","monsterXps":[200,200]},{"id":"rat-nest","monsterXps":[50]},{"id":"long-road","monsterXps":[599]}])
show("wide spread", [{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"ilva","xp":14000}],
     [{"id":"warband","monsterXps":[450,450]}])
show("three quarters", [{"id":"brann","xp":0},{"id":"sela","xp":300},{"id":"oskar","xp":300},{"id":"wren","xp":300}],
     [{"id":"crossroads","monsterXps":[380]}])
show("two empty camps", green(), [{"id":"camp-a","monsterXps":[0]},{"id":"ford","monsterXps":[350]},{"id":"camp-b","monsterXps":[0,0,0]}])
