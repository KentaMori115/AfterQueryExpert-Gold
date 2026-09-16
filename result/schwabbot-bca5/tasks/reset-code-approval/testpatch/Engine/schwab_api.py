from .config import *
from .offline import (
    is_offline,
    offline_access_token,
    offline_account_balance,
    offline_history_candles,
    offline_option_chain,
    offline_quote,
)
import requests
from datetime import datetime
import json
import base64
import requests

def schwab_api_get_history_candle(headers, symbol, period_type, period, freq_type, freq, end_date, need_extend_hour = True, need_previous_close = True):
    if is_offline():
        return offline_history_candles(symbol, freq_type)
    curr_dt = datetime.now()
    cur_timestamp = int(round(curr_dt.timestamp()*1000))
    params = {
        'symbol':symbol,
        'periodType':period_type,
        'period':period,
        'frequencyType':freq_type,
        'frequency':freq,
        'endDate': end_date,
        'needExtendedHoursData': need_extend_hour,
        'needPreviousClose':need_previous_close
    }
    history_endpoint = f'{SCHWAB_MARKET_URL}/pricehistory'

    response = requests.get(history_endpoint, params = params, headers= headers)
    if not response.ok:
        print("Error in getting the historical candle as following error")
        if response.text:
            print(response.text)
        else:
            print('Something went wrong')
    
    response_json = response.json()
    history_candles = response_json['candles']
    return history_candles


def schwab_api_quote(headers, symbol):
    if is_offline():
        return offline_quote(symbol)
    params = {
        'symbols':f'{symbol}',
        'fields':'quote,reference'
    }
    quote_endpoint = f'{SCHWAB_MARKET_URL}/quotes'

    response = requests.get(quote_endpoint, params = params, headers= headers)
    if not response.ok:
        print(f"Error in getting the quote for {symbol} as following error")
        if response.text:
            print (response.text)
        else:
            print("Something went wrong")
        return None

    response_json = response.json()
    quote = response_json[symbol]['quote']
    return quote

def schwab_api_get_option_chain(headers, symbol, contract_type, strike_range = None, from_date = None, to_date = None, days_to_expiration = None):
    if is_offline():
        return offline_option_chain(symbol, contract_type)
    print('insde get_option_chain')

    params = {
        'symbol':symbol,
        'contractType':contract_type,
    }

    print(params)
    if strike_range is not None:
        params.update ( {'range':strike_range})
    if from_date is not None:
        params.update({'fromDate':from_date})
    if to_date is not None:
        params.update({'toDate':to_date})

    print(params)
    print(headers)


    chain_endpoint = f'{SCHWAB_MARKET_URL}/chains'

    response = requests.get(chain_endpoint, params = params, headers= headers)

    if not response.ok:
        print("Error in getting option chain as following error")
        if response.text:
            print(response.text)
        print("Something went wrong")
        return None

    chain = response.json()
    return chain




def schwab_api_get_account_balance(headers):
    if is_offline():
        return offline_account_balance()
    params = {
        'fields': 'positions',
    }
    account_endpoint = f'{SCHWAB_TRADER_URL}/accounts'

    response = requests.get(account_endpoint, params=params, headers=headers)
    print(f'response in getting account balance: {response.ok}')
    
    if not response.ok:
        print('Error in getting the account balance as following reason')
        if response.text:
            print(response.text)
        else:
            print('Something went wrong')
        return 0
    #response_json = json.loads(response.text)
    response_json = response.json()
    account_balance = response_json[0]["securitiesAccount"]["currentBalances"]["equity"]
    return account_balance




def get_access_headers(token_type, access_token):
    authorization =  f'{token_type} {access_token}'
    headers = {
        'Authorization': authorization
    }
    return headers



def get_order_access_headers(token_type, access_token):
    authorization =  f'{token_type} {access_token}'
    headers = {
        'Authorization': authorization,
        'Content-Type': "application/json",
    }
    return headers


def get_token_req_headers(app_key, app_secret):
    auth = f"{app_key}:{app_secret}"
    auth_bytes = auth.encode()
    auth_base64_bytes = base64.b64encode(auth_bytes)
    auth_base64_string = auth_base64_bytes.decode()
    headers = {
        'Authorization': f"Basic {auth_base64_string}",
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    return headers



def generate_access_token(headers, refresh_token):
    if is_offline():
        return offline_access_token(refresh_token)
    if refresh_token != None:
        # Exchange the authorization code for an access token
        data = {
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
        }

        response = requests.post(TOKEN_ENDPOINT, headers = headers, data = data)
        if response.ok:
            data = json.loads(response.text)
            try:
                access_token = data['access_token']
                return access_token
            except:
                print(data)
                return None

        else:
            error = json.loads(response.text)
            print(error)
            return None
    else:
        return None
