from django.shortcuts import render
from django.template import loader
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from django.contrib.auth.decorators import login_required, user_passes_test
from Engine.server_api import get_all_order_results

from django.contrib.auth.models import User

from django.utils import timezone
from datetime import timedelta
import json

from BotList.models import Bot, BotOnOff, BotSetting, BotAdminSetting
from Users.models import UserAllow, UserPwdRequest

# Create your views here.
@login_required
@user_passes_test(lambda u: u.is_superuser)
def admin_home(request):
    template = loader.get_template('pages/admin_home.html')
    context = {
        'page_name':'admin_home'
    }
    return HttpResponse(template.render(context, request))



@login_required
@user_passes_test(lambda u: u.is_superuser)
def order_table_page(request):
    user_all_objs = User.objects.all()
    user_info_dict = {}
    for user_obj in user_all_objs:
        user_info_dict[f"{user_obj.id}"] = user_obj.username


    user_allow_objs = UserAllow.objects.all()
    user_names = []
    for user_allow_obj in user_allow_objs:
        if user_allow_obj.status:
            user_names.append(user_info_dict[f"{user_allow_obj.user_id}"])

    time_now = timezone.now()
    to_entered_time_t = time_now + timedelta(days = 1)
    from_entered_time_t = time_now - timedelta(days = 5)
    to_entered_time = to_entered_time_t.isoformat()
    from_entered_time = from_entered_time_t.isoformat()
    #print(to_entered_time)
    #print(from_entered_time)
    #print(user_names)


    from_entered_time = '2025-03-30T00:00:00.000Z'
    to_entered_time = '2025-04-02T00:00:00.000Z'

    order_results = get_all_order_results(user_names, from_entered_time, to_entered_time)

    records = []
    for user_name in user_names:
        user_order_results = order_results[user_name]
        if len(user_order_results) == 0:
            continue

        for user_order_result in user_order_results:
            #print(user_order_result)

            leg_n = user_order_result['leg_n']
            if leg_n > 0:
                leg0 = user_order_result['leg_info'][0]
                price0 = user_order_result['price']
                record = {'user':user_name, 'leg':leg0['id'], 'asset':leg0['asset'], 'symbol':leg0['symbol'], 'action':leg0['action'], 'quantity':leg0['qty'], 
                        'type':user_order_result['type'], 'limit':price0['limit'], 'stop':price0['stop'], 'status':user_order_result['status'], 'status_desp':user_order_result['status_desp'],
                        'fill':price0['fill'], 'entry':price0['entry'], 'timestamp':user_order_result['time'], 'tag':user_order_result['tag']}
                records.append(record)

            for i in range(1, leg_n):
                legi = user_order_result['leg_info'][i]
                record = {'user':'', 'leg':legi['id'], 'asset':legi['asset'],'symbol':legi['symbol'],'action':legi['action'], 'quantity':legi['qty'], 
                            'type':'', 'limit':'', 'stop':'', 'status':'', 'status_desp':'', 'fill':'', 'entry':'', 'timestamp':'', 'tag':''}
                records.append(record)
            
            child_order_results = user_order_result['child_orders']
            child_no = 0
            for child_order_result in child_order_results:
                child_no += 1
                child_leg = f"PT{child_no}-"
                leg_n = child_order_result['leg_n']
                if leg_n > 0:
                    leg0 = child_order_result['leg_info'][0]
                    price0 = child_order_result['price']
                    record = {'user':'', 'leg':f"{child_leg}{leg0['id']}", 'asset':leg0['asset'], 'symbol':leg0['symbol'], 'action':leg0['action'], 'quantity':leg0['qty'], 
                            'type':child_order_result['type'], 'limit':price0['limit'], 'stop':price0['stop'], 'status':child_order_result['status'], 'status_desp':child_order_result['status_desp'],
                            'fill':price0['fill'], 'entry':price0['entry'], 'timestamp':child_order_result['time'], 'tag':''}
                    records.append(record)

                for i in range(1, leg_n):
                    legi = child_order_result['leg_info'][i]
                    record = {'user':'', 'leg':f"{child_leg}{legi['id']}", 'asset':legi['asset'],'symbol':legi['symbol'],'action':legi['action'], 'quantity':legi['qty'], 
                                'type':'', 'limit':'', 'stop':'', 'status':'', 'status_desp':'', 'fill':'', 'entry':'', 'timestamp':'','tag':''}
                    records.append(record)

            
        record = {'user':'', 'leg':'', 'asset':'', 'symbol':'', 'action':'', 'quantity':'', 
                    'type':'', 'limit':'', 'stop':'', 'status':'', 'status_desp':'', 'fill':'', 'entry':'', 'timestamp':'', 'tag':''}
        records.append(record)



    template = loader.get_template('pages/order_table.html')

    context = {
        'records': records,
        'page_name':'order_table'
    }
    return HttpResponse(template.render(context, request))






