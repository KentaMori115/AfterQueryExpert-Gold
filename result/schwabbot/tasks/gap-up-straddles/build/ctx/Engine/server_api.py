import pytz
import json
import requests
import base64
import math
from django.utils import timezone
from datetime import timedelta

from .config import *

from BotList.models import Bot, BotRefresh, BotAccess, BotOnOff, BotSetting
from django.contrib.auth.models import User
from .schwab_api import *
from .offline import (
    cancel_paper_order,
    is_offline,
    offline_account_details,
    offline_quote_map,
    paper_order_status,
    paper_order_summaries,
    record_paper_order,
)


def get_timezones():
    timezones = pytz.all_timezones
    return timezones

def get_validsymbols():
    #return ['$SPX', '$XSP', 'SPY']
    return ['$XSP', '$SPX', '$XSPSIM']


def get_one_valid_access_token():
    bot_refresh_objs = BotRefresh.objects.all()
    for bot_refresh_obj in bot_refresh_objs:
        user_id = bot_refresh_obj.user_id
        access_token = get_access_token(user_id)
        if access_token is not None:
            return access_token

    return None


def get_access_token(user_id):
    #check refresh token expire
    try:
        botref_obj = BotRefresh.objects.get(user_id = user_id)
        refresh_token = botref_obj.refresh_token
        expire_at = botref_obj.created_at + timedelta(days = REF_TOKEN_EXPIRE_DAY)
        now = timezone.now()
        expire_diff = expire_at-now
        expire_sec = expire_diff.total_seconds()
        if expire_sec < 0:
            print(f'refresh token is expired: {expire_sec}')
            return None

    except:
        print('error: refresh token is expired')
        return None

    #check the access token expire
    access_token= None
    try:
        botaccess_obj = BotAccess.objects.get(user_id = user_id)
        expire_at = botaccess_obj.created_at + timedelta(seconds = ACC_TOKEN_EXPIRE_SEC)
        now = timezone.now()
        expire_diff = expire_at-now
        expire_sec = expire_diff.total_seconds()
        if expire_sec > 0:
            access_token= botaccess_obj.access_token
    except:
        pass


    if access_token== None:
        if is_offline():
            access_token = generate_access_token({}, refresh_token)
        else:
            headers = get_token_req_headers(CLIENT_ID, CLIENT_SECRET)
            access_token = generate_access_token(headers, refresh_token)
        if access_token is not None:
            BotAccess.objects.update_or_create(
                user_id = user_id, 
                defaults = {'access_token':access_token, 'created_at':timezone.now()})

    #print('ACCES TOKEN', user_id, refresh_token, access_token)

    return access_token


def get_order_status(account_id, order_id, user_id):
    print(f'getting order status: {order_id}')
    if is_offline():
        return paper_order_status(order_id)
    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders/{order_id}'
    token_type = 'Bearer'
    access_token = get_access_token(user_id)
    if access_token == None:
        return None
    
    headers = get_access_headers(token_type, access_token)

    response = requests.get(order_endpoint, headers= headers)
    if response.ok:
        order_details = json.loads(response.text)
        print(order_details)
        try:
            order_status = order_details['status']
        except:
            order_status = 'NONE'
        
        try:
            status_description =  order_details['statusDescription']
        except:
            status_description = ''
        return order_status, status_description
    else:
        error = json.loads(response.text)
        print("Error fetching order details:", error)
        return None


def get_order_status_by_username(username, order_id):
    #get the user id
    try:
        user_obj = User.objects.get(username = username)
        user_id = user_obj.id
    except:
        print('Invalid user:', username)
        return None, None



    #get the account id ( hashvalue)
    account_details = get_account_details(user_id)
    account_id = None
    if account_details is not None and len(account_details) > 0:
        account_id = account_details[0]['hashValue']


    if account_id is None:
        print(f'Bot1 - {username} failed to get account info')
        return None, None


    if order_id is None:
        return None, None

    return get_order_status(account_id, order_id, user_id)

