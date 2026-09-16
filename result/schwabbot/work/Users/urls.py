from django.urls import path
from .views import register_view, login_view, logout_view, forgot_password_view
from django.contrib.auth.views import LogoutView

urlpatterns = [
    path('register/', register_view, name='register'),
    path('login/', login_view, name='login'),
    path('logout/', logout_view, name='logout'),
    path('forgot_password/', forgot_password_view, name='forgot_password'),
]
