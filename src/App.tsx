import { useState, useEffect, useMemo, lazy, Suspense, type ReactNode } from 'react'
import { refreshPush } from './services/push'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from './firebase'
import { OWNER_EMAIL } from './config'
import { SessionContext, makeSession, useSession, type Session, type ViewAs } from './auth'
import type { AppUser } from './types'
import ViewAsBanner from './components/ViewAsBanner'
import PracticeBar, { IS_PRACTICE } from './components/PracticeBar'
import { subscribeToUser, normalizeEmail } from './services/users'
import { ensureDefaultCategories } from './services/categories'

import ShellLayout from './components/ShellLayout'
import LoginScreen from './screens/LoginScreen'
import NotAuthorizedScreen from './screens/NotAuthorizedScreen'
const HomeScreen = lazy(() => import('./screens/HomeScreen'))
const MyRequestsScreen = lazy(() => import('./screens/MyRequestsScreen'))
const MyShootsScreen = lazy(() => import('./screens/MyShootsScreen'))
const ReturnAllScreen = lazy(() => import('./screens/ReturnAllScreen'))
const TakeGearScreen = lazy(() => import('./screens/TakeGearScreen'))
const TeamGuideScreen = lazy(() => import('./screens/TeamGuideScreen'))
const TeamTour = lazy(() => import('./tour/TeamTour'))
const AnalyticsScreen = lazy(() => import('./screens/AnalyticsScreen'))
const RulesSheetScreen = lazy(() => import('./screens/RulesSheetScreen'))
const AddItemScreen = lazy(() => import('./screens/AddItemScreen'))
const ItemDetailScreen = lazy(() => import('./screens/ItemDetailScreen'))
const BinsScreen = lazy(() => import('./screens/BinsScreen'))
const BinQrScreen = lazy(() => import('./screens/BinQrScreen'))
const LocationsScreen = lazy(() => import('./screens/LocationsScreen'))
const CreatorsScreen = lazy(() => import('./screens/CreatorsScreen'))
const PropInsightsScreen = lazy(() => import('./screens/PropInsightsScreen'))
const HealthScreen = lazy(() => import('./screens/HealthScreen'))
const UsersScreen = lazy(() => import('./screens/UsersScreen'))
const CategoriesScreen = lazy(() => import('./screens/CategoriesScreen'))
const EmailSettingsScreen = lazy(() => import('./screens/EmailSettingsScreen'))
const ConnectionsScreen = lazy(() => import('./screens/ConnectionsScreen'))
const ActivityScreen = lazy(() => import('./screens/ActivityScreen'))
const PersonHistoryScreen = lazy(() => import('./screens/PersonHistoryScreen'))
const ImportScreen = lazy(() => import('./screens/ImportScreen'))
const ImportReviewScreen = lazy(() => import('./screens/ImportReviewScreen'))
const DuplicatesScreen = lazy(() => import('./screens/DuplicatesScreen'))
const CleanupScreen = lazy(() => import('./screens/CleanupScreen'))
const CleanupCheckScreen = lazy(() => import('./screens/CleanupCheckScreen'))
const CleanupListScreen = lazy(() => import('./screens/CleanupListScreen'))
const CleanupDoublesScreen = lazy(() => import('./screens/CleanupDoublesScreen'))
const CleanupRemovedScreen = lazy(() => import('./screens/CleanupRemovedScreen'))
const CleanupBinsScreen = lazy(() => import('./screens/CleanupBinsScreen').then(m => ({ default: m.CleanupBinsScreen })))
const CleanupBinScreen = lazy(() => import('./screens/CleanupBinsScreen').then(m => ({ default: m.CleanupBinScreen })))
const CleanupApproveScreen = lazy(() => import('./screens/CleanupSmartScreens').then(m => ({ default: m.CleanupApproveScreen })))
const CleanupPlaceScreen = lazy(() => import('./screens/CleanupSmartScreens').then(m => ({ default: m.CleanupPlaceScreen })))
const CleanupNamesScreen = lazy(() => import('./screens/CleanupSmartScreens').then(m => ({ default: m.CleanupNamesScreen })))
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
const ApprovalsScreen = lazy(() => import('./screens/ApprovalsScreen'))
import { CartProvider } from './cart'
import { ActiveShootProvider } from './activeShoot'
import { warmItems } from './hooks/useItems'
import { AssistantProvider, ChatHome, isChatFirst } from './assistant'
import { BugReportProvider } from './components/BugReport'
const CreatorHomeScreen = lazy(() => import('./screens/CreatorHomeScreen'))
import Splash from './components/Splash'
import { useTourDone, skipTour, tourSkipped, markTourDone } from './tour/tourState'
const AiSettingsScreen = lazy(() => import('./screens/AiSettingsScreen'))
const BugsScreen = lazy(() => import('./screens/BugsScreen'))
const CostsScreen = lazy(() => import('./screens/CostsScreen'))
const HelpScreen = lazy(() => import('./screens/HelpScreen'))
import BirthdayParty from './components/BirthdayParty'
import { ProfilesContext, useProfilesLive, saveProfile } from './services/profiles'
import OfflineBanner from './components/OfflineBanner'

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
  // Start loading the props list in the background (the equipment team can't read props).
  const { realRole } = useSession()
  useEffect(() => realRole === 'equipment' ? undefined : warmItems(realRole === 'owner' ? 'all' : 'company'), [realRole])
  return null
}