def get_pair_quote(quote_call_symbol, quote_put_symbol, user_id):
    if is_offline():
        return offline_quote_map([quote_call_symbol, quote_put_symbol])
    params = {
        'symbols':f'{quote_call_symbol},{quote_put_symbol}',
        'fields':'quote,reference'
    }
    quote_endpoint = f'{SCHWAB_MARKET_URL}/quotes'

    token_type = 'Bearer'
    access_token = get_access_token(user_id)
    headers = get_access_headers(token_type, access_token)
    response = requests.get(quote_endpoint, params = params, headers= headers)

    if response.ok:
        data = json.loads(response.text)
        #print(quote_call_symbol, quote_put_symbol)
        #print(data)
        return data
    else:
        error = json.loads(response.text)
        print("Error fetching quote:", error)
        return None



def get_account_details(user_id):
    if is_offline():
        return offline_account_details()
    acc_detail_endpoint = f'{SCHWAB_TRADER_URL}/accounts/accountNumbers'

    token_type = 'Bearer'
    access_token = get_access_token(user_id)
    if access_token == None:
        return None
    
    headers = get_access_headers(token_type, access_token)


    response = requests.get(acc_detail_endpoint, headers = headers)
    if response.ok:
        data = json.loads(response.text)
        #print("Account Details:", data)
        return data
    else:
        error = json.loads(response.text)
        print("Error fetching account details:", error)
        return None



def send_order(username, payload_dump, order_type):
    payload = json.loads(payload_dump)
    #print(payload)
    #get the user id
    try:
        user_all_objs = User.objects.all()
        user_obj = User.objects.get(username = username)
        user_id = user_obj.id
    except:
        print('Invalid user:', username)
        return None, None, None, None

    #get the bot id
    try:
        bot_obj = Bot.objects.get(botname = 'Bot1')
        bot_id = bot_obj.id
    except:
        print('Invalid bot:', 'Bot1')

    #get the access token
    token_type = 'Bearer'
    access_token = get_access_token(user_id)
    if access_token == None:
        print(f'Bot1 - {username} acces token expired')
        return None, None, None, None


    #get the account id ( hashvalue)
    account_details = get_account_details(user_id)
    account_id = None
    if account_details is not None and len(account_details) > 0:
        account_id = account_details[0]['hashValue']


    if account_id is None:
        print(f'Bot1 - {username} failed to get account info')
        return None, None, None, None



    headers = get_order_access_headers(token_type, access_token)
    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders'





    #update the price of the order_payload
    if order_type == 'combo_order':
        #get the recent price and update it
        quote_call_symbol = payload['orderLegCollection'][0]['instrument']['symbol']
        quote_put_symbol = payload['orderLegCollection'][1]['instrument']['symbol']
        #print(quote_call_symbol, quote_put_symbol)


        quote_data = get_pair_quote(quote_call_symbol, quote_put_symbol, user_id)

        call_quote_data = quote_data[quote_call_symbol]['quote']
        put_quote_data = quote_data[quote_put_symbol]['quote']
        call_bid = call_quote_data['bidPrice']
        call_ask = call_quote_data['askPrice']
        put_bid = put_quote_data['bidPrice']
        put_ask = put_quote_data['askPrice']
        limit_price = (call_bid + call_ask)/2.0 + (put_bid + put_ask)/2.0

        #limit_price = limit_price/2
        
        limit_price = round(limit_price, 2)
        #print(limit_price)
        payload['price'] = limit_price

    else:
        pass


    lot_size = payload['orderLegCollection'][0]['quantity']
    #update the detailed run setting for the curent user and current bot
    if order_type == 'combo_order':
        #get the run setting
        try:
            bot_setting_obj = BotSetting.objects.get(user_id =user_id, bot_id = bot_id)
        except:
            bot_setting_obj = None

        if bot_setting_obj is not None:
            #update the lot size
            setting_json = json.loads(bot_setting_obj.setting)
            contract_type = setting_json['contract_type']
            fixed_lots = int(setting_json['fixed_lots'])
            risk_percentage = float(setting_json['risk_percentage'])

            if contract_type == 'Fixed':
                lot_size = fixed_lots
            else:
                #get the account balance
                balance_headers = get_access_headers(token_type, access_token)
                acc_balance = schwab_api_get_account_balance(balance_headers)
                #print(acc_balance, risk_percentage)
                debit_to_use = acc_balance* (risk_percentage/100)
                premium = payload['price']
                lot_size = math.floor(debit_to_use / (premium*100))

                '''
                print('==========   Calculation Of Account Balance ==========')
                print(f'balance = {acc_balance}')
                print(f'risk_percentage = {risk_percentage}')
                print(f'debit_to_use = {debit_to_use}')
                print(f'premium = {premium}')
                print(f'lot size = {lot_size}')
                print('======================================================')
                '''


            lot_size = max(lot_size, 1)
            payload['orderLegCollection'][0]['quantity'] = lot_size
            payload['orderLegCollection'][1]['quantity'] = lot_size

    else:
        pass

    print('INITIAL ORDER SENDING...')
    #return None

    #order send
    '''
    payload = {
        "orderType": "LIMIT",
        "session": "NORMAL",
        "duration": "DAY",
        "price":180,
        "orderStrategyType": "SINGLE",
        "orderLegCollection": [
            {
                "orderLegType": 'EQUITY',
                "instruction": 'BUY',
                "quantity": 1,
                "quantityType": 'SHARES',
                "instrument": {
                    "symbol": "AAPL",
                    "assetType": "EQUITY"
                }
            }
        ]
    }
    '''



    print(payload)
    #print(order_endpoint)
    #print(headers)






    #return None, None, lot_size, None

    if is_offline():
        order_id = record_paper_order(payload, username)
        order_state, status_description = paper_order_status(order_id)
        return order_id, order_state, lot_size, status_description

    response = requests.post(order_endpoint, data=json.dumps(payload), headers=headers)


    if response.ok:
        print("Order placed successfully.")

        #get the order id
        try:
            location_header = response.headers.get('Location')
            if location_header is not None:
                #print('location header...')
                #print(location_header)
                #Split the 'Location' header to get the order ID
                order_id = location_header.split('/')[-1]

                #print(account_id, order_id, user_id)
                order_state, status_description = get_order_status(account_id, order_id, user_id)
                print(status_description)
                return order_id, order_state, lot_size, status_description
            else:
                print('Location header is missing in the response.')
                return None, None, lot_size, None
        except:
            print('Error in finding the order id')
            return None, None, lot_size, None
    else:
        error = json.loads(response.text)
        print("Error placing order:", error)
        return None, None, lot_size, None



