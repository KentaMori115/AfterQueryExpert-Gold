"""Two rules that outlive a single page load.

The first is the calendar a secret code dies on, read straight off
``UserPwdRequest.code_deadline()`` so no page has to be driven to see it. The
second is the ban on going back to a password an account has already had,
which both the forgot-password page and the settings page answer to.
"""

import json
from datetime import datetime, timedelta

import pytz
from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.utils import timezone

from Users.forms import ForgotPwdStep2Form
from Users.models import UserAllow, UserPwdRequest


EASTERN = pytz.timezone('US/Eastern')

COLLEAGUE = 'colleague'

FIRST_PASSWORD = 'Halyard#5508'
SECOND_PASSWORD = 'Kestrel!9412'
THIRD_PASSWORD = 'Marlin?7731'
FOURTH_PASSWORD = 'Gudgeon@6620'


def eastern(year, month, day, hour, minute=0):
    """An aware ``US/Eastern`` wall clock moment."""
    return EASTERN.localize(datetime(year, month, day, hour, minute))


class CodeDeadlineTests(TestCase):
    """When a code runs out, given the moment its clock started.

    The rows here are never saved. ``code_deadline()`` is a reading of one
    row's own dates, so an unsaved instance answers exactly as a stored one
    would.
    """

    def deadline_after_approval(self, moment):
        row = UserPwdRequest(
            user_id=1,
            secret_code=515151,
            call_count=0,
            allowed_by_admin=True,
            created_at=moment - timedelta(days=9),
            approved_at=moment,
        )
        return row.code_deadline()

    def test_morning_approval_runs_out_that_afternoon(self):
        self.assertEqual(
            self.deadline_after_approval(eastern(2024, 1, 17, 9, 35)),
            eastern(2024, 1, 17, 16),
        )

    def test_approval_a_minute_before_the_bell_keeps_that_bell(self):
        self.assertEqual(
            self.deadline_after_approval(eastern(2024, 1, 17, 15, 59)),
            eastern(2024, 1, 17, 16),
        )

    def test_approval_on_the_bell_has_missed_it(self):
        self.assertEqual(
            self.deadline_after_approval(eastern(2024, 1, 17, 16)),
            eastern(2024, 1, 18, 16),
        )

    def test_evening_approval_waits_for_the_next_day(self):
        self.assertEqual(
            self.deadline_after_approval(eastern(2024, 1, 17, 19, 30)),
            eastern(2024, 1, 18, 16),
        )

    def test_friday_evening_approval_waits_for_monday(self):
        self.assertEqual(
            self.deadline_after_approval(eastern(2024, 3, 15, 18)),
            eastern(2024, 3, 18, 16),
        )

    def test_saturday_approval_waits_for_monday(self):
        self.assertEqual(
            self.deadline_after_approval(eastern(2024, 3, 16, 10)),
            eastern(2024, 3, 18, 16),
        )

    def test_sunday_approval_waits_for_monday(self):
        self.assertEqual(
            self.deadline_after_approval(eastern(2024, 3, 17, 23, 45)),
            eastern(2024, 3, 18, 16),
        )

    def test_deadline_is_four_in_the_afternoon_through_a_clock_change(self):
        winter = self.deadline_after_approval(eastern(2024, 1, 17, 9))
        summer = self.deadline_after_approval(eastern(2024, 7, 17, 9))
        self.assertEqual(winter.astimezone(pytz.utc).hour, 21)
        self.assertEqual(summer.astimezone(pytz.utc).hour, 20)

    def test_a_queued_request_runs_on_the_clock_it_was_made_on(self):
        row = UserPwdRequest(
            user_id=1,
            secret_code=515151,
            call_count=0,
            allowed_by_admin=False,
            created_at=eastern(2024, 1, 17, 9, 35),
            approved_at=None,
        )
        self.assertEqual(row.code_deadline(), eastern(2024, 1, 17, 16))

    def test_an_approval_takes_over_from_the_request_date(self):
        row = UserPwdRequest(
            user_id=1,
            secret_code=515151,
            call_count=0,
            allowed_by_admin=True,
            created_at=eastern(2024, 1, 17, 9, 35),
            approved_at=eastern(2024, 1, 19, 9, 35),
        )
        self.assertEqual(row.code_deadline(), eastern(2024, 1, 19, 16))


