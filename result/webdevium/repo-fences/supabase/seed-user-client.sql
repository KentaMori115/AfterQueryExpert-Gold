-- =====================================================
-- Seed Script: Create Client for Current User
-- =====================================================
-- This script creates a client and links it to your logged-in user
-- Run this in Supabase SQL Editor after signing up
-- =====================================================

-- Step 1: Find your user ID (check the result and copy the ID)
SELECT id, email, role FROM public.users ORDER BY created_at DESC LIMIT 5;

-- =====================================================
-- Step 2: CREATE YOUR CLIENT
-- Replace 'YOUR_USER_ID_HERE' with the ID from Step 1
-- =====================================================

-- Insert a client for your user
INSERT INTO public.clients (id, name, owner_user_id, plan_code, hours_monthly, hours_used_month, cycle_start)
VALUES (
  gen_random_uuid(),
  'My Company',                    -- Change this to your company name
  'YOUR_USER_ID_HERE',             -- REPLACE with your user ID from Step 1
  'growth',                         -- Plan: starter, growth, scale, or dedicated
  80,                              -- Monthly hours for growth plan
  15.5,                            -- Hours already used (for demo)
  CURRENT_DATE - INTERVAL '10 days' -- Cycle started 10 days ago
)
RETURNING id, name;

-- =====================================================
-- Step 3: LINK YOUR USER TO THE CLIENT
-- Copy the client ID from Step 2 result
-- Replace BOTH IDs below
-- =====================================================

INSERT INTO public.client_members (client_id, user_id, role)
VALUES (
  'YOUR_CLIENT_ID_HERE',           -- REPLACE with client ID from Step 2
  'YOUR_USER_ID_HERE',             -- REPLACE with your user ID from Step 1
  'client'                         -- Role: client, admin, pm, or dev
);

-- =====================================================
-- Step 4: CREATE SOME SAMPLE TASKS (Optional)
-- Replace the client_id below
-- =====================================================

INSERT INTO public.tasks (client_id, title, description, priority, status, created_at)
VALUES 
  ('YOUR_CLIENT_ID_HERE', 'Welcome Task', 'This is your first task! Edit or delete me.', 'medium', 'queued', NOW() - INTERVAL '1 hour'),
  ('YOUR_CLIENT_ID_HERE', 'Test In Progress Task', 'This task is being worked on', 'high', 'in_progress', NOW() - INTERVAL '2 days'),
  ('YOUR_CLIENT_ID_HERE', 'Completed Task', 'This task was completed', 'medium', 'done', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- Update completed_at for done tasks
UPDATE public.tasks 
SET completed_at = created_at + INTERVAL '2 days'
WHERE status = 'done' AND completed_at IS NULL;

-- =====================================================
-- Verification: Check your setup
-- =====================================================

-- Verify your client was created
SELECT * FROM public.clients WHERE owner_user_id = 'YOUR_USER_ID_HERE';

-- Verify your membership
SELECT * FROM public.client_members WHERE user_id = 'YOUR_USER_ID_HERE';

-- Verify your tasks
SELECT * FROM public.tasks WHERE client_id = 'YOUR_CLIENT_ID_HERE';

-- =====================================================
-- Done! Refresh your dashboard to see the data
-- =====================================================

