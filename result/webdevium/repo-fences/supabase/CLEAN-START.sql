-- =====================================================
-- CLEAN START: Remove ALL Policies, Then Add Correct Ones
-- =====================================================
-- This removes ALL policies from ALL tables
-- Then recreates them with the correct configuration
-- =====================================================

-- =====================================================
-- STEP 1: REMOVE ABSOLUTELY EVERYTHING
-- =====================================================

-- Drop ALL policies from users table
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'users' AND schemaname = 'public')
  LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.users';
  END LOOP;
END $$;

-- Drop ALL policies from plans table
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'plans' AND schemaname = 'public')
  LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.plans';
  END LOOP;
END $$;

-- Drop ALL policies from clients table
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'clients' AND schemaname = 'public')
  LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.clients';
  END LOOP;
END $$;

-- Drop ALL policies from client_members table
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'client_members' AND schemaname = 'public')
  LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.client_members';
  END LOOP;
END $$;

-- Drop ALL policies from tasks table
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'tasks' AND schemaname = 'public')
  LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.tasks';
  END LOOP;
END $$;

-- Drop ALL policies from usage_logs table
DO $$ 
DECLARE 
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'usage_logs' AND schemaname = 'public')
  LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.usage_logs';
  END LOOP;
END $$;

SELECT '✅ All policies removed!' AS step1;

-- =====================================================
-- STEP 2: ADD CORRECT POLICIES
-- =====================================================

-- Users: all can see
CREATE POLICY users_select ON public.users 
FOR SELECT USING (true);

-- Plans: all can read
CREATE POLICY plans_select ON public.plans 
FOR SELECT USING (true);

-- Clients SELECT: members can see their clients
CREATE POLICY clients_select ON public.clients 
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.client_members m
    WHERE m.client_id = clients.id AND m.user_id = auth.uid()
  )
);

-- Clients INSERT: users can create clients where they are owner
CREATE POLICY clients_insert ON public.clients 
FOR INSERT 
WITH CHECK (owner_user_id = auth.uid());

-- Client members SELECT: users see their own memberships
CREATE POLICY members_select ON public.client_members 
FOR SELECT USING (user_id = auth.uid());

-- Client members INSERT: users can add themselves
CREATE POLICY members_insert ON public.client_members 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- Tasks SELECT: members can read their client's tasks
CREATE POLICY tasks_select ON public.tasks 
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = tasks.client_id AND user_id = auth.uid()
  )
);

-- Tasks INSERT: members can create tasks for their client
CREATE POLICY tasks_insert ON public.tasks 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = tasks.client_id AND user_id = auth.uid()
  )
);

-- Tasks UPDATE: PM/Admin can update
CREATE POLICY tasks_update ON public.tasks 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.client_members m
    WHERE m.client_id = tasks.client_id
      AND m.user_id = auth.uid()
      AND m.role IN ('pm', 'admin')
  )
);

-- Usage logs SELECT: members can read
CREATE POLICY usage_select ON public.usage_logs 
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = usage_logs.client_id AND user_id = auth.uid()
  )
);

-- Usage logs INSERT: members can log usage
CREATE POLICY usage_insert ON public.usage_logs 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = usage_logs.client_id AND user_id = auth.uid()
  )
);

SELECT '✅ All policies recreated!' AS step2;

-- =====================================================
-- STEP 3: Verify everything
-- =====================================================

SELECT 
  tablename,
  count(*) as policy_count
FROM pg_policies 
WHERE schemaname = 'public'
  AND tablename IN ('users', 'plans', 'clients', 'client_members', 'tasks', 'usage_logs')
GROUP BY tablename
ORDER BY tablename;

-- =====================================================
-- Expected results:
-- users: 1 policy (SELECT)
-- plans: 1 policy (SELECT)
-- clients: 2 policies (SELECT + INSERT)
-- client_members: 2 policies (SELECT + INSERT)
-- tasks: 3 policies (SELECT + INSERT + UPDATE)
-- usage_logs: 2 policies (SELECT + INSERT)
-- =====================================================

SELECT '🎉 ALL DONE! Policies are clean and ready!' AS final_status;

