"""The forgot-password page, once the secret code means something.

Everything here goes through the two form classes the page already used and
through the row the admin approval page already showed, so a build is free to
arrange its own internals as long as the request behaves.
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.utils import timezone

from Users.forms import ForgotPwdStep1Form, ForgotPwdStep2Form
from Users.models import UserPwdRequest


TRADER = 'trader'
STRANGER = 'stranger'
COLLEAGUE = 'colleague'

GOOD_PASSWORD = 'Kestrel!9412'
OTHER_PASSWORD = 'Marlin?7731'
START_PASSWORD = 'Halyard#5508'


class ResetRequestTestCase(TestCase):
    """Shared scaffolding: one user, and a request row built to order."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='trader',
            password=START_PASSWORD,
        )

    def make_request(self, code=424242, count=0, allowed=False,
                     approved_at=None, created_at=None):
        return UserPwdRequest.objects.create(
            user_id=self.user.id,
            secret_code=code,
            call_count=count,
            allowed_by_admin=allowed,
            created_at=created_at if created_at is not None else timezone.now(),
            approved_at=approved_at,
        )

    def row(self):
        return UserPwdRequest.objects.get(user_id=self.user.id)

    def step1(self, username='trader'):
        return ForgotPwdStep1Form({'formstep': 'step1', 'username': username})

    def step2(self, code, new_password=GOOD_PASSWORD, confirm=None,
              username='trader'):
        return ForgotPwdStep2Form({
            'formstep': 'step2',
            'username': username,
            'secret_code': code,
            'new_password': new_password,
            'confirm_password': new_password if confirm is None else confirm,
        })

    def password_still_start(self):
        self.user.refresh_from_db()
        return self.user.check_password(START_PASSWORD)


class StepOneQueueTests(ResetRequestTestCase):
    def test_first_visit_queues_an_unapproved_request(self):
        form = self.step1()
        self.assertFalse(form.is_valid())
        row = self.row()
        self.assertFalse(row.allowed_by_admin)
        self.assertEqual(row.call_count, 0)
        self.assertIsNone(row.approved_at)
        self.assertTrue(100000 <= row.secret_code <= 999999)

    def test_revisiting_does_not_reissue(self):
        first = self.make_request(code=515151, count=0)
        form = self.step1()
        self.assertFalse(form.is_valid())
        row = self.row()
        self.assertEqual(row.id, first.id)
        self.assertEqual(row.secret_code, 515151)
        self.assertEqual(row.call_count, 0)
        self.assertIsNone(row.approved_at)
        self.assertFalse(row.allowed_by_admin)

    def test_step_one_passes_once_the_request_is_approved(self):
        self.make_request(code=515151, allowed=True)
        self.assertTrue(self.step1().is_valid())

    def test_step_one_stamps_the_approval_it_finds(self):
        self.make_request(code=515151, allowed=True)
        before = timezone.now()
        self.step1().is_valid()
        row = self.row()
        self.assertIsNotNone(row.approved_at)
        self.assertGreaterEqual(row.approved_at, before)
        self.assertLessEqual(row.approved_at, timezone.now())

    def test_step_one_keeps_a_stamp_it_did_not_write(self):
        stamped = timezone.now() - timedelta(minutes=3)
        self.make_request(code=515151, allowed=True, approved_at=stamped)
        self.step1().is_valid()
        self.assertEqual(self.row().approved_at, stamped)

    def test_step_one_restarts_an_approval_that_ran_out(self):
        self.make_request(
            code=515151,
            count=2,
            allowed=True,
            approved_at=timezone.now() - timedelta(days=30),
        )
        form = self.step1()
        self.assertFalse(form.is_valid())
        row = self.row()
        self.assertFalse(row.allowed_by_admin)
        self.assertEqual(row.call_count, 0)
        self.assertIsNone(row.approved_at)
        self.assertNotEqual(row.secret_code, 515151)

    def test_step_one_restarts_a_request_nobody_approved_in_time(self):
        stale = timezone.now() - timedelta(days=30)
        self.make_request(code=515151, created_at=stale)
        self.assertFalse(self.step1().is_valid())
        row = self.row()
        self.assertNotEqual(row.secret_code, 515151)
        self.assertGreater(row.created_at, stale)
        self.assertFalse(row.allowed_by_admin)


