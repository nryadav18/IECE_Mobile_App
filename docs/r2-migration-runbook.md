# Cloudinary → Cloudflare R2 Migration Runbook

**Status:** Phases 0–5 COMPLETE. **Zero live Cloudinary references remain in the database.**
`STORAGE_DRIVER=r2` is live on the VPS. Only Phase 6 is left: seven days of watching, then
purge and close the account. Cloudinary still holds every original until then, so every step
remains reversible.
**App state:** live in production (mobile + web portal).
**Guiding rule:** at no point in this plan is a file deleted from Cloudinary before an
identical, byte-verified copy exists in R2 *and* the database has been pointed at it
*and* that has survived a soak period. Every step is reversible.

---

## 0. Decisions locked in

| # | Decision | Choice |
|---|---|---|
| 1 | Cutover strategy | **Phased** — new uploads → R2 first, backfill old in background, flip DB URLs last |
| 2 | Public delivery | **`cdn.iece.org.in`** bound to `iece-media` — connected and verified |
| 3 | Domain on Cloudflare | **`iece.org.in`** — Active on Cloudflare (Free plan) |
| 4 | Cloudinary afterwards | Frozen (no writes) for **7 days**, then purged and closed |
| 5 | Image resizing | **`sharp` on upload**, 3 stored variants — no Cloudflare Images, no per-view cost |
| 6 | Video posters | **Real `.jpg` written next to every `.mp4`** at the same key |
| 7 | Face videos | **Private bucket + server-signed URLs** |
| 8 | R2 key layout | **Mirror Cloudinary exactly** — `iece_images/1712-photo.jpg` |
| 9 | Copy job runs | **Node script on your local machine**, resumable |
| 10 | Rollback safety net | **`assetmigrations` mapping collection** (schemas untouched) |
| 11 | Library size | **Measured** — 189 files, 885 MB to migrate (see §5 Phase 0 results) |
| 12 | Web portal origin | **`cms.iece.org.in`** — used for the `iece-media` CORS rule |

---

## 1. Exactly what is being moved

### 1.1 Every field in MongoDB that holds a cloud URL

There are **seven**. This list is the whole scope; if a URL is not in one of these, it does not exist.

| # | Collection | Field | Holds | Cloudinary folder | Type |
|---|---|---|---|---|---|
| 1 | `activities` | `mediaUrls[]` | activity photos & videos | `iece_images`, `iece_uploads` | image, video |
| 2 | `media` | `imageUrl` | Home banners | `iece_images` | image |
| 3 | `schools` | `mouPdfUrl` | MOU PDF / Word doc | `iece_mous` | raw |
| 4 | `users` | `timetablePdfUrl` | timetable PDF | `iece_mous` | raw |
| 5 | `users` | `registrationPhotoUrl` | **legacy** face video | `facial_registrations` | video |
| 6 | `users` | `faceRegistrations[].registrationPhotoUrl` | per-school face video | `facial_registrations_v2` | video |
| 7 | `leaverequests` | `proofs[]` | leave proof photos & PDFs | `iece_images`, `iece_mous` | image, raw |

Note that a Cloudinary **folder does not map to one collection** — `/upload` routes by MIME
type, so `iece_images` feeds banners, activity photos *and* leave proofs alike.
**Therefore the mapping must be driven from MongoDB outward, never from a folder listing.**
Phase 0 also walks the account in the other direction to find orphans, and reconciles the two.

### 1.2 Where files are written today

- `POST /upload` and `POST /upload/multiple` → `multer-storage-cloudinary` → returns `req.file.path` (the delivery URL). Used by banners, MOUs, timetables, activity media, leave proofs.
- `attendanceController.js:96` and `:358` → direct `cloudinary.uploader.upload()` of a base64 data URI → face videos.

**The mobile app never talks to Cloudinary directly.** Every byte goes through your backend.
This is the single most important fact in this migration: swapping the storage engine
changes behaviour for **every phone already installed**, with **no app-store update**.

### 1.3 Where files are deleted today

`utils/cloudinary.js` — `purgeAssets()` / `destroyAsset()`, which parse the `public_id` back
out of the stored URL and verify the deletion via the Admin API. Called from
`activityController`, `mediaController`, `schoolController` and `utils/faceVideo.js`.

During the coexistence period the app will hold **both** Cloudinary and R2 URLs at once, so
the delete path must route on hostname. That is handled in Phase 2, not later — deleting is
the one operation where getting it wrong loses data permanently.

