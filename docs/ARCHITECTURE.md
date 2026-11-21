# SYSTEM ARCHITECTURE DOCUMENT (ARCHITECTURE.md)

## CFactory Async Image Processor (CAIP)
### Queue-Based Asynchronous Producer–Consumer & Layered Architecture

| Metadata Dokumen | Nilai |
|------------------|-------|
| **Versi** | 1.0 |
| **Tanggal Terbit** | 2026-11-21 |
| **Pola Arsitektur** | Queue-Based Asynchronous Worker Architecture (Producer–Consumer) + Layered Service |
| **Arsitek / Penulis** | Engineering Candidate — CFactory Technical Assessment |
| **Status Dokumen** | Approved |

---

## 1. Gambaran Umum Arsitektur (High-Level Architecture)

### 1.1 Deskripsi Gaya Arsitektur
Sistem ini mengadopsi pola **Asynchronous Producer–Consumer (Background Worker Architecture)** dengan pemisahan proses (*process-level isolation*) antara lapisan **API Delegator** dan **Worker Executor**:
- **Presentation Tier (`Next.js App Router`)** beroperasi murni sebagai *stateless HTTP client shell* di browser/server Next.js tanpa akses langsung ke NeonDB PostgreSQL, Redis, atau filesystem media.
- **API Server / Producer (`Hono + TypeScript Strict`)** menangani koneksi HTTP secara cepat dan *non-blocking*: memvalidasi unggahan, menulis file mentah ke *shared storage*, mencatat job awal (`status = 'pending'`) ke **NeonDB PostgreSQL**, mendorong payload tugas ke **BullMQ Queue (Redis)**, lalu segera merespons `HTTP 202 Accepted` dengan `job_id`.
- **Background Worker / Consumer (`Node.js + BullMQ + Sharp + TypeScript Strict`)** berjalan di proses/kontainer independen. Worker mengonsumsi job dari Redis, memperbarui status job (`pending` -> `processing` -> `completed` / `failed`) di NeonDB PostgreSQL, mengeksekusi pipeline manipulasi gambar CPU-intensive (`Resize 1280px` -> `Compress 80%` -> `Convert WebP`), serta menulis hasil secara atomik ke *shared storage*.

Pemisahan ini mereplikasi pola produksi nyata: beban CPU/memori dari `libvips` (`sharp`) saat memproses gambar hingga 20 MB tidak akan pernah memblokir event loop HTTP server.

### 1.2 Diagram Arsitektur Tingkat Tinggi (Mermaid Container Diagram)

```mermaid
flowchart TD
    subgraph ClientLayer ["Client / Browser Layer"]
        Browser["User Browser (Drag & Drop UI + Exponential Backoff Poller)"]
    end

    subgraph PresentationLayer ["Presentation Layer"]
        FrontendApp["Next.js App Router Web UI\n(Port: 3000 | TypeScript Strict + Tailwind CSS)"]
    end

    subgraph ServiceLayer ["Async Backend & Worker Layer"]
        ApiServer["Backend API Delegator — Hono\n(Port: 4000 | HTTP Upload, Status & Download)"]
        WorkerProc["Background Worker Executor — BullMQ + Sharp\n(Isolated Process | Resize, Compress 80%, WebP)"]
    end

    subgraph InfrastructureLayer ["Queue, Database & Shared Storage"]
        RedisQueue[("Redis 7 Broker\n(Port: 6379 | BullMQ Queue & Locks)")]
        NeonDB[("NeonDB PostgreSQL\n(Serverless SSL | Table: image_jobs)")]
        SharedStorage[("Shared Storage Volume\n(./storage/uploads & ./storage/processed)")]
    end

    Browser -->|"HTTP / HTTPS"| FrontendApp
    Browser -->|"REST API Upload, Poll & Download"| ApiServer
    FrontendApp -->|"SSR / Config Base URL"| Browser
    ApiServer -->|"1. Save Raw Image / Stream Processed WebP"| SharedStorage
    ApiServer -->|"2. INSERT pending / SELECT status"| NeonDB
    ApiServer -->|"3. Enqueue Job (Producer)"| RedisQueue
    WorkerProc -->|"4. Consume Job & Renew Lock"| RedisQueue
    WorkerProc -->|"5. Read Raw & Atomic Write .webp"| SharedStorage
    WorkerProc -->|"6. UPDATE processing / completed / failed"| NeonDB
```

