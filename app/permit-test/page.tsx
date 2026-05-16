'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { reverseGeocode } from '@/lib/geocoding'

export default function PermitTestPage() {
  const [user, setUser] = useState<any>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
      setLoadingAuth(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [router])

  // Auto-check migration status once user is authenticated
  useEffect(() => {
    if (!loadingAuth && user) {
      checkMigrationStatus()
    }
  }, [loadingAuth, user])

  const [formData, setFormData] = useState({
    origin: {
      street: '',
      city: 'Calvert',
      state: 'AL',
      zip: '',
    },
    destination: {
      street: '',
      city: 'Lincoln',
      state: 'NE',
      zip: '',
    },
    weight: 80000,
    length: 60,
    width: 9.67,
    height: 13.5,
    originLat: 31.85,
    originLon: -86.85,
    destinationLat: 40.81,
    destinationLon: -96.68,
  })

  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [geocodeStatus, setGeocodeStatus] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Database migration status
  const [migrationStatus, setMigrationStatus] = useState<any>(null)
  const [checkingMigration, setCheckingMigration] = useState(false)

  // Agent result + approval gate
  const [agentResult, setAgentResult] = useState<any>(null)
  const [savedToDatabase, setSavedToDatabase] = useState(false)

  // Change Route feature
  const [showChangeRouteInput, setShowChangeRouteInput] = useState(false)
  const [manualRoute, setManualRoute] = useState('')

  // Tier selector for cost estimation (temporary for testing)
  const [selectedTier, setSelectedTier] = useState<'Free' | 'Starter' | 'Pro'>('Starter')

  // Ref for scrolling to results after submission
  const resultsRef = useRef<HTMLDivElement>(null)

  // Debounced geocoding (increased delay to reduce rate limit issues)
  const debouncedGeocode = useCallback(
    (type: 'origin' | 'destination') => {
      const address = formData[type]
      if (!address.city || !address.state) return

      // Clear any previous timeout
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current)
      }

      geocodeTimeoutRef.current = setTimeout(async () => {
        setGeocodeStatus(`Geocoding ${type}...`)
        const query = `${address.city}, ${address.state}, USA`

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=us`
          )

          if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`)

          const data = await res.json()

          if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat)
            const lon = parseFloat(data[0].lon)

            setFormData((prev) => ({
              ...prev,
              [`${type}Lat`]: lat,
              [`${type}Lon`]: lon,
            }))
            setGeocodeStatus(`${type} geocoded successfully`)
          } else {
            setGeocodeStatus(`No location found for ${query}`)
          }
        } catch (error) {
          console.error('Geocoding error:', error)
          setGeocodeStatus('Geocoding failed (rate limit or network issue)')
        }
      }, 900) // Increased debounce delay (900ms)
    },
    [formData]
  )

  // Ref to store the timeout ID for debouncing
  const geocodeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Client-side validation (matches agent logic + extra UX rules)
  function validateForm(): boolean {
    const newErrors: Record<string, string> = {}

    if (!formData.origin.city?.trim()) newErrors['origin.city'] = 'Origin city is required'
    if (!formData.origin.state?.trim() || formData.origin.state.length !== 2) {
      newErrors['origin.state'] = 'Origin state must be 2-letter code (e.g. AL)'
    }
    if (!formData.destination.city?.trim()) newErrors['destination.city'] = 'Destination city is required'
    if (!formData.destination.state?.trim() || formData.destination.state.length !== 2) {
      newErrors['destination.state'] = 'Destination state must be 2-letter code (e.g. NE)'
    }
    if (!formData.weight || formData.weight <= 0) newErrors['weight'] = 'Weight must be greater than 0'
    if (!formData.length || formData.length <= 0) newErrors['length'] = 'Length must be greater than 0'
    if (!formData.width || formData.width <= 0) newErrors['width'] = 'Width must be greater than 0'
    if (!formData.height || formData.height <= 0) newErrors['height'] = 'Height must be greater than 0'

    // Recommend coordinates for best results
    if (!formData.originLat || !formData.destinationLat) {
      newErrors['geocode'] = 'Please geocode origin and destination for accurate corridor routing'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setResult(null)

    if (!validateForm()) {
      return
    }

    setLoading(true)

    try {
      const agentResponse = await fetch('/api/test-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const agentData = await agentResponse.json()

      if (!agentResponse.ok) {
        const errorMessage = agentData.error || agentData.message || 'Agent failed'
        throw new Error(errorMessage)
      }

      // Store agent result for review (do not save yet)
      setAgentResult(agentData)
      setSavedToDatabase(false)
      setResult(null) // clear any previous error

      // Snap to results - scroll so the status banner is near the top of the viewport
      setTimeout(() => {
        if (resultsRef.current) {
          const headerOffset = 80 // account for sticky header
          const elementPosition = resultsRef.current.getBoundingClientRect().top
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset

          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          })
        }
      }, 50)

    } catch (error: any) {
      setResult({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  // New function: Approve & Save (Human Approval Gate)
  const handleApproveAndSave = async () => {
    if (!agentResult) return;

    // Always derive the primary option correctly (supports both single and multi-option shapes)
    const primary = agentResult?.options?.[0] || agentResult

    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setResult({ error: 'You must be logged in to save' })
        setLoading(false)
        return
      }

      const savePayload = {
        origin_city: formData.origin.city,
        origin_state: formData.origin.state,
        destination_city: formData.destination.city,
        destination_state: formData.destination.state,
        weight: formData.weight,
        length: formData.length,
        width: formData.width,
        height: formData.height,
        route_corridor: primary.routeCorridor || [],
        permit_required_states: primary.permitRequiredStates || [],
        requires_permit: (primary.permitRequiredStates?.length || 0) > 0,
        reasons: primary.reasons || [],
        notes: primary.notes || [],
        estimated_cost: primary.estimatedCost || 0,
        cost_breakdown: null,
        distance_miles: primary.distanceMiles || null,
        duration_hours: primary.durationHours || null,
        user_id: user?.id,
      }

      const saveResponse = await fetch('/api/permit-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(savePayload),
      })

      const saveData = await saveResponse.json()

      if (!saveResponse.ok) throw new Error(saveData.error || 'Failed to save')

      setSavedToDatabase(true)
      setResult({
        agent: primary,
        savedToDatabase: saveData.data,
      })
    } catch (error: any) {
      setResult({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  // Approve a specific route option (from the list of alternatives)
  const handleApproveSpecificOption = async (option: any) => {
    if (!option || !agentResult) return;

    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setResult({ error: 'You must be logged in to save' })
        setLoading(false)
        return
      }

      const savePayload = {
        origin_city: formData.origin.city,
        origin_state: formData.origin.state,
        destination_city: formData.destination.city,
        destination_state: formData.destination.state,
        weight: formData.weight,
        length: formData.length,
        width: formData.width,
        height: formData.height,
        route_corridor: option.routeCorridor || [],
        permit_required_states: option.permitRequiredStates || [],
        requires_permit: (option.permitRequiredStates?.length || 0) > 0,
        reasons: option.reasons || [],
        notes: option.notes || [],
        estimated_cost: option.estimatedCost || 0,
        cost_breakdown: null,
        distance_miles: option.distanceMiles || null,
        duration_hours: option.durationHours || null,
        user_id: user?.id,
      }

      const saveResponse = await fetch('/api/permit-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(savePayload),
      })

      const saveData = await saveResponse.json()

      if (!saveResponse.ok) throw new Error(saveData.error || 'Failed to save')

      // Normalize agentResult so the approved option becomes the primary (options[0])
      const normalizedAgentResult = {
        ...agentResult,
        options: [option],
      }

      setAgentResult(normalizedAgentResult)
      setSavedToDatabase(true)
      setResult({
        agent: option,
        savedToDatabase: saveData.data,
      })
    } catch (error: any) {
      setResult({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  // Reject & Start Over (Human Approval Gate)
  const handleRejectAndRestart = () => {
    setAgentResult(null)
    setSavedToDatabase(false)
    setResult(null)
    setShowChangeRouteInput(false)
    setManualRoute('')
    // Scroll back to the form for convenience
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Handle manual route change (Change Route feature)
  const handleChangeRoute = async () => {
    if (!manualRoute.trim()) return

    // Parse comma-separated states (e.g. "AL, MS, TN, MO, NE")
    const states = manualRoute
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length === 2)

    if (states.length === 0) {
      alert('Please enter a valid list of state codes (e.g., AL, MS, TN, MO, NE)')
      return
    }

    setLoading(true)
    setShowChangeRouteInput(false)

    try {
      // Re-run the agent with the manual route
      const response = await fetch('/api/test-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          manualRoute: states,
        }),
      })

      const newAgentData = await response.json()

      if (!response.ok) throw new Error(newAgentData.error || 'Agent failed on new route')

      setAgentResult(newAgentData)
      setSavedToDatabase(false)
      setManualRoute('')
    } catch (error: any) {
      alert('Failed to analyze the new route: ' + error.message)
      setShowChangeRouteInput(true) // keep input open on error
    } finally {
      setLoading(false)
    }
  }

  // Check if the new columns have been added to permit_requests
  async function checkMigrationStatus() {
    setCheckingMigration(true)
    try {
      const res = await fetch('/api/admin/migrate')
      const data = await res.json()
      setMigrationStatus(data)
    } catch (e) {
      setMigrationStatus({ hasAdmin: false, error: 'Failed to check' })
    } finally {
      setCheckingMigration(false)
    }
  }

  async function applyMigration() {
    const res = await fetch('/api/admin/migrate', { method: 'POST' })
    const data = await res.json()
    
    if (data.sql) {
      alert('Please run the following SQL in Supabase SQL Editor:\n\n' + data.sql)
    }
    // Re-check after user says they ran it
    setTimeout(checkMigrationStatus, 1500)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loadingAuth) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      {/* Professional Header */}
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
            <a href="/dashboard" className="text-gray-700 hover:text-black font-medium">Dashboard</a>
            <a href="/permit-test" className="text-gray-700 hover:text-black font-medium">New Analysis</a>
            <div className="w-px h-4 bg-gray-300 mx-1" />
            {user && <span className="text-gray-600 hidden md:inline text-sm">{user.email}</span>}
            <button 
              onClick={handleLogout} 
              className="px-4 py-1.5 text-sm border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mb-8">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🚛</span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">New Route Analysis</h1>
            <p className="text-sm text-gray-500">Submit load details for real-time state and provincial permit intelligence</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Validation Errors */}
        {Object.keys(errors).length > 0 && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            Please fix the following before submitting:
            <ul className="list-disc list-inside mt-1">
              {Object.values(errors).map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          </div>
        )}
        {/* Origin */}
        <div>
          <h2 className="font-semibold mb-2">Origin</h2>
          <div className="grid grid-cols-2 gap-4">
            <input
              placeholder="Street (optional)"
              value={formData.origin.street}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  origin: { ...formData.origin, street: e.target.value },
                })
              }
              className="border p-2 rounded col-span-2"
            />
            <div>
              <input
                placeholder="City"
                value={formData.origin.city}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    origin: { ...formData.origin, city: e.target.value },
                    originLat: undefined,
                    originLon: undefined,
                  })
                  if (errors['origin.city']) {
                    const { ['origin.city']: _, ...rest } = errors
                    setErrors(rest)
                  }
                  if (e.target.value.trim().length >= 3) {
                    debouncedGeocode('origin')
                  }
                }}
                className={`border p-2 rounded w-full ${errors['origin.city'] ? 'border-red-500' : ''}`}
              />
              {errors['origin.city'] && <p className="text-red-500 text-xs mt-1">{errors['origin.city']}</p>}
            </div>
            <div>
              <input
                placeholder="State (2 letters)"
                value={formData.origin.state}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().slice(0, 2)
                  setFormData({
                    ...formData,
                    origin: { ...formData.origin, state: val },
                    originLat: undefined,
                    originLon: undefined,
                  })
                  if (errors['origin.state']) {
                    const { ['origin.state']: _, ...rest } = errors
                    setErrors(rest)
                  }
                  if (val.length === 2) {
                    debouncedGeocode('origin')
                  }
                }}
                className={`border p-2 rounded w-full ${errors['origin.state'] ? 'border-red-500' : ''}`}
              />
              {errors['origin.state'] && <p className="text-red-500 text-xs mt-1">{errors['origin.state']}</p>}
            </div>
            <input
              placeholder="Zip (optional)"
              value={formData.origin.zip}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  origin: { ...formData.origin, zip: e.target.value },
                })
              }
              className="border p-2 rounded"
            />
          </div>
        </div>

        {/* Destination */}
        <div>
          <h2 className="font-semibold mb-2">Destination</h2>
          <div className="grid grid-cols-2 gap-4">
            <input
              placeholder="Street (optional)"
              value={formData.destination.street}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  destination: { ...formData.destination, street: e.target.value },
                })
              }
              className="border p-2 rounded col-span-2"
            />
            <div>
              <input
                placeholder="City"
                value={formData.destination.city}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    destination: { ...formData.destination, city: e.target.value },
                    destinationLat: undefined,
                    destinationLon: undefined,
                  })
                  if (errors['destination.city']) {
                    const { ['destination.city']: _, ...rest } = errors
                    setErrors(rest)
                  }
                  if (e.target.value.trim().length >= 3) {
                    debouncedGeocode('destination')
                  }
                }}
                className={`border p-2 rounded w-full ${errors['destination.city'] ? 'border-red-500' : ''}`}
              />
              {errors['destination.city'] && <p className="text-red-500 text-xs mt-1">{errors['destination.city']}</p>}
            </div>
            <div>
              <input
                placeholder="State (2 letters)"
                value={formData.destination.state}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().slice(0, 2)
                  setFormData({
                    ...formData,
                    destination: { ...formData.destination, state: val },
                    destinationLat: undefined,
                    destinationLon: undefined,
                  })
                  if (errors['destination.state']) {
                    const { ['destination.state']: _, ...rest } = errors
                    setErrors(rest)
                  }
                  if (val.length === 2) {
                    debouncedGeocode('destination')
                  }
                }}
                className={`border p-2 rounded w-full ${errors['destination.state'] ? 'border-red-500' : ''}`}
              />
              {errors['destination.state'] && <p className="text-red-500 text-xs mt-1">{errors['destination.state']}</p>}
            </div>
            <input
              placeholder="Zip (optional)"
              value={formData.destination.zip}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  destination: { ...formData.destination, zip: e.target.value },
                })
              }
              className="border p-2 rounded"
            />
          </div>
        </div>

        {/* Load Details */}
        <div>
          <h2 className="font-semibold mb-2">Load Details</h2>
          <div className="grid grid-cols-2 gap-4">
            {(['weight', 'length', 'width', 'height'] as const).map((field) => (
              <div key={field}>
                <label className="block text-sm mb-1 capitalize">{field}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={(formData as any)[field] || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0
                    setFormData({ ...formData, [field]: val })
                    if (errors[field]) {
                      const { [field]: _, ...rest } = errors
                      setErrors(rest)
                    }
                  }}
                  className={`border p-2 rounded w-full ${errors[field] ? 'border-red-500' : ''}`}
                />
                {errors[field] && <p className="text-red-500 text-xs mt-1">{errors[field]}</p>}
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || Object.keys(errors).length > 0}
          className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Processing...' : 'Submit to Permit Agent'}
        </button>
      </form>

      {/* Results */}
      {(agentResult || result) && (
        <div ref={resultsRef} className="mt-8 space-y-6">
          {/* Edit Request - allows user to go back to the form */}
          <div className="flex justify-end">
            <button
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' })
                // Optional: focus first input after scroll
                setTimeout(() => {
                  const firstInput = document.querySelector('input[placeholder="City"]') as HTMLInputElement
                  firstInput?.focus()
                }, 600)
              }}
              className="text-xs px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors flex items-center gap-1.5"
            >
              <span>Edit Request</span>
            </button>
          </div>
          {(() => {
            const primary = agentResult?.options?.[0] || agentResult || result?.agent
            if (!primary) return null

            const isSaved = savedToDatabase || !!result?.savedToDatabase
            const hasMultipleOptions = !!(agentResult?.options && agentResult.options.length > 1)

            return (
              <>
                {/* Status Banner - derived from actual permitRequiredStates on the primary option */}
                {(() => {
                  const requiresPermit = (primary.permitRequiredStates?.length || 0) > 0
                  const bannerMessage = primary.message ||
                    (requiresPermit
                      ? `Permit requirements detected for this route.`
                      : 'No permit requirements flagged for this route.')

                  return (
                    <div className={`p-4 rounded-lg border ${requiresPermit ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{requiresPermit ? '🚨' : '✅'}</span>
                        <div>
                          <div className="font-semibold text-lg">
                            {requiresPermit
                              ? `Permit Required in ${primary.permitRequiredStates.length} State(s)`
                              : 'No Permit Required'}
                          </div>
                          <div className="text-sm opacity-90">{bannerMessage}</div>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Approval Gate Buttons + Change Route (only before saving) */}
                {agentResult && !isSaved && (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                      <button
                        onClick={handleRejectAndRestart}
                        disabled={loading}
                        className="px-8 py-3 rounded-lg text-lg font-semibold border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Reject &amp; Start Over
                      </button>
                      <button
                        onClick={handleApproveAndSave}
                        disabled={loading}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-8 py-3 rounded-lg text-lg disabled:bg-gray-400"
                      >
                        {loading ? 'Processing...' : 'Approve and Proceed'}
                      </button>
                      <button
                        onClick={() => setShowChangeRouteInput(!showChangeRouteInput)}
                        disabled={loading}
                        className="px-8 py-3 rounded-lg text-lg font-semibold border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {showChangeRouteInput ? 'Cancel' : 'Change Route'}
                      </button>
                    </div>

                    {showChangeRouteInput && (
                      <div className="max-w-md mx-auto">
                        <p className="text-sm text-gray-600 mb-2">
                          Enter a new route as comma-separated state codes (e.g., <code>AL, MS, TN, MO, NE</code>)
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={manualRoute}
                            onChange={(e) => setManualRoute(e.target.value)}
                            placeholder="AL, MS, TN, MO, NE"
                            className="flex-1 border rounded px-3 py-2 text-sm"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleChangeRoute() }}
                          />
                          <button
                            onClick={handleChangeRoute}
                            disabled={loading || !manualRoute.trim()}
                            className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:bg-gray-400"
                          >
                            Submit New Route
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Save Success Banner */}
                {isSaved && (
                  <div className="p-4 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">✅</span>
                      <div>
                        <div className="font-semibold text-lg">Permit request saved successfully</div>
                        <div className="text-sm">Data has been stored in the database.</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Visual Corridor Map - Primary Recommendation */}
                {primary.routeCorridor && primary.routeCorridor.length > 0 && (
                  <div className="p-5 border-2 border-blue-200 rounded-xl bg-white shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900 text-lg">Primary Recommended Route</h3>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">RECOMMENDED</span>
                        </div>
                        <p className="text-sm text-gray-500">
                          {primary.routeCorridor.length} states
                          {primary.distanceMiles && ` • ${primary.distanceMiles} miles`}
                          {primary.durationHours && ` • ~${primary.durationHours} hrs`}
                        </p>
                      </div>
                      <div className="text-xs px-3 py-1 bg-gray-100 rounded-full text-gray-600 self-start">
                        OSRM + Nominatim
                      </div>
                    </div>

                    {/* Visual Route Line */}
                    <div className="relative py-8 px-2">
                      <div className="absolute top-1/2 left-4 right-4 h-1 bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200 rounded-full -translate-y-1/2" />
                      <div className="relative flex justify-between items-center">
                        {primary.routeCorridor.map((state: string, index: number) => {
                          const requires = primary.permitRequiredStates?.includes(state)
                          const needsEscort = primary.escortRequiredStates?.includes(state)
                          const isFirst = index === 0
                          const isLast = index === primary.routeCorridor.length - 1
                          return (
                            <div key={index} className="flex flex-col items-center z-10 group">
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-md border-2 transition-all ${requires ? 'bg-red-500 text-white border-red-600' : 'bg-emerald-500 text-white border-emerald-600'} group-hover:scale-110`}>
                                {state}
                              </div>
                              <div className="mt-1.5 text-[10px] font-medium text-center space-y-0.5">
                                <span className={requires ? 'text-red-600' : 'text-emerald-600'}>
                                  {requires ? 'PERMIT' : 'OK'}
                                </span>
                                {needsEscort && (
                                  <div className="text-[9px] font-semibold text-orange-600">ESCORT</div>
                                )}
                              </div>
                              {!isFirst && !isLast && (
                                <div className="absolute top-[38px] w-1.5 h-1.5 bg-white rounded-full border border-gray-300" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex gap-4 text-xs mt-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-emerald-500 rounded-full" /> <span className="text-gray-600">No permit required</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-red-500 rounded-full" /> <span className="text-gray-600">Permit required</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-orange-500 rounded-full" /> <span className="text-gray-600">Escort required</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Major Highways */}
                {primary.highways && primary.highways.length > 0 && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-2 text-gray-700">Major Highways</h3>
                    <p className="text-sm text-gray-800 break-words">{primary.highways.join(" → ")}</p>
                  </div>
                )}

                {/* Per-State Permit Breakdown */}
                {primary.permitRequiredStates && primary.permitRequiredStates.length > 0 && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-4 text-gray-700">Why These States Require Permits</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {primary.permitRequiredStates.map((state: string, idx: number) => {
                        const stateReasons = (primary.reasons || []).filter((r: string) => r.startsWith(`${state}:`))
                        const needsEscort = primary.escortRequiredStates?.includes(state)
                        return (
                          <div key={idx} className="border border-red-200 bg-red-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-bold text-lg text-red-800">{state}</span>
                              <div className="flex gap-1.5">
                                <span className="text-xs px-2 py-0.5 bg-red-200 text-red-700 rounded">PERMIT REQUIRED</span>
                                {needsEscort && (
                                  <span className="text-xs px-2 py-0.5 bg-orange-200 text-orange-700 rounded font-medium">ESCORT NEEDED</span>
                                )}
                              </div>
                            </div>
                            <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                              {stateReasons.length > 0 ? (
                                stateReasons.map((reason: string, i: number) => (
                                  <li key={i}>{reason.replace(`${state}: `, '')}</li>
                                ))
                              ) : (
                                <li>Exceeds one or more state thresholds</li>
                              )}
                            </ul>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Route Restrictions & Requirements (from strengthened state rules DB) */}
                {(primary.escortRequiredStates?.length > 0 || primary.curfewNotes?.length > 0 || primary.specialNotes?.length > 0) && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-3 text-gray-700">Route Restrictions &amp; Requirements</h3>

                    {/* Escort Summary */}
                    {primary.escortRequiredStates?.length > 0 && (
                      <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-orange-800">Escort Vehicle Required</span>
                          <span className="text-xs px-2 py-0.5 bg-orange-200 text-orange-700 rounded">
                            {primary.escortRequiredStates.length} state{primary.escortRequiredStates.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="text-sm text-orange-700">
                          {primary.escortRequiredStates.join(' → ')}
                        </div>
                      </div>
                    )}

                    {/* Curfew Restrictions */}
                    {primary.curfewNotes?.length > 0 && (
                      <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="font-semibold text-amber-800 mb-1">Time / Curfew Restrictions</div>
                        <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
                          {primary.curfewNotes.map((note: string, i: number) => (
                            <li key={i}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Special / Important Notes from State Rules */}
                    {primary.specialNotes?.length > 0 && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="font-semibold text-blue-800 mb-1">Important Route Notes</div>
                        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
                          {primary.specialNotes.slice(0, 5).map((note: string, i: number) => (
                            <li key={i}>{note}</li>
                          ))}
                          {primary.specialNotes.length > 5 && (
                            <li className="text-blue-600 italic">+ {primary.specialNotes.length - 5} more state-specific notes (see raw data)</li>
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Seasonal / Frost Law Restrictions */}
                    {primary.seasonalWeightRestrictions?.length > 0 && (
                      <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                        <div className="font-semibold text-purple-800 mb-1">Seasonal Weight Restrictions (Frost Laws / Spring Thaw)</div>
                        <ul className="text-sm text-purple-700 space-y-1 list-disc list-inside">
                          {primary.seasonalWeightRestrictions.slice(0, 4).map((note: string, i: number) => (
                            <li key={i}>{note}</li>
                          ))}
                          {primary.seasonalWeightRestrictions.length > 4 && (
                            <li className="text-purple-600 italic">+ {primary.seasonalWeightRestrictions.length - 4} more seasonal notes</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Tier Selector (for cost estimation simulation) */}
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-medium text-gray-600">Your Plan:</span>
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                    {(['Free', 'Starter', 'Pro'] as const).map((tier) => (
                      <button
                        key={tier}
                        onClick={() => setSelectedTier(tier)}
                        className={`px-4 py-1.5 transition-colors ${
                          selectedTier === tier
                            ? 'bg-black text-white'
                            : 'bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cost Summary */}
                <div className="p-4 border rounded-lg bg-white">
                  <h3 className="font-semibold mb-3 text-gray-700">Estimated Total Cost</h3>

                  {primary.costBreakdown && (
                    <>
                      {/* State Permit Costs */}
                      <div className="flex justify-between items-baseline mb-2">
                        <span className="text-sm text-gray-600">State Permit Fees</span>
                        <span className="font-medium">
                          ${primary.costBreakdown.baseFee ?? 0}
                        </span>
                      </div>

                      {/* TruckerOS Platform Fee */}
                      <div className="flex justify-between items-baseline mb-3">
                        <span className="text-sm text-gray-600">
                          TruckerOS Platform Fee <span className="text-xs text-gray-400">({selectedTier})</span>
                        </span>
                        <span className="font-medium text-blue-600">
                          ${(() => {
                            const permitCount = primary.costBreakdown.stateCount || 0
                            if (selectedTier === 'Free') return permitCount * 29
                            return permitCount * 10
                          })()}
                        </span>
                      </div>

                      {/* Grand Total */}
                      <div className="pt-3 border-t flex justify-between items-baseline">
                        <span className="font-semibold text-gray-800">Grand Total</span>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-gray-900">
                            ${(() => {
                              const stateCost = primary.costBreakdown.baseFee || 0
                              const permitCount = primary.costBreakdown.stateCount || 0
                              const platformFee = selectedTier === 'Free' ? permitCount * 29 : permitCount * 10
                              return stateCost + platformFee
                            })()}
                          </span>
                          <span className="text-sm text-gray-500">USD</span>
                        </div>
                      </div>

                      {/* Surcharges breakdown (if any) */}
                      {primary.costBreakdown.surcharges && Object.keys(primary.costBreakdown.surcharges).length > 0 && (
                        <div className="mt-3 text-xs text-gray-500">
                          Includes dimensional/weight surcharges
                        </div>
                      )}
                    </>
                  )}

                  <div className="mt-3 text-xs text-emerald-600 bg-emerald-50 p-2 rounded">
                    ✓ State-specific permit pricing + TruckerOS platform fee
                  </div>
                </div>

                {/* Notes */}
                {primary.notes && primary.notes.length > 0 && (
                  <div className="p-4 border rounded-lg bg-white">
                    <h3 className="font-semibold mb-2 text-gray-700">Notes</h3>
                    <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                      {primary.notes.map((note: string, i: number) => <li key={i}>{note}</li>)}
                    </ul>
                  </div>
                )}

                {/* Other Suggested Routes (shown below primary recommendation) */}
                {hasMultipleOptions && !isSaved && (
                  <div className="mt-2 pt-4 border-t">
                    <h3 className="font-semibold text-base mb-3 text-gray-700">Other Agent-Suggested Routes</h3>
                    <div className="space-y-3">
                      {agentResult.options.slice(1).map((option: any, index: number) => (
                        <div key={index} className="border rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white">
                          <div>
                            <div className="font-medium">{option.routeCorridor?.join(' → ') || 'Route'}</div>
                            <div className="text-sm text-gray-600">
                              {option.permitRequiredStates?.length || 0} state(s) require permit
                              {option.escortRequiredStates?.length > 0 && ` • ${option.escortRequiredStates.length} escort(s)`}
                              {' '}• Est. ${option.estimatedCost ?? 0}
                            </div>
                          </div>
                          <button
                            onClick={() => handleApproveSpecificOption(option)}
                            disabled={loading}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium disabled:bg-gray-400"
                          >
                            Approve this route
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">These are alternative corridors returned by the routing engine. Review and approve one if the primary is not suitable.</p>
                  </div>
                )}

                {/* Raw Data (collapsible) */}
                <details className="border rounded-lg bg-gray-50 p-4">
                  <summary className="cursor-pointer font-medium text-gray-700 hover:text-gray-900">
                    Show raw agent + database response (for debugging)
                  </summary>
                  <div className="mt-4 grid md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 mb-1">AGENT RESPONSE</h4>
                      <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-80">
                        {JSON.stringify(agentResult || result?.agent, null, 2)}
                      </pre>
                    </div>
                    {(savedToDatabase || result?.savedToDatabase) && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 mb-1">SAVED TO SUPABASE</h4>
                        <pre className="text-xs bg-white p-3 rounded border overflow-auto max-h-80">
                          {JSON.stringify(result?.savedToDatabase, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>

                {/* Clear Button */}
                <button
                  onClick={() => {
                    setResult(null)
                    setAgentResult(null)
                    setSavedToDatabase(false)
                    setShowChangeRouteInput(false)
                    setManualRoute('')
                  }}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Clear results and test another load
                </button>
              </>
            )
          })()}
        </div>
      )}

      {/* Database Schema Helper - For adding new columns */}
      <div className="mt-12 pt-8 border-t">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-700">Database Schema Status</h3>
            <a href="/admin/db" className="text-xs text-blue-600 hover:underline">Open full admin page →</a>
          </div>
          <button
            onClick={checkMigrationStatus}
            disabled={checkingMigration}
            className="text-xs px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-50"
          >
            {checkingMigration ? 'Checking...' : 'Check Status'}
          </button>
        </div>

        {migrationStatus ? (
          <div className="text-sm space-y-2">
            {migrationStatus.hasAdmin ? (
              migrationStatus.columnsExist ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded text-green-700">
                  ✅ All new columns exist (<code>cost_breakdown</code>, <code>distance_miles</code>, <code>duration_hours</code>)
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded">
                  <div className="text-amber-700 mb-2">
                    ⚠️ Migration needed — the new columns are missing from <code>permit_requests</code> table.
                  </div>
                  <button
                    onClick={applyMigration}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded"
                  >
                    Show SQL to Apply Migration
                  </button>
                </div>
              )
            ) : (
              <div className="p-3 bg-gray-100 rounded text-gray-600 text-sm">
                No service role key detected.<br />
                To auto-check, add <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env.local</code>.
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Click "Check Status" to see if the new columns have been added.</p>
        )}

        <p className="text-xs text-gray-400 mt-2">
          This enables saving full cost breakdowns and route metadata from the Permit Agent.
        </p>
      </div>
    </div>
  )
}