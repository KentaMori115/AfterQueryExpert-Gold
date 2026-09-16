from Engine.config import *
from Engine.schwab_api import *
from Engine.offline import (
    cancel_paper_order,
    is_offline,
    offline_account_details,
    offline_quote_map,
    paper_order_status,
    record_paper_order,
)

import requests
import json
from datetime import datetime
import math


def read_option_symbol(p_opt_symbol):
    print(p_opt_symbol)
    root_symbol = p_opt_symbol[:6]
    expire_date = p_opt_symbol[6:12]
    call_or_put = p_opt_symbol[12:13]
    strike_price = float(p_opt_symbol[13:])/1000.0
    return root_symbol, expire_date, call_or_put, strike_price


def get_ticksize(p_symbol):
    if p_symbol == '$SPX':
        return 0.05
    elif p_symbol == '$XSP':
        return 0.01

    return 0.01

def get_valid_price(p_price, p_symbol):
    tick_size = get_ticksize(p_symbol)
    valid_price = math.floor(p_price/tick_size)*tick_size
    valid_price = round(valid_price, 2)
    return valid_price


def get_one_valid_access_token(headers, refresh_token_info):
    users = refresh_token_info.keys()
    for user in users:
        access_token = generate_access_token(headers, refresh_token)
        if access_token is None:
            return access_token
    return None


def get_account_details(token_type, access_token):
    if is_offline():
        if token_type is None or access_token is None:
            return None
        return offline_account_details()
    acc_detail_endpoint = f'{SCHWAB_TRADER_URL}/accounts/accountNumbers'

    if token_type is None or access_token is None:
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