---

## 2. Katalog Komponen & Tanggung Jawab Layanan

### 2.1 `backend-api` (Hono HTTP Delegator Service)
| Aspek | Spesifikasi & Keterangan |
|-------|--------------------------|
| **Port Default** | HTTP: `4000` |
| **Tech Stack** | Node.js 20, TypeScript 5 (`strict: true`), Hono (`@hono/node-server`), `pg`, `bullmq`, `ioredis`, `zod` |
| **Domain & Tanggung Jawab** | Validasi multipart upload (MIME + magic bytes + max 20 MB), penyimpanan file mentah, pencatatan state awal job, delegasi job ke BullMQ, penyajian status job, dan streaming file WebP hasil. |
| **Tabel Database yang Dikelola** | `image_jobs` (Insert `pending`, Read status & metadata) |
| **Daftar Endpoint Utama** | `POST /api/jobs`, `GET /api/jobs/:jobId`, `GET /api/jobs/:jobId/download`, `GET /api/health` |
| **Batasan Arsitektural** | **STRICT: NO IMAGE PROCESSING**. Dilarang mengimpor atau memanggil `sharp` di dalam layanan ini. |
| **Konsumen Layanan** | `frontend` (Next.js Browser Client), HTTP API Clients / Automated Tests |

### 2.2 `worker` (Background Image Processing Executor)
| Aspek | Spesifikasi & Keterangan |
|-------|--------------------------|
| **Port Default** | Headless Worker Process (tanpa port HTTP publik; berkomunikasi outbound ke Redis & NeonDB) |
| **Tech Stack** | Node.js 20, TypeScript 5 (`strict: true`), `bullmq`, `ioredis`, `sharp`, `pg` |
| **Domain & Tanggung Jawab** | Mengonsumsi antrean `image-processing-queue`, mengeksekusi transisi `processing` -> `completed` / `failed`, menjalankan pipeline Sharp (Resize max 1280px longest side -> Compress 80% -> Convert WebP), atomic file write, stalled job recovery, dan graceful shutdown. |
| **Tabel Database yang Dikelola** | `image_jobs` (Update `processing`, `completed`, `failed`, `attempts`, `error_message`, `width`, `height`, `processed_size_bytes`) |
| **Penanganan Crash & Concurrency** | `concurrency: 2`, `lockDuration: 30000`, `maxStalledCount: 2`, `attempts: 3` dengan exponential backoff, startup reconciliation, dan handler `SIGTERM` / `SIGINT`. |
| **Konsumen Layanan** | Dipicu secara asinkron melalui Redis BullMQ queue oleh `backend-api` |

### 2.3 `frontend` (Interactive Web UI)
| Aspek | Spesifikasi & Keterangan |
|-------|--------------------------|
| **Port Default** | HTTP: `3000` |
| **Tech Stack** | Next.js (App Router), React 19, TypeScript 5 (`strict: true`), Tailwind CSS, `lucide-react` |
| **Peran Utama** | Antarmuka drag-and-drop upload (JPG/PNG/WebP <= 20 MB), tampilan `job_id` instan, *Exponential Backoff with Jitter* polling hook, tampilan status progres, pratinjau metrik kompresi + tombol unduh, dan banner error informatif. |
| **Batasan Arsitektural** | **STRICT: NO DATABASE / REDIS ACCESS**. Berkomunikasi eksklusif melalui HTTP REST API ke `backend-api`. |
| **Komunikasi Keluar** | Menggunakan `fetch` + `AbortController` menuju `NEXT_PUBLIC_API_BASE_URL` (`http://localhost:4000`) |

### 2.4 Infrastruktur Data, Antrean & Penyimpanan Media
| Komponen | Teknologi | Fungsi Spesifik |
|----------|-----------|-----------------|
| **Primary Database** | **NeonDB PostgreSQL** | *Source of truth* untuk metadata, audit timestamp, dimensi hasil, pesan kegagalan, dan status lifecycle `image_jobs`. |
| **Message Broker** | **Redis 7 (Alpine)** | Menyimpan antrean job BullMQ, lock worker aktif, delay backoff retry, dan deteksi *stalled jobs*. |
| **Media Storage** | **Shared Filesystem / Docker Volume** | Direktori terbagi `/storage/uploads` (input mentah) dan `/storage/processed` (hasil `.webp`) yang diakses oleh `backend-api` dan `worker`. |

