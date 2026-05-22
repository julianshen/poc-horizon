import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import type { PasswordEntry } from '../../src/types/browser';

export class PasswordManager {
  private passwordsPath: string;
  private passwords: PasswordEntry[];

  constructor() {
    this.passwordsPath = path.join(app.getPath('userData'), 'passwords.json');
    this.passwords = this.load();
  }

  private load(): PasswordEntry[] {
    try {
      const data = fs.readFileSync(this.passwordsPath, 'utf-8');
      const entries: PasswordEntry[] = JSON.parse(data);
      return entries.map((e) => ({
        ...e,
        password: safeStorage.decryptString(Buffer.from(e.password, 'base64')),
      }));
    } catch {
      return [];
    }
  }

  private save(): void {
    const encrypted = this.passwords.map((e) => ({
      ...e,
      password: safeStorage.encryptString(e.password).toString('base64'),
    }));
    fs.writeFileSync(this.passwordsPath, JSON.stringify(encrypted, null, 2));
  }

  getAll(): PasswordEntry[] {
    return this.passwords;
  }

  saveEntry(entry: PasswordEntry): void {
    const existing = this.passwords.findIndex((p) => p.origin === entry.origin && p.username === entry.username);
    if (existing >= 0) {
      this.passwords[existing] = { ...entry, lastUsedAt: Date.now() };
    } else {
      this.passwords.push({ ...entry, createdAt: Date.now() });
    }
    this.save();
  }

  remove(origin: string, username: string): void {
    this.passwords = this.passwords.filter((p) => !(p.origin === origin && p.username === username));
    this.save();
  }

  getForOrigin(origin: string): PasswordEntry[] {
    return this.passwords.filter((p) => p.origin === origin);
  }
}
