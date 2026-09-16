import json
from reference import plan_day, assess, shape

FIX = {
 "first-light": ([{"id":"brann","xp":290},{"id":"sela","xp":290},{"id":"oskar","xp":290},{"id":"wren","xp":290}],
   [{"id":"gate-watch","monsterXps":[200,200]},{"id":"rat-nest","monsterXps":[50]},{"id":"sewer-run","monsterXps":[50]}]),
 "first-light-alone": ([{"id":"brann","xp":290},{"id":"sela","xp":290},{"id":"oskar","xp":290},{"id":"wren","xp":290}],
   [{"id":"gate-watch","monsterXps":[200,200]}]),
 "leftover-49": ([{"id":"ilva","xp":6500},{"id":"brann","xp":900},{"id":"sela","xp":287},{"id":"oskar","xp":310}],
   [{"id":"cellar-rats","monsterXps":[49]},{"id":"bridge-toll","monsterXps":[150,150,125]}]),
 "leftover-48": ([{"id":"ilva","xp":6500},{"id":"brann","xp":900},{"id":"sela","xp":287},{"id":"oskar","xp":310}],
   [{"id":"cellar-rats","monsterXps":[48]},{"id":"bridge-toll","monsterXps":[150,150,125]}]),
 "posts-1200": ([{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"wren","xp":0}],
   [{"id":f"post-{i}","monsterXps":[199]} for i in range(1,7)] + [{"id":"toll","monsterXps":[6]}]),
 "posts-1201": ([{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"wren","xp":0}],
   [{"id":f"post-{i}","monsterXps":[199]} for i in range(1,7)] + [{"id":"toll","monsterXps":[7]}]),
 "pair": ([{"id":"brann","xp":0},{"id":"sela","xp":0}],
   [{"id":"pair","monsterXps":[20,20]},{"id":"lone","monsterXps":[30]}]),
 "six": ([{"id":i,"xp":0} for i in ["brann","sela","oskar","wren","ilva","tarn"]],
   [{"id":"trio","monsterXps":[100,100,100]},{"id":"lone","monsterXps":[300]}]),
 "zero-monsters": ([{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"wren","xp":0}],
   [{"id":"mob","monsterXps":[100,0,100]}]),
 "rounding": ([{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"wren","xp":0}],
   [{"id":"odd","monsterXps":[51,50]}]),
 "twins": ([{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"wren","xp":0}],
   [{"id":"heavy","monsterXps":[350]},{"id":"twin-a","monsterXps":[250]},{"id":"twin-b","monsterXps":[250]}]),
 "twins-reversed": ([{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"wren","xp":0}],
   [{"id":"heavy","monsterXps":[350]},{"id":"twin-b","monsterXps":[250]},{"id":"twin-a","monsterXps":[250]}]),
 "empty-camp": ([{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"wren","xp":0}],
   [{"id":"empty-camp","monsterXps":[0,0]},{"id":"toll-bridge","monsterXps":[120]}]),
 "wyrm": ([{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"wren","xp":0}],
   [{"id":"wyrm","monsterXps":[900]}]),
 "solo": ([{"id":"solo","xp":0}], [{"id":"stray","monsterXps":[10]},{"id":"pack","monsterXps":[10,10]}]),
 "ladder": ([{"id":"brann","xp":0},{"id":"sela","xp":0},{"id":"oskar","xp":0},{"id":"wren","xp":0}],
   [{"id":"ford","monsterXps":[350]},{"id":"mill","monsterXps":[300]},{"id":"barrow","monsterXps":[250]},
    {"id":"weir","monsterXps":[200]},{"id":"lane","monsterXps":[100]}]),
}
for name,(party,slate) in FIX.items():
    print("###", name)
    print(json.dumps(plan_day(party, slate), indent=1))
