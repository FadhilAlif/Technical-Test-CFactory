# USER STORIES & TRACEABILITY MATRIX (USER_STORIES.md)

## CFactory Async Image Processor (CAIP)
### Rincian Kebutuhan Pengguna, Kriteria Penerimaan (Given/When/Then), dan Matriks Keterlacakan

Dokumen ini mendefinisikan *User Stories* yang diturunkan langsung dari spesifikasi fungsional dan aturan bisnis (`BR-01` s/d `BR-10`) pada [`docs/PRD.md`](PRD.md) serta spesifikasi sistem.

---

## Ringkasan Epic & Daftar User Stories

| Epic | ID Story | Judul Singkat | Prioritas | Business Rules |
|---|---|---|---|---|
| **Epic 1: Interactive Image Upload & Validation** | `US-01` | Unggah Gambar via Drag-and-Drop / Picker | **Must-Have** | `BR-01`, `BR-02` |
| **Epic 1: Interactive Image Upload & Validation** | `US-02` | Validasi Format Magic Bytes & Batas 20 MB | **Must-Have** | `BR-01`, `BR-02` |
| **Epic 2: Non-Blocking Delegation & Job Tracking** | `US-03` | Delegasi Upload Instan Tanpa Blocking (`job_id`) | **Must-Have** | `BR-03`, `BR-06` |
| **Epic 2: Non-Blocking Delegation & Job Tracking** | `US-04` | Pelacakan Status Real-Time via Exponential Backoff | **Must-Have + Bonus** | `BR-04`, `BR-10` |
| **Epic 3: Async Background Worker & Resilience** | `US-05` | Pipeline Resize 1280px, Compress 80%, & Convert WebP | **Must-Have** | `BR-04`, `BR-05`, `BR-06` |
| **Epic 3: Async Background Worker & Resilience** | `US-06` | Penulisan Atomik & Recovery Saat Worker Crash | **Bonus Point** | `BR-04`, `BR-08` |
| **Epic 4: Processed Delivery & Error Display** | `US-07` | Unduhan Aman Hasil WebP & Statistik Penghematan | **Must-Have** | `BR-07`, `BR-08` |
| **Epic 4: Processed Delivery & Error Display** | `US-08` | Tampilan Pesan Error Informatif Saat Job Gagal | **Must-Have** | `BR-04`, `BR-08`, `BR-10` |
| **Epic 5: Reproducible Deployment & QA** | `US-09` | Menjalankan Seluruh Stack via 1 Perintah Docker | **Bonus Point** | `BR-06`, `BR-09` |
| **Epic 5: Reproducible Deployment & QA** | `US-10` | Verifikasi Kualitas Lewat Vitest & TypeScript Strict | **Must-Have + Bonus** | `BR-01` s/d `BR-10` |

---

## Epic 1: Interactive Image Upload & Validation

### `US-01`: Unggah Gambar via Drag-and-Drop atau File Picker
* **Story**: *Sebagai* **End User**, *saya ingin* mengunggah gambar berformat JPG, PNG, atau WebP hingga ukuran 20 MB melalui area drag-and-drop maupun tombol pemilih file, *sehingga* saya dapat mengoptimalkan foto berukuran besar dengan cepat dan mudah.
* **Prioritas**: Must-Have
* **Business Rules**: `BR-01`, `BR-02`
* **Acceptance Criteria**:
  - **Given** pengguna berada di halaman utama `http://localhost:3000`, **When** pengguna menyeret atau memilih file gambar `.jpg`, `.png`, atau `.webp` berukuran `<= 20 MB`, **Then** antarmuka menampilkan pratinjau nama file, tipe MIME, dan ukuran file terformat, serta mengaktifkan tombol `"Upload & Process Image"`.
  - **Given** pengguna sedang menjalankan proses upload ke server, **When** tombol diklik, **Then** tombol masuk ke state loading dan mencegah pengiriman ganda hingga API merespons.