def modify_order_with_newprice(order_id, username, payload_dump, order_type, lot_size):
    payload = json.loads(payload_dump)
    #print(payload)
    #get the user id
    try:
        user_all_objs = User.objects.all()
        user_obj = User.objects.get(username = username)
        user_id = user_obj.id
    except:
        print('Invalid user:', username)
        return None, None, lot_size, None

    #get the bot id
    try:
        bot_obj = Bot.objects.get(botname = 'Bot1')
        bot_id = bot_obj.id
    except:
        print('Invalid bot:', 'Bot1')

    #get the access token
    token_type = 'Bearer'
    access_token = get_access_token(user_id)
    if access_token == None:
        print(f'Bot1 - {username} acces token expired')
        return None, None, lot_size, None


    #get the account id ( hashvalue)
    account_details = get_account_details(user_id)
    account_id = None
    if account_details is not None and len(account_details) > 0:
        account_id = account_details[0]['hashValue']


    if account_id is None:
        print(f'Bot1 - {username} failed to get account info')
        return None, None, lot_size, None



    headers = get_order_access_headers(token_type, access_token)
    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders/{order_id}'





    #get the recent price and update it
    quote_call_symbol = payload['orderLegCollection'][0]['instrument']['symbol']
    quote_put_symbol = payload['orderLegCollection'][1]['instrument']['symbol']
    #print(quote_call_symbol, quote_put_symbol)


    quote_data = get_pair_quote(quote_call_symbol, quote_put_symbol, user_id)

    call_quote_data = quote_data[quote_call_symbol]['quote']
    put_quote_data = quote_data[quote_put_symbol]['quote']
    call_bid = call_quote_data['bidPrice']
    call_ask = call_quote_data['askPrice']
    put_bid = put_quote_data['bidPrice']
    put_ask = put_quote_data['askPrice']
    limit_price = (call_bid + call_ask)/2.0 + (put_bid + put_ask)/2.0

    #limit_price = limit_price/2

    limit_price = round(limit_price, 2)
    #print(limit_price)
    payload['price'] = limit_price




    payload['orderLegCollection'][0]['quantity'] = lot_size
    payload['orderLegCollection'][1]['quantity'] = lot_size

    print('MID ORDER Modifying...')
    #return None


    print(payload)
    #print(order_endpoint)
    #print(headers)
    #return None, None, lot_size, None
    

    response = requests.put(order_endpoint, data=json.dumps(payload), headers=headers)


    if response.ok:
        print("Order modified successfully.")


        #get the order id
        try:
            location_header = response.headers.get('Location')
            if location_header is not None:
                #Split the 'Location' header to get the order ID
                order_id = location_header.split('/')[-1]

                #print(account_id, order_id, user_id)
                order_state, status_description = get_order_status(account_id, order_id, user_id)
                print(status_description)
                return order_id, order_state, lot_size, status_description
            else:
                print('Location header is missing in the response.')
                return None, None, lot_size, None
        except:
            print('Error in finding the order id')
            return None, None, lot_size, None
    else:
        error = json.loads(response.text)
        print("Error in modifying order:", error)
        return None, None, lot_size, None








