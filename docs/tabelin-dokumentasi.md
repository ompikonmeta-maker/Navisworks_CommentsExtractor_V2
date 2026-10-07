# Tabelin — Dokumentasi Sistem

Dokumen ini mencakup UI, Input, Process, dan Output.

## Ringkasan sistem

Tabelin mengubah paket laporan review model menjadi daftar komentar koordinasi yang dapat dicari, difilter, dianalisis, dan ditindaklanjuti dalam satu sesi browser.

### Tujuan

Menyederhanakan review multidisiplin dari laporan HTML Navisworks agar tim dapat memusatkan perhatian pada isu, disiplin, bukti visual, dan status penyelesaian.

- Mengimpor HTML, gambar pendamping, atau paket ZIP.
- Menormalisasi komentar ke struktur data yang konsisten.
- Menyediakan dashboard, daftar viewpoint, dan analitik.
- Menyimpan perubahan hanya selama sesi aplikasi berjalan.

### Alur utama

Empat tahap yang dijalankan dari sumber mentah hingga keputusan review.

| Tahap | Aktivitas | Hasil |
| --- | --- | --- |
| 01 · Input | Pilih HTML + gambar atau ZIP | Berkas siap dibaca |
| 02 · Parse | Ekstrak komentar dan referensi gambar | Record terstruktur |
| 03 · Review | Filter, periksa, beri resolusi | Status terkini |
| 04 · Output | Tampilkan ringkasan dan analitik | Insight koordinasi |

### Batasan sistem

Aplikasi dirancang untuk pemrosesan lokal yang cepat dan privat.

> Data berada di memori browser. Memuat ulang halaman akan mengembalikan data ke sampel awal; tidak ada unggahan ke server atau penyimpanan permanen.

---

## Spesifikasi UI

Antarmuka memakai sidebar untuk perpindahan konteks, header sesi untuk status, dan area konten modular agar informasi padat tetap mudah dipindai.

### Anatomi layar

Struktur halaman konsisten di seluruh ukuran layar.

| Area | Isi | Perilaku |
| --- | --- | --- |
| Sidebar | Logo dan navigasi dokumentasi | Sticky di desktop, horizontal di mobile |
| Header | Konteks dokumen dan status versi | Tetap terlihat saat scroll |
| Hero | Judul, ringkasan, aksi dokumen | Menjelaskan konteks halaman aktif |
| Daftar isi | Anchor tiap bab | Scroll halus ke bagian tujuan |
| Konten | Kartu, tabel, kode, callout | Responsif dan dapat dipindai |

### Komponen inti

Pola komponen yang digunakan untuk menjaga hierarki dan konsistensi.

- Navigation item: ikon, label, active state, dan focus ring.
- Section card: nomor bab, judul, deskripsi, dan konten terstruktur.
- Badge: metadata singkat seperti versi atau kategori.
- Data table: spesifikasi dengan header kontras dan overflow horizontal.
- Code block: payload monospace dengan tombol salin.
- Callout: batasan atau catatan penting dengan ikon.

### State antarmuka

Setiap state memberi umpan balik yang jelas.

| State | Representasi | Tindakan pengguna |
| --- | --- | --- |
| Default | Konten lengkap dan kontrol aktif | Baca atau navigasi |
| Loading | Skeleton di dalam kartu | Menunggu progresif |
| Success | Notifikasi cyan/emerald | Lanjut review |
| Error | Callout merah dengan pesan spesifik | Coba ulang |
| Empty | Penjelasan dan aksi impor | Pilih sumber data |

### Aksesibilitas

Kontrol dapat digunakan tanpa mouse dan tetap terbaca pada berbagai kondisi.

- Urutan heading dimulai dari h1 lalu h2/h3.
- Semua tombol memiliki nama aksesibel dan focus ring terlihat.
- Kontras teks utama dan status memenuhi kebutuhan keterbacaan.
- Tabel dapat digulir horizontal tanpa memotong konten.
- Animasi menghormati preferensi reduced motion.

---

## Spesifikasi input

Sumber utama berupa laporan HTML Navisworks, kumpulan gambar viewpoint, atau satu paket ZIP yang berisi keduanya.

### Sumber berkas

Pengguna dapat memilih beberapa berkas sekaligus melalui pemilih berkas.

| Format | Wajib | Aturan |
| --- | --- | --- |
| .html / .htm | Ya | Minimal satu laporan yang memiliki tabel komentar |
| .jpg / .jpeg / .png | Tidak | Nama berkas harus cocok dengan referensi gambar |
| .zip | Alternatif | Berisi satu atau lebih HTML beserta gambar terkait |

### Skema record

Setiap komentar hasil ekstraksi dinormalisasi ke struktur berikut.

| Field | Tipe | Aturan |
| --- | --- | --- |
| commentId | string | ID sumber, opsional |
| viewpoint | string | Wajib; nama viewpoint |
| discipline | choice | PIP, STR, ELE, INS, TEL, HVAC, LOSPE, HANDLING, OTHER |
| commentText | string | Wajib; isi komentar |
| resolution | string | Opsional; tindak lanjut |
| status | choice | Open, In Review, Closed |
| commentDate | string | Wajib; tanggal sumber |
| authorCode | string | Opsional |
| cameraPosition | string | Opsional; koordinat x, y, z |
| imageRef | string | Opsional; nama gambar |
| imageData | string | Opsional; data URL gambar |

