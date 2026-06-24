import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from './firebase'
import { AUTHORIZED_UIDS } from './config'

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
import VideosScreen from './screens/VideosScreen'
import VideoChecklistScreen from './screens/VideoChecklistScreen'
import ShoppingListScreen from './screens/ShoppingListScreen'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-pt-bg flex items-center justify-center">
        <div className="text-pt-muted text-sm">Loading…</div>
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    )
  }

  const isAuthorized = AUTHORIZED_UIDS.includes(user.uid)

  if (!isAuthorized) {
    return (
      <Routes>
        <Route path="*" element={<NotAuthorizedScreen user={user} />} />
      </Routes>
    )
  }

  return (
    <Routes>
      {/* Full-screen routes outside the shell */}
      <Route path="/bin/:qrSlug" element={<BinQrScreen />} />
      <Route path="/item/:id" element={<ItemDetailScreen />} />
      <Route path="/item/:id/edit" element={<AddItemScreen />} />
      <Route path="/videos/:folderId" element={<VideoChecklistScreen />} />
      <Route path="/shopping" element={<ShoppingListScreen />} />

      <Route element={<ShellLayout />}>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/add" element={<AddItemScreen />} />
        <Route path="/bins" element={<BinsScreen />} />
        <Route path="/locations" element={<LocationsScreen />} />
        <Route path="/checkout" element={<CheckoutScreen />} />
        <Route path="/health" element={<HealthScreen />} />
        <Route path="/videos" element={<VideosScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
