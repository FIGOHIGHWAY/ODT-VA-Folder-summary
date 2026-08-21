# Scan Report Normalizer

แปลงไฟล์ HTML export จาก **Tenable Nessus** และ **OWASP ZAP** ให้เป็น JSON schema
เดียวกัน แล้วเก็บลง PostgreSQL ผ่านเว็บแอป SvelteKit — ดูสเปกเต็มได้ที่ [prompt.md](prompt.md)

## Stack

- **Node.js** + **SvelteKit** (frontend upload UI + backend API routes, parser รันฝั่ง server)
- **cheerio** สำหรับ parse HTML (เทียบเท่า BeautifulSoup4 ฝั่ง Node)
- **PostgreSQL** เก็บผลลัพธ์ finding แต่ละรายการ
- **Docker Compose**: `app` (SvelteKit) + `db` (Postgres) + `nginx` (reverse proxy + TLS termination)
- **Nginx** serve ผ่าน **HTTPS** (self-signed cert สำหรับ dev, พร้อม config รองรับ Let's Encrypt/certbot)

## รันด้วย Docker Compose (แนะนำ)

```bash
# 1. สร้าง self-signed TLS cert สำหรับ dev (ครั้งเดียว)
bash nginx/generate-dev-cert.sh

# 2. build + up ทั้งระบบ
docker compose up -d --build

# 3. เปิดเบราว์เซอร์
https://localhost:6767/
```

เว็บ serve ผ่าน HTTPS ที่ **port 6767** (แทน 443 ปกติ เพื่อเลี่ยงชนกับ service
อื่นที่อาจใช้ port 80/443 อยู่แล้วบนเครื่อง) แก้ได้ที่ `docker-compose.yml`
ส่วน `nginx.ports` (`"6767:443"`)

เบราว์เซอร์จะเตือน "ไม่ปลอดภัย" เพราะ cert เป็น self-signed — กด "Advanced → proceed" ได้ตามปกติสำหรับ dev

Migration (`app/migrations/001_init.sql`) จะถูกรันอัตโนมัติตอน Postgres container
สร้างครั้งแรก (ผ่าน `docker-entrypoint-initdb.d`)

### Production

- แทนที่ `nginx/certs/fullchain.pem` และ `privkey.pem` ด้วย cert จริงจาก Let's
  Encrypt/certbot แล้วแก้ `server_name` ใน `nginx/conf.d/default.conf` เป็น
  domain จริง
- เปลี่ยน `POSTGRES_PASSWORD` และ `DATABASE_URL` ใน `docker-compose.yml` เป็นค่า
  ที่ปลอดภัย (แนะนำใช้ `.env` + docker secrets แทนการ hardcode)

## รัน dev แบบไม่ใช้ Docker (ต้องมี Postgres แยกต่างหาก)

```bash
cd app
npm install
psql "$DATABASE_URL" -f migrations/001_init.sql   # หรือปล่อยให้ compose migrate ให้
npm run dev
```

ตั้งค่า `DATABASE_URL` ผ่าน env var (ดีฟอลต์: `postgres://postgres:postgres@localhost:5432/va_scan`)

## Unit tests

```bash
cd app
npx vitest run
```

ครอบคลุม `detectReportType`, `parseNessusHtml`, `parseZapHtml` โดยใช้ sample
HTML ที่ handcraft ไว้ที่ `app/src/lib/server/parsers/__fixtures__/`
(ต้นฉบับอยู่ที่ [samples/](samples/) ด้วย) รวมถึง `real.test.js` ที่ทดสอบด้วย
โครงสร้างที่ตรงกับไฟล์ export จริง (Nessus ที่มี toggle-text div ปนใน title,
ZAP 2.17 "ZAP by Checkmarx" ที่เปลี่ยนโครงสร้างทั้งหมด)

## เข้าสู่ระบบด้วย KKU SSO

ระบบรองรับ login ผ่าน **KKU SSO (SSONext UAT, `sso-uat-api.kku.ac.th`)** —
ปุ่ม "🔐 เข้าสู่ระบบด้วย KKU SSO" อยู่ที่แถบด้านบนทุกหน้า

⚠️ SSO นี้ไม่มี public API docs — โครงสร้าง request/response อ้างจากที่ KKU
ให้มาตรงกับ credential จริงเท่านั้น ถ้าทดสอบแล้วเจอ field ไม่ตรง ดูหมายเหตุ
ท้ายหัวข้อนี้

### ตั้งค่า

1. คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่าที่ได้รับจาก KKU (ตาม "คู่มือการ
   ใช้งาน KKU Single Sign On" ที่ทางมหาวิทยาลัยส่งมา):
   ```
   OAUTH_ISSUER=https://sso-uat-api.kku.ac.th/auth.token   # URL แลก code เป็น token แบบเต็ม (POST /auth.token)
   OAUTH_APP_ID=...                                        # AppID (คนละค่ากับ Client ID) ใช้สร้าง login/logout URL
   OAUTH_CLIENT_ID=...
   OAUTH_CLIENT_SECRET=...
   OAUTH_REDIRECT_URI=https://localhost:6767/callback      # ต้องตรงกับ Redirect URL ที่ลงทะเบียนไว้กับ KKU ตอนขอ App ID
   OAUTH_LOGIN_BASE=https://ssonext.kku.ac.th               # host หน้า login/logout — ของจริงคือค่านี้ ยกเว้น KKU ให้ host UAT แยกมาให้ตั้งแทน
   ALLOWED_EMAILS=phonhat@kku.ac.th                        # เว้นว่างไว้ = ให้ทุกคนที่ login ผ่าน KKU SSO เข้าได้
   ```
   `ALLOWED_EMAILS` คือ allowlist คั่นด้วย comma (case-insensitive) — คนที่
   login ผ่าน SSO สำเร็จแต่ email ไม่อยู่ใน list นี้จะโดนบล็อกที่ `/callback`
   ด้วย 403 (ไม่สร้าง session ให้) ดู logic ที่ `isEmailAllowed()` ใน
   `app/src/lib/server/oauth.js`
2. `docker compose up -d --build app` — `.env` ถูก mount เข้า container `app`
   ผ่าน `env_file` ใน `docker-compose.yml`
3. **ห้าม commit ไฟล์ `.env` จริง** (`.gitignore` กันไว้แล้ว) — เก็บไว้ที่
   `.env.example` เป็น placeholder เท่านั้น

### Flow (อ้างจากเอกสาร "คู่มือการใช้งาน KKU Single Sign On" ที่ KKU ส่งมา)

- `GET /login` → หน้าของแอปเราเอง (branded page) แสดงปุ่ม "🔐 เข้าสู่ระบบด้วย
  KKU SSO" ให้ผู้ใช้กดเอง (ไม่ auto-redirect ทันที) — กดแล้วไปที่
  `/login/start?returnTo=...`
- `GET /login/start` → เก็บ `returnTo` ไว้ใน cookie ชั่วคราว แล้ว redirect ไป
  `{OAUTH_LOGIN_BASE}/login?app={OAUTH_APP_ID}` ตรงตามเอกสาร (endpoint นี้
  **ไม่รับ** `redirect_uri`/`response_type`/`state` เป็น query param — Redirect
  URL ถูกลงทะเบียนไว้กับฝั่ง KKU ล่วงหน้าแล้วตอนขอ App ID/Client ID/Secret)
- `GET /callback` → รับ `?code=...` แล้วแลกเป็น token ด้วย `POST
  {OAUTH_ISSUER}` (เช่น `/auth.token`) body เป็น JSON `{ code, redirectUrl,
  clientId, clientSecret }` — สำเร็จได้ response `{ ok: true, accessToken,
  email, citizenId, firstName, lastName, employeeId }` (ยังเป็น HTTP 200
  ตอน `ok: false` ด้วย ต้องเช็ค field `ok` เอง ไม่ใช่ดู HTTP status), map
  `email`/`firstName`+`lastName` เป็น user id/ชื่อ ที่เก็บใน session — สร้าง
  session ในตาราง `sessions` (Postgres) คืน session id แบบ opaque random
  เป็น cookie (`session_id`, httpOnly) ไม่ยัดข้อมูล user ลง cookie ตรง ๆ
  เพื่อให้ revoke ได้ แล้ว redirect กลับไปหน้าที่ตั้งใจจะเข้าตั้งแต่แรก
  (`returnTo`)
- `GET /logout` → ลบ session row + cookie ของแอปเราก่อน แล้ว redirect ไป
  `{OAUTH_LOGIN_BASE}/logout?app={OAUTH_APP_ID}` เพื่อจบ session ของ KKU SSO
  ทั้งระบบด้วย (ไม่ใช่แค่ในแอปนี้)
- `hooks.server.js` เติม `event.locals.user` ให้ทุก request จาก session
  cookie (ทดสอบแล้ว: ถ้า SSO ยังไม่ตั้งค่าหรือ DB ต่อไม่ได้ ระบบ fallback เป็น
  "ยังไม่ login" ไม่ crash หน้าเว็บ)

**ทดสอบกับ endpoint จริงแล้ว** (ด้วย client id/secret จริงของคุณ):
`/login/start` redirect ไป `ssonext.kku.ac.th/login?app=...` ตรงตามเอกสาร,
`/callback` ยิง token request จริงไปที่ `sso-uat-api.kku.ac.th/auth.token`
และได้ error กลับมาตรงกับที่ endpoint ตอบจริง (`{"ok":false,"error":"Cannot
find the session ..."}`) — ยืนยันว่า URL/JSON body ตรงกับเอกสาร 100%

**สิ่งที่ยังไม่ยืนยัน** เพราะยังไม่ได้ **App ID** จริงจาก KKU (คนละค่ากับ
Client ID ตามเอกสาร) — ตั้ง `OAUTH_APP_ID=` ค้างไว้ กรอกทันทีที่ได้รับแล้ว
ลอง login จริงเพื่อยืนยัน `OAUTH_LOGIN_BASE` (ว่า UAT ใช้ host เดียวกับ prod
`ssonext.kku.ac.th` หรือมี host UAT แยก คล้ายที่ `OAUTH_ISSUER` ของคุณเป็น
`sso-uat-api.kku.ac.th` แทน `ssonext-api.kku.ac.th`)

**ทุกหน้าและทุก API ถูกล็อกไว้หลัง SSO login แล้ว** (`app/src/hooks.server.js`)
— หน้าไหนก็ตามที่ไม่มี session cookie ที่ยังไม่หมดอายุจะถูก redirect ไป
`/login?returnTo=<หน้าที่ตั้งใจจะเข้า>` โดยอัตโนมัติ, ส่วน request ไปยัง
`/api/*` จะได้ `401 { "error": ... }` กลับมาแทน (เพราะเป็น fetch จาก JS ไม่ใช่
browser navigation) หลัง login สำเร็จจะเด้งกลับไปหน้าที่ตั้งใจจะเข้าตั้งแต่แรก
(เก็บไว้ใน cookie `oauth_return_to` ชั่วคราว)

Path ที่เข้าได้โดยไม่ต้อง login (จำเป็นสำหรับ SSO round trip เอง): `/login`,
`/callback`, `/logout`, `/share/*` (ดูหัวข้อ "แชร์ folder" ด้านล่าง), และ
static asset ใต้ `/_app/*` + `/favicon*`

## สรุป finding ด้วย AI (KKU AI Gateway)

แต่ละ domain folder ในหน้าแรกมีปุ่ม **"🤖 สรุปด้วย AI"** — ส่ง finding
ทั้งหมดของ domain นั้น (สูงสุด 40 รายการแรก เรียงตาม severity) ไปให้โมเดลผ่าน
[KKU AI Gateway](https://gen.ai.kku.ac.th) (OpenAI-compatible
`/api/v1/chat/completions`) สรุปเป็นภาษาไทยในรูปแบบคงที่:

```
ให้ดำเนินการตามนี้
- <รายการที่ต้องแก้ไข>
...
หรือหากพบปัญหาการแก้ไขติดต่อมาที่ <AI_SUMMARY_CONTACT_EMAIL>
```

### ตั้งค่า

เพิ่มใน `.env`:
```
KKU_AI_BASE_URL=https://gen.ai.kku.ac.th
KKU_AI_API_KEY=...                      # จาก KKU AI Gateway (คนละตัวกับ KKU SSO)
KKU_AI_MODEL=claude-sonnet-5             # ดู model อื่นได้จาก GET {KKU_AI_BASE_URL}/api/v1/models
AI_SUMMARY_CONTACT_EMAIL=phonhat@kku.ac.th
```
ถ้า `KKU_AI_API_KEY` เว้นว่าง ปุ่ม "🤖 สรุปด้วย AI" จะไม่แสดงเลย
(`isAiConfigured()` ใน `app/src/lib/server/ai.js`) — ไม่ crash หน้าเว็บ

สรุปที่ได้จะ cache ไว้ในตาราง `ai_summaries` (migration `005_add_ai_summaries.sql`,
key เป็น domain — สรุปใหม่ทับของเก่า) โหลดขึ้นมาแสดงอัตโนมัติตอนเปิดหน้าแรก
โดยไม่ต้องกดสรุปใหม่ทุกครั้ง

**ทดสอบกับ endpoint จริงแล้ว**: `POST /api/v1/chat/completions` ของ
`gen.ai.kku.ac.th` ต้องใช้ API key จริง (คนละพฤติกรรมจาก `/api/v1/models` ที่
รับ key อะไรก็ได้) — ทดสอบด้วย key ปลอมได้ error `{"error":"Invalid API
key"}` กลับมาถูกต้อง ยืนยันว่า URL/JSON body/error-parsing ตรงกับ endpoint จริง
รอแค่ API key จริงจาก KKU AI Gateway มากรอกใน `.env`

## แชร์ folder แบบไม่ต้อง login

แต่ละ domain folder ในหน้าแรกกดปุ่ม **"🔗 แชร์"** ได้ — สร้างลิงก์สาธารณะ
(`/share/<token>`) ที่ใครก็เปิดดูได้โดยไม่ต้อง login แต่เห็น **เฉพาะ finding
ของ domain นั้น** เท่านั้น (read-only ไม่มีปุ่มอัปโหลด/ลิงก์ไป domain อื่น)

- `token` เป็น random string ที่เดาไม่ได้ (`crypto.randomBytes(18)`) — ตัวมัน
  เองคือ access control สำหรับ endpoint สาธารณะนี้ ไม่ต้องมี password แยก
- กด "🔗 แชร์" ครั้งแรกจะสร้าง token ใหม่และโชว์ปุ่ม "คัดลอกลิงก์"; กดซ้ำ
  (ถ้ายังไม่ยกเลิก) จะได้ token เดิม ไม่สร้างซ้ำ
- กด **"ยกเลิกแชร์"** เพื่อ revoke — ลิงก์เดิมจะใช้ไม่ได้ทันที (query
  `revoked_at IS NULL` ที่ `resolveShareToken()`)
- การสร้าง/ยกเลิกลิงก์ต้อง login ก่อน (ผ่าน `POST`/`DELETE /api/share` ซึ่ง
  อยู่ใต้ `/api/*` เลยโดน auth gate ตามปกติ) — แต่หน้า `/share/[token]` เอง
  ไม่ต้อง login เพราะอยู่ใน allowlist ของ `hooks.server.js`
- ตาราง `share_links` (migration `004_add_share_links.sql`) เก็บ token ↔
  domain ↔ ใครสร้าง ↔ เวลาสร้าง/revoke

**ทดสอบแล้ว**: เปิดลิงก์แชร์โดยไม่ส่ง cookie อะไรเลยก็เข้าดูได้ (200), เห็น
แต่ข้อมูลของ domain ที่แชร์เท่านั้น (ไม่มี string ของ domain อื่นหลุดมาเลย),
token ผิด/ปลอมได้ 404, revoke แล้ว token เดิมตายทันที (404), และ `/api/share`
ยังต้อง login เหมือน API อื่น ๆ (401 ถ้าไม่มี session)

## ค้นหา

หน้า `/search` (ลิงก์จากปุ่ม "🔍 ค้นหา" บนหน้าแรก) ค้นหา finding ข้าม report
ทั้งหมด แบบ case-insensitive substring match บนคอลัมน์ title, identifier,
description, solution, CVE, target/URL และ domain ของ report ที่ finding
นั้นสังกัดอยู่ — implement ด้วย `ILIKE` ธรรมดาใน `searchFindings()`
(`app/src/lib/server/db.js`), เหมาะกับข้อมูลขนาดปัจจุบัน ถ้าข้อมูลโตมากในอนาคต
ค่อยพิจารณา Postgres full-text search (`tsvector`) แทน

## Dashboard

หน้า `/dashboard` (ลิงก์จากปุ่ม "📊 Dashboard" บนหน้าแรก) สรุปภาพรวม:

- Stat tiles: จำนวน report, finding, domain ที่ถูกสแกน, จำนวนปีที่มีข้อมูล
- กราฟแท่งแนวนอน: จำนวน finding แยกตาม severity รวมทุกปี
- กราฟแท่งซ้อน (stacked bar) แยกตามปี: แต่ละปีแบ่งเป็น severity พร้อม legend,
  hover tooltip ต่อ segment, และปุ่ม "ดูตาราง" สลับไปดูข้อมูลดิบเป็นตาราง
  (สำหรับ accessibility และกรณีสีแยกยากด้วยสายตา)

Query อยู่ที่ `getDashboardSummary()` และ `getYearlyBreakdown()` ใน
`app/src/lib/server/db.js` — ปีคำนวณจาก `findings.imported_at`

## จัดกลุ่มรายงานตาม domain

หน้าแรกแสดงรายงานที่นำเข้าเป็น **folder ต่อ domain** (ยุบ/ขยายได้) โดย domain
คำนวณจาก target ของ finding ส่วนใหญ่ในรายงานนั้น (`pickDomain` ใน
`app/src/lib/server/db.js`) — Nessus ใช้ hostname ตรง ๆ, ZAP ดึง hostname จาก
origin URL รายงานที่ไม่มี target ที่แยกโดเมนได้จะอยู่ใน folder "unknown"

ถ้าอัปเกรดจากฐานข้อมูลเดิม (มี `reports` table อยู่แล้วก่อนมีฟีเจอร์นี้) ต้องรัน
migration `002_add_domain.sql` เอง เพราะ Postgres รัน
`docker-entrypoint-initdb.d` แค่ตอน volume ว่างเปล่าครั้งแรกเท่านั้น:

```bash
docker exec storagevascanhtml-db-1 psql -U postgres -d va_scan \
  -f /docker-entrypoint-initdb.d/002_add_domain.sql
```

แล้ว backfill คอลัมน์ `domain` ให้รายงานเก่า (สคริปต์ตัวอย่างสั้น ๆ รันผ่าน
`docker exec` เข้า container `app` โดยใช้ `pg` ที่มีอยู่แล้ว, ดู logic ที่
`extractDomain`/`pickDomain` ใน `db.js` เป็นตัวอ้างอิง) ส่วน install ใหม่ผ่าน
`docker compose up -d --build` จะรัน migration ทั้งสองไฟล์อัตโนมัติ

## โครงสร้างโปรเจกต์

```
app/
  src/lib/server/parsers/
    detect.js         detectReportType(html, sourceLabel)
    nessus.js         parseNessusHtml(html, sourceLabel)
    zap.js            parseZapHtml(html, sourceLabel)
    index.js          parseReport() — detect + route ไปยัง parser ที่ถูกต้อง
    *.test.js         unit tests (vitest)
  src/lib/server/db.js   insertReport(), listReports(), listFindingsForReport()
  src/routes/
    +page.svelte         หน้าอัปโหลด + รายการ report ที่เคยนำเข้า
    reports/[id]/         หน้ารายละเอียด findings ของ report
    api/parse/+server.js  POST endpoint: parse ไฟล์ที่อัปโหลด → บันทึกลง DB → คืน JSON
  migrations/001_init.sql
  Dockerfile
nginx/
  conf.d/default.conf   HTTPS + reverse proxy → app:3000
  generate-dev-cert.sh  สร้าง self-signed cert สำหรับ dev
docker-compose.yml
```

## API

### `POST /api/parse`

`multipart/form-data` พร้อมฟิลด์ `file` (ไฟล์ HTML export)

**สำเร็จ** (`200`):
```json
{
  "reportId": 1,
  "type": "nessus",
  "insertedCount": 4,
  "findings": [
    {
      "source_tool": "nessus",
      "target": "webserver01.example.com",
      "identifier": "10114",
      "title": "ICMP Timestamp Request Remote Date Disclosure",
      "severity": "critical",
      "description": "...",
      "solution": "...",
      "cvss_score": 9.8,
      "cve": "CVE-2020-12345",
      "affected_url_or_port": "webserver01.example.com",
      "raw_evidence": "..."
    }
  ]
}
```

**parse ไม่สำเร็จ** (`422`) — เช่น export format เปลี่ยนไป:
```json
{ "error": "parseNessusHtml: ไม่พบ target hostname (div font-size:22px;font-weight:700) ใน report.html" }
```

## ข้อควรระวัง

- โครงสร้าง ZAP parser (`app/src/lib/server/parsers/zap.js`) อิงจากรูปแบบ ZAP
  HTML report ทั่วไป (`table` ที่มี `td.alertHead` + row คู่ label/value) — ยังไม่ได้
  ยืนยันกับไฟล์ export จริงทุก version ตามที่ระบุใน [prompt.md](prompt.md) ควร
  เทียบกับไฟล์จริงก่อนใช้งาน production
- Nessus finding ที่ id ซ้ำกัน (เช่น plugin เดียวกันหลาย port) จะไม่ถูก dedupe —
  เก็บทุกแถวไว้ตามสเปก