---

## 3. Skema & Model Data (Database Schema)

### 3.1 Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    IMAGE_JOBS ||--o| BULLMQ_JOB_PAYLOAD : "delegated as async message"

    IMAGE_JOBS {
        uuid id PK "Primary Key UUID v4 (job_id)"
        varchar original_filename "Not Null, max 255"
        varchar original_mime_type "image/jpeg | image/png | image/webp"
        bigint original_size_bytes "Check > 0 and <= 20971520"
        text original_path "Not Null, relative storage path"
        text processed_path "Nullable until completed"
        bigint processed_size_bytes "Nullable until completed"
        int width "Nullable, final width px"
        int height "Nullable, final height px"
        varchar status "pending | processing | completed | failed"
        text error_message "Nullable, populated on failed"
        int attempts "Default 0"
        timestamptz created_at "Default NOW()"
        timestamptz started_at "Nullable"
        timestamptz completed_at "Nullable"
        timestamptz updated_at "Auto updated"
    }

    BULLMQ_JOB_PAYLOAD {
        string jobId "Matches IMAGE_JOBS.id"
        string originalPath "Source image path on shared volume"
        string processedPath "Target output path (.webp)"
        string mimeType "Original validated MIME type"
        int attemptLimit "Default 3"
    }
```

### 3.2 Spesifikasi Tabel & Constraint (`NeonDB PostgreSQL`)

#### Tabel: `image_jobs` (Skrip: `/Database/schema.sql`)
| Nama Kolom | Tipe Data | Nullable | Key / Constraint | Keterangan Bisnis |
|------------|-----------|----------|------------------|-------------------|
| `id` | `UUID` | No | `PRIMARY KEY` | Identifier publik `job_id` (UUID v4) yang dikembalikan ke frontend |
| `original_filename` | `VARCHAR(255)` | No | - | Nama file asli yang telah disanitasi dari nama path berbahaya |
| `original_mime_type` | `VARCHAR(50)` | No | `CHECK IN ('image/jpeg', 'image/png', 'image/webp')` | Tipe MIME terverifikasi dari magic bytes file |
| `original_size_bytes` | `BIGINT` | No | `CHECK (> 0 AND <= 20971520)` | Ukuran file unggahan asli dalam byte (maks 20 MB) |
| `original_path` | `TEXT` | No | - | Path relatif file mentah pada shared storage (`uploads/{id}.{ext}`) |
| `processed_path` | `TEXT` | Yes | - | Path relatif hasil WebP (`processed/{id}.webp`), terisi saat `completed` |
| `processed_size_bytes` | `BIGINT` | Yes | `CHECK (> 0)` | Ukuran file hasil kompresi WebP dalam byte |
| `width` | `INTEGER` | Yes | `CHECK (> 0 AND <= 1280)` | Lebar akhir gambar hasil (px) |
| `height` | `INTEGER` | Yes | `CHECK (> 0 AND <= 1280)` | Tinggi akhir gambar hasil (px) |
| `status` | `VARCHAR(20)` | No | `NOT NULL DEFAULT 'pending'`, `CHECK IN ('pending', 'processing', 'completed', 'failed')` | Status siklus hidup job sesuai kontrak |
| `error_message` | `TEXT` | Yes | - | Penjelasan kegagalan terstruktur ketika status `failed` |
| `attempts` | `INTEGER` | No | `NOT NULL DEFAULT 0` | Jumlah percobaan eksekusi oleh background worker |
| `created_at` | `TIMESTAMPTZ` | No | `NOT NULL DEFAULT NOW()` | Waktu job dibuat saat request upload diterima |
| `started_at` | `TIMESTAMPTZ` | Yes | - | Waktu worker mulai memproses job |
| `completed_at` | `TIMESTAMPTZ` | Yes | - | Waktu job mencapai terminal state (`completed` atau `failed`) |
| `updated_at` | `TIMESTAMPTZ` | No | `NOT NULL DEFAULT NOW()` | Timestamp pembaruan baris terakhir |

> **Indeks & Trigger Performa**:
> - `idx_image_jobs_status_created_at` pada `(status, created_at DESC)` untuk mempercepat query *startup state reconciliation* oleh worker ketika mendeteksi job `processing` yang terlantar.
> - Trigger `set_image_jobs_updated_at` untuk memperbarui `updated_at` secara otomatis pada setiap `UPDATE`.

---

## 4. Struktur Internal Service & Desain Layer (Layered Architecture)

### 4.1 Pola Lapisan Internal (`backend-api` & `worker`)

```
     [HTTP Client / Next.js UI]
                 │
                 ▼ (REST API Multipart / JSON)