---

## 2. What Cloudinary does for you that R2 does not

R2 is object storage. It stores and serves bytes. It does not transform anything. Three
features you currently depend on have to be rebuilt, and one of them can break phones in
the field if we get it wrong.

### 2.1 On-the-fly image resizing — REBUILD

`frontend/src/utils/media.js:69` rewrites banner and activity URLs to
`f_auto,q_auto,w_{480|720|1080|1440},c_limit`. R2 has no equivalent.

**Solution:** `sharp` generates the variants at upload time and stores them as sibling keys.

```
iece_images/1712-photo.jpg          ← original, capped at 1600px, quality 82
iece_images/1712-photo_w480.jpg     ← small screens / list thumbnails
iece_images/1712-photo_w1080.jpg    ← full-width hero
```

**Live builds are safe:** `optimizedImageUrl()` returns any non-`res.cloudinary.com` URL
*untouched*. So an already-installed phone receiving an R2 URL just downloads the original.
Correct, only heavier — and the original is now capped at 1600px/q82 instead of a raw 5MB
camera JPEG, so in practice most screens get **faster**, not slower. A future app build adds
an R2 branch to `optimizedImageUrl` to pick `_w480` / `_w1080`.

### 2.2 Video poster frames — REBUILD, AND THIS ONE IS URGENT

`frontend/src/components/ActivityCover.js:46`:

```js
const posterFor = (url) =>
  (typeof url === 'string' && url.endsWith('.mp4')) ? url.replace('.mp4', '.jpg') : url;
```

Cloudinary invents that `.jpg` on demand. R2 will 404 it. **Every phone already in the
field will do this to R2 URLs**, so without a fix every activity video thumbnail breaks the
day we switch.

**Solution:** at upload (and during backfill), extract frame 1 with `ffmpeg` and write it to
the **identical base key**:

```
iece_uploads/1712-clip.mp4
iece_uploads/1712-clip.jpg    ← the URL old builds guess actually exists
```

Zero app changes required. This is non-negotiable and is verified as a hard gate in Phase 4.

### 2.3 Automatic `Content-Type` — REBUILD

Cloudinary sets it from the asset. R2 stores whatever you send; omit it and you get
`application/octet-stream`, which makes videos refuse to play and PDFs download as junk.
Every `PutObject` sets `ContentType` explicitly, plus
`CacheControl: public, max-age=31536000, immutable` (safe because every key is unique).

### 2.5 Deleting is not deleting — the CDN cache (FOUND DURING PHASE 2)

This one was not in the original plan. It was found by testing, not by reading.

Public objects are served through `cdn.iece.org.in`, which is Cloudflare's edge cache, and
they are stored `max-age=31536000, immutable` — correct, because every key is unique and
nothing at a key ever changes. But after a **verified** delete (the S3 API answering 404 for
the key) the public URL still returned **200**, with `cf-cache-status: HIT`.

**A deleted banner or activity photo would stay publicly readable for up to a year.**

`utils/cloudinary.js` already carried this exact lesson — every destroy there passes
`invalidate: true`, with a comment explaining that without it "the file is gone from storage
but edge caches keep serving it for hours, which does not look deleted to anyone actually
checking". R2 has no equivalent flag, so the purge is an explicit API call.

**Solution:** every deletion now batches its stale URLs — the primary object plus its
variants and poster — into one Cloudflare cache-purge call. This needs two credentials that
were not in the original list; see §3.2 items 7–8. Without them, the code logs a loud error
and reports `cdnPurged: false` rather than pretending the file is gone.

### 2.4 What does NOT need changing

- `frontend/src/utils/download.js` — falls back to file extension, so `.mp4` and `.pdf` still classify correctly.
- `PendingRegistrationsScreen` / `RegistrationEvidence` — `expo-video` needs HTTP range requests, which R2 supports natively.
- The web portal — served over the custom domain; only needs a CORS rule (Phase 1).

---

## 3. Cloudflare setup and the exact credentials

### 3.1 Buckets

| Bucket | Access | Holds |
|---|---|---|
| `iece-media` | **Public**, via custom domain | banners, activity media, MOUs, timetables, leave proofs |
| `iece-faces` | **Private**, signed URLs only | face registration videos (both v1 and v2) |