### Contoh input ternormalisasi

Representasi internal setelah parser membaca sumber.

```text
{
  "viewpoint": "Tag View 1",
  "discipline": { "Value": "PIP" },
  "commentText": "Update escape route based on AFC drawing",
  "resolution": "",
  "status": { "Value": "Open" },
  "commentDate": "2025-09-03",
  "authorCode": "PSS100320",
  "cameraPosition": "98.430m, 62.843m, 52.818m",
  "imageRef": "vp0511.jpg"
}
```

### Validasi

Input diperiksa sebelum record dimasukkan ke memori.

- Tolak pilihan jika tidak ada HTML di luar paket ZIP.
- Tolak paket yang tidak menghasilkan komentar viewpoint.
- Abaikan berkas yang formatnya tidak didukung.
- Cocokkan gambar berdasarkan nama referensi tanpa membedakan huruf besar/kecil.
- Tampilkan jumlah HTML, komentar, dan gambar yang berhasil diproses.

---

## Alur pemrosesan

Pipeline memproses berkas di browser, mengekstrak data, menormalisasi field, menghubungkan gambar, lalu memperbarui cache antarmuka.

### Pipeline

Urutan deterministik menjaga hasil konsisten untuk HTML tunggal maupun ZIP.

| Langkah | Proses | Keluaran |
| --- | --- | --- |
| 1 | Deteksi jenis sumber | Mode HTML atau ZIP |
| 2 | Ekstrak entri ZIP bila diperlukan | Daftar HTML dan gambar |
| 3 | Parse DOM tabel komentar | Baris mentah |
| 4 | Normalisasi field dan choice | Record valid |
| 5 | Hubungkan imageRef ke imageData | Bukti visual tertanam |
| 6 | Import record ke service in-memory | Data sesi |
| 7 | Invalidate cache query | UI diperbarui |

### Transformasi data

Nilai mentah diseragamkan sebelum ditampilkan.

- Disiplin yang tidak dikenal dipetakan ke OTHER.
- Status kosong menggunakan Open sebagai kondisi awal.
- Whitespace pada komentar dibersihkan tanpa mengubah isi.
- Tanggal dipertahankan sebagai string sumber untuk kompatibilitas.
- Gambar dibaca menjadi data URL agar dapat ditampilkan tanpa server.

### Logika status

Perubahan status mengikuti progres koordinasi.

```text
Open
  └─ komentar baru membutuhkan tindakan
      ↓
In Review
  └─ resolusi telah diajukan dan diperiksa
      ↓
Closed
  └─ isu dinyatakan selesai

Catatan: status dapat dikembalikan ke tahap sebelumnya
jika resolusi belum memenuhi kebutuhan review.
```

### Penanganan kegagalan

Kegagalan dibatasi pada proses yang terdampak agar sesi tetap dapat digunakan.

| Kondisi | Respons |
| --- | --- |
| ZIP rusak | Batalkan impor dan tampilkan pesan paket tidak dapat dibaca |
| HTML tanpa komentar | Jangan membuat record; tampilkan notifikasi informatif |
| Gambar tidak ditemukan | Tetap impor komentar tanpa imageData |
| Operasi service gagal | Pertahankan data lama dan tampilkan error |
| Query gagal | Tampilkan retry hanya pada bagian terkait |

---

## Spesifikasi output

Hasil proses disajikan sebagai record review, indikator KPI, visualisasi distribusi, dan umpan balik impor yang langsung dapat ditindaklanjuti.

### Keluaran utama

Empat representasi membantu pengguna bergerak dari ringkasan ke detail.

| Output | Isi | Tujuan |
| --- | --- | --- |
| KPI | Total, Open, In Review, Closed | Memahami progres sekilas |
| Viewpoint list | Komentar, disiplin, status, tanggal | Menemukan dan membuka isu |
| Detail review | Isi, gambar, kamera, resolusi | Menyelesaikan satu komentar |
| Analytics | Tren waktu dan beban disiplin | Menemukan bottleneck |

### Contoh response operasi

Service mengembalikan status operasi dan data hasil.

```text
{
  "success": true,
  "data": {
    "ID": 6,
    "viewpoint": "Tag View 1",
    "discipline": { "Value": "PIP" },
    "status": { "Value": "Open" },
    "commentText": "Update escape route based on AFC drawing",
    "commentDate": "2025-09-03"
  }
}
```

### Notifikasi hasil impor

Umpan balik ringkas tampil setelah pemrosesan selesai.

```text
12 komentar berhasil diimpor dari 1 HTML;
10 gambar diproses.
```

### Kriteria keberhasilan

Output dianggap valid ketika memenuhi pemeriksaan berikut.

- Setiap record memiliki viewpoint, commentText, discipline, status, dan tanggal.
- Jumlah KPI sama dengan agregasi record aktif.
- Filter tidak mengubah sumber data, hanya tampilan.
- Perubahan resolusi dan status segera terlihat pada daftar dan analitik.
- Tidak ada data yang dikirim ke server atau disimpan setelah refresh.