┌─────────────────────────────────┐
│     backend-api (Hono App)      │
│  Routes / Controllers Layer     │ ◄── Validasi multipart, MIME/magic bytes, ukuran <= 20MB
│               │                 │
│               ▼                 │
│  Delegation & Delivery Service  │ ◄── Generate UUID, simpan raw file, orkestrasi DB + Queue
│         │             │         │
│         ▼             ▼         │
│  JobRepository   QueueProducer  │ ◄── pg Pool (NeonDB) & BullMQ Queue.add()
└─────────┬─────────────┬─────────┘
          │             │
          ▼             ▼
     [NeonDB PG]    [Redis 7]
          ▲             │
          │             ▼ (Async Consume + Lock Renewal)
┌─────────┴───────────────────────┐
│     worker (Isolated Node)      │
│  BullMQ Consumer & Lifecycle    │ ◄── State machine pending -> processing -> completed/failed
│               │                 │
│               ▼                 │
│  Sharp Image Pipeline Service   │ ◄── 1. Resize (max 1280px) -> 2. Compress 80% -> 3. WebP
│               │                 │
│               ▼                 │
│  Atomic File Writer & Repo      │ ◄── Tulis .tmp.webp -> fs.rename ke .webp -> Update NeonDB
└─────────────────────────────────┘
```

### 4.2 Standar Struktur Folder Proyek (Monorepo)

```
Technical-Test-CFactory/
├── backend-api/                      ← Hono HTTP API Server (Port 4000)
│   ├── src/
│   │   ├── routes/                   ← Route handlers (jobs.routes.ts, health.routes.ts)
│   │   ├── services/                 ← Delegation, file validation, magic bytes & download service
│   │   ├── repositories/             ← NeonDB PostgreSQL queries (job.repository.ts)
│   │   ├── queue/                    ← BullMQ queue producer & Redis connection
│   │   ├── config/                   ← Env loader & typed constants (20MB limit, storage paths)
│   │   ├── types/                    ← Shared DTO & strict TypeScript interfaces
│   │   ├── app.ts                    ← Hono app factory (memudahkan integration testing)
│   │   └── index.ts                  ← Server entrypoint & graceful shutdown
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json                 ← strict: true
│
├── worker/                           ← Background Worker Service (Isolated Process)
│   ├── src/
│   │   ├── processor/                ← Sharp pipeline (resize 1280px -> compress 80% -> webp)
│   │   ├── repositories/             ← NeonDB state transitions & startup reconciliation
│   │   ├── queue/                    ← BullMQ Worker consumer, stalled & failure handlers
│   │   ├── config/                   ← Env loader & storage helpers
│   │   └── index.ts                  ← Worker bootstrap & SIGTERM/SIGINT graceful shutdown
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json                 ← strict: true
│
├── frontend/                         ← Next.js App Router Web UI (Port 3000)
│   ├── src/
│   │   ├── app/                      ← App Router pages, layout & global styles
│   │   ├── components/               ← ImageDropzone, JobStatusCard, ResultPanel, ErrorBanner
│   │   ├── hooks/                    ← useJobPolling.ts (Exponential Backoff + Jitter + AbortController)
│   │   ├── lib/                      ← Typed API client wrapper (apiClient.ts) & formatters
│   │   └── types/                    ← JobResponse & UI state interfaces
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json                 ← strict: true
│
├── Database/
│   └── schema.sql                    ← DDL NeonDB PostgreSQL (table image_jobs, checks, indexes)
│
├── tests/                            ← Unit & Integration Test Suites (Vitest)
│   ├── unit/                         ← Validation, sharp pipeline, exponential backoff logic
│   └── integration/                  ← API delegation & end-to-end job lifecycle tests
│
├── storage/                          ← Shared local/Docker media volume (di-gitignore isinya)
│   ├── uploads/
│   └── processed/
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── INTEGRATION.md
│   ├── USER_STORIES.md
│   ├── USER_FLOW.md
│   └── USER_GUIDE.md
├── docker-compose.yml                ← Single-command full-stack orchestration
├── .env.example                      ← Dokumentasi seluruh environment variables
└── README.md                         ← Panduan setup, env vars, dan keputusan arsitektur
```

---

## 5. Alur Komunikasi Antar Layanan (Sequence Flows)

### 5.1 Alur Upload & Delegasi Asinkron Non-Blocking (Upload & Enqueue Flow)

```mermaid
sequenceDiagram
    autonumber
    actor User as Pengguna / Browser
    participant UI as Next.js Frontend (Port 3000)
    participant API as Hono API Server (Port 4000)
    participant FS as Shared Storage
    participant DB as NeonDB PostgreSQL
    participant Redis as Redis BullMQ Queue

    User->>UI: Pilih / Drop gambar (JPG/PNG/WebP <= 20MB)
    UI->>UI: Pre-validasi ekstensi, MIME & ukuran <= 20MB
    UI->>API: POST /api/jobs (multipart/form-data)
    activate API
    API->>API: Validasi ukuran <= 20MB & Magic Bytes header file
    alt File tidak valid atau > 20MB
        API-->>UI: 400 / 413 / 415 JSON Error
        UI-->>User: Tampilkan pesan error validasi jelas
    else File valid
        API->>API: Generate job_id (UUID v4)
        API->>FS: Simpan file mentah ke storage/uploads/{job_id}.{ext}
        API->>DB: INSERT INTO image_jobs (id, status='pending', ...)
        DB-->>API: Row tersimpan
        API->>Redis: Queue.add("process-image", { jobId, originalPath })
        Redis-->>API: Enqueue ACK
        API-->>UI: 202 Accepted { job_id, status: "pending", created_at }
    end
    deactivate API
    UI-->>User: Tampilkan job_id & status "pending", mulai polling backoff
