-- =====================================================
-- 🚨 RUN THIS FIRST - Simple INSERT Policy Fix
-- =====================================================
-- Copy this ENTIRE file and paste into:
-- Supabase Dashboard → SQL Editor → Click RUN
-- =====================================================

-- Drop existing policies first
DROP POLICY IF EXISTS clients_insert_own ON public.clients;
DROP POLICY IF EXISTS members_insert_own ON public.client_members;
DROP POLICY IF EXISTS tasks_insert_client ON public.tasks;

-- Add INSERT policy for clients table
CREATE POLICY clients_insert_own ON public.clients 
FOR INSERT 
WITH CHECK (owner_user_id = auth.uid());

-- Add INSERT policy for client_members table
CREATE POLICY members_insert_own ON public.client_members 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- Add INSERT policy for tasks table (use EXISTS to check membership)
CREATE POLICY tasks_insert_client ON public.tasks 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.client_members 
    WHERE client_id = tasks.client_id AND user_id = auth.uid()
  )
);

-- =====================================================
-- Verify policies were created
-- =====================================================
SELECT 
  '✅ ' || policyname || ' on ' || tablename as policy_created
FROM pg_policies 
WHERE policyname IN ('clients_insert_own', 'members_insert_own', 'tasks_insert_client')
ORDER BY tablename;

-- =====================================================
-- You should see 3 rows:
-- ✅ clients_insert_own on clients
-- ✅ members_insert_own on client_members
-- ✅ tasks_insert_client on tasks
-- =====================================================

