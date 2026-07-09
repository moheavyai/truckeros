'use client'

import { organizationDisplayName, useOrganizationContext } from '@/lib/organization-context'

type ActiveCarrierBannerProps = {
  ownOrganizationId?: string | null
}

/**
 * Shows scoped carrier context on equipment / permit pages in Service Mode.
 * Carrier selection lives in the header CarrierSelector.
 */
export default function ActiveCarrierBanner({ ownOrganizationId }: ActiveCarrierBannerProps) {
  const { workspaceMode, effectiveOrganizationId, activeOrganization, accessibleCarriers } =
    useOrganizationContext(ownOrganizationId)

  if (workspaceMode !== 'service') return null

  const scopedOrg =
    activeOrganization ??
    accessibleCarriers.find((carrier) => carrier.id === effectiveOrganizationId) ??
    null

  if (!scopedOrg) {
    return (
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Select a carrier in the workspace bar above to scope this page.
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      Viewing data for{' '}
      <span className="font-semibold">{organizationDisplayName(scopedOrg)}</span>
      {scopedOrg.usdot_number?.trim() && (
        <span className="text-blue-800/80"> (USDOT {scopedOrg.usdot_number.trim()})</span>
      )}
      .
    </div>
  )
}