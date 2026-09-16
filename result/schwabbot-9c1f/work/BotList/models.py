from django.db import models

# Create your models here.

class Bot(models.Model):
    botname = models.CharField(max_length=255)
    templatename = models.CharField(max_length=100, default = "bot1.html")
    description = models.TextField()
    created_at = models.DateTimeField()

class BotOnOff(models.Model):
    bot_id = models.IntegerField()
    user_id = models.IntegerField()
    status = models.BooleanField()
    created_at = models.DateTimeField()

class BotSetting(models.Model):
    bot_id = models.IntegerField()
    user_id = models.IntegerField()
    setting = models.TextField()
    created_at = models.DateTimeField()

class BotRefresh(models.Model):
    user_id = models.IntegerField()
    refresh_token = models.CharField(max_length = 200)
    created_at = models.DateTimeField()

class BotAccess(models.Model):
    user_id = models.IntegerField()
    access_token = models.CharField(max_length = 200)
    created_at = models.DateTimeField()


class BotAdminSetting(models.Model):
    vix_automatic_mode = models.BooleanField(default = False)
    vix_gap_lower = models.BooleanField(default = True)
    vix_gap_up = models.BooleanField(default = False)
    order_gap_sec = models.IntegerField(default = 10)

class BotRiskLimit(models.Model):
    user_id = models.IntegerField()
    cap_type = models.CharField(max_length = 20, default = 'Fixed')
    daily_debit_cap = models.FloatField(default = 0.0)
    cap_percentage = models.FloatField(default = 0.0)
    max_lots_per_order = models.IntegerField(default = 0)
    max_lots_per_day = models.IntegerField(default = 0)
    enabled = models.BooleanField(default = True)
    created_at = models.DateTimeField()


class BotRiskCommitment(models.Model):
    user_id = models.IntegerField()
    order_id = models.CharField(max_length = 100)
    trade_date = models.CharField(max_length = 10)
    debit = models.FloatField(default = 0.0)
    lots = models.IntegerField(default = 0)
    created_at = models.DateTimeField()
