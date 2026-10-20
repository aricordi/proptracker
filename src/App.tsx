import { useState, useEffect, useMemo, lazy, Suspense, type ReactNode } from 'react'
import { refreshPush } from './services/push'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
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
const HomeScreen = lazy(() => import('./screens/HomeScreen'))
const MyRequestsScreen = lazy(() => import('./screens/MyRequestsScreen'))
const ReturnAllScreen = lazy(() => import('./screens/ReturnAllScreen'))
const Tour = lazy(() => import('./tour/Tour'))
const GearTour = lazy(() => import('./tour/GearTour'))
const AddItemScreen = lazy(() => import('./screens/AddItemScreen'))
const ItemDetailScreen = lazy(() => import('./screens/ItemDetailScreen'))
const BinsScreen = lazy(() => import('./screens/BinsScreen'))
const BinQrScreen = lazy(() => import('./screens/BinQrScreen'))
const LocationsScreen = lazy(() => import('./screens/LocationsScreen'))
const CheckoutScreen = lazy(() => import('./screens/CheckoutScreen'))
const HealthScreen = lazy(() => import('./screens/HealthScreen'))
const UsersScreen = lazy(() => import('./screens/UsersScreen'))
const CategoriesScreen = lazy(() => import('./screens/CategoriesScreen'))
const EmailSettingsScreen = lazy(() => import('./screens/EmailSettingsScreen'))
const ActivityScreen = lazy(() => import('./screens/ActivityScreen'))
const PersonHistoryScreen = lazy(() => import('./screens/PersonHistoryScreen'))
const ImportScreen = lazy(() => import('./screens/ImportScreen'))
const ImportReviewScreen = lazy(() => import('./screens/ImportReviewScreen'))
const DuplicatesScreen = lazy(() => import('./screens/DuplicatesScreen'))
const GearItemsScreen = lazy(() => import('./screens/GearItemsScreen'))
const GearBundlesScreen = lazy(() => import('./screens/GearBundlesScreen'))
const GearBundleEditScreen = lazy(() => import('./screens/GearBundleEditScreen'))
const GearShopScreen = lazy(() => import('./screens/GearShopScreen'))
const GearOfferScreen = lazy(() => import('./screens/GearOfferScreen'))
const GearBookingsScreen = lazy(() => import('./screens/GearBookingsScreen'))
const GearBookingScreen = lazy(() => import('./screens/GearBookingScreen'))
import { GearCartProvider, ShootDaySync } from './gearCart'
const SuggestionsScreen = lazy(() => import('./screens/SuggestionsScreen'))
const AccountScreen = lazy(() => import('./screens/AccountScreen'))
const AdminScreen = lazy(() => import('./screens/AdminScreen'))
const ReserveScreen = lazy(() => import('./screens/ReserveScreen'))
const ReservationsScreen = lazy(() => import('./screens/ReservationsScreen'))
const ReservationDetailScreen = lazy(() => import('./screens/ReservationDetailScreen'))
const BookingRulesScreen = lazy(() => import('./screens/BookingRulesScreen'))
const ScheduleScreen = lazy(() => import('./screens/ScheduleScreen'))
const RequestsCalendarScreen = lazy(() => import('./screens/RequestsCalendarScreen'))
const CalendarSyncScreen = lazy(() => import('./screens/CalendarSyncScreen'))
const ScheduleSettingsScreen = lazy(() => import('./screens/ScheduleSettingsScreen'))
const ScheduleRulesScreen = lazy(() => import('./screens/ScheduleRulesScreen'))
const CalendarImportScreen = lazy(() => import('./screens/CalendarImportScreen'))
const ScheduleTeamScreen = lazy(() => import('./screens/ScheduleTeamScreen'))
import { CartProvider } from './cart'
import { ActiveShootProvider } from './activeShoot'
import { AssistantProvider } from './assistant'
const CreatorHomeScreen = lazy(() => import('./screens/CreatorHomeScreen'))
import Splash from './components/Splash'
import { useTourDone } from './tour/tourState'
const AiSettingsScreen = lazy(() => import('./screens/AiSettingsScreen'))
const CostsScreen = lazy(() => import('./screens/CostsScreen'))
const HelpScreen = lazy(() => import('./screens/HelpScreen'))
import { ProfilesContext, useProfilesLive, saveProfile } from './services/profiles'

