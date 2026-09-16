import sys
from datetime import datetime
import pytz
import schedule
import time
import os
from threading import Thread

# getting the name of the directory
# where the this file is present.
current = os.path.dirname(os.path.realpath(__file__))
# Getting the parent directory name
# where the current directory is present.
parent = os.path.dirname(os.path.dirname(current))
# adding the parent directory to 
# the sys.path.
sys.path.append(parent)

from Engine.config import *
from bot01_manage import Bot01Manage
from bot02_manage import Bot02Manage


class BotManage():
    def __init__(self):
        self.InitVars()


    def InitVars(self):
        #init bot01 vars
        self.bot01_manage = Bot01Manage()
        self.bot02_manage = Bot02Manage()



    def RunBot(self):
        process01 = Thread(target = self.bot01_manage.SetRunTime, args = [])
        process02 = Thread(target = self.bot02_manage.SetRunTime, args = [])
        process01.start()
        process02.start()

        process01.join()
        print('ended process01')
        process02.join()
        print('ended process02')



        while True:
            schedule.run_pending()
            time.sleep(1)


# Run the application
if __name__ == "__main__":
    bot_manage = BotManage()
    print('Running all bots...')
    bot_manage.RunBot()

