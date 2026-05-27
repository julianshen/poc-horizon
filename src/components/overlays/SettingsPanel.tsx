import React, { useCallback, useEffect, useState } from "react";
import { SidePanel } from "./SidePanel";
import { useBrowserStore } from "../../stores/browserStore";
import type { Settings } from "../../types/browser";
import {
  Section,
  Field,
  Select,
  TextInput,
  Toggle,
} from "./SettingsPanel.parts";

export const SettingsPanel: React.FC = () => {
  const { showSettings, toggleOverlay } = useBrowserStore();
  const [settings, setSettings] = useState<Partial<Settings> | null>(null);
  const close = useCallback(
    () => toggleOverlay("showSettings"),
    [toggleOverlay],
  );

  useEffect(() => {
    if (!showSettings) return;
    let cancelled = false;
    void (async () => {
      const s = (await window.horizonAPI.invoke(
        "settings:getAll",
        {},
      )) as Partial<Settings>;
      if (!cancelled) setSettings(s ?? {});
    })();
    return () => {
      cancelled = true;
    };
  }, [showSettings]);

  const update = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((s) => ({ ...(s ?? {}), [key]: value }));
      window.horizonAPI.invoke("settings:set", { key, value });
    },
    [],
  );

  return (
    <SidePanel open={showSettings} title="Settings" onClose={close}>
      <div className="px-4 py-4 space-y-5">
        <Section title="Appearance">
          <Field label="Theme">
            <Select
              value={settings?.theme ?? "dia"}
              onChange={(v) => update("theme", v as Settings["theme"])}
              options={[
                ["system", "Match system"],
                ["dia", "Dia"],
                ["midnight", "Midnight"],
                ["ocean", "Ocean"],
                ["forest", "Forest"],
              ]}
            />
          </Field>
          <Field label="Accent color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={settings?.accentColor || "#d44d7a"}
                onChange={(e) => update("accentColor", e.target.value)}
                className="w-8 h-8 rounded cursor-pointer"
              />
              {settings?.accentColor ? (
                <button
                  className="text-xs underline"
                  onClick={() => update("accentColor", "")}
                >
                  Reset to default
                </button>
              ) : (
                <span
                  className="text-xs"
                  style={{ color: "var(--chrome-fg-subtle)" }}
                >
                  Using preset default
                </span>
              )}
            </div>
          </Field>
          <Toggle
            label="Show bookmarks bar"
            checked={settings?.showBookmarksBar ?? true}
            onChange={(v) => update("showBookmarksBar", v)}
          />
        </Section>
        <Section title="Search">
          <Field label="Default search engine">
            <Select
              value={settings?.defaultSearchEngine ?? "duckduckgo"}
              onChange={(v) => update("defaultSearchEngine", v)}
              options={[
                ["duckduckgo", "DuckDuckGo"],
                ["google", "Google"],
                ["bing", "Bing"],
                ["startpage", "Startpage"],
              ]}
            />
          </Field>
        </Section>
        <Section title="Privacy">
          <Toggle
            label="Block third-party cookies"
            checked={settings?.blockThirdPartyCookies ?? true}
            onChange={(v) => update("blockThirdPartyCookies", v)}
          />
          <Toggle
            label="Send Do Not Track"
            checked={settings?.doNotTrack ?? false}
            onChange={(v) => update("doNotTrack", v)}
          />
        </Section>
        <Section title="AI Agent">
          <Field label="Confirm agent actions">
            <Select
              value={(settings?.aiConfirmActions as string) ?? "never"}
              onChange={(v) =>
                update("aiConfirmActions", v as "never" | "risky" | "all")
              }
              options={[
                ["never", "Never (trust agent)"],
                ["risky", "Risky actions only"],
                ["all", "Every action"],
              ]}
            />
          </Field>
          <Toggle
            label="Advertise agent traffic (X-Horizon-Agent header)"
            checked={settings?.aiAdvertiseAgent ?? true}
            onChange={(v) => update("aiAdvertiseAgent", v)}
          />
        </Section>
        <Section title="Proxy">
          <Field label="Proxy type">
            <Select
              value={(settings?.proxyType as string) ?? "system"}
              onChange={(v) =>
                update("proxyType", v as "system" | "direct" | "manual")
              }
              options={[
                ["system", "Use system proxy"],
                ["direct", "Direct (no proxy)"],
                ["manual", "Manual configuration"],
              ]}
            />
          </Field>
          {settings?.proxyType === "manual" && (
            <>
              <Field label="Proxy rules">
                <TextInput
                  value={settings?.proxyRules ?? ""}
                  onChange={(v) => update("proxyRules", v)}
                  placeholder="http=127.0.0.1:8080;https=127.0.0.1:8443"
                />
              </Field>
              <Field label="Bypass rules">
                <TextInput
                  value={settings?.proxyBypassRules ?? ""}
                  onChange={(v) => update("proxyBypassRules", v)}
                  placeholder="<local>,*.internal"
                />
              </Field>
            </>
          )}
        </Section>
        <Section title="Downloads">
          <Toggle
            label="Ask where to save each file"
            checked={settings?.askWhereToSave ?? false}
            onChange={(v) => update("askWhereToSave", v)}
          />
        </Section>
      </div>
    </SidePanel>
  );
};
