import schwab
import schedule
import time
import httpx
import json

from datetime import datetime, timezone
import pytz
import os
import math

from websocket import create_connection
from threading import Thread


import sys
import copy

# getting the name of the directory
# where the this file is present.
current = os.path.dirname(os.path.realpath(__file__))
# Getting the parent directory name
# where the current directory is present.
parent = os.path.dirname(os.path.dirname(current))
# adding the parent directory to 
# the sys.path.
sys.path.append(parent)


from Engine.bot_api import *
from Engine.schwab_api import *
from Engine.config import *
from Engine.straddle import exit_plan, live_entries, minutes_to_close

class Bot02Engine:
    def __init__(self):
        self.set_bot_info()
        self.trading_ready = False
        self.live_entries = {}
        self.closed_entries = {}

    def set_bot_info(self):
        self.vix_index_symbol = '$VIX'
        #self.TRADE_INDEX_SYMBOL = '$SPX'
        #self.TRADE_INDEX_SYMBOL = 'SPY'


        self.token_path = f"../setting/{BOT2_TOKEN_PATH}"
        self.user_info_path = f"../setting/{BOT2_USER_INFO_PATH}"
        self.admin_info_path = f"../setting/{BOT2_ADMIN_INFO_PATH}"
        self.time_zone = BOT2_TIME_ZONE

    def set_server_info(self):
        self.trading_ready = False
        #delete old bot2 token file
        if os.path.exists(self.token_path):
            os.remove(self.token_path)
        #delete old bot1 user info file
        if os.path.exists(self.user_info_path):
            os.remove(self.user_info_path)
        #delete old bot1 admin info file
        if os.path.exists(self.admin_info_path):
            os.remove(self.admin_info_path)

        try:
            print('sending the signal of getting bot2 info')
            ws = create_connection(f"{WS_ENDPOINT}/ws/signalpath/")
            ws.send(
                json.dumps({
                    'bot_name':'bot02',
                    'message':"set_server_info",
                })
            )
        except:
            print('failed to connect websocket in setting the server info for bot2')


    def prepare_trading(self):
        #read refresh token file
        if os.path.exists(self.token_path):
            try:
                with open (self.token_path, 'r') as token_file:
                    self.refresh_token_info = json.load(token_file)
            except:
                print('bot2 reading token file error')
                return False
        else:
            print('bot2 refresh token does not exist in authenticate')
            return False

        #read admin setting
        if os.path.exists(self.admin_info_path):
            with open(self.admin_info_path, 'r') as admin_file:
                self.admin_info = json.load(admin_file)
        else:
            print('bot2 admin setting file does not exist')
            return False
        
        #read user setting
        if os.path.exists(self.user_info_path):
            with open(self.user_info_path, 'r') as user_file:
                self.user_info = json.load(user_file)
        else:
            print('bot2 user setting file does not exist')
            return False

        
        user_names = list(self.user_info.keys())
        #get user access token info
        self.access_token_info = {}
        for username in user_names:
            headers = get_token_req_headers(CLIENT_ID, CLIENT_SECRET)
            refresh_token = self.refresh_token_info.get(username)
            if refresh_token is None:
                self.user_info.pop(username)
                continue

            access_token = None
            try:
                access_token = generate_access_token(headers, refresh_token)
            except:
                pass
            
            if access_token is None:
                self.user_info.pop(username)
                continue

            self.access_token_info.update({username:access_token})

        user_names = self.user_info.keys()

        #get user account info
        self.account_info = {}
        for username in user_names:
            account_id = None
            access_token = self.access_token_info[username]
            if access_token is not None:
                account_details = get_account_details('Bearer', self.access_token_info[username])
                if account_details is not None and len(account_details) > 0:
                    account_id = account_details[0]['hashValue']
            self.account_info.update({username:account_id})

        #get the user account balance
        self.balance_info = {}
        for username in user_names:
            acc_balance = 0
            access_token = self.access_token_info[username]
            if access_token is not None:
                balance_headers = get_access_headers('Bearer', self.access_token_info[username])
                acc_balance = schwab_api_get_account_balance(balance_headers)
            self.balance_info.update({username:acc_balance})






        #generate general access headers
        self.access_headers = None
        self.access_token = None
        token_type = 'Bearer'
        for username in user_names:
            if self.access_token_info[username] is not None:
                access_token = self.access_token_info[username]
                self.access_headers = get_access_headers(token_type, access_token)
                self.access_token = access_token
                break

        if self.access_headers is None:
            print('No valid access token for Bot2')
            return False        

        print('bot2 ready inside engine')
        self.trading_ready = True
        return True




    '''
    2. Condition: VIX Gaps Lower
    The VIX gaps lower compared to it's 4:15 pm EST close the previous trading day
    Current Price: The price of the VIX at 9:35 AM EST.
            Current VIX Price < Previous Close VIX Price
        If the VIX data is not available or the condition is not met, do nothing.
    '''
    def get_vix_data(self):
        """
        Fetch the current VIX price and the previous close price.
        """
        #get the trading timezone
        trading_tz = pytz.timezone(self.time_zone)


        curr_dt = datetime.now()
        cur_timestamp = int(round(curr_dt.timestamp()*1000))

        prevday_close = 0
        daily_history_candles = schwab_api_get_history_candle(
            headers = self.access_headers, 
            symbol = self.vix_index_symbol,
            period_type = 'month',
            period = 1,
            freq_type = 'daily',
            freq = 1,
            end_date = cur_timestamp
            )

        if daily_history_candles is not None:
            prev_day_candle = daily_history_candles[-2]
            prevday_close = prev_day_candle['close']



        today_open = 0
        found_today_open = False
        #get the 1-min candle
        history_min_candles = schwab_api_get_history_candle(
            headers = self.access_headers, 
            symbol = self.vix_index_symbol,
            period_type = 'day',
            period = 1,
            freq_type = 'minute',
            freq = 1,
            end_date = cur_timestamp
            )

        if history_min_candles is not None:
            history_min_candle_n = len(history_min_candles)

            for i in range(1, history_min_candle_n):
                cur_candle = history_min_candles[-i]
                cur_candle_datetime = datetime.fromtimestamp(cur_candle['datetime']//1000)
                cur_candle_datetime_tz = cur_candle_datetime.astimezone(trading_tz)
                cur_candle_date_tzstr = cur_candle_datetime_tz.strftime("%Y-%m-%d")
                cur_candle_time_tzstr = cur_candle_datetime_tz.strftime("%H:%M:%S")

                cur_candle_hour = cur_candle_datetime_tz.hour
                cur_candle_minute = cur_candle_datetime_tz.minute
                cur_candle_hm = cur_candle_hour*100 + cur_candle_minute
                if cur_candle_hm < 930:
                    break


                #print(cur_candle)
                #print(cur_candle_date_tzstr, cur_candle_time_tzstr)
                today_open = cur_candle['open']

        return today_open, prevday_close





    def find_otm_options(self, call_options_chain, put_options_chain, target_gap, use_same_spread_diff):
        call_underlying_price = call_options_chain["underlyingPrice"]
        put_underlying_price = put_options_chain["underlyingPrice"]
        underlying_price = (call_underlying_price + put_underlying_price)/2.0
        print(f'Underlying price: {underlying_price}')


        call_exp_dates = list(call_options_chain["callExpDateMap"].keys())
        put_exp_dates = list(put_options_chain['putExpDateMap'].keys())


        common_exp_dates = []
        for call_exp_date in call_exp_dates:
            if call_exp_date in put_exp_dates:
                common_exp_dates.append(call_exp_date)
        

        call_option = None
        put_option = None

        for exp_date in common_exp_dates:
            calls_by_exp = call_options_chain["callExpDateMap"][exp_date]
            puts_by_exp = put_options_chain["putExpDateMap"][exp_date]


            calls_option_list = []
            puts_option_list = []

            for call_by_price in list(calls_by_exp.values()):
                for call in call_by_price:
                    calls_option_list.append(call)

            for put_by_price in list(puts_by_exp.values()):
                for put in put_by_price:
                    puts_option_list.append(put)

            target_otm_call_price = underlying_price * (1.0 + target_gap/100.0)
            target_otm_put_price = underlying_price * (1.0 - target_gap/100.0)
            print(f'underlying price: {underlying_price} , otm call price: {target_otm_call_price} , otm put price: {target_otm_put_price}')


            for option in calls_option_list:
                if call_option == None or abs(option['strikePrice'] - target_otm_call_price) < abs(call_option['strikePrice'] - target_otm_call_price):
                    call_option = option

            if use_same_spread_diff:
                #find the atm price
                atm_price = None
                for option in calls_option_list:
                    if atm_price == None or abs(option['strikePrice'] - underlying_price) < abs(atm_price - underlying_price):
                        atm_price = option['strikePrice']
                target_otm_put_price = atm_price - (call_option['strikePrice'] - atm_price)


            for option in puts_option_list:
                if put_option == None or abs(option['strikePrice'] - target_otm_put_price) < abs(put_option['strikePrice'] - target_otm_put_price):
                    put_option = option
            

            #just find the option for today
            break



        #print(call)
        #print(put)
        return call_option, put_option



    def find_otm_options_by_delta(self, call_options_chain, put_options_chain, target_delta=2):
        call_underlying_price = call_options_chain["underlyingPrice"]
        put_underlying_price = put_options_chain["underlyingPrice"]
        underlying_price = (call_underlying_price + put_underlying_price)/2.0


        call_exp_dates = list(call_options_chain["callExpDateMap"].keys())
        put_exp_dates = list(put_options_chain['putExpDateMap'].keys())


        common_exp_dates = []
        for call_exp_date in call_exp_dates:
            if call_exp_date in put_exp_dates:
                common_exp_dates.append(call_exp_date)
        

        call_option = None
        put_option = None

        for exp_date in common_exp_dates:
            calls_by_exp = call_options_chain["callExpDateMap"][exp_date]
            puts_by_exp = put_options_chain["putExpDateMap"][exp_date]


            calls_option_list = []
            puts_option_list = []

            for call_by_price in list(calls_by_exp.values()):
                for call in call_by_price:
                    calls_option_list.append(call)

            for put_by_price in list(puts_by_exp.values()):
                for put in put_by_price:
                    puts_option_list.append(put)

            #find the 2 delta otm call option
            target_call_delta = target_delta*0.01
            target_put_delta = -target_call_delta
            for option in calls_option_list:
                if call_option == None or abs(option['delta'] - target_call_delta) < abs(call_option['delta'] - target_call_delta):
                    call_option = option

            #find the 2 delta otm put option
            for option in puts_option_list:
                if put_option == None or abs(option['delta'] - target_put_delta) < abs(put_option['delta'] - target_put_delta):
                    put_option = option

            #just find the option for today
            break



        print(call_option)
        print(put_option)
        return call_option, put_option



    def find_atm_options(self, call_options_chain, put_options_chain):
        call_underlying_price = call_options_chain["underlyingPrice"]
        put_underlying_price = put_options_chain["underlyingPrice"]
        underlying_price = (call_underlying_price + put_underlying_price)/2.0
        print(f'underlying price: {underlying_price}')


        call_exp_dates = list(call_options_chain["callExpDateMap"].keys())
        put_exp_dates = list(put_options_chain['putExpDateMap'].keys())


        common_exp_dates = []
        for call_exp_date in call_exp_dates:
            if call_exp_date in put_exp_dates:
                common_exp_dates.append(call_exp_date)
        
        call_option = None
        put_option = None

        for exp_date in common_exp_dates:
            calls_by_exp = call_options_chain["callExpDateMap"][exp_date]
            puts_by_exp = put_options_chain["putExpDateMap"][exp_date]


            calls_option_list = []
            puts_option_list = []

            for call_by_price in list(calls_by_exp.values()):
                for call in call_by_price:
                    calls_option_list.append(call)

            for put_by_price in list(puts_by_exp.values()):
                for put in put_by_price:
                    puts_option_list.append(put)
            

            for option in calls_option_list:
                if call_option == None or abs(option['strikePrice'] - underlying_price) < abs(call_option['strikePrice'] - underlying_price):
                    call_option = option

            print(call_option['strikePrice'])
            for option in puts_option_list:
                if put_option == None or abs(option['strikePrice'] - underlying_price) < abs(put_option['strikePrice'] - underlying_price):
                    put_option = option

                if option['strikePrice'] == call_option['strikePrice']:
                    put_option = option
                    break
            
            #just find the option for today
            break



        #print(call)
        #print(put)
        return call_option, put_option



    def find_options_by_name(self, call_instrument, put_instrument):
        call_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = self.TRADE_INDEX_SYMBOL, contract_type = 'CALL', days_to_expiration = 1)
        put_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = self.TRADE_INDEX_SYMBOL, contract_type = 'PUT', days_to_expiration = 1)

        if call_options_chain is None or put_options_chain is None:
            return None, None



        calls_by_exp = list(call_options_chain["callExpDateMap"].values())
        puts_by_exp = list(put_options_chain['putExpDateMap'].values())

        calls_option_list = []
        puts_option_list = []

        for call_by_exp  in calls_by_exp:
            for call in list(call_by_exp.values()):
                calls_option_list.append(call[0])

        for put_by_exp in puts_by_exp:
            for put in list(put_by_exp.values()):
                puts_option_list.append(put[0])
        
        call_option = None
        put_option = None
        for option in calls_option_list:
            if option['symbol'] == call_instrument:
                call_option = option

        for option in puts_option_list:
            if option['symbol'] == put_instrument:
                put_option = option

        return call_option, put_option


    def get_straddle_payload(self, atm_call_option, atm_put_option, limit_price):
        profit_order_body = {
            "orderType": "NET_DEBIT",
            "session": "NORMAL",
            "duration": "DAY",
            "orderStrategyType": "SINGLE",
            "priceLinkBasis":"TRIGGER",# goal: buy back for 50% of credit
            "priceLinkType":"PERCENT",
            "priceOffset":-50.0,
            "orderLegCollection": [
                {
                    "instruction": "BUY_TO_CLOSE",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "BUY_TO_CLOSE",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_put_option['symbol'],
                        "assetType": "OPTION"
                    }
                }
            ]
        }


        order_body = {
            "orderType": "NET_CREDIT",
            "price": limit_price,
            "session": "NORMAL",
            "duration": "DAY",
            "orderStrategyType": "TRIGGER",
            #"complexOrderStrategyType": "IRON_CONDOR",  # Iron Fly fits under Iron Condor type
            "orderLegCollection": [
                {
                    "instruction": "SELL_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "SELL_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_put_option['symbol'],
                        "assetType": "OPTION"
                    }
                }
            ],
            "childOrderStrategies": [
                profit_order_body
            ]
        }

        return order_body


    def get_defined_risk_straddle_payload(self, atm_call_option, atm_put_option, otm_call_option, otm_put_option, limit_price):
        profit_order_body = {
            "orderType": "NET_DEBIT",
            "session": "NORMAL",
            "duration": "DAY",
            "orderStrategyType": "SINGLE",
            #"complexOrderStrategyType": "NONE",
            "priceLinkBasis":"TRIGGER",
            "priceLinkType":"PERCENT",
            "priceOffset":-50.0,            
            "orderLegCollection": [
                {
                    "instruction": "BUY_TO_CLOSE",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "BUY_TO_CLOSE",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_put_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "SELL_TO_CLOSE",
                    "quantity": 1,
                    "instrument": {
                        "symbol": otm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "SELL_TO_CLOSE",
                    "quantity": 1,
                    "instrument": {
                        "symbol": otm_put_option['symbol'],
                        "assetType": "OPTION"
                    }
                }                
            ]
        }

        order_body = {
            "orderType": "NET_CREDIT",
            "price": limit_price,
            "session": "NORMAL",
            "duration": "DAY",
            "orderStrategyType": "TRIGGER",
            #"complexOrderStrategyType": "NONE",
            "orderLegCollection": [
                {
                    "instruction": "SELL_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "SELL_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_put_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "BUY_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": otm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "BUY_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": otm_put_option['symbol'],
                        "assetType": "OPTION"
                    }
                }                
            ],
            "childOrderStrategies": [
                profit_order_body
            ]
        }



        return order_body



    def execute_strategy(self):
        """
        Execute the automated trading strategy.
        """
        #resp = self.schwab_api.get_instruments(self.SYMBOL, self.schwab_api.Instrument.Projection('fundamental'))
        #instruments = resp.json()
        #print(instruments)


        print("Fetching VIX data...")
        try:
            vix_today_open, vix_previous_close = self.get_vix_data()
        except Exception:
            print("Error in getting the vix data")
            return False

        print(f"VIX Today Open: {vix_today_open}, VIX PrevDay Close: {vix_previous_close}")
        if vix_today_open is None or vix_previous_close is None:
            print('Vix data is None')
            return False

        print(self.admin_info)

        vix_automatic_mode = self.admin_info.get('vix_automatic_mode', False)
        vix_gap_up = (vix_today_open > 0 and vix_today_open > vix_previous_close) if vix_automatic_mode else self.admin_info.get('vix_gap_up', False)
        order_gap_sec = self.admin_info.get('order_gap_sec', 10)
        print(f"vix automatic mode:{vix_automatic_mode}  |  vix gap up:{vix_gap_up}  |  order gap sec:{order_gap_sec}")




        # Check if VIX gaps up
        if vix_gap_up:

            
            #find the symbols-strategy kind from the users request
            trading_groups = {} # 'symbol-strategy kind':['user1', 'user2'...]

            user_names = self.user_info.keys()
            for username in user_names:
                user_run_setting = self.user_info[username]

                user_symbol = user_run_setting['sel_symbol']
                user_strategy_type = user_run_setting['strategy_type']
                user_trading_group = f'{user_symbol}-{user_strategy_type}'


                if user_trading_group in trading_groups.keys():
                    trading_groups[user_trading_group].append(username)
                else:
                    trading_groups.update({user_trading_group:[username]})


            trading_start = datetime.now()
            print(f"VIX has gapped up. Fetching options chain for trading symbols...")
            #start trading

            signal_info = {}
            for trading_group in trading_groups.keys():
                #trading_symbol = trading_group.split('-')[0]
                strategy_type = trading_group.split('-')[1]

                user_names = trading_groups[trading_group]
                payload, spread_diff =  self.find_order_payload(trading_group)
                lot_sizes = []

                for username in user_names:
                    user_info = self.user_info[username]
                    #update the lot size
                    contract_type = user_info['contract_type']
                    fixed_lots = int(user_info['fixed_lots'])
                    risk_percentage = float(user_info['risk_percentage'])

                    if contract_type == 'Fixed':
                        lot_size = fixed_lots
                    else:
                        #get the account balance
                        token_type = 'Bearer'
                        access_token = self.access_token_info[username]
                        balance_headers = get_access_headers(token_type, access_token)
                        acc_balance = schwab_api_get_account_balance(balance_headers)
                        print(f'getting the balance : {acc_balance}')

                        
                        premium = payload['price']

                        if strategy_type == 'Straddle':
                            atm_call_symbol = payload["orderLegCollection"][0]["instrument"]["symbol"]
                            _, _, _, strike_price = read_option_symbol(atm_call_symbol)
                            margin = 0.2
                            lot_size_round = acc_balance*risk_percentage/100.0/(strike_price*100.0*margin)
                            lot_size = math.floor(lot_size_round)
                            print("======   Straddle Lot Size Calculation =====")
                            print(f"acc balance: {acc_balance}, risk percentage: {risk_percentage},  strike_price: {strike_price}, lot_size: {lot_size_round}  {lot_size}")
                        elif strategy_type == 'Defined Risk Straddle':
                            atm_call_symbol = payload["orderLegCollection"][0]["instrument"]["symbol"]
                            otm_call_symbol = payload["orderLegCollection"][2]["instrument"]["symbol"]
                            otm_put_symbol = payload["orderLegCollection"][3]["instrument"]["symbol"]
                            _, _, _, atm_strike_price = read_option_symbol(atm_call_symbol)
                            _, _, _, otm_call_strike_price = read_option_symbol(otm_call_symbol)
                            _, _, _, otm_put_strike_price = read_option_symbol(otm_put_symbol)
                            spread_diff = max(otm_call_strike_price - atm_strike_price, atm_strike_price - otm_put_strike_price)
                            lot_size_round = acc_balance*risk_percentage/100.0/(spread_diff*100.0 - premium*100.0)
                            lot_size = math.floor(lot_size_round)
                            print("======   Defined Lot Size Calculation =====")
                            print(f"atm: {atm_strike_price} , otmc: {otm_call_strike_price}, otmp: {otm_put_strike_price}")
                            print(f"acc balance: {acc_balance}, risk percentage: {risk_percentage},  spread_diff: {spread_diff}, mid_price: {premium}, lot_size: {lot_size_round}  {lot_size}")


                        '''
                        print('==========   Calculation Of Account Balance ==========')
                        print(f'balance = {acc_balance}')
                        print(f'risk_percentage = {risk_percentage}')
                        print(f'debit_to_use = {debit_to_use}')
                        print(f'premium = {premium}')
                        print(f'lot size = {lot_size}')
                        print('======================================================')
                        '''


                    #lot_size = max(lot_size, 1)
                    lot_sizes.append(lot_size)

                signal_info.update({trading_group:{'users':user_names, 'payload':payload, 'lot_sizes':lot_sizes, 'spread_diff':spread_diff}})


            self.order_result_dict = {}

            #send initial order
            print('==================== Bot2:  Initial Order Send  =====================')
            self.send_init_order(signal_info)


            repeat_cnt = 3
            repeat_gap_sec = order_gap_sec
            repeat_num = 0

            #modfy order price
            while repeat_num < repeat_cnt:
                repeat_num += 1
                time.sleep(repeat_gap_sec)
                print(f'==================== Bot2: {repeat_num}.Modify Order Price  =====================')
                self.modify_order_price(signal_info)

            #modify order to market
            time.sleep(repeat_gap_sec)
            print(f'==================== Bot2:  Modify Order Market  =====================')
            self.modify_order_market(signal_info)

            #remember what went on, so the check job can take it off again
            self.remember_live_entries(signal_info)



        else:
            print("VIX did not gap up. No trades executed by Bot2.")
        return True


    def remember_live_entries(self, signal_info):
        """Keep the payload that actually went out for every user who traded.

        The exit runs long after ``execute_strategy`` has returned, on the
        check job rather than the run job, so what it needs has to survive the
        run: the structure as it was sent, with that user's lot size already
        written into it, and the id the broker gave it.
        """
        order_result_dict = getattr(self, 'order_result_dict', None) or {}
        self.live_entries = live_entries(signal_info, order_result_dict)
        print(f'Bot2 is holding {len(self.live_entries)} live entr(ies)')
        return self.live_entries


    def entry_quotes(self, username, payload):
        """Current quotes for every contract in a live entry."""
        legs = payload.get('orderLegCollection') or []
        symbols = []
        for leg in legs:
            symbol = leg['instrument']['symbol']
            if symbol not in symbols:
                symbols.append(symbol)
        if not symbols:
            return None

        token_type = 'Bearer'
        access_token = self.access_token_info[username]
        return get_list_quote(token_type, access_token, ','.join(symbols))


    def check_exit(self, now=None):
        """Take off anything still open as the session runs out.

        The profit target is left alone while there is time for it to fill.
        Once there is not, the target comes off first and the structure is
        closed with one order, so the two can never both be working on the
        same contracts.
        """
        if not self.live_entries:
            return {}

        TZ = pytz.timezone(self.time_zone)
        moment = now if now is not None else datetime.now(TZ)
        minutes_left = minutes_to_close(moment, time_zone=self.time_zone)

        actions = {}
        for username in list(self.live_entries.keys()):
            entry = self.live_entries[username]
            payload = entry['payload']
            trading_symbol = entry['trading_symbol']

            quotes = None
            try:
                quotes = self.entry_quotes(username, payload)
            except Exception:
                print(f'could not quote the live entry of {username}')

            plan = exit_plan(payload, quotes, trading_symbol, minutes_left)
            if plan is None:
                print(f'the live entry of {username} cannot be unwound')
                continue

            actions.update({username: plan})
            if plan['action'] != 'close':
                continue

            token_type = 'Bearer'
            access_token = self.access_token_info[username]
            account_id = self.account_info[username]

            # An entry the broker has already finished with is not ours to
            # close: cancelling it again is noise, and sending a closing order
            # against a position that was never opened is worse than noise.
            if entry['order_id'] is not None:
                entry_status, _ = get_order_status(token_type, access_token,
                                                   account_id, entry['order_id'])
                if entry_status in ('CANCELED', 'REJECTED', 'EXPIRED'):
                    print(f'the entry of {username} is already {entry_status}')
                    self.live_entries.pop(username, None)
                    continue

            if plan['cancel_child'] and entry['order_id'] is not None:
                print(f'pulling the profit target of {username}')
                cancel_order(token_type, access_token, account_id,
                             entry['order_id'], username)

            closing_payload = plan['order']
            if closing_payload is None:
                continue

            print(f'closing the {trading_symbol} structure of {username}')
            order_result_dict = {}
            send_order(token_type, access_token, account_id, closing_payload,
                       trading_symbol, 'Exit', order_result_dict, username)

            closing_id = None
            if username in order_result_dict:
                closing_id = order_result_dict[username][0]

            self.closed_entries.update({username: {
                'entry_order_id': entry['order_id'],
                'closing_order_id': closing_id,
                'order_type': closing_payload['orderType'],
                'trading_symbol': trading_symbol,
            }})
            self.live_entries.pop(username, None)

        return actions


    def exit_report(self):
        """What the check job took off, and what it is still holding."""
        return {
            'closed': dict(self.closed_entries),
            'still_open': sorted(self.live_entries.keys()),
        }


    def send_init_order(self, signal_info):
        threads = []
        order_result_dict = {}
        trading_group_list = signal_info.keys()
        for trading_group in trading_group_list:
            trading_symbol = trading_group.split('-')[0]
            strategy_type = trading_group.split('-')[1]

            user_names = signal_info[trading_group]['users']
            payload = signal_info[trading_group]['payload']
            lot_sizes = signal_info[trading_group]['lot_sizes']
            spread_diff = signal_info[trading_group]['spread_diff']


            user_n = len(user_names)
            for i in range(user_n):
                username = user_names[i]
                lot_size = lot_sizes[i]
                if lot_size <= 0:
                    print(f"We skip sending the init order of {username} because lot size is 0.")
                    continue
                
                #deep copy the payload into the user_payload
                user_payload = copy.deepcopy(payload)
                
                #update the lot size for the main payload
                leg_n = len(user_payload['orderLegCollection'])
                for j in range(leg_n):
                    user_payload['orderLegCollection'][j]['quantity'] = lot_size

                #update the lot size for children payload
                leg_n = len(user_payload['childOrderStrategies'][0]['orderLegCollection'])
                for j in range(leg_n):
                    user_payload['childOrderStrategies'][0]['orderLegCollection'][j]['quantity'] = lot_size
                
 
                user_info = self.user_info[username]

                token_type = 'Bearer'
                access_token = self.access_token_info[username]
                account_id = self.account_info[username]


                limit_price = get_new_limit_price(token_type, access_token, user_payload, strategy_type)
                if limit_price is None:
                    print(f"We stop sending the init order of the {username} because limit price is None.")
                else:
                    #limit_price = limit_price*2.0
                    limit_price = get_valid_price(limit_price, trading_symbol)
                    print(f'SPREAD DIFF: {spread_diff}')
                    if spread_diff is not None:
                        tick_size = get_ticksize(trading_symbol)
                        limit_price = min(limit_price, spread_diff - tick_size)
                    
                    user_payload['price'] = limit_price
                    

                    process = Thread(target = send_order, args = [token_type, access_token, account_id, user_payload, trading_symbol, strategy_type, order_result_dict, username])
                    process.start()
                    threads.append(process)
        
        for process in threads:
            process.join()

        self.order_result_dict = order_result_dict



    def modify_order_price(self, signal_info):
        threads = []
        order_result_dict = self.order_result_dict
        trading_group_list = signal_info.keys()
        
        new_order_result_dict = {}
        # Update the order status
        for trading_group in trading_group_list:
            trading_symbol = trading_group.split('-')[0]
            strategy_type = trading_group.split('-')[1]

            user_names = signal_info[trading_group]['users']
            payload = signal_info[trading_group]['payload']
            lot_sizes = signal_info[trading_group]['lot_sizes']
            spread_diff = signal_info[trading_group]['spread_diff']
            



            for username, lot_size in zip(user_names, lot_sizes):
                if lot_size <= 0:
                    continue
                order_id, order_status = order_result_dict[username][0], order_result_dict[username][1]
                if order_id is None or order_status == 'FILLED' or order_status == 'REJECTED':
                    continue

                token_type = 'Bearer'
                access_token = self.access_token_info[username]
                account_id = self.account_info[username]

                order_status, status_description = get_order_status(token_type, access_token, account_id, order_id)
                order_result_dict[username][1] = order_status
                order_result_dict[username][2] = status_description
            
            # Modify the order if it is not filled using order_result_dict
            user_n = len(user_names)
            for i in range(user_n):
                username = user_names[i]
                #update the lot size for every user
                lot_size = lot_sizes[i]
                if lot_size <= 0:
                    print(f"We skip modifying the order of {username} because lot size is 0.")
                    continue

                user_payload = copy.deepcopy(payload)

                #update the lot size for the main payload
                leg_n = len(user_payload['orderLegCollection'])
                for j in range(leg_n):
                    user_payload['orderLegCollection'][j]['quantity'] = lot_size

                #update the lot size for children payload
                leg_n = len(user_payload['childOrderStrategies'][0]['orderLegCollection'])
                for j in range(leg_n):
                    user_payload['childOrderStrategies'][0]['orderLegCollection'][j]['quantity'] = lot_size




                order_id, order_status, status_description = order_result_dict[username][0], order_result_dict[username][1], order_result_dict[username][2]
                if order_id is not None and order_status == 'FILLED':#or order_status == 'REJECTED':
                    print(f"{username}. {order_id} is already Filled.")
                    continue

                print(f'Modify Order With New Price For {username}')

                token_type = 'Bearer'
                access_token = self.access_token_info[username]
                account_id = self.account_info[username]


                limit_price = get_new_limit_price(token_type, access_token, user_payload, strategy_type)
                if limit_price is None:
                    print(f"We stop modifying the order of {usename} because limit price is None")
                else:
                    #limit_price = limit_price*2.0
                    limit_price = get_valid_price(limit_price, trading_symbol)
                    print(f'SPREAD DIFF: {spread_diff}')
                    if spread_diff is not None:
                        tick_size = get_ticksize(trading_symbol)
                        limit_price = min(limit_price, spread_diff - tick_size)
                    

                    user_payload['price'] = limit_price



                    if order_id is None or order_status =='REJECTED':
                        process = Thread(target = send_order, args = [token_type, access_token, account_id, user_payload, trading_symbol, strategy_type, new_order_result_dict, username])
                    else:
                        process = Thread(target = modify_order, args = [token_type, access_token, account_id, order_id, user_payload, trading_symbol, strategy_type, new_order_result_dict, username])
                    process.start()
                    threads.append(process)


        for process in threads:
            process.join()

        order_result_dict.update(new_order_result_dict)
        self.order_result_dict = order_result_dict


    def modify_order_market(self, signal_info):
        threads = []
        order_result_dict = self.order_result_dict
        trading_group_list = signal_info.keys()

        for trading_group in trading_group_list:
            trading_symbol = trading_group.split('-')[0]
            strategy_type = trading_group.split('-')[1]

            user_names = signal_info[trading_group]['users']
            lot_sizes = signal_info[trading_group]['lot_sizes']
            payload = signal_info[trading_group]['payload']
            spread_diff = signal_info[trading_group]['spread_diff']


            for username, lot_size in zip(user_names, lot_sizes):
                if lot_size <= 0:
                    continue
                order_id, order_status = order_result_dict[username][0], order_result_dict[username][1]
                if order_id is None or order_status == 'FILLED' or order_status == 'REJECTED':
                    continue

                token_type = 'Bearer'
                access_token = self.access_token_info[username]
                account_id = self.account_info[username]

                order_status, status_description = get_order_status(token_type, access_token, account_id, order_id)
                order_result_dict[username][1] = order_status
                order_result_dict[username][2] = status_description

            new_order_result_dict = {}
            user_n = len(user_names)
            for i in range(user_n):
                lot_size = lot_sizes[i]
                username = user_names[i]
                if lot_size <= 0:
                    print(f"We skip modifying the order of {username} to market because lot size is 0.")
                    continue

                user_payload = copy.deepcopy(payload)


                #update the lot size for the main payload
                leg_n = len(user_payload['orderLegCollection'])
                for j in range(leg_n):
                    user_payload['orderLegCollection'][j]['quantity'] = lot_size

                #update the lot size for children payload
                leg_n = len(user_payload['childOrderStrategies'][0]['orderLegCollection'])
                for j in range(leg_n):
                    user_payload['childOrderStrategies'][0]['orderLegCollection'][j]['quantity'] = lot_size


                #remove the price keys for the main payload
                user_payload.pop('price')
                user_payload['orderType'] = 'MARKET'


                token_type = 'Bearer'
                access_token = self.access_token_info[username]
                account_id = self.account_info[username]



                order_id, order_status  = order_result_dict[username][0], order_result_dict[username][1]
                if order_id is not None and order_status == 'FILLED':# or order_status == 'REJECTED':
                    print(f"{username}: {order_id} is already Filled.")
                    continue

                print(f'Modify Order To Market Order For {username}')
                token_type = 'Bearer'
                access_token = self.access_token_info[username]
                account_id = self.account_info[username]


                if order_id is None or order_status =='REJECTED':
                    process = Thread(target = send_order, args = [token_type, access_token, account_id, user_payload, trading_symbol, strategy_type, new_order_result_dict, username])
                else:
                    process = Thread(target = modify_order, args = [token_type, access_token, account_id, order_id, user_payload, trading_symbol, strategy_type, new_order_result_dict, username])
                process.start()
                threads.append(process)


        for process in threads:
            process.join()

        order_result_dict.update(new_order_result_dict)
        


        #get the final order satus
        for username, lot_size in zip(user_names, lot_sizes):
            if lot_size <= 0:
                continue
            order_id, order_status = order_result_dict[username][0], order_result_dict[username][1]
            if order_id is None or order_status == 'FILLED' or order_status == 'REJECTED':
                continue

            token_type = 'Bearer'
            access_token = self.access_token_info[username]
            account_id = self.account_info[username]
            order_status, status_description = get_order_status(token_type, access_token, account_id, order_id)
            order_result_dict[username][1] = order_status
            order_result_dict[username][2] = status_description
        
        print(order_result_dict)
        return

        #send order result signal
        try:
            print('sending the bot2 order result signal')
            ws = create_connection(f"{WS_ENDPOINT}/ws/signalpath/")
            ws.send(
                json.dumps({
                    'bot_name':'bot02',
                    'message':"send_order_result",
                    'order_result_dict':order_result_dict
                })
            )
        except:
            print('failed to connect websocket in setting the server info for bot2')



    def find_order_payload(self, p_trading_group):
        sim_symbol, p_strategy_type = p_trading_group.split('-')[0], p_trading_group.split('-')[1]
        p_symbol = '$XSP' if sim_symbol == '$XSPSIM' else sim_symbol

        time_zone = BOT2_TIME_ZONE
        TZ = pytz.timezone(time_zone)
        cur_time = datetime.now(TZ)
        today_str = cur_time.strftime("%Y-%m-%d")
        spread_diff = None



        if p_strategy_type == 'Straddle':
            call_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'CALL', strike_range = None,from_date = today_str, to_date = today_str)
            put_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'PUT', strike_range = None, from_date = today_str, to_date = today_str)


            atm_call_option, atm_put_option = self.find_atm_options(call_options_chain, put_options_chain)

            sell_call_ask, sell_call_bid = atm_call_option['ask'], atm_call_option['bid']
            sell_call_price = (sell_call_ask + sell_call_bid)/2.0
            sell_put_ask, sell_put_bid = atm_put_option['ask'], atm_put_option['bid']
            sell_put_price = (sell_put_ask + sell_put_bid)/2.0

            limit_price = (sell_call_price + sell_put_price)
            limit_price = get_valid_price(limit_price, p_symbol)
            order_payload = self.get_straddle_payload(atm_call_option, atm_put_option, limit_price)

        elif p_strategy_type == 'Defined Risk Straddle':
            call_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'CALL', strike_range = None,from_date = today_str, to_date = today_str)
            put_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'PUT', strike_range = None, from_date = today_str, to_date = today_str)

            atm_call_option, atm_put_option = self.find_atm_options(call_options_chain, put_options_chain)
            otm_call_option, otm_put_option = self.find_otm_options_by_delta(call_options_chain, put_options_chain)

            spread_diff = math.fabs(otm_call_option['strikePrice'] - atm_call_option['strikePrice'])

            sell_call_ask, sell_call_bid = atm_call_option['ask'], atm_call_option['bid']
            sell_call_price = (sell_call_ask + sell_call_bid)/2.0
            sell_put_ask, sell_put_bid = atm_put_option['ask'], atm_put_option['bid']
            sell_put_price = (sell_put_ask + sell_put_bid)/2.0


            buy_call_ask, buy_call_bid = otm_call_option['ask'], otm_call_option['bid']
            buy_put_ask, buy_put_bid = otm_put_option['ask'], otm_put_option['bid']
            buy_call_price = (buy_call_ask + buy_call_bid)/2.0
            buy_put_price = (buy_put_ask + buy_put_bid)/2.0

            limit_price = sell_call_price + sell_put_price - buy_call_price - buy_put_price
            limit_price = get_valid_price(limit_price, p_symbol)
            order_payload = self.get_defined_risk_straddle_payload(atm_call_option, atm_put_option, otm_call_option, otm_put_option, limit_price)

        return order_payload, spread_diff
