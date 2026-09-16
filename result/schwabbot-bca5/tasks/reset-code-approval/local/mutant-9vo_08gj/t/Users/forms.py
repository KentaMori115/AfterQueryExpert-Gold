from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password

from django.core.validators import RegexValidator
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError

from django import forms

from django.utils import timezone

from . import pwdhistory
from . import resetcodes
from .models import UserPwdRequest  # noqa: F401  (kept for callers importing it from here)

# Registration Form
class RegisterForm(UserCreationForm):
    username = forms.CharField(
        label="Username",
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Enter your username',
        }),
        validators=[
            RegexValidator(
                regex='^[a-zA-Z0-9_]*$',  # Only letters, numbers, and underscores
                message='Username can only contain letters, numbers, and underscores',
                code='invalid_username'
            )
        ]
    )

    email = forms.EmailField(
        required=True,
        widget=forms.EmailInput(attrs={
            'class': 'form-control',  # Add your CSS class
            'placeholder': 'Enter your email',
        })
    )
    password1 = forms.CharField(
        label="Password",
        widget=forms.PasswordInput(attrs={'class': 'form-control', 'placeholder': 'Enter your password'}),
        required=True,
    )
    password2 = forms.CharField(
        label="Confirm Password",
        widget=forms.PasswordInput(attrs={'class': 'form-control', 'placeholder': 'Confirm your password'}),
        required=True,
    )


    class Meta:
        model = User
        fields = ['username', 'email', 'password1', 'password2']


# Login Form
class LoginForm(AuthenticationForm):
    username = forms.CharField(
        max_length=150,
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Username',
        })
    )
    password = forms.CharField(
        widget=forms.PasswordInput(attrs={
            'class': 'form-control',
            'placeholder': 'Password',
        })
    )



class ForgotPwdStep1Form(forms.Form):
    formstep = forms.CharField(
        initial='step1',
        widget=forms.HiddenInput(),
        required=True
    )
    username = forms.CharField(
        label="Username",
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Enter your username',
        }),
        validators=[
            RegexValidator(
                regex='^[a-zA-Z0-9_]*$',  # Only letters, numbers, and underscores
                message='Username can only contain letters, numbers, and underscores',
                code='invalid_username'
            )
        ]
    )


    def clean(self):
        cleaned_data = super().clean()
        cleaned_data['button_content'] = 'Submit Your User Name'

        username = cleaned_data['username']
        if not User.objects.filter(username=username).exists():
            raise ValidationError("The user name is invalid")

        cleaned_data['button_content'] = 'Submit Checking Allow'
        #check allow
        user_obj = User.objects.filter(username = username).first()
        user_allow_obj = resetcodes.get_request(user_obj.id)
        if user_allow_obj is None:
            resetcodes.start_request(user_obj.id)
            raise ValidationError(resetcodes.REQUEST_SENT_MESSAGE)

        # A request that is still in the queue is left exactly as it is. The
        # administrator may already be reading its code out, and a second
        # visit to this page must not change what they are reading.
        state = resetcodes.evaluate(user_allow_obj)
        if state in (resetcodes.EXPIRED, resetcodes.WITHDRAWN):
            raise ValidationError(resetcodes.EXPIRED_MESSAGE)
        if state != resetcodes.OPEN:
            raise ValidationError(resetcodes.REQUEST_PENDING_MESSAGE)
        return cleaned_data


class ForgotPwdStep2Form(forms.Form):
    formstep = forms.CharField(
        initial='step2',
        widget=forms.HiddenInput(),
        required=True
    )

    username = forms.CharField(
        label="Username",
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Enter your username',
        }),
        validators=[
            RegexValidator(
                regex='^[a-zA-Z0-9_]*$',  # Only letters, numbers, and underscores
                message='Username can only contain letters, numbers, and underscores',
                code='invalid_username'
            )
        ]
    )

    secret_code = forms.CharField(
        label="Secret Code",
        widget=forms.TextInput(attrs={
            'class': 'form-control',
            'placeholder': 'Enter the code the administrator gave you',
        }),
        required=True,
    )

    new_password = forms.CharField(
        label="Password",
        widget=forms.PasswordInput(attrs={'class': 'form-control', 'placeholder': 'Enter your password'}),
        required=True,
    )

    confirm_password = forms.CharField(
        label="Password",
        widget=forms.PasswordInput(attrs={'class': 'form-control', 'placeholder': 'Confirm your password'}),
        required=True,
    )


    def clean(self):
        """Decide whether this submission may change a password.

        The order matters. Whether the request is usable at all is settled
        before the code is looked at, and the code is settled before the two
        password boxes are read, so a wrong code costs an attempt whatever
        was typed underneath it and a right code never costs one.
        """
        cleaned_data = super().clean()

        username = cleaned_data['username']
        if not User.objects.filter(username=username).exists():
            raise ValidationError("The user name is invalid")

        #check allow
        user_obj = User.objects.filter(username = username).first()
        user_allow_obj = resetcodes.get_request(user_obj.id)
        if user_allow_obj is None:
            raise ValidationError(resetcodes.NO_REQUEST_MESSAGE)

        state = resetcodes.evaluate(user_allow_obj)
        if state in (resetcodes.EXPIRED, resetcodes.WITHDRAWN):
            raise ValidationError(resetcodes.EXPIRED_MESSAGE)
        if state != resetcodes.OPEN:
            raise ValidationError(resetcodes.WAIT_FOR_ADMIN_MESSAGE)

        # The code, before anything about the password is reported. An
        # approval is worth a fixed number of wrong ones; the last of them
        # sends the request back to the administrator behind a new code.
        if not resetcodes.code_matches(user_allow_obj, cleaned_data.get('secret_code')):
            if resetcodes.register_failed_attempt(user_allow_obj):
                raise ValidationError(resetcodes.SPENT_MESSAGE)
            raise ValidationError(resetcodes.WRONG_CODE_MESSAGE)

        # Password matching
        new_password = cleaned_data.get("new_password")
        confirm_password = cleaned_data.get("confirm_password")
        if new_password and confirm_password and new_password != confirm_password:
            raise ValidationError("Passwords don't match")

        try:
            validate_password(new_password)
        except ValidationError as e:
            raise ValidationError(e.messages)

        # Last of the password rules: a password the account has had lately
        # is refused even though it is strong enough, so a lost password
        # cannot simply be set again.
        if pwdhistory.is_reused(user_obj, new_password):
            raise ValidationError(pwdhistory.REUSED_MESSAGE)

        return cleaned_data
