export interface Tab {
  id: string;
  schemaVersion: number;
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  loadProgress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isActive: boolean;
  isHibernated: boolean;
  zoomLevel: number;
  createdAt: number;
  lastAccessedAt: number;
  errorState?: TabErrorState;
  historyStack?: { url: string; title: string }[];
  /** ID of the TabGroup this tab belongs to, or undefined if ungrouped. */
  groupId?: string;
}

/** Chrome-style colored, named container for a set of tabs. */
export interface TabGroup {
  id: string;
  name: string;
  /** One of the curated palette colors, see TAB_GROUP_COLORS. */
  color: TabGroupColor;
}

export const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'] as const;
export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];

export interface TabErrorState {
  type: 'load-failed' | 'crashed' | 'unresponsive';
  errorCode?: number;
  errorDescription?: string;
  validatedURL?: string;
}

export interface Bookmark {
  id: string;
  schemaVersion: number;
  parentId?: string;
  index: number;
  title: string;
  url?: string;
  dateAdded: number;
  dateModified?: number;
  children?: Bookmark[];
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitTime: number;
  visitCount: number;
  typedCount: number;
}

export type HistoryClearRange = 'hour' | 'day' | 'week' | 'month';

export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startTime: number;
  endTime?: number;
  savePath: string;
  mimeType?: string;
}

export interface Settings {
  schemaVersion: number;
  startupBehavior: 'new-tab' | 'restore' | 'specific-pages';
  startupPages: string[];
  defaultSearchEngine: string;
  downloadPath: string;
  askWhereToSave: boolean;
  downloadNotifications: boolean;
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  showBookmarksBar: boolean;
  showStatusBar: boolean;
  fontSize: number;
  minimumFontSize: number;
  pageZoom: number;
  blockThirdPartyCookies: boolean;
  clearDataOnExit: {
    history: boolean;
    cookies: boolean;
    cache: boolean;
    downloads: boolean;
    passwords: boolean;
    formData: boolean;
  };
  doNotTrack: boolean;
  defaultPermissions: Record<string, 'allow' | 'block' | 'ask'>;
  permissionOverrides: Record<string, Record<string, 'allow' | 'block' | 'ask'>>;
  contentSettings: Record<string, Record<string, 'allow' | 'block' | 'ask'>>;
  autoHibernate: boolean;
  hibernationTimeoutMinutes: number;
  maxActiveTabs: number;
  confirmCloseMultipleTabs: boolean;
  hardwareAcceleration: boolean;
  smoothScrolling: boolean;
  proxyType: 'system' | 'direct' | 'manual';
  proxyRules?: string;
  spellcheck: boolean;
  spellcheckLanguages: string[];
  certificateOverrides: Record<string, { allow: boolean; errorTypes: string[] }>;
  /** Agent action confirmation policy. See shared/constants.ts. */
  aiConfirmActions?: 'never' | 'risky' | 'all';
}

export interface PasswordEntry {
  id: string;
  origin: string;
  username: string;
  password: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface SavedAddress {
  id: string;
  label: string;
  name: string;
  organization?: string;
  street: string[];
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface FindResult {
  requestId: number;
  matches: number;
  activeMatchOrdinal: number;
  selectionArea?: { x: number; y: number; width: number; height: number };
}

export interface Suggestion {
  type: 'url' | 'history' | 'bookmark' | 'search';
  title: string;
  url?: string;
  query?: string;
  favicon?: string;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  type?: 'normal' | 'separator';
  enabled?: boolean;
  accelerator?: string;
}

export interface FormField {
  id: string;
  type: 'text' | 'email' | 'password' | 'tel' | 'number' | 'select';
  name: string;
  placeholder?: string;
  autocomplete?: string;
}

export interface AutofillMatch {
  fieldId: string;
  value: string;
  label: string;
  type: 'address' | 'password';
}

export interface CertificateInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  validStart: number;
  validExpiry: number;
  fingerprint: string;
}

export type PermissionType =
  | 'geolocation'
  | 'camera'
  | 'microphone'
  | 'notifications'
  | 'midi'
  | 'midiSysex'
  | 'pointerLock'
  | 'fullscreen'
  | 'openExternal'
  | 'display-capture';

export type ContentSettingType = 'popup' | 'javascript' | 'images' | 'cookies' | 'plugins';

export type CertificateErrorType = 'expired' | 'self-signed' | 'wrong-hostname' | 'authority-invalid';
