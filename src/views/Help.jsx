import { useState } from 'react';
import { Icon, Card, SegmentedButtons } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { setRevealDir } from '../lib/motion.js';
import { remoteState } from '../lib/server.js';
import shotPicker from '../assets/help/picker.webp';
import shotOverview from '../assets/help/overview.webp';
import shotReimport from '../assets/help/reimport.webp';
import shotList from '../assets/help/list.webp';
import shotDrawer from '../assets/help/drawer.webp';
import shotAdd from '../assets/help/add.webp';
import shotBulk from '../assets/help/bulk.webp';
import shotExport from '../assets/help/export.webp';

// Help: a short, picture-led guide (How to use) and who-can-do-what (Roles &
// limits), in English or Bahasa Indonesia. Screenshots are real captures of
// the app, embedded in the build so Help works offline too.

const C = { blue: '#2a78d6', violet: '#7a5af8', green: '#1baf7a', orange: '#eb6834', pink: '#d9548f', teal: '#0e7c86', amber: '#d98a00', slate: '#64748b' };
const tint = (c, p = 14) => `color-mix(in srgb, ${c} ${p}%, transparent)`;

const APP_VERSION = '2.0.0';
const TABS = ['use', 'roles', 'about'];
const LANG_KEY = 'tabelin.helpLang';
function initialLang() {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'en' || v === 'id') return v; } catch { /* no storage */ }
  return (navigator.language || '').toLowerCase().startsWith('id') ? 'id' : 'en';
}

