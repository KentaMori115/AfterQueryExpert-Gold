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
from bot02_engine import Bot02Engine


class Bot02Manage():
    def __init__(self):
        self.InitVars()


    def InitVars(self):
        #init bot01 vars
        self.bot_engine = Bot02Engine()
        self.bot_run_job = None
        self.bot_run_trading_prepare_job = None
        self.bot_info_trading_prepare_job = None
        self.bot_info_trading_prepare_job_cancelled = True

        self.process_run_prepare = None


    def SetRunTime(self):
        #read bot1 setting from config.py
        trade_prepare_taking_min = BOT2_PRE_TRADING_MIN

        time_zone = BOT2_TIME_ZONE
        run_hour = BOT2_RUN_HOUR
        run_min = BOT2_RUN_MIN
        check_min = BOT2_CHECK_MIN

        #  =====================  Bot 2 ===================
        # This is necessary for immediate running the bot, which should be removed for a real trading
        #self.SetInfo()
        #time.sleep(info_taking_sec)
        #self.TradingPrepare()
        #self.Run()


        #calculate the time of preparing trading
        run_tot_min = run_hour*60 + run_min
        trading_prepare_tot_min = run_tot_min - trade_prepare_taking_min
        if trading_prepare_tot_min < 0:
            trading_prepare_tot_min += 1440

        trading_prepare_min = trading_prepare_tot_min % 60
        trading_prepare_hour = (int)(trading_prepare_tot_min/60)


        bot_check_tot_min = run_tot_min - check_min
        if bot_check_tot_min < 0:
            bot_check_tot_min += 1440

        bot_check_min = bot_check_tot_min % 60
        bot_check_hour = (int)(bot_check_tot_min/60)


        bot_trade_prepare_time = f"{trading_prepare_hour:02d}:{trading_prepare_min:02d}"
        bot_run_time = f"{run_hour:02d}:{run_min:02d}"
        bot_check_time = f"{bot_check_hour:02d}:{bot_check_min:02d}"
        print(f"Bot2 Setting Rume:{bot_check_time} | {bot_trade_prepare_time} | {bot_run_time}")

        #schedule running each job
        self.bot_info_trading_prepare_job = schedule.every().day.at(bot_trade_prepare_time, time_zone).do(self.TradingPrepareForSetInfo)
        self.bot_run_job = schedule.every().day.at(bot_run_time, time_zone).do(self.Run)
        schedule.every().day.at(bot_check_time, time_zone).do(self.BotCheckFun)

    def BotCheckFun(self):
        time_zone = BOT1_TIME_ZONE
        TZ = pytz.timezone(time_zone)
        curDate = datetime.now(TZ)
        print(f'======================   Bot2 is working at {curDate} ===================')



    def TradingPrepareForRun(self):
        if self.bot_info_trading_prepare_job_cancelled:
            schedule.cancel_job(self.bot_run_trading_prepare_job)
            self.bot_run_trading_prepare_job = None
            return

        if self.process_run_prepare is None:
            print('prepare trading for bot02...')
            self.process_run_prepare = Thread(target = self.bot_engine.prepare_trading, args = [])
            self.process_run_prepare.start()
        else:
            if not self.process_run_prepare.is_alive():
                if self.bot_engine.trading_ready:
                    self.process_run_prepare = None
                    self.bot_info_trading_prepare_job_cancelled = True
                    print('finished trading preparation for bot02')
                else:
                    print('prepare trading for bot02 again...')
                    self.process_run_prepare = Thread(target = self.bot_engine.prepare_trading, args = [])
                    self.process_run_prepare.start()

    def TradingPrepareForSetInfo(self):
        self.bot_engine.set_server_info()
        self.bot_info_trading_prepare_job_cancelled = False
        self.bot_run_trading_prepare_job = schedule.every(10).seconds.do(self.TradingPrepareForRun)



    def Run(self):
        self.bot_info_trading_prepare_job_cancelled = True
        time_zone = BOT2_TIME_ZONE
        TZ = pytz.timezone(time_zone)
        curDate = datetime.now(TZ)
        dayOfWeek = curDate.weekday()
        if dayOfWeek == 5 or dayOfWeek == 6:
            return

        if self.process_run_prepare is not None:
            print('delaying: server over running time')
            self.process_run_prepare.join()
            self.process_run_prepare = None


        if self.bot_engine.trading_ready == False:
            print('Trading is not prepared yet for Bot1')
            return


        #self.bot_engine.execute_strategy()
        process = Thread(target = self.bot_engine.execute_strategy, args = [])
        process.start()

        self.bot_trading_prepared = False

