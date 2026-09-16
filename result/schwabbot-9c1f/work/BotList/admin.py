from django.contrib import admin

# Register your models here.

from .models import Bot, BotOnOff, BotRefresh, BotAccess, BotSetting, BotAdminSetting, BotRiskLimit, BotRiskCommitment

admin.site.register(Bot)
admin.site.register(BotOnOff)
admin.site.register(BotRefresh)
admin.site.register(BotAccess)
admin.site.register(BotSetting)
admin.site.register(BotAdminSetting)
admin.site.register(BotRiskLimit)
admin.site.register(BotRiskCommitment)
