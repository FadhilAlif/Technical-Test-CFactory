# PRODUCT REQUIREMENTS DOCUMENT (PRD)

## CFactory Async Image Processor (CAIP)
### Aplikasi Web Pengolahan Gambar dengan Arsitektur Async Background Worker

| Metadata Dokumen | Nilai |
|------------------|-------|
| **Versi** | 1.0 |
| **Tanggal Terbit** | 2026-11-21 |
| **Status** | Approved |
| **Penulis / Pemilik** | Engineering Candidate — CFactory Technical Assessment |
| **Target Release / Deadline** | 5 Hari Kalender (Sesuai ketentuan submission PDF) |

---

## 1. Latar Belakang & Masalah Bisnis

### 1.1 Latar Belakang
Pengolahan gambar beresolusi tinggi (hingga 20 MB per file dalam format JPEG, PNG, atau WebP) merupakan operasi yang bersifat **CPU-intensive** dan **memory-intensive**. Apabila proses *decoding*, *resizing*, *compression*, dan *format transcoding* dijalankan secara sinkron di dalam *request-response cycle* HTTP API server:
1. **Event Loop Blocking & Thread Starvation**: Proses Node.js yang melayani HTTP request akan terblokir oleh kompresi gambar besar, menurunkan responsivitas endpoint lain dan menyebabkan *request timeout* pada reverse proxy/browser.
2. **Poor User Experience**: Pengguna harus menunggu tanpa kepastian progres dan berisiko mengalami kegagalan jaringan di tengah pemrosesan.
3. **Zero Fault Tolerance**: Jika proses server mengalami *crash* atau *out-of-memory* (OOM) saat memproses satu gambar besar, seluruh koneksi HTTP ikut terputus tanpa jejak status pekerjaan (*job traceability*).

**CFactory Async Image Processor (CAIP)** dibangun untuk mendemonstrasikan pola arsitektur produksi yang realistis dalam memisahkan tanggung jawab antara **HTTP Server (Delegator)** dan **Background Worker (Executor)** untuk tugas pemrosesan gambar asinkron.

### 1.2 Pendekatan Solusi
Sistem dirancang dengan arsitektur **Asynchronous Producer–Consumer (Queue-Based Worker Architecture)** yang terdiri dari tiga komponen utama yang terisolasi:
1. **Interactive Frontend (`Next.js App Router + TypeScript + Tailwind CSS`)**: Menyediakan antarmuka unggah gambar modern, menampilkan `job_id` seketika setelah unggah, melakukan polling status berkala dengan strategi **Exponential Backoff with Jitter**, serta menyediakan pratinjau metrik kompresi dan tautan unduh hasil `.webp`.
2. **Backend API Server — Delegator (`Hono + TypeScript Strict`)**: Menerima unggahan gambar `multipart/form-data`, memvalidasi tipe MIME/magic bytes serta ukuran maksimal 20 MB, menyimpan file sumber ke *shared storage*, mencatat metadata job ke **NeonDB PostgreSQL** dengan status `pending`, mendelegasikan tugas ke **BullMQ (Redis)**, dan segera mengembalikan `HTTP 202 Accepted` berisi `job_id`.
3. **Background Worker — Executor (`Node.js + TypeScript Strict + BullMQ + Sharp`)**: Mengonsumsi antrean secara independen di proses terpisah, mengubah status job secara ketat (`pending` -> `processing` -> `completed` / `failed`), menjalankan pipeline **Resize (maks 1280px longest side, preserve aspect ratio) -> Compress (80% quality) -> Convert to WebP**, menulis output secara atomik, serta menangani *stalled job* dan *graceful shutdown*.

---

## 2. Tujuan Produk & Indikator Keberhasilan

