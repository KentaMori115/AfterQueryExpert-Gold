from django.shortcuts import render, redirect
from django.http import HttpResponse, JsonResponse
from django.template import loader
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.contrib.auth import update_session_auth_hash

from django.http import FileResponse
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

from Engine.server_api import get_timezones, get_validsymbols, get_token_req_headers, get_account_details
from Engine.config import AUTH_ENDPOINT,CLIENT_ID, CLIENT_SECRET, REDIRECT_URI,TOKEN_ENDPOINT, REF_TOKEN_EXPIRE_DAY
from Engine.offline import is_offline, offline_oauth_tokens
from Users import pwdhistory

import os
import json
import requests
from datetime import datetime, timedelta
import pytz

from .models import Bot, BotOnOff, BotSetting, BotRefresh, BotAccess



@login_required
def bots(request):
    template = loader.get_template('bots/bots.html')
    #get the user id
    user_id = request.user.id


    bot_objs = Bot.objects.all()
    bot_list = list(bot_objs)
    for bot in bot_list:
        bot_id = bot.id
        #get the current bot running status
        try:
            bot_set_obj = BotOnOff.objects.get(user_id = user_id, bot_id = bot_id)
        except:
            bot_set_obj = None
        print(bot_set_obj)
        if bot_set_obj is not None and bot_set_obj.status:
            print(bot_set_obj.status)
            bot.status = "Running..."
        else:
            bot.status = "Stopped"

    #Get the auth info
    expire_sec = -1
    account_number = None
    try:
        auth_obj = BotRefresh.objects.get(user_id=user_id)
        token_expire_at = auth_obj.created_at + timedelta(days=REF_TOKEN_EXPIRE_DAY)
        now = timezone.now()
        token_expire_diff = token_expire_at - now
        expire_sec = token_expire_diff.total_seconds()
        if expire_sec > 0:
            account_details = get_account_details(user_id)
            if account_details is not None and len(account_details) > 0:
                account_number = account_details[0]['accountNumber']
            else:
                expire_sec = -1

    except:
        print('auth expired or not performed')
        expire_sec = -1

    expire_est_formated = None    
    if expire_sec >0:
        TZ = pytz.timezone('US/Eastern')
        cur_date = datetime.now(TZ)
        expire_est = cur_date + timedelta(seconds = expire_sec)
        expire_est_formated = expire_est.strftime("%b %d, %Y %H:%M")
        print(expire_est_formated)


    context = {'bots':bot_list, 'expire_sec':expire_sec, 'expire_est_formated':expire_est_formated, 'account_number':account_number}
    return HttpResponse(template.render(context, request))

@login_required
def home(request):
    return redirect('bots')

