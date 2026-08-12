#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
F=app/profile/page.tsx
[ -f "$F" ] || { echo "missing $F"; exit 1; }
cp "$F" "$F.bak-step2"

# --- 1) Skip duplicate success banner on bootstrap ---
if ! grep -q "Bootstrap success: Step 2 card is enough" "$F"; then
  perl -i -0pe 's/      setSaveMessage\(\{\n        type: finalType,\n        text: finalText,\n      \}\)\n\n      if \(isDriverSelfServiceActor\(profile\)\) \{/      \/\/ Bootstrap success: Step 2 card is enough — skip duplicate green banner.\n      if (!(wasProfileBootstrap && finalType === '\''success'\'')) {\n        setSaveMessage({\n          type: finalType,\n          text: finalText,\n        })\n      } else {\n        setSaveMessage(null)\n      }\n\n      if (isDriverSelfServiceActor(profile)) {/s' "$F"
fi

# --- 2) Bootstrap: stay on Step 2 (no jump to team) ---
if grep -q "keep viewport on Step 2" "$F"; then
  echo "scroll fix already present"
else
  perl -i -0pe 's/      if \(isPrimaryOwner\(profile\) && accessToken\) \{\n        await loadAdminPendingChangeRequests\(accessToken\)\n      \}\n\n      requestAnimationFrame\(\(\) => \{\n        teamSectionRef\.current\?\.scrollIntoView\(\{ behavior: '\''smooth'\'', block: '\''start'\'' \}\)\n      \}\)/      if (isPrimaryOwner(profile) && accessToken) {\n        await loadAdminPendingChangeRequests(accessToken)\n      }\n\n      \/\/ Bootstrap: keep viewport on Step 2. Do not jump to team roster.\n      if (wasProfileBootstrap) {\n        requestAnimationFrame(() => {\n          window.scrollTo({ top: 0, behavior: '\''smooth'\'' })\n        })\n      } else {\n        requestAnimationFrame(() => {\n          teamSectionRef.current?.scrollIntoView({ behavior: '\''smooth'\'', block: '\''start'\'' })\n        })\n      }/s' "$F"
fi

# --- 3) Hide Welcome card when Step 2 is showing ---
if ! grep -q "skip the duplicate Welcome card" "$F"; then
  perl -i -0pe 's/  const showFullWelcomeBanner = showGuidedWelcomeBanner \|\| showTeamRoleWelcome\n  const showGuidedNextSteps =\n    !isProfileBootstrap &&\n    showLandingView &&\n    guidedStep === '\''team_or_equipment'\'' &&\n    canSeeSetupGuidance\(setupActor\)/  const showGuidedNextSteps =\n    !isProfileBootstrap &&\n    showLandingView &&\n    guidedStep === '\''team_or_equipment'\'' &&\n    canSeeSetupGuidance(setupActor)\n  \/\/ Step 2 card already explains next actions — skip the duplicate Welcome card.\n  const showFullWelcomeBanner =\n    (showGuidedWelcomeBanner || showTeamRoleWelcome) && !showGuidedNextSteps/s' "$F"
fi

ok=1
grep -q "Bootstrap success: Step 2 card is enough" "$F" || ok=0
grep -q "keep viewport on Step 2" "$F" || ok=0
grep -q "skip the duplicate Welcome card" "$F" || ok=0
if [[ "$ok" -eq 1 ]]; then
  echo "OK: profile Step 2 cleanup applied"
  rm -f "$F.bak-step2"
  grep -n "Step 2 card is enough\|keep viewport on Step 2\|skip the duplicate Welcome" "$F" | head -10
  exit 0
else
  echo "ERROR: verification failed — restoring backup"
  mv "$F.bak-step2" "$F"
  exit 1
fi
