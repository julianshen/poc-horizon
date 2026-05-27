import React from 'react';

/**
 * Form primitives for SettingsPanel. Extracted so the main panel
 * file stays under the file-size cap (AGENTS.md §3.4 — components
 * ≤200 lines). All five components are pure rendering; no state, no
 * hooks. Reuse beyond SettingsPanel is allowed.
 */

export const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section>
    <h3
      className="text-[11px] font-semibold tracking-wide uppercase mb-2"
      style={{ color: 'var(--chrome-fg-muted)', letterSpacing: '0.08em' }}
    >
      {title}
    </h3>
    <div className="space-y-2">{children}</div>
  </section>
);

export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--chrome-fg)' }}>
    <span>{label}</span>
    {children}
  </label>
);

interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}

export const Select: React.FC<SelectProps> = ({ value, onChange, options }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-8 px-2 rounded-md text-sm outline-none"
    style={{
      background: 'var(--omnibox-bg)',
      color: 'var(--chrome-fg)',
      border: '1px solid var(--chrome-border)',
    }}
  >
    {options.map(([v, label]) => (
      <option key={v} value={v}>
        {label}
      </option>
    ))}
  </select>
);

export const TextInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => (
  <input
    type="text" value={value} placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    className="h-8 px-2 rounded-md text-sm outline-none w-64"
    style={{ background: 'var(--omnibox-bg)', color: 'var(--chrome-fg)', border: '1px solid var(--chrome-border)' }}
  />
);

export const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <label className="flex items-center justify-between text-sm cursor-pointer" style={{ color: 'var(--chrome-fg)' }}>
    <span>{label}</span>
    <span
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className="relative w-9 h-5 rounded-full transition-colors"
      style={{
        background: checked ? 'var(--accent-primary)' : 'var(--chrome-border)',
      }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full"
        style={{
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform var(--transition-fast)',
          boxShadow: 'var(--shadow-sm)',
        }}
      />
    </span>
  </label>
);
