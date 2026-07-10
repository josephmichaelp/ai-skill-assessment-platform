# Panduan Deployment - AI Skill Assessment Platform

Panduan langkah demi langkah untuk men-deploy AI Skill Assessment Platform menggunakan AWS Amplify Gen 2 (backend) dan Amplify Hosting (frontend).

---

## Arsitektur yang akan Di-deploy

Platform ini akan membuat dan mengkonfigurasi resources berikut di AWS:

| Resource | Deskripsi |
|----------|-----------|
| Amazon Cognito User Pool | Autentikasi pengguna + custom attributes (role, orgId) |
| DynamoDB Single-Table | Tabel `platform-data` dengan 2 Global Secondary Indexes (GSI) |
| S3 Bucket | Upload dokumen pendukung assessment |
| 7 Lambda Functions | Node.js 20.x — handler untuk setiap domain |
| API Gateway REST API | 26 endpoints + Cognito Authorizer |
| API Gateway WebSocket API | Streaming roleplay real-time |
| Amazon Bedrock | Nova Lite + Cohere Embed Multilingual v3 (ap-southeast-3) |
| Amplify Hosting | Frontend Next.js (SSR) |

---

## Prasyarat

Sebelum memulai, pastikan hal berikut sudah tersedia:

1. **AWS Account aktif** — dengan akses ke region Asia Pacific (Jakarta) `ap-southeast-3`
2. **Git repository** — GitHub, GitLab, Bitbucket, atau AWS CodeCommit
3. **Node.js 20.x** — terinstal di komputer lokal ([download](https://nodejs.org/))
4. **npm atau yarn** — package manager (npm sudah termasuk dengan Node.js)
5. **AWS CLI** (opsional) — terinstal dan dikonfigurasi untuk operasi sandbox lokal

---

## Langkah 1: Persiapan — Enable Amazon Bedrock Models

Sebelum deploy, aktifkan model AI yang digunakan platform:

1. Buka **AWS Console**: https://console.aws.amazon.com/bedrock
2. Pastikan **region** di pojok kanan atas menampilkan: **Asia Pacific (Jakarta) — ap-southeast-3**
3. Di sidebar kiri, klik **Model access** (di bawah bagian "Bedrock configurations")
4. Klik tombol **Manage model access** (tombol berwarna oranye di kanan atas)
5. Cari dan centang model berikut:
   - ✅ Amazon → **Amazon Nova Lite**
   - ✅ Cohere → **Cohere Embed Multilingual v3**
6. Klik **Save changes**
7. Tunggu beberapa menit hingga status berubah menjadi **Access granted** ✓

> ⚠️ **Catatan Region**: Jika region Jakarta (ap-southeast-3) belum tersedia untuk Bedrock, gunakan region Singapore (ap-southeast-1) dan update nilai `BEDROCK_REGION` di kode Lambda functions.

---

## Langkah 2: Push Kode ke Git Repository

Platform ini menggunakan Amplify CI/CD yang terhubung langsung ke Git repository.

### 2.1 Buat Repository Baru

Buat repository baru di GitHub (atau platform Git pilihan kamu).

### 2.2 Push Kode

```bash
git init
git add .
git commit -m "Initial commit: AI Skill Assessment Platform"
git remote add origin https://github.com/USERNAME/ai-skill-assessment-platform.git
git push -u origin main
```

> 💡 Ganti `USERNAME` dengan username GitHub kamu dan sesuaikan URL jika menggunakan platform Git lain.

---

## Langkah 3: Deploy Backend + Frontend via AWS Amplify Console

### 3.1 Buka Amplify Console

1. Buka https://console.aws.amazon.com/amplify
2. Pastikan region di pojok kanan atas: **Asia Pacific (Jakarta) — ap-southeast-3**
3. Klik tombol **Create new app**

### 3.2 Connect Git Repository

1. Pilih **Git provider** (GitHub, GitLab, Bitbucket, atau CodeCommit)
2. Klik **Next**
3. **Authorize** Amplify untuk mengakses repository kamu
   - Untuk GitHub: kamu akan diminta install/authorize Amplify GitHub App
   - Pilih "Only select repositories" dan pilih repo yang relevan
4. Pilih repository: `ai-skill-assessment-platform`
5. Pilih branch: `main`
6. Klik **Next**

### 3.3 Configure Build Settings

Amplify akan otomatis mendeteksi bahwa ini adalah project **Amplify Gen 2 + Next.js**.

Build settings yang seharusnya terdeteksi otomatis:

```yaml
version: 1
backend:
  phases:
    build:
      commands:
        - npm ci --cache .npm --prefer-offline
        - npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID
frontend:
  phases:
    preBuild:
      commands:
        - npm ci --cache .npm --prefer-offline
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - .next/cache/**/*
      - .npm/**/*
      - node_modules/**/*
```

> 💡 Jika Amplify tidak mendeteksi otomatis, salin konfigurasi di atas ke editor build settings.

7. Klik **Next**

### 3.4 Review dan Deploy

1. Review semua konfigurasi yang telah dimasukkan
2. Klik **Save and deploy**
3. Amplify akan mulai proses build dan deploy (± 5-10 menit pertama kali)

### 3.5 Pantau Progress Deployment

Di halaman app Amplify, kamu akan melihat progress berikut:

| Tahap | Keterangan | Durasi |
|-------|------------|--------|
| **Provision** | Membuat infrastructure (Cognito, DynamoDB, S3, Lambda, API Gateway) | ~3-5 menit |
| **Build** | Compile TypeScript dan bundle Lambda functions | ~2-3 menit |
| **Deploy** | Deploy backend resources via CloudFormation | ~2-3 menit |
| **Hosting** | Build dan deploy Next.js frontend | ~1-2 menit |

Tunggu hingga **semua tahap berstatus ✅ hijau** sebelum melanjutkan.

---

## Langkah 4: Konfigurasi Environment Variables

Setelah deploy pertama berhasil, konfigurasikan environment variables untuk frontend:

### 4.1 Tambahkan Variables

1. Di Amplify Console, klik app yang baru dibuat
2. Di sidebar kiri, klik **Hosting** → **Environment variables**
3. Tambahkan variabel berikut:

| Key | Value | Keterangan |
|-----|-------|------------|
| `NEXT_PUBLIC_API_URL` | (dari output CloudFormation) | URL REST API Gateway |
| `NEXT_PUBLIC_USER_POOL_ID` | (dari output CloudFormation) | Cognito User Pool ID |
| `NEXT_PUBLIC_USER_POOL_CLIENT_ID` | (dari output CloudFormation) | Cognito App Client ID |

### 4.2 Cara Mendapatkan Nilai Output

**Metode 1 — Via CloudFormation Console:**

1. Buka https://console.aws.amazon.com/cloudformation
2. Pastikan region: **ap-southeast-3**
3. Cari stack yang namanya mengandung `amplify-` dan nama app kamu
4. Klik stack → tab **Outputs**
5. Catat nilai berikut:
   - `PlatformApiUrl` → gunakan untuk `NEXT_PUBLIC_API_URL`
   - Buka nested stack **auth** → `UserPoolId` dan `UserPoolClientId`

**Metode 2 — Via Amplify Console (lebih mudah):**

1. Di Amplify Console → app kamu → tab **Backend**
2. Klik **View outputs** atau **Backend resources**
3. Semua output CloudFormation akan terlihat di satu halaman

### 4.3 Apply Environment Variables

Setelah menambahkan semua env vars:

1. Klik **Save**
2. Klik **Redeploy** (atau trigger build baru) untuk apply ke frontend

---

## Langkah 5: Buat Admin User Pertama

### 5.1 Buat User via AWS Console (Cognito)

1. Buka https://console.aws.amazon.com/cognito
2. Pastikan region: **ap-southeast-3**
3. Klik **User Pools** di sidebar
4. Klik User Pool yang baru dibuat (nama mengandung ID app Amplify)
5. Klik tab **Users**
6. Klik tombol **Create user**
7. Isi form:
   - **User name**: email admin (misal: `admin@company.com`)
   - **Email address**: sama dengan username
   - **Temporary password**: buat password sementara
     - Minimum 8 karakter, harus mengandung: uppercase, lowercase, angka, simbol
   - ✅ Centang **Mark email as verified**
8. Klik **Create user**

### 5.2 Set Custom Attributes

Setelah user dibuat, set role dan organisasi:

**Via AWS CLI (direkomendasikan):**

```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id ap-southeast-3_XXXXXXXXX \
  --username admin@company.com \
  --user-attributes \
    Name="custom:orgId",Value="my-organization" \
    Name="custom:role",Value="Admin" \
  --region ap-southeast-3
```

> ⚠️ Ganti `ap-southeast-3_XXXXXXXXX` dengan User Pool ID yang sebenarnya (dari Langkah 4).

**Via Console:**

1. Klik user yang baru dibuat
2. Scroll ke bagian **User attributes**
3. Klik **Edit**
4. Tambahkan:
   - `custom:orgId` = `my-organization`
   - `custom:role` = `Admin`
5. Klik **Save changes**

### 5.3 Set Permanent Password (opsional)

Agar user tidak perlu mengganti password saat login pertama:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id ap-southeast-3_XXXXXXXXX \
  --username admin@company.com \
  --password "YourSecurePassword123!" \
  --permanent \
  --region ap-southeast-3
```

---

## Langkah 6: Verifikasi Deployment

### 6.1 Cek Frontend

1. Di Amplify Console, klik domain URL yang diberikan
   - Format: `https://main.d1234abcdef.amplifyapp.com`
2. Halaman login harus muncul
3. Login dengan admin user yang dibuat di Langkah 5
4. Setelah login berhasil, dashboard admin harus muncul

### 6.2 Cek Backend Resources

#### DynamoDB

1. Buka https://console.aws.amazon.com/dynamodb
2. Klik **Tables** di sidebar → cari tabel `platform-data`
3. Verifikasi:
   - Partition key = `PK` (String)
   - Sort key = `SK` (String)
4. Klik tab **Indexes** → verifikasi **GSI1** dan **GSI2** ada

#### S3

1. Buka https://console.aws.amazon.com/s3
2. Cari bucket yang mengandung `platformdocuments`
3. Verifikasi:
   - Block all public access = **ON**
   - Lifecycle rule: TransitionToIA (30 hari)

#### API Gateway — REST API

1. Buka https://console.aws.amazon.com/apigateway
2. Cari **AI Skill Assessment Platform API**
3. Klik → verifikasi semua routes ada:
   - `/assessments/*`
   - `/roleplay/*`
   - `/assignments/*`
   - `/promotions/*`
   - `/performance/*`
   - `/users/*`
4. Klik **Authorizers** → verifikasi **Cognito Authorizer** terpasang dan mengarah ke User Pool yang benar

#### Lambda Functions

1. Buka https://console.aws.amazon.com/lambda
2. Cari functions yang mengandung nama app Amplify:
   - `assessment-handler`
   - `roleplay-handler`
   - `assignment-handler`
   - `promotion-handler`
   - `performance-handler`
   - `user-handler`
   - `ws-authorizer`
3. Klik salah satu function → tab **Configuration** → **Environment variables**
4. Verifikasi variabel berikut ada:
   - `TABLE_NAME` ✓
   - `BUCKET_NAME` ✓
   - `BEDROCK_REGION` = `ap-southeast-3` ✓

#### WebSocket API

1. Di API Gateway console, klik tab **WebSocket APIs**
2. Cari **AI Skill Assessment Platform - Roleplay WebSocket**
3. Verifikasi routes:
   - `$connect`
   - `$disconnect`
   - `sendMessage`

---

## Langkah 7: Setup Custom Domain (Opsional)

Jika ingin menggunakan domain sendiri (misal: `assessment.company.com`):

1. Di Amplify Console → app kamu → sidebar **Hosting** → **Custom domains**
2. Klik **Add domain**
3. Masukkan domain kamu (misal: `assessment.company.com`)
4. Amplify akan memberikan **CNAME record** yang perlu ditambahkan
5. Buka DNS provider kamu (Cloudflare, Route53, GoDaddy, dll.)
6. Tambahkan CNAME record sesuai instruksi Amplify
7. Kembali ke Amplify Console → tunggu SSL certificate ter-provision (± 10-30 menit)
8. Setelah status **Verified** ✓, domain custom sudah aktif

---

## Langkah 8: Setup CI/CD (Otomatis)

Amplify secara otomatis sudah mengkonfigurasi CI/CD pipeline:

- ✅ Setiap `git push` ke branch `main` → **auto-deploy production**
- ✅ Build logs tersedia di Amplify Console
- ✅ Rollback otomatis jika build gagal

### Tambahkan Branch Preview (Opsional)

Untuk setup preview environments per branch:

1. Di Amplify Console → **Hosting** → **Branch deployments**
2. Klik **Connect branch**
3. Pilih branch (misal: `develop`, `staging`, atau pattern `feature/*`)
4. Setiap branch akan mendapatkan **URL preview sendiri**
   - Contoh: `https://develop.d1234abcdef.amplifyapp.com`

---

## Estimasi Biaya (MVP / Demo Traffic)

Estimasi untuk penggunaan rendah (~100 user, ~500 assessment/bulan):

| Service | Estimasi/bulan | Catatan |
|---------|---------------|---------|
| Amazon Cognito | Gratis | Free tier hingga 50K MAU |
| DynamoDB | ~$0.50 | On-demand pricing, low traffic |
| Lambda | ~$0.50 | Free tier 1M requests/bulan |
| API Gateway | ~$1.00 | REST + WebSocket |
| S3 | ~$0.10 | Minimal storage |
| Bedrock (Nova Lite) | ~$3-5 | Tergantung jumlah assessment & roleplay |
| Amplify Hosting | ~$1-2 | SSR Next.js |
| **Total** | **~$7-10/bulan** | |

> 💡 Biaya akan meningkat seiring pertambahan user dan penggunaan fitur AI. Monitor billing dashboard secara berkala.

---

## Troubleshooting

### Build Gagal di Amplify

#### Masalah: `Cannot find module '@aws-amplify/backend'`

**Penyebab**: Dependencies di folder `amplify/` tidak terinstal saat build.

**Solusi**:
1. Pastikan `amplify/package.json` memiliki semua dependencies yang diperlukan
2. Jalankan `npm install` di folder `amplify/` sebelum push
3. Pastikan `amplify/package-lock.json` ter-commit ke Git

#### Masalah: `esbuild` binary error

**Penyebab**: Binary esbuild tidak compatible dengan build environment.

**Solusi**: Tambahkan di build settings:
```yaml
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
        - cd amplify/functions && npm ci && cd ../..
```

---

### CORS Error di Browser

**Masalah**: Browser menampilkan CORS error saat memanggil API.

**Solusi**:
1. Buka **API Gateway Console**
2. Klik API → bagian **CORS**
3. Pastikan `Access-Control-Allow-Origin` mengandung domain Amplify Hosting kamu:
   - `https://main.d1234abcdef.amplifyapp.com`
4. Pastikan `Access-Control-Allow-Headers` mengandung: `Authorization, Content-Type`
5. **Re-deploy API stage** setelah perubahan

---

### 401 Unauthorized

**Masalah**: Semua API call mengembalikan status 401.

**Solusi**:
1. Verifikasi `NEXT_PUBLIC_USER_POOL_ID` dan `NEXT_PUBLIC_USER_POOL_CLIENT_ID` benar dan sesuai
2. Verifikasi user sudah di-confirm di Cognito (status = **CONFIRMED**)
3. Verifikasi **Cognito Authorizer** di API Gateway mengarah ke User Pool yang benar
4. Cek apakah token sudah expired — coba logout dan login ulang

---

### Bedrock ThrottlingException

**Masalah**: Error `ThrottlingException` saat generate quiz atau roleplay.

**Solusi**:
1. Buka https://console.aws.amazon.com/servicequotas
2. Pastikan region: **ap-southeast-3**
3. Cari service **Amazon Bedrock**
4. Request quota increase untuk:
   - `InvokeModel requests per minute`
   - `InvokeModelWithResponseStream requests per minute`
5. Tunggu approval (biasanya beberapa jam)

---

### Lambda Timeout

**Masalah**: Lambda function timeout (default 30 detik).

**Solusi**:
1. Buka **Lambda Console** → function yang timeout
2. Tab **Configuration** → **General configuration** → klik **Edit**
3. Naikkan **Timeout** sesuai kebutuhan:
   - Untuk assessment generation: 60-90 detik
   - Untuk roleplay: 120 detik
   - ⚠️ Untuk fungsi yang di-trigger via API Gateway: **maksimal 29 detik** (hard limit API Gateway)
4. Untuk roleplay yang memerlukan >29 detik, gunakan WebSocket API (sudah dikonfigurasi)

---

### DynamoDB Token Usage Reset

**Masalah**: Organisasi sudah mencapai batas token 500K dan perlu reset.

**Solusi (manual reset via Console)**:
1. Buka **DynamoDB Console** → tabel `platform-data`
2. Klik **Explore table items**
3. Tambahkan filter:
   - `PK` = `ORG#<orgId>`
   - `SK` begins with `TOKENUSAGE#`
4. Temukan item token usage bulan berjalan
5. Pilih item → klik **Actions** → **Edit item**
6. Ubah `totalTokensUsed` ke `0`
7. Klik **Save changes**

---

## Langkah Selanjutnya (Post-Deployment)

Setelah deployment berhasil, lakukan langkah-langkah berikut:

1. **Buat organisasi dan user tambahan** — via Admin Panel di frontend
2. **Konfigurasi positions** — tambahkan jabatan dengan competency requirements
3. **Monitor token usage** — pantau di Admin → Token Usage dashboard
4. **Setup CloudWatch Alarms** — untuk monitoring:
   - Lambda errors (> 5 errors/menit)
   - API Gateway 5xx responses
   - DynamoDB throttling
5. **Enable AWS WAF** (opsional) — di API Gateway untuk keamanan tambahan
6. **Backup DynamoDB** — enable **Point-in-Time Recovery** di DynamoDB Console:
   - Buka tabel → tab **Backups** → aktifkan PITR
7. **Setup billing alerts** — di AWS Budgets untuk menghindari biaya tak terduga

---

*Dibuat otomatis oleh AI Skill Assessment Platform spec.*
*Terakhir diperbarui: Juli 2025*