// While a screen's code arrives (usually a few milliseconds): a plain black page, no spinner flash.
export function ScreenFallback() { return <div className="min-h-full bg-pt-bg" /> }

// New creators do the practice tour once before using the app (they can close it and carry on later).
function TourGate({ children }: { children: ReactNode }) {
  const { realRole, viewingAs, profile } = useSession()
  // Creators do the creator tour; the equipment team does the gear team tour; admins the admin tour (owner, Oct 20).
  const { demo } = useSession()
  // Demo mode (Props only) has no tour: there's nothing to practise yet. They get it once switched to Full app.
  // Chat first (owner, Nov 2: "drop the long tours; the chat explains itself"): creators no longer get the practice tour.
  // Then (Nov 2): the team gets a ONE-PAGE guide instead of a practice tour (the tours stay in the menu to replay).
  const required = (realRole === 'equipment' || realRole === 'admin' || realRole === 'arts') && !viewingAs && !demo
  const [done, setDone] = useTourDone(profile.email, required)
  const navigate = useNavigate()
  if (!required || done || tourSkipped(profile.email)) return <>{children}</>
  if (done === undefined) return <ScreenFallback />
  // Finished (or paused with Not now): land on Home (owner, Oct 20).
  // Saved on the phone AND the profile (Nov 6: the arts Team guide's "Got it" wasn't saved, so it came back on every open).
  const finished = () => { markTourDone(profile.email); setDone(); navigate('/', { replace: true }) }
  const skipped = () => { skipTour(profile.email); setDone(); navigate('/', { replace: true }) }   // asks again in a week
  // Owner, Nov 3: the team gets a SHORT hands-on tour (equipment, admins); the arts department gets the one-page guide.
  return <Suspense fallback={<ScreenFallback />}>{realRole === 'equipment' || realRole === 'admin'
    ? <TeamTour role={realRole} required onFinish={finished} onSkip={skipped} /> : <TeamGuideScreen onDone={finished} />}</Suspense>
}
// Replaying the tour (Me → App tour, Help). Ends on Home, like the first time.
// The old creator tour taught booking gear, which is off (owner, Nov 3): /tour now just opens the Chat, which explains itself.
function TourReplay() {
  return <Navigate to="/" replace />
}
function AdminTourReplay() {
  const navigate = useNavigate()
  return <TeamTour role="admin" onFinish={() => navigate('/', { replace: true })} />
}
function GearTourReplay() {
  const navigate = useNavigate()
  return <TeamTour role="equipment" onFinish={() => navigate('/', { replace: true })} />
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
      <PracticeBar />
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

// Schedule settings + the Google Calendar connection: the owner only (owner, Oct 20: maintenance).
// Sorting Google Calendar imports + the app's calendar changes: the owner AND the equipment team (owner, Nov 4: "they are
// equally as responsible for the calendar as me"). Linking the calendars / the Google account stays owner-only.
function CalendarTeamOnly({ children }: { children: ReactNode }) {
  const { role } = useSession()
  return role === 'owner' || role === 'equipment' ? <>{children}</> : <Navigate to="/schedule" replace />
}
function ScheduleSettingsOnly({ children }: { children: ReactNode }) {
  const { role } = useSession()
  return role === 'owner' ? <>{children}</> : <Navigate to="/schedule" replace />
}

// Owner + equipment team (gear). Admins only LOOK, through SeeGear.
function GearOnly({ children }: { children: ReactNode }) {
  const { isGearStaff } = useSession()
  return isGearStaff ? <>{children}</> : <Navigate to="/" replace />
}
function SeeGear({ children }: { children: ReactNode }) {
  const { canSeeGear } = useSession()
  return canSeeGear ? <>{children}</> : <Navigate to="/" replace />
}
function SeeStaff({ children }: { children: ReactNode }) {
  const { canSeeStaff } = useSession()
  return canSeeStaff ? <>{children}</> : <Navigate to="/" replace />
}
// Invites, booking rules and the creator dashboard: the owner and admins (owner, Oct 20).
function PeopleOnly({ children }: { children: ReactNode }) {
  const { canManagePeople } = useSession()
  return canManagePeople ? <>{children}</> : <Navigate to="/" replace />
}

// The equipment team works only with gear: their home is the gear queue.
// Creators' (and the owner's, who films too) home is their shoots; the arts department lands on prop search.
function Home() {
  const session = useSession()
  const { role, shootFlow } = session
  // Chat first (owner, Nov 2): people who film open on the chat.
  if (isChatFirst(session)) return <ChatHome />
  // Arts + admins open on the props queue, the equipment team on the gear queue (owner, Oct 20).
  return role === 'equipment' ? <Navigate to="/gear/bookings" replace /> : role === 'admin' ? <AdminScreen /> : role === 'arts' ? <Navigate to="/reservations" replace /> : shootFlow ? <CreatorHomeScreen /> : <HomeScreen />
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
// The Admin menu: the arts department and the equipment team each get their own list.
function TeamOnly({ children }: { children: ReactNode }) {
  const { canSeeStaff, canSeeGear } = useSession()
  return canSeeStaff || canSeeGear ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [profile, setProfile] = useState<AppUser | null>(null)
  const [viewAs, setViewAsState] = useState<ViewAs | null>(() => {
    try { return (sessionStorage.getItem('proptracker.viewAs') as ViewAs | null) || null } catch { return null }
  })
  const setViewAs = (r: ViewAs | null) => {
    setViewAsState(r)
    try { r ? sessionStorage.setItem('proptracker.viewAs', r) : sessionStorage.removeItem('proptracker.viewAs') } catch { /* fine */ }
  }
  // Owner's everyday creator mode (owner, Nov 4): remembered on this phone/computer until switched off in More.
  const [creatorMode, setCreatorModeState] = useState(() => { try { return localStorage.getItem('pc.creatorMode') === '1' } catch { return false } })
  const setCreatorMode = (on: boolean) => {
    setCreatorModeState(on)
    try { on ? localStorage.setItem('pc.creatorMode', '1') : localStorage.removeItem('pc.creatorMode') } catch { /* fine */ }
    setViewAs(null)
  }
  const session: Session | null = useMemo(
    () => user && profile ? makeSession(user, profile, viewAs, setViewAs, creatorMode, setCreatorMode) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, profile, viewAs, creatorMode],
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
    if (session?.isOwner) ensureDefaultCategories().catch(() => {})
  }, [session?.isOwner])

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
    <BirthdayParty />
    <Prefetch />
    {/* Solid strip behind the iPhone clock/battery, so pages never show through it while scrolling */}
    <div aria-hidden className="fixed top-0 inset-x-0 z-40 bg-pt-bg pointer-events-none" style={{ height: 'env(safe-area-inset-top)' }} />
    <OfflineBanner />
    <BugReportProvider>
    <AssistantProvider>
    <TourGate>
    <ViewAsFrame on={!!session.viewingAs || IS_PRACTICE}>
      <Suspense fallback={<ScreenFallback />}>
      {session.demo ? (
      // TEST LAUNCH (owner, Oct 27): demo mode = the props list only (search, prop pages, Me, Help). Everything else → Browse.
      <Routes>
        <Route path="/item/:id" element={<ItemDetailScreen />} />
        <Route element={<ShellLayout />}>
          <Route path="/browse" element={<HomeScreen />} />
          <Route path="/account" element={<AccountScreen />} />
          <Route path="/help" element={<HelpScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/browse" replace />} />
      </Routes>
      ) : (
      <Routes>
        {/* Full-screen routes outside the shell */}
        <Route path="/bin/:qrSlug" element={<StaffOnly><BinQrScreen /></StaffOnly>} />
        <Route path="/item/:id" element={<ItemDetailScreen />} />
        <Route path="/item/:id/edit" element={<StaffOnly><AddItemScreen /></StaffOnly>} />
        <Route path="/reserve" element={<NotArts><ReserveScreen /></NotArts>} />
        <Route path="/reservations/:id" element={<ReservationDetailScreen />} />
        <Route path="/tour" element={<TourReplay />} />
        <Route path="/team-guide" element={<TeamGuideScreen />} />
        <Route path="/tour/gear" element={<GearTourReplay />} />
        <Route path="/tour/admin" element={<AdminTourReplay />} />
        <Route path="/gear/bundles/:id" element={<GearOnly><GearBundleEditScreen /></GearOnly>} />
        <Route path="/gear/b/:id" element={<GearBookers><GearOfferScreen /></GearBookers>} />
        <Route path="/gear/take" element={<GearBookers><TakeGearScreen /></GearBookers>} />
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
          <Route path="/shoots" element={<MyShootsScreen />} />
          <Route path="/return" element={<ReturnAllScreen />} />
          <Route path="/schedule" element={<NotArts to="/calendar"><ScheduleScreen /></NotArts>} />
          <Route path="/calendar" element={<SeeStaff><RequestsCalendarScreen /></SeeStaff>} />
          <Route path="/schedule/how" element={<ScheduleRulesScreen />} />
          <Route path="/schedule/settings" element={<ScheduleSettingsOnly><ScheduleSettingsScreen /></ScheduleSettingsOnly>} />
          <Route path="/schedule/import" element={<CalendarTeamOnly><CalendarImportScreen /></CalendarTeamOnly>} />
          <Route path="/schedule/calendar" element={<CalendarTeamOnly><CalendarSyncScreen /></CalendarTeamOnly>} />
          <Route path="/schedule/team" element={<SeeGear><ScheduleTeamScreen /></SeeGear>} />
          <Route path="/approvals" element={<SeeGear><ApprovalsScreen /></SeeGear>} />
          <Route path="/reservations" element={<ReservationsScreen />} />
          <Route path="/booking-rules" element={<PeopleOnly><BookingRulesScreen /></PeopleOnly>} />
          <Route path="/add" element={<StaffOnly><AddItemScreen /></StaffOnly>} />
          <Route path="/bins" element={<StaffOnly><BinsScreen /></StaffOnly>} />
          <Route path="/locations" element={<StaffOnly><LocationsScreen /></StaffOnly>} />
          <Route path="/checkout" element={<Navigate to="/admin" replace />} />
          <Route path="/creators" element={<PeopleOnly><CreatorsScreen /></PeopleOnly>} />
          <Route path="/insights" element={<SeeStaff><PropInsightsScreen /></SeeStaff>} />
          <Route path="/analytics" element={<PeopleOnly><AnalyticsScreen /></PeopleOnly>} />
          <Route path="/rules-sheet" element={<PeopleOnly><RulesSheetScreen /></PeopleOnly>} />
          <Route path="/admin" element={<TeamOnly><AdminScreen /></TeamOnly>} />
          <Route path="/health" element={<StaffOnly><HealthScreen /></StaffOnly>} />
          <Route path="/users" element={<PeopleOnly><UsersScreen /></PeopleOnly>} />
          <Route path="/personal" element={<OwnerOnly><HomeScreen personal /></OwnerOnly>} />
          <Route path="/categories" element={<OwnerOnly><CategoriesScreen /></OwnerOnly>} />
          <Route path="/email" element={<OwnerOnly><EmailSettingsScreen /></OwnerOnly>} />
          {/* Calendar & email (owner, Oct 28): one page. /google stays because Google sends people back there after signing in. */}
          <Route path="/connections" element={<OwnerOnly><ConnectionsScreen /></OwnerOnly>} />
          <Route path="/google" element={<OwnerOnly><ConnectionsScreen /></OwnerOnly>} />
          <Route path="/ai" element={<OwnerOnly><AiSettingsScreen /></OwnerOnly>} />
          <Route path="/bugs" element={<OwnerOnly><BugsScreen /></OwnerOnly>} />
          <Route path="/costs" element={<OwnerOnly><CostsScreen /></OwnerOnly>} />
          <Route path="/help" element={<HelpScreen />} />
          <Route path="/activity" element={<SeeStaff><ActivityScreen /></SeeStaff>} />
          <Route path="/people/:email" element={<SeeStaff><PersonHistoryScreen /></SeeStaff>} />
          <Route path="/import" element={<OwnerOnly><ImportScreen /></OwnerOnly>} />
          <Route path="/import/:jobId" element={<OwnerOnly><ImportReviewScreen /></OwnerOnly>} />
          <Route path="/duplicates" element={<StaffOnly><DuplicatesScreen /></StaffOnly>} />
          {/* Clean up props (owner, Nov 6): arts + owner. */}
          <Route path="/cleanup" element={<StaffOnly><CleanupScreen /></StaffOnly>} />
          <Route path="/cleanup/check" element={<StaffOnly><CleanupCheckScreen /></StaffOnly>} />
          <Route path="/cleanup/list" element={<StaffOnly><CleanupListScreen /></StaffOnly>} />
          <Route path="/cleanup/doubles" element={<StaffOnly><CleanupDoublesScreen /></StaffOnly>} />
          <Route path="/cleanup/removed" element={<StaffOnly><CleanupRemovedScreen /></StaffOnly>} />
          <Route path="/cleanup/bins" element={<StaffOnly><CleanupBinsScreen /></StaffOnly>} />
          <Route path="/cleanup/bin/:id" element={<StaffOnly><CleanupBinScreen /></StaffOnly>} />
          <Route path="/cleanup/approve" element={<StaffOnly><CleanupApproveScreen /></StaffOnly>} />
          <Route path="/cleanup/place" element={<StaffOnly><CleanupPlaceScreen /></StaffOnly>} />
          <Route path="/cleanup/names" element={<StaffOnly><CleanupNamesScreen /></StaffOnly>} />
          <Route path="/suggestions" element={<StaffOnly><SuggestionsScreen /></StaffOnly>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      )}
      </Suspense>
    </ViewAsFrame>
    </TourGate>
    </AssistantProvider>
    </BugReportProvider>
    </ActiveShootProvider>
    </GearCartProvider>
    </CartProvider>
    </ProfilesContext.Provider>
    </SessionContext.Provider>
  )
}