| Kode | Tujuan Produk (Goal) | Deskripsi | Indikator Keberhasilan (Success Metric / KPI) |
|------|----------------------|-----------|------------------------------------------------|
| **G-01** | **Non-Blocking Upload Delegation** | Memastikan server HTTP segera merespons unggahan gambar besar tanpa menunggu proses manipulasi gambar selesai. | Endpoint `POST /api/jobs` mengembalikan `HTTP 202` + `job_id` dalam waktu `< 200ms` (setelah payload upload diterima). |
| **G-02** | **Standardisasi & Optimasi Gambar** | Mengubah gambar input (JPG/PNG/WebP hingga 20 MB) menjadi gambar WebP teroptimasi dengan urutan pipeline baku. | 100% hasil memiliki sisi terpanjang `<= 1280px`, aspect ratio terjaga, kualitas `80%`, dan berformat `.webp`. |
| **G-03** | **Observabilitas Lifecycle & Fault Tolerance** | Menyediakan pelacakan status job real-time dan mekanisme pemulihan apabila worker mengalami kegagalan/crash di tengah proses. | Transisi status akurat `pending -> processing -> completed / failed`; job *stalled* terdeteksi dan dipulihkan atau ditandai `failed` dengan pesan error informatif. |
| **G-04** | **Reproducibility & Production Readiness** | Memastikan penilai teknis dapat menjalankan seluruh stack dengan satu perintah dan meninjau kualitas arsitektur serta pengujian. | Seluruh stack berjalan via `docker compose up --build`; seluruh unit/integration test lulus 100% dan `tsc --noEmit` nol error di mode `strict`. |

---

## 3. Pengguna Target & Persona

| Role Pengguna | Deskripsi Tanggung Jawab | Kebutuhan Utama pada Sistem | Hak Akses |
|---------------|--------------------------|-----------------------------|-----------|
| **End User (Content Creator / Web User)** | Mengunggah gambar mentah berukuran besar (JPG/PNG/WebP hingga 20 MB) untuk dikompresi menjadi WebP siap web. | Antarmuka drag-and-drop responsif, umpan balik `job_id` instan, status real-time, pesan error jelas bila gagal, dan tombol unduh cepat. | Upload file, lihat status job via `job_id`, unduh gambar hasil |
| **Technical Reviewer / Recruiter (CFactory)** | Mengevaluasi kualitas kode TypeScript strict, pemisahan server vs worker, ketahanan arsitektur, dan kelengkapan dokumentasi. | Setup satu perintah (`Docker Compose`), README dengan penjelasan keputusan arsitektur, test suite yang dapat dijalankan, kode bersih dan terstruktur. | Akses seluruh repository, container stack, API endpoints, dan laporan test |
| **System Maintainer / DevOps** | Memantau kesehatan queue, koneksi NeonDB PostgreSQL, Redis, serta stabilitas worker saat terjadi beban tinggi atau crash. | Endpoint healthcheck (`/api/health`), logging terstruktur, *graceful shutdown* pada sinyal `SIGTERM/SIGINT`, dan konfigurasi via environment variables. | Jalankan container, baca log worker/API, kelola environment variables |

---

## 4. Ruang Lingkup Proyek (Scope)

### 4.1 Dalam Ruang Lingkup (In-Scope)
- [x] **Interactive Frontend (Next.js App Router + TypeScript + Tailwind CSS)**:
  - Upload gambar (drag-and-drop & file picker) mendukung format `JPG/JPEG`, `PNG`, `WebP` dengan ukuran maksimal `20 MB`.
  - Validasi awal di sisi klien (tipe file & batas 20 MB) sebelum request dikirim.
  - Tampilan `job_id` dan indikator progres siklus hidup (`pending`, `processing`, `completed`, `failed`).
  - Mekanisme polling efisien menggunakan **Exponential Backoff with Jitter** + `AbortController` dan penghentian otomatis pada status terminal.
  - Tautan/tombol unduh gambar hasil ketika `completed`, dilengkapi perbandingan ukuran/dimensi file.
  - Tampilan pesan error yang jelas dan informatif ketika `failed`, beserta opsi unggah ulang.
- [x] **Backend API Delegator (Hono + TypeScript Strict)**:
  - `POST /api/jobs` untuk unggah gambar (`multipart/form-data`), validasi format (MIME + magic bytes) dan ukuran (`<= 20 MB`), penyimpanan file mentah, pencatatan DB `pending`, enqueue ke BullMQ, dan respons instan `HTTP 202 Accepted` berisi `job_id`.
  - `GET /api/jobs/:jobId` untuk membaca status dan metadata job terkini dari NeonDB PostgreSQL.
  - `GET /api/jobs/:jobId/download` untuk streaming unduhan gambar hasil `.webp` jika status `completed`.
  - `GET /api/health` untuk memverifikasi konektivitas NeonDB PostgreSQL dan Redis.
