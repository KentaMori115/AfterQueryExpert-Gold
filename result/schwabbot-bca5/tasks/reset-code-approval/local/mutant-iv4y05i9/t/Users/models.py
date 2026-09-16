from django.db import models

from .resetwindow import next_market_close

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
    # When a reset step first saw this request approved. The admin page flips
    # allowed_by_admin with a queryset update and writes nothing else, so this
    # is filled in by the flow rather than by the page.
    approved_at = models.DateTimeField(null = True, blank = True, default = None)
    # How many times this row has been switched on. Nothing writes it either,
    # so it is counted at the same moment the approval is noticed, and it is
    # the one thing that survives a request being sent back.
    approvals = models.IntegerField(default = 0)

    def code_deadline(self):
        """When the secret code on this row stops working.

        The next market close after the approval, or after the request itself
        while it is still queued. Closes only fall on weekdays, so an approval
        seen on Friday evening lasts until Monday afternoon.
        """
        return next_market_close(self.approved_at or self.created_at)


class UserPwdHistory(models.Model):
    """One password an account used to have, kept as its hash.

    Written every time a password is set, by the forgot-password page and by
    the settings page alike, so neither of them can hand back a password the
    account has had recently. Only the newest few rows per user are kept.
    """

    user_id = models.IntegerField()
    password = models.CharField(max_length = 200)
    created_at = models.DateTimeField()
