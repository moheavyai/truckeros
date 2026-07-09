# Merged Review — User Roles Visibility

### Issue 1 — bug
- Landing view: editable roles without Save Profile button; role changes lost
- Fix: On landing (showLandingView), show roles read-only from ownProfile OR add Save Profile button in roles section. Keep editable on bootstrap and when showMemberEditCard.
- **Status**: fixed

### Issue 2 — bug
- Bootstrap helper always shows "Select Owner/Admin" even when canEditRoles false
- Fix: Conditional helper text based on canEditRoles and isProfileBootstrap
- **Status**: fixed

### Issue 3 — suggestion
- Carrier bootstrap copy says select roles first but roles below carrier
- Fix: Update carrier amber copy to reference roles section below; add bootstrap hint on User Roles section
- **Status**: fixed

### Issue 4 — suggestion
- Stale error "under roles" in validateBootstrapCarrierSaveRoles
- Fix: Update message to reference User Roles section
- **Status**: fixed

### Issue 5 — suggestion
- Unused shouldShowUserRolesSection params
- Fix: Use isProfileBootstrap/ownProfile in helper text logic or remove params
- **Status**: fixed

### Issue 6 — suggestion
- Role changes after org exists not saved by carrier save — add hint on User Roles section
- **Status**: fixed

### Issue 7 — suggestion
- Tests: landing read-only vs bootstrap editable cases
- **Status**: fixed