- [x] **Background Worker Executor (Node.js + BullMQ + Sharp + TypeScript Strict)**:
  - Isolasi proses terpisah dari Backend API Server.
  - Urutan pipeline pemrosesan wajib: (1) Resize maks `1280px` pada sisi terpanjang dengan menjaga aspect ratio (`withoutEnlargement: true`), (2) Compress ke kualitas `80%`, (3) Konversi ke format `WebP`.
  - Penulisan output atomik (`.tmp.webp` -> `rename` -> `.webp`) sebelum status DB diperbarui ke `completed`.
  - Penanganan crash mid-process: BullMQ stalled job recovery, retry dengan backoff, startup state reconciliation, dan `SIGTERM/SIGINT` graceful shutdown.
- [x] **Infrastruktur, Pengujian & Dokumentasi**:
  - Skema PostgreSQL pada **NeonDB** (`/Database/schema.sql`).
  - Setup **Docker Compose** (`docker-compose.yml`) untuk menjalankan Frontend, Backend API, Worker, dan Redis dalam satu perintah.
  - Unit & integration tests menggunakan **Vitest** (validasi input, pipeline Sharp, transisi state job, API delegation).
  - `README.md` lengkap (setup, environment variables, dan penjelasan keputusan arsitektur).

### 4.2 Di Luar Ruang Lingkup (Out-of-Scope)
- ⛔ Sistem autentikasi pengguna penuh (registrasi, login, OAuth2, multi-tenant RBAC) — seluruh pengguna menggunakan alur publik berbasis `job_id` UUID yang tidak dapat ditebak.
- ⛔ Penyuntingan gambar manual di browser (crop interaktif, rotasi manual, filter warna kustom, watermark teks).
- ⛔ Pemrosesan batch multi-file dalam satu request upload atau kompresi file non-gambar (PDF, MP4, GIF animasi multi-frame lanjutan).
- ⛔ Integrasi penyimpanan cloud berbayar eksternal (AWS S3 / GCS / Cloudflare R2) — menggunakan *shared local/Docker volume* dengan antarmuka abstraksi storage yang siap diekstensikan.
- ⛔ Real-time WebSocket / SSE push server (digantikan secara sadar dengan polling *Exponential Backoff* sesuai kriteria bonus assessment).

---

## 5. Spesifikasi Fungsional

### 5.1 Modul Interactive Upload & Job Tracker View (`frontend/`)

**Tujuan**: Memungkinkan pengguna mengunggah gambar hingga 20 MB dengan mudah, memantau proses asinkron secara efisien via `job_id`, serta mengunduh hasil atau membaca pesan error dengan jelas.

#### A. Komponen Antarmuka (UI Components)
| Komponen UI | Tipe Elemen | Fungsi & Perilaku (Behavior) |
|-------------|-------------|------------------------------|
| **Image Dropzone** | Interactive Drag & Drop Area + File Input | Menerima klik atau seret file `.jpg`, `.jpeg`, `.png`, `.webp`. Melakukan pre-validasi ekstensi/MIME dan ukuran `<= 20 MB` secara langsung sebelum submit. |
| **File Preview & Upload Trigger** | Card + Primary Button | Menampilkan nama file asli, ukuran file terformat (MB/KB), dan tombol `"Upload & Process Image"` yang menonaktifkan interaksi ganda saat proses upload berlangsung. |
| **Job Status Card** | Status Container | Menampilkan `job_id` (dengan tombol copy), timestamp pembuatan, dan badge status berkode warna (`pending`: slate/amber, `processing`: blue pulse, `completed`: emerald, `failed`: rose). |
| **Lifecycle Progress Stepper** | 3-Step Visual Indicator | Memvisualisasikan tahapan `pending` -> `processing` -> `completed` (atau berhenti di `failed` dengan indikator merah). |
| **Polling Telemetry Indicator** | Subtle Status Pill | Menampilkan interval backoff polling aktif (misal: `Polling aktif • interval berikutnya 1.0s`) dan otomatis berhenti begitu status terminal tercapai. |
| **Result & Download Panel** | Action Card (Saat `completed`) | Menampilkan dimensi hasil (`width x height`), perbandingan ukuran awal vs akhir (`% savings`), pratinjau gambar WebP, dan tombol unduh `"Download WebP Result"` ke `/api/jobs/:jobId/download`. |
| **Error Alert Banner** | Alert Box (Saat `failed` / Upload Error) | Menampilkan pesan error yang ramah dan spesifik dari server/worker serta tombol `"Try Another Image"` untuk mereset state UI. |

