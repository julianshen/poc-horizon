import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BookmarkManager } from '../../.electron/services/BookmarkManager';

let dir: string;
let bookmarksPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'horizon-bookmarks-'));
  bookmarksPath = join(dir, 'bookmarks.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('BookmarkManager', () => {
  describe('load', () => {
    it('seeds a "Bookmarks Bar" root folder when no file exists', () => {
      const bm = new BookmarkManager(bookmarksPath);
      const tree = bm.getTree();
      expect(tree).toHaveLength(1);
      expect(tree[0].title).toBe('Bookmarks Bar');
      expect(tree[0].children).toEqual([]);
      expect(tree[0].url).toBeUndefined();
    });

    it('loads an existing bookmarks file', () => {
      const seed = [
        { id: 'a', schemaVersion: 1, index: 0, title: 'Root', dateAdded: 1, children: [] },
        { id: 'b', schemaVersion: 1, index: 1, title: 'Example', url: 'https://example.com', dateAdded: 2 },
      ];
      writeFileSync(bookmarksPath, JSON.stringify(seed));
      const bm = new BookmarkManager(bookmarksPath);
      expect(bm.getTree()).toEqual(seed);
    });
  });

  describe('add / remove / update / move', () => {
    it('add() appends a bookmark with a generated id and persists', () => {
      const bm = new BookmarkManager(bookmarksPath);
      const added = bm.add('https://example.com', 'Example');
      expect(added.id).toMatch(/[0-9a-f-]{36}/);
      expect(added.url).toBe('https://example.com');
      expect(added.title).toBe('Example');
      expect(bm.getTree()).toHaveLength(2);
      // Reload from disk
      const persisted = JSON.parse(readFileSync(bookmarksPath, 'utf-8'));
      expect(persisted.some((b: { id: string }) => b.id === added.id)).toBe(true);
    });

    it('remove() drops a bookmark by id', () => {
      const bm = new BookmarkManager(bookmarksPath);
      const a = bm.add('https://a.example', 'A');
      const b = bm.add('https://b.example', 'B');
      bm.remove(a.id);
      const ids = bm.getTree().map((x) => x.id);
      expect(ids).not.toContain(a.id);
      expect(ids).toContain(b.id);
    });

    it('update() merges changes and stamps dateModified', () => {
      const bm = new BookmarkManager(bookmarksPath);
      const a = bm.add('https://a.example', 'A');
      const updated = bm.update(a.id, { title: 'A renamed' });
      expect(updated.title).toBe('A renamed');
      expect(updated.dateModified).toBeTypeOf('number');
    });

    it('update() throws when the bookmark is missing', () => {
      const bm = new BookmarkManager(bookmarksPath);
      expect(() => bm.update('missing-id', { title: 'x' })).toThrow('Bookmark not found');
    });

    it('move() reparents and reindexes; throws when missing', () => {
      const bm = new BookmarkManager(bookmarksPath);
      const a = bm.add('https://a.example', 'A');
      const moved = bm.move(a.id, 'new-parent', 5);
      expect(moved.parentId).toBe('new-parent');
      expect(moved.index).toBe(5);
      expect(() => bm.move('missing-id', 'p', 0)).toThrow('Bookmark not found');
    });
  });

  describe('import / export', () => {
    it('import() parses Netscape HTML and persists each <A> tag', () => {
      const bm = new BookmarkManager(bookmarksPath);
      const html = `
        <DT><A HREF="https://one.example" ADD_DATE="123">One</A>
        <DT><A HREF="https://two.example">Two</A>
      `;
      const imported = bm.import(html);
      expect(imported).toHaveLength(2);
      expect(imported[0].url).toBe('https://one.example');
      expect(imported[0].title).toBe('One');
      expect(imported[1].url).toBe('https://two.example');
      expect(imported[1].title).toBe('Two');
    });

    it('import() falls back to the URL as the title when the anchor text is empty', () => {
      const bm = new BookmarkManager(bookmarksPath);
      const imported = bm.import('<A HREF="https://only-url.example"></A>');
      expect(imported[0].title).toBe('https://only-url.example');
    });

    it('export() round-trips through import()', () => {
      const bm = new BookmarkManager(bookmarksPath);
      bm.add('https://a.example', 'A');
      bm.add('https://b.example', 'B');
      const html = bm.export();
      expect(html).toContain('<A HREF="https://a.example">A</A>');
      expect(html).toContain('<A HREF="https://b.example">B</A>');

      const bm2 = new BookmarkManager(join(dir, 'bookmarks2.json'));
      const reimported = bm2.import(html);
      expect(reimported.map((b) => b.url).sort()).toEqual([
        'https://a.example',
        'https://b.example',
      ]);
    });
  });
});
