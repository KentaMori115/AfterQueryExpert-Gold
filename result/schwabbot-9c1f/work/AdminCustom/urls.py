from django.urls import path
from . import views
from django.contrib import admin

urlpatterns = [
    path('', views.admin_home, name = 'admin_home'),
    path('admin/', admin.site.urls),
    path('order_table/', views.order_table_page, name = 'order_table'),

    path('user_bot_onoff/', views.user_bot_onoff_page, name = 'user_bot_onoff'),
    path('bot_onoff_change/', views.bot_onoff_change, name = 'bot_onoff_change'),

    path('user_allow/', views.user_allow_page, name = 'user_allow'),
    path('user_allow_status_change/', views.user_allow_status_change, name = 'user_allow_status_change'),
    path('user_allow_description_change/', views.user_allow_description_change, name = 'user_allow_description_change'),

    path('user_pwd_allow/', views.user_pwd_allow_page, name = 'user_pwd_allow'),
    path('user_pwd_allow_change/', views.user_pwd_allow_change, name = 'user_pwd_allow_change'),

    path('bot_run_setting/', views.bot_run_setting_page, name = 'bot_run_setting'),
    path('bot_run_setting_submit/', views.bot_run_setting_submit, name = 'bot_run_setting_submit'),

    path('risk_budget/', views.risk_budget_page, name = 'risk_budget'),
    path('risk_budget_change/', views.risk_budget_change, name = 'risk_budget_change'),
    path('risk_budget_release/', views.risk_budget_release, name = 'risk_budget_release'),

    path('user_token/', views.user_token_page, name = 'user_token'),
]
