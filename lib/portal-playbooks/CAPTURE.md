# Assisted field export (PortalPlaybook drafts)

User-initiated inventory of a **portal page you already opened and logged into**.  
TruckerOS does **not** crawl portals, collect credentials, auto-fill, or auto-submit.

Use this when mapping a new state (or refreshing MO/NE/KS fields) so each state can become `PortalPlaybook` data.

## What you get

On click, the snippet collects **visible** form controls and prints JSON matching `PlaybookFieldDraft`:

```ts
{
  key: string        // slug from name/id/label
  label: string      // visible label text
  required?: boolean
  enumOptions?: string[]  // <select> option texts (skips empty / placeholder-only)
  mapsFrom?: string  // optional; fill later with TruckerOS prefill key
  name?: string
  id?: string
  tagName?: string
  type?: string
}
```

## Option A — Bookmarklet

1. Create a browser bookmark.
2. Set the URL to the following (one line). Name it e.g. **TruckerOS Capture Fields**.
3. Open the state portal, log in yourself, navigate to the form page.
4. Click the bookmarklet.
5. Copy the JSON from the alert / page overlay / console (browser-dependent).

```javascript
javascript:(function(){function slug(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,64)||'field'}function labelFor(el){var id=el.id;if(id){var l=document.querySelector('label[for="'+CSS.escape(id)+'"]');if(l&&l.textContent)return l.textContent.trim()}var p=el.closest('label');if(p&&p.textContent)return p.textContent.trim();var aria=el.getAttribute('aria-label');if(aria)return aria.trim();var ph=el.getAttribute('placeholder');if(ph)return ph.trim();return (el.name||el.id||el.tagName||'field').toString()}function opts(el){if(!el||el.tagName!=='SELECT')return;var o=[];for(var i=0;i<el.options.length;i++){var t=(el.options[i].textContent||'').trim();if(t&&!/^(select|choose|--)/i.test(t))o.push(t)}return o.length?o:undefined}var nodes=document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=password]),select,textarea');var out=[],seen={};nodes.forEach(function(el){try{var r=el.getBoundingClientRect();if(r.width<2&&r.height<2)return;if(el.disabled)return;var lab=labelFor(el);var key=slug(el.name||el.id||lab);var n=1,base=key;while(seen[key]){key=base+'_'+(++n)}seen[key]=1;var row={key:key,label:lab,required:!!(el.required||el.getAttribute('aria-required')==='true'),name:el.name||undefined,id:el.id||undefined,tagName:el.tagName.toLowerCase(),type:(el.type||'').toLowerCase()||undefined};var eo=opts(el);if(eo)row.enumOptions=eo;out.push(row)}catch(e){}});var json=JSON.stringify(out,null,2);console.log('[TruckerOS field capture]',out);try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(json).then(function(){alert('Captured '+out.length+' fields — JSON copied to clipboard (also in console).')},function(){prompt('Copy JSON ('+out.length+' fields):',json)})}else{prompt('Copy JSON ('+out.length+' fields):',json)}}catch(e){prompt('Copy JSON:',json)}})();
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
  function labelFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (l?.textContent) return l.textContent.trim()
    }
    const wrap = el.closest('label')
    if (wrap?.textContent) return wrap.textContent.trim()
    const aria = el.getAttribute('aria-label')
    if (aria) return aria.trim()
    const ph = el.getAttribute('placeholder')
    if (ph) return ph.trim()
    return String(el.name || el.id || el.tagName || 'field')
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
  console.log('[TruckerOS field capture]', out)
  console.log(json)
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(json).then(
      () => console.info(`Copied ${out.length} fields to clipboard`),
      () => console.warn('Clipboard write failed — copy from console log')
    )
  }
  return out
})()
```

## After capture

1. Paste JSON into a draft playbook file under `lib/portal-playbooks/` (e.g. `ne.ts`).
2. Set `mapsFrom` to TruckerOS prefill keys where known (`width`, `tractor_vin`, …).
3. Group fields into `steps[].copyKeys` and fill `enums` / `flags`.
4. Register in `lib/portal-playbooks/index.ts` via `getPlaybook`.

## Rules

| Do | Don’t |
|----|--------|
| Run only on a page **you** opened | Unattended multi-state crawl |
| Capture **visible** labels / options | Store passwords or session tokens |
| Copy JSON into the repo by hand | Auto-submit or silent form fill |
| Stay logged in as yourself | Collect carrier portal credentials via the snippet |

## Portal Assist “Export fields” help

Portal Assist may show a short **Export fields** help panel that points here.  
That UI only documents this workflow — it does **not** inject into the portal or run capture for you.
