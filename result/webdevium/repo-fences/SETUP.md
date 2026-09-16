# Webdevium Dashboard - Setup Guide

Complete setup guide to get the dashboard running with authentication and database.

---

## Prerequisites

- Node.js 20+ installed
- A Supabase account (free tier: https://supabase.com)
- Git (optional, for version control)

---

## Step 1: Install Dependencies

```bash
npm install
```

---

## Step 2: Set Up Supabase Project

### 2.1 Create a Supabase Project

1. Go to https://supabase.com and sign in
2. Click "New Project"
3. Fill in:
   - **Name**: webdevium-dashboard (or your choice)
   - **Database Password**: (save this somewhere safe)
   - **Region**: Choose closest to your users
4. Click "Create new project" and wait ~2 minutes

### 2.2 Get Your Supabase Credentials

1. Go to **Project Settings** (gear icon) → **API**
2. Copy these values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (starts with `eyJ...`)
   - **service_role** key (starts with `eyJ...`) - keep this secret!

---

## Step 3: Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_project_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Stripe Configuration (optional for now)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Cron Job Security (optional)
CRON_SECRET=any_random_string_here
```

**Replace the placeholders with your actual values from Step 2.2**

---

## Step 4: Set Up Database Schema

### 4.1 Run the Schema

1. Go to your Supabase Dashboard
2. Click **SQL Editor** (in the left sidebar)
3. Open the file `supabase/schema.sql` in your code editor
4. **Copy all contents** of the file
5. **Paste into the SQL Editor** in Supabase
6. Click **"Run"**
7. You should see: "Success. No rows returned"

This creates all tables, functions, views, and security policies.

### 4.2 (Optional) Add Test Data

1. Open the file `supabase/seed.sql`
2. Copy all contents
3. Paste into the SQL Editor in Supabase
4. Click "Run"

This creates sample clients and tasks for testing.

---

## Step 5: Create Test Users

Since Supabase handles authentication, you need to create users through their Auth system:

### Method 1: Via Supabase Dashboard (Easiest)

1. Go to **Authentication** → **Users** in Supabase Dashboard
2. Click **"Add user"** → **"Create new user"**
3. Enter:
   - **Email**: `client1@example.com`
   - **Password**: `password123` (or your choice)
   - **Auto Confirm**: ✅ (check this)
4. Click **"Create user"**
5. Repeat for other test users if needed

### Method 2: Via Signup Page (Recommended for Testing)

Once the app is running, you can sign up normally through the UI.

---

## Step 6: Enable Email Confirmation (Optional)

By default, Supabase requires email confirmation. For development:

1. Go to **Authentication** → **Providers** → **Email**
2. Scroll to **"Email Confirmation"**
3. **Disable** "Enable email confirmations"
4. Click **Save**

This allows you to test login immediately without confirming emails.

---

## Step 7: Run the Application

```bash
npm run dev
```

The app will start at **http://localhost:3000**

---

## Step 8: Test the Authentication Flow

1. Open http://localhost:3000
2. You'll be redirected to `/login`
3. Sign in with the credentials you created in Step 5
4. After login, you'll be redirected to `/dashboard`
5. You should see the dashboard with your user info in the top right
6. Click the logout icon (power button) to test logout

---

## Troubleshooting

### "Invalid login credentials"
- Make sure the user was created in Supabase Auth
- Check that email confirmation is disabled (Step 6)
- Verify the password is correct

### "Failed to fetch" or network errors
- Check that `.env.local` has the correct Supabase URL and keys
- Make sure you copied the full keys (they're very long)
- Restart the dev server after changing `.env.local`

### Database/RLS errors
- Make sure you ran `schema.sql` completely
- Check for any errors in the SQL Editor
- Verify Row Level Security policies are created

### Page keeps redirecting to login
- Check browser console for errors
- Verify Supabase auth is working: `supabase.auth.getSession()`
- Clear browser cookies and try again

---

## Next Steps

### Connect Real Data

Now that authentication works, you can:

1. **Connect Dashboard to Real Data** - Fetch client info from Supabase
2. **Connect Tasks Page** - Real CRUD operations on tasks
3. **Add Stripe Integration** - For billing/subscriptions
4. **Add File Uploads** - Using Cloudinary for attachments
5. **Send Emails** - Using Resend for notifications

### Watch the Nightly Queue

The background queue holds jobs behind the jobs they depend on, so a run that
looks stalled is usually a run that is waiting on purpose. Read it rather than
guessing:

```ts
const plan = queue.fencePlan()

console.table(plan.ready)     // what a worker would pick up next, in order
console.table(plan.waiting)   // what is fenced, on what, and how many rounds out
console.table(plan.dead)      // what will never run, and why
```

Two things worth knowing before you page anyone:

- A queue with fenced work in it is not idle. Check `size()`, not whether
  `claim()` came back empty, or a deploy will stop the workers mid-pipeline.
- One broken job produces a burst of dead letters, all but the first reading
  `blocked by <id>`. Count the distinct reasons that do not start that way and
  the burst collapses back to a single cause.

### Create More Test Data

You can create additional clients and tasks by:
- Running custom SQL in the Supabase SQL Editor
- Using the app once the create forms are connected
- Modifying and re-running `seed.sql`

---

## Database Reset (If Needed)

If you need to start fresh:

1. Go to Supabase SQL Editor
2. Copy contents of `supabase/reset.sql`
3. Run it
4. Then re-run `schema.sql`
5. Optionally re-run `seed.sql`

**⚠️ Warning: This deletes ALL data!**

---

## Project Structure

```
├── app/
│   ├── login/page.tsx          # Login page
│   ├── signup/page.tsx         # Signup page
│   ├── auth/callback/route.ts  # Auth callback handler
│   ├── dashboard/page.tsx      # Main dashboard (protected)
│   ├── tasks/page.tsx          # Tasks board (protected)
│   ├── billing/page.tsx        # Billing page (protected)
│   └── api/                    # API routes
├── components/
│   ├── layout/                 # Layout components
│   └── ui/                     # UI components
├── lib/
│   ├── supabase/
│   │   ├── client.ts          # Browser client
│   │   ├── server.ts          # Server client
│   │   └── middleware.ts      # Auth middleware
│   └── utils.ts
├── supabase/
│   ├── schema.sql             # Database schema
│   ├── reset.sql              # Reset script
│   └── seed.sql               # Test data
├── middleware.ts              # Route protection
└── .env.local                 # Environment variables (create this)
```

---

## Support

If you run into issues:

1. Check the [Supabase Docs](https://supabase.com/docs)
2. Check the [Next.js Docs](https://nextjs.org/docs)
3. Look at browser console for errors
4. Check Supabase Dashboard → Logs for database errors

---

**You're all set! Happy coding! 🚀**