def get_new_limit_price(token_type, access_token, payload, strategy_type):
    limit_price = 0.0
    #update the price
    print(strategy_type)

    if strategy_type == 'Terrance Trade':
        quote_call_symbol = payload['orderLegCollection'][0]['instrument']['symbol']
        quote_put_symbol = payload['orderLegCollection'][1]['instrument']['symbol']

        token_type= 'Bearer'

        quote_data = get_pair_quote(token_type, access_token, quote_call_symbol, quote_put_symbol)
        if quote_data is None:
            return None

        call_quote_data = quote_data[quote_call_symbol]['quote']
        put_quote_data = quote_data[quote_put_symbol]['quote']
        call_bid = call_quote_data['bidPrice']
        call_ask = call_quote_data['askPrice']
        put_bid = put_quote_data['bidPrice']
        put_ask = put_quote_data['askPrice']
        limit_price = (call_bid + call_ask)/2.0 + (put_bid + put_ask)/2.0
        #limit_price = limit_price/2


    elif strategy_type == 'Iron Fly':
        quote_atm_call_symbol = payload['orderLegCollection'][0]['instrument']['symbol']
        quote_atm_put_symbol = payload['orderLegCollection'][1]['instrument']['symbol']
        quote_otm_call_symbol = payload['orderLegCollection'][2]['instrument']['symbol']
        quote_otm_put_symbol = payload['orderLegCollection'][3]['instrument']['symbol']

        token_type= 'Bearer'
        symbol_list_str = f'{quote_atm_call_symbol},{quote_atm_put_symbol},{quote_otm_call_symbol},{quote_otm_put_symbol}'
        quote_data = get_list_quote(token_type, access_token, symbol_list_str)

        if quote_data is None:
            return None

        quote_atm_call_data = quote_data[quote_atm_call_symbol]['quote']
        quote_atm_put_data = quote_data[quote_atm_put_symbol]['quote']
        buy_call_price = (quote_atm_call_data['bidPrice'] + quote_atm_call_data['askPrice'])/2.0
        buy_put_price = (quote_atm_put_data['bidPrice'] + quote_atm_put_data['askPrice'])/2.0

        quote_otm_call_data = quote_data[quote_otm_call_symbol]['quote']
        quote_otm_put_data = quote_data[quote_otm_put_symbol]['quote']
        sell_call_price = (quote_otm_call_data['bidPrice'] + quote_otm_call_data['askPrice'])/2.0
        sell_put_price = (quote_otm_put_data['bidPrice'] + quote_otm_put_data['askPrice'])/2.0

        '''
        print(datetime.now())
        print(quote_atm_call_data['bidPrice'] , quote_atm_call_data['askPrice'])
        print(quote_atm_put_data['bidPrice'] , quote_atm_put_data['askPrice'])
        print(quote_otm_call_data['bidPrice'] , quote_otm_call_data['askPrice'])
        print(quote_otm_put_data['bidPrice'] , quote_otm_put_data['askPrice'])
        print(buy_call_price, buy_put_price, sell_call_price, sell_put_price)
        '''
        limit_price = ((buy_call_price + buy_put_price) - (sell_call_price + sell_put_price))
        #limit_price = limit_price/2


    elif strategy_type == 'Terrance Trade/Iron Fly Combo':
        quote_atm_call_symbol = payload['orderLegCollection'][0]['instrument']['symbol']
        quote_atm_put_symbol = payload['orderLegCollection'][1]['instrument']['symbol']
        quote_otm_call_symbol = payload['orderLegCollection'][2]['instrument']['symbol']

        token_type= 'Bearer'
        symbol_list_str = f'{quote_atm_call_symbol},{quote_atm_put_symbol},{quote_otm_call_symbol}'
        quote_data = get_list_quote(token_type, access_token, symbol_list_str)

        if quote_data is None:
            return None

        quote_atm_call_data = quote_data[quote_atm_call_symbol]['quote']
        quote_atm_put_data = quote_data[quote_atm_put_symbol]['quote']
        buy_call_price = (quote_atm_call_data['bidPrice'] + quote_atm_call_data['askPrice'])/2.0
        buy_put_price = (quote_atm_put_data['bidPrice'] + quote_atm_put_data['askPrice'])/2.0

        quote_otm_call_data = quote_data[quote_otm_call_symbol]['quote']
        sell_call_price = (quote_otm_call_data['bidPrice'] + quote_otm_call_data['askPrice'])/2.0

        limit_price = (buy_call_price + buy_put_price - sell_call_price)
        #limit_price = limit_price/2

    
    elif strategy_type == 'Straddle':
        quote_atm_call_symbol = payload['childOrderStrategies'][0]['orderLegCollection'][0]['instrument']['symbol']
        quote_atm_put_symbol = payload['childOrderStrategies'][0]['orderLegCollection'][1]['instrument']['symbol']

        token_type= 'Bearer'
        symbol_list_str = f'{quote_atm_call_symbol},{quote_atm_put_symbol}'
        quote_data = get_list_quote(token_type, access_token, symbol_list_str)

        if quote_data is None:
            return None

        quote_atm_call_data = quote_data[quote_atm_call_symbol]['quote']
        quote_atm_put_data = quote_data[quote_atm_put_symbol]['quote']
        sell_call_price = (quote_atm_call_data['bidPrice'] + quote_atm_call_data['askPrice'])/2.0
        sell_put_price = (quote_atm_put_data['bidPrice'] + quote_atm_put_data['askPrice'])/2.0

        limit_price = sell_call_price + sell_put_price
        #limit_price = limit_price*2

    elif strategy_type == 'Defined Risk Straddle':
        quote_atm_call_symbol = payload['childOrderStrategies'][0]['orderLegCollection'][0]['instrument']['symbol']
        quote_atm_put_symbol = payload['childOrderStrategies'][0]['orderLegCollection'][1]['instrument']['symbol']
        quote_otm_call_symbol = payload['childOrderStrategies'][0]['orderLegCollection'][2]['instrument']['symbol']
        quote_otm_put_symbol = payload['childOrderStrategies'][0]['orderLegCollection'][3]['instrument']['symbol']

        token_type= 'Bearer'
        symbol_list_str = f'{quote_atm_call_symbol},{quote_atm_put_symbol},{quote_otm_call_symbol},{quote_otm_put_symbol}'
        quote_data = get_list_quote(token_type, access_token, symbol_list_str)

        if quote_data is None:
            return None

        quote_atm_call_data = quote_data[quote_atm_call_symbol]['quote']
        quote_atm_put_data = quote_data[quote_atm_put_symbol]['quote']
        quote_otm_call_data = quote_data[quote_otm_call_symbol]['quote']
        quote_otm_put_data = quote_data[quote_otm_put_symbol]['quote']

        sell_call_price = (quote_atm_call_data['bidPrice'] + quote_atm_call_data['askPrice'])/2.0
        sell_put_price = (quote_atm_put_data['bidPrice'] + quote_atm_put_data['askPrice'])/2.0
        buy_call_price = (quote_otm_call_data['bidPrice'] + quote_otm_call_data['askPrice'])/2.0
        buy_put_price = (quote_otm_put_data['bidPrice'] + quote_otm_put_data['askPrice'])/2.0


        limit_price = sell_call_price + sell_put_price - buy_call_price - buy_put_price
        #limit_price = limit_price*2


    
    return limit_price



