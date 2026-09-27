// Generates the home-screen icons AND the browser-tab favicons for the ERP,
// CMS and website apps, from one copy of the school crest
// (assets/nkps-crest.png, 709x714, the crest printed on a white page).
// Run once; commit the results. Re-run only when the crest changes.
//
// The crest lives at assets/ rather than in each app because it used to be
// three byte-identical 264KB copies at apps/<app>/src/app/icon.png — where
// Next's file convention also served each one as that app's favicon, so every
// page load fetched a quarter-megabyte PNG to draw a 16px tab icon.
//
//   node scripts/generate-pwa-icons.mjs
//
// Then bump ICON_VERSION in packages/shared/src/lib/pwa-manifest.ts and the
// -vN on CACHE_VERSION in both public/sw.js files, or the new icons reach
// nobody who already installed the app. `pnpm run check:pwa` fails if the two
// drift apart, but nothing can tell that the PNGs themselves changed.
//
// ── What was wrong before ───────────────────────────────────────────────────
//
// The old version `contain`-fitted the source onto a navy square. The source
// is the crest printed on WHITE, not a cutout — so the result was a white
// rectangle floating on a navy one, and iOS rounded that into a tile with a
// visible ring inside it. That ring was the complaint.
//
// It also made both apps the same picture, so two identical icons sat side by
// side on the home screen with only their captions to tell them apart.
//
// ── What this does instead ──────────────────────────────────────────────────
//
// 1. Cuts the shield out of the page, by flood-filling from the crest's centre
//    across everything that isn't page-white. The shield, its outline and its
//    lettering are one connected blob; the arced "NOBLE KINGDOM PUBLIC SCHOOL"
//    is separated from it by white and so is never reached. That text is
//    illegible at 60px anyway — dropping it is what makes the mark readable at
//    the size it is actually looked at.
// 2. Puts the shield full-bleed on a solid field. One colour edge to edge,
//    so there is no box inside a box and nothing for the platform's rounding
//    to expose.
// 3. Gives each app its own field and a three-letter label, because "some
//    differentiator" has to survive being 60px on a wallpaper.
//
// The fields are chosen against the artwork rather than picked. Sampling the
// crest gives three hues — green at 150, yellow at 110, the ribbon's red at
// 25 — so the whole scheme stays inside those: gold lettering on a near-black
// navy for the ERP, and the ribbon's own red taken down to a field for the
// CMS. Both fields are far below the crest in chroma, which is what keeps the
// shield the loudest thing on the tile.

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const CREST = join(REPO_ROOT, "assets", "nkps-crest.png");

const APPS = [
  {
    dir: "erp",
    label: "ERP",
    // navy-900. It reads as a neutral rather than as a blue — oklch C 0.04 at
    // L 0.20 — so it sits under the crest's green without arguing with it,
    // which is the same reason black and charcoal work behind any artwork.
    field: { r: 0x0a, g: 0x16, b: 0x28 },
    ink: "#E5C06E",
  },
  {
    dir: "cms",
    // Deep burgundy — the crest's own ribbon red, oklch(0.25 0.07 25), taken
    // down to a field value. Sampling the crest gives three hues: green at
    // 150, yellow at 110 and the ribbon's red at 25. Blue-700 was at 264,
    // which is the near-complement of that yellow, so the shield's lettering
    // vibrated against it — and at oklch L 0.50 / C 0.20 the field was as
    // saturated as the artwork it was meant to sit behind.
    //
    // Burgundy fixes both. It is inside the school's own three colours, so
    // green-gold-red stays the whole palette; and at L 0.25 / C 0.07 it is
    // dark and quiet enough that the shield is still the only loud thing on
    // the tile. Warm against the ERP's cool navy is also what tells them
    // apart at 60px, which hue alone would not.
    label: "CMS",
    field: { r: 0x3d, g: 0x11, b: 0x0f },
    ink: "#E5C06E",
  },
  {
    // The public site. No label — it is the school, not one of its tools —
    // and it gets a favicon only; there is nothing to install.
    dir: "website",
    label: null,
    field: { r: 0x0a, g: 0x16, b: 0x28 },
    ink: "#E5C06E",
    faviconOnly: true,
  },
];

