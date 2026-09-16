"""The rules a password change request lives by.

``UserPwdRequest`` has carried a ``secret_code`` and a ``call_count`` since
the admin approval page was written, and the page shows both, but nothing in
the reset flow ever read either one. This module is where they mean
something: the code is what the user has to type back, and the count is how
many times they got it wrong.

A request is in one of three states.

``WAITING``
    The administrator has not approved it. The code is sitting on the admin
    page waiting to be read out, and no reset step may touch it.
``OPEN``
    Approved, and the code has not run out yet. This is the only state in
    which a code may be tried.
``EXPIRED``
    The market has closed on it. Nothing about a request outlives the close
    that follows it, whether it was approved or still queued, so the state is
    transitional: a step that sees it starts the request over behind a new
    code and the row is ``WAITING`` again by the time the user reads the
    answer.
``WITHDRAWN``
    Approved once and switched off again by hand. Nobody records that either;
    it shows in the row as an approval time standing next to a flag that is no
    longer set, which is a combination the flow itself never leaves behind.
    Transitional in the same way, and for the same reason: whoever heard the
    code must not keep it.
"""

import random

from django.utils import timezone

from .models import UserPwdRequest
from .resetwindow import next_market_close


# The admin page prints the code as six digits, so that is the range it is
# drawn from, the same range Users/forms.py used when it first minted one.
SECRET_CODE_LOWEST = 100000
SECRET_CODE_HIGHEST = 999999

# How many wrong codes an approval is worth. The count is the one the admin
# page shows, so it also tells the administrator how much guessing has gone on
# before they approve again. A request being switched on for a second time has
# already cost the administrator one readout, and is worth a single try.
ATTEMPT_LIMIT = 3
REPEAT_ATTEMPT_LIMIT = 1

WAITING = 'waiting'
OPEN = 'open'
EXPIRED = 'expired'
WITHDRAWN = 'withdrawn'


WAIT_FOR_ADMIN_MESSAGE = (
    'Please wait for the administrator to allow you change the password.'
)
REQUEST_SENT_MESSAGE = (
    'Password Change Request was just sent\n. Please wait for the '
    'administrator to allow you change the password.'
)
REQUEST_PENDING_MESSAGE = (
    'Password Change Request was already sent\n. Please wait for the '
    'administrator to allow you change the password.'
)
NO_REQUEST_MESSAGE = 'Please request for changing the password'
EXPIRED_MESSAGE = (
    'That code has run out. A new one is waiting for the administrator to '
    'read out.'
)
WRONG_CODE_MESSAGE = 'That code is not the one on your request.'
SPENT_MESSAGE = (
    'Too many wrong codes. The request went back to the administrator with a '
    'new code.'
)


def new_secret_code(avoid=None):
    """A six digit code, never the one it is replacing.

    Reissuing the code somebody has just been told would leave a spent code
    working, so the draw is repeated until it lands somewhere else. There are
    nine hundred thousand of them, so this goes round again about once in that
    many calls.
    """
    code = random.randint(SECRET_CODE_LOWEST, SECRET_CODE_HIGHEST)
    while avoid is not None and code == int(avoid):
        code = random.randint(SECRET_CODE_LOWEST, SECRET_CODE_HIGHEST)
    return code


def get_request(user_id):
    """The one open request row for a user, or ``None``."""
    return UserPwdRequest.objects.filter(user_id=user_id).first()


def start_request(user_id):
    """Put a user in the administrator's queue with a code of their own."""
    return UserPwdRequest.objects.create(
        user_id=user_id,
        secret_code=new_secret_code(),
        call_count=0,
        allowed_by_admin=False,
        created_at=timezone.now(),
    )


def stamp_approval(request):
    """Record the moment an approval was first seen, and that it happened.

    Nothing writes an approval time, and nothing counts approvals. The admin
    page flips ``allowed_by_admin`` with a queryset update, which runs no
    model code at all, so the only chance to notice either is the next time a
    reset step looks at the row. A row that already carries a stamp keeps the
    one it has, or the clock would restart on every page load and the count
    would run away with it.
    """
    if not request.allowed_by_admin:
        return False
    if request.approved_at is not None:
        return False
    request.approved_at = timezone.now()
    request.approvals = request.approvals + 1
    request.save(update_fields=['approved_at', 'approvals'])
    return True


def attempt_limit(request):
    """How many wrong codes this approval is worth.

    The first time a request is switched on it gets the full budget. Every
    approval after that is a second code read out over the same request, and
    is worth one try.
    """
    if request.approvals > 1:
        return REPEAT_ATTEMPT_LIMIT
    return ATTEMPT_LIMIT


def deadline_of(request):
    """When this request's code runs out.

    One rule, two starting points. Once an approval has been seen the clock
    runs from the approval, because that is when somebody was told the code.
    Until then it runs from the moment the request was made, so a code nobody
    approved in time never survives into another session for the
    administrator to read out.
    """
    if request is None:
        return None
    anchor = request.approved_at or request.created_at
    return next_market_close(anchor)


def has_run_out(request):
    """Whether a request is already past its market close."""
    deadline = deadline_of(request)
    if deadline is None:
        return False
    return timezone.now() >= deadline


def revoke(request):
    """Send a request back to the administrator behind a new code.

    Everything moves together, and a caller never wants a subset of it: the
    approval comes off, the attempt count goes back to nothing, the approval
    time is forgotten so the next approval starts its own window, the code the
    user has been told gives way to a different one, and the request dates from
    now, which is what gives the replacement a session of its own to be read
    out in. Whoever heard the old code cannot use it again.

    How many times the request has been approved is deliberately left where it
    is. It is the one thing that has to outlive being sent back, or the row
    could not tell a first readout from a third.
    """
    request.allowed_by_admin = False
    request.call_count = 0
    request.approved_at = None
    request.secret_code = new_secret_code(avoid=request.secret_code)
    request.created_at = timezone.now()
    request.save(update_fields=[
        'allowed_by_admin',
        'call_count',
        'approved_at',
        'secret_code',
        'created_at',
    ])
    return request


def evaluate(request):
    """Bring a request up to date and say what state it is in.

    Both reset steps run this before they decide anything else, so an
    approval is stamped, a stale approval is cleared and a withdrawn one is
    noticed no matter which step the user happened to arrive at.
    """
    if request is None:
        return WAITING
    stamp_approval(request)
    if has_run_out(request):
        revoke(request)
        return EXPIRED
    if not request.allowed_by_admin:
        # An approval time with the flag switched off is the administrator
        # having second thoughts. A row this flow put back in the queue never
        # looks like that, because sending one back forgets the time.
        if request.approved_at is not None:
            revoke(request)
            return WITHDRAWN
        return WAITING
    return OPEN


def code_matches(request, submitted):
    """Whether what the user typed is the code on the row.

    The comparison is on text, so leading and trailing space is forgiven and
    anything that is not the code, letters included, is simply wrong rather
    than a form error of its own.
    """
    typed = '' if submitted is None else str(submitted).strip()
    return typed == str(request.secret_code)


def register_failed_attempt(request):
    """Charge one wrong code to a request.

    Returns ``True`` when that attempt was the last one the approval was
    worth, in which case the request has already been revoked and is waiting
    on the administrator again.
    """
    request.call_count = request.call_count + 1
    if request.call_count >= attempt_limit(request):
        revoke(request)
        return True
    request.save(update_fields=['call_count'])
    return False