### `US-02`: Validasi Ketat Format Gambar (Magic Bytes) & Batas Ukuran 20 MB
* **Story**: *Sebagai* **Sistem Backend & Frontend**, *saya ingin* memvalidasi format gambar yang valid dan membatasi ukuran file maksimal 20 MB (`20,971,520 bytes`) baik di klien maupun di server melalui pengecekan magic bytes, *sehingga* file berbahaya, file kosong, atau file spoofing tidak membebani antrean worker.
* **Prioritas**: Must-Have
* **Business Rules**: `BR-01`, `BR-02`
* **Acceptance Criteria**:
  - **Given** pengguna memilih file berformat `.pdf`, `.txt`, `.gif`, atau file berukuran `> 20 MB` di browser, **When** file dijatuhkan ke dropzone, **Then** UI langsung menolak file tanpa mengirim request ke server dan menampilkan pesan alasan yang jelas.
  - **Given** seorang klien HTTP mengirim request langsung ke `POST /api/jobs` dengan file `.txt` yang ekstensi dan header-nya disamarkan menjadi `image/jpeg`, **When** backend memeriksa header *magic bytes* file, **Then** backend menolak request dengan `HTTP 415 Unsupported Media Type` dan format JSON error standar.
  - **Given** seorang klien HTTP mengirim file berukuran `> 20,971,520 bytes` atau `0 bytes`, **When** backend memvalidasi payload, **Then** backend menolak dengan `HTTP 413 Payload Too Large` (atau `400 Bad Request` untuk 0 bytes) tanpa menyimpan file ke disk.

---

## Epic 2: Non-Blocking Delegation & Real-Time Job Tracking

### `US-03`: Delegasi Upload Instan Non-Blocking dengan `job_id`
* **Story**: *Sebagai* **End User**, *saya ingin* menerima `job_id` dan konfirmasi penerimaan seketika setelah unggahan gambar selesai dikirim tanpa menunggu proses konversi gambar berakhir, *sehingga* halaman web terasa responsif meskipun file yang diunggah mendekati 20 MB.
* **Prioritas**: Must-Have
* **Business Rules**: `BR-03`, `BR-06`
* **Acceptance Criteria**:
  - **Given** file gambar valid diterima oleh `POST /api/jobs`, **When** server selesai menulis file mentah ke `storage/uploads`, mencatat baris `status = 'pending'` di NeonDB PostgreSQL, dan memasukkan job ke BullMQ Redis, **Then** API langsung mengembalikan `HTTP 202 Accepted` berisi `job_id` (UUID v4) dan `status: "pending"` tanpa memanggil library `sharp`.
  - **Given** antarmuka Next.js menerima respons `202 Accepted`, **When** data `job_id` diterima, **Then** UI langsung merender `JobStatusCard` yang menampilkan `job_id` (dengan tombol salin) dan langkah `pending`.

### `US-04`: Pelacakan Status Real-Time Menggunakan Exponential Backoff Polling
* **Story**: *Sebagai* **End User & System Maintainer**, *saya ingin* frontend melacak perubahan status job (`pending -> processing -> completed / failed`) secara berkala menggunakan strategi *Exponential Backoff with Jitter* dan menghentikan polling saat status selesai atau komponen ditutup, *sehingga* UI tetap up-to-date tanpa membanjiri API server dan database dengan request konstan.
* **Prioritas**: Must-Have + Bonus Point
* **Business Rules**: `BR-04`, `BR-10`
* **Acceptance Criteria**:
  - **Given** `job_id` aktif diterima oleh hook `useJobPolling`, **When** polling berjalan sementara status masih `pending` atau `processing`, **Then** jeda waktu antar panggilan `GET /api/jobs/:jobId` bertambah secara eksponensial (`500ms -> 1000ms -> 2000ms -> 3500ms -> cap 5000ms` dengan jitter `±15%`).
  - **Given** backend mengembalikan `status: "completed"` atau `status: "failed"`, **When** respons polling diterima, **Then** UI memperbarui stepper status ke state akhir dan langsung menghentikan seluruh timer polling serta `AbortController`.
  - **Given** polling sedang berlangsung, **When** pengguna menutup halaman atau berpindah komponen (*unmount*), **Then** cleanup hook langsung membatalkan timer dan request aktif agar tidak terjadi *memory leak*.

---

## Epic 3: Asynchronous Background Worker & Crash Resilience