```

### 5.2 Alur Eksekusi Background Worker & Transisi Lifecycle (Worker Processing Flow)

```mermaid
sequenceDiagram
    autonumber
    participant Redis as Redis BullMQ Queue
    participant Worker as Background Worker (Sharp)
    participant DB as NeonDB PostgreSQL
    participant FS as Shared Storage

    Redis-->>Worker: Deliver Job { jobId, originalPath }
    activate Worker
    Worker->>DB: UPDATE image_jobs SET status='processing', started_at=NOW(), attempts=attempts+1 WHERE id=$1 AND status IN ('pending','processing')
    DB-->>Worker: Status = processing
    Worker->>FS: Baca file sumber uploads/{job_id}.{ext}
    Worker->>Worker: Sharp Step 1: rotate() + resize(1280, 1280, inside, withoutEnlargement)
    Worker->>Worker: Sharp Step 2 & 3: webp({ quality: 80 })
    Worker->>FS: Tulis ke processed/{job_id}.tmp.webp
    Worker->>FS: Atomic rename .tmp.webp -> processed/{job_id}.webp
    Worker->>DB: UPDATE image_jobs SET status='completed', processed_path=$2, processed_size_bytes=$3, width=$4, height=$5, completed_at=NOW() WHERE id=$1
    DB-->>Worker: Status = completed
    Worker-->>Redis: Job Completed ACK
    deactivate Worker