Location hint: **Asia-Pacific (APAC)**. Set at creation, cannot be changed later.

### 3.2 The credentials to create

**Cloudflare dashboard → R2 → Overview**

1. **Account ID** — right-hand sidebar, a 32-char hex string. Also visible in the dashboard URL.

**R2 → Manage R2 API Tokens → Create API Token**

2. Permission: **Object Read & Write**
3. Scope: **Apply to specific buckets** → `iece-media` and `iece-faces` (never account-wide)
4. TTL: no expiry
5. On save you are shown **once**, and never again:
   - **Access Key ID**
   - **Secret Access Key**
   - **Endpoint** — `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

Copy all three immediately. If lost, the token must be rolled and re-issued.

**Bucket → Settings → Public access → Connect Domain**

6. Enter `cdn.<yourdomain>`. Cloudflare adds the DNS record itself if the zone is on your account.

**Cloudflare dashboard → iece.org.in → Overview** (right sidebar)

7. **Zone ID** — a 32-character hex string, different from the Account ID.

**My Profile → API Tokens → Create Token → Create Custom Token**

8. **Cache-purge token.** Permissions: **Zone → Cache Purge → Purge**. Zone Resources:
   **Include → Specific zone → iece.org.in**. This is a *Cloudflare API token*, which is a
   different thing from the *R2 API token* in step 2 — an R2 token cannot purge cache.
   Without it, deleted files stay live at the edge for a year (§2.5).

**Bucket → Settings → CORS policy** (needed for the web portal build)

```json
[{
  "AllowedOrigins": ["https://cms.iece.org.in"],
  "AllowedMethods": ["GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 3600
}]
```

### 3.3 The domain question (your open item)

Go to **dash.cloudflare.com** and look at the Websites list.

- **Domain is listed** → nothing to do. Use `cdn.<thatdomain>`.
- **You own it, DNS is elsewhere** → *Add a site*, then change the nameservers at your
  registrar to the two Cloudflare gives you. Propagation is usually under an hour, and
  **your existing website keeps working throughout** as long as you let Cloudflare import
  the existing records first (it does this automatically — review the imported list before
  confirming).
- **No domain** → start on the free `pub-xxxx.r2.dev` URL. The plan already isolates the
  host in a single env var (`R2_PUBLIC_BASE_URL`), so moving to a custom domain later is a
  one-line change plus one `updateMany` over stored URLs — **no re-upload, ever**.
  Do not stay on `r2.dev` long-term; Cloudflare rate-limits it and says so explicitly.

### 3.4 New `backend/.env` entries

```ini
# --- Cloudflare R2 ---
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_BUCKET_PUBLIC=iece-media
R2_BUCKET_PRIVATE=iece-faces
R2_PUBLIC_BASE_URL=https://cdn.iece.org.in
R2_SIGNED_URL_TTL=900

# Cache purge — REQUIRED for a deletion to actually delete (see 2.5).
CLOUDFLARE_ZONE_ID=
CLOUDFLARE_PURGE_TOKEN=

# Optional. Uploads used to stream past the server to Cloudinary; now they land
# here first, so an unbounded upload is an unbounded disk write.
MAX_UPLOAD_BYTES=314572800

# --- The kill switch ---
# 'cloudinary' | 'r2'   Controls where NEW uploads go. Reads always work for both.
STORAGE_DRIVER=cloudinary
```

**Keep every `CLOUDINARY_*` variable.** They are needed to read during the backfill, to
delete old assets during coexistence, and to roll back.

### 3.5 New npm dependencies

| Package | Why |
|---|---|
| `@aws-sdk/client-s3` | R2 speaks the S3 API |
| `@aws-sdk/s3-request-presigner` | signed URLs for face videos |
| `sharp` | image resizing / re-encoding |
| `fluent-ffmpeg` + `ffmpeg-static` | video poster extraction |
| `p-limit` | concurrency control in the copy script |

### 3.6 Cost

R2 storage **$0.015/GB-month**, **egress $0**, Class A (writes) $4.50/million,
Class B (reads) $0.36/million. Free tier: 10 GB storage, 1M Class A, 10M Class B per month.
For a library of this shape the bill is almost certainly **$0–3/month**, versus Cloudinary's
credit-based plan — and, notably, no more account suspensions when monthly credits run out
(the failure mode `utils/cloudinary.js` already has dedicated handling for).

---

## 4. The code that gets written (Phase 2)

```
backend/utils/storage/index.js       driver selection + hostname-based routing
backend/utils/storage/r2.js          put / delete / head / sign, variant + poster generation
backend/utils/storage/legacy.js      thin wrapper over the existing utils/cloudinary.js
backend/utils/storage/keys.js        the single source of truth for key naming
backend/middleware/signedAssets.js   signs face-video URLs on the way out
```

### 4.1 Deletion routes by hostname — the critical piece

```js
// utils/storage/index.js
async function deleteAssets(urls) {
  const cloudinaryUrls = urls.filter(u => u.includes('res.cloudinary.com'));
  const r2Urls         = urls.filter(u => u.startsWith(process.env.R2_PUBLIC_BASE_URL) || u.startsWith('r2:'));
  // ... merge both reports into the SAME shape purgeAssets() already returns
}
```

The return shape is preserved exactly, so `activityController`, `mediaController`,
`schoolController` and `faceVideo.js` need **no changes at all** — they keep calling
`purgeAssets()` and keep getting `{ ok, requested, deleted, missing, failed, gone, failures, blocked }`.
The verify-after-delete discipline that file already enforces is carried over to R2 (a
`HeadObject` that answers 404 is the proof).

### 4.2 Face videos stay compatible with old builds

The DB stores a canonical private reference: `r2:iece-faces/facial_registrations_v2/<file>.mp4`.

`signedAssets.js` wraps `res.json` — **the exact pattern `middleware/approverVisibility.js:158`
already uses** — and replaces any `r2:` value on a `registrationPhotoUrl` field with a freshly
signed 15-minute HTTPS URL, for admins only. An already-installed phone therefore receives a
perfectly normal `https://…` URL in the JSON and plays it exactly as it does today. **No app
update needed, and the biometric data stops being publicly addressable.**

---

## 5. Execution phases

### PHASE 0 — Audit. Read-only. Zero risk.

`scripts/r2/00-audit.js` — **writes nothing, anywhere.**

1. Scans all seven MongoDB fields, collects every distinct URL, classifies by host/folder/type.
2. Pages the Cloudinary Admin API for every asset in the account with its byte size.
3. Reconciles the two lists and reports:
   - **Referenced** — in the DB and in Cloudinary. This is the migration scope.
   - **Orphans** — in Cloudinary, referenced by nothing. Not migrated; deleted with the account.
   - **Dangling** — referenced by the DB but **not in Cloudinary**. These are *already broken today* and must be understood before we start, or they will look like migration failures later.
4. Writes `migration-audit.json` + a CSV you can open in Excel.

> **GATE 0** — do not proceed until the dangling list has been reviewed and explained.

#### Phase 0 results — run 2026-08-25, GATE 0 CLEAR

| | Files | Bytes | |
|---|---|---|---|
| **Migrate** | **189** | **884.7 MB** | referenced and present |
| Dangling | 60 | — | explained below — not data loss |
| Orphan | 46 | 247.5 MB | not migrated; die with the account |
| External | 0 | — | no non-Cloudinary URLs anywhere |

Breakdown of what gets copied: **124 images** (74.9 MB, plus 248 generated variants),
**63 videos** (808.6 MB, plus 63 required poster frames), **2 documents** (1.1 MB).
Estimated R2 bill: **$0.02/month** — inside the free tier on every axis.

**The 60 dangling references are all face registration videos, and all are expected.**
Every one sits in `facial_registrations_v2`; all 59 affected registration entries are
`approved`; all 55 affected users have a usable face embedding; **zero pending
registrations are affected**. This is `utils/faceVideo.js` working as designed — the
video is a temporary artefact deleted once the Admin decides, and attendance matches
against the embedding, never the recording. What remains is a stale URL string where
the field-nulling did not stick. Nothing to migrate, nothing broken, no user impact.

**Two consequences for the plan:**

1. **The private bucket receives nothing during migration.** All 189 files go to
   `iece-media`. `iece-faces` stays empty until the first new face registration after
   Phase 2 — so the signed-URL layer is proven by new data, not by a backfill.
2. **Phase 5 steps 2 and 3 are no-ops.** `School.mouPdfUrl` and `User.timetablePdfUrl`
   hold zero URLs today. The flip sequence is effectively four steps: banners (1 file),
   leave proofs (7), activities (181), then face videos (none to move).

*Optional housekeeping, unrelated to the migration:* the 60 stale `registrationPhotoUrl`
strings could be nulled. It changes nothing a user sees and is not required.

### PHASE 1 — Cloudflare setup

Everything in Section 3. Then `scripts/r2/01-verify.js`: uploads a 1 KB test object to each
bucket, fetches the public one back over `cdn.<yourdomain>` checking status + `Content-Type`,
signs and fetches the private one, deletes both. **Green output before Phase 2.**

### PHASE 2 — New uploads → R2

1. Deploy the storage layer with `STORAGE_DRIVER=cloudinary`. **Behaviour is unchanged.** Confirm the app is completely normal.
2. Flip to `STORAGE_DRIVER=r2` and restart.
3. Run the test matrix on a real device:

| Test | Check |
|---|---|
| Upload a banner | Appears on Home, loads fast, correct aspect |
| Activity with photos | Grid + detail view render |
| **Activity with a video** | **Thumbnail shows (proves the `.jpg` sibling works)**, plays, seeks |
| Leave request with PDF proof | Uploads, opens, downloads |
| School MOU + user timetable | Upload and open |
| Face registration | Records, submits; **admin review screen plays it** |
| Delete an activity's media | `purgeAssets` report says deleted+verified; URL 404s |
| Delete a banner | Same |
| Old Cloudinary content | **Everything still loads exactly as before** |

4. **Soak 3–7 days.** Existing data is untouched throughout. Rollback = set `STORAGE_DRIVER=cloudinary`, restart. Ten seconds.

> **GATE 2** — every row above green, and no error-log noise for a full week.

#### Phase 2 build results — written and self-tested, NOT yet enabled

`npm run r2:selftest` runs the whole path against the real bucket and passes **25/25**:
a photo, a 3-second video and a PDF go through the actual `/upload` middleware, get
checked, then get deleted and checked again. Worth re-running **on the VPS after
deploying**, because `sharp` and `ffmpeg-static` are per-platform native binaries — they
can be present on a laptop and missing on the server, and if ffmpeg is missing every
activity video gets a broken thumbnail with nothing else reporting it.

What the self-test proves:

| | |
|---|---|
| Images | capped at 1600px, EXIF-rotated, `_w480` + `_w1080` variants written, served as `image/jpeg`, immutably cacheable |
| **Video posters** | **the `.jpg` at the exact URL `ActivityCover.js` guesses exists and returns 200** |
| Video playback | `video/mp4`, range requests answer 206 so `expo-video` can seek |
| Documents | `application/pdf`, not `application/octet-stream` |
| Face videos | stored as `r2:` reference; Admin gets a working signed URL, **CEO and trainers get null** |
| Deletion | primary, variants and poster all removed from the bucket and verified by HEAD |
| Mixed clouds | a Cloudinary URL still routes to Cloudinary after the flag flips |
| Rollback | with `STORAGE_DRIVER=cloudinary`, `upload` is the *identical object* it always was |

**Three bugs were found and fixed by writing that test**, all of which would have reached
production:

1. **Deleted files stayed live on the CDN for a year.** See §2.5 — the fix needs two new
   credentials, and it is the one outstanding item.
2. **Temp files leaked on every upload.** `finalizeUploads` overwrote `file.path` with the
   public URL *before* the cleanup read it, so cleanup was handed a URL instead of a
   filename and deleted nothing. A slow disk fill that surfaces only as a full volume.
3. **`sharp` held an open file handle**, so the temp source could not be unlinked. Silent
   on Linux, permanent on Windows — a bug that never reproduces on the server.

Cleanup now also runs *before* `next()` rather than in a trailing `finally`, so a burst of
uploads cannot leave a pile of files nothing is waiting on.

### PHASE 3 — Backfill copy (background, app unaffected)

`scripts/r2/03-copy.js`, run from `d:\IECE_App\backend` on your machine.

For each referenced URL:
1. Stream it down from Cloudinary, computing SHA-256 as the bytes pass.
2. `PutObject` to R2 at the mirrored key, with explicit `ContentType` and `CacheControl`.
3. Generate derivatives — `_w480` / `_w1080` for images, a `.jpg` poster for videos.
4. `HeadObject` back and compare `ContentLength` to the source byte count.
5. Write/update one document in **`assetmigrations`**:

```js
{ oldUrl, newUrl, bucket, key, resourceType, bytes, sha256,
  model, field, recordId,           // exactly which record points at this file
  variants: ['_w480','_w1080'],     // or posterKey for videos
  status: 'copied' | 'verified' | 'flipped' | 'failed',
  attempts, error, copiedAt, verifiedAt, flippedAt }
```

Properties: **idempotent** (already-`verified` rows are skipped), **resumable** (Ctrl+C and
re-run freely), concurrency-limited to 8, exponential backoff on 429/5xx, and it aborts
loudly if Cloudinary starts returning the account-suspended signature that
`utils/cloudinary.js` already knows how to recognise.

**The app is not touched in this phase. Cloudinary still serves every byte.**

#### Phase 3 result — COMPLETE

**189 files, 884.7 MB, copied in 211 seconds. Zero failures.** The counts reconcile exactly
with the Phase 0 audit: 189 migrated, 60 already-missing (the deliberately-deleted face
recordings), nothing unaccounted for.

#### The proving run that preceded it — 8 files

59.3 MB copied in 20 seconds, every video with its poster, every image with two variants.
An independent check re-downloaded all eight from `cdn.iece.org.in` and compared SHA-256
against the ledger: **all identical**, correct `Content-Type` on every one, and every
poster present at the exact URL an installed build guesses.

**Two more bugs found by running it, both of which would have reached production:**

1. **Two files would have been permanently unreachable.** Two leave-proof PDFs are named
   `iece_mous/1787651280546-Priya%20Weeding%20invitation%20card-1` — with a *literal*
   percent-two-zero in the name, because Cloudinary stored an already-encoded filename and
   encoded it again for delivery (the stored URL reads `%2520`). Building the R2 URL by
   concatenation gives `…Priya%20Weeding…`, which a client decodes back to
   `…Priya Weeding…` — a *different key*. The object would have uploaded fine and then
   404'd forever, and the delete path would never have found it either.
   **Fixed:** `publicUrl` percent-encodes each path segment and `keyFromPublicUrl` is its
   exact inverse; Phase 4 round-trips every stored URL as a hard check.

2. **A real PDF would have stayed unopenable.** Those same two files carry no extension at
   all, and Cloudinary serves them as `application/octet-stream` — despite their first
   bytes reading `%PDF-1.5`. Copying that header across would have faithfully reproduced a
   file the app cannot open. **Fixed:** content type is decided by extension first, then by
   sniffing the actual bytes, and only then by what the source claimed.

### PHASE 4 — Verify

`scripts/r2/04-verify.js` — must be **100% green**, no exceptions:

1. Every referenced URL has an `assetmigrations` row with `status: 'verified'`.
2. Every R2 object exists and its size equals the Cloudinary source's.
3. A random **5% sample** is re-downloaded from *both* sides in full and SHA-256 compared byte-for-byte.
4. **Every `.mp4` has a `.jpg` sibling at the same base key.** Hard failure otherwise.
5. Every image has both `_w480` and `_w1080`.
6. Every object returns the correct `Content-Type` over the public domain.
7. `count(verified) === count(distinct referenced URLs)`.

> **GATE 4** — one single unverified file stops the migration. Fix, re-run, then continue.

#### Phase 4 result — GATE 4 CLEAR

Run at `--sample=100`, so this is not a spot check:

| Check | Result |
|---|---|
| Referenced URLs vs ledger rows | **249 / 249** — nothing skipped |
| Objects present in R2, correct size | **189 / 189** |
| **Byte-for-byte SHA-256, every file** | **189 / 189 identical (884.7 MB)** |
| **Videos with a poster at the guessed key** | **63 / 63** |
| Images with resized variants | 124 / 124 |
| URL round-trip exact | 189 / 189 |
| Failed | **0** |

The gate was also confirmed to bite: with only 8 of 249 files copied it refused to open and
named the 241 referenced URLs that had no ledger row. It derives its own scope from MongoDB
rather than trusting the ledger, precisely so a migration that silently skipped files cannot
report a clean bill of health.

### PHASE 5 — Flip the URLs, one collection at a time

`scripts/r2/05-flip.js --model=<Name>` — a `bulkWrite` using the exact old→new pairs already
recorded in `assetmigrations`. Never a regex, never a string replace over the collection.

Order is by blast radius, **smallest first**, with a **24-hour soak between each**:

| Order | Target | Why here |
|---|---|---|
| 1 | `Media.imageUrl` | Small, highly visible, trivially re-uploadable — the perfect canary |
| 2 | `School.mouPdfUrl` | Low volume, rarely opened |
| 3 | `User.timetablePdfUrl` | Low volume |
| 4 | `LeaveRequest.proofs[]` | Array field, moderate volume |
| 5 | `Activity.mediaUrls[]` | Largest, and where video posters matter |
| 6 | Face videos (both fields) | Last — biometric, private bucket, needs the signing layer proven |

Rollback for any step: `node scripts/r2/05-flip.js --model=Media --rollback`, which reverses
using the same mapping rows. Cloudinary is still live, so the reverted URLs work instantly.

*Optional but cheap:* `mongodump` the `activities` and `users` collections before steps 5 and 6.

Every update is **matched on the old value**, not on position: the write applies only if the
field still holds exactly the URL the ledger recorded. So it cannot clobber something a user
changed mid-migration, cannot corrupt an array whose order shifted, and running it twice does
nothing the second time. `--list` shows every step and where it stands; `--dry-run` prints the
exact pairs.

> **GATE 5** — after each collection, open the app on a real phone and look at that feature.

#### Phase 5 progress

Four of the seven steps have nothing to do — `School.mouPdfUrl`, `User.timetablePdfUrl` and
both face-video fields hold no migratable URLs (the face recordings are all dangling by
design). The real sequence is three steps:

| Step | Field | Files | State |
|---|---|---|---|
| 1 | `Media.imageUrl` | 1 | **Flipped and verified** — serves from R2, SHA-256 matches |
| 4 | `LeaveRequest.proofs[]` | 7 | **Flipped and verified** — all 7 byte-identical on R2 |
| 5 | `Activity.mediaUrls[]` | 181 | **Flipped and verified** — 181/181 byte-identical, 63/63 posters |

Step 4 included the two double-encoded PDFs, which now serve correctly as `application/pdf`
rather than Cloudinary's `application/octet-stream` — they will actually open in the app for
the first time.

**Done. `npm run r2:status` reports 0 Cloudinary and 191 R2 references** across all seven
fields — 189 migrated plus 2 uploaded through the live app since the flag was set, which is
Phase 2 confirming itself in production.

The 60 stale face URLs were cleared with `npm run r2:clear-dangling`, each re-checked against
Cloudinary immediately before writing and all 60 confirmed gone.

**One thing found while enabling the frontend variants:** 29 of the 124 migrated images were
narrower than 1080px, so the copy job had skipped their `_w1080` variant to save space. That
made a resized URL a gamble the client cannot evaluate — a frontend asking for that width
would have 404'd on 23% of images, and a missing variant renders as no image at all. Both the
upload path and the copy job now write every width unconditionally, and
`npm run r2:backfill-variants` filled the 29 gaps.

### PHASE 6 — Freeze, watch 7 days, then purge

`npm run r2:purge-cloudinary` **enforces the wait itself.** It refuses to delete anything
unless all four are true: no live Cloudinary reference remains anywhere in the database
(checked against the collections, not the ledger); every ledger row is settled; the last flip
was at least 7 days ago; and `--confirm` was typed. Dry run is the default. It is the only
irreversible step in the whole migration, and it is the only script that behaves like it.

1. Cloudinary is already receiving no writes (`STORAGE_DRIVER=r2` since Phase 2).
2. Daily check: any document created after cutover containing `res.cloudinary.com` → must be **zero**.
3. Watch: image load errors, video playback failures, face-review complaints.
4. Rotate the Cloudinary API secret and remove it from the running server's env — the last
   safeguard against an accidental write.
5. **Day 7:** re-run `00-audit.js`. If zero live references remain to Cloudinary, purge the
   account by folder and close it.

---

## 6. Why nothing can be lost — the guarantees

| Guarantee | Enforced by |
|---|---|
| No file is missed | Scope comes from MongoDB itself, not a folder listing (Phase 0) |
| No file is silently corrupted | SHA-256 during transfer + size check + 5% full re-compare (Phase 4) |
| No URL is mis-mapped | Every rewrite uses a recorded `oldUrl → newUrl` pair, never a pattern (Phase 5) |
| No deletion goes to the wrong cloud | Delete routes on hostname; both hosts co-exist safely (Phase 2) |
| No phone in the field breaks | Uploads are server-side; `.jpg` siblings satisfy old builds; `optimizedImageUrl` no-ops on R2 URLs |
| No point of no return | Cloudinary holds every original until Day 7 of Phase 6 |
| Rollback at any moment | Env flag (Phase 2), do-nothing (Phases 3–4), `--rollback` (Phase 5) |

---

## 7. Known risks and their handling

| Risk | Severity | Handling |
|---|---|---|
| Old builds guess `.mp4`→`.jpg` posters | **High** | Real `.jpg` written at the same key; hard gate in Phase 4 |
| Missing `Content-Type` breaks video/PDF | High | Set explicitly on every `PutObject`; asserted in Phase 4 |
| Losing the R2 secret (shown once) | Medium | Save to the password manager the moment it appears |
| Cloudinary suspends mid-copy | Medium | Script detects the existing suspension signature and halts cleanly; resumable |
| Devices cached old banner URLs (AsyncStorage) | Medium | **Precisely why Cloudinary stays live 7 days** — cached URLs keep resolving |
| Dangling references (already broken today) | Low | Identified in Phase 0 before they can masquerade as failures |
| `r2.dev` rate limits | Low | Only if you have no domain; custom domain removes it entirely |
| Images heavier on old builds pre-update | Low | 1600px/q82 cap on upload makes most of them *lighter* than today's originals |

---

## 8. Files created on approval

Script number = phase number.

**Built:**

```
backend/utils/storage/index.js       backend/scripts/r2/00-audit.js      Phase 0
backend/utils/storage/r2.js          backend/scripts/r2/01-verify.js     Phase 1
backend/utils/storage/keys.js        backend/scripts/r2/02-selftest.js   Phase 2
backend/utils/storage/media.js       backend/scripts/r2/lib/env.js
backend/utils/storage/presign.js     backend/scripts/r2/lib/mongo.js
backend/middleware/signedAssets.js   backend/scripts/r2/lib/r2client.js
                                     backend/scripts/r2/lib/urlFields.js
```

```
backend/models/AssetMigration.js     backend/scripts/r2/03-copy.js       Phase 3
backend/scripts/r2/lib/references.js backend/scripts/r2/04-verify.js     Phase 4
                                     backend/scripts/r2/05-flip.js       Phase 5
```

Also built: `scripts/r2/06-purge-cloudinary.js` (Phase 6), `status.js`, `clear-dangling.js`,
`backfill-variants.js`.

`npm run` shortcuts: `r2:audit`, `r2:verify`, `r2:selftest`, `r2:copy`, `r2:verify-copy`,
`r2:flip`, `r2:status`, `r2:clear-dangling`, `r2:backfill-variants`, `r2:purge-cloudinary`.

Modified so far: `routes/uploadRoutes.js`, `controllers/attendanceController.js` (2 upload
sites), `controllers/activityController.js`, `controllers/mediaController.js`,
`controllers/schoolController.js`, `utils/faceVideo.js` (import lines only), `server.js`
(one `app.use`), `package.json`, `.gitignore`.

`utils/cloudinary.js` is **kept intact and unmodified** — it becomes the legacy driver.
`controllers/uploadController.js` needed no change at all: `finalizeUploads` sets
`req.file.path` to the delivery URL, exactly as multer-storage-cloudinary did.

---

## 9. Timeline

| Phase | Effort | Elapsed | App risk |
|---|---|---|---|
| 0 — Audit | ~1 h | 1 day | **None** — read-only |
| 1 — Cloudflare setup | ~1 h (+DNS if needed) | 1 day | **None** |
| 2 — New uploads → R2 | ~1 day coding | +3–7 day soak | Low — env-flag rollback |
| 3 — Backfill copy | script runtime | hours to days (size-dependent) | **None** — app untouched |
| 4 — Verify | ~1 h | 1 day | **None** |
| 5 — Flip URLs | 6 steps | ~6 days (24 h soak each) | Low — per-step rollback |
| 6 — Freeze & purge | 7 days watching | 7 days | **None** |

**Total ≈ 3 weeks**, of which almost all is deliberate waiting. Actual hands-on work is ~3 days.

---

## 10. Your next actions

1. **Read this document and approve, or tell me what to change.**
2. Check **dash.cloudflare.com → Websites** and tell me which of the three domain situations applies.
3. On approval I write Phase 0's audit script first — read-only — so we get real numbers
   before a single byte moves.