// ---------------------------------------------------------------- content
const T = {
  en: {
    sub: 'Short guide · real screens',
    tabs: { use: 'How to use', roles: 'Roles & limits', about: 'About' },
    about: {
      server: 'Shared on your office Tabelin server · settings saved per project.',
      local: 'Runs fully in your browser · settings saved on this PC · nothing uploaded.',
      title: 'Where each field comes from',
      note: 'Any of these can go to a column in your Excel template (Settings › Template).',
      groups: [
        { icon: 'description', c: C.blue, title: 'From the report', sub: 'Written by Navisworks.', rows: [
          ['Viewpoint', 'Tag view title'], ['Image ref', 'Picture file name'], ['Camera position', 'Saved camera'],
          ['Comment ID', 'Number in the viewpoint'], ['Author code', 'Navisworks “User”'], ['Comment date', 'Date after the comment'],
          ['Raw text · status', 'As written, e.g. “New”'] ] },
        { icon: 'search', c: C.violet, title: 'Read from the text', sub: 'Tune it in Settings › Detection.', rows: [
          ['Comment text', 'Without the “Name:” prefix'], ['Commenter', 'The “Name:” at the start'],
          ['Discipline', 'Guessed from words'], ['Status', 'Tidied to Open / In Review / Closed'] ] },
        { icon: 'edit', c: C.green, title: 'Added in Tabelin', sub: 'Yours to fill in.', rows: [
          ['Resolution', 'You type it'], ['Closed at', 'Stamped when closed'], ['After photo', 'Uploaded or pasted'],
          ['Custom fields', 'Evidence, remarks, …'], ['Source', 'Report file name, or “manual”'] ] },
      ],
    },
    flowTitle: 'From report to log sheet',
    flow: [
      ['upload_file', 'Import', 'Navisworks report'],
      ['search', 'Review', 'Find & sort out'],
      ['photo_camera', 'Close', 'After photo + note'],
      ['download', 'Export', 'Excel log sheet'],
    ],
    server: 'Server',
    adminOnly: 'Admin',
    steps: [
      { icon: 'login', c: C.slate, server: true, title: 'Sign in and pick a review', shot: shotPicker, alt: 'Projects list',
        pts: ['Sign in with your name and PIN.', 'Open a project, then a review.', 'Switch review any time from the chip at the top.'] },
      { icon: 'upload_file', c: C.blue, admin: true, title: 'Import the Navisworks report', shot: shotOverview, alt: 'Overview with setup checklist',
        pts: ['In Navisworks export Viewpoints as HTML (with its images, or as one .zip).', 'Overview › Import and pick the file.', 'Follow the checklist: target date, log-sheet template, team.'] },
      { icon: 'merge', c: C.violet, admin: true, title: 'Got a newer report? Import again', shot: shotReimport, alt: 'Update from a new report',
        pts: ['Comments are matched by their ID — no duplicates.', 'Your status, photos and notes stay.', 'Decide what happens to comments no longer in the report.'],
        tip: 'Changed your mind? Press Undo on the message, or ⋯ › Undo last import.' },
      { icon: 'search', c: C.teal, title: 'Find what needs work', shot: shotList, alt: 'Viewpoints list with filters',
        pts: ['Search, or filter by discipline and status.', 'Quick chips: no after-photo, no resolution, open > 3 months.', 'On the Overview, Do next › Open list shows exactly those comments.'] },
      { icon: 'photo_camera', c: C.green, title: 'Close a comment', shot: shotDrawer, alt: 'Comment details with before and after photos',
        pts: ['Click a row to open it.', 'Add the After photo — it marks the comment Closed.', 'Keys 1 / 2 / 3 set the status. Ctrl+Enter or J / K move to the next comment.'],
        tip: 'Snapshot (Win+Shift+S), point at Before or After, press Ctrl+V.' },
      { icon: 'add', c: C.pink, admin: true, title: 'Add a comment by hand', shot: shotAdd, alt: 'Add comment dialog',
        pts: ['Viewpoints › Add, for issues found outside Navisworks.', 'Discipline and commenter are read from the text.', 'Paste a snapshot as the Before photo.'] },
      { icon: 'fact_check', c: C.orange, title: 'Change many at once', shot: shotBulk, alt: 'Several comments selected',
        pts: ['Tick the rows.', 'Set discipline, status or commenter for all of them from the bar.'] },
      { icon: 'download', c: C.blue, title: 'Export the log sheet', shot: shotExport, w: 300, alt: 'Export menu',
        pts: ['Export log sheet fills your Excel template, photos included.', 'Quick Excel exports just the list you see.', 'Set the template once in Settings › Template.'] },
    ],
    keysTitle: 'Handy keys',
    keys: [['1 2 3', 'Set the status'], ['Ctrl Enter', 'Next comment · save a new one'], ['J  K', 'Next / previous comment'], ['Ctrl V', 'Paste a snapshot'], ['Esc', 'Close a panel or dialog']],
    whereTitle: 'Where is my data?',
    where: [
      ['lan', C.blue, 'Server version', 'On the office server, in the data folder next to tabelin-server.exe. Never on the internet.'],
      ['storage', C.violet, 'Offline file', 'In this browser on this PC. Pick a session folder to keep a copy as a file.'],
      ['image', C.green, 'Snapshot PNG', 'The Snapshot button saves a picture to your Downloads folder.'],
    ],
    // roles
    rolesTitle: 'Two roles',
    roles: [
      { k: 'admin', icon: 'admin_panel_settings', c: C.blue, name: 'Admin', line: 'Sets up the review and the team.', can: [['Everything a reviewer can', 1], ['Import, add & delete comments', 1], ['Settings, projects, users', 1]] },
      { k: 'reviewer', icon: 'edit', c: C.green, name: 'Reviewer', line: 'Works the comments.', can: [['Status, resolution, photos', 1], ['Bulk edit & export', 1], ['No import, delete or settings', 0]] },
    ],
    matrixTitle: 'Who can do what',
    cols: ['Admin', 'Reviewer'],
    matrix: [
      ['See projects, comments, photos, charts', 1, 1],
      ['Export log sheet / Excel, snapshot', 1, 1],
      ['Edit status, resolution, discipline, commenter, custom fields', 1, 1],
      ['Add · replace · remove photos', 1, 1],
      ['Change many at once', 1, 1],
      ['Import, update from a new report, undo import', 1, 0],
      ['Add or delete comments', 1, 0],
      ['Labels, detection, template, statuses, target', 1, 0],
      ['Create · rename · delete projects and reviews', 1, 0],
      ['Add users, set roles, reset PINs', 1, 0],
    ],
    offlineNote: 'Offline file: one person, no sign-in — whoever opens it can edit.',
    safeTitle: 'Built-in safety',
    safe: [
      'An admin can’t remove or demote themselves.',
      'Deleting a review with comments asks you to type its name.',
      'A project can only be deleted once it is empty.',
      'A reviewer’s limits are enforced by the server, not just hidden buttons.',
    ],
    limitsTitle: 'Good to know',
    limits: [
      ['lock', 'Everyone sees every project', 'Roles apply to the whole server, not per project.'],
      ['undo', 'Deleting is final', 'Only the last import can be undone. Back up the data folder.'],
      ['history', 'History on the server only', 'Each comment shows who changed what. The offline file keeps no history.'],
      ['sync', 'No live updates', 'Two people on one comment: the last save wins. Reload to see others’ work.'],
      ['upload_file', 'Navisworks HTML only', 'Viewpoints report (.html / .zip). Photos: JPG or PNG.'],
      ['image', 'Size limits', 'Photo up to 25 MB, template up to 50 MB.'],
      ['description', 'Report fields are fixed', 'Text, viewpoint, date and camera change only by re-import.'],
      ['lan', 'Office network only', 'The server can’t be reached from outside the office.'],
    ],
  },
  id: {
    sub: 'Panduan singkat · tampilan asli',
    tabs: { use: 'Cara pakai', roles: 'Hak akses', about: 'Tentang' },
    about: {
      server: 'Dipakai bersama di server Tabelin kantor · setting disimpan per project.',
      local: 'Berjalan penuh di browser · setting disimpan di PC ini · tidak ada yang di-upload.',
      title: 'Asal setiap field',
      note: 'Semua field ini bisa diisikan ke kolom template Excel Anda (Settings › Template).',
      groups: [
        { icon: 'description', c: C.blue, title: 'Dari laporan', sub: 'Ditulis oleh Navisworks.', rows: [
          ['Viewpoint', 'Judul tag view'], ['Image ref', 'Nama file gambar'], ['Camera position', 'Posisi kamera'],
          ['Comment ID', 'Nomor di viewpoint'], ['Author code', '“User” Navisworks'], ['Comment date', 'Tanggal di akhir komentar'],
          ['Teks · status asli', 'Apa adanya, mis. “New”'] ] },
        { icon: 'search', c: C.violet, title: 'Dibaca dari teks', sub: 'Atur di Settings › Detection.', rows: [
          ['Comment text', 'Tanpa awalan “Nama:”'], ['Commenter', '“Nama:” di awal teks'],
          ['Discipline', 'Ditebak dari kata'], ['Status', 'Dirapikan jadi Open / In Review / Closed'] ] },
        { icon: 'edit', c: C.green, title: 'Ditambah di Tabelin', sub: 'Anda yang mengisi.', rows: [
          ['Resolution', 'Anda ketik'], ['Closed at', 'Tercatat saat ditutup'], ['After photo', 'Upload atau paste'],
          ['Custom fields', 'Evidence, remarks, …'], ['Source', 'Nama file laporan, atau “manual”'] ] },
      ],
    },
    flowTitle: 'Dari laporan ke log sheet',
    flow: [
      ['upload_file', 'Import', 'Laporan Navisworks'],
      ['search', 'Review', 'Cari & rapikan'],
      ['photo_camera', 'Tutup', 'Foto after + catatan'],
      ['download', 'Export', 'Log sheet Excel'],
    ],
    server: 'Server',
    adminOnly: 'Admin',
    steps: [
      { icon: 'login', c: C.slate, server: true, title: 'Login dan pilih review', shot: shotPicker, alt: 'Daftar project',
        pts: ['Login dengan nama dan PIN.', 'Buka project, lalu review.', 'Ganti review kapan saja lewat chip di atas.'] },
      { icon: 'upload_file', c: C.blue, admin: true, title: 'Import laporan Navisworks', shot: shotOverview, alt: 'Overview dengan checklist',
        pts: ['Di Navisworks, export Viewpoints sebagai HTML (beserta gambar, atau satu .zip).', 'Overview › Import, pilih filenya.', 'Ikuti checklist: tanggal target, template log sheet, tim.'] },
      { icon: 'merge', c: C.violet, admin: true, title: 'Ada laporan baru? Import lagi', shot: shotReimport, alt: 'Update dari laporan baru',
        pts: ['Komentar dicocokkan lewat ID — tidak ada duplikat.', 'Status, foto, dan catatan Anda tetap aman.', 'Pilih nasib komentar yang hilang dari laporan.'],
        tip: 'Berubah pikiran? Tekan Undo di pesan, atau ⋯ › Undo last import.' },
      { icon: 'search', c: C.teal, title: 'Cari yang perlu dikerjakan', shot: shotList, alt: 'Daftar viewpoint dengan filter',
        pts: ['Cari, atau filter discipline dan status.', 'Chip cepat: tanpa foto after, tanpa resolusi, open > 3 bulan.', 'Di Overview, Do next › Open list membuka daftar persisnya.'] },
      { icon: 'photo_camera', c: C.green, title: 'Menutup komentar', shot: shotDrawer, alt: 'Detail komentar dengan foto before dan after',
        pts: ['Klik baris untuk membukanya.', 'Tambah foto After — komentar otomatis Closed.', 'Tombol 1 / 2 / 3 mengatur status. Ctrl+Enter atau J / K pindah ke komentar berikutnya.'],
        tip: 'Snapshot (Win+Shift+S), arahkan ke Before atau After, tekan Ctrl+V.' },
      { icon: 'add', c: C.pink, admin: true, title: 'Tambah komentar manual', shot: shotAdd, alt: 'Dialog tambah komentar',
        pts: ['Viewpoints › Add, untuk temuan di luar Navisworks.', 'Discipline dan commenter terbaca dari teks.', 'Paste snapshot sebagai foto Before.'] },
      { icon: 'fact_check', c: C.orange, title: 'Ubah banyak sekaligus', shot: shotBulk, alt: 'Beberapa komentar dipilih',
        pts: ['Centang baris-barisnya.', 'Atur discipline, status, atau commenter untuk semuanya dari bar.'] },
      { icon: 'download', c: C.blue, title: 'Export log sheet', shot: shotExport, w: 300, alt: 'Menu export',
        pts: ['Export log sheet mengisi template Excel Anda, lengkap dengan foto.', 'Quick Excel hanya daftar yang tampil.', 'Pasang template sekali di Settings › Template.'] },
    ],
    keysTitle: 'Tombol praktis',
    keys: [['1 2 3', 'Atur status'], ['Ctrl Enter', 'Komentar berikutnya · simpan komentar baru'], ['J  K', 'Komentar berikut / sebelumnya'], ['Ctrl V', 'Paste snapshot'], ['Esc', 'Tutup panel atau dialog']],
    whereTitle: 'Data saya di mana?',
    where: [
      ['lan', C.blue, 'Versi server', 'Di server kantor, folder data di samping tabelin-server.exe. Tidak pernah ke internet.'],
      ['storage', C.violet, 'File offline', 'Di browser PC ini. Pilih folder sesi agar ada salinan berupa file.'],
      ['image', C.green, 'Snapshot PNG', 'Tombol Snapshot menyimpan gambar ke folder Downloads.'],
    ],
    rolesTitle: 'Dua peran',
    roles: [
      { k: 'admin', icon: 'admin_panel_settings', c: C.blue, name: 'Admin', line: 'Menyiapkan review dan tim.', can: [['Semua yang bisa reviewer', 1], ['Import, tambah & hapus komentar', 1], ['Settings, project, user', 1]] },
      { k: 'reviewer', icon: 'edit', c: C.green, name: 'Reviewer', line: 'Mengerjakan komentar.', can: [['Status, resolusi, foto', 1], ['Edit massal & export', 1], ['Tanpa import, hapus, settings', 0]] },
    ],
    matrixTitle: 'Siapa boleh apa',
    cols: ['Admin', 'Reviewer'],
    matrix: [
      ['Lihat project, komentar, foto, grafik', 1, 1],
      ['Export log sheet / Excel, snapshot', 1, 1],
      ['Edit status, resolusi, discipline, commenter, custom field', 1, 1],
      ['Tambah · ganti · hapus foto', 1, 1],
      ['Ubah banyak sekaligus', 1, 1],
      ['Import, update dari laporan baru, undo import', 1, 0],
      ['Tambah atau hapus komentar', 1, 0],
      ['Label, deteksi, template, status, target', 1, 0],
      ['Buat · ganti nama · hapus project dan review', 1, 0],
      ['Tambah user, atur peran, reset PIN', 1, 0],
    ],
    offlineNote: 'File offline: satu orang, tanpa login — siapa pun yang membuka bisa mengedit.',
    safeTitle: 'Pengaman bawaan',
    safe: [
      'Admin tidak bisa menghapus atau menurunkan perannya sendiri.',
      'Hapus review yang berisi komentar wajib ketik namanya.',
      'Project hanya bisa dihapus jika sudah kosong.',
      'Batasan reviewer dijaga oleh server, bukan sekadar tombol disembunyikan.',
    ],
    limitsTitle: 'Perlu diketahui',
    limits: [
      ['lock', 'Semua project terlihat', 'Peran berlaku untuk seluruh server, bukan per project.'],
      ['undo', 'Hapus itu permanen', 'Hanya import terakhir yang bisa di-undo. Backup folder data.'],
      ['history', 'Riwayat hanya di server', 'Setiap komentar menunjukkan siapa mengubah apa. File offline tidak menyimpan riwayat.'],
      ['sync', 'Tidak real-time', 'Dua orang di satu komentar: simpanan terakhir menang. Reload untuk melihat kerja orang lain.'],
      ['upload_file', 'Hanya HTML Navisworks', 'Laporan Viewpoints (.html / .zip). Foto: JPG atau PNG.'],
      ['image', 'Batas ukuran', 'Foto maks. 25 MB, template maks. 50 MB.'],
      ['description', 'Field laporan tetap', 'Teks, viewpoint, tanggal, kamera berubah hanya lewat import ulang.'],
      ['lan', 'Hanya jaringan kantor', 'Server tidak bisa diakses dari luar kantor.'],
    ],
  },
};

