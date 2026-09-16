-- =====================================================
-- FIX ALL INSERT POLICIES - Complete Solution
-- =====================================================
-- This fixes all RLS INSERT policy issues for onboarding
-- Copy and paste this ENTIRE file into Supabase SQL Editor
-- =====================================================

-- 1. Drop existing INSERT policies
DROP POLICY IF EXISTS clients_insert_own ON public.clients;
DROP POLICY IF EXISTS members_insert_own ON public.client_members;
DROP POLICY IF EXISTS tasks_insert_client ON public.tasks;

-- 2. Create INSERT policy for clients
-- Users can create clients where they are the owner
CREATE POLICY clients_insert_own ON public.clients 
FOR INSERT 
WITH CHECK (owner_user_id = auth.uid());

-- 3. Create INSERT policy for client_members
-- Users can add themselves as members
CREATE POLICY members_insert_own ON public.client_members 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- 4. Fix INSERT policy for tasks
-- Users can insert tasks if they are a member of the client
CREATE POLICY tasks_insert_client ON public.tasks 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.client_members 
    WHERE client_id = tasks.client_id 
    AND user_id = auth.uid()
  )
);

-- 5. Verify all policies were created
SELECT 
  tablename, 
  policyname, 
  cmd as command
FROM pg_policies 
WHERE policyname IN ('clients_insert_own', 'members_insert_own', 'tasks_insert_client')
ORDER BY tablename;

-- =====================================================
-- Expected output: 3 policies (1 for each table)
-- - clients: clients_insert_own (INSERT)
-- - client_members: members_insert_own (INSERT)  
-- - tasks: tasks_insert_client (INSERT)
-- =====================================================

SELECT '✅ All INSERT policies fixed!' AS status;

