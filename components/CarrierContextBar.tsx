'use client'

import CarrierSelector from '@/components/CarrierSelector'
import { useOrganizationContext } from '@/lib/organization-context'
import { filterServiceModeCarriers } from '@/lib/service-mode-scope'
import type { WorkspaceMode } from '@/types/organization'

type CarrierContextBarProps = {
  ownOrganizationId?: string | null
}

export default function CarrierContextBar({ ownOrganizationId }: CarrierContextBarProps) {
  const {
    workspaceMode,
    setWorkspaceMode,
    activeOrganization,
    activeOrganizationId,
    accessibleCarriers,
    setActiveOrganization,
    canEnterServiceMode,
    loading,
  } = useOrganizationContext(ownOrganizationId)

  const handleModeChange = (mode: WorkspaceMode) => {
    setWorkspaceMode(mode)
  }

  return (
    <div className="border-b bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 font-medium">Workspace</span>
          <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
            <button
              type="button"
              onClick={() => handleModeChange('carrier')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                workspaceMode === 'carrier'
                  ? 'bg-black text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Carrier Mode
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('service')}
              disabled={!canEnterServiceMode}
              title={
                canEnterServiceMode
                  ? 'Work on behalf of linked carriers'
                  : 'Requires Permit Clerk access on a carrier'
              }
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                workspaceMode === 'service'
                  ? 'bg-black text-white'
                  : canEnterServiceMode
                    ? 'text-gray-700 hover:bg-gray-100'
                    : 'text-gray-400 cursor-not-allowed'
              }`}
            >
              Service Mode
            </button>
          </div>
        </div>

        {workspaceMode === 'service' && (
          <CarrierSelector
            carriers={filterServiceModeCarriers(accessibleCarriers)}
            activeOrganizationId={activeOrganizationId}
            activeOrganization={activeOrganization}
            loading={loading}
            onSelect={setActiveOrganization}
          />
        )}
      </div>
    </div>
  )
}