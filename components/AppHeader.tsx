'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface AppHeaderProps {
  user?: any
  activePage?: 'dashboard' | 'new-analysis' | 'history' | 'portal-assist' | 'equipment'
}

export default function AppHeader({ user, activePage }: AppHeaderProps) {
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navLink = (href: string, label: string, isActive: boolean) => (
    <a 
      href={href} 
      className={`font-medium transition-colors ${isActive ? 'text-black' : 'text-gray-700 hover:text-black'}`}
    >
      {label}
    </a>
  )

  return (
    <header className="border-b bg-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-black rounded flex items-center justify-center">
              <span className="text-white text-lg font-bold tracking-tighter">T</span>
            </div>
            <span className="text-xl font-semibold tracking-tight">TruckerOS</span>
          </a>
          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full font-medium">Permit Agent</span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          {navLink('/dashboard', 'Dashboard', activePage === 'dashboard')}
          {navLink('/permit-test', 'New Analysis', activePage === 'new-analysis')}
          {navLink('/equipment', 'Equipment', activePage === 'equipment')}
          {navLink('/history', 'History', activePage === 'history')}
          {navLink('/portal-assist', 'Portal Assist', activePage === 'portal-assist')}
          <div className="w-px h-4 bg-gray-300 mx-1" />
          {user && (
            <span className="text-gray-600 hidden md:inline text-sm">{user.email}</span>
          )}
          <button 
            onClick={handleLogout} 
            className="px-4 py-1.5 text-sm border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}