def send_order(token_type, access_token, account_id, payload, trading_symbol,strategy_type, order_result_dict, username):
    if is_offline():
        order_id = record_paper_order(payload, username)
        order_result_dict.update({username:[order_id, None, None]})
        return
    order_headers = get_order_access_headers(token_type, access_token)
    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders'

    #check for simulation
    if trading_symbol == '$XSPSIM':
        leg_n = len(payload['orderLegCollection'])
        for i in range(leg_n):
            option_symbol = payload['orderLegCollection'][i]['instrument']['symbol']
            sim_option_symbol = option_symbol.replace('XSP', 'XSPSIM')
            payload['orderLegCollection'][i]['instrument']['symbol'] = sim_option_symbol

        if 'childOrderStrategies' in payload.keys():
            profit_payloads = payload['childOrderStrategies']
            for profit_payload in profit_payloads:
                profit_leg_n = len(profit_payload['orderLegCollection'])
                for i in range(profit_leg_n):
                    option_symbol = profit_payload['orderLegCollection'][i]['instrument']['symbol']
                    sim_option_symbol = option_symbol.replace('XSP', 'XSPSIM')
                    profit_payload['orderLegCollection'][i]['instrument']['symbol'] = sim_option_symbol

    #payload['clientOrderId'] = 'SchwabOptionBot-Steven' #this should be unique
    #payload['orderAnnotation'] = 'SchwabOptionBot-Steven'

    print(payload)

    order_id = None


    order_result_dict.update({username:[order_id, None, None]})
    return


    response = requests.post(order_endpoint, data=json.dumps(payload), headers=order_headers)


    if response.ok:
        #get the order id
        try:
            location_header = response.headers.get('Location')
            if location_header is not None:
                #Split the 'Location' header to get the order ID
                order_id = location_header.split('/')[-1]
            else:
                print('Location header is missing in the response.')
        except:
            print('Error in finding the order id')
    else:
        error = json.loads(response.text)
        print("Error placing order:", error)

    order_result_dict.update({username:[order_id, None, None]})


def cancel_order(token_type, access_token, account_id, order_id, username):
    headers = get_access_headers(token_type, access_token)
    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders/{order_id}'

    if order_id is None:
        return True

    if is_offline():
        return cancel_paper_order(order_id)

    response = requests.delete(order_endpoint, headers=headers)
    if response.ok:
        print(f'Cancelled the order {order_id} on the account {username}')
        return True
    else:
        print('Error in cancelling the order as following reason')
        if response.text:
            print(response.text)
        else:
            print('Something went wrong')

    return False



def modify_order(token_type, access_token, account_id, order_id, payload, trading_symbol,strategy_type, order_result_dict, username):
    order_headers = get_order_access_headers(token_type, access_token)
    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders/{order_id}'

    if cancel_order(token_type, access_token, account_id, order_id, username):
        send_order(token_type, access_token, account_id, payload, trading_symbol, strategy_type, order_result_dict, username)

    '''
    print(payload)
    order_id = None

    order_result_dict.update({username:[order_id, None, None]})
    return


    response = requests.put(order_endpoint, data=json.dumps(payload), headers=order_headers)
    if response.ok:
        print("Order modified successfully.")


        #get the order id
        try:
            location_header = response.headers.get('Location')
            if location_header is not None:
                #Split the 'Location' header to get the order ID
                order_id = location_header.split('/')[-1]
            else:
                print('Location header is missing in the response.')
        except:
            print('Error in finding the order id')
    else:
        error = json.loads(response.text)
        print("Error in modifying order:", error)
    
    order_result_dict.update({username:[order_id, None, None]})
    '''




def get_pair_quote(token_type, access_token, quote_call_symbol, quote_put_symbol):
    if is_offline():
        return offline_quote_map([quote_call_symbol, quote_put_symbol])
    params = {
        'symbols':f'{quote_call_symbol},{quote_put_symbol}',
        'fields':'quote,reference'
    }
    quote_endpoint = f'{SCHWAB_MARKET_URL}/quotes'

    headers = get_access_headers(token_type, access_token)
    response = requests.get(quote_endpoint, params = params, headers= headers)

    if response.ok:
        data = json.loads(response.text)
        #print(quote_call_symbol, quote_put_symbol)
        #print(data)
        return data
    else:
        print("Error fetching quote:", response)
        print(params)
        return None

def get_list_quote(token_type, access_token, symbol_list_str):
    if is_offline():
        return offline_quote_map(symbol_list_str)

    params = {
        'symbols':symbol_list_str,
        'fields':'quote,reference'
    }
    quote_endpoint = f'{SCHWAB_MARKET_URL}/quotes'

    headers = get_access_headers(token_type, access_token)
    response = requests.get(quote_endpoint, params = params, headers= headers)

    if response.ok:
        data = json.loads(response.text)
        #print(quote_call_symbol, quote_put_symbol)
        #print(data)
        return data
    else:
        try:
            error = json.loads(response.text)
            print("Error fetching quote:", error)
        except:
            print('Exception in getting the error')

        return None



def get_order_status(token_type, access_token, account_id, order_id):
    if is_offline():
        return paper_order_status(order_id)
    order_endpoint = f'{SCHWAB_TRADER_URL}/accounts/{account_id}/orders/{order_id}'
    headers = get_access_headers(token_type, access_token)

    response = requests.get(order_endpoint, headers= headers)
    if response.ok:
        order_details = json.loads(response.text)
        #print(order_details)

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
        return None, None