import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Bookmark } from '../../src/types/browser';

export class BookmarkManager {
  private bookmarks: Bookmark[];

  constructor(private bookmarksPath: string) {
    this.bookmarks = this.load();
  }

  private load(): Bookmark[] {
    try {
      const data = fs.readFileSync(this.bookmarksPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [
        {
          id: uuidv4(),
          schemaVersion: 1,
          index: 0,
          title: 'Bookmarks Bar',
          dateAdded: Date.now(),
          children: [],
        },
      ];
    }
  }

  private save(): void {
    fs.writeFileSync(this.bookmarksPath, JSON.stringify(this.bookmarks, null, 2));
  }

  getTree(): Bookmark[] {
    return this.bookmarks;
  }

  add(url: string, title: string, parentId?: string): Bookmark {
    const bookmark: Bookmark = {
      id: uuidv4(),
      schemaVersion: 1,
      parentId,
      index: this.bookmarks.length,
      title,
      url,
      dateAdded: Date.now(),
    };
    this.bookmarks.push(bookmark);
    this.save();
    return bookmark;
  }

  remove(bookmarkId: string): void {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== bookmarkId);
    this.save();
  }

  move(bookmarkId: string, parentId: string, index: number): Bookmark {
    const bookmark = this.bookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) throw new Error('Bookmark not found');
    bookmark.parentId = parentId;
    bookmark.index = index;
    this.save();
    return bookmark;
  }

  update(bookmarkId: string, changes: Partial<Bookmark>): Bookmark {
    const bookmark = this.bookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) throw new Error('Bookmark not found');
    Object.assign(bookmark, changes, { dateModified: Date.now() });
    this.save();
    return bookmark;
  }

  import(data: string): Bookmark[] {
    // Parse Netscape HTML format using regex (Node.js compatible)
    const imported: Bookmark[] = [];
    const regex = /<A HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi;
    let match;
    let index = 0;
    while ((match = regex.exec(data)) !== null) {
      imported.push({
        id: uuidv4(),
        schemaVersion: 1,
        index: index++,
        title: match[2] || match[1],
        url: match[1],
        dateAdded: Date.now(),
      });
    }
    this.bookmarks.push(...imported);
    this.save();
    return imported;
  }

  export(): string {
    const links = this.bookmarks
      .filter((b) => b.url)
      .map((b) => `    <DT><A HREF="${b.url}">${b.title}</A>`)
      .join('\n');
    return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${links}
</DL><p>`;
  }
}
