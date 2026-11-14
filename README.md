# Tabelin — Navisworks Comments Extractor

Tabelin mengubah laporan **review comment Navisworks (HTML)** menjadi ruang kerja review:
komentar bisa dicari, difilter, ditutup dengan foto before/after, lalu diekspor ke
**log sheet Excel** memakai template perusahaan.

Ada dua cara memakainya, dari kode yang sama:

| | **Server kantor** (`tabelin-server.exe`) | **File offline** (`tabelin-offline.html`) |
|---|---|---|
| Untuk | Tim, dikerjakan bersama | Satu orang |
| Cara jalan | Klik dua kali exe di satu PC kantor; rekan membuka alamatnya di browser | Klik dua kali file HTML |
| Login | Nama + PIN, peran Admin / Reviewer | Tidak ada |
| Data disimpan | Folder `data\` di samping exe (jaringan kantor saja) | Browser PC itu (opsional: folder sesi) |
| Install / hak admin | Tidak perlu | Tidak perlu |

Kedua file ada di halaman **Releases** GitHub. Tidak ada data yang dikirim ke internet.

## Alur kerja

1. **Import** — di Navisworks, export *Viewpoints* sebagai HTML (beserta gambar, atau satu
   `.zip`), lalu Overview › Import.
2. **Review** — cari dan filter komentar; Overview › *Do next* menunjukkan apa yang paling
   menahan target.
3. **Tutup** — tambah foto After (otomatis Closed), tulis resolusi.
4. **Export** — *Export log sheet* mengisi template Excel, lengkap dengan foto.

Panduan bergambar ada di dalam aplikasi: menu **Help** (Bahasa Indonesia / English).

## Fitur

**Overview**
- Progres, target, dan perkiraan selesai dalam kalimat ("At today's pace you finish 21 Jan — 37 days late").
- **Do next**: tiap masalah dihitung sekali (tanpa discipline, tanpa foto after, menunggu
  verifikasi, tanpa resolusi, open > 3 bulan), dengan tombol ke daftar persisnya.
- Satu tabel **Disciplines**: progres, sisa, pace sekarang vs dibutuhkan, perkiraan selesai.
- Grafik tren; *More insights* untuk forecast runway, pipeline, umur backlog, raised by.
- Snapshot PNG per kartu atau seluruh halaman.

**Viewpoints**
- Pencarian, filter discipline / status / commenter, dan chip cepat.
- Panel detail: foto before/after (upload, seret, atau **Ctrl+V** dari snapshot), status,
  resolusi, discipline, commenter, custom field.
- Tombol cepat: **1 / 2 / 3** status, **J / K** pindah komentar, **Ctrl+Enter** komentar berikutnya.
- **Edit massal**: centang beberapa baris, ubah discipline / status / commenter sekaligus.
- **Tambah komentar manual** untuk temuan di luar Navisworks.
- **Riwayat per komentar** (versi server): siapa mengubah apa dan kapan.

**Import ulang**
- Laporan baru dicocokkan lewat ID komentar — tanpa duplikat; status, foto, dan resolusi
  tetap. Ada ringkasan sebelum disimpan, dan import terakhir bisa di-undo.

**Export**
- **Log sheet** dari template `.xlsx` Anda: layout, logo, dan gaya template tidak diubah;
  kolom diatur di Settings › Template.
- **Quick Excel**: daftar komentar + ringkasan Overview.

**Settings**
- Template dan pemetaan kolom, custom field, label discipline dan commenter, status yang
  bisa diatur, aturan deteksi (commenter / discipline dari teks), tema terang/gelap.

## Peran (versi server)

| Kegiatan | Admin | Reviewer |
|---|:-:|:-:|
| Lihat semua project, komentar, foto, Overview | ✓ | ✓ |
| Export log sheet / Quick Excel, snapshot | ✓ | ✓ |
| Edit status, resolusi, discipline, commenter, custom field | ✓ | ✓ |
| Tambah / ganti / hapus foto, edit massal | ✓ | ✓ |
| Import, import ulang, undo import | ✓ | – |
| Tambah komentar manual, hapus komentar | ✓ | – |
| Settings (template, label, deteksi, status, target) | ✓ | – |
| Project & review, kelola user dan PIN | ✓ | – |

Pembatasan dijalankan oleh server, bukan hanya dengan menyembunyikan tombol.

## Memasang server kantor

1. Unduh `tabelin-server.exe` dari Releases, taruh di sebuah folder (mis. `D:\Tabelin\`).
2. Klik dua kali. Browser terbuka sendiri; jendela server menampilkan alamat untuk rekan
   satu jaringan (mis. `http://192.168.x.x:8787`).
3. Login pertama sebagai `admin`; PIN yang diketik pertama kali menjadi PIN-nya.
4. Buat project dan review, lalu undang tim dari Settings › Users.

- **Update**: tutup server, ganti **file exe saja**. Folder `data\` jangan dihapus.
- **Backup / pindah**: salin seluruh folder (exe + `data\`).

Pengaturan lewat environment variable (opsional):

| Variabel | Bawaan | Arti |
|---|---|---|
| `TABELIN_ADDR` | `:8787` | Alamat dan port |
| `TABELIN_DATA` | `./data` | Folder database + foto |
| `TABELIN_BOOTSTRAP_ADMIN` | `admin` | Akun admin pertama saat database masih kosong |
| `TABELIN_NO_BROWSER` | – | `1` = jangan buka browser otomatis |

## Batasan yang perlu diketahui

- Semua user melihat semua project; peran berlaku untuk seluruh server.
- Hapus komentar / review / project permanen. Hanya import terakhir yang bisa di-undo.
- Tidak real-time: dua orang di satu komentar, simpanan terakhir yang menang.
- Input hanya laporan HTML *Viewpoints* Navisworks (`.html` / `.zip`); foto JPG atau PNG.
- Foto maks. 25 MB, template maks. 50 MB. Sesi login 30 hari.
- File offline tidak punya login dan tidak menyimpan riwayat.
- Dirancang untuk layar desktop.

## Pengembangan

```bash
npm install
npm run dev        # aplikasi web, http://localhost:5173
npm run build      # satu file dist/index.html

cp dist/index.html server/web/index.html
cd server && go run .   # server, http://localhost:8787
```

**Rilis** dibuat lewat GitHub Actions › *Build* › *Run workflow* (isi nomor versi). Workflow
ini hanya jalan manual, lalu membuat Release berisi `tabelin-server.exe` dan
`tabelin-offline.html`.

**Stack**: React 18 · Vite 5 · Tailwind CSS 3 · JSZip · SheetJS · html-to-image — server
Go + SQLite (satu binary, tanpa cgo).

**Dokumen lain**
- [`CLAUDE.md`](./CLAUDE.md) — arsitektur dan konvensi kode.
- [`server/README.md`](./server/README.md) — detail server dan API.
- [`docs/tabelin-dokumentasi.md`](./docs/tabelin-dokumentasi.md) — spesifikasi sistem.
- [`docs/ux-review.md`](./docs/ux-review.md) — catatan review UI/UX.
- [`docs/retrospective.md`](./docs/retrospective.md) — retrospektif: apa yang dipertahankan, dirombak, dibuang.
- [`docs/plan-v2.md`](./docs/plan-v2.md) — rencana perbaikan bertahap untuk sesi kerja berikutnya.