### `US-05`: Pemrosesan Gambar Terurut di Background Worker Terpisah
* **Story**: *Sebagai* **Background Worker**, *saya ingin* mengambil job dari BullMQ secara independen dari proses HTTP API server lalu menjalankan transformasi **Resize (maks 1280px longest side, preserve aspect ratio) -> Compress (80%) -> Convert to WebP**, *sehingga* gambar teroptimasi secara konsisten tanpa pernah memblokir event loop API server.
* **Prioritas**: Must-Have
* **Business Rules**: `BR-04`, `BR-05`, `BR-06`
* **Acceptance Criteria**:
  - **Given** sebuah job berstatus `pending` masuk ke queue Redis `image-processing-queue`, **When** worker mengambil job tersebut, **Then** worker pertama-tama memperbarui tabel `image_jobs` di NeonDB ke `status = 'processing'` dan mengisi `started_at`.
  - **Given** input gambar berdimensi `4000x3000` (landscape), `2000x4000` (portrait), atau `800x600` (kecil), **When** pipeline Sharp selesai memproses secara berurutan, **Then**:
    - Landscape `4000x3000` menjadi `1280x960` berformat WebP kualitas 80%.
    - Portrait `2000x4000` menjadi `640x1280` berformat WebP kualitas 80%.
    - Kecil `800x600` tetap `800x600` (*no upscaling*) berformat WebP kualitas 80%.
  - **Given** proses transformasi selesai, **When** output telah disimpan, **Then** worker memperbarui NeonDB ke `status = 'completed'` beserta `processed_size_bytes`, `width`, `height`, dan `completed_at`.

### `US-06`: Penulisan File Atomik & Graceful Crash Recovery
* **Story**: *Sebagai* **System Maintainer**, *saya ingin* worker menulis output ke file sementara sebelum rename atomik, menangani sinyal shutdown (`SIGTERM`/`SIGINT`), serta memulihkan *stalled jobs* jika worker mengalami crash di tengah proses, *sehingga* tidak pernah ada file korup yang diunduh user maupun job yang terjebak selamanya di status `processing`.
* **Prioritas**: Bonus Point
* **Business Rules**: `BR-04`, `BR-08`
* **Acceptance Criteria**:
  - **Given** worker sedang menulis hasil Sharp, **When** terjadi proses tulis ke disk, **Then** file ditulis ke `storage/processed/{job_id}.tmp.webp` dan hanya di-rename secara atomik menjadi `{job_id}.webp` sebelum transaksi update DB `completed`.
  - **Given** worker menerima sinyal `SIGTERM` saat memproses gambar, **When** handler shutdown aktif, **Then** worker berhenti menerima job baru dan menyelesaikan job yang sedang berjalan lewat `await worker.close()` sebelum menutup pool DB & Redis.
  - **Given** worker mati mendadak (`SIGKILL`) di tengah proses sehingga lock BullMQ habis masa berlakunya (`30s`), **When** worker lain atau worker yang di-restart menyala, **Then** BullMQ mendeteksi job *stalled* dan memproses ulang hingga `completed` atau menandai `failed` bila melebihi batas retry (`maxStalledCount`).

---

## Epic 4: Processed Image Delivery & Informative Error Display

### `US-07`: Unduhan Aman Hasil WebP & Statistik Penghematan Ukuran
* **Story**: *Sebagai* **End User**, *saya ingin* melihat ringkasan ukuran dan dimensi hasil optimasi serta mengunduh file `.webp` melalui tombol unduhan resmi setelah job selesai, *sehingga* saya dapat langsung memanfaatkan gambar yang sudah terkompresi.
* **Prioritas**: Must-Have
* **Business Rules**: `BR-07`, `BR-08`
* **Acceptance Criteria**:
  - **Given** job berstatus `completed` dan file `.webp` ada di `storage/processed`, **When** pengguna mengklik tombol `"Download Processed WebP"` atau mengakses `GET /api/jobs/:jobId/download`, **Then** server mengirimkan stream biner dengan header `Content-Type: image/webp` dan `Content-Disposition: attachment`.
  - **Given** job masih berstatus `pending` atau `processing`, **When** klien mengakses `GET /api/jobs/:jobId/download`, **Then** server menolak dengan `HTTP 409 Conflict` dan pesan bahwa gambar masih dalam antrean/pemrosesan.

### `US-08`: Tampilan Pesan Error Informatif Saat Pemrosesan Gagal
* **Story**: *Sebagai* **End User**, *saya ingin* melihat pesan error yang jelas dan informatif pada antarmuka web ketika worker gagal memproses gambar, *sehingga* saya mengetahui penyebab kegagalan dan dapat mencoba mengunggah gambar lain.
* **Prioritas**: Must-Have
* **Business Rules**: `BR-04`, `BR-08`, `BR-10`
* **Acceptance Criteria**:
  - **Given** file gambar dengan stream internal yang korup diproses oleh Sharp, **When** Sharp gagal melakukan decoding, **Then** worker membersihkan file `.tmp.webp`, memperbarui NeonDB menjadi `status = 'failed'` dengan `error_message` yang deskriptif, dan memicu `UnrecoverableError` agar tidak retry berulang.
  - **Given** endpoint `GET /api/jobs/:jobId` mengembalikan `status: "failed"`, **When** UI memproses respons tersebut, **Then** UI menghentikan polling, menampilkan `ErrorBanner` berisi `error_message` dari server, dan menyediakan tombol `"Try Another Image"`.

