from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password

from django.core.validators import RegexValidator
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError

from django import forms

from django.utils import timezone

from .models import UserPwdRequest
import random

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
        user_allow_obj = UserPwdRequest.objects.filter(user_id = user_obj.id).first()
        if user_allow_obj is None:
            secret_code = random.randint(100000, 999999)
            UserPwdRequest.objects.create(user_id = user_obj.id, secret_code = secret_code, call_count = 0, allowed_by_admin = False, created_at = timezone.now())
            raise ValidationError("Password Change Request was just sent\n. Please wait for the administrator to allow you change the password.")
        else:
            if user_allow_obj.allowed_by_admin == False:
                raise ValidationError("Password Change Request was already sent\n. Please wait for the administrator to allow you change the password.")
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
        cleaned_data = super().clean()

        username = cleaned_data['username']
        if not User.objects.filter(username=username).exists():
            raise ValidationError("The user name is invalid")

        # Password matching
        username = cleaned_data.get('username')
        new_password = cleaned_data.get("new_password")
        confirm_password = cleaned_data.get("confirm_password")
        if new_password and confirm_password and new_password != confirm_password:
            raise ValidationError("Passwords don't match")



        try:
            validate_password(new_password)
        except ValidationError as e:
            raise ValidationError(e.messages)


        #check allow
        user_obj = User.objects.filter(username = username).first()
        user_allow_obj = UserPwdRequest.objects.filter(user_id = user_obj.id).first()
        if user_allow_obj is None:
            raise ValidationError("Please request for changing the password")
        else:
            if user_allow_obj.allowed_by_admin == False:
                raise ValidationError("Please wait for the administrator to allow you change the password.")


        return cleaned_data
