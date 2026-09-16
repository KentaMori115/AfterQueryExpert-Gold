-- =====================================================
-- COMPLETE RLS FIX - Run This Once
-- =====================================================
-- This fixes ALL RLS policies for the onboarding to work
-- Copy and paste this ENTIRE file into Supabase SQL Editor
-- Then click RUN
-- =====================================================

-- =====================================================
-- PART 1: Drop ALL existing policies
-- =====================================================

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

-- =====================================================
-- PART 2: Create SELECT policies
-- =====================================================

-- Users: all can see (public info only)
CREATE POLICY users_select ON public.users FOR SELECT USING (true);

-- Plans: all can read
CREATE POLICY plans_select ON public.plans FOR SELECT USING (true);

-- Clients: members can see their clients
CREATE POLICY clients_select ON public.clients FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.client_members m
    WHERE m.client_id = clients.id AND m.user_id = auth.uid()
  )
);

-- Client members: users see their own memberships
CREATE POLICY members_select ON public.client_members FOR SELECT USING (
  user_id = auth.uid()
);

-- Tasks: members can read their client's tasks
CREATE POLICY tasks_select ON public.tasks FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = tasks.client_id AND user_id = auth.uid()
  )
);

-- Usage logs: members can read their client's usage
CREATE POLICY usage_select ON public.usage_logs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = usage_logs.client_id AND user_id = auth.uid()
  )
);

-- =====================================================
-- PART 3: Create INSERT policies (THE IMPORTANT PART!)
-- =====================================================

-- Clients: users can create clients where they are the owner
CREATE POLICY clients_insert_own ON public.clients FOR INSERT WITH CHECK (
  owner_user_id = auth.uid()
);

-- Client members: users can add themselves as members
CREATE POLICY members_insert_own ON public.client_members FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

-- Tasks: users can insert tasks if they are a member
CREATE POLICY tasks_insert_client ON public.tasks FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = tasks.client_id AND user_id = auth.uid()
  )
);

-- Usage logs: members can insert usage logs
CREATE POLICY usage_insert ON public.usage_logs FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = usage_logs.client_id AND user_id = auth.uid()
  )
);

-- =====================================================
-- PART 4: Create UPDATE policies
-- =====================================================

-- Tasks: PM/Admin can update tasks
CREATE POLICY tasks_update_pm ON public.tasks FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.client_members m
    WHERE m.client_id = tasks.client_id
      AND m.user_id = auth.uid()
      AND m.role IN ('pm', 'admin')
  )
);

-- =====================================================
-- PART 5: Verify all policies were created
-- =====================================================

SELECT 
  tablename, 
  policyname, 
  cmd as command,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- =====================================================
-- Expected results:
-- - users: 1 SELECT policy
-- - plans: 1 SELECT policy
-- - clients: 1 SELECT + 1 INSERT policy
-- - client_members: 1 SELECT + 1 INSERT policy
-- - tasks: 1 SELECT + 1 INSERT + 1 UPDATE policy
-- - usage_logs: 1 SELECT + 1 INSERT policy
-- =====================================================

SELECT '✅ ALL RLS POLICIES FIXED! Onboarding should work now!' AS status;