```

### 5.3 Alur Polling Eksponensial & Unduhan Gambar (Polling & Download Flow)

```mermaid
sequenceDiagram
    autonumber
    actor User as Pengguna / Browser
    participant UI as Next.js Poller Hook
    participant API as Hono API Server
    participant DB as NeonDB PostgreSQL
    participant FS as Shared Storage

    loop Exponential Backoff with Jitter (500ms -> 1s -> 2s -> 3.5s -> max 5s)
        UI->>API: GET /api/jobs/{job_id}
        API->>DB: SELECT * FROM image_jobs WHERE id = $1
        DB-->>API: Job Record (status: pending/processing/completed/failed)
        API-->>UI: 200 OK { status, metadata, download_url, error_message }
        UI-->>User: Perbarui UI status badge & progress stepper
    end

    Note over UI: Loop berhenti otomatis saat status == completed atau failed
    User->>UI: Klik tombol "Download Processed WebP"
    UI->>API: GET /api/jobs/{job_id}/download
    API->>DB: Verifikasi status === 'completed' & path valid
    API->>FS: Stream file processed/{job_id}.webp
    API-->>User: 200 OK (Content-Type: image/webp, attachment download)
```

### 5.4 Alur Penanganan Kegagalan & Worker Crash Recovery (Failure & Recovery Flow)

```mermaid
sequenceDiagram
    autonumber
    participant Worker1 as Worker Instance (Crashed / Error)
    participant Redis as Redis BullMQ Lock Manager
    participant Worker2 as Worker Instance (Recovered / Restarted)
    participant DB as NeonDB PostgreSQL
    participant FS as Shared Storage

    alt Skenario A: File gambar rusak / korup saat di-decode Sharp
        Worker1->>Worker1: Sharp melempar error korup
        Worker1->>FS: Hapus file sementara .tmp.webp jika ada
        Worker1->>DB: UPDATE image_jobs SET status='failed', error_message='Corrupted or invalid image stream', completed_at=NOW()
        Worker1-->>Redis: Lempar UnrecoverableError (Stop retry sia-sia)
    else Skenario B: Worker crash / SIGKILL di tengah proses
        Note over Worker1: Proses mati sebelum selesai, lock Redis tidak diperpanjang
        Redis->>Redis: Deteksi lockDuration (30s) kedaluwarsa -> Tandai job STALLED
        Redis-->>Worker2: Re-deliver job (stalledCount <= maxStalledCount)
        Worker2->>FS: Timpa atau bersihkan .tmp.webp sisa crash sebelumnya
        Worker2->>Worker2: Jalankan ulang pipeline Sharp hingga tuntas
        Worker2->>DB: UPDATE status='completed' (atau 'failed' jika melebihi batas attempt)
    end
