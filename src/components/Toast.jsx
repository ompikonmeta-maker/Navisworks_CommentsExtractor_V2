import { useEffect } from 'react';
import { useStore } from '../store/store.jsx';
import { Icon } from './ui.jsx';

const KIND = {
  success: { icon: 'check_circle', cls: 'bg-status-closed/15 text-status-closed border-status-closed/30' },
  error: { icon: 'error', cls: 'bg-error-container text-on-error-container border-error/40' },
  info: { icon: 'info', cls: 'bg-primary-container text-on-primary-container border-primary/30' },
};

export default function Toast() {
  const { toast, clearToast } = useStore();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 4500);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  if (!toast) return null;
  const k = KIND[toast.kind] || KIND.info;

  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 px-4"
    >
      <div className={`flex items-start gap-3 rounded-control border px-4 py-3 shadow-md-3 max-w-md ${k.cls}`}>
        <Icon name={k.icon} className="text-[20px] mt-0.5" />
        <p className="text-sm whitespace-pre-line">{toast.message}</p>
        <button onClick={clearToast} aria-label="Dismiss" className="ml-1 opacity-70 hover:opacity-100">
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>
    </div>
  );
}
