# Tabelin — Navisworks Comments Extractor

Ubah laporan **review comment Navisworks (HTML)** menjadi workspace review yang bisa
dicari, difilter, dan **diekspor ke Excel (`.xlsx`)** — semuanya berjalan di browser.
Tidak ada berkas yang diunggah ke server; data hidup di memori selama sesi berjalan.

## Fitur

- **Impor** satu/beberapa `.html`, gambar viewpoint `.jpg/.png`, atau paket `.zip`.
- **Parser Navisworks**: mengekstrak viewpoint + komentar, menautkan gambar, menormalisasi
  status, dan menyimpulkan disiplin (PIP, STR, ELE, INS, TEL, HVAC, LOSPE, HANDLING, OTHER).
- **Dashboard** dengan KPI (Total / Open / In Review / Closed) dan beban per disiplin.
- **Daftar viewpoint**: pencarian teks, filter disiplin & status, panel detail yang bisa
  disunting (status, disiplin, resolusi) dengan gambar & posisi kamera.
- **Analytics**: distribusi disiplin, status, dan tren komentar per bulan.
- **Export Excel** dari seluruh data atau sesuai filter (sheet Comments + Summary).
- **Material Design 3** (skema teal) dengan mode terang/gelap.

Data disimpan di memori browser. Memuat ulang halaman mengembalikan data ke sample bawaan;
tidak ada penyimpanan permanen.

## Portable · independen · tanpa admin

`npm run build` menghasilkan **satu file `dist/index.html`** (~2,3 MB) yang benar-benar
mandiri: semua JS/CSS, data sample, gambar, dan font ikon sudah tertanam di dalamnya.

- **Portable** — cukup satu file; copy ke USB atau folder mana pun.
- **Independen** — buka dengan **dobel-klik** di browser (`file://`). Tanpa server,
  tanpa Node, tanpa koneksi internet. Berfungsi penuh offline.
- **Tanpa admin** — tidak ada instalasi apa pun; tidak butuh hak administrator.

Ambil filenya dari tab **Actions** GitHub (artifact `tabelin-dist`) atau bangun sendiri
dengan `npm run build`.

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:5173
```

Build produksi:

```bash
npm run build    # hasil ke dist/
npm run preview  # pratinjau build
```

## Stack

React 18 · Vite 5 · Tailwind CSS 3 · Recharts · JSZip · SheetJS (xlsx).

Detail arsitektur ada di [`CLAUDE.md`](./CLAUDE.md); spesifikasi sistem di
[`docs/tabelin-dokumentasi.md`](./docs/tabelin-dokumentasi.md).
