import { isForcedCarrierOwner } from '@/lib/forced-carrier-owner'
// RESTORE IN PROGRESS - see next commit
export function getOwnerBootstrapSetupCardTitle(): string {
  return 'Welcome to MoHeavy AI'
}
export function getOwnerBootstrapSaveButtonLabel(saving: boolean): string {
  return saving ? 'Saving...' : 'Save & continue'
}
