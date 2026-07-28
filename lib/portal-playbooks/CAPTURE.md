# Assisted field export (PortalPlaybook drafts)

User-initiated inventory of a **portal page you already opened and logged into**.  
TruckerOS does **not** crawl portals, collect credentials, auto-fill, or auto-submit.

Use this when mapping a new state (or refreshing MO/NE/KS fields) so each state can become `PortalPlaybook` data.

## What you get

On click, the snippet:

1. Collects **visible** form controls as `PlaybookFieldDraft[]`
2. **Downloads** a JSON file with an auto filename (see below)
3. **Copies** the same JSON to the clipboard when `navigator.clipboard` is available
4. **Logs** the array + JSON to the DevTools console
5. **Alerts** field count + filename

```ts
{
  key: string        // slug from name/id/label
  label: string      // visible label (trailing * / "required" stripped)
  required?: boolean
  enumOptions?: string[]  // <select> option texts (skips empty / placeholder-only)
  mapsFrom?: string  // optional; fill later with TruckerOS prefill key
  name?: string
  id?: string
  tagName?: string
  type?: string
}
```

### Filename pattern

```
{hostname}-{last-path-segments}-{ISO-ish-stamp}.json
```

Examples:

- `mcs.modot.mo.gov-Application-10501-2026-07-27_1830.json`
- `mcs.modot.mo.gov-0-254771-2026-07-27_2342.json`

Stamp is local time `YYYY-MM-DD_HHmm`. Path segments are the last non-empty parts of `location.pathname` (sanitized).

### Where the file lands

- **Chrome / Edge** typically save to the browser **Downloads** folder (Edge may not prompt).
- Move the file into the repo at:

  ```
  lib/portal-playbooks/captures/
  ```

- That directory is **gitignored** for `*.json` so raw dumps are not committed by mistake.  
  Either leave dumps untracked, or rename/copy curated fields into a hand-authored playbook (`mo.ts`, `ne.ts`, …).

## Option A — Bookmarklet

1. Create a browser bookmark.
2. Set the URL to the following (one line). Name it e.g. **TruckerOS Capture Fields**.
3. Open the state portal, log in yourself, navigate to the form page.
4. Click the bookmarklet.
5. Confirm the download + alert; optional: paste from clipboard into an editor.

```javascript
javascript:(function(){function slug(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,64)||'field'}function cleanLabel(s){return String(s||'').replace(/\s*\*+\s*required\s*$/i,'').replace(/\s+required\s*$/i,'').replace(/\s*\*+\s*$/g,'').trim()}function labelFor(el){var id=el.id;if(id){var l=document.querySelector('label[for="'+CSS.escape(id)+'"]');if(l&&l.textContent)return cleanLabel(l.textContent)}var p=el.closest('label');if(p&&p.textContent)return cleanLabel(p.textContent);var aria=el.getAttribute('aria-label');if(aria)return cleanLabel(aria);var ph=el.getAttribute('placeholder');if(ph)return cleanLabel(ph);return cleanLabel(el.name||el.id||el.tagName||'field')}function opts(el){if(!el||el.tagName!=='SELECT')return;var o=[];for(var i=0;i<el.options.length;i++){var t=(el.options[i].textContent||'').trim();if(t&&!/^(select|choose|--)/i.test(t))o.push(t)}return o.length?o:undefined}function pad(n){return String(n).padStart(2,'0')}function buildFilename(){var host=(location.hostname||'portal').replace(/[^a-zA-Z0-9._-]+/g,'-');var segs=location.pathname.split('/').filter(Boolean).slice(-2);var pathPart=segs.join('-').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||'page';var d=new Date();var stamp=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'_'+pad(d.getHours())+pad(d.getMinutes());return host+'-'+pathPart+'-'+stamp+'.json'}function downloadJson(json,filename){var blob=new Blob([json],{type:'application/json'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},1500)}var nodes=document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=password]),select,textarea');var out=[],seen={};nodes.forEach(function(el){try{var r=el.getBoundingClientRect();if(r.width<2&&r.height<2)return;if(el.disabled)return;var lab=labelFor(el);var key=slug(el.name||el.id||lab);var n=1,base=key;while(seen[key]){key=base+'_'+(++n)}seen[key]=1;var row={key:key,label:lab,required:!!(el.required||el.getAttribute('aria-required')==='true'),name:el.name||undefined,id:el.id||undefined,tagName:el.tagName.toLowerCase(),type:(el.type||'').toLowerCase()||undefined};var eo=opts(el);if(eo)row.enumOptions=eo;out.push(row)}catch(e){}});var json=JSON.stringify(out,null,2);var filename=buildFilename();console.log('[TruckerOS field capture]',out);console.log(json);console.log('[TruckerOS] download filename:',filename);downloadJson(json,filename);try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(json).then(function(){alert('Captured '+out.length+' fields\nDownloaded: '+filename+'\nJSON also copied to clipboard (and console).')},function(){alert('Captured '+out.length+' fields\nDownloaded: '+filename+'\nClipboard failed — use console / Downloads.')})}else{alert('Captured '+out.length+' fields\nDownloaded: '+filename+'\nClipboard unavailable — use console / Downloads.')}}catch(e){alert('Captured '+out.length+' fields\nDownloaded: '+filename)}})();
```