// ---------------------------------------------------------------- pieces
function Bubble({ icon, c, size = 40 }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-control" style={{ width: size, height: size, background: tint(c, 16), color: c }}>
      <Icon name={icon} className={size > 36 ? 'text-[22px]' : 'text-[18px]'} />
    </span>
  );
}

function Shot({ src, alt, c, w }) {
  return (
    <div className="help-shot rounded-[20px] p-3 sm:p-4" style={{ background: `linear-gradient(135deg, ${tint(c, 18)}, ${tint(c, 6)})` }}>
      <img src={src} alt={alt} decoding="async" className="mx-auto block h-auto max-h-[420px] w-auto max-w-full rounded-[12px]" style={w ? { width: w } : undefined} />
    </div>
  );
}

function Flow({ t }) {
  const cols = [C.blue, C.violet, C.green, C.orange];
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="mb-5 text-base font-semibold">{t.flowTitle}</h2>
      <ol className="help-flow grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4">
        {t.flow.map(([icon, name, note], i) => (
          <li key={name} className="relative flex flex-col items-center text-center" style={{ '--c': cols[i] }}>
            {i < t.flow.length - 1 && <span aria-hidden="true" className="help-flow-line" />}
            <span className="relative grid h-14 w-14 place-items-center rounded-full text-white shadow-md" style={{ background: cols[i] }}>
              <Icon name={icon} className="text-[26px]" />
              <b className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-surface text-[12px] tabular-nums shadow" style={{ color: cols[i] }}>{i + 1}</b>
            </span>
            <span className="mt-2.5 text-sm font-semibold">{name}</span>
            <span className="text-xs text-on-surface-variant">{note}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Step({ s, n, flip, serverLabel, adminLabel }) {
  return (
    <Card className="overflow-hidden p-5 sm:p-6">
      <div className={`grid items-center gap-5 ${flip ? 'lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:[&>*:first-child]:order-2' : 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]'}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white tabular-nums" style={{ background: s.c }}>{n}</span>
            <h3 className="min-w-0 text-[17px] font-semibold leading-snug">{s.title}</h3>
            {(s.server || s.admin) && (
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: tint(s.admin ? C.blue : s.c, 16), color: s.admin ? C.blue : s.c }}>
                {s.admin && <Icon name="admin_panel_settings" className="text-[14px]" />}{s.admin ? adminLabel : serverLabel}
              </span>
            )}
          </div>
          <ul className="mt-4 space-y-2.5">
            {s.pts.map((p) => (
              <li key={p} className="flex gap-2.5 text-sm leading-relaxed">
                <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: s.c }} />
                <span className="min-w-0">{p}</span>
              </li>
            ))}
          </ul>
          {s.tip && (
            <p className="mt-4 flex gap-2 rounded-control px-3 py-2.5 text-[13px] leading-snug" style={{ background: tint(s.c, 10) }}>
              <Icon name="lightbulb" className="shrink-0 text-[18px]" style={{ color: s.c }} />
              <span className="min-w-0">{s.tip}</span>
            </p>
          )}
        </div>
        <Shot src={s.shot} alt={s.alt} c={s.c} w={s.w} />
      </div>
    </Card>
  );
}

function HowTo({ t }) {
  return (
    <>
      <Flow t={t} />
      {t.steps.map((s, i) => <Step key={s.title} s={s} n={i + 1} flip={i % 2 === 1} serverLabel={t.server} adminLabel={t.adminOnly} />)}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="flex flex-col p-5 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold"><Icon name="keyboard" className="text-[20px] text-primary" />{t.keysTitle}</h2>
          <ul className="flex flex-1 flex-col justify-between gap-3">
            {t.keys.map(([k, d]) => (
              <li key={k} className="flex items-center gap-3 text-sm">
                <span className="flex shrink-0 gap-1">{k.split(/\s+/).map((x) => <kbd key={x} className="help-kbd">{x}</kbd>)}</span>
                <span className="min-w-0 text-on-surface-variant">{d}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold"><Icon name="storage" className="text-[20px] text-primary" />{t.whereTitle}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {t.where.map(([icon, c, title, d]) => (
              <div key={title} className="rounded-[18px] p-4" style={{ background: tint(c, 9) }}>
                <Bubble icon={icon} c={c} size={36} />
                <div className="mt-3 text-sm font-semibold">{title}</div>
                <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{d}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function Roles({ t }) {
  const colC = [C.blue, C.green];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {t.roles.map((r) => (
          <Card key={r.k} className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4" style={{ background: `linear-gradient(135deg, ${tint(r.c, 22)}, ${tint(r.c, 6)})` }}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow" style={{ background: r.c }}><Icon name={r.icon} className="text-[22px]" /></span>
              <div className="min-w-0">
                <div className="text-base font-bold">{r.name}</div>
                <div className="text-xs text-on-surface-variant">{r.line}</div>
              </div>
            </div>
            <ul className="flex flex-1 flex-col justify-between gap-2 px-5 py-4">
              {r.can.map(([x, ok]) => (
                <li key={x} className="flex items-center gap-2 text-sm">
                  <Icon name={ok ? 'check_circle' : 'block'} className="shrink-0 text-[18px]" style={{ color: ok ? r.c : 'var(--tabelin-bad)' }} />{x}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="mb-3 text-base font-semibold">{t.matrixTitle}</h2>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[420px] border-separate border-spacing-x-2 text-sm">
            <thead>
              <tr>
                <th />
                {t.cols.map((h, i) => (
                  <th key={h} className="w-20 pb-2 text-center text-xs font-semibold" style={{ color: colC[i] }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.matrix.map(([label, ...v]) => (
                <tr key={label}>
                  <td className="border-t border-outline-variant py-2.5 pr-2">{label}</td>
                  {v.map((on, i) => (
                    <td key={i} className="border-t border-outline-variant text-center" style={{ background: tint(colC[i], 5) }}>
                      {on
                        ? <span className="inline-grid h-6 w-6 place-items-center rounded-full text-white" style={{ background: colC[i] }}><Icon name="check" className="text-[16px]" /></span>
                        : <span className="inline-block h-[3px] w-3 rounded-full bg-outline-variant align-middle" aria-label="no" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-on-surface-variant"><Icon name="info" className="text-[16px]" />{t.offlineNote}</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="flex flex-col p-5 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold"><Icon name="shield" className="text-[20px]" style={{ color: 'var(--tabelin-good)' }} />{t.safeTitle}</h2>
          <ul className="flex flex-1 flex-col gap-3">
            {t.safe.map((x) => (
              <li key={x} className="flex flex-1 items-center gap-3 rounded-[16px] p-3 text-sm leading-snug" style={{ background: 'color-mix(in srgb, var(--tabelin-good) 9%, transparent)' }}>
                <Icon name="check_circle" className="shrink-0 text-[20px]" style={{ color: 'var(--tabelin-good)' }} /><span className="min-w-0">{x}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold"><Icon name="warning" className="text-[20px]" style={{ color: 'var(--tabelin-warn)' }} />{t.limitsTitle}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {t.limits.map(([icon, title, d]) => (
              <div key={title} className="flex gap-3 rounded-[16px] p-3" style={{ background: tint(C.amber, 8) }}>
                <Bubble icon={icon} c={C.amber} size={34} />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-snug">{title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function About({ t }) {
  const a = t.about;
  return (
    <>
      <Card className="flex items-center gap-4 p-5 sm:p-6">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] text-white shadow-md" style={{ background: `linear-gradient(135deg, ${C.blue}, ${C.violet})` }}>
          <Icon name="table_view" className="text-[28px]" />
        </span>
        <div className="min-w-0">
          <div className="text-lg font-bold">Tabelin <span className="text-sm font-semibold text-on-surface-variant">v{APP_VERSION}</span></div>
          <p className="mt-0.5 text-sm text-on-surface-variant">{remoteState.active ? a.server : a.local}</p>
        </div>
      </Card>
      <Card className="p-5 sm:p-6">
        <h2 className="mb-4 text-base font-semibold">{a.title}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {a.groups.map((g) => (
            <div key={g.title} className="flex flex-col rounded-[18px] p-4" style={{ background: tint(g.c, 8) }}>
              <div className="flex items-center gap-3">
                <Bubble icon={g.icon} c={g.c} size={36} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{g.title}</div>
                  <div className="text-xs text-on-surface-variant">{g.sub}</div>
                </div>
              </div>
              <dl className="mt-3 flex-1 divide-y" style={{ borderColor: tint(g.c, 20) }}>
                {g.rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 py-2 text-xs" style={{ borderColor: tint(g.c, 18) }}>
                    <dt className="shrink-0 font-semibold" style={{ color: g.c }}>{k}</dt>
                    <dd className="min-w-0 text-right text-on-surface-variant">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-on-surface-variant"><Icon name="info" className="shrink-0 text-[16px]" />{a.note}</p>
      </Card>
    </>
  );
}

export default function Help() {
  const [tab, setTab] = useState('use');
  const [lang, setLangState] = useState(initialLang);
  const setLang = (v) => { setLangState(v); try { localStorage.setItem(LANG_KEY, v); } catch { /* ignore */ } };
  const t = T[lang];
  const pickTab = (v) => { setRevealDir(TABS.indexOf(v) < TABS.indexOf(tab) ? -1 : 1); setTab(v); };
  return (
    <div className="canvas-w">
      <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Bubble icon="menu_book" c={C.blue} />
          <span className="text-sm text-on-surface-variant">{t.sub}</span>
        </div>
        <div className="order-last w-full lg:order-none lg:w-[420px]">
          <SegmentedButtons aria-label="Help section" value={tab} onChange={pickTab} options={TABS.map((k) => ({ value: k, label: t.tabs[k] }))} />
        </div>
        <div className="w-[116px] shrink-0">
          <SegmentedButtons aria-label="Language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'EN' }, { value: 'id', label: 'ID' }]} />
        </div>
      </Card>
      <Reveal className="space-y-4" deps={[tab, lang]}>
        {tab === 'use' ? <HowTo t={t} /> : tab === 'roles' ? <Roles t={t} /> : <About t={t} />}
      </Reveal>
    </div>
  );
}