def modify_order_to_market(order_id, username, payload_dump, order_type, lot_size):
    payload = json.loads(payload_dump)
    #print(payload)
    #get the user id
    try:
        user_all_objs = User.objects.all()
        user_obj = User.objects.get(username = username)
        user_id = user_obj.id
    except:
        print('Invalid user:', username)
        return None, None, lot_size, None

    #get the bot id
    try:
        bot_obj = Bot.objects.get(botname = 'Bot1')
        bot_id = bot_obj.id
    except:
        print('Invalid bot:', 'Bot1')

    #get the access token
    token_type = 'Bearer'
    access_token = get_access_token(user_id)
    if access_token == None:
        print(f'Bot1 - {username} acces token expired')
        return None, None, lot_size, None


    #get the account id ( hashvalue)
    account_details = get_account_details(user_id)
    account_id = None
    if account_details is not None and len(account_details) > 0:
        account_id = account_details[0]['hashValue']


    if account_id is None:
        print(f'Bot1 - {username} failed to get account info')
        return None, None, lot_size, None



    headers = get_order_access_headers(token_type, access_token)
    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders/{order_id}'





    #remove the price keys
    payload.pop('price')
    payload['orderType'] = 'MARKET'
    payload['orderLegCollection'][0]['quantity'] = lot_size
    payload['orderLegCollection'][1]['quantity'] = lot_size

    print('FINAL Market ORDER Modifying...')
    #return None


    print(payload)
    #print(order_endpoint)
    #print(headers)
    #return None, None, lot_size, None

    if is_offline():
        cancel_paper_order(order_id)
        new_id = record_paper_order(payload, username)
        order_state, status_description = paper_order_status(new_id)
        return new_id, order_state, lot_size, status_description
    
    response = requests.put(order_endpoint, data=json.dumps(payload), headers=headers)


    if response.ok:
        print(f"Order modified to market order.")

        #get the order id
        try:
            location_header = response.headers.get('Location')
            if location_header is not None:
                #Split the 'Location' header to get the order ID
                order_id = location_header.split('/')[-1]

                #print(account_id, order_id, user_id)
                order_state, status_description = get_order_status(account_id, order_id, user_id)
                print(status_description)
                return order_id, order_state, lot_size, status_description
            else:
                print('Location header is missing in the response.')
                return None, None, lot_size, status_description
        except:
            print('Error in finding the order id')
            return None, None, lot_size, None
    else:
        error = json.loads(response.text)
        print("Error placing order:", error)
        return None, None, lot_size, None





