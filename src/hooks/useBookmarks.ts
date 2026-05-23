import { useCallback, useEffect, useState } from 'react';
import type { Bookmark } from '../types/browser';

export function useBookmarks(): {
  bookmarks: Bookmark[];
  refresh: () => Promise<void>;
  add: (url: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  findByUrl: (url: string) => Bookmark | undefined;
} {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  const refresh = useCallback(async () => {
    try {
      const tree = (await window.horizonAPI.invoke('bookmark:getTree', {})) as Bookmark[];
      setBookmarks(Array.isArray(tree) ? tree.filter((b) => !!b.url) : []);
    } catch (err) {
      console.warn('[useBookmarks] refresh failed:', err);
      setBookmarks([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (url: string, title: string) => {
      await window.horizonAPI.invoke('bookmark:add', { url, title });
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await window.horizonAPI.invoke('bookmark:remove', { bookmarkId: id });
      await refresh();
    },
    [refresh]
  );

  const findByUrl = useCallback((url: string) => bookmarks.find((b) => b.url === url), [bookmarks]);

  return { bookmarks, refresh, add, remove, findByUrl };
}
