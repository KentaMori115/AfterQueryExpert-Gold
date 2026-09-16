# Beautiful Email Templates for Supabase

This folder contains professionally designed email templates for your Webdevium dashboard.

## 📧 Templates Included

1. **confirm-signup.html** - Email confirmation when users sign up
2. **magic-link.html** - Passwordless login email
3. **reset-password.html** - Password reset email

## 🎨 Design Features

- ✅ Beautiful gradient header (purple to indigo)
- ✅ Responsive design (mobile-friendly)
- ✅ Clear call-to-action buttons
- ✅ Alternative text links (for email clients that block buttons)
- ✅ Security warnings and tips
- ✅ Professional footer with branding
- ✅ Info/warning boxes for important messages
- ✅ Modern, clean design matching your dashboard

## 📋 How to Apply These Templates

### Method 1: Via Supabase Dashboard (Easiest)

#### For Confirm Signup Email:

1. Go to your **Supabase Dashboard**
2. Navigate to **Authentication** → **Email Templates**
3. Select **"Confirm signup"** from the dropdown
4. Open `confirm-signup.html` in a text editor
5. **Copy all the HTML code**
6. **Paste it** into the "Message Body (HTML)" section in Supabase
7. Click **"Save"**

#### For Magic Link Email:

1. In the same **Email Templates** section
2. Select **"Magic Link"** from the dropdown
3. Copy the contents of `magic-link.html`
4. Paste into the "Message Body (HTML)" section
5. Click **"Save"**

#### For Reset Password Email:

1. In the same **Email Templates** section
2. Select **"Reset Password"** from the dropdown
3. Copy the contents of `reset-password.html`
4. Paste into the "Message Body (HTML)" section
5. Click **"Save"**

---

## 🔧 Customization

You can customize these templates by editing the HTML files:

### Change the Brand Name:
Replace `Webdevium` with your brand name throughout the template.

### Change Colors:
The main gradient colors are defined in the header:
```css
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
```
Change `#667eea` and `#764ba2` to your brand colors.

### Change the Logo:
Replace the text logo in the header with your own logo image:
```html
<a href="{{ .SiteURL }}" class="logo">Webdevium</a>
```
Becomes:
```html
<a href="{{ .SiteURL }}">
  <img src="YOUR_LOGO_URL" alt="Your Brand" style="height: 40px;">
</a>
```

### Change Contact Email:
Replace `support@webdevium.com` with your actual support email.

---

## 📝 Template Variables

Supabase automatically replaces these variables:

- `{{ .SiteURL }}` - Your site URL
- `{{ .ConfirmationURL }}` - The confirmation/action link
- `{{ .Token }}` - The confirmation token (if needed)
- `{{ .TokenHash }}` - Hashed token (if needed)
- `{{ .Email }}` - User's email address

**Do not remove these variables!** They're required for the emails to work properly.

---

## ✅ Testing Your Email Templates

### Test Before Going Live:

1. After applying the templates, test them by:
   - Creating a new test account
   - Requesting a password reset
   - Checking how the email looks on:
     - Gmail
     - Outlook
     - Mobile devices

### Using Supabase Test Email Feature:

1. Go to **Authentication** → **Email Templates**
2. Click **"Send test email"** button
3. Enter your email address
4. Check your inbox to see how it looks

---

## 🎯 Preview

### Confirm Signup Email:
- Beautiful purple gradient header
- "Welcome to Webdevium!" greeting
- Large "Confirm Your Email" button
- Security tips
- List of features they'll get access to

### Magic Link Email:
- Same beautiful header
- "Sign In to Your Account" message
- "Sign In Now" button
- 60-minute expiration warning

### Reset Password Email:
- Consistent branding
- "Reset Your Password" message
- Security recommendations
- Warning about ignoring suspicious requests

---

## 🚀 Production Tips

1. **Always test emails** before enabling email confirmation in production
2. **Check spam folders** - make sure your emails aren't being filtered
3. **Enable SPF/DKIM** in Supabase for better deliverability
4. **Use a custom domain** for sending emails (optional but recommended)

---

## 📱 Mobile Responsiveness

These templates are fully responsive and will look great on:
- Desktop email clients
- Mobile devices (iOS Mail, Gmail app, etc.)
- Web-based email clients

The buttons automatically resize to full-width on mobile screens.

---

## 🎨 Brand Colors Reference

Current colors used:
- Primary gradient: `#667eea` to `#764ba2`
- Success: `#10b981` (green)
- Warning: `#f59e0b` (amber)
- Info: `#3b82f6` (blue)
- Text: `#1f2937` (dark gray)
- Secondary text: `#6b7280` (gray)

---

## 📞 Support

Need help customizing? The templates are standard HTML/CSS, so any web developer can help modify them.

Common customizations:
- Adding your logo
- Changing colors
- Adding social media links
- Adding additional content sections
- Translating to other languages

---

**Your emails will now look professional and on-brand! 🎉**

