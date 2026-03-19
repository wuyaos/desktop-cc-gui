export type UndoRedoShortcutAction = 'undo' | 'redo' | null;
export type ShortcutPlatform = 'mac' | 'windows' | 'linux' | 'unknown';

export interface KeyboardShortcutLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

function normalizePlatformLabel(value: string): ShortcutPlatform {
  const normalized = value.toLowerCase();
  if (normalized.includes('mac') || normalized.includes('darwin')) return 'mac';
  if (normalized.includes('win')) return 'windows';
  if (normalized.includes('linux')) return 'linux';
  return 'unknown';
}

export function resolveShortcutPlatform(platformHint?: string): ShortcutPlatform {
  if (platformHint) {
    return normalizePlatformLabel(platformHint);
  }

  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const userAgentDataPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  if (userAgentDataPlatform) {
    return normalizePlatformLabel(userAgentDataPlatform);
  }

  if (typeof navigator.platform === 'string' && navigator.platform) {
    return normalizePlatformLabel(navigator.platform);
  }

  if (typeof navigator.userAgent === 'string' && navigator.userAgent) {
    return normalizePlatformLabel(navigator.userAgent);
  }

  return 'unknown';
}

export function resolveUndoRedoShortcutAction(
  event: KeyboardShortcutLike,
  platform: ShortcutPlatform = resolveShortcutPlatform()
): UndoRedoShortcutAction {
  if (event.altKey) {
    return null;
  }

  const key = event.key.toLowerCase();
  const hasMeta = !!event.metaKey;
  const hasCtrl = !!event.ctrlKey;
  const hasShift = !!event.shiftKey;

  if (platform === 'mac') {
    if (!hasMeta || hasCtrl || key !== 'z') return null;
    return hasShift ? 'redo' : 'undo';
  }

  if (platform === 'windows') {
    if (!hasCtrl || hasMeta) return null;
    if (key === 'z' && !hasShift) return 'undo';
    if (key === 'y' && !hasShift) return 'redo';
    if (key === 'z' && hasShift) return 'redo';
    return null;
  }

  if (platform === 'linux') {
    if (!hasCtrl || hasMeta) return null;
    if (key === 'z' && !hasShift) return 'undo';
    if (key === 'z' && hasShift) return 'redo';
    return null;
  }

  if (hasMeta && key === 'z') {
    return hasShift ? 'redo' : 'undo';
  }
  if (hasCtrl && !hasMeta) {
    if (key === 'z' && !hasShift) return 'undo';
    if ((key === 'z' && hasShift) || (key === 'y' && !hasShift)) return 'redo';
  }
  return null;
}
