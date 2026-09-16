from django.contrib.auth import logout
from django.shortcuts import redirect

from .allow import (
    ALLOW_ERROR_SESSION_KEY,
    allow_denial_message,
    is_staff_or_admin,
    user_has_allow_access,
)

# Auth pages must stay reachable so a refused user can see the login message
# and so logout/register/forgot-password are not intercepted.
_AUTH_PATH_PREFIXES = (
    '/accounts/login',
    '/accounts/logout',
    '/accounts/register',
    '/accounts/forgot_password',
)


class UserAllowMiddleware:
    """Re-check the existing UserAllow row on every request.

    Login already refuses a new sign-in when status is not True. This applies
    the same row to an existing session so a disable takes effect immediately.
    Staff and admin are left alone; they do not need an allow-list entry.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return self.get_response(request)

        if is_staff_or_admin(user):
            return self.get_response(request)

        if user_has_allow_access(user):
            return self.get_response(request)

        path = request.path
        if any(path.startswith(prefix) for prefix in _AUTH_PATH_PREFIXES):
            return self.get_response(request)

        message = allow_denial_message(user)
        logout(request)
        request.session[ALLOW_ERROR_SESSION_KEY] = message
        return redirect('/accounts/login')