/** Cut the shield off its white page. Returns a trimmed RGBA PNG buffer. */
async function shieldCutout(srcPath) {
  const { data, info } = await sharp(srcPath)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  const isPage = (p) => {
    const i = p * C;
    return data[i] > 232 && data[i + 1] > 232 && data[i + 2] > 232;
  };

  const seen = new Uint8Array(W * H);
  const start = Math.floor(H / 2) * W + Math.floor(W / 2);
  const stack = [start];
  seen[start] = 1;
  let minX = W, minY = H, maxX = 0, maxY = 0;

  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const y = (p - x) / W;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const np = ny * W + nx;
      if (seen[np] || isPage(np)) continue;
      seen[np] = 1;
      stack.push(np);
    }
  }

  const rgba = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const i = p * C;
    rgba[p * 4] = data[i];
    rgba[p * 4 + 1] = data[i + 1];
    rgba[p * 4 + 2] = data[i + 2];
    rgba[p * 4 + 3] = seen[p] ? 255 : 0;
  }

  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    })
    .png()
    .toBuffer();
}

/**
 * The artwork — shield above, label below — drawn once at 512 on transparent,
 * so every output size is one resize of the same composition rather than a
 * separate layout that can drift.
 */
async function artwork(shield, label, ink) {
  const BOX = 512;
  const SHIELD_H = 300;
  const shieldPng = await sharp(shield)
    .resize({ height: SHIELD_H, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const { width: sw } = await sharp(shieldPng).metadata();

  // Liberation Sans is the metric-compatible Helvetica clone present on this
  // image; the output is a committed PNG, so the font only has to exist where
  // this script runs.
  const layers = [];
  if (label) {
    layers.push({ input: shieldPng, left: Math.round((BOX - sw) / 2), top: 58 });
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${BOX}">
           <text x="${BOX / 2}" y="466"
                 font-family="Liberation Sans, DejaVu Sans, sans-serif"
                 font-size="92" font-weight="bold" letter-spacing="8"
                 text-anchor="middle" fill="${ink}">${label}</text>
         </svg>`
      ),
      left: 0,
      top: 0,
    });
  } else {
    // Unlabelled: the shield uses the whole box, centred.
    const big = await sharp(shield)
      .resize({ height: 420, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    const { width: bw, height: bh } = await sharp(big).metadata();
    layers.push({
      input: big,
      left: Math.round((BOX - bw) / 2),
      top: Math.round((BOX - bh) / 2),
    });
  }

  return sharp({
    create: { width: BOX, height: BOX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

/** The artwork at `inset` of a solid square. */
async function tile(art, field, size, inset) {
  const inner = Math.round(size * inset);
  const scaled = await sharp(art).resize(inner, inner, { fit: "contain" }).toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { ...field, alpha: 1 } },
  })
    .composite([{ input: scaled, gravity: "center" }])
    .png();
}

const shield = await shieldCutout(CREST);

for (const app of APPS) {
  const appRoot = join(REPO_ROOT, "apps", app.dir);
  const art = await artwork(shield, app.label, app.ink);

  // The browser-tab icon, via Next's app/icon.png convention. 128px rather
  // than the crest's 709 — a favicon is drawn at 16-32px, and at that size
  // the three-letter label is a smudge, so the tab icon is the shield alone.
  // The field colour still tells the ERP tab from the CMS one.
  const favicon = await artwork(shield, null, app.ink);
  await (await tile(favicon, app.field, 128, 0.88)).toFile(
    join(appRoot, "src", "app", "icon.png")
  );

  if (app.faviconOnly) {
    console.log(`apps/${app.dir}: favicon written`);
    continue;
  }

  const outDir = join(appRoot, "public", "icons");
  await mkdir(outDir, { recursive: true });

  // Standard icons: a small margin, the field running to the edge.
  await (await tile(art, app.field, 192, 0.88)).toFile(join(outDir, "icon-192.png"));
  await (await tile(art, app.field, 512, 0.88)).toFile(join(outDir, "icon-512.png"));

  // Maskable: Android crops to a circle or squircle, and only the middle 80%
  // is guaranteed to survive it — so the artwork sits inside that.
  await (await tile(art, app.field, 512, 0.7)).toFile(join(outDir, "icon-maskable-512.png"));

  // Apple touch icon: opaque, since iOS paints transparency black.
  await (await tile(art, app.field, 180, 0.88))
    .flatten({ background: app.field })
    .toFile(join(outDir, "apple-touch-icon.png"));

  console.log(`apps/${app.dir}: ${app.label} icons written to public/icons`);
}
