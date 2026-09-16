from django.db import models

# Create your models here.

# model to check whether current user is currently connected or not
class UserOnOff(models.Model):
    user_id = models.IntegerField()
    status = models.BooleanField()
    created_at = models.DateTimeField()

#model to store the trading result 
class UserMessage(models.Model):
    user_id = models.IntegerField()
    message = models.TextField()
    created_at = models.DateTimeField()

class UserAllow(models.Model):
    user_id = models.IntegerField()
    status = models.BooleanField(default = False)
    description = models.TextField(default = 'Please note that your login may not yet be enabled by the administrator, and in some cases, it can take 24–48 hours for Schwab’s API to fully connect.')
    created_at = models.DateTimeField()

class UserPwdRequest(models.Model):
    user_id = models.IntegerField()
    secret_code = models.IntegerField()
    call_count = models.IntegerField(default = 0)
    allowed_by_admin = models.BooleanField()
    created_at = models.DateTimeField()
