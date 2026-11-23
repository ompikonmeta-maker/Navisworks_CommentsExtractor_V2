// Settings › Backup (admins on the server): one zip with the database,
// photos and templates, and how to put it back.
import { useData } from '../data/index.js';
import { Icon, Card } from './ui.jsx';

export default function BackupCard() {
  const { backupUrl } = useData();
  if (!backupUrl) return null;
  return (
    <Card className="flex flex-wrap items-start gap-5 p-6">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-primary-container text-primary">
        <Icon name="storage" className="text-[24px]" />
      </span>
      <div className="min-w-0 flex-[999_1_320px]">
        <h2 className="text-[17px] font-semibold">Backup</h2>
        <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
          One zip with every project, comment, photo and template. Safe to take while people work. Keep it on another PC or a shared drive.
        </p>
        <details className="mt-2 text-[13px] text-on-surface-variant">
          <summary className="cursor-pointer font-medium text-primary">How to restore</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
            <li>Close the Tabelin server window.</li>
            <li>In its <b>data</b> folder, move the old <b>tabelin.db</b> and <b>files</b> somewhere safe.</li>
            <li>Copy <b>tabelin.db</b> and <b>files</b> from the backup zip into the data folder.</li>
            <li>Start Tabelin again and open a review to check.</li>
          </ol>
        </details>
      </div>
      <a href={backupUrl} download
        className="t-press inline-flex h-10 shrink-0 items-center gap-2 rounded-control bg-secondary-container px-5 text-sm font-semibold text-on-secondary-container hover:shadow-md-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <Icon name="download" className="text-[19px]" />Download backup
      </a>
    </Card>
  );
}
