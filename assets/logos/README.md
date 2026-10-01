# School crest — vector masters

| File | What it is | Use it for |
| --- | --- | --- |
| `nkps-crest.svg` | Full crest: "NOBLE KINGDOM PUBLIC SCHOOL" arc, shield, motto ribbon | Anything large enough to read the arc: print, letterheads, banners, PDFs |
| `nkps-shield.svg` | The shield alone | Anything under ~100px, and on dark backgrounds where the arc's dark ink disappears |

Converted from the school's CorelDRAW original (`LOGO-i.cdr`, via libcdr's
`cdr2xhtml`). The .cdr only carries single-ink variants (magenta, blue), so the
masters are that vector geometry recoloured to the crest's printed colours:
green field `#22884A` (radial), yellow border/lettering `#F7E80F` / `#FFF212`,
ribbon red `#D3282F`, title ink `#333333`.

The apps never read these directly. `node scripts/generate-pwa-icons.mjs`
derives every raster from them — `apps/*/public/images/logo.png`, favicons,
PWA icons, the website's OG mark — so edit the SVGs and re-run it, then bump
`ICON_VERSION` as that script's header explains.