#### B. Struktur State & Data Tampilan UI
| Nama Field State | Sumber Data (API Field) | Tipe Data | Format / Aturan Tampilan |
|------------------|-------------------------|-----------|--------------------------|
| `jobId` | `data.job_id` | `string` (UUID v4) | Teks monospace + tombol salin ke clipboard |
| `status` | `data.status` | `'pending' \| 'processing' \| 'completed' \| 'failed'` | Badge label huruf kapital + ikon status |
| `originalFilename` | `data.original_filename` | `string` | Ditampilkan pada kartu info file |
| `originalSizeBytes` | `data.original_size_bytes` | `number` | Diformat ke KB/MB (misal: `8.42 MB`) |
| `processedSizeBytes` | `data.processed_size_bytes` | `number \| null` | Diformat ke KB/MB + dihitung persentase penghematan tampilan |
| `dimensions` | `data.width`, `data.height` | `number \| null` | Format `{width} × {height} px` |
| `errorMessage` | `data.error_message` | `string \| null` | Ditampilkan penuh di Error Alert Banner saat `failed` |
| `downloadUrl` | `data.download_url` | `string \| null` | Tautan/tombol unduhan langsung saat `completed` |

---

### 5.2 Modul REST API Delegation & File Delivery (`backend-api/`)

**Tujuan**: Bertindak sebagai gerbang HTTP yang cepat, aman, dan non-blocking untuk menerima unggahan gambar, mengekspos status job dari NeonDB PostgreSQL, dan menyajikan file hasil WebP.

#### A. Spesifikasi Endpoint API
| Method & Path | Input Payload / Params | Validasi & Perilaku Server | HTTP Status & Output |
|---------------|------------------------|----------------------------|----------------------|
| `POST /api/jobs` | `multipart/form-data` dengan field `image` | Validasi MIME & magic bytes (`JPG`, `PNG`, `WebP`) serta ukuran (`> 0` dan `<= 20 MB`). Simpan ke `storage/uploads/{job_id}.{ext}`, insert DB `status='pending'`, enqueue BullMQ job, **tanpa menjalankan Sharp**. | `202 Accepted`: `{ "success": true, "data": { "job_id": "uuid", "status": "pending", "original_filename": "...", "original_size_bytes": 12345, "created_at": "ISO8601" } }` |
| `GET /api/jobs/:jobId` | Path param `jobId` (UUID v4) | Validasi format UUID `jobId`. Query metadata & status terkini dari tabel `image_jobs` di NeonDB PostgreSQL. | `200 OK` dengan detail job lengkap; `400 Bad Request` jika UUID invalid; `404 Not Found` jika tidak ada. |
| `GET /api/jobs/:jobId/download` | Path param `jobId` (UUID v4) | Cek record di DB. Jika `status !== 'completed'` tolak dengan HTTP `409 Conflict`. Pastikan file fisik `.webp` ada, lalu stream binary dengan header `Content-Type: image/webp` dan `Content-Disposition: attachment`. | `200 OK` (Binary `.webp` stream); `409 Conflict` jika belum selesai; `404 Not Found` jika job/file hilang. |
| `GET /api/health` | Tidak ada | Menjalankan `SELECT 1` pada NeonDB PostgreSQL pool dan `PING` pada koneksi Redis BullMQ. | `200 OK` (`{ status: "ok", db: "up", redis: "up" }`) atau `503 Service Unavailable`. |

