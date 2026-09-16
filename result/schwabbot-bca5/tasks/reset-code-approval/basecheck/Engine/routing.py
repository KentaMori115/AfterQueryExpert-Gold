from django.urls import re_path
from .consumers import MainConsumerAsync

websocket_urlpatterns = [
    re_path(r'ws/signalpath/$', MainConsumerAsync.as_asgi()),
]
