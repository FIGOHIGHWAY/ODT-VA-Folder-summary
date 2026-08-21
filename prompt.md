# สร้าง Parser สำหรับแปลง Nessus/ZAP HTML Export เป็น JSON

## บริบท
ทีม SOC ของเรามีระบบ VA scan report ที่รับผลสแกนจาก 2 เครื่องมือ: Tenable Nessus 
(infrastructure/network scan) และ OWASP ZAP (web application DAST) โดยรับผลใน 
รูปแบบไฟล์ HTML ที่ export ออกมาจากแต่ละเครื่องมือโดยตรง (native export, ไม่ใช่ 
custom report) ต้องการ parser ที่แปลงไฟล์ HTML เหล่านี้เป็น JSON structure เดียวกัน 
เพื่อเก็บลงฐานข้อมูลกลาง

## เป้าหมาย
เขียน Node.js (ใช้ cheerio) หรือ Python (ใช้ BeautifulSoup4 + lxml) — เลือกอย่างใด
อย่างหนึ่ง — เป็น 2 ฟังก์ชันแยกกัน:

1. `parseNessusHtml(filePath)` — parse ไฟล์ Nessus HTML export
2. `parseZapHtml(filePath)` — parse ไฟล์ ZAP HTML export

ทั้งสองฟังก์ชัน return array ของ object ตาม schema เดียวกัน:

```json
{
  "source_tool": "nessus" | "zap",
  "target": "string (hostname/URL ที่สแกน)",
  "identifier": "string (plugin_id สำหรับ nessus, alert name สำหรับ zap)",
  "title": "string",
  "severity": "critical" | "high" | "medium" | "low" | "info",
  "description": "string",
  "solution": "string",
  "cvss_score": "number | null",
  "cve": "string | null",
  "affected_url_or_port": "string",
  "raw_evidence": "string (เก็บ snippet ต้นฉบับไว้ตรวจสอบย้อนหลัง)"
}
```

## รายละเอียดโครงสร้าง HTML ที่ต้อง parse

### Nessus HTML export
- แต่ละ finding อยู่ใน `<div id="idN">` ที่มี inline style กำหนด `background: #COLOR`
- Mapping สีเป็น severity:
  - `#91243E` → critical
  - `#DD4B50` → high
  - `#F18C43` → medium
  - `#F8C851` → low
  - `#67ACE1` → info
- Title ของ finding อยู่ใน text ของ div นั้นเอง รูปแบบ `{plugin_id} - {plugin_name}` 
  (เช่น "10114 - ICMP Timestamp Request Remote Date Disclosure")
- ถัดจาก div นี้จะมี sibling div (id เดียวกัน + "-container") ที่มีรายละเอียดเป็น 
  คู่ `<div class="details-header">LABEL</div>` ตามด้วย `<div>เนื้อหา</div>` — 
  label ที่ต้องดึงคือ: Synopsis, Description, Solution, Risk Factor, CVSS v2.0/v3.0 
  Base Score, CVE (อาจไม่มีในทุก finding)
- hostname ของ target อยู่ใน `<div>` ก่อนหน้าส่วน vulnerabilities (font-size 22px, 
  font-weight 700)
- ระวัง: finding บางตัว (เช่น Info) อาจซ้ำ id หรือปรากฏมากกว่า 1 ครั้งถ้ามีหลาย port 
  — ให้เก็บทุกรายการไว้ ไม่ dedupe อัตโนมัติ (ให้ layer ถัดไปที่เก็บ DB จัดการ 
  dedupe เอง)

### ZAP HTML export
- โครงสร้างเป็นแบบ alert-based ต่างจาก Nessus — ให้ inspect ไฟล์จริงก่อน parse 
  เพราะยังไม่ได้ยืนยันโครงสร้าง class/id ที่แน่นอน (ผมมีไฟล์ตัวอย่างแต่ยังไม่ได้ 
  แกะละเอียดเท่า Nessus)
- ZAP severity จะมาในชื่อ "Risk" (High/Medium/Low/Informational) และมี "Confidence" 
  แยกต่างหาก (High/Medium/Low) — เก็บทั้งสองค่าไว้ใน raw_evidence หรือเพิ่ม field 
  `confidence` ใน schema ก็ได้
