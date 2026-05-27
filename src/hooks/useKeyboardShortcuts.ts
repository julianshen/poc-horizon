import { useEffect } from "react";
import { useBrowserStore } from "../stores/browserStore";

export function useKeyboardShortcuts(): void {
  const { activeTabId, toggleOverlay } = useBrowserStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "t") {
        e.preventDefault();
        window.horizonAPI.invoke("tab:create", {});
      }
      if (mod && e.shiftKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        window.horizonAPI.invoke("window:newIncognito", {});
      }
      if (mod && e.key === "w") {
        e.preventDefault();
        if (activeTabId)
          window.horizonAPI.invoke("tab:close", { tabId: activeTabId });
      }
      if (mod && e.key === "l") {
        e.preventDefault();
        document.querySelector("input")?.focus();
      }
      if (mod && e.key === "r") {
        e.preventDefault();
        if (activeTabId)
          window.horizonAPI.invoke("navigation:reload", { tabId: activeTabId });
      }
      if (mod && e.key === "f") {
        e.preventDefault();
        toggleOverlay("showFindBar");
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        toggleOverlay("showSettings");
      }
      if (mod && e.key === "k") {
        e.preventDefault();
        toggleOverlay("showCmd");
      }
      if (mod && e.key === "j") {
        e.preventDefault();
        toggleOverlay("showDownloads");
      }
      if (mod && e.key === "p") {
        e.preventDefault();
        if (activeTabId)
          window.horizonAPI.invoke("print:start", { tabId: activeTabId });
      }
      if (mod && e.shiftKey && (e.key === "I" || e.key === "i")) {
        e.preventDefault();
        if (activeTabId)
          window.horizonAPI.invoke("devtools:toggle", { tabId: activeTabId });
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        if (activeTabId)
          window.horizonAPI.invoke("zoom:set", {
            tabId: activeTabId,
            level: 1.2,
          });
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        if (activeTabId)
          window.horizonAPI.invoke("zoom:set", {
            tabId: activeTabId,
            level: 0.9,
          });
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        if (activeTabId)
          window.horizonAPI.invoke("zoom:reset", { tabId: activeTabId });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId, toggleOverlay]);
}