#### B. Format Standard Error Response
Seluruh error dari Backend API dikembalikan dalam format JSON konsisten:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_FILE_TYPE",
    "message": "Unsupported image format. Only JPG, PNG, and WebP images up to 20MB are allowed."
  }
}
```

---

### 5.3 Modul Asynchronous Image Processing Pipeline (`worker/`)

**Tujuan**: Mengeksekusi pemrosesan gambar di proses terpisah dengan urutan operasi yang tepat, transisi state yang konsisten, serta toleransi tinggi terhadap crash/kegagalan.

1. **Pengambilan Job & State Transition (`pending` -> `processing`)**:
   - Worker mengonsumsi job dari queue `image-processing-queue` di Redis.
   - Saat eksekusi dimulai, worker memperbarui baris di tabel `image_jobs`: `status = 'processing'`, `started_at = NOW()`, `attempts = job.attemptsMade + 1`.
2. **Urutan Operasi Sharp (Wajib Berurutan)**:
   - Validasi keberadaan dan keterbacaan file sumber di `storage/uploads/{job_id}.{ext}`.
   - Langkah 1 (**Resize**): `.rotate()` (auto-orient EXIF) diikuti `.resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })` sehingga sisi terpanjang maksimal `1280px` dan aspect ratio tetap terjaga (gambar lebih kecil dari `1280px` tidak diperbesar).
   - Langkah 2 & 3 (**Compress 80% & Convert to WebP**): `.webp({ quality: 80 })` untuk mengompresi gambar ke kualitas 80% dalam format WebP.
3. **Penulisan Atomik & State Transition (`processing` -> `completed`)**:
   - Output ditulis terlebih dahulu ke `storage/processed/{job_id}.tmp.webp`.
   - Setelah proses tulis tuntas dan metadata (`width`, `height`, `size`) tervalidasi, lakukan `fs.rename` atomik menjadi `storage/processed/{job_id}.webp`.
   - Perbarui database NeonDB menjadi `status = 'completed'`, `processed_path`, `processed_size_bytes`, `width`, `height`, `completed_at = NOW()`.
4. **Penanganan Kegagalan & Crash (`processing` -> `failed`)**:
   - Jika file gambar korup atau Sharp melempar error, worker membedakan error permanen (misal file rusak/unsupported input -> langsung fail tanpa retry sia-sia menggunakan `UnrecoverableError`) vs error transien (I/O sementara -> retry maksimal 3 kali dengan exponential backoff).
   - Pada kegagalan final, hapus file `.tmp.webp` jika tersisa dan perbarui database ke `status = 'failed'` dengan `error_message` yang jelas bagi pengguna.
   - Pada crash mendadak (`SIGKILL` / container restart), BullMQ mendeteksi lock timeout (`lockDuration: 30000ms`), menandai job sebagai *stalled*, lalu memproses ulang atau memindahkannya ke `failed` jika melewati `maxStalledCount: 2`.

---

### 5.4 Aturan Bisnis Utama (Business Rules)

| Kode Rule | Pernyataan Aturan Bisnis (Rule Statement) | Lapisan Penegakan (Enforcement Layer) | Penanganan Jika Melanggar (Error Response) |
|-----------|------------------------------------------|---------------------------------------|--------------------------------------------|
| **BR-01** | File yang diunggah wajib berformat gambar valid `JPG/JPEG`, `PNG`, atau `WebP` (diverifikasi melalui MIME type dan *magic bytes* header file, bukan sekadar ekstensi nama file). | Frontend Pre-check + Backend Upload Validation Middleware | Return `HTTP 415 Unsupported Media Type` / `400 Bad Request` dengan pesan format tidak didukung. |
| **BR-02** | Ukuran file unggahan wajib lebih besar dari `0 bytes` dan maksimal `20 MB` (`20,971,520 bytes`). | Frontend Pre-check + Backend Stream Limiter + DB `CHECK` Constraint | Return `HTTP 413 Payload Too Large` / `400 Bad Request` dan batalkan penulisan disk. |
| **BR-03** | Endpoint `POST /api/jobs` wajib bersifat *non-blocking*: dilarang mengeksekusi pemrosesan gambar atau menunggu worker selesai sebelum mengirim respons. | Backend Controller & Service Architecture | Wajib segera mengembalikan `HTTP 202 Accepted` dengan `job_id` dan `status: "pending"`. |
| **BR-04** | Siklus hidup job wajib mengikuti state machine `pending` -> `processing` -> `completed` atau `pending` -> `processing` -> `failed`. Transisi mundur atau lompat status dilarang. | Worker Service + Repository Conditional `UPDATE` + DB `CHECK` Constraint | Query update ditolak/diabaikan jika state asal tidak valid; log anomaly tercatat. |
| **BR-05** | Worker wajib menjalankan operasi transformasi gambar secara berurutan: (1) Resize maks `1280px` pada sisi terpanjang dengan menjaga aspect ratio (`withoutEnlargement: true`), (2) Compress kualitas `80%`, (3) Convert ke format `WebP`. | Worker Sharp Image Pipeline (`imageProcessor.ts`) | Unit test gagal jika dimensi melebihi `1280px`, aspect ratio berubah, atau format output bukan `webp`. |
| **BR-06** | Proses Backend API (`backend-api`) dan Background Worker (`worker`) wajib terisolasi sebagai dua proses/service terpisah; `backend-api` dilarang mengimpor atau memanggil library `sharp`. | Monorepo Package Isolation & ESLint/Architecture Check | Pelanggaran arsitektur fatal; ditolak pada code review dan architecture check. |
| **BR-07** | Endpoint `GET /api/jobs/:jobId/download` hanya boleh mengunduh file apabila status job di database adalah `completed` dan file fisik `.webp` benar-benar ada. | Backend Download Service | Return `HTTP 409 Conflict` jika masih `pending`/`processing`, `HTTP 422`/`404` jika `failed` atau tidak ditemukan. |
| **BR-08** | Worker wajib menulis hasil ke file sementara (`.tmp.webp`) dan melakukan *atomic rename* sebelum mengubah status DB ke `completed`. Jika worker crash atau gagal final, status DB wajib menjadi `failed` dengan `error_message` informatif dan file sementara dibersihkan. | Worker Job Handler & Crash Recovery Mechanism | Mencegah pengguna mengunduh file `.webp` setengah jadi/korup saat terjadi crash. |
| **BR-09** | Seluruh proyek TypeScript (`backend-api`, `worker`, `frontend`) wajib dikompilasi dengan `"strict": true` tanpa error dan menghindari tipe `any` eksplisit maupun implisit. | `tsconfig.json` & CI Typecheck (`tsc --noEmit`) | Build gagal apabila terdapat error strict mode. |
| **BR-10** | Frontend wajib melakukan polling status secara efisien menggunakan strategi *Exponential Backoff* (`500ms` hingga cap `5000ms` + jitter) dan menghentikan polling seketika saat status `completed`/`failed` atau komponen di-unmount. | Frontend Polling Hook (`useJobPolling.ts`) | Mencegah kebocoran memori browser dan membatasi beban request berlebih ke API & NeonDB. |

---

## 6. Spesifikasi Non-Fungsional (NFR)

| Dimensi | Parameter | Spesifikasi / Target |
|---------|-----------|----------------------|
| **Teknologi Backend API** | Runtime & Framework | Node.js 20 LTS + TypeScript 5 (`strict: true`) + Hono (`@hono/node-server`) |
| **Teknologi Background Worker** | Runtime & Engine | Node.js 20 LTS + TypeScript 5 (`strict: true`) + BullMQ + Sharp (`libvips`) |
| **Teknologi Frontend** | Web Framework & Styling | Next.js 15/16 (App Router) + React 19 + TypeScript 5 (`strict: true`) + Tailwind CSS |
| **Penyimpanan Data (Database)** | Database Engine | **NeonDB PostgreSQL** (Serverless PostgreSQL via `pg` Pool, SSL enabled) |
| **Antrean Pesan (Queue)** | Message Broker | **Redis 7** (Alpine Docker image) sebagai backend BullMQ |
| **Penyimpanan File (Storage)** | Media Volume | Local Shared Directory / Docker Named Volume (`./storage/uploads`, `./storage/processed`) |
| **Performa & Response Time** | SLA API | `POST /api/jobs` respons `< 200ms` setelah upload stream selesai; `GET /api/jobs/:jobId` `< 100ms` |
| **Ketahanan & Recovery** | Reliability & Crash Handling | Atomic file write, BullMQ `lockDuration` 30s + `maxStalledCount` 2, graceful shutdown `SIGTERM/SIGINT` |
| **Containerization** | Orchestration | Docker & Docker Compose (`docker compose up --build` menjalankan seluruh stack) |
| **Kualitas Kode & Testing** | Test Runner & Type Safety | Vitest untuk Unit & Integration Tests; 0 error pada `tsc --noEmit` |

---

## 7. Ketentuan Deliverables & Struktur Penyerahan

| Item Deliverable | Format / Path | Status Wajib |
|------------------|---------------|--------------|
| Source Code Monorepo Lengkap | GitHub Repository (`backend-api/`, `worker/`, `frontend/`) | **Wajib** |
| Database Initialization Script | `/Database/schema.sql` (DDL PostgreSQL idempotent siap jalan di NeonDB) | **Wajib** |
| Dokumentasi Setup & Arsitektur | `README.md` (Setup, env vars, dan architectural decisions) | **Wajib** |
| Dokumen Kebutuhan & Arsitektur | `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/USER_STORIES.md`, `docs/USER_FLOW.md`, `docs/USER_GUIDE.md` | **Wajib** |
| Docker Compose Orchestration | `docker-compose.yml` & `Dockerfile` per service (Single-command startup) | **Bonus Point (Dikerjakan)** |
| Unit & Integration Test Suite | `tests/` / per workspace menggunakan Vitest | **Bonus Point (Dikerjakan)** |

---

## 8. Kriteria Penerimaan (Acceptance Criteria & Definition of Done)

### 8.1 Kriteria Minimum (Minimum Viable — Wajib Terpenuhi)
- [ ] User dapat mengunggah gambar JPG, PNG, dan WebP hingga 20 MB melalui antarmuka Next.js.
- [ ] File di luar tipe yang diizinkan atau > 20 MB ditolak dengan pesan error jelas di UI maupun API.
- [ ] `POST /api/jobs` segera mengembalikan `job_id` dengan status `pending` tanpa menunggu worker selesai.
- [ ] Frontend menampilkan `job_id` dan memperbarui status secara otomatis (`pending` -> `processing` -> `completed` / `failed`).
- [ ] Worker memproses gambar di proses terpisah dengan urutan: resize maks 1280px (longest side, aspect ratio terjaga) -> compress 80% -> convert ke WebP.
- [ ] Saat status `completed`, tautan unduh berfungsi dan menghasilkan file `.webp` valid yang sesuai spesifikasi dimensi dan format.
- [ ] Saat status `failed` (misal file gambar rusak/korup), UI menampilkan pesan error informatif.
- [ ] Seluruh service backend, worker, dan frontend terkompilasi bersih dengan TypeScript `"strict": true`.

### 8.2 Kriteria Tingkat Lanjut (Bonus Points — Target Pemenuhan Penuh)
- [ ] **Single-command Docker Compose**: `docker compose up --build` menjalankan Redis, Backend API, Background Worker, dan Frontend secara terintegrasi.
- [ ] **Graceful Crash & Failure Handling**: Worker menangani sinyal `SIGTERM/SIGINT` dengan bersih, mendukung stalled job detection BullMQ, melakukan startup state reconciliation, dan tidak menghasilkan file korup.
- [ ] **Efficient Frontend Polling**: Strategi *Exponential Backoff with Jitter* terimplementasi, teruji, dan berhenti otomatis di state terminal.
- [ ] **Unit & Integration Tests**: Terdapat test terautomasi (Vitest) untuk pipeline Sharp, validator file, state transition repository, dan endpoint API.
- [ ] **Clear Architectural README**: `README.md` menjelaskan cara setup, daftar seluruh environment variables, serta alasan keputusan arsitektur dan trade-offs.

---

## 9. Checklist Kelengkapan & Tinjauan Teknis PRD

### [PRD COMPLETENESS REVIEW]
- [x] **Konteks & Scope Jelas**: Batasan In-Scope vs Out-of-Scope didefinisikan tegas sesuai spesifikasi proyek.
- [x] **Spesifikasi Data Lengkap**: Struktur state UI, kontrak JSON API, tipe data payload, dan constraint 20 MB terdefinisi spesifik.
- [x] **Business Rules Unik**: Seluruh 10 aturan bisnis (`BR-01` s/d `BR-10`) bernomor konsisten, memiliki enforcement layer, dan dapat diuji (testable).
- [x] **Pencegahan Proses Blocking & Isolasi**: Aturan `BR-03` dan `BR-06` melarang pemrosesan gambar di HTTP API server maupun akses DB langsung dari frontend.
- [x] **Non-Functional Spec Realistis**: Target SLA, Hono, BullMQ, Redis, NeonDB PostgreSQL, Sharp, dan Next.js App Router terdefinisi jelas.
- [x] **Acceptance Criteria Testable**: Setiap kriteria Minimum Viable dan Bonus Points bersifat biner dan dapat diverifikasi.

**Skor Kelengkapan**: `100 / 100`
**Rekomendasi**: Dokumen PRD lengkap dan siap menjadi acuan implementasi serta selaras dengan `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/USER_STORIES.md`, dan `docs/USER_FLOW.md`.
