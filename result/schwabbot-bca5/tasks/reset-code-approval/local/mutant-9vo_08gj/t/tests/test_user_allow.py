from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from Users.allow import (
    DEFAULT_ALLOW_WAIT_MESSAGE,
    allow_denial_message,
    is_staff_or_admin,
    user_has_allow_access,
)
from Users.models import UserAllow


class UserAllowHelperTests(TestCase):
    def setUp(self):
        self.regular = User.objects.create_user(username='carol', password='pass12345')
        self.staff = User.objects.create_user(
            username='staff',
            password='pass12345',
            is_staff=True,
        )
        self.admin = User.objects.create_user(
            username='root',
            password='pass12345',
            is_staff=True,
            is_superuser=True,
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

    def test_anonymous_user_has_no_allow_access(self):
        self.assertFalse(user_has_allow_access(None))

    def test_allowed_user_has_access(self):
        self._set_allow(self.regular, True)
        self.assertTrue(user_has_allow_access(self.regular))

    def test_disabled_user_has_no_access(self):
        self._set_allow(self.regular, False, 'paused')
        self.assertFalse(user_has_allow_access(self.regular))

    def test_missing_allow_row_denies_access(self):
        self.assertFalse(user_has_allow_access(self.regular))

    def test_staff_counts_as_admin_for_bypass(self):
        self.assertTrue(is_staff_or_admin(self.staff))

    def test_superuser_counts_as_admin_for_bypass(self):
        self.assertTrue(is_staff_or_admin(self.admin))

    def test_regular_user_is_not_staff_or_admin(self):
        self.assertFalse(is_staff_or_admin(self.regular))

    def test_allow_denial_message_uses_custom_description(self):
        self._set_allow(self.regular, False, 'Custom pause message')
        self.assertEqual(
            allow_denial_message(self.regular),
            'Custom pause message',
        )

    def test_allow_denial_message_falls_back_to_default(self):
        self._set_allow(self.regular, False, '')
        self.assertEqual(
            allow_denial_message(self.regular),
            DEFAULT_ALLOW_WAIT_MESSAGE,
        )