@login_required
def bot_detail(request, id:int):
    user_id = request.user.id

    try:
        bot_obj = Bot.objects.get(id = id)
    except:
        template = loader.get_template(f'bots/bot_not_found.html')
        return HttpResponse(template.render({}, request))



    template = loader.get_template(f'bots/{bot_obj.templatename}')
    valid_symbols = get_validsymbols()
    sel_symbol = valid_symbols[0]
    contract_type = 'Fixed'
    fixed_lots = "1"
    risk_percentage = "1"
    strategy_type = ""
    #strategy_type = "Terrance Trade"

    #get the bot running status
    try:
        bot_onoff_obj = BotOnOff.objects.get(bot_id = id, user_id = user_id)
    except:
        bot_onoff_obj = None
    if bot_onoff_obj is not None and bot_onoff_obj.status:
        bot_status = "Running..."
    else:
        bot_status = "Stopped"
    
    #get the bot setting
    try:
        bot_set_obj = BotSetting.objects.get(bot_id = id, user_id = user_id)
    except:
        bot_set_obj = None

    if bot_set_obj is None:
        sel_symbol = valid_symbols[0]
    else:
        try:
            bot_set_json = json.loads(bot_set_obj.setting)
            sel_symbol = bot_set_json['sel_symbol']
            contract_type = bot_set_json['contract_type']
            fixed_lots = bot_set_json['fixed_lots']
            risk_percentage = bot_set_json['risk_percentage']
            strategy_type = bot_set_json['strategy_type']
        except:
            pass



    #Get the auth info
    expire_sec = -1
    account_number = None
    try:
        auth_obj = BotRefresh.objects.get(user_id=user_id)
        token_expire_at = auth_obj.created_at + timedelta(days=REF_TOKEN_EXPIRE_DAY)
        now = timezone.now()
        token_expire_diff = token_expire_at - now
        expire_sec = token_expire_diff.total_seconds()
        if expire_sec > 0:
            account_details = get_account_details(user_id)
            if account_details is not None and len(account_details) > 0:
                account_number = account_details[0]['accountNumber']
            else:
                expire_sec = -1

    except:
        print('auth expired or not performed')
        expire_sec = -1

    expire_est_formated = None    
    if expire_sec >0:
        TZ = pytz.timezone('US/Eastern')
        cur_date = datetime.now(TZ)
        expire_est = cur_date + timedelta(seconds = expire_sec)
        expire_est_formated = expire_est.strftime("%b %d, %Y %H:%M")
        print(expire_est_formated)


    context = {
        'valid_symbols': valid_symbols,
        'sel_symbol': sel_symbol,
        'contract_type':contract_type,
        'fixed_lots':fixed_lots,
        'risk_percentage':risk_percentage,
        'strategy_type':strategy_type,
        'bot':bot_obj,
        'bot_status':bot_status,

        'expire_sec':expire_sec, 
        'expire_est_formated':expire_est_formated, 
        'account_number':account_number        
    }
    return HttpResponse(template.render(context, request))


@login_required
@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)
def bot_onoff(request):
    if request.method == 'POST':
        params = json.loads(request.body)
        #check the whether the bot exists or not
        bot_id = params['bot_id']
        try:
            bot_obj = Bot.objects.get(id = bot_id)
        except:
            resp = {'status':'fail', 'error':"The bot does not exist"}
            return JsonResponse(resp)



        user_run_setting = params['run_setting']
        user_name = request.user.username
        user_id = request.user.id

        #update the bot setting
        setting_ob, created = BotSetting.objects.update_or_create(
            bot_id = bot_id,
            user_id = user_id,
            defaults = {'setting':json.dumps(user_run_setting), 'created_at':timezone.now()}
        )

        #update the bot on/off state
        onoff_obj, created = BotOnOff.objects.update_or_create(
            bot_id = bot_id,
            user_id = user_id,
            defaults = {'status':True, 'created_at':timezone.now()}
        )
        resp = {'status':'success', 'error':"no_error"}
        return JsonResponse(resp)

    elif request.method == 'DELETE':
        params = json.loads(request.body)
        #check the whether the bot exists or not
        bot_id = params['bot_id']
        try:
            bot_obj = Bot.objects.get(id = bot_id)
        except:
            resp = {'status':'fail', 'error':"The bot does not exist"}
            return JsonResponse(resp)


        user_name = request.user.username
        user_id = request.user.id
        #update the bot on/off state
        onoff_obj, created = BotOnOff.objects.update_or_create(
            bot_id = bot_id,
            user_id = user_id,
            defaults = {'status':False, "created_at":timezone.now()}
        )

        resp = {'status':'success', 'error':"no_error"}
        return JsonResponse(resp)

    return JsonResponse({'error':"invalid request"}, status = 400)
    


@login_required
def schwab_authenticate(request):
    print('here')
    if request.method == 'GET':
        if is_offline():
            tokens = offline_oauth_tokens()
            BotRefresh.objects.update_or_create(
                user_id=request.user.id,
                defaults={"refresh_token": tokens["refresh_token"], "created_at": timezone.now()},
            )
            BotAccess.objects.update_or_create(
                user_id=request.user.id,
                defaults={"access_token": tokens["access_token"], "created_at": timezone.now()},
            )
            return redirect('bots')
        auth_url = f"{AUTH_ENDPOINT}?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&response_type=code"
        print(auth_url)
        return redirect(auth_url)