class StepTwoCodeTests(ResetRequestTestCase):
    def test_right_code_changes_the_password_and_clears_the_request(self):
        self.make_request(code=515151, allowed=True)
        client = Client()
        response = client.post('/accounts/forgot_password/', {
            'formstep': 'step2',
            'username': 'trader',
            'secret_code': '515151',
            'new_password': GOOD_PASSWORD,
            'confirm_password': GOOD_PASSWORD,
        })
        self.assertEqual(response.status_code, 302)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(GOOD_PASSWORD))
        self.assertEqual(UserPwdRequest.objects.filter(user_id=self.user.id).count(), 0)

    def test_wrong_code_is_refused_and_charged(self):
        self.make_request(code=515151, allowed=True)
        client = Client()
        response = client.post('/accounts/forgot_password/', {
            'formstep': 'step2',
            'username': 'trader',
            'secret_code': '111111',
            'new_password': GOOD_PASSWORD,
            'confirm_password': GOOD_PASSWORD,
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.password_still_start())
        row = self.row()
        self.assertEqual(row.call_count, 1)
        self.assertEqual(row.secret_code, 515151)
        self.assertTrue(row.allowed_by_admin)

    def test_two_wrong_codes_leave_the_approval_standing(self):
        self.make_request(code=515151, allowed=True)
        self.assertFalse(self.step2('111111').is_valid())
        self.assertFalse(self.step2('222222').is_valid())
        row = self.row()
        self.assertEqual(row.call_count, 2)
        self.assertTrue(row.allowed_by_admin)
        self.assertEqual(row.secret_code, 515151)

    def test_budget_ends_on_the_final_miss(self):
        # Made a while back, approved just now, so the deadline is nowhere
        # near and the budget is the only thing that can end this.
        made = timezone.now() - timedelta(hours=2)
        self.make_request(code=515151, count=2, allowed=True,
                          approved_at=timezone.now(), created_at=made)
        self.assertFalse(self.step2('111111').is_valid())
        row = self.row()
        self.assertEqual(row.call_count, 0)
        self.assertFalse(row.allowed_by_admin)
        self.assertIsNone(row.approved_at)
        self.assertNotEqual(row.secret_code, 515151)
        self.assertTrue(100000 <= row.secret_code <= 999999)
        self.assertGreater(row.created_at, made)

    def test_misses_accumulate_across_submissions(self):
        # The budget is spent for real rather than seeded, so a build that
        # reads the count fresh on every submission cannot ride through.
        made = timezone.now() - timedelta(hours=2)
        self.make_request(code=515151, allowed=True, created_at=made)
        self.assertFalse(self.step2('111111').is_valid())
        self.assertFalse(self.step2('222222').is_valid())
        self.assertTrue(self.row().allowed_by_admin)
        self.assertFalse(self.step2('333333').is_valid())
        row = self.row()
        self.assertFalse(row.allowed_by_admin)
        self.assertEqual(row.call_count, 0)
        self.assertIsNone(row.approved_at)
        self.assertNotEqual(row.secret_code, 515151)
        self.assertGreater(row.created_at, made)
        self.assertTrue(self.password_still_start())

    def test_wrong_code_is_charged_before_the_passwords_are_read(self):
        self.make_request(code=515151, allowed=True)
        form = self.step2('111111', new_password=GOOD_PASSWORD,
                          confirm=OTHER_PASSWORD)
        self.assertFalse(form.is_valid())
        self.assertEqual(self.row().call_count, 1)

    def test_right_code_with_mismatched_passwords_costs_nothing(self):
        self.make_request(code=515151, allowed=True)
        form = self.step2('515151', new_password=GOOD_PASSWORD,
                          confirm=OTHER_PASSWORD)
        self.assertFalse(form.is_valid())
        self.assertTrue(self.password_still_start())
        row = self.row()
        self.assertEqual(row.call_count, 0)
        self.assertTrue(row.allowed_by_admin)

    def test_right_code_with_a_weak_password_costs_nothing(self):
        self.make_request(code=515151, allowed=True)
        self.assertFalse(self.step2('515151', new_password='123').is_valid())
        self.assertTrue(self.password_still_start())
        self.assertEqual(self.row().call_count, 0)

    def test_step_two_will_not_take_a_missing_code(self):
        self.make_request(code=515151, allowed=True)
        form = ForgotPwdStep2Form({
            'formstep': 'step2',
            'username': TRADER,
            'new_password': GOOD_PASSWORD,
            'confirm_password': GOOD_PASSWORD,
        })
        self.assertFalse(form.is_valid())
        self.assertIn('secret_code', form.errors)
        self.assertTrue(self.password_still_start())

    def test_the_code_box_reaches_the_second_step_form(self):
        self.make_request(code=515151, allowed=True)
        client = Client()
        response = client.post('/accounts/forgot_password/', {
            'formstep': 'step1',
            'username': TRADER,
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn('name="secret_code"', response.content.decode())

    def test_letters_count_as_a_miss(self):
        self.make_request(code=515151, allowed=True)
        self.assertFalse(self.step2('five one five').is_valid())
        row = self.row()
        self.assertEqual(row.call_count, 1)
        self.assertEqual(row.secret_code, 515151)


class StepTwoGateTests(ResetRequestTestCase):
    def test_step_two_refuses_while_the_request_is_queued(self):
        self.make_request(code=515151)
        self.assertFalse(self.step2('515151').is_valid())
        self.assertTrue(self.password_still_start())
        row = self.row()
        self.assertEqual(row.call_count, 0)
        self.assertEqual(row.secret_code, 515151)

    def test_step_two_refuses_with_no_request_at_all(self):
        self.assertFalse(self.step2('515151').is_valid())
        self.assertTrue(self.password_still_start())
        # Step one is where an account with nothing queued has to start, and
        # what it queues is not approved and carries no approval time.
        self.assertFalse(self.step1().is_valid())
        row = self.row()
        self.assertIsNone(row.approved_at)
        self.assertFalse(row.allowed_by_admin)

    def test_a_request_belonging_to_someone_else_is_no_help(self):
        stranger = User.objects.create_user(
            username=STRANGER,
            password=START_PASSWORD,
        )
        UserPwdRequest.objects.create(
            user_id=stranger.id,
            secret_code=515151,
            call_count=0,
            allowed_by_admin=True,
            created_at=timezone.now(),
            approved_at=timezone.now(),
        )
        self.assertFalse(self.step2('515151').is_valid())
        self.assertTrue(self.password_still_start())
        self.assertEqual(
            UserPwdRequest.objects.get(user_id=stranger.id).call_count,
            0,
        )

    def test_a_wrong_code_does_not_move_the_deadline(self):
        approved = timezone.now()
        self.make_request(code=515151, allowed=True, approved_at=approved)
        before = self.row().code_deadline()
        self.assertFalse(self.step2('111111').is_valid())
        row = self.row()
        self.assertEqual(row.approved_at, approved)
        self.assertEqual(row.code_deadline(), before)

    def test_a_restarted_request_gets_a_deadline_of_its_own(self):
        stale = timezone.now() - timedelta(days=30)
        self.make_request(code=515151, created_at=stale)
        old_deadline = self.row().code_deadline()
        self.assertFalse(self.step1().is_valid())
        self.assertGreater(self.row().code_deadline(), old_deadline)

    def test_a_completed_reset_leaves_other_requests_standing(self):
        other = User.objects.create_user(
            username=COLLEAGUE,
            password=START_PASSWORD,
        )
        UserPwdRequest.objects.create(
            user_id=other.id,
            secret_code=626262,
            call_count=1,
            allowed_by_admin=True,
            created_at=timezone.now(),
            approved_at=timezone.now(),
        )
        self.make_request(code=515151, allowed=True)
        client = Client()
        client.post('/accounts/forgot_password/', {
            'formstep': 'step2',
            'username': 'trader',
            'secret_code': '515151',
            'new_password': GOOD_PASSWORD,
            'confirm_password': GOOD_PASSWORD,
        })
        self.assertEqual(
            UserPwdRequest.objects.filter(user_id=self.user.id).count(),
            0,
        )
        survivor = UserPwdRequest.objects.get(user_id=other.id)
        self.assertEqual(survivor.call_count, 1)
        self.assertTrue(survivor.allowed_by_admin)

    def test_step_two_restarts_an_approval_that_ran_out(self):
        self.make_request(
            code=515151,
            allowed=True,
            approved_at=timezone.now() - timedelta(days=30),
        )
        self.assertFalse(self.step2('515151').is_valid())
        self.assertTrue(self.password_still_start())
        row = self.row()
        self.assertFalse(row.allowed_by_admin)
        self.assertIsNone(row.approved_at)
        self.assertEqual(row.call_count, 0)
        self.assertNotEqual(row.secret_code, 515151)

    def test_step_two_stamps_an_approval_it_is_the_first_to_see(self):
        self.make_request(code=515151, allowed=True)
        self.assertFalse(self.step2('111111').is_valid())
        self.assertIsNotNone(self.row().approved_at)

    def test_withdrawal_kills_a_live_code(self):
        self.make_request(code=515151, allowed=True)
        self.assertTrue(self.step1().is_valid())
        UserPwdRequest.objects.filter(user_id=self.user.id).update(
            allowed_by_admin=False,
        )
        self.assertFalse(self.step2('515151').is_valid())
        self.assertTrue(self.password_still_start())
        row = self.row()
        self.assertIsNone(row.approved_at)
        self.assertEqual(row.call_count, 0)
        self.assertNotEqual(row.secret_code, 515151)

    def test_first_step_also_sees_a_withdrawal(self):
        made = timezone.now() - timedelta(hours=2)
        self.make_request(code=515151, allowed=True, created_at=made)
        self.assertTrue(self.step1().is_valid())
        UserPwdRequest.objects.filter(user_id=self.user.id).update(
            allowed_by_admin=False,
        )
        self.assertFalse(self.step1().is_valid())
        row = self.row()
        self.assertIsNone(row.approved_at)
        self.assertNotEqual(row.secret_code, 515151)
        self.assertGreater(row.created_at, made)

    def test_reapproval_allows_a_single_miss(self):
        self.make_request(code=515151, allowed=True)
        # First approval, seen here, and worth the full budget.
        self.assertFalse(self.step2('111111').is_valid())
        self.assertFalse(self.step2('222222').is_valid())
        self.assertTrue(self.row().allowed_by_admin)
        self.assertFalse(self.step2('333333').is_valid())
        self.assertFalse(self.row().allowed_by_admin)

        reissued = self.row().secret_code
        UserPwdRequest.objects.filter(user_id=self.user.id).update(
            allowed_by_admin=True,
        )
        # Second approval. One wrong code is the whole of it.
        self.assertFalse(self.step2('444444').is_valid())
        row = self.row()
        self.assertFalse(row.allowed_by_admin)
        self.assertEqual(row.call_count, 0)
        self.assertNotEqual(row.secret_code, reissued)

    def test_reapproval_still_honours_its_code(self):
        self.make_request(code=515151, allowed=True)
        self.assertFalse(self.step2('111111').is_valid())
        self.assertFalse(self.step2('222222').is_valid())
        self.assertFalse(self.step2('333333').is_valid())
        reissued = self.row().secret_code
        UserPwdRequest.objects.filter(user_id=self.user.id).update(
            allowed_by_admin=True,
        )
        self.assertTrue(self.step2(str(reissued)).is_valid())

    def test_re_approval_after_a_spent_request_opens_a_new_window(self):
        self.make_request(code=515151, count=2, allowed=True,
                          approved_at=timezone.now())
        self.assertFalse(self.step2('111111').is_valid())
        reissued = self.row().secret_code
        UserPwdRequest.objects.filter(user_id=self.user.id).update(
            allowed_by_admin=True,
        )
        self.assertTrue(self.step2(str(reissued)).is_valid())
        row = self.row()
        self.assertIsNotNone(row.approved_at)
        self.assertEqual(row.call_count, 0)
