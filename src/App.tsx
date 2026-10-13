import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from './firebase'
import { OWNER_EMAIL } from './config'
import { SessionContext, makeSession, useSession, type Session } from './auth'
import type { AppUser, Role } from './types'
import ViewAsBanner from './components/ViewAsBanner'
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
import EmailSettingsScreen from './screens/EmailSettingsScreen'
import ActivityScreen from './screens/ActivityScreen'
import PersonHistoryScreen from './screens/PersonHistoryScreen'
import ImportScreen from './screens/ImportScreen'
import ImportReviewScreen from './screens/ImportReviewScreen'
import DuplicatesScreen from './screens/DuplicatesScreen'
import SuggestionsScreen from './screens/SuggestionsScreen'
import AccountScreen from './screens/AccountScreen'
import AdminScreen from './screens/AdminScreen'
import ReserveScreen from './screens/ReserveScreen'
import ReservationsScreen from './screens/ReservationsScreen'
import ReservationDetailScreen from './screens/ReservationDetailScreen'
import BookingRulesScreen from './screens/BookingRulesScreen'
import { CartProvider } from './cart'

function Loading() {
  return (
    <div className="min-h-screen bg-pt-bg flex items-center justify-center">
      <div className="text-pt-muted text-sm">Loading…</div>
    </div>
  )
}

// While previewing another role, the blue strip takes its own row and the
// screens scroll beneath it. Otherwise screens render exactly as normal (a
// wrapper here would squeeze tall pages and hide their bottom padding).
function ViewAsFrame({ on, children }: { on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>
  return (
    <div className="flex flex-col h-full">
      <ViewAsBanner />
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  )
}

// Arts department + owner only. Creators who follow a link here go back to search.
function OwnerOnly({ children }: { children: ReactNode }) {
  const { isOwner } = useSession()
  return isOwner ? <>{children}</> : <Navigate to="/" replace />
}

function StaffOnly({ children }: { children: ReactNode }) {
  const { isStaff } = useSession()
  return isStaff ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [profile, setProfile] = useState<AppUser | null>(null)
  const [viewAs, setViewAsState] = useState<Role | null>(() => {
    try { return (sessionStorage.getItem('proptracker.viewAs') as Role | null) || null } catch { return null }
  })
  const setViewAs = (r: Role | null) => {
    setViewAsState(r)
    try { r ? sessionStorage.setItem('proptracker.viewAs', r) : sessionStorage.removeItem('proptracker.viewAs') } catch { /* fine */ }
  }
  const session: Session | null = useMemo(
    () => user && profile ? makeSession(user, profile, viewAs, setViewAs) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, profile, viewAs],
  )
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => onAuthStateChanged(auth, u => {
    setUser(u)
    setAuthLoading(false)
  }), [])

  // Look up the signed-in person's role. Live, so deactivating someone
  // signs them out of the app straight away.
  useEffect(() => {
    setProfile(null)
    if (!user?.email || !user.emailVerified) return
    const email = normalizeEmail(user.email)
    setProfileLoading(true)

    if (email === OWNER_EMAIL) {
      setProfile({ email, role: 'owner', active: true, name: user.displayName ?? undefined })
      setProfileLoading(false)
      return
    }

    return subscribeToUser(
      email,
      p => {
        setProfile(p?.active ? p : null)
        setProfileLoading(false)
      },
      () => { setProfile(null); setProfileLoading(false) },
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
    <CartProvider>
    <ViewAsFrame on={!!session.viewingAs}>
      <Routes>
        {/* Full-screen routes outside the shell */}
        <Route path="/bin/:qrSlug" element={<StaffOnly><BinQrScreen /></StaffOnly>} />
        <Route path="/item/:id" element={<ItemDetailScreen />} />
        <Route path="/item/:id/edit" element={<StaffOnly><AddItemScreen /></StaffOnly>} />
        <Route path="/reserve" element={<ReserveScreen />} />
        <Route path="/reservations/:id" element={<ReservationDetailScreen />} />

        <Route element={<ShellLayout />}>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/account" element={<AccountScreen />} />
          <Route path="/reservations" element={<ReservationsScreen />} />
          <Route path="/booking-rules" element={<StaffOnly><BookingRulesScreen /></StaffOnly>} />
          <Route path="/add" element={<StaffOnly><AddItemScreen /></StaffOnly>} />
          <Route path="/bins" element={<StaffOnly><BinsScreen /></StaffOnly>} />
          <Route path="/locations" element={<StaffOnly><LocationsScreen /></StaffOnly>} />
          <Route path="/checkout" element={<StaffOnly><CheckoutScreen /></StaffOnly>} />
          <Route path="/admin" element={<StaffOnly><AdminScreen /></StaffOnly>} />
          <Route path="/health" element={<StaffOnly><HealthScreen /></StaffOnly>} />
          <Route path="/users" element={<StaffOnly><UsersScreen /></StaffOnly>} />
          <Route path="/categories" element={<StaffOnly><CategoriesScreen /></StaffOnly>} />
          <Route path="/email" element={<OwnerOnly><EmailSettingsScreen /></OwnerOnly>} />
          <Route path="/activity" element={<StaffOnly><ActivityScreen /></StaffOnly>} />
          <Route path="/people/:email" element={<StaffOnly><PersonHistoryScreen /></StaffOnly>} />
          <Route path="/import" element={<StaffOnly><ImportScreen /></StaffOnly>} />
          <Route path="/import/:jobId" element={<StaffOnly><ImportReviewScreen /></StaffOnly>} />
          <Route path="/duplicates" element={<StaffOnly><DuplicatesScreen /></StaffOnly>} />
          <Route path="/suggestions" element={<StaffOnly><SuggestionsScreen /></StaffOnly>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ViewAsFrame>
    </CartProvider>
    </SessionContext.Provider>
  )
}
