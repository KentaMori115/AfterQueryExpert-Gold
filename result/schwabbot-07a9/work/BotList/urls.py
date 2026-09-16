from django.urls import path
from . import views

urlpatterns = [
    path('', views.bots, name = 'bots'),
    path('schwab_callback/', views.schwab_callback, name = 'schwab_callback'),
    path('bots/', views.bots, name = 'bots'),
    path('bot_detail/<int:id>/', views.bot_detail, name = 'bot_detail'),

    path('bot_onoff/', views.bot_onoff, name = 'bot_onoff'),

    path('setting/', views.setting_page, name = 'setting'),
    path('change_password/', views.change_password, name = 'change_password'),

    path('schwab_authenticate/', views.schwab_authenticate, name = 'schwab_authenticate'),
]