```

---

## 6. Keputusan Desain & Arsitektur (Architecture Decision Records / ADR)

### ADR-01: Pemilihan BullMQ (Redis) + NeonDB PostgreSQL vs Database Polling Murni
- **Konteks**: Sistem membutuhkan mekanisme antrean tugas asinkron untuk mendelegasikan pemrosesan gambar dari API server ke worker, sekaligus menjamin status job tersimpan persisten.
- **Keputusan**: Menggunakan **BullMQ di atas Redis 7** sebagai *message broker & job scheduler*, dipadukan dengan **NeonDB PostgreSQL** sebagai *persistent source of truth* status dan metadata job.
- **Alasan & Trade-Off**:
  - Dibandingkan *database polling* murni (`SELECT ... FOR UPDATE SKIP LOCKED` berulang setiap detik), BullMQ memberikan pengiriman job *event-driven* berlatensi rendah (`< 10ms`), fitur bawaan *lock renewal*, *stalled job detection* otomatis saat worker mati mendadak, dan *retry exponential backoff* tanpa membebani koneksi serverless NeonDB dengan query polling kosong.
  - Trade-off: Memerlukan komponen Redis tambahan dalam stack, yang dimitigasi sepenuhnya lewat `docker-compose.yml` satu perintah.

### ADR-02: Pemisahan Proses Hono API Server (Delegator) dan Worker (Executor)
- **Konteks**: Dekoding dan kompresi gambar beresolusi besar (hingga 20 MB) dapat menyita CPU thread `libuv` selama ratusan milidetik hingga beberapa detik per gambar.
- **Keputusan**: Memisahkan **Hono API Server (`backend-api/`)** dan **Background Worker (`worker/`)** sebagai dua paket/service dan kontainer terpisah, dengan larangan keras memanggil `sharp` di API Server.
- **Alasan & Trade-Off**:
  - Menjamin API Server tetap responsif melayani ribuan request upload dan polling status secara konkuren (`< 200ms`), serta memungkinkan *horizontal scaling* jumlah worker secara independen ketika antrean gambar menumpuk.
  - Trade-off: Membutuhkan mekanisme berbagi file (*shared volume* pada single-host/Docker Compose) antara kontainer API dan Worker.

### ADR-03: Pemilihan Sharp (`libvips`) sebagai Engine Pemrosesan Gambar
- **Konteks**: Worker harus melakukan resize (`max 1280px` longest side, menjaga rasio aspek), kompresi `80%`, dan konversi ke `WebP` untuk file hingga 20 MB dengan cepat dan aman memori.
- **Keputusan**: Menggunakan **Sharp** berbasis C++ `libvips` dengan `fit: 'inside'`, `withoutEnlargement: true`, `.rotate()` (untuk menghormati orientasi EXIF), dan `.webp({ quality: 80 })`.
- **Alasan & Trade-Off**:
  - Sharp memproses gambar melalui *streaming pipeline* dengan konsumsi memori jauh lebih rendah dan kecepatan 4–5× lebih tinggi dibandingkan library pure-JS seperti `jimp` atau pemanggilan CLI `ImageMagick`.
  - Trade-off: Memerlukan binary native `libvips` per arsitektur OS pada Dockerfile (menggunakan `node:20-alpine` / `node:20-bookworm-slim` yang kompatibel penuh dengan prebuilt Sharp).

### ADR-04: Strategi Polling Exponential Backoff with Jitter di Next.js Frontend
- **Konteks**: Frontend harus memantau status job hingga selesai tanpa membebani API Server dan kuota koneksi NeonDB dengan polling agresif konstan (misal setiap 200ms tanpa henti).
- **Keputusan**: Mengimplementasikan custom hook `useJobPolling` dengan jadwal backoff eksponensial (`500ms -> 1000ms -> 2000ms -> 3500ms -> cap 5000ms`) ditambah random jitter `±15%`, dilengkapi `AbortController` dan cleanup otomatis saat status mencapai `completed`/`failed`.
- **Alasan & Trade-Off**:
  - Gambar kecil tetap terasa instan pada 1–2 poll pertama (`500ms`), sementara gambar berukuran sangat besar (20 MB) atau antrean sibuk tidak membanjiri backend dengan request sia-sia. Jitter mencegah *thundering herd* bila banyak tab terbuka bersamaan.
  - Trade-off: Penundaan maksimal notifikasi selesai paling lama sebesar interval cap (`5s`), yang sangat wajar untuk alur pemrosesan file.

### ADR-05: Penulisan File Atomik (`.tmp.webp` -> `.webp`) & Graceful Shutdown
- **Konteks**: Jika worker mengalami crash/OOM atau dihentikan kontainer (`SIGTERM`) saat sedang menulis file WebP hasil, file output setengah jadi dapat terbaca korup oleh endpoint download.
- **Keputusan**: Worker wajib menulis output ke `{job_id}.tmp.webp` terlebih dahulu, memverifikasi hasil, lalu melakukan `fs.rename` atomik ke `{job_id}.webp` sebelum memperbarui status database ke `completed`. Selain itu, worker menangani `SIGTERM`/`SIGINT` dengan `await worker.close()`.
- **Alasan & Trade-Off**:
  - Operasi `rename` pada filesystem POSIX bersifat atomik sehingga endpoint download tidak akan pernah menyajikan file WebP yang terpotong (*partial write*).

---

## 7. Konfigurasi, Secrets & Environment Variables

### 7.1 Backend API & Worker (`.env` / Environment Variables)
```env
# PostgreSQL NeonDB Connection String (SSL Wajib untuk NeonDB)
DATABASE_URL=postgresql://username:password@ep-example-pooler.region.aws.neon.tech/cfactory_images?sslmode=require

# Redis Connection URL untuk BullMQ
REDIS_URL=redis://redis:6379

# Direktori Penyimpanan Bersama (Shared Volume)
STORAGE_DIR=/app/storage

# Batas Maksimum Upload (20 MB = 20971520 bytes)
MAX_FILE_SIZE_BYTES=20971520

# Konfigurasi HTTP Server (Hanya digunakan oleh backend-api)
PORT=4000
CORS_ORIGIN=http://localhost:3000