// Screens load on demand (smaller first download). Right after sign-in, while the phone is idle,
// the four main tabs are fetched in the background so switching tabs is still instant.
const MAIN_TABS = [
  () => import('./screens/CreatorHomeScreen'), () => import('./screens/ScheduleScreen'),
  () => import('./screens/HomeScreen'), () => import('./screens/AccountScreen'), () => import('./screens/ItemDetailScreen'),
]
function usePrefetchTabs(on: boolean) {
  useEffect(() => {
    if (!on) return
    const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200))
    idle(() => MAIN_TABS.forEach(load => load().catch(() => {})))
  }, [on])
}

// Signed-in only: warm up the main tabs in the background.
function Prefetch() {
  usePrefetchTabs(true)
  useEffect(() => { refreshPush() }, [])   // keep this phone's notification sign-up fresh
  return null
}

// While a screen's code arrives (usually a few milliseconds): a plain black page, no spinner flash.
export function ScreenFallback() { return <div className="min-h-full bg-pt-bg" /> }

// New creators do the practice tour once before using the app (they can close it and carry on later).
function TourGate({ children }: { children: ReactNode }) {
  const { realRole, viewingAs, profile } = useSession()
  // Creators do the creator tour; the equipment team does the gear team tour (owner, Oct 20).
  const required = (realRole === 'creator' || realRole === 'equipment') && !viewingAs
  const [done, setDone] = useTourDone(profile.email, required)
  const navigate = useNavigate()
  if (!required || done) return <>{children}</>
  if (done === undefined) return <ScreenFallback />
  // Finished (or paused with Not now): land on Home (owner, Oct 20).
  const finished = () => { setDone(); navigate('/', { replace: true }) }
  return <Suspense fallback={<ScreenFallback />}>{realRole === 'equipment' ? <GearTour required onFinish={finished} /> : <Tour required onFinish={finished} />}</Suspense>
}
// Replaying the tour (Me → App tour, Help). Ends on Home, like the first time.
function TourReplay() {
  const navigate = useNavigate()
  return <Tour onFinish={() => navigate('/', { replace: true })} />
}
function GearTourReplay() {
  const navigate = useNavigate()
  return <GearTour onFinish={() => navigate('/', { replace: true })} />
}

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

// Schedule settings + the Google Calendar connection: owner + equipment team, not admins (owner, Oct 19).
function ScheduleSettingsOnly({ children }: { children: ReactNode }) {
  const { role } = useSession()
  return role === 'owner' || role === 'equipment' ? <>{children}</> : <Navigate to="/schedule" replace />
}

// Owner + equipment team (gear) + admins.
function GearOnly({ children }: { children: ReactNode }) {
  const { isGearStaff } = useSession()
  return isGearStaff ? <>{children}</> : <Navigate to="/" replace />
}

// The equipment team works only with gear: their home is the gear queue.
// Creators' (and the owner's, who films too) home is their shoots; the arts department lands on prop search.
function Home() {
  const { role, shootFlow } = useSession()
  return role === 'equipment' ? <Navigate to="/gear/bookings" replace /> : role === 'admin' ? <Navigate to="/reservations" replace /> : shootFlow ? <CreatorHomeScreen /> : <HomeScreen />
}

