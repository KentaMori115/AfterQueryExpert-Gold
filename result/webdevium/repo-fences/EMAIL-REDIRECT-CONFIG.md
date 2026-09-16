# Email Confirmation Redirect Configuration

## Problem
When users click "Confirm Your Email" in the confirmation email, the redirect URL might be hardcoded to `http://localhost:3000` instead of using the current URL.

## Solution

### 1. ✅ Code Update (Already Done)
The signup code now passes `emailRedirectTo` dynamically:
- File: `app/signup/page.tsx`
- The `emailRedirectTo` is set to `${window.location.origin}/auth/callback`

### 2. ⚠️ Supabase Dashboard Configuration (Required)

You need to configure allowed redirect URLs in your Supabase dashboard:

1. **Go to Supabase Dashboard**
   - Navigate to your project
   - Go to **Authentication** → **URL Configuration**

2. **Add Allowed Redirect URLs**
   Add these URLs to the "Redirect URLs" list:
   - `http://localhost:3000/auth/callback` (for local development)
   - `https://your-domain.com/auth/callback` (for production)
   - Any other URLs you want to allow

3. **Set Site URL**
   - In the same section, set **"Site URL"** to:
     - For development: `http://localhost:3000`
     - For production: `https://your-domain.com`

### 3. 📧 Email Template

The email template (`supabase/email-templates/confirm-signup.html`) uses `{{ .ConfirmationURL }}` which should automatically include the correct `redirect_to` parameter if:
- `emailRedirectTo` is passed during signup (✅ done)
- The redirect URL is in the allowed list (⚠️ you need to configure this)

### 4. 🔍 How to Verify

1. **Test the signup flow:**
   - Sign up with a test email
   - Check the confirmation email
   - The confirmation URL should look like:
     ```
     https://your-project.supabase.co/auth/v1/verify?token=...&type=signup&redirect_to=http://localhost:3000/auth/callback
     ```

2. **Click the confirmation link:**
   - It should redirect to `/auth/callback`
   - Then automatically redirect to the appropriate dashboard based on user role

### 5. 🚨 Troubleshooting

**If the redirect URL is still wrong:**

1. **Check Supabase Dashboard Settings:**
   - Go to **Authentication** → **URL Configuration**
   - Verify the redirect URL is in the allowed list
   - Verify the Site URL is set correctly

2. **Check the confirmation email:**
   - Look at the actual URL in the email
   - Check if `redirect_to` parameter is correct

3. **Verify the signup code:**
   - Ensure `emailRedirectTo` is being passed correctly
   - Check browser console for any errors

4. **For production:**
   - Make sure to add your production URL to the allowed redirect URLs
   - Update the Site URL to your production domain

### 6. 📝 Additional Notes

- **Local Development:** Use `http://localhost:3000/auth/callback`
- **Production:** Use `https://your-domain.com/auth/callback`
- **Multiple Environments:** Add all URLs you'll use (dev, staging, production)

The `{{ .ConfirmationURL }}` variable in Supabase email templates automatically constructs the full URL including the `redirect_to` parameter based on the `emailRedirectTo` option passed during signup, **BUT** the redirect URL must be in the allowed list in Supabase dashboard for security reasons.