@login_required
@user_passes_test(lambda u: u.is_superuser)
def user_bot_onoff_page(request):
    user_all_objs = User.objects.all()
    user_info_dict = {}
    for user_obj in user_all_objs:
        user_info_dict[f"{user_obj.id}"] = user_obj.username

    bot_objs = Bot.objects.all()
    bot_info_dict = {}
    for bot_obj in bot_objs:
        bot_info_dict[f"{bot_obj.id}"] = bot_obj.botname
    

    bot_setting_objs = BotSetting.objects.all()
    bot_setting_info = {}
    for bot_setting_obj in bot_setting_objs:
        user_id = bot_setting_obj.user_id
        user_id_key = f"{user_id}"
        if user_id_key in user_info_dict.keys():
            bot_setting_info[f"{bot_setting_obj.bot_id}-{bot_setting_obj.user_id}"] = bot_setting_obj.id
        else:
            BotSetting.objects.filter(user_id = user_id).delete()



    bot_onoff_records = []
    bot_onoff_objs = BotOnOff.objects.all()
    for bot_onoff_obj in bot_onoff_objs:
        bot_setting_key = f"{bot_onoff_obj.bot_id}-{bot_onoff_obj.user_id}"
        user_id_key = f"{bot_onoff_obj.user_id}"
        if bot_setting_key in bot_setting_info.keys() and user_id_key in user_info_dict.keys():
            bot_onoff_record = {'id':bot_onoff_obj.id, 'user_id':bot_onoff_obj.user_id, 'user_name':user_info_dict[user_id_key], 'bot_id':bot_onoff_obj.bot_id, 'bot_name':bot_info_dict[f"{bot_onoff_obj.bot_id}"], 'status':bot_onoff_obj.status}
            bot_onoff_records.append(bot_onoff_record)

    print(bot_onoff_records)



    template = loader.get_template('pages/user_bot_onoff.html')

    context = {
        'bot_onoff_records': bot_onoff_records,
        'page_name':'user_bot_onoff'
    }
    return HttpResponse(template.render(context, request))





@login_required
@user_passes_test(lambda u: u.is_superuser)
@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)
def bot_onoff_change(request):
    if request.method == 'POST':
        params = json.loads(request.body)
        #check the whether the bot exists or not
        id = params['id']
        status = params['status']

        onoff_obj, created = BotOnOff.objects.update_or_create(
            id = id,
            defaults = {'status':status, 'created_at':timezone.now()}
        )
        resp = {'status':'success', 'error':"no_error"}
        return JsonResponse(resp)

    return JsonResponse({'error':"invalid request"}, status = 400)