## Option B — Console snippet

Same idea, easier to edit. On the portal form page:

1. Open DevTools → Console.
2. Paste and run:

```javascript
(function capturePortalFields() {
  function slug(s) {
    return (
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 64) || 'field'
    )
  }

  /** Strip trailing * / "required" noise from portal labels. */
  function cleanLabel(s) {
    return String(s || '')
      .replace(/\s*\*+\s*required\s*$/i, '')
      .replace(/\s+required\s*$/i, '')
      .replace(/\s*\*+\s*$/g, '')
      .trim()
  }

  function labelFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (l?.textContent) return cleanLabel(l.textContent)
    }
    const wrap = el.closest('label')
    if (wrap?.textContent) return cleanLabel(wrap.textContent)
    const aria = el.getAttribute('aria-label')
    if (aria) return cleanLabel(aria)
    const ph = el.getAttribute('placeholder')
    if (ph) return cleanLabel(ph)
    return cleanLabel(el.name || el.id || el.tagName || 'field')
  }

  function enumOptions(el) {
    if (el.tagName !== 'SELECT') return undefined
    const o = []
    for (const opt of el.options) {
      const t = (opt.textContent || '').trim()
      if (t && !/^(select|choose|--)/i.test(t)) o.push(t)
    }
    return o.length ? o : undefined
  }

  function pad(n) {
    return String(n).padStart(2, '0')
  }

  /**
   * {hostname}-{last-path-segments}-{YYYY-MM-DD_HHmm}.json
   * e.g. mcs.modot.mo.gov-Application-10501-2026-07-27_1830.json
   */
  function buildFilename() {
    const host = (location.hostname || 'portal').replace(/[^a-zA-Z0-9._-]+/g, '-')
    const segs = location.pathname.split('/').filter(Boolean).slice(-2)
    const pathPart =
      segs
        .join('-')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'page'
    const d = new Date()
    const stamp =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `_${pad(d.getHours())}${pad(d.getMinutes())}`
    return `${host}-${pathPart}-${stamp}.json`
  }

  function downloadJson(json, filename) {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  const nodes = document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=password]),select,textarea'
  )
  const out = []
  const seen = {}
  nodes.forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 && r.height < 2) return
    if (el.disabled) return
    const label = labelFor(el)
    let key = slug(el.name || el.id || label)
    const base = key
    let n = 1
    while (seen[key]) key = `${base}_${++n}`
    seen[key] = 1
    /** @type {import('./types').PlaybookFieldDraft} */
    const row = {
      key,
      label,
      required: !!(el.required || el.getAttribute('aria-required') === 'true'),
      name: el.name || undefined,
      id: el.id || undefined,
      tagName: el.tagName.toLowerCase(),
      type: (el.type || '').toLowerCase() || undefined,
    }
    const eo = enumOptions(el)
    if (eo) row.enumOptions = eo
    out.push(row)
  })

  const json = JSON.stringify(out, null, 2)
  const filename = buildFilename()

  console.log('[TruckerOS field capture]', out)
  console.log(json)
  console.log('[TruckerOS] download filename:', filename)

  downloadJson(json, filename)

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(json).then(
      () => console.info(`Copied ${out.length} fields to clipboard`),
      () => console.warn('Clipboard write failed — use Downloads / console log')
    )
  }

  alert(
    `Captured ${out.length} fields\nDownloaded: ${filename}\nJSON also in clipboard (when allowed) and console.`
  )

  return { fields: out, filename, json }
})()
```

## After capture

1. Find the download (usually **Downloads**). In Edge, confirm the file there if no save dialog appeared.
2. Move it into `lib/portal-playbooks/captures/` (optional staging; gitignored `*.json`).
3. Curate fields into a playbook under `lib/portal-playbooks/` (e.g. `ne.ts`) — do **not** commit raw dumps by default.
4. Set `mapsFrom` to TruckerOS prefill keys where known (`width`, `tractor_vin`, …).
5. Group fields into `steps[].copyKeys` and fill `enums` / `flags`.
6. Register in `lib/portal-playbooks/index.ts` via `getPlaybook`.

## Rules

| Do | Don’t |
|----|--------|
| Run only on a page **you** opened | Unattended multi-state crawl |
| Capture **visible** labels / options | Store passwords or session tokens |
| Download / copy JSON by hand into the repo | Auto-submit or silent form fill |
| Stay logged in as yourself | Collect carrier portal credentials via the snippet |

## Portal Assist “Export fields” help

Portal Assist may show a short **Export fields** help panel that points here.  
That UI only documents this workflow — it does **not** inject into the portal or run capture for you.
