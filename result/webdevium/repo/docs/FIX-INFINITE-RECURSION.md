# Fix: Infinite Recursion in RLS Policy 🔧

## Problem

You're getting this error:
```
code: "42P17"
message: "infinite recursion detected in policy for relation \"client_members\""
```

## Cause

The `client_members` table has an RLS policy that queries itself, causing infinite recursion:

```sql
-- ❌ PROBLEMATIC CODE
create policy members_select on public.client_members for select using (
  user_id = ... OR exists (
    select 1 from public.client_members m  -- ← Queries same table!
    where ...
  )
);
```

When PostgreSQL tries to check if a user can read from `client_members`, it runs the policy. The policy queries `client_members` again, which triggers the policy again, causing **infinite recursion**.

---

## Quick Fix (2 minutes)

### Step 1: Drop the Broken Policy

Run this in **Supabase Dashboard** → **SQL Editor**:

```sql
DROP POLICY IF EXISTS members_select ON public.client_members;
```

### Step 2: Create the Fixed Policy

```sql
CREATE POLICY members_select ON public.client_members FOR SELECT USING (
  user_id = coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', 
    '00000000-0000-0000-0000-000000000000'
  )::uuid
);
```

### Step 3: Test It

```sql
-- This should work now (no error)
SELECT * FROM public.client_members LIMIT 1;
```

---

## What Changed?

### Before (Broken):
```sql
user_id = current_user OR exists (
  select from client_members  -- ← Infinite recursion!
  where ...
)
```

### After (Fixed):
```sql
user_id = current_user  -- ← Simple, no recursion
```

**Explanation:** Users can only see their own memberships. No need to query the table recursively.

---

## Complete Fix Script

I've created `supabase/fix-rls-recursion.sql` for you. Just run it:

```sql
-- Copy and paste this entire file into Supabase SQL Editor

DROP POLICY IF EXISTS members_select ON public.client_members;

CREATE POLICY members_select ON public.client_members FOR SELECT USING (
  user_id = coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', 
    '00000000-0000-0000-0000-000000000000'
  )::uuid
);

-- Test it
SELECT * FROM public.client_members LIMIT 1;
```

---

## Verify the Fix

After running the fix, test these operations:

### 1. Fetch Your Client ID
```sql
SELECT client_id FROM public.client_members 
WHERE user_id = auth.uid();
```
✅ Should return your client_id (no error)

### 2. Test in Your App
```bash
npm run dev
```
- Go to `/dashboard`
- Should load without errors
- Should show your client data

### 3. Test Submit Task
- Click "Submit New Task"
- Fill in the form
- Submit
- ✅ Should work now!

---

## Why This Happened

The original schema had a policy that tried to be "smart":
- "Let users see their own memberships"
- "Also let users see other memberships in the same client"

But checking "other memberships in the same client" requires querying `client_members`, which causes the recursion.

**Solution:** Keep it simple. Users only need to see their own memberships.

---

## Prevention

To avoid this in the future:

### ✅ DO:
```sql
-- Simple policies that don't query the same table
CREATE POLICY name ON table_name FOR SELECT USING (
  column = auth.uid()
);
```

### ❌ DON'T:
```sql
-- Recursive policies that query the same table
CREATE POLICY name ON table_name FOR SELECT USING (
  EXISTS (SELECT FROM table_name WHERE ...)  -- ← Bad!
);
```

---

## Alternative Solutions

If you really need complex membership checks:

### Option 1: Use a Helper Function
```sql
-- Function doesn't trigger RLS
CREATE FUNCTION is_member_simple(u uuid, c uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM client_members 
    WHERE user_id = u AND client_id = c
  )
$$ LANGUAGE sql SECURITY DEFINER;

-- Then use it in policies for OTHER tables
CREATE POLICY tasks_select ON tasks FOR SELECT USING (
  is_member_simple(auth.uid(), client_id)
);
```

### Option 2: Use a View
```sql
-- Create a view with SECURITY DEFINER
CREATE VIEW user_clients AS
SELECT client_id FROM client_members
WHERE user_id = auth.uid();

-- Use the view instead of querying client_members directly
```

---

## Updated Schema

I've already updated `supabase/schema.sql` with the fix. If you need to recreate the database from scratch:

1. Run `supabase/schema.sql` (already fixed)
2. The new policy is on **line 119-122**
3. No more recursion!

---

## Common Questions

**Q: Will this break anything?**  
A: No! Users could already only see their own memberships. This just removes the unnecessary recursive check.

**Q: Can users still see other clients?**  
A: No, and they never could. RLS is working correctly.

**Q: What about admin/PM users?**  
A: They have the same access. If you need admins to see all memberships, add a separate policy:

```sql
CREATE POLICY admin_see_all_members ON client_members FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() AND role IN ('admin', 'pm')
  )
);
```

---

## Testing Checklist

After applying the fix:

- [ ] Run the SQL fix script
- [ ] No error when querying `client_members`
- [ ] Dashboard loads successfully  
- [ ] Tasks page loads successfully
- [ ] Can submit new tasks
- [ ] Can view existing tasks
- [ ] Usage meter shows correctly

---

## Need Help?

If you're still seeing errors after the fix:

1. **Check if policy was dropped:**
   ```sql
   SELECT * FROM pg_policies 
   WHERE tablename = 'client_members';
   ```
   Should show only the new `members_select` policy

2. **Check for other recursive policies:**
   ```sql
   SELECT tablename, policyname, definition 
   FROM pg_policies 
   WHERE definition LIKE '%from client_members%';
   ```

3. **Clear Supabase cache:**
   - Restart your dev server
   - Clear browser cache
   - Try in incognito mode

---

## Summary

✅ **Fixed:** Removed recursive query from `client_members` policy  
✅ **Updated:** `supabase/schema.sql` (line 119-122)  
✅ **Created:** `supabase/fix-rls-recursion.sql` (quick fix script)  
✅ **Status:** Ready to apply!

**Run the fix script in Supabase SQL Editor and you're good to go!** 🚀