@login_required
@user_passes_test(lambda u: u.is_superuser)
def user_allow_page(request):
    user_all_objs = User.objects.all()
    user_allow_info_dict = {}
    for user_obj in user_all_objs:
        user_allow_info_dict[f"{user_obj.id}"] = {'name':user_obj.username, 'status':False, 'description':''}


    user_allow_objs = UserAllow.objects.all()
    for user_allow_obj in user_allow_objs:
        user_id = user_allow_obj.user_id
        user_id_key = f"{user_id}"
        if user_id_key in user_allow_info_dict.keys():
            status = user_allow_obj.status
            description = user_allow_obj.description
            user_allow_info_dict[f"{user_id}"]['status'] = status
            user_allow_info_dict[f"{user_id}"]['description'] = description
        else:
            UserAllow.objects.filter(user_id = user_id).delete()


    user_allow_records = []
    for user_id in user_allow_info_dict.keys():
        user_name = user_allow_info_dict[user_id]['name']
        status = user_allow_info_dict[user_id]['status']
        description = user_allow_info_dict[user_id]['description']
        user_allow_records.append({'user_id':user_id, 'user_name':user_name, 'status':status, 'description':description})


    template = loader.get_template('pages/user_allow.html')

    context = {
        'user_allow_records': user_allow_records,
        'page_name':'user_allow'
    }
    return HttpResponse(template.render(context, request))



@login_required
@user_passes_test(lambda u: u.is_superuser)
@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)
def user_allow_status_change(request):
    if request.method == 'POST':
        params = json.loads(request.body)
        #check the whether the bot exists or not
        user_id = params['user_id']
        status = params['status']

        user_allow_obj, created = UserAllow.objects.update_or_create(
            user_id = user_id,
            defaults = {'status':status, 'created_at':timezone.now()}
        )
        resp = {'status':'success', 'error':"no_error"}
        return JsonResponse(resp)

    return JsonResponse({'error':"invalid request"}, status = 400)


@login_required
@user_passes_test(lambda u: u.is_superuser)
@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)
def user_allow_description_change(request):
    if request.method == 'POST':
        params = json.loads(request.body)
        #check the whether the bot exists or not
        user_id = params['user_id']
        description = params['description']

        user_allow_obj, created = UserAllow.objects.update_or_create(
            user_id = user_id,
            defaults = {'description':description, 'created_at':timezone.now()}
        )
        resp = {'status':'success', 'error':"no_error"}
        return JsonResponse(resp)

    return JsonResponse({'error':"invalid request"}, status = 400)





@login_required
@user_passes_test(lambda u: u.is_superuser)
def bot_run_setting_page(request):
    bot_run_setting_obj = BotAdminSetting.objects.get()

    template = loader.get_template('pages/bot_run_setting.html')

    context = {
        'vix_automatic_mode':bot_run_setting_obj.vix_automatic_mode,
        'vix_gap_lower': bot_run_setting_obj.vix_gap_lower,
        'vix_gap_up': bot_run_setting_obj.vix_gap_up,
        'order_gap_sec': bot_run_setting_obj.order_gap_sec,
        'page_name':'bot_run_setting'
    }
    return HttpResponse(template.render(context, request))

@login_required
@user_passes_test(lambda u: u.is_superuser)
@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)
def bot_run_setting_submit(request):
    if request.method == 'POST':
        params = json.loads(request.body)
        #check the whether the bot exists or not
        vix_automatic_mode = params['vix_automatic_mode']
        vix_gap_lower = params['vix_gap_lower']
        vix_gap_up = params['vix_gap_up']
        order_gap_sec_str = params['order_gap_sec']
        order_gap_sec = 10
        try:
            order_gap_sec = (int)(order_gap_sec_str)
        except:
            pass

        bot_run_setting_obj = BotAdminSetting.objects.get()
        bot_run_setting_obj.vix_automatic_mode = vix_automatic_mode
        bot_run_setting_obj.vix_gap_lower = vix_gap_lower
        bot_run_setting_obj.vix_gap_up = vix_gap_up
        bot_run_setting_obj.order_gap_sec = order_gap_sec
        bot_run_setting_obj.save()

        resp = {'status':'success', 'error':"no_error"}
        return JsonResponse(resp)

    return JsonResponse({'error':"invalid request"}, status = 400)