class ResetReuseTests(TestCase):
    """The forgot-password page will not hand a password back."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='trader',
            password=FIRST_PASSWORD,
        )
        self.request_row = UserPwdRequest.objects.create(
            user_id=self.user.id,
            secret_code=515151,
            call_count=0,
            allowed_by_admin=True,
            created_at=timezone.now(),
            approved_at=timezone.now(),
        )

    def step2(self, password):
        return ForgotPwdStep2Form({
            'formstep': 'step2',
            'username': 'trader',
            'secret_code': '515151',
            'new_password': password,
            'confirm_password': password,
        })

    def test_the_password_in_force_may_not_be_set_again(self):
        self.assertFalse(self.step2(FIRST_PASSWORD).is_valid())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(FIRST_PASSWORD))

    def test_refusing_a_reused_password_costs_no_attempt(self):
        self.step2(FIRST_PASSWORD).is_valid()
        row = UserPwdRequest.objects.get(user_id=self.user.id)
        self.assertEqual(row.call_count, 0)
        self.assertTrue(row.allowed_by_admin)

    def test_a_fresh_password_is_accepted(self):
        self.assertTrue(self.step2(SECOND_PASSWORD).is_valid())

    def test_a_password_the_page_set_cannot_be_set_again(self):
        client = Client()
        client.post('/accounts/forgot_password/', {
            'formstep': 'step2',
            'username': 'trader',
            'secret_code': '515151',
            'new_password': SECOND_PASSWORD,
            'confirm_password': SECOND_PASSWORD,
        })
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(SECOND_PASSWORD))

        UserPwdRequest.objects.create(
            user_id=self.user.id,
            secret_code=626262,
            call_count=0,
            allowed_by_admin=True,
            created_at=timezone.now(),
            approved_at=timezone.now(),
        )
        form = ForgotPwdStep2Form({
            'formstep': 'step2',
            'username': 'trader',
            'secret_code': '626262',
            'new_password': FIRST_PASSWORD,
            'confirm_password': FIRST_PASSWORD,
        })
        self.assertFalse(form.is_valid())


class SettingsPageReuseTests(TestCase):
    """The signed-in settings page answers to the same rule."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='trader',
            password=FIRST_PASSWORD,
        )
        UserAllow.objects.create(
            user_id=self.user.id,
            status=True,
            description='',
            created_at=timezone.now(),
        )
        self.client = Client()
        self.client.force_login(self.user)

    def change_to(self, password):
        return self.client.post(
            '/change_password/',
            data=json.dumps({
                'new_password': password,
                'confirm_password': password,
            }),
            content_type='application/json',
        )

    def test_a_fresh_password_is_accepted_and_then_closed_off(self):
        response = self.change_to(SECOND_PASSWORD)
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(SECOND_PASSWORD))
        self.assertEqual(self.change_to(SECOND_PASSWORD).status_code, 400)

    def test_the_password_in_force_is_refused(self):
        response = self.change_to(FIRST_PASSWORD)
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(FIRST_PASSWORD))

    def test_a_password_two_changes_ago_is_refused(self):
        self.assertEqual(self.change_to(SECOND_PASSWORD).status_code, 200)
        self.assertEqual(self.change_to(THIRD_PASSWORD).status_code, 200)
        response = self.change_to(FIRST_PASSWORD)
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(THIRD_PASSWORD))

    def test_four_changes_back_is_still_closed_off(self):
        ladder = [
            SECOND_PASSWORD,
            THIRD_PASSWORD,
            FOURTH_PASSWORD,
            'Windlass$3391',
        ]
        for password in ladder:
            self.assertEqual(self.change_to(password).status_code, 200)
        # Four passwords have been moved off. The one this account opened
        # with is the oldest of them and is still inside the window.
        self.assertEqual(self.change_to(FIRST_PASSWORD).status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Windlass$3391'))

    def test_a_password_far_enough_back_is_forgiven(self):
        ladder = [
            SECOND_PASSWORD,
            THIRD_PASSWORD,
            FOURTH_PASSWORD,
            'Windlass$3391',
            'Capstan%2247',
            'Bollard&8174',
        ]
        for password in ladder:
            self.assertEqual(self.change_to(password).status_code, 200)
        # Six replacements have gone by, so the password this account opened
        # with has dropped off the end and may come round again. The one it
        # moved off last has not.
        self.assertEqual(self.change_to('Capstan%2247').status_code, 400)
        self.assertEqual(self.change_to(FIRST_PASSWORD).status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(FIRST_PASSWORD))

    def test_the_two_pages_share_one_memory(self):
        self.assertEqual(self.change_to(SECOND_PASSWORD).status_code, 200)
        UserPwdRequest.objects.create(
            user_id=self.user.id,
            secret_code=515151,
            call_count=0,
            allowed_by_admin=True,
            created_at=timezone.now(),
            approved_at=timezone.now(),
        )
        form = ForgotPwdStep2Form({
            'formstep': 'step2',
            'username': 'trader',
            'secret_code': '515151',
            'new_password': FIRST_PASSWORD,
            'confirm_password': FIRST_PASSWORD,
        })
        self.assertFalse(form.is_valid())

    def test_one_account_does_not_close_a_password_off_for_another(self):
        self.assertEqual(self.change_to(SECOND_PASSWORD).status_code, 200)
        colleague = User.objects.create_user(
            username=COLLEAGUE,
            password=THIRD_PASSWORD,
        )
        UserAllow.objects.create(
            user_id=colleague.id,
            status=True,
            description='',
            created_at=timezone.now(),
        )
        other_client = Client()
        other_client.force_login(colleague)
        response = other_client.post(
            '/change_password/',
            data=json.dumps({
                'new_password': FIRST_PASSWORD,
                'confirm_password': FIRST_PASSWORD,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        colleague.refresh_from_db()
        self.assertTrue(colleague.check_password(FIRST_PASSWORD))
        # The account that moved off that password still cannot go back to it.
        self.assertEqual(self.change_to(FIRST_PASSWORD).status_code, 400)

    def test_strength_is_checked_as_well_as_reuse(self):
        self.assertEqual(self.change_to('12345').status_code, 400)
        self.assertEqual(self.change_to(FIRST_PASSWORD).status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(FIRST_PASSWORD))
        self.assertEqual(self.change_to(SECOND_PASSWORD).status_code, 200)
