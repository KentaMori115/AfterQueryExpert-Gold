from django.shortcuts import render, redirect
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth.models import User

from django.template import loader
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from django.views.decorators.csrf import csrf_exempt

from .forms import RegisterForm, LoginForm, ForgotPwdStep1Form, ForgotPwdStep2Form
from .models import UserAllow, UserPwdRequest
from .allow import ALLOW_ERROR_SESSION_KEY

import random
import json

# Registration View
def register_view(request):
    if request.method == 'POST':
        form = RegisterForm(request.POST)
        if form.is_valid():
            user = form.save()
            print(f"{user} is registering")
            #user.is_active = False
            user.is_active = True
            user.save()
            #login(request, user)  # Log in the user after registration
            return redirect('/accounts/login')
    else:
        form = RegisterForm()
    return render(request, 'users/register.html', {'form': form})

# Login View
def login_view(request):
    if request.method == 'POST':
        form = LoginForm(data=request.POST)
        if form.is_valid():
            user = form.get_user()
            
            #check active of the user
            user_allow_obj = None
            try:
                user_allow_obj = UserAllow.objects.get(user_id = user.id)
            except:
                pass
            
            if user_allow_obj is not None and user_allow_obj.status == True:
                login(request, user)
                #return redirect('/bots')
                return redirect('/')
            
            allow_error_message = "Please note that your login may not yet be enabled by the administrator, and in some cases, it can take 24-48 hours for Schwab's API to fully connect."
            if user_allow_obj is not None and user_allow_obj.description != '':
                allow_error_message = user_allow_obj.description
            form.add_error(None, allow_error_message)
    else:
        form = LoginForm()
        form.errors.clear()
        allow_error_message = request.session.pop(ALLOW_ERROR_SESSION_KEY, None)
        if allow_error_message:
            # Unbound GET form has no cleaned_data; add_error needs it.
            form.cleaned_data = {}
            form.add_error(None, allow_error_message)
    return render(request, 'users/login.html', {'form': form})

# Logout View
@login_required
def logout_view(request):
    logout(request)
    return redirect('/accounts/login')


# Login View
def forgot_password_view(request):
    template = loader.get_template('users/forgot_password.html')
    context = {}


    if request.method == 'POST':
        step = request.POST.get('formstep')
        if step == 'step1':
            form1 = ForgotPwdStep1Form(request.POST)
            if form1.is_valid():
                context['button_content'] = 'Submit'
                context['form'] = ForgotPwdStep2Form
                return HttpResponse(template.render(context, request))
            else:
                context['button_content'] = form1.cleaned_data['button_content']
                context['form'] = form1
                return HttpResponse(template.render(context, request))
        elif step == 'step2':
            form2 = ForgotPwdStep2Form(request.POST)
            if form2.is_valid():
                username = form2.cleaned_data['username']
                new_password = form2.cleaned_data['new_password']
                user = User.objects.filter(username = username).first()
                user.set_password(new_password)
                user.save()
                UserPwdRequest.objects.filter(user_id = user.id).delete()
                return redirect('/accounts/login')
            else:
                context['form'] = form2
                context['button_content'] = 'Submit'
                return HttpResponse(template.render(context, request))

    else:
        context['form'] = ForgotPwdStep1Form
        context['button_content'] = 'Submit Your User Name'
    return HttpResponse(template.render(context, request))