def cancel_order(username, order_id):
    #get the user id
    try:
        user_obj = User.objects.get(username = username)
        user_id = user_obj.id
    except:
        print('Invalid user:', username)
        return



    #get the account id ( hashvalue)
    account_details = get_account_details(user_id)
    account_id = None
    if account_details is not None and len(account_details) > 0:
        account_id = account_details[0]['hashValue']


    if account_id is None:
        print(f'Bot1 - {username} failed to get account info')
        return


    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders/{order_id}'



    token_type = 'Bearer'
    access_token = get_access_token(user_id)
    if access_token == None:
        return
    
    headers = get_access_headers(token_type, access_token)



    print(order_endpoint)
    if order_id is None:
        return

    if is_offline():
        cancel_paper_order(order_id)
        print(f'Cancelled the order {order_id} on the account {username}')
        return

    response = requests.delete(order_endpoint, headers=headers)
    if response.ok:
        print(f'Cancelled the order {order_id} on the account {username}')
    else:
        print('Error in cancelling the order as following reason')
        if response.text:
            print(response.text)
        else:
            print('Something went wrong')
    






def send_group_order(usernames, order_payload_dump, order_type):
    order_result_dict = {}
    for username in usernames:
        print(f'Send Order For {username}')
        order_id, order_status, lot_size, status_description = send_order(username, order_payload_dump, order_type)    
        print(f'Placed an order {order_id}, {order_status}, {status_description}') #'ACCEPTED' 'FILLED' 'WORKING' or None
        order_result_dict.update({username:[order_id, order_status, lot_size, status_description]})
    return order_result_dict


def modify_group_order(user_names, order_result_dict, order_payload_dump, order_type):
    print("Group Modifying...")
    print(order_result_dict.keys())
    new_order_result_dict = {}
    for username in user_names:
        order_id, order_status, lot_size, status_description = order_result_dict[username][0], order_result_dict[username][1], order_result_dict[username][2], order_result_dict[username][3]
        if order_id is None or order_status == 'FILLED' or order_status == 'REJECTED':
            print(f"{username}: {order_id} is already Filled or Rejected.")
            continue
        print(f'Modify Order With New Price For {username}')
        order_id, order_status, lot_size, status_description = modify_order_with_newprice(order_id, username, order_payload_dump, order_type, lot_size)    
        print(f'Modify the order {order_id}, {order_status}, {status_description}') #'ACCEPTED' 'FILLED' 'WORKING' or None

        new_order_result_dict.update({username:[order_id, order_status, lot_size, status_description]})
    return new_order_result_dict


def modify_group_market_order(user_names, order_result_dict, order_payload_dump, order_type):
    print("Group Market Modifying...")
    print(order_result_dict.keys())
    new_order_result_dict = {}
    for username in user_names:
        order_id, order_status, lot_size, status_description = order_result_dict[username][0], order_result_dict[username][1], order_result_dict[username][2], order_result_dict[username][3]
        if order_id is None or order_status == 'FILLED' or order_status == 'REJECTED':
            print(f"{username}: {order_id} is already Filled or Rejected.")
            continue

        print(f'Modify Order To Market Order For {username}')
        order_id, order_status, lot_size, status_description = modify_order_to_market(order_id, username, order_payload_dump, order_type, lot_size)    
        print(f'Modify the order {order_id}, {order_status}, {status_description}') #'ACCEPTED' 'FILLED' 'WORKING' or None

        new_order_result_dict.update({username:[order_id, order_status, lot_size, status_description]})
    return new_order_result_dict






