import json
from channels.generic.websocket import WebsocketConsumer, AsyncWebsocketConsumer
import time
import os

import asyncio
import aiofiles


from asgiref.sync import async_to_sync, sync_to_async

import math
from datetime import datetime, timedelta
from django.utils import timezone

from BotList.models import Bot, BotRefresh, BotAccess, BotOnOff, BotSetting, BotAdminSetting
from Users.models import UserOnOff, UserMessage
from django.contrib.auth.models import User

from .config import *




class MainConsumerAsync(AsyncWebsocketConsumer):
    order_result_dict = None

    async def connect(self):
        user = self.scope["user"]
        if user.is_authenticated:
            pure_username = user.username
            pure_username = pure_username.replace('@', '_')
            self.group_name = f"user_{pure_username}"
            await self.channel_layer.group_add(
                self.group_name, self.channel_name
            )
        
        await self.accept()

        if user.is_authenticated:
            print(user.username, 'is connected.')
            # Update the UserOnOff state
            user_onoff_obj, created = await sync_to_async(
                UserOnOff.objects.update_or_create
            )(
                user_id=user.id,
                defaults={"status": True, "created_at": timezone.now()}
            )

            # Get the authentication state
            '''
            try:
                auth_obj = await sync_to_async(BotRefresh.objects.get)(user_id=user.id)
                token_expire_at = auth_obj.created_at + timedelta(days=REF_TOKEN_EXPIRE_DAY)
                now = timezone.now()
                token_expire_diff = token_expire_at - now
                expire_sec = token_expire_diff.total_seconds()

                    
            except:
                print('auth expired or not performed')
                expire_sec = -1



            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "send.general.signal",
                    "msg_title": 'user_auth_state',
                    "msg_body": json.dumps({'expire_sec': expire_sec}),
                }
            )
            '''


            # Get the missing message while the user is offline
            user_message_objs = await sync_to_async(list)(UserMessage.objects.filter(user_id=user.id))
            if len(user_message_objs) > 0:
                message_json_list = []
                for user_message_obj in user_message_objs:
                    message_json = json.loads(user_message_obj.message)
                    message_json_list.append(message_json)

                print(message_json_list)

                await self.channel_layer.group_send(
                    self.group_name,
                    {
                        "type": "send.general.signal",
                        "msg_title": 'user_missing_message',
                        "msg_body": json.dumps(message_json_list),
                    }
                )
                await sync_to_async(UserMessage.objects.filter(user_id=user.id).delete)()

    async def disconnect(self, close_code):
        user = self.scope['user']
        if user.is_authenticated:
            await self.channel_layer.group_discard(
                self.group_name, self.channel_name
            )
            print(user.username, ' is disconnected')
            # Update the UserOnOff state
            await sync_to_async(UserOnOff.objects.update_or_create)(
                user_id=user.id,
                defaults={"status": False, "created_at": timezone.now()}
            )

    async def receive(self, text_data):
        data = json.loads(text_data)
        message = data.get('message')
        bot_name = data.get('bot_name')
        if message is None or bot_name is None:
            return

        print(f'receiving... {message} from {bot_name}')
        if bot_name == 'bot01':
            if message == 'set_server_info':
                await self.set_bot1_server_info()

            elif message == 'send_order_result':
                order_result_dict = data.get('order_result_dict')
                print(order_result_dict)
                await self.send_bot1_order_result(order_result_dict)
        
        elif bot_name == 'bot02':
            if message == 'set_server_info':
                await self.set_bot2_server_info()

            elif message == 'send_order_result':
                order_result_dict = data.get('order_result_dict')
                print(order_result_dict)
                await self.send_bot2_order_result(order_result_dict)






    async def set_bot1_server_info(self):
        #set admin info
        vix_automatic_mode = False
        vix_gap_lower = False
        order_gap_sec = 10
        bot1_admin_setting_objs = await sync_to_async(list)(BotAdminSetting.objects.all())
        if len(bot1_admin_setting_objs) > 0:
            bot1_admin_setting_obj = bot1_admin_setting_objs[0]
            vix_automatic_mode = bot1_admin_setting_obj.vix_automatic_mode
            vix_gap_lower = bot1_admin_setting_obj.vix_gap_lower
            order_gap_sec = bot1_admin_setting_obj.order_gap_sec

        bot1_admin_setting = {'vix_automatic_mode':vix_automatic_mode, 'vix_gap_lower': vix_gap_lower, 'order_gap_sec':order_gap_sec}
        bot1_admin_setting_dumps = json.dumps(bot1_admin_setting, indent = 4)

        bot1_admin_info_path = f"Engine/setting/{BOT1_ADMIN_INFO_PATH}"
        async with aiofiles.open(bot1_admin_info_path, 'w') as outfile:
            await outfile.write(bot1_admin_setting_dumps)




        #user info dict
        user_objs = await sync_to_async(list)(User.objects.all())
        user_info_dict = {}
        for user_obj in user_objs:
            user_id = user_obj.id
            username = user_obj.username
            user_info_dict[f"{user_id}"] = username

        #get the bot2 id
        bot1_obj = await sync_to_async(Bot.objects.get)(botname = 'Bot1')

        #user turn on/off state
        bot1_user_onoff_dict = {}
        bot1_user_onoff_objs = await sync_to_async(list)(BotOnOff.objects.filter(bot_id = bot1_obj.id))
        for bot1_user_onoff_obj in bot1_user_onoff_objs:
            user_id = bot1_user_onoff_obj.user_id
            user_id_key = f"{user_id}"
            if user_id_key in user_info_dict.keys():
                bot1_user_onoff_dict[user_id_key] = bot1_user_onoff_obj.status
            else:
                await sync_to_async(BotOnOff.objects.filter(user_id=user_id).delete)()


        #set user info
        bot1_user_info = {}
        bot1_user_setting_objs = await sync_to_async(list)(BotSetting.objects.filter(bot_id = bot1_obj.id))
        for bot1_user_setting_obj in bot1_user_setting_objs:
            user_id = bot1_user_setting_obj.user_id
            user_id_key = f"{user_id}"
            if user_id_key not in user_info_dict.keys():
                await sync_to_async(BotSetting.objects.filter(user_id=user_id).delete)()
                continue


            if user_id_key not in bot1_user_onoff_dict.keys() or bot1_user_onoff_dict[user_id_key] == False:
                continue

            username = user_info_dict[user_id_key]
            bot1_user_setting = json.loads(bot1_user_setting_obj.setting)
            bot1_user_info.update({username:bot1_user_setting})
        
        bot1_user_info_dumps = json.dumps(bot1_user_info, indent = 4)
        bot1_user_info_path = f"Engine/setting/{BOT1_USER_INFO_PATH}"
        async with aiofiles.open(bot1_user_info_path, 'w') as outfile:
            await outfile.write(bot1_user_info_dumps)





        #set token info
        token_info = {}

        bot_refresh_token_objs = await sync_to_async(list)(BotRefresh.objects.all())
        for bot_refresh_token_obj in bot_refresh_token_objs:
            user_id = bot_refresh_token_obj.user_id
            user_id_key = f"{user_id}"
            if user_id_key not in user_info_dict.keys():
                await sync_to_async(BotRefresh.objects.filter(user_id=user_id).delete)()
                continue

            username = user_info_dict[user_id_key]
            refresh_token = bot_refresh_token_obj.refresh_token

            try:
                token_expire_at = bot_refresh_token_obj.created_at + timedelta(days=REF_TOKEN_EXPIRE_DAY)
                now = timezone.now()
                token_expire_diff = token_expire_at - now
                expire_sec = token_expire_diff.total_seconds()
                if expire_sec > 0:
                    token_info.update({username:refresh_token})
            except:
                pass

        token_info_dumps = json.dumps(token_info, indent = 4)
        token_info_path = f"Engine/setting/{BOT1_TOKEN_PATH}"
        async with aiofiles.open(token_info_path, 'w') as outfile:
            await outfile.write(token_info_dumps)



    async def send_bot1_order_result(self, order_result_dict):
        print('Sending Order Result For Bot1')
        print(order_result_dict)
        user_names = order_result_dict.keys()

        for user_name in user_names:
            cur_user = [user_name]
            msg_title = 'bot1_order_result'
            msg_body = {'order_status': f"{order_result_dict[user_name][1]}:{order_result_dict[user_name][2]}"}

            # Check whether user is on or off
            try:
                user_obj = await sync_to_async(User.objects.get)(username=user_name)
                user_id = user_obj.id
            except:
                user_id = None

            try:
                user_onoff_obj = await sync_to_async(UserOnOff.objects.get)(user_id=user_id)
                user_onoff_status = user_onoff_obj.status
            except:
                user_onoff_status = False
            
            if user_onoff_status:  # the user is online
                await self.send_general_to_selected_users(cur_user, msg_title, msg_body)
            else:  # the user is offline
                message = json.dumps({'bot_name': 'Bot1', 'order_status': msg_body['order_status']})
                user_message = UserMessage(
                    user_id=user_id, 
                    message=message, 
                    created_at=timezone.now()
                )
                await sync_to_async(user_message.save)()



    async def set_bot2_server_info(self):
        #set admin info
        vix_automatic_mode = False
        vix_gap_up = False
        order_gap_sec = 10
        bot1_admin_setting_objs = await sync_to_async(list)(BotAdminSetting.objects.all())
        if len(bot1_admin_setting_objs) > 0:
            bot1_admin_setting_obj = bot1_admin_setting_objs[0]
            vix_automatic_mode = bot1_admin_setting_obj.vix_automatic_mode
            vix_gap_up = bot1_admin_setting_obj.vix_gap_up
            order_gap_sec = bot1_admin_setting_obj.order_gap_sec

        bot2_admin_setting = {'vix_automatic_mode':vix_automatic_mode, 'vix_gap_up': vix_gap_up, 'order_gap_sec':order_gap_sec}
        bot2_admin_setting_dumps = json.dumps(bot2_admin_setting, indent = 4)

        bot2_admin_info_path = f"Engine/setting/{BOT2_ADMIN_INFO_PATH}"
        async with aiofiles.open(bot2_admin_info_path, 'w') as outfile:
            await outfile.write(bot2_admin_setting_dumps)


        #get the bot2 id
        bot2_obj = await sync_to_async(Bot.objects.get)(botname = 'Bot2')


        #user info dict
        user_objs = await sync_to_async(list)(User.objects.all())
        user_info_dict = {}
        for user_obj in user_objs:
            user_id = user_obj.id
            username = user_obj.username
            user_info_dict[f"{user_id}"] = username

        #user turn on/off state
        bot2_user_onoff_dict = {}
        bot2_user_onoff_objs = await sync_to_async(list)(BotOnOff.objects.filter(bot_id = bot2_obj.id))

        for bot2_user_onoff_obj in bot2_user_onoff_objs:
            user_id = bot2_user_onoff_obj.user_id
            user_id_key = f"{user_id}"
            if user_id_key not in user_info_dict.keys():
                await sync_to_async(BotOnOff.objects.filter(user_id=user_id).delete)()
                continue
            bot2_user_onoff_dict[user_id_key] = bot2_user_onoff_obj.status

        #set user info
        bot2_user_info = {}
        bot2_user_setting_objs = await sync_to_async(list)(BotSetting.objects.filter(bot_id = bot2_obj.id))
        for bot2_user_setting_obj in bot2_user_setting_objs:
            user_id = bot2_user_setting_obj.user_id
            user_id_key = f"{user_id}"
            if user_id_key not in bot2_user_onoff_dict.keys() or bot2_user_onoff_dict[user_id_key] == False:
                continue

            username = user_info_dict[user_id_key]
            bot2_user_setting = json.loads(bot2_user_setting_obj.setting)
            bot2_user_info.update({username:bot2_user_setting})
        
        bot2_user_info_dumps = json.dumps(bot2_user_info, indent = 4)
        bot2_user_info_path = f"Engine/setting/{BOT2_USER_INFO_PATH}"
        async with aiofiles.open(bot2_user_info_path, 'w') as outfile:
            await outfile.write(bot2_user_info_dumps)





        #set token info
        token_info = {}

        bot_refresh_token_objs = await sync_to_async(list)(BotRefresh.objects.all())
        for bot_refresh_token_obj in bot_refresh_token_objs:
            user_id = bot_refresh_token_obj.user_id
            user_id_key = f"{user_id}"
            if user_id_key not in user_info_dict.keys():
                await sync_to_async(BotRefresh.objects.filter(user_id=user_id).delete)()
                continue

            username = user_info_dict[user_id_key]
            refresh_token = bot_refresh_token_obj.refresh_token

            try:
                token_expire_at = bot_refresh_token_obj.created_at + timedelta(days=REF_TOKEN_EXPIRE_DAY)
                now = timezone.now()
                token_expire_diff = token_expire_at - now
                expire_sec = token_expire_diff.total_seconds()
                if expire_sec > 0:
                    token_info.update({username:refresh_token})
            except:
                pass

        token_info_dumps = json.dumps(token_info, indent = 4)
        token_info_path = f"Engine/setting/{BOT2_TOKEN_PATH}"
        async with aiofiles.open(token_info_path, 'w') as outfile:
            await outfile.write(token_info_dumps)



    async def send_bot2_order_result(self, order_result_dict):
        print('Sending Order Result For Bot2')
        print(order_result_dict)
        user_names = order_result_dict.keys()

        for user_name in user_names:
            cur_user = [user_name]
            msg_title = 'bot2_order_result'
            msg_body = {'order_status': f"{order_result_dict[user_name][1]}:{order_result_dict[user_name][2]}"}

            # Check whether user is on or off
            try:
                user_obj = await sync_to_async(User.objects.get)(username=user_name)
                user_id = user_obj.id
            except:
                user_id = None

            try:
                user_onoff_obj = await sync_to_async(UserOnOff.objects.get)(user_id=user_id)
                user_onoff_status = user_onoff_obj.status
            except:
                user_onoff_status = False
            
            if user_onoff_status:  # the user is online
                await self.send_general_to_selected_users(cur_user, msg_title, msg_body)
            else:  # the user is offline
                message = json.dumps({'bot_name': 'Bot2', 'order_status': msg_body['order_status']})
                user_message = UserMessage(
                    user_id=user_id, 
                    message=message, 
                    created_at=timezone.now()
                )
                await sync_to_async(user_message.save)()



    async def send_general_to_selected_users(self, user_names, msg_title, msg_body):
        for user_name in user_names:
            pure_username = user_name.replace('@', '_')
            group_name = f"user_{pure_username}"
            print(group_name)
            await self.channel_layer.group_send(
                group_name,
                {
                    "type": "send.general.signal",
                    'msg_title': msg_title,
                    'msg_body': msg_body
                }
            )

    async def send_general_signal(self, event):
        msg_title = event['msg_title']
        msg_body = event['msg_body']

        await self.send(text_data=json.dumps({
            'msg_title': msg_title,
            'msg_body': msg_body
        }))

