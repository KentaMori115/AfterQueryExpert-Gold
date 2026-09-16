"""Passwords a user has already had.

Nothing in the project remembered a password once it was replaced, so the
forgot-password page happily let somebody set the password they had just
lost, and the settings page let a user flip between two of them forever.
This module keeps the last few passwords an account has moved off, as
hashes, and answers the one question both pages need: has this account had
this password recently. The password in force is not in the table, it is read
off the user row, so the rule covers the one in use and the five before it.

Only hashes are kept, the same hashes ``django.contrib.auth`` writes on the
user row, and they are compared with the hashers rather than by string, so a
password is recognised even though every hash of it is different.
"""

from django.contrib.auth.hashers import check_password
from django.utils import timezone

from .models import UserPwdHistory


# How many replaced passwords are kept behind the one in force. Five is
# enough to stop the two-password shuffle without asking anyone to invent a
# lifetime of passwords.
REMEMBERED_PASSWORDS = 5

REUSED_MESSAGE = (
    'That password has been used on this account recently. Please pick one '
    'you have not used before.'
)


def remembered_rows(user_id):
    """The stored hashes for a user, newest first."""
    return list(
        UserPwdHistory.objects.filter(user_id=user_id).order_by('-created_at', '-id')
    )


def remembered_hashes(user):
    """Every hash that counts as recently used for this account.

    The hash on the user row comes first. An account that has never changed
    its password has nothing stored, and the password it is using right now
    still has to count, or the very first reset could hand back the password
    that was lost.
    """
    hashes = []
    current = getattr(user, 'password', '')
    if current:
        hashes.append(current)
    for row in remembered_rows(user.id)[:REMEMBERED_PASSWORDS]:
        if row.password:
            hashes.append(row.password)
    return hashes


def is_reused(user, raw_password):
    """Whether this account has had this password lately."""
    if not raw_password:
        return False
    for encoded in remembered_hashes(user):
        try:
            if check_password(raw_password, encoded):
                return True
        except Exception:
            # A row written by an older hasher that this install no longer
            # has is not a match and is not a reason to refuse a password.
            continue
    return False


def trim(user_id):
    """Drop everything past the remembered window."""
    rows = remembered_rows(user_id)
    for row in rows[REMEMBERED_PASSWORDS:]:
        row.delete()


def remember(user_id, encoded):
    """Store one password an account has moved off.

    Callers read the hash off the user row before they replace it and hand it
    here once the new one is saved, so a change that was refused leaves no
    trace and a change that went through can never be undone by setting the
    old password again. Older entries fall off the end.
    """
    if not encoded:
        return None
    row = UserPwdHistory.objects.create(
        user_id=user_id,
        password=encoded,
        created_at=timezone.now(),
    )
    trim(user_id)
    return row