@login_required
def schwab_callback(request):
    print('starting schwab_callback')
    # Handle callback from Schwab
    authorization_code = request.GET.get('code')
    if not authorization_code:
        return JsonResponse({'error': 'Authorization code not found'}, status=400)

    # Exchange authorization code for access token
    headers = get_token_req_headers(CLIENT_ID, CLIENT_SECRET)
    data = {
        'grant_type': 'authorization_code',
        'code': authorization_code,
        'redirect_uri': REDIRECT_URI,
    }

    if is_offline():
        data = offline_oauth_tokens()
        refresh_token = data.get('refresh_token')
        access_token = data.get('access_token')
        userid = request.user.id
        BotRefresh.objects.update_or_create(
            user_id=userid,
            defaults={"refresh_token": refresh_token, "created_at": timezone.now()},
        )
        BotAccess.objects.filter(user_id=userid).delete()
        return redirect('bots')

    response = requests.post(TOKEN_ENDPOINT, data=data, headers=headers)
    if response.status_code != 200:
        try:
            error = json.loads(response.text)
            print(error)
        except:
            pass
        return JsonResponse({'error': 'Failed to get access token'}, status=400)

    # Save the access token (e.g., in the database or session)
    data = json.loads(response.text)
    refresh_token = data.get('refresh_token')
    access_token = data.get('access_token')
    if refresh_token is None or access_token is None:
        return JsonResponse({'error': 'Invalid request token or access token', 'refresh_token':refresh_token, 'access_token':access_token}, status=400)


    print(f'refresh_token: {refresh_token}')
    print(f'access_token: {access_token}')

    userid = request.user.id
    refresh_obj, created = BotRefresh.objects.update_or_create(
        user_id = userid,
        defaults = {"refresh_token":refresh_token, "created_at":timezone.now()}
    )

    #delete the old access token
    try:
        access_token_obj = BotAccess.objects.get(user_id = userid)
        access_token_obj.delete()
        print('Old access token is deleted')
    except:
        print('Access token does not exist')

    return redirect('bots')

    

@login_required
def setting_page(request):
    template = loader.get_template('bots/setting.html')

    context = {}
    return HttpResponse(template.render(context, request))




def check_password_strength(password):
    try:
        validate_password(password)
        return True, "Password is strong"
    except ValidationError as e:
        return False, e.messages


def check_password_is_new(user, password):
    """Whether this account may move to this password.

    The settings page and the forgot-password page share one rule: a password
    the account has had in its last few is refused, however strong it is.
    """
    if pwdhistory.is_reused(user, password):
        return False, [pwdhistory.REUSED_MESSAGE]
    return True, "Password has not been used before"

@login_required
@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)
def change_password(request):
    error_message = None
    if request.method == 'POST':
        user = request.user
        params = json.loads(request.body)
        #check the whether the bot exists or not
        new_password = params['new_password']
        confirm_password = params['confirm_password']

        if new_password == confirm_password:
            isStrong, state_messages = check_password_strength(new_password)
            isNew, reuse_messages = check_password_is_new(user, new_password)
            if isStrong and isNew:
                # What the account is moving off, kept so it cannot move back.
                replaced = user.password
                user.set_password(new_password)
                user.save()
                pwdhistory.remember(user.id, replaced)

                update_session_auth_hash(request, user)
                resp = {'status':'success', 'error':"no_error"}
                return JsonResponse(resp)
            else:
                error_message = ''
                if not isStrong:
                    for state_message in state_messages:
                        error_message += f"{state_message}\n"
                if not isNew:
                    for reuse_message in reuse_messages:
                        error_message += f"{reuse_message}\n"
        else:
            error_message = 'Confirm password is different from the new password'


    else:
        error_message = 'invalid request'

    return JsonResponse({'error':error_message}, status = 400)

