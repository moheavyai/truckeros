# Merged Re-review Round 2

Tests + Security: 0 open. General: 0 open.

### Issue 1 — suggestion
- Server ignores client organization_id — add server-side bootstrap role validation in saveTeamMemberProfileForUser
- **Status**: fixed

### Issue 2 — suggestion
- Add validateBootstrapCarrierSaveRoles server-side mirror
- **Status**: fixed

### Issue 3 — suggestion
- Consolidate organization_id logic — buildCarrierOnlyApiSavePayload delegates to prepareMemberProfileSave for org id
- **Status**: fixed

### Issue 4 — suggestion
- Client after log add payloadOrgId vs savedOrgId comparison
- **Status**: fixed

### Issue 5 — suggestion
- Deep clone formSnapshot including user_roles array
- **Status**: fixed

### Issue 6 — nit
- Fix TS2339 on roleCheck.message with discriminated union
- **Status**: fixed

### Issue 7 — nit
- Document client organization_id is logging-only in buildCarrierOnlyApiSavePayload JSDoc
- **Status**: fixed

### Issue 8 — suggestion
- Add profile-ui test for validateBootstrapCarrierSaveRoles and server bootstrap gate strings
- **Status**: fixed

### Issue 9 — nit
- Align member field disable to carrierSaveInFlight pattern or document asymmetry
- **Status**: fixed