def get_order_result_by_username(username, from_entered_time, to_entered_time):
    summary_orders = []    
    #get the user id
    try:
        user_all_objs = User.objects.all()
        user_obj = User.objects.get(username = username)
        user_id = user_obj.id
    except:
        print('In getting order results - Invalid user: ', username)
        return summary_orders

    #get the access token
    token_type = 'Bearer'
    access_token = get_access_token(user_id)
    if access_token == None:
        print(f'In getting order results - {username} acces token expired')
        return summary_orders


    #get the account id ( hashvalue)
    account_details = get_account_details(user_id)
    account_id = None
    if account_details is not None and len(account_details) > 0:
        account_id = account_details[0]['hashValue']


    if account_id is None:
        print(f'In getting order results - {username} failed to get account info')
        return summary_orders



    headers = get_access_headers(token_type, access_token)
    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders'



    
    params = {
        'fromEnteredTime':from_entered_time,
        'toEnteredTime':to_entered_time
    }

    if is_offline():
        return paper_order_summaries(username)

    response = requests.get(order_endpoint, headers=headers, params = params)
    if response.ok:
        orders = json.loads(response.text)
        for order in orders:
            #print()
            #print(order)
            #get the order type
            order_type = order.get('orderType')
            if order_type is None:
                continue


            #get the leg info            
            order_legs = order.get('orderLegCollection')
            if order_legs is None:
                continue
            order_leg_info = []
            order_leg_n = len(order_legs)
            for order_leg in order_legs:
                order_leg_symbol = order_leg['instrument']['symbol']
                order_leg_asset = order_leg['instrument']['assetType']
                order_leg_id = order_leg['legId']
                order_leg_action = order_leg['instruction']
                order_leg_qty = order_leg['quantity']
                order_leg_info.append({'symbol':order_leg_symbol, 'asset':order_leg_asset, 'id':order_leg_id, 'action':order_leg_action, 'qty':order_leg_qty})

            #get the order time
            order_time = order['enteredTime']


            #get the order status
            order_status = order['status']
            order_status_desp = order.get('statusDescription')
            if order_status_desp is None:
                order_status_desp = ""

            #get the price info
            if order_type == 'MARKET':
                order_price_info = {'limit':'', 'stop':'', 'fill':'', 'entry':''}
            else:
                if order_status == 'FILLED':
                    order_price_info = {'limit':'', 'stop':'', 'fill':'', 'entry':f'${order['price']}'}
                elif order_type == 'NET_DEBIT' or order_type == 'LIMIT' or order_type == 'NET_CREDIT':
                    order_price_info = {'limit':f'${order['price']}', 'stop':'', 'fill':'', 'entry':''}
                elif order_type == 'STOP':
                    order_price_info = {'limit':'', 'stop':f'${order['stopPrice']}', 'fill':'', 'entry':''}
                else:
                    order_price_info = {'limit':'', 'stop':'', 'fill':'', 'entry':''}
            #get the fill price
            order_activity_list = order.get('orderActivityCollection')
            if order_activity_list is not None:
                for order_activity in order_activity_list:
                    order_exe_legs = order_activity.get('executionLegs')
                    if order_exe_legs is not None and order_status == 'FILLED':
                        fill_price = ''

                        order_exe_leg_num = 0
                        for order_exe_leg in order_exe_legs:
                            if order_exe_leg_num < len(order_leg_info):
                                order_exe_action = order_leg_info[order_exe_leg_num]['action']

                                if order_exe_action == 'BUY_TO_OPEN' or order_exe_action == 'SELL_TO_CLOSE':
                                    fill_price = fill_price + f'+${order_exe_leg.get('price')} '
                                else:
                                    fill_price = fill_price + f'-${order_exe_leg.get('price')} '
                            order_exe_leg_num+=1

                            
                        order_price_info.update({'fill':fill_price})
            
            #get the order tag
            order_tag = order['tag']


            #analyze the children order
            child_summary_orders = []
            child_orders = order.get('childOrderStrategies')
            if child_orders != None:
                for child_order in child_orders:
                    child_order_type = child_order.get('orderType')
                    if child_order_type is None:
                        continue


                    #get the leg info            
                    child_order_legs = child_order.get('orderLegCollection')
                    if child_order_legs is None:
                        continue
                    child_order_leg_info = []
                    child_order_leg_n = len(child_order_legs)
                    for child_order_leg in child_order_legs:
                        child_order_leg_symbol = child_order_leg['instrument']['symbol']
                        child_order_leg_asset = child_order_leg['instrument']['assetType']
                        child_order_leg_id = child_order_leg['legId']
                        child_order_leg_action = child_order_leg['instruction']
                        child_order_leg_qty = child_order_leg['quantity']
                        child_order_leg_info.append({'symbol':child_order_leg_symbol, 'asset':child_order_leg_asset, 'id':child_order_leg_id, 'action':child_order_leg_action, 'qty':child_order_leg_qty})

                    #get the order time
                    child_order_time = child_order['enteredTime']
                    #get the order status
                    child_order_status = child_order['status']
                    child_order_status_desp = child_order.get('statusDescription')
                    if child_order_status_desp is None:
                        child_order_status_desp = ""

                    #get the price info
                    child_order_price = child_order.get('price')
                    if child_order_price is None:
                        child_order_price = ''
                    child_order_stop_price = child_order.get('stopPrice')
                    if child_order_stop_price is None:
                        child_order_stop_price = ''

                    if child_order_type == 'MARKET':
                        child_order_price_info = {'limit':'', 'stop':'', 'fill':'', 'entry':''}
                    else:
                        if child_order_status == 'FILLED':
                            child_order_price_info = {'limit':'', 'stop':'', 'fill':'', 'entry':f'${child_order_stop_price}'}
                        elif child_order_type == 'NET_DEBIT' or child_order_type == 'LIMIT' or child_order_type == 'NET_CREDIT':
                            child_order_price_info = {'limit':f'${child_order_price}', 'stop':'', 'fill':'', 'entry':''}
                        elif child_order_type == 'STOP':
                            child_order_price_info = {'limit':'', 'stop':f'${child_order_stop_price}', 'fill':'', 'entry':''}
                        else:
                            child_order_price_info = {'limit':'', 'stop':'', 'fill':'', 'entry':''}
                    #get the fill price
                    child_order_activity_list = child_order.get('orderActivityCollection')
                    if child_order_activity_list is not None:
                        for child_order_activity in child_order_activity_list:
                            child_order_exe_legs = child_order_activity.get('executionLegs')
                            if child_order_exe_legs is not None and child_order_status == 'FILLED':
                                child_fill_price = ''
                                child_order_exe_leg_num = 0
                                for child_order_exe_leg in child_order_exe_legs:
                                    if child_order_exe_leg_num < len(child_order_exe_leg):
                                        child_order_exe_action = child_order_leg_info[child_order_exe_leg_num]['action']

                                        if child_order_exe_action == 'BUY_TO_OPEN' or child_order_exe_action == 'SELL_TO_CLOSE':
                                            child_fill_price = child_fill_price + f'+${child_order_exe_leg.get('price')} '
                                        else:
                                            child_fill_price = child_fill_price + f'-${child_order_exe_leg.get('price')} '
                                    child_order_exe_leg_num+=1
                                child_order_price_info.update({'fill':child_fill_price})
                    #get the tag
                    child_order_tag = child_order_price_info['tag']

                child_summary_order = {'type':child_order_type, 'price':child_order_price_info, 'leg_n':child_order_leg_n, 'leg_info':child_order_leg_info, 'time':child_order_time, 'status':child_order_status, 'status_desp':child_order_status_desp, 'tag':child_order_tag}
                child_summary_orders.append(child_summary_order)


            #merge all info
            summary_order = {'type':order_type, 'price':order_price_info, 'leg_n':order_leg_n, 'leg_info':order_leg_info, 'time':order_time, 'status':order_status, 'status_desp':order_status_desp, 'child_orders':child_summary_orders, 'tag':order_tag}
            summary_orders.append(summary_order)

        return summary_orders
    else:
        error = json.loads(response.text)
        print(f"Error in getting the order results of - {username}: {error}")
        return summary_orders


def get_all_order_results(user_names, from_entered_time, to_entered_time):
    order_results = {}
    for username in user_names:
        user_order_result = get_order_result_by_username(username, from_entered_time, to_entered_time)
        order_results.update({username:user_order_result})
    return order_results



