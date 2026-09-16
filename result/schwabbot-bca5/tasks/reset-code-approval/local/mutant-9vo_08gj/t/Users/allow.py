from .models import UserAllow

# Same wait-message used when login is refused and no per-user description is set.
DEFAULT_ALLOW_WAIT_MESSAGE = (
    "Please note that your login may not yet be enabled by the administrator, "
    "and in some cases, it can take 24-48 hours for Schwab's API to fully connect."
)

ALLOW_ERROR_SESSION_KEY = 'allow_error_message'


def get_user_allow(user_id):
    try:
        return UserAllow.objects.get(user_id=user_id)
    except UserAllow.DoesNotExist:
        return None


def is_staff_or_admin(user):
    return bool(user and user.is_authenticated and (user.is_staff or user.is_superuser))


def user_has_allow_access(user):
    """Same rule as login: a UserAllow row exists and status is True."""
    if user is None or not user.is_authenticated:
        return False
    allow_obj = get_user_allow(user.id)
    return allow_obj is not None and allow_obj.status == True


def allow_denial_message(user):
    allow_obj = get_user_allow(user.id) if user is not None and user.is_authenticated else None
    if allow_obj is not None and allow_obj.description != '':
        return allow_obj.description
    return DEFAULT_ALLOW_WAIT_MESSAGE
