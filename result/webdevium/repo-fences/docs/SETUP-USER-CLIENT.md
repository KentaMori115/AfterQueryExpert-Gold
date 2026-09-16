# How to Set Up Your User with a Client

When you sign up for the first time, you'll see **"No Client Found"** because your account isn't linked to any client yet. Here's how to fix it!

---

## Quick Fix (5 minutes)

### Step 1: Get Your User ID

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Run this query:

```sql
SELECT id, email, role FROM public.users ORDER BY created_at DESC LIMIT 5;
```

3. **Copy your user ID** (looks like: `a1b2c3d4-e5f6-...`)

---

### Step 2: Create a Client

Replace `YOUR_USER_ID_HERE` with the ID you just copied:

```sql
INSERT INTO public.clients (id, name, owner_user_id, plan_code, hours_monthly, hours_used_month, cycle_start)
VALUES (
  gen_random_uuid(),
  'My Company',                      -- Change to your company name
  'YOUR_USER_ID_HERE',               -- Your user ID from Step 1
  'growth',                          -- Plan: starter, growth, scale, dedicated
  80,                                -- Monthly hours
  15.5,                              -- Hours used (for testing)
  CURRENT_DATE
)
RETURNING id, name;
```

4. **Copy the client ID** from the result

---

### Step 3: Link Your User to the Client

Replace BOTH IDs:

```sql
INSERT INTO public.client_members (client_id, user_id, role)
VALUES (
  'YOUR_CLIENT_ID_HERE',             -- Client ID from Step 2
  'YOUR_USER_ID_HERE',               -- Your user ID from Step 1
  'client'                           -- Your role
);
```

---

### Step 4: Create Sample Tasks (Optional)

```sql
INSERT INTO public.tasks (client_id, title, description, priority, status, created_at)
VALUES 
  ('YOUR_CLIENT_ID_HERE', 'Welcome Task', 'This is your first task!', 'medium', 'queued', NOW()),
  ('YOUR_CLIENT_ID_HERE', 'Test Task in Progress', 'Being worked on', 'high', 'in_progress', NOW() - INTERVAL '2 days'),
  ('YOUR_CLIENT_ID_HERE', 'Completed Task', 'This was finished', 'low', 'done', NOW() - INTERVAL '5 days');

-- Set completion date for done tasks
UPDATE public.tasks 
SET completed_at = created_at + INTERVAL '2 days'
WHERE status = 'done' AND completed_at IS NULL AND client_id = 'YOUR_CLIENT_ID_HERE';
```

---

### Step 5: Refresh Your Dashboard

Go back to your dashboard and **refresh the page** (F5). You should now see:
- ✅ Your plan and usage metrics
- ✅ Recent tasks
- ✅ "Submit New Task" button enabled

---

## Alternative: Use the Seed Script

I've created a file `supabase/seed-user-client.sql` with all the queries above. Just:

1. Open the file
2. Replace the placeholder IDs
3. Copy and run in Supabase SQL Editor

---

## Plan Options

You can choose any plan:

| Plan Code | Name | Monthly Hours |
|-----------|------|---------------|
| `starter` | Starter | 40 hours |
| `growth` | Growth | 80 hours |
| `scale` | Scale | 120 hours |
| `dedicated` | Dedicated | 160 hours |

---

## Role Options

You can have different roles:

| Role | Access Level |
|------|-------------|
| `client` | View tasks, submit new tasks |
| `dev` | Work on tasks, log hours |
| `pm` | Assign tasks, manage projects |
| `admin` | Full access to everything |

For your personal account, use `'client'`.

---

## Verification

Check if everything is set up correctly:

```sql
-- Check your client
SELECT c.*, p.name as plan_name
FROM public.clients c
LEFT JOIN public.plans p ON c.plan_code = p.code
WHERE c.owner_user_id = 'YOUR_USER_ID_HERE';

-- Check your membership
SELECT cm.*, u.email
FROM public.client_members cm
JOIN public.users u ON cm.user_id = u.id
WHERE cm.user_id = 'YOUR_USER_ID_HERE';

-- Check your tasks
SELECT id, title, status, priority, created_at
FROM public.tasks
WHERE client_id = 'YOUR_CLIENT_ID_HERE'
ORDER BY created_at DESC;
```

---

## Troubleshooting

### "User ID not found"
- Make sure you're logged in
- Check that your user exists in `public.users`
- The signup should have created it automatically

### "Still seeing 'No Client Found'"
- Clear your browser cache
- Log out and log back in
- Check the SQL queries ran successfully
- Verify the IDs match exactly

### "Can't create client"
- Make sure you replaced `YOUR_USER_ID_HERE` with your actual ID
- Check for any SQL errors in the Supabase dashboard

---

## Future: Automatic Client Creation

In a production app, you'd typically:
1. Have an onboarding flow after signup
2. Automatically create a client for new users
3. Use Stripe subscriptions to provision clients

For now, manual setup works for testing! 🎉