@login_required
@user_passes_test(lambda u: u.is_superuser)
def user_pwd_allow_page(request):
    user_objs = User.objects.all()
    user_info_dict = {}
    for user_obj in user_objs:
        user_info_dict[f"{user_obj.id}"] = user_obj.username

    user_pwd_allow_records = []
    user_pwd_allow_objs = UserPwdRequest.objects.all()
    for user_pwd_allow_obj in user_pwd_allow_objs:
        user_id = user_pwd_allow_obj.user_id
        user_id_key = f"{user_id}"
        if user_id_key in user_info_dict.keys():
            username = user_info_dict[user_id_key]
            secret_code = user_pwd_allow_obj.secret_code
            call_count = user_pwd_allow_obj.call_count
            allowed_by_admin = user_pwd_allow_obj.allowed_by_admin
            user_pwd_allow_records.append({'user_id':user_id, 'username':username, 'secret_code':secret_code, 'call_count':call_count, 'allowed_by_admin':allowed_by_admin})
        else:
            UserPwdRequest.objects.filter(user_id = user_id).delete()
    

    template = loader.get_template('pages/user_pwd_allow.html')

    context = {
        'user_pwd_allow_records': user_pwd_allow_records,
        'page_name':'user_pwd_allow'
    }
    return HttpResponse(template.render(context, request))


@login_required
@user_passes_test(lambda u: u.is_superuser)
@csrf_exempt  # Temporarily disable CSRF for simplicity (not recommended for production)
def user_pwd_allow_change(request):
    if request.method == 'POST':
        params = json.loads(request.body)
        #check the whether the bot exists or not
        user_id = params['user_id']
        allow_by_admin = params['allow_by_admin']
        print(user_id, allow_by_admin)

        UserPwdRequest.objects.filter(user_id = user_id).update(allowed_by_admin = allow_by_admin)
        resp = {'status':'success', 'error':"no_error"}
        return JsonResponse(resp)

    return JsonResponse({'error':"invalid request"}, status = 400)




@login_required
@user_passes_test(lambda u: u.is_superuser)
def user_token_page(request):
    user_all_objs = User.objects.all()
    #user info dict
    user_info_dict = {}
    for user_obj in user_all_objs:
        user_id = user_obj.id
        username = user_obj.username
        user_info_dict[f"{user_id}"] = username


    token_info = {}
    for user_obj in user_all_objs:
        token_info[f"{user_obj.id}"] = {'tokenid':'', 'username':user_obj.username, 'token':'', 'valid':'No Token'}


    bot_refresh_token_objs = BotRefresh.objects.all()
    for bot_refresh_token_obj in bot_refresh_token_objs:
        user_id = bot_refresh_token_obj.user_id
        user_id_key = f"{user_id}"
        if user_id_key not in user_info_dict.keys():
            BotRefresh.objects.filter(user_id=user_id).delete()
            continue

        username = user_info_dict[user_id_key]
        refresh_token = bot_refresh_token_obj.refresh_token
        token_info[uuser_id_key]["tokenid"] = bot_refresh_token_obj.id
        token_info[uuser_id_key]["token"] = refresh_token
        token_info[uuser_id_key]["valid"] = 'Expired'

        try:
            token_expire_at = bot_refresh_token_obj.created_at + timedelta(days=REF_TOKEN_EXPIRE_DAY)
            now = timezone.now()
            token_expire_diff = token_expire_at - now
            expire_sec = token_expire_diff.total_seconds()
            if expire_sec > 0:
                remain_sec = expire_sec % 60
                expire_min = (int)(expire_sec/60)
                remain_min = expire_min % 60
                expire_hour = (int)(expire_min/60)
                remain_hour = expire_hour % 60
                remain_day = (int)(expire_hour / 24)
                token_info[uuser_id_key]["valid"] = f'{remain_day:02} days {remain_hour:02}:{remain_min:02}:{remain_sec} remains'
        except:
            pass


    
    user_allow_records = []
    for user_id in user_allow_info_dict.keys():
        user_name = user_allow_info_dict[user_id]['name']
        status = user_allow_info_dict[user_id]['status']
        description = user_allow_info_dict[user_id]['description']
        user_allow_records.append({'user_id':user_id, 'user_name':user_name, 'status':status, 'description':description})


    template = loader.get_template('pages/user_allow.html')

    context = {
        'user_allow_records': user_allow_records,
        'page_name':'user_token'
    }
    return HttpResponse(template.render(context, request))
