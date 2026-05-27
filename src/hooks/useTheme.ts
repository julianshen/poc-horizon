import { useEffect } from "react";
import { resolveTheme, buildAccentStyle } from "../utils/theme";

const FALLBACK_THEME = "dia";

function applyTheme(theme: string, accentColor: string): void {
  const isDarkOS = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(
    theme as "system" | "dia" | "midnight" | "ocean" | "forest",
    isDarkOS,
  );
  document.documentElement.dataset.theme = resolved;

  const accentCss = buildAccentStyle(accentColor);
  let styleTag = document.getElementById(
    "accent-override",
  ) as HTMLStyleElement | null;

  if (accentCss) {
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "accent-override";
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = accentCss;
  } else if (styleTag) {
    styleTag.remove();
  }
}

export function useTheme(): void {
  useEffect(() => {
    let mediaQuery: MediaQueryList | null = null;
    let mediaListener: (() => void) | null = null;
    let unsubscribeSettings: (() => void) | null = null;
    let cancelled = false;

    const init = async (): Promise<void> => {
      try {
        const settings = (await window.horizonAPI.invoke(
          "settings:getAll",
          {},
        )) as {
          theme?: string;
          accentColor?: string;
        } | null;
        if (cancelled) return;
        const theme = settings?.theme ?? FALLBACK_THEME;
        const accentColor = settings?.accentColor ?? "";
        applyTheme(theme, accentColor);

        if (theme === "system" && mediaQuery === null) {
          mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
          mediaListener = () => {
            applyTheme("system", accentColor);
          };
          mediaQuery.addEventListener("change", mediaListener);
        }
      } catch {
        if (!cancelled) {
          applyTheme(FALLBACK_THEME, "");
        }
      }
    };

    unsubscribeSettings = window.horizonAPI.on(
      "settings:changed",
      (payload: unknown) => {
        const { key, value } = payload as { key: string; value: unknown };
        if (key === "theme") {
          void window.horizonAPI
            .invoke("settings:getAll", {})
            .then((settings) => {
              if (cancelled) return;
              const s = settings as
                | { theme?: string; accentColor?: string }
                | undefined;
              const newTheme = s?.theme ?? FALLBACK_THEME;
              const newAccent = s?.accentColor ?? "";
              applyTheme(newTheme, newAccent);

              if (newTheme !== "system" && mediaQuery && mediaListener) {
                mediaQuery.removeEventListener("change", mediaListener);
                mediaQuery = null;
                mediaListener = null;
              } else if (newTheme === "system" && mediaQuery === null) {
                mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
                mediaListener = () => {
                  applyTheme("system", newAccent);
                };
                mediaQuery.addEventListener("change", mediaListener);
              }
            });
        } else if (key === "accentColor") {
          const currentTheme =
            document.documentElement.dataset.theme ?? FALLBACK_THEME;
          applyTheme(currentTheme, (value as string) ?? "");
        }
      },
    );

    void init();

    return () => {
      cancelled = true;
      if (unsubscribeSettings) unsubscribeSettings();
      if (mediaQuery && mediaListener) {
        mediaQuery.removeEventListener("change", mediaListener);
      }
    };
  }, []);
}
