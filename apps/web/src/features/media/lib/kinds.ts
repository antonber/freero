// What a file looks like on its card: a family (icon + tone) from its name's extension, a short
// type label, and a readable size. Display only — the server never trusts any of it.
import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from 'lucide-react';
import type { IconComponent } from '@engine';

export type FileFamily = 'archive' | 'sheet' | 'doc' | 'slides' | 'image' | 'video' | 'audio' | 'code' | 'other';

const FAMILY_EXTS: Array<[FileFamily, string[]]> = [
  ['archive', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'dmg', 'iso']],
  ['sheet', ['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'numbers']],
  ['doc', ['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'pages', 'pdf', 'epub']],
  ['slides', ['ppt', 'pptx', 'odp', 'key']],
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'psd', 'ai', 'sketch', 'fig', 'xd', 'eps', 'raw']],
  ['video', ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'wmv', 'mpg', 'mpeg']],
  ['audio', ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'aiff', 'aif', 'opus', 'mid', 'midi']],
  ['code', ['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'htm', 'css', 'xml', 'yml', 'yaml', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'sh', 'sql', 'swift', 'kt']],
];

const FAMILY_BY_EXT = new Map<string, FileFamily>(FAMILY_EXTS.flatMap(([f, exts]) => exts.map((e) => [e, f] as const)));

export const FAMILY_ICON: Record<FileFamily, IconComponent> = {
  archive: FileArchive,
  sheet: FileSpreadsheet,
  doc: FileText,
  slides: Presentation,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  code: FileCode,
  other: FileIcon,
};

const FAMILY_NOUN: Record<FileFamily, string> = {
  archive: 'archive',
  sheet: 'spreadsheet',
  doc: 'document',
  slides: 'presentation',
  image: 'image',
  video: 'video',
  audio: 'audio',
  code: 'code file',
  other: 'file',
};

/** "Q3 plan.XLSX" → "xlsx"; no extension (or a dotfile) → "". */
export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  return m && m.index > 0 ? m[1].toLowerCase() : '';
}

export function familyOf(name: string): FileFamily {
  return FAMILY_BY_EXT.get(extensionOf(name)) ?? 'other';
}

/** "XLSX spreadsheet", "ZIP archive", "File". */
export function typeLabel(name: string): string {
  const ext = extensionOf(name);
  const noun = FAMILY_NOUN[familyOf(name)];
  return ext ? `${ext.toUpperCase()} ${noun}` : noun[0].toUpperCase() + noun.slice(1);
}

/** 1536 → "1.5 KB", 52_428_800 → "50 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** 75.4 → "1:15", 3725 → "1:02:05". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