---

## Epic 5: Reproducible Deployment & Automated Quality Assurance

### `US-09`: Menjalankan Seluruh Stack dengan Satu Perintah Docker Compose
* **Story**: *Sebagai* **Technical Reviewer**, *saya ingin* menjalankan keseluruhan komponen aplikasi (`frontend`, `backend-api`, `worker`, `redis`) dengan satu perintah `docker compose up --build`, *sehingga* saya dapat mengevaluasi fungsionalitas end-to-end dengan cepat tanpa setup manual yang rumit.
* **Prioritas**: Bonus Point
* **Business Rules**: `BR-06`, `BR-09`
* **Acceptance Criteria**:
  - **Given** file `.env` telah diisi dengan `DATABASE_URL` NeonDB yang valid dan Docker Engine aktif, **When** penilai menjalankan `docker compose up --build`, **Then** keempat layanan terbangun dan berjalan otomatis dengan shared volume untuk storage serta healthcheck kesiapan layanan.

### `US-10`: Verifikasi Kualitas melalui Unit/Integration Tests & TypeScript Strict
* **Story**: *Sebagai* **Technical Reviewer & Developer**, *saya ingin* seluruh modul lulus kompilasi TypeScript `"strict": true` dan dilindungi unit/integration tests menggunakan Vitest, *sehingga* kontrak validasi, logika resize Sharp, backoff polling, dan API delegation terjamin bebas regresi.
* **Prioritas**: Must-Have + Bonus Point
* **Business Rules**: `BR-01` s/d `BR-10`
* **Acceptance Criteria**:
  - **Given** konfigurasi `tsconfig.json` pada `backend-api`, `worker`, dan `frontend` menyalakan `"strict": true`, **When** perintah `tsc --noEmit` dijalankan di seluruh workspace, **Then** kompilasi selesai dengan `0` error.
  - **Given** test suite Vitest di direktori `tests/`, **When** `npm test` dijalankan, **Then** seluruh skenario unit test (validator magic bytes & 20 MB, pipeline Sharp resize/compress/WebP, perhitungan exponential backoff) dan integration test endpoint API lulus 100%.

---

## Matriks Keterlacakan (Traceability Matrix)

| User Story | Business Rules | User Flow | Komponen / Endpoint Terkait | Target Pengujian (Vitest / E2E) |
|---|---|---|---|---|
| `US-01` | `BR-01`, `BR-02` | `UF-01` | `frontend/components/ImageDropzone.tsx` | E2E Upload Skenario 2 & UI Validation |
| `US-02` | `BR-01`, `BR-02` | `UF-04` | `backend-api/services/file-validator.ts` | Unit Test: Magic bytes & 20 MB boundary |
| `US-03` | `BR-03`, `BR-06` | `UF-01` | `POST /api/jobs`, `image-queue.ts` | Integration Test: `202 Accepted` non-blocking |
| `US-04` | `BR-04`, `BR-10` | `UF-02` | `frontend/hooks/use-job-polling.ts`, `GET /api/jobs/:jobId` | Unit Test: Backoff delay sequence & cleanup |
| `US-05` | `BR-04`, `BR-05`, `BR-06` | `UF-02` | `worker/processor/image-processor.ts` | Unit Test: Sharp landscape, portrait, no-upscale, WebP 80% |
| `US-06` | `BR-04`, `BR-08` | `UF-02`, `UF-05` | `worker/queue/image-worker.ts`, `worker-job.repository.ts` | Unit/Integration Test: Atomic `.tmp.webp` & crash simulation |
| `US-07` | `BR-07`, `BR-08` | `UF-03` | `GET /api/jobs/:jobId/download`, `ResultPanel.tsx` | Integration Test: `200` WebP stream vs `409` pending |
| `US-08` | `BR-04`, `BR-08`, `BR-10` | `UF-05` | `ErrorBanner.tsx`, `worker` failure handler | Integration Test: Corrupted file -> `failed` status |
| `US-09` | `BR-06`, `BR-09` | `UF-01`..`UF-05` | `docker-compose.yml`, `*/Dockerfile` | `docker compose up --build` & `/api/health` |
| `US-10` | `BR-01`..`BR-10` | Semua | `tests/unit/*`, `tests/integration/*`, `tsconfig.json` | `tsc --noEmit` & `vitest run` |
