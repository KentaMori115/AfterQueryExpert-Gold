-- =====================================================
-- COMPLETE DATABASE RESET
-- =====================================================
-- WARNING: This will DELETE ALL DATA!
-- Only run this in development environments.
-- =====================================================

-- Step 1: Drop all RLS policies
DROP POLICY IF EXISTS users_select ON public.users;
DROP POLICY IF EXISTS plans_select ON public.plans;
DROP POLICY IF EXISTS clients_select ON public.clients;
DROP POLICY IF EXISTS clients_insert_own ON public.clients;
DROP POLICY IF EXISTS members_select ON public.client_members;
DROP POLICY IF EXISTS members_insert_own ON public.client_members;
DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert_client ON public.tasks;
DROP POLICY IF EXISTS tasks_update_pm ON public.tasks;
DROP POLICY IF EXISTS usage_select ON public.usage_logs;
DROP POLICY IF EXISTS usage_insert ON public.usage_logs;

-- Step 2: Drop all triggers
DROP TRIGGER IF EXISTS trg_usage_bump ON public.usage_logs;

-- Step 3: Drop all functions
DROP FUNCTION IF EXISTS public.bump_hours_used();
DROP FUNCTION IF EXISTS public.calculate_task_stats(uuid);
DROP FUNCTION IF EXISTS public.increment_task_hours(uuid, numeric);
DROP FUNCTION IF EXISTS public.is_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.current_user_id();

-- Step 4: Drop all views
DROP VIEW IF EXISTS public.v_client_usage;

-- Step 5: Drop all indexes
DROP INDEX IF EXISTS public.one_active_task_per_client;

-- Step 6: Drop all tables (in reverse dependency order)
DROP TABLE IF EXISTS public.usage_logs CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;
DROP TABLE IF EXISTS public.client_members CASCADE;
DROP TABLE IF EXISTS public.clients CASCADE;
DROP TABLE IF EXISTS public.plans CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- Step 7: Drop all custom types
DROP TYPE IF EXISTS task_priority CASCADE;
DROP TYPE IF EXISTS task_status CASCADE;

-- =====================================================
-- Database is now completely clean!
-- Next: Run schema.sql to recreate everything
-- =====================================================

SELECT 'Database reset complete! Now run schema.sql' AS message;

