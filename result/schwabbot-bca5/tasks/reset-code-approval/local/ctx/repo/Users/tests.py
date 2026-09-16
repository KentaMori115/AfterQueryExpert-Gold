from django.test import Client, TestCase
from django.contrib.auth.models import User
from django.utils import timezone

from .models import UserAllow


class UserAllowSessionTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.regular = User.objects.create_user(username='alice', password='pass12345')
        self.admin = User.objects.create_user(
            username='admin',
            password='pass12345',
            is_staff=True,
            is_superuser=True,
        )
        self.staff = User.objects.create_user(
            username='staffer',
            password='pass12345',
            is_staff=True,
            is_superuser=False,
        )

    def _set_allow(self, user, status, description=''):
        UserAllow.objects.update_or_create(
            user_id=user.id,
            defaults={
                'status': status,
                'description': description,
                'created_at': timezone.now(),
            },
        )

    def test_allowed_user_can_use_site(self):
        self._set_allow(self.regular, True)
        self.client.force_login(self.regular)
        resp = self.client.get('/bots/')
        self.assertEqual(resp.status_code, 200)

    def test_disabled_user_with_session_is_kicked_to_login(self):
        self._set_allow(self.regular, True)
        self.client.force_login(self.regular)
        self._set_allow(self.regular, False, 'Account paused')

        resp = self.client.get('/bots/', follow=True)
        self.assertEqual(resp.redirect_chain[0][0], '/accounts/login')
        self.assertContains(resp, 'Account paused')
        self.assertFalse(resp.wsgi_request.user.is_authenticated)

    def test_disabled_user_sees_wait_message_when_description_empty(self):
        self._set_allow(self.regular, True)
        self.client.force_login(self.regular)
        self._set_allow(self.regular, False, '')

        resp = self.client.get('/bots/', follow=True)
        self.assertContains(resp, 'may not yet be enabled by the administrator')

    def test_user_with_no_allow_row_is_kicked(self):
        self.client.force_login(self.regular)
        resp = self.client.get('/bots/', follow=True)
        self.assertEqual(resp.redirect_chain[0][0], '/accounts/login')
        self.assertContains(resp, 'may not yet be enabled by the administrator')

    def test_disabled_user_cannot_start_a_bot(self):
        self._set_allow(self.regular, True)
        self.client.force_login(self.regular)
        self._set_allow(self.regular, False, 'Account paused')

        resp = self.client.post(
            '/bot_onoff/',
            data='{"bot_id": 1, "run_setting": {}}',
            content_type='application/json',
            follow=True,
        )
        self.assertEqual(resp.redirect_chain[0][0], '/accounts/login')
        self.assertContains(resp, 'Account paused')

    def test_superuser_without_allow_row_can_use_site(self):
        self.client.force_login(self.admin)
        resp = self.client.get('/bots/')
        self.assertEqual(resp.status_code, 200)

    def test_staff_without_allow_row_can_use_site(self):
        self.client.force_login(self.staff)
        resp = self.client.get('/bots/')
        self.assertEqual(resp.status_code, 200)

    def test_superuser_with_disabled_allow_row_can_use_site(self):
        self._set_allow(self.admin, False, 'should not apply to admin')
        self.client.force_login(self.admin)
        resp = self.client.get('/bots/')
        self.assertEqual(resp.status_code, 200)

    def test_login_still_refuses_disabled_user(self):
        self._set_allow(self.regular, False, 'Not enabled yet')
        resp = self.client.post(
            '/accounts/login/',
            {'username': 'alice', 'password': 'pass12345'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, 'Not enabled yet')
        self.assertFalse(resp.wsgi_request.user.is_authenticated)

    def test_login_still_accepts_allowed_user(self):
        self._set_allow(self.regular, True)
        resp = self.client.post(
            '/accounts/login/',
            {'username': 'alice', 'password': 'pass12345'},
        )
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp.url, '/')