// Booking gear is for creators and the owner (the equipment team runs it; the arts department
// handles props requests and doesn't book, owner Oct 19).
function GearBookers({ children }: { children: ReactNode }) {
  const { role } = useSession()
  return role === 'equipment' ? <Navigate to="/gear/bookings" replace /> : role === 'arts' ? <Navigate to="/" replace /> : <>{children}</>
}
// Booking props / a shoot: creators, the owner (and the schedule team for shoots). Arts get the requests calendar.
function NotArts({ children, to = '/' }: { children: ReactNode; to?: string }) {
  const { role } = useSession()
  return role === 'arts' ? <Navigate to={to} replace /> : <>{children}</>
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

  // Everyone's profile photos + channel names; and keep your Google photo as the default picture.
  const profiles = useProfilesLive(!!session)
  const myEmail = session?.profile.email
  useEffect(() => {
    const g = user?.photoURL
    if (!myEmail || !g || profiles[myEmail]?.googlePhoto === g) return
    const t = setTimeout(() => saveProfile(myEmail, { googlePhoto: g }).catch(() => {}), 1500)
    return () => clearTimeout(t)
  }, [myEmail, user?.photoURL, profiles])

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
    <ProfilesContext.Provider value={profiles}>
    <CartProvider>
    <GearCartProvider>
    <ShootDaySync />
    <ActiveShootProvider>
    <Splash />
    <Prefetch />
    {/* Solid strip behind the iPhone clock/battery, so pages never show through it while scrolling */}
    <div aria-hidden className="fixed top-0 inset-x-0 z-40 bg-pt-bg pointer-events-none" style={{ height: 'env(safe-area-inset-top)' }} />
    <AssistantProvider>
    <TourGate>
    <ViewAsFrame on={!!session.viewingAs}>
      <Suspense fallback={<ScreenFallback />}>
      <Routes>
        {/* Full-screen routes outside the shell */}
        <Route path="/bin/:qrSlug" element={<StaffOnly><BinQrScreen /></StaffOnly>} />
        <Route path="/item/:id" element={<ItemDetailScreen />} />
        <Route path="/item/:id/edit" element={<StaffOnly><AddItemScreen /></StaffOnly>} />
        <Route path="/reserve" element={<NotArts><ReserveScreen /></NotArts>} />
        <Route path="/reservations/:id" element={<ReservationDetailScreen />} />
        <Route path="/tour" element={<TourReplay />} />
        <Route path="/tour/gear" element={<GearTourReplay />} />
        <Route path="/gear/bundles/:id" element={<GearOnly><GearBundleEditScreen /></GearOnly>} />
        <Route path="/gear/b/:id" element={<GearBookers><GearOfferScreen /></GearBookers>} />
        <Route path="/gear/review" element={<Navigate to="/reserve" replace />} />
        <Route path="/gear/bookings/:id" element={<GearBookingScreen />} />

        <Route element={<ShellLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<HomeScreen />} />
          <Route path="/gear" element={<GearBookers><GearShopScreen /></GearBookers>} />
          <Route path="/gear/bookings" element={<GearBookingsScreen />} />
          <Route path="/gear/bundles" element={<GearOnly><GearBundlesScreen /></GearOnly>} />
          <Route path="/gear/items" element={<GearOnly><GearItemsScreen /></GearOnly>} />
          <Route path="/account" element={<AccountScreen />} />
          <Route path="/requests" element={<MyRequestsScreen />} />
          <Route path="/return" element={<ReturnAllScreen />} />
          <Route path="/schedule" element={<NotArts to="/calendar"><ScheduleScreen /></NotArts>} />
          <Route path="/calendar" element={<StaffOnly><RequestsCalendarScreen /></StaffOnly>} />
          <Route path="/schedule/how" element={<ScheduleRulesScreen />} />
          <Route path="/schedule/settings" element={<ScheduleSettingsOnly><ScheduleSettingsScreen /></ScheduleSettingsOnly>} />
          <Route path="/schedule/import" element={<ScheduleSettingsOnly><CalendarImportScreen /></ScheduleSettingsOnly>} />
          <Route path="/schedule/calendar" element={<ScheduleSettingsOnly><CalendarSyncScreen /></ScheduleSettingsOnly>} />
          <Route path="/schedule/team" element={<GearOnly><ScheduleTeamScreen /></GearOnly>} />
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
          <Route path="/ai" element={<OwnerOnly><AiSettingsScreen /></OwnerOnly>} />
          <Route path="/costs" element={<OwnerOnly><CostsScreen /></OwnerOnly>} />
          <Route path="/help" element={<HelpScreen />} />
          <Route path="/activity" element={<StaffOnly><ActivityScreen /></StaffOnly>} />
          <Route path="/people/:email" element={<StaffOnly><PersonHistoryScreen /></StaffOnly>} />
          <Route path="/import" element={<StaffOnly><ImportScreen /></StaffOnly>} />
          <Route path="/import/:jobId" element={<StaffOnly><ImportReviewScreen /></StaffOnly>} />
          <Route path="/duplicates" element={<StaffOnly><DuplicatesScreen /></StaffOnly>} />
          <Route path="/suggestions" element={<StaffOnly><SuggestionsScreen /></StaffOnly>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </ViewAsFrame>
    </TourGate>
    </AssistantProvider>
    </ActiveShootProvider>
    </GearCartProvider>
    </CartProvider>
    </ProfilesContext.Provider>
    </SessionContext.Provider>
  )
}
