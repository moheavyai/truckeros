#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
F=app/profile/page.tsx
[ -f "$F" ] || { echo "missing $F"; exit 1; }
cp "$F" "$F.bak-step2"

node << 'NODE'
const fs = require('fs');
const path = 'app/profile/page.tsx';
let t = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

// 1) Skip duplicate success banner on bootstrap success
if (!t.includes('Bootstrap success: Step 2 card is enough')) {
  const re = /setSaveMessage\(\{\s*type:\s*finalType,\s*text:\s*finalText,\s*\}\)\s*(?=if\s*\(isDriverSelfServiceActor\(profile\))/;
  if (!re.test(t)) {
    console.error('1/3 banner skip: FAILED');
    process.exit(2);
  }
  t = t.replace(re, `// Bootstrap success: Step 2 card is enough — skip duplicate green banner.\n      if (!(wasProfileBootstrap && finalType === 'success')) {\n        setSaveMessage({\n          type: finalType,\n          text: finalText,\n        })\n      } else {\n        setSaveMessage(null)\n      }\n\n      `);
  console.log('1/3 banner skip: applied');
} else {
  console.log('1/3 banner skip: already present');
}

// 2) Scroll fix
if (t.includes('keep viewport on Step 2')) {
  console.log('2/3 scroll fix: already present');
} else {
  const re = /if\s*\(isPrimaryOwner\(profile\)\s*&&\s*accessToken\)\s*\{\s*await loadAdminPendingChangeRequests\(accessToken\)\s*\}\s*requestAnimationFrame\(\(\)\s*=>\s*\{\s*teamSectionRef\.current\?\.scrollIntoView\(\{\s*behavior:\s*'smooth',\s*block:\s*'start'\s*\}\)\s*\}\)/;
  if (!re.test(t)) {
    console.error('2/3 scroll fix: FAILED');
    process.exit(2);
  }
  t = t.replace(re, `if (isPrimaryOwner(profile) && accessToken) {\n        await loadAdminPendingChangeRequests(accessToken)\n      }\n\n      // Bootstrap: keep viewport on Step 2. Do not jump to team roster.\n      if (wasProfileBootstrap) {\n        requestAnimationFrame(() => {\n          window.scrollTo({ top: 0, behavior: 'smooth' })\n        })\n      } else {\n        requestAnimationFrame(() => {\n          teamSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })\n        })\n      }`);
  console.log('2/3 scroll fix: applied');
}

// 3) Hide welcome when Step 2 showing
if (t.includes('skip the duplicate Welcome card')) {
  console.log('3/3 welcome hide: already present');
} else {
  const re = /const showFullWelcomeBanner\s*=\s*showGuidedWelcomeBanner\s*\|\|\s*showTeamRoleWelcome\s*;?\s*const showGuidedNextSteps\s*=/;
  if (!re.test(t)) {
    console.error('3/3 welcome hide: FAILED');
    process.exit(2);
  }
  t = t.replace(re, 'const showGuidedNextSteps =');
  const re2 = /(const showGuidedNextSteps\s*=\s*[\s\S]*?canSeeSetupGuidance\(setupActor\)\s*)\n(\s*const guidedCopy)/;
  if (!re2.test(t)) {
    console.error('3/3 welcome hide: FAILED end of block');
    process.exit(2);
  }
  t = t.replace(re2, `$1\n  // Step 2 card already explains next actions — skip the duplicate Welcome card.\n  const showFullWelcomeBanner =\n    (showGuidedWelcomeBanner || showTeamRoleWelcome) && !showGuidedNextSteps\n$2`);
  console.log('3/3 welcome hide: applied');
}

fs.writeFileSync(path, t);
if (!t.includes('Bootstrap success: Step 2 card is enough') || !t.includes('keep viewport on Step 2') || !t.includes('skip the duplicate Welcome card')) {
  console.error('ERROR: verification failed');
  process.exit(1);
}
console.log('OK: profile Step 2 cleanup complete');
NODE

if [[ $? -ne 0 ]]; then
  echo "Restoring backup"
  mv "$F.bak-step2" "$F"
  exit 1
fi
rm -f "$F.bak-step2"
grep -n "Step 2 card is enough\|keep viewport on Step 2\|skip the duplicate Welcome" "$F" | head -10
