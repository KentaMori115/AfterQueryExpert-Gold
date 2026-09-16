from explore3 import show, green
veterans = [{"id":"ilva","xp":6500},{"id":"brann","xp":900},{"id":"sela","xp":287},{"id":"oskar","xp":310}]
show("F2 leftover 49", veterans, [{"id":"cellar-rats","monsterXps":[49]},{"id":"bridge-toll","monsterXps":[150,150,125]}])
show("F2b leftover 48", veterans, [{"id":"cellar-rats","monsterXps":[48]},{"id":"bridge-toll","monsterXps":[150,150,125]}])
show("F5 twins", green(), [{"id":"heavy","monsterXps":[350]},{"id":"twin-a","monsterXps":[250]},{"id":"twin-b","monsterXps":[250]}])
show("F5 twins reversed", green(), [{"id":"heavy","monsterXps":[350]},{"id":"twin-b","monsterXps":[250]},{"id":"twin-a","monsterXps":[250]}])
show("F5 nothing to fight", green(), [{"id":"empty-camp","monsterXps":[0,0]},{"id":"toll-bridge","monsterXps":[120]}])
show("F6 all deadly", green(), [{"id":"wyrm","monsterXps":[900]}])
show("F6 empty slate", green(), [])
show("F6 one character", [{"id":"solo","xp":0}], [{"id":"stray","monsterXps":[10]},{"id":"pack","monsterXps":[10,10]}])
