'use client'

import { useState, useEffect, useMemo } from 'react'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { useUser } from '@/contexts/user-context'

interface DashboardLayoutProps {
  children: React.ReactNode
  isAdmin?: boolean
}

export function DashboardLayout({ children, isAdmin: isAdminProp = false }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Use cached user data from context instead of fetching
  const { user, isAdmin: isUserAdmin } = useUser()

  // Determine if admin based on role or prop
  const isAdmin = isAdminProp || isUserAdmin

  // Memoize userName and userEmail so they don't recalculate on every render
  // Only recalculate if user object reference changes
  const userName = useMemo(() => {
    return user?.user_metadata?.name || user?.email?.split('@')[0] || 'User'
  }, [user?.user_metadata?.name, user?.email])
  
  const userEmail = useMemo(() => {
    return user?.email
  }, [user?.email])

  // Close sidebar when window is resized to desktop size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setSidebarOpen(false)
      }
    }
    
    window.addEventListener('resize', handleResize)
    // Also check on mount
    handleResize()
    
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:flex-shrink-0">
        <Sidebar isAdmin={isAdmin} />
      </div>

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <>
          <div 
            className="fixed inset-0 z-40 md:hidden bg-black bg-opacity-25" 
            onClick={() => setSidebarOpen(false)}
            role="button"
            aria-label="Close sidebar"
            tabIndex={-1}
          />
          <div className="fixed left-0 top-0 bottom-0 w-64 z-50 md:hidden bg-card border-r">
            <Sidebar isAdmin={isAdmin} />
          </div>
        </>
      )}

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden relative z-0">
        <Topbar 
          onMenuClick={() => setSidebarOpen(true)} 
          userName={userName}
          userEmail={userEmail}
        />
        
        {/* Page Content */}
        <main className="flex-1 overflow-auto relative z-0">
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
