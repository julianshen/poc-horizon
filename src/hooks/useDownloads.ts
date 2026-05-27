import { useCallback, useEffect, useState } from "react";
import type { DownloadItem } from "../types/browser";

export function useDownloads(): {
  downloads: DownloadItem[];
  cancel: (id: string) => void;
  open: (id: string) => void;
  showInFolder: (id: string) => void;
  clearCompleted: () => void;
} {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);

  useEffect(() => {
    const upsert = (item: DownloadItem) => {
      setDownloads((prev) => {
        const i = prev.findIndex((d) => d.id === item.id);
        if (i === -1) return [...prev, item];
        const next = prev.slice();
        next[i] = item;
        return next;
      });
    };
    const unsubCreated = window.horizonAPI.on("download:created", upsert);
    const unsubUpdated = window.horizonAPI.on("download:updated", upsert);
    const unsubCompleted = window.horizonAPI.on("download:completed", upsert);
    const unsubFailed = window.horizonAPI.on("download:failed", upsert);
    return () => {
      unsubCreated();
      unsubUpdated();
      unsubCompleted();
      unsubFailed();
    };
  }, []);

  const cancel = useCallback((id: string) => {
    window.horizonAPI.invoke("download:cancel", { downloadId: id });
  }, []);
  const open = useCallback((id: string) => {
    window.horizonAPI.invoke("download:open", { downloadId: id });
  }, []);
  const showInFolder = useCallback((id: string) => {
    window.horizonAPI.invoke("download:showInFolder", { downloadId: id });
  }, []);
  const clearCompleted = useCallback(() => {
    window.horizonAPI.invoke("download:clearCompleted", {});
    setDownloads((prev) => prev.filter((d) => d.state === "progressing"));
  }, []);

  return { downloads, cancel, open, showInFolder, clearCompleted };
}
