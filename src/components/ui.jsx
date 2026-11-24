import { Landmark } from 'lucide-react';

export function BrandMark({ light = false }) {
  return (
    <div className="brand-mark" style={light ? undefined : { color: 'var(--deep)' }}>
      <span className="glyph"><Landmark size={22} /></span>
      <span>
        <strong>ALTURA</strong>
        <small>PRIVATE BANKING</small>
      </span>
    </div>
  );
}

export function Alert({ kind = 'info', children, onClose }) {
  const cls = kind === 'error' ? 'alert-error' : kind === 'ok' ? 'alert-ok' : 'alert-info';
  return (
    <div className={`alert ${cls}`} role="status">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>{children}</div>
        {onClose && <button type="button" className="linkish" onClick={onClose}>Dismiss</button>}
      </div>
    </div>
  );
}

export function Badge({ status }) {
  const key = String(status || 'PENDING').toLowerCase().replace(/\s+/g, '_');
  return <span className={`badge badge-${key}`}>{String(status || '—').replaceAll('_', ' ')}</span>;
}

export function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Panel({ title, subtitle, action, children }) {
  return (
    <section className="panel">
      {(title || action) && (
        <header className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function money(minor, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format((Number(minor) || 0) / 100);
}

export function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

export function downloadCsv(filename, rows) {
  const escape = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = rows.map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
