import { useState, useEffect, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from './firebase'
import { OWNER_EMAIL } from './config'
import { SessionContext, makeSession, useSession, type Session } from './auth'
import { subscribeToUser, normalizeEmail } from './services/users'
import { ensureDefaultCategories } from './services/categories'

import ShellLayout from './components/ShellLayout'
import LoginScreen from './screens/LoginScreen'
import NotAuthorizedScreen from './screens/NotAuthorizedScreen'
import HomeScreen from './screens/HomeScreen'
import AddItemScreen from './screens/AddItemScreen'
import ItemDetailScreen from './screens/ItemDetailScreen'
import BinsScreen from './screens/BinsScreen'
import BinQrScreen from './screens/BinQrScreen'
import LocationsScreen from './screens/LocationsScreen'
import CheckoutScreen from './screens/CheckoutScreen'
import HealthScreen from './screens/HealthScreen'
import UsersScreen from './screens/UsersScreen'
import CategoriesScreen from './screens/CategoriesScreen'
import AccountScreen from './screens/AccountScreen'
import AdminScreen from './screens/AdminScreen'

function Loading() {
  return (
    <div className="min-h-screen bg-pt-bg flex items-center justify-center">
      <div className="text-pt-muted text-sm">Loading…</div>
    </div>
  )
}

// Arts department + owner only. Creators who follow a link here go back to search.
function StaffOnly({ children }: { children: ReactNode }) {
  const { isStaff } = useSession()
  return isStaff ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => onAuthStateChanged(auth, u => {
    setUser(u)
    setAuthLoading(false)
  }), [])

  // Look up the signed-in person's role. Live, so deactivating someone
  // signs them out of the app straight away.
  useEffect(() => {
    setSession(null)
    if (!user?.email || !user.emailVerified) return
    const email = normalizeEmail(user.email)
    setProfileLoading(true)

    if (email === OWNER_EMAIL) {
      setSession(makeSession(user, { email, role: 'owner', active: true, name: user.displayName ?? undefined }))
      setProfileLoading(false)
      return
    }

    return subscribeToUser(
      email,
      profile => {
        setSession(profile?.active ? makeSession(user, profile) : null)
        setProfileLoading(false)
      },
      () => { setSession(null); setProfileLoading(false) },
    )
  }, [user])

  useEffect(() => {
    if (session?.isStaff) ensureDefaultCategories().catch(() => {})
  }, [session?.isStaff])

  if (authLoading || profileLoading) return <Loading />

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<NotAuthorizedScreen user={user} />} />
      </Routes>
    )
  }

  return (
    <SessionContext.Provider value={session}>
      <Routes>
        {/* Full-screen routes outside the shell */}
        <Route path="/bin/:qrSlug" element={<BinQrScreen />} />
        <Route path="/item/:id" element={<ItemDetailScreen />} />
        <Route path="/item/:id/edit" element={<StaffOnly><AddItemScreen /></StaffOnly>} />

        <Route element={<ShellLayout />}>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/account" element={<AccountScreen />} />
          <Route path="/add" element={<StaffOnly><AddItemScreen /></StaffOnly>} />
          <Route path="/bins" element={<StaffOnly><BinsScreen /></StaffOnly>} />
          <Route path="/locations" element={<StaffOnly><LocationsScreen /></StaffOnly>} />
          <Route path="/checkout" element={<StaffOnly><CheckoutScreen /></StaffOnly>} />
          <Route path="/admin" element={<StaffOnly><AdminScreen /></StaffOnly>} />
          <Route path="/health" element={<StaffOnly><HealthScreen /></StaffOnly>} />
          <Route path="/users" element={<StaffOnly><UsersScreen /></StaffOnly>} />
          <Route path="/categories" element={<StaffOnly><CategoriesScreen /></StaffOnly>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionContext.Provider>
  )
}
