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
from Engine.ladder import (
    DEFAULT_LADDER_STEPS,
    clamp_steps,
    package_width,
    plan_for_payload,
)

class Bot01Engine:
    def __init__(self):
        self.set_bot_info()
        self.trading_ready = False
        #Rung schedule per user for the package currently being worked.
        self.ladder_plans = {}

    def set_bot_info(self):
        self.vix_index_symbol = '$VIX'
        #self.TRADE_INDEX_SYMBOL = '$SPX'
        #self.TRADE_INDEX_SYMBOL = 'SPY'


        self.token_path = f"../setting/{BOT1_TOKEN_PATH}"
        self.user_info_path = f"../setting/{BOT1_USER_INFO_PATH}"
        self.admin_info_path = f"../setting/{BOT1_ADMIN_INFO_PATH}"
        self.time_zone = BOT1_TIME_ZONE

    def set_server_info(self):
        self.trading_ready = False
        #delete the old token file
        if os.path.exists(self.token_path):
            os.remove(self.token_path)
        #delete old bot1 user info file
        if os.path.exists(self.user_info_path):
            os.remove(self.user_info_path)
        #delete old bot1 admin info file
        if os.path.exists(self.admin_info_path):
            os.remove(self.admin_info_path)

        try:
            print('sending the signal of getting bot1 info')
            ws = create_connection(f"{WS_ENDPOINT}/ws/signalpath/")
            ws.send(
                json.dumps({
                    'bot_name':'bot01',
                    'message':"set_server_info",
                })
            )
        except:
            print('failed to connect websocket in setting the server info for bot1')


    def prepare_trading(self):
        #read refresh token file
        if os.path.exists(self.token_path):
            try:
                with open (self.token_path, 'r') as token_file:
                    self.refresh_token_info = json.load(token_file)
            except:
                print('bot1 reading token file error')
                return False
        else:
            print('bot1 refresh token does not exist in authenticate')
            return False

        #read admin setting
        if os.path.exists(self.admin_info_path):
            with open(self.admin_info_path, 'r') as admin_file:
                self.admin_info = json.load(admin_file)
        else:
            print('bot1 admin setting file does not exist')
            return False
        
        #read user setting
        if os.path.exists(self.user_info_path):
            with open(self.user_info_path, 'r') as user_file:
                self.user_info = json.load(user_file)
        else:
            print('bot1 user setting file does not exist')
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
            print('No valid access token For Bot1')
            return False        

        print('bot1 ready inside engine')
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


    '''
    def find_otm_options(self, call_options_chain, put_options_chain, target_gap=0.1):
        call_underlying_price = call_options_chain["underlyingPrice"]
        put_underlying_price = put_options_chain["underlyingPrice"]
        underlying_price = (call_underlying_price + put_underlying_price)/2.0
        print(f'{call_underlying_price} , {put_underlying_price} , {underlying_price}')


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

            #find the atm strike price
            strike_price = None
            for option in calls_option_list:
                if strike_price == None or abs(option['strikePrice'] - call_underlying_price) < abs(strike_price - call_underlying_price):
                    strike_price = option['strikePrice']

            target_otm_call_price = strike_price * (1.0 + target_gap/100.0)
            target_otm_put_price = strike_price * (1.0 - target_gap/100.0)
            print(f'strike price: {strike_price} , otm call price: {target_otm_call_price} , otm put price: {target_otm_put_price}')


            for option in calls_option_list:
                if call_option == None or abs(option['strikePrice'] - target_otm_call_price) < abs(call_option['strikePrice'] - target_otm_call_price):
                    call_option = option

            for option in puts_option_list:
                if put_option == None or abs(option['strikePrice'] - target_otm_put_price) < abs(put_option['strikePrice'] - target_otm_put_price):
                    put_option = option
            

            #just find the option for today
            break



        #print(call)
        #print(put)
        return call_option, put_option
    '''



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

            for option in puts_option_list:
                if put_option == None or abs(option['strikePrice'] - target_otm_put_price) < abs(put_option['strikePrice'] - target_otm_put_price):
                    put_option = option


            if use_same_spread_diff:
                #find the atm price
                atm_price = None
                for option in calls_option_list:
                    if atm_price == None or abs(option['strikePrice'] - underlying_price) < abs(atm_price - underlying_price):
                        atm_price = option['strikePrice']

                max_diff = max(call_option['strikePrice'] - atm_price, atm_price - put_option['strikePrice'])
                target_otm_call_price = atm_price + max_diff
                target_otm_put_price = atm_price - max_diff

                call_option = None
                put_option = None
                for option in calls_option_list:
                    if call_option == None or abs(option['strikePrice'] - target_otm_call_price) < abs(call_option['strikePrice'] - target_otm_call_price):
                        call_option = option

                for option in puts_option_list:
                    if put_option == None or abs(option['strikePrice'] - target_otm_put_price) < abs(put_option['strikePrice'] - target_otm_put_price):
                        put_option = option
            

            #just find the option for today
            break



        #print(call)
        #print(put)
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


    def get_market_order_payload(self, option):
        """
        Place an order for the given option.
        """
        order_body = {
            "complexOrderStrategyType": "NONE", 
            "orderType": "MARKET", 
            "session": "NORMAL", 
            "duration": "DAY", 
            "orderStrategyType": "SINGLE", 
            "orderLegCollection": [ 
            { 
                "instruction": "BUY_TO_OPEN", 
                "quantity": 1, 
                "instrument": { 
                "symbol": option['symbol'], 
                "assetType": "OPTION" 
                } 
            } 
            ] 
            }
        return order_body
        #json_object = json.dumps(order_body, indent=4)
        #return json_object


    def get_limit_order_payload(self, option, price=None):
        """
        Place an order for the given option.
        """
        order_body = {
            "complexOrderStrategyType": "NONE", 
            "orderType": "LIMIT", 
            "session": "NORMAL", 
            "price": price, 
            "duration": "DAY", 
            "orderStrategyType": "SINGLE", 
            "orderLegCollection": [ 
            { 
                "instruction": "BUY_TO_OPEN", 
                "quantity": 1, 
                "instrument": { 
                "symbol": option['symbol'], 
                "assetType": "OPTION" 
                } 
            } 
            ] 
            } 

        return order_body

        #json_object = json.dumps(order_body, indent=4)
        #return json_object

    def get_terrance_payload(self, call_option, put_option, limit_price):
        """
        Place an order for the given option.
        """
        order_body = {
            #"complexOrderStrategyType": "CUSTOM",
            "orderType": "NET_DEBIT", 
            "price": limit_price, 
            "orderStrategyType": "SINGLE", 
            "session": "NORMAL", 
            "duration": "DAY", 
            "orderLegCollection": [ 
            {
                "instruction": "BUY_TO_OPEN", 
                "quantity": 1, 
                "instrument": { 
                "symbol": call_option['symbol'], 
                "assetType": "OPTION" 
                } 
            },
            {
                "instruction": "BUY_TO_OPEN", 
                "quantity": 1, 
                "instrument": { 
                "symbol": put_option['symbol'], 
                "assetType": "OPTION" 
                } 
            }
            ] 
            } 

        return order_body

    def get_ironfly_payload(self, atm_call_option, atm_put_option, otm_call_option, otm_put_option, limit_price):
        order_body = {
            "orderType": "NET_DEBIT",
            "price": limit_price,
            "session": "NORMAL",
            "duration": "DAY",
            "orderStrategyType": "SINGLE",
            #"complexOrderStrategyType": "IRON_CONDOR",  # Iron Fly fits under Iron Condor type
            "orderLegCollection": [
                {
                    "instruction": "BUY_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "BUY_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_put_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "SELL_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": otm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "SELL_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": otm_put_option['symbol'],
                        "assetType": "OPTION"
                    }
                }
            ]
        }
        return order_body


    def get_terrance_iron_combo_payload(self, atm_call_option, atm_put_option, otm_call_option, limit_price):
        order_body = {
            "orderType": "NET_DEBIT",
            "price": limit_price,
            "session": "NORMAL",
            "duration": "DAY",
            "orderStrategyType": "SINGLE",
            #"complexOrderStrategyType": "NONE",
            "orderLegCollection": [
                {
                    "instruction": "BUY_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "BUY_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": atm_put_option['symbol'],
                        "assetType": "OPTION"
                    }
                },
                {
                    "instruction": "SELL_TO_OPEN",
                    "quantity": 1,
                    "instrument": {
                        "symbol": otm_call_option['symbol'],
                        "assetType": "OPTION"
                    }
                }
            ]
        }
        return order_body



    def quote_symbols(self, payload):
        """Comma joined symbol list covering every leg of a working payload."""
        symbols = []
        for leg in payload.get('orderLegCollection', []):
            symbol = leg['instrument']['symbol']
            if symbol not in symbols:
                symbols.append(symbol)
        return ','.join(symbols)


    def ladder_size(self):
        """How many rungs the operator asked for.

        Read from the admin settings every time rather than cached at start
        up, so an operator who edits `ladder_steps` between runs gets the
        ladder they asked for.
        """
        admin_info = getattr(self, 'admin_info', None) or {}
        return clamp_steps(admin_info.get('ladder_steps', BOT1_LADDER_STEPS))


    def working_plan(self, payload, quotes, symbol, steps, width=None):
        """The rung schedule for one package at the given quotes."""
        return plan_for_payload(payload, quotes, steps, get_ticksize(symbol), width)


    def working_ladder(self, payload, quotes, symbol, steps, width=None):
        """The prices this bot will quote for a package, opening rung first.

        Every phase of the working loop goes through here, so the list is
        what the order actually walks: rung 0 leaves with the opening order
        and each replacement takes the next one. A defined risk package
        passes its strike `width`, which holds the whole ladder a tick below
        what the spread can pay out.
        """
        return list(self.working_plan(payload, quotes, symbol, steps, width).prices)


    def build_ladder(self, payload, username, trading_symbol, spread_diff):
        """Re-price the ladder for one package against the live quotes.

        This runs again at every replacement, so a rung always reflects the
        book as it stands rather than the book at the opening order. Returns
        None when the quote call comes back empty, which the callers treat
        exactly like the old `limit_price is None` branch did.
        """
        token_type = 'Bearer'
        access_token = self.access_token_info.get(username)
        if access_token is None:
            return None

        quotes = get_list_quote(token_type, access_token, self.quote_symbols(payload))
        if quotes is None:
            return None

        width = spread_diff if spread_diff is not None else package_width(payload)
        plan = self.working_plan(payload, quotes, trading_symbol,
                                 self.ladder_size(), width)
        if plan.opening_price is None:
            return None
        return plan


    def apply_rung(self, user_payload, plan, rung_index):
        """Stamp the rung for this replacement onto a payload.

        Returns False once the ladder has no rung left at `rung_index`, which
        is the engine's signal that the package belongs on a market order now
        rather than on another replacement at a price it already quoted.
        """
        price = plan.price_at(rung_index)
        if price is None:
            return False
        user_payload['price'] = price
        return True


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
        vix_gap_lower = (vix_today_open > 0 and vix_today_open < vix_previous_close) if vix_automatic_mode else self.admin_info.get('vix_gap_lower', False)
        order_gap_sec = self.admin_info.get('order_gap_sec', 10)
        ladder_steps = self.ladder_size()
        print(f"vix automatic mode:{vix_automatic_mode}  |  vix gap lower:{vix_gap_lower}  |  order gap sec:{order_gap_sec}  |  ladder steps:{ladder_steps}")




        # Check if VIX gaps lower
        if vix_gap_lower:

            
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
            print(f"VIX has gapped lower. Fetching options chain for trading symbols...")
            #start trading

            signal_info = {}
            for trading_group in trading_groups.keys():
                trading_symbol = trading_group.split('-')[0]
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
                        #print(acc_balance, risk_percentage)
                        #The ladder can walk the debit up, so size against the
                        #rung the account would settle for rather than the mid
                        #it opens at. A package worked all the way to the far
                        #touch still has to fit inside the same budget.
                        sizing_plan = self.build_ladder(payload, username, trading_symbol, spread_diff)
                        if sizing_plan is not None and sizing_plan.final_price is not None:
                            lot_size = sizing_plan.lot_size(acc_balance, risk_percentage)
                        else:
                            #No ladder to read, so fall back to the midpoint
                            #the payload already carries.
                            debit_to_use = acc_balance* (risk_percentage/100)
                            premium = payload['price']
                            lot_size = math.floor(debit_to_use / (premium*100))
                        #print(acc_balance, risk_percentage, debit_to_use, premium, lot_size)

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
            print('====================   Bot1: Initial Order Send  =====================')
            self.send_init_order(signal_info)


            #Walk the rest of the ladder. Rung 0 went out with the opening
            #order, so replacements start at rung 1 and stop as soon as every
            #package has run out of rungs; a ladder that collapsed to a single
            #rung goes straight to the market step.
            repeat_gap_sec = order_gap_sec
            rung_index = 1

            while rung_index < ladder_steps:
                time.sleep(repeat_gap_sec)
                print(f'====================   Bot1: {rung_index}.Modify Order Price  =====================')
                if not self.modify_order_price(signal_info, rung_index):
                    print('Bot1: every ladder is spent, going to market')
                    break
                rung_index += 1

            #modify order to market
            time.sleep(repeat_gap_sec)
            print(f'==================== Bot1:   Modify Order Market  =====================')
            self.modify_order_market(signal_info)



        else:
            print("VIX did not gap lower. No trades executed.")
        return True


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

                #update the lot size for current user
                leg_n = len(user_payload['orderLegCollection'])
                for j in range(leg_n):
                    user_payload['orderLegCollection'][j]['quantity'] = lot_size

                user_info = self.user_info[username]

                token_type = 'Bearer'
                access_token = self.access_token_info[username]
                account_id = self.account_info[username]


                plan = self.build_ladder(user_payload, username, trading_symbol, spread_diff)
                if plan is None:
                    print(f"We stop sending the init order of {username} becase the ladder came back empty.")
                else:
                    print(f'SPREAD DIFF: {spread_diff}  |  {plan.describe()}')
                    self.ladder_plans[username] = plan

                    #The opening order always goes out at rung 0, the midpoint.
                    if not self.apply_rung(user_payload, plan, 0):
                        print(f"We stop sending the init order of {username} becase the ladder came back empty.")
                        continue

                    process = Thread(target = send_order, args = [token_type, access_token, account_id, user_payload, trading_symbol, strategy_type, order_result_dict, username])
                    process.start()
                    threads.append(process)
        
        for process in threads:
            process.join()

        self.order_result_dict = order_result_dict



    def modify_order_price(self, signal_info, rung_index):
        """Replace every unfilled order at rung `rung_index` of its ladder.

        Returns True when at least one package still had a rung left to
        quote, so the caller knows whether another replacement round is worth
        waiting out or the market step should come next.
        """
        threads = []
        worked_a_rung = False
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
                #update the lot size for current user
                leg_n = len(user_payload['orderLegCollection'])
                for j in range(leg_n):
                    user_payload['orderLegCollection'][j]['quantity'] = lot_size


                order_id, order_status, status_description = order_result_dict[username][0], order_result_dict[username][1], order_result_dict[username][2]
                if order_id is not None and order_status == 'FILLED':#or order_status == 'REJECTED':
                    print(f"{username}. {order_id} is already Filled.")
                    continue

                print(f'Modify Order With New Price For {username}')

                token_type = 'Bearer'
                access_token = self.access_token_info[username]
                account_id = self.account_info[username]


                plan = self.build_ladder(user_payload, username, trading_symbol, spread_diff)
                if plan is None:
                    print(f"We stop modifying the order of {username} because the ladder came back empty.")
                else:
                    print(f'SPREAD DIFF: {spread_diff}  |  {plan.describe()}')
                    self.ladder_plans[username] = plan

                    if not self.apply_rung(user_payload, plan, rung_index):
                        #Nothing left to concede for this package. Leave it
                        #working where it is; the market step will take it.
                        print(f"{username} has walked the whole ladder.")
                        continue
                    worked_a_rung = True


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
        return worked_a_rung


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
            #remove the price keys
            payload.pop('price')
            payload['orderType'] = 'MARKET'


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
                #update the lot size for current user
                leg_n = len(user_payload['orderLegCollection'])
                for j in range(leg_n):
                    user_payload['orderLegCollection'][j]['quantity'] = lot_size


                order_id, order_status  = order_result_dict[username][0], order_result_dict[username][1]
                if order_id is not None and order_status == 'FILLED':# or order_status == 'REJECTED':
                    print(f"{username}: {order_id} is already Filled.")
                    continue

                print(f'Modify Order To Market Order For {username}')
                token_type = 'Bearer'
                access_token = self.access_token_info[username]
                account_id = self.account_info[username]

                #print(f"=========== {username}.  modify order to market  =========")
                #order_id  = modify_order_to_market(token_type, access_token, account_id, payload, 'combo_order')    
                #print(f"========== {username}. moidfied order to market at {datetime.now()}")
                #new_order_result_dict.update({username:[order_id, None]})
                if order_id is None or order_status =='REJECTED':
                    process = Thread(target = send_order, args = [token_type, access_token, account_id, user_payload, trading_symbol, strategy_type, new_order_result_dict, username])
                else:
                    process = Thread(target = modify_order, args = [token_type, access_token, account_id, order_id, user_payload, trading_symbol,strategy_type, new_order_result_dict, username])
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

        #send order result signal
        try:
            print('sending the bot1 order result signal')
            ws = create_connection(f"{WS_ENDPOINT}/ws/signalpath/")
            ws.send(
                json.dumps({
                    'bot_name':'bot01',
                    'message':"send_order_result",
                    'order_result_dict':order_result_dict
                })
            )
        except:
            print('failed to connect websocket in setting the server info for bot1')


    def show_bid_ask_for_all_strikes(self, call_options_chain, put_options_chain):
        call_exp_dates = list(call_options_chain["callExpDateMap"].keys())
        put_exp_dates = list(put_options_chain['putExpDateMap'].keys())


        common_exp_dates = []
        for call_exp_date in call_exp_dates:
            if call_exp_date in put_exp_dates:
                common_exp_dates.append(call_exp_date)
        
        for exp_date in common_exp_dates:
            calls_by_exp = call_options_chain["callExpDateMap"][exp_date]
            puts_by_exp = put_options_chain["putExpDateMap"][exp_date]


            option_dict = {}
            for call_by_price in list(calls_by_exp.values()):
                for call in call_by_price:
                    strike_price = call['strikePrice']
                    key_strike_price = f'{strike_price}'
                    #print(f'call: {strike_price}')
                    option_dict.update({key_strike_price:[call]})
                    

            for put_by_price in list(puts_by_exp.values()):
                for put in put_by_price:
                    strike_price = put['strikePrice']
                    key_strike_price = f'{strike_price}'
                    #print(f'put: {strike_price}')
                    option_dict[key_strike_price].append(put)

            print(f"{'call bid':<8}   {'call ask':<8}   :  {'strike':<8}  : {'put bid':<8}   {'put ask':<8}")
            for strike_price in option_dict.keys():
                call_option, put_option = option_dict[strike_price][0], option_dict[strike_price][1]
                #print(call_option)
                print(f'{call_option['bid']:<8}   {call_option['ask']:<8}   :  {strike_price:<8}  : {put_option['bid']:<8}   {put_option['ask']:<8}')

            break



    def find_order_payload(self, p_trading_group):
        sim_symbol, p_strategy_type = p_trading_group.split('-')[0], p_trading_group.split('-')[1]
        p_symbol = '$XSP' if sim_symbol == '$XSPSIM' else sim_symbol


        time_zone = BOT1_TIME_ZONE
        TZ = pytz.timezone(time_zone)
        cur_time = datetime.now(TZ)
        today_str = cur_time.strftime("%Y-%m-%d")

        spread_diff = None



        if p_strategy_type == 'Terrance Trade':
            #call_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'CALL', strike_range = 'OTM', from_date = today_str, to_date = today_str)
            #put_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'PUT', strike_range = 'OTM', from_date = today_str, to_date = today_str)
            call_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'CALL', strike_range = None, from_date = today_str, to_date = today_str)
            put_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'PUT', strike_range = None, from_date = today_str, to_date = today_str)

            #print(call_options_chain)
            #print(put_options_chain)



            '''
            call_out_file = open("call_option_chains.json", "w")
            json.dump(call_options_chain, call_out_file, indent = 3)
            call_out_file.close()
            put_out_file = open("put_option_chains.json", "w")
            json.dump(put_options_chain, put_out_file, indent = 3)
            put_out_file.close()
            '''



            print("Finding 0.10 OTM options...")
            call_option, put_option = self.find_otm_options(call_options_chain, put_options_chain, 0.1, False)
            call_ask = call_option['ask']
            call_bid = call_option['bid']
            put_ask = put_option['ask']
            put_bid = put_option['bid']

            limit_price = (call_ask + call_bid)/2 + (put_ask + put_bid)/2
            limit_price = get_valid_price(limit_price, p_symbol)
            

            order_payload = self.get_terrance_payload(call_option, put_option, limit_price)
        elif p_strategy_type == 'Iron Fly':
            call_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'CALL', strike_range = None,from_date = today_str, to_date = today_str)
            put_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'PUT', strike_range = None, from_date = today_str, to_date = today_str)


            atm_call_option, atm_put_option = self.find_atm_options(call_options_chain, put_options_chain)
            otm_call_option, otm_put_option = self.find_otm_options(call_options_chain, put_options_chain, 0.5, True)
            spread_diff = math.fabs(otm_call_option['strikePrice'] - atm_call_option['strikePrice'])

            buy_call_ask, buy_call_bid = atm_call_option['ask'], atm_call_option['bid']
            buy_call_price = (buy_call_ask + buy_call_bid)/2.0
            buy_put_ask, buy_put_bid = atm_put_option['ask'], atm_put_option['bid']
            buy_put_price = (buy_put_ask + buy_put_bid)/2.0

            sell_call_ask, sell_call_bid = otm_call_option['ask'], otm_call_option['bid']
            sell_call_price = (sell_call_ask + sell_call_bid)/2.0
            sell_put_ask, sell_put_bid = otm_put_option['ask'], otm_put_option['bid']
            sell_put_price = (sell_put_ask + sell_put_bid)/2.0

            print(sell_call_price, sell_put_price, buy_call_price, buy_put_price)
            limit_price = (buy_call_price + buy_put_price) - (sell_call_price + sell_put_price)
            limit_price = get_valid_price(limit_price, p_symbol)
            order_payload = self.get_ironfly_payload(atm_call_option, atm_put_option, otm_call_option, otm_put_option, limit_price)

        elif p_strategy_type == 'Terrance Trade/Iron Fly Combo':
            call_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'CALL', strike_range = None,from_date = today_str, to_date = today_str)
            put_options_chain = schwab_api_get_option_chain(headers = self.access_headers, symbol = p_symbol, contract_type = 'PUT', strike_range = None, from_date = today_str, to_date = today_str)

            #self.show_bid_ask_for_all_strikes(call_options_chain, put_options_chain) 

            atm_call_option, atm_put_option = self.find_atm_options(call_options_chain, put_options_chain)
            otm_call_option, otm_put_option = self.find_otm_options(call_options_chain, put_options_chain, 0.5, False)
            spread_diff = math.fabs(otm_call_option['strikePrice'] - atm_call_option['strikePrice'])

            buy_call_ask, buy_call_bid = atm_call_option['ask'], atm_call_option['bid']
            buy_call_price = (buy_call_ask + buy_call_bid)/2.0
            buy_put_ask, buy_put_bid = atm_put_option['ask'], atm_put_option['bid']
            buy_put_price = (buy_put_ask + buy_put_bid)/2.0

            sell_call_ask, sell_call_bid = otm_call_option['ask'], otm_call_option['bid']
            sell_call_price = (sell_call_ask + sell_call_bid)/2.0

            limit_price = buy_call_price + buy_put_price - sell_call_price
            limit_price = get_valid_price(limit_price, p_symbol)
            order_payload = self.get_terrance_iron_combo_payload(atm_call_option, atm_put_option, otm_call_option, limit_price)

        return order_payload, spread_diff
