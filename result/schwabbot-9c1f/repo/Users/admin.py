from django.contrib import admin

# Register your models here.
from .models import UserOnOff, UserMessage, UserAllow, UserPwdRequest

admin.site.register(UserOnOff)
admin.site.register(UserMessage)
admin.site.register(UserAllow)
admin.site.register(UserPwdRequest)