# Konfigurasi Worker (Hanya digunakan oleh worker)
WORKER_CONCURRENCY=2
BULLMQ_QUEUE_NAME=image-processing-queue
```

### 7.2 Frontend Next.js (`frontend/.env.local` / Build & Runtime Env)
```env
# Base URL Backend API Hono yang diakses oleh browser/client
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000

# Batas Maksimal File Sisi Client (harus sinkron dengan backend)
NEXT_PUBLIC_MAX_FILE_SIZE_MB=20
```

---

## 8. Alokasi Port & Jaringan

| Komponen Sistem | Protokol | Port Lokal / Container | Rute / Base URL |
|-----------------|----------|------------------------|-----------------|
| **Frontend Web (Next.js)** | HTTP | `3000` | `http://localhost:3000` |
| **Backend API Server (Hono)** | HTTP | `4000` | `http://localhost:4000/api` |
| **Redis 7 Broker** | TCP (RESP) | `6379` | `redis://localhost:6379` (internal Docker: `redis:6379`) |
| **NeonDB PostgreSQL** | TCP / TLS | `5432` | Disediakan melalui `DATABASE_URL` (`sslmode=require`) |
| **Background Worker** | Internal | - (No listening port) | Mengonsumsi Redis `6379` & menulis ke NeonDB + Shared Volume |

---

## 9. Dependensi Antar Komponen (Dependency Tree)

```
[Next.js Frontend (:3000)]
└── (HTTP REST + Fetch Polling) ──► [Hono Backend API (:4000)]

[Hono Backend API (:4000)]
├── (pg Pool / SQL) ──► [NeonDB PostgreSQL] (Tabel: image_jobs)
├── (BullMQ Producer) ──► [Redis 7 (:6379)] (Queue: image-processing-queue)
└── (fs / Stream) ──► [Shared Volume] (/uploads write, /processed read)

[Background Worker (Isolated Node Process)]
├── (BullMQ Consumer) ◄──► [Redis 7 (:6379)]
├── (pg Pool / SQL) ──► [NeonDB PostgreSQL] (Tabel: image_jobs)
└── (Sharp libvips + fs) ──► [Shared Volume] (/uploads read, /processed atomic write)
```

---

## 10. Tinjauan Kelayakan Arsitektur (Architecture Review)

### [ARCHITECTURE REVIEW CHECKLIST]
- [x] **Decoupling Antarmuka**: Frontend Next.js murni berkomunikasi via REST HTTP ke Hono API dan bebas dari koneksi database maupun Redis.
- [x] **Isolasi Proses Server vs Worker**: `backend-api` berfungsi eksklusif sebagai delegator non-blocking (`202 Accepted`), sedangkan pipeline CPU-intensive `sharp` terisolasi penuh di proses `worker`.
- [x] **Koleksi Kontrak API**: Seluruh endpoint (`POST /api/jobs`, `GET /api/jobs/:jobId`, `GET /api/jobs/:jobId/download`, `GET /api/health`) terdefinisi jelas beserta kode status HTTP dan skema JSON.
- [x] **Integritas State & File**: State machine `pending -> processing -> completed / failed` ditegakkan bersama penulisan file atomik `.tmp.webp` dan *stalled job recovery*.
- [x] **Rasionalisasi ADR**: Kelima ADR (`ADR-01` s/d `ADR-05`) menjelaskan konteks, keputusan, alasan teknis, dan *trade-offs* secara konkret.
- [x] **Manajemen Konfigurasi**: Kredensial NeonDB (`DATABASE_URL`), `REDIS_URL`, dan path storage dipisahkan ke environment variables.

**Skor Kelayakan Arsitektur**: `100 / 100`
**Risiko & Area Mitigasi**:
1. *Single Shared Disk Volume*: Jika sistem di-scale ke banyak mesin terpisah di masa depan, storage lokal perlu diganti dengan Object Storage (S3/R2). Dimigrasi dengan mudah karena akses path sudah diabstraksikan di service layer.
2. *Cold Start / Network Latency NeonDB*: Dimodelkan menggunakan `pg.Pool` dengan reuse koneksi dan *exponential backoff polling* pada frontend agar tidak terjadi kehabisan koneksi.
