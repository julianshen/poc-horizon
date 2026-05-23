import React, { useCallback, useEffect, useState } from 'react';
import { SidePanel } from './SidePanel';
import { useBrowserStore } from '../../stores/browserStore';
import type { Settings } from '../../types/browser';

export const SettingsPanel: React.FC = () => {
  const { showSettings, toggleOverlay } = useBrowserStore();
  const [settings, setSettings] = useState<Partial<Settings> | null>(null);
  const close = useCallback(() => toggleOverlay('showSettings'), [toggleOverlay]);

  useEffect(() => {
    if (!showSettings) return;
    let cancelled = false;
    void (async () => {
      const s = (await window.horizonAPI.invoke('settings:getAll', {})) as Partial<Settings>;
      if (!cancelled) setSettings(s ?? {});
    })();
    return () => {
      cancelled = true;
    };
  }, [showSettings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...(s ?? {}), [key]: value }));
    window.horizonAPI.invoke('settings:set', { key, value });
  }, []);

  return (
    <SidePanel open={showSettings} title="Settings" onClose={close}>
      <div className="px-4 py-4 space-y-5">
        <Section title="Appearance">
          <Field label="Theme">
            <Select
              value={settings?.theme ?? 'system'}
              onChange={(v) => update('theme', v as Settings['theme'])}
              options={[
                ['system', 'Match system'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ]}
            />
          </Field>
          <Toggle
            label="Show bookmarks bar"
            checked={settings?.showBookmarksBar ?? true}
            onChange={(v) => update('showBookmarksBar', v)}
          />
        </Section>
        <Section title="Search">
          <Field label="Default search engine">
            <Select
              value={settings?.defaultSearchEngine ?? 'duckduckgo'}
              onChange={(v) => update('defaultSearchEngine', v)}
              options={[
                ['duckduckgo', 'DuckDuckGo'],
                ['google', 'Google'],
                ['bing', 'Bing'],
                ['startpage', 'Startpage'],
              ]}
            />
          </Field>
        </Section>
        <Section title="Privacy">
          <Toggle
            label="Block third-party cookies"
            checked={settings?.blockThirdPartyCookies ?? true}
            onChange={(v) => update('blockThirdPartyCookies', v)}
          />
          <Toggle
            label="Send Do Not Track"
            checked={settings?.doNotTrack ?? false}
            onChange={(v) => update('doNotTrack', v)}
          />
        </Section>
        <Section title="Downloads">
          <Toggle
            label="Ask where to save each file"
            checked={settings?.askWhereToSave ?? false}
            onChange={(v) => update('askWhereToSave', v)}
          />
        </Section>
      </div>
    </SidePanel>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
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

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
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

const Select: React.FC<SelectProps> = ({ value, onChange, options }) => (
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

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({
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