- แต่ละ alert มักมี field: Description, Solution, Reference, CWE ID, WASC ID, 
  Source ID, พร้อม URL/Parameter ที่เจอปัญหา (อาจมีหลาย instance ต่อ 1 alert type)

## ข้อกำหนดเพิ่มเติม
- ต้อง handle กรณีไฟล์ HTML มี encoding เป็น UTF-8 (มีภาษาไทยปนในบางที่)
- ถ้า parse ไม่สำเร็จ (structure ไม่ตรงกับที่คาด เช่น Nessus/ZAP อัพเดท version 
  แล้วเปลี่ยน export format) ให้ throw error ที่บอกชัดเจนว่า parse fail ที่ 
  section ไหน ไม่ใช่ silent fail หรือ return array ว่างเฉยๆ
- เขียน unit test อย่างน้อย 1 เคสต่อฟังก์ชัน โดยใช้ sample ไฟล์ HTML เล็กๆ ที่ 
  handcraft ขึ้นมาเอง (ไม่ต้องพึ่งไฟล์จริง)
- เพิ่มฟังก์ชัน `detectReportType(filePath)` ที่เช็คว่าไฟล์ HTML ที่รับมาเป็น 
  Nessus หรือ ZAP export (เช็คจาก signature เฉพาะตัว เช่น text "Tenable Nessus" 
  หรือ "OWASP ZAP" ที่อยู่ใน head/title ของไฟล์) เพื่อ route ไปยัง parser ที่ถูกต้อง
  อัตโนมัติ

## Output ที่ต้องการ
- ไฟล์โค้ด parser (แยกไฟล์ nessus กับ zap หรือรวมไฟล์เดียวก็ได้ แล้วแต่ความเหมาะสม)
- ไฟล์ test
- README สั้นๆ อธิบายวิธีเรียกใช้ + ตัวอย่าง input/output

## Tech Stack ที่ต้องการ
ให้พัฒนาเป็นระบบเว็บแอปเต็มรูปแบบ (ไม่ใช่แค่ script) โดยใช้ stack ต่อไปนี้:

- **Runtime**: Node.js
- **Framework**: SvelteKit (ใช้ทั้ง frontend UI สำหรับอัปโหลด/ดูผล parse และ backend
  ผ่าน server routes / API routes ของ SvelteKit เอง — parser (`parseNessusHtml`,
  `parseZapHtml`, `detectReportType`) รันฝั่ง server)
- **Database**: PostgreSQL — เก็บผลลัพธ์ JSON ของแต่ละ finding ลงตาราง (ตาม schema
  ที่กำหนดไว้ด้านบน) พร้อม timestamp ที่ import และ reference ไปยังไฟล์ report ต้นฉบับ
- **Containerization**: Docker + Docker Compose — แยก service เป็นอย่างน้อย: app
  (SvelteKit), db (Postgres), reverse proxy (nginx)
- **Reverse Proxy**: Nginx — รับ request หน้าบ้าน, ทำ TLS termination, proxy ไปยัง
  SvelteKit app
- **HTTPS**: ต้อง serve ผ่าน HTTPS (TLS certificate สำหรับ dev ใช้ self-signed
  ได้ เช่นสร้างด้วย openssl หรือ mkcert, สำหรับ production ให้เตรียม config
  รองรับ Let's Encrypt/certbot ได้)

### Output เพิ่มเติมที่ต้องการจาก stack นี้
- `docker-compose.yml` ที่ up ทั้งระบบได้ในคำสั่งเดียว
- Dockerfile สำหรับ SvelteKit app
- Nginx config (`nginx.conf` หรือ conf.d) ที่ตั้งค่า HTTPS + reverse proxy ไปยัง
  SvelteKit app
- Database migration/schema (SQL หรือใช้ ORM เช่น Drizzle/Prisma ก็ได้ แล้วแต่
  ความเหมาะสม) สำหรับตารางเก็บผล findings
- README อัปเดตให้ครอบคลุมวิธี build/run ด้วย Docker Compose และวิธี access
  ผ่าน HTTPS ในเครื่อง dev