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
