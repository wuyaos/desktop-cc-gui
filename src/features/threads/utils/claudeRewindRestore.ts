import type { ConversationItem } from "../../../types";
import {
  createWorkspaceDirectory,
  readWorkspaceFile,
  trashWorkspaceItem,
  writeWorkspaceFile,
} from "../../../services/tauri";
import {
  getFirstStringField,
  asRecord,
  extractCommandFromTitle,
  parseToolArgs,
} from "../../messages/components/toolBlocks/toolConstants";
import {
  inferFileChangesFromCommandExecutionArtifacts,
  inferFileChangesFromPayload,
  mergeToolChanges,
  normalizeFileChangeKind,
} from "../../../utils/threadItemsFileChanges";
import {
  normalizeRelativeWorkspacePath,
  resolveFileReadTarget,
} from "../../../utils/workspacePaths";

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

type ClaudeRewindRestorePlanEntry = {
  path: string;
  kind: "add" | "delete" | "rename" | "modified";
  diff?: string;
  previousPath?: string;
  oldText?: string;
  newText?: string;
  sourceItemId: string;
};

export type ClaudeRewindWorkspaceSnapshot = {
  path: string;
  exists: boolean;
  content: string;
  newline: "\n" | "\r\n";
};

function normalizeWorkspaceRestorePath(
  workspacePath: string,
  rawPath: string,
): string | null {
  const resolved = resolveFileReadTarget(workspacePath, rawPath, null);
  if (resolved.domain !== "workspace") {
    return null;
  }
  const normalized = normalizeRelativeWorkspacePath(resolved.workspaceRelativePath);
  if (!normalized) {
    return null;
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

function detectNewlineStyle(content: string): "\n" | "\r\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeLineEndings(content: string) {
  return content.replace(/\r\n?/g, "\n");
}

function splitContentLines(content: string) {
  if (!content) {
    return [] as string[];
  }
  if (content.endsWith("\n")) {
    return content.slice(0, -1).split("\n").concat("");
  }
  return content.split("\n");
}

function applyPreferredLineEndings(content: string, newline: "\n" | "\r\n") {
  if (newline === "\r\n") {
    return normalizeLineEndings(content).replace(/\n/g, "\r\n");
  }
  return normalizeLineEndings(content);
}

function dirname(path: string) {
  const normalized = normalizeRelativeWorkspacePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return "";
  }
  return normalized.slice(0, lastSlash);
}

function isWorkspaceFileMissingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such file|cannot find the file|failed to open file/i.test(message);
}

type StructuredEditHint = {
  path: string;
  oldText?: string;
  newText?: string;
};

type StructuredToolChange = {
  path: string;
  kind?: string;
  diff?: string;
  oldText?: string;
  newText?: string;
};

const STRUCTURED_EDIT_PATH_KEYS = [
  "file_path",
  "filePath",
  "filepath",
  "path",
  "target_file",
  "targetFile",
  "filename",
  "file",
];

function collectStructuredEditHints(
  workspacePath: string,
  payload: unknown,
  hints: StructuredEditHint[],
) {
  if (!payload) {
    return;
  }
  if (Array.isArray(payload)) {
    payload.forEach((entry) =>
      collectStructuredEditHints(workspacePath, entry, hints),
    );
    return;
  }
  const record = asRecord(payload);
  if (!record) {
    return;
  }

  const rawPath = getFirstStringField(record, STRUCTURED_EDIT_PATH_KEYS);
  const normalizedPath = rawPath
    ? normalizeWorkspaceRestorePath(workspacePath, rawPath)
    : null;
  const oldText =
    typeof record.old_string === "string" ? record.old_string : undefined;
  const newText =
    typeof record.new_string === "string"
      ? record.new_string
      : typeof record.content === "string"
        ? record.content
        : undefined;
  if (normalizedPath && (oldText !== undefined || newText !== undefined)) {
    hints.push({
      path: normalizedPath,
      oldText,
      newText,
    });
  }

  for (const nestedKey of ["input", "arguments", "files", "changes", "edits"]) {
    collectStructuredEditHints(workspacePath, record[nestedKey], hints);
  }
}

function buildStructuredEditHintMap(
  workspacePath: string,
  item: ToolItem,
) {
  const parsedArgs = parseToolArgs(item.detail);
  const hints: StructuredEditHint[] = [];
  collectStructuredEditHints(workspacePath, parsedArgs, hints);
  const hintMap = new Map<string, StructuredEditHint>();
  hints.forEach((hint) => {
    if (!hintMap.has(hint.path)) {
      hintMap.set(hint.path, hint);
      return;
    }
    const existing = hintMap.get(hint.path);
    if (!existing) {
      return;
    }
    if (existing.oldText === undefined && hint.oldText !== undefined) {
      existing.oldText = hint.oldText;
    }
    if (existing.newText === undefined && hint.newText !== undefined) {
      existing.newText = hint.newText;
    }
  });
  return hintMap;
}

function extractStructuredToolChanges(
  workspacePath: string,
  item: ToolItem,
): StructuredToolChange[] {
  const parsedArgs = parseToolArgs(item.detail);
  const nestedInput = asRecord(parsedArgs?.input);
  const nestedArgs = asRecord(parsedArgs?.arguments);
  const localChanges = inferFileChangesFromPayload([
    parsedArgs,
    nestedInput,
    nestedArgs,
    item.output ?? "",
  ]);
  const command = extractCommandFromTitle(item.title);
  const commandChanges =
    item.toolType === "commandExecution"
      ? inferFileChangesFromCommandExecutionArtifacts(command, item.output ?? "")
      : [];
  const inferredChanges = commandChanges.length > 0 ? commandChanges : localChanges;
  const mergedChanges =
    mergeToolChanges(
      item.changes,
      inferredChanges.map((change) => ({
        path: change.path,
        kind: change.kind,
        diff: change.diff,
      })),
    ) ?? [];
  const hintMap = buildStructuredEditHintMap(workspacePath, item);
  return mergedChanges.map((change) => {
    const normalizedPath = normalizeWorkspaceRestorePath(
      workspacePath,
      change.path,
    );
    const hint = normalizedPath ? hintMap.get(normalizedPath) : undefined;
    return {
      path: change.path,
      kind: change.kind,
      diff: change.diff,
      oldText: hint?.oldText,
      newText: hint?.newText,
    };
  });
}

function extractPatchPaths(diff?: string) {
  const result: { previousPath?: string; nextPath?: string } = {};
  if (!diff) {
    return result;
  }
  for (const line of diff.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!result.previousPath && trimmed.startsWith("*** Update File: ")) {
      result.previousPath = trimmed.slice("*** Update File: ".length).trim();
      continue;
    }
    if (!result.previousPath && trimmed.startsWith("*** Delete File: ")) {
      result.previousPath = trimmed.slice("*** Delete File: ".length).trim();
      continue;
    }
    if (!result.nextPath && trimmed.startsWith("*** Add File: ")) {
      result.nextPath = trimmed.slice("*** Add File: ".length).trim();
      continue;
    }
    if (!result.nextPath && trimmed.startsWith("*** Move to: ")) {
      result.nextPath = trimmed.slice("*** Move to: ".length).trim();
      continue;
    }
    if (!result.previousPath && trimmed.startsWith("--- a/")) {
      result.previousPath = trimmed.slice("--- a/".length).trim();
      continue;
    }
    if (!result.nextPath && trimmed.startsWith("+++ b/")) {
      result.nextPath = trimmed.slice("+++ b/".length).trim();
      continue;
    }
    if (!result.previousPath || !result.nextPath) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(trimmed);
      if (match) {
        result.previousPath ||= match[1]?.trim();
        result.nextPath ||= match[2]?.trim();
      }
    }
  }
  return result;
}

export function findImpactedClaudeRewindItems(
  items: ConversationItem[],
  messageId: string,
) {
  const normalizedMessageId = messageId.trim();
  if (!normalizedMessageId) {
    return [];
  }
  const index = items.findIndex(
    (item) => item.kind === "message" && item.role === "user" && item.id.trim() === normalizedMessageId,
  );
  if (index < 0) {
    return [];
  }
  return items.slice(index);
}

export function collectClaudeRewindRestorePlan(
  workspacePath: string,
  impactedItems: ConversationItem[],
): ClaudeRewindRestorePlanEntry[] {
  const plan: ClaudeRewindRestorePlanEntry[] = [];
  for (let itemIndex = impactedItems.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = impactedItems[itemIndex];
    if (item.kind !== "tool") {
      continue;
    }
    const changes = extractStructuredToolChanges(workspacePath, item);
    for (let changeIndex = changes.length - 1; changeIndex >= 0; changeIndex -= 1) {
      const change = changes[changeIndex];
      const normalizedPath = normalizeWorkspaceRestorePath(workspacePath, change.path ?? "");
      if (!normalizedPath) {
        continue;
      }
      const normalizedKind =
        normalizeFileChangeKind(change.kind) ?? "modified";
      const diff = change.diff?.trim() || undefined;
      const patchPaths = extractPatchPaths(diff);
      const previousPath =
        normalizedKind === "rename"
          ? normalizeWorkspaceRestorePath(
              workspacePath,
              patchPaths.previousPath ?? "",
            ) ?? undefined
          : undefined;
      plan.push({
        path:
          normalizedKind === "rename"
            ? normalizeWorkspaceRestorePath(
                workspacePath,
                patchPaths.nextPath ?? normalizedPath,
              ) ?? normalizedPath
            : normalizedPath,
        kind:
          normalizedKind === "add" ||
          normalizedKind === "delete" ||
          normalizedKind === "rename"
            ? normalizedKind
            : "modified",
        diff,
        previousPath,
        oldText: change.oldText,
        newText: change.newText,
        sourceItemId: item.id,
      });
    }
  }
  return plan;
}

type ParsedHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

function parseUnifiedDiffHunks(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  const lines = diff.split(/\r?\n/);
  let current: ParsedHunk | null = null;
  const hunkHeaderRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  for (const line of lines) {
    const headerMatch = hunkHeaderRegex.exec(line);
    if (headerMatch) {
      if (current) {
        hunks.push(current);
      }
      current = {
        oldStart: Number(headerMatch[1] ?? 0),
        oldCount: Number(headerMatch[2] ?? 1),
        newStart: Number(headerMatch[3] ?? 0),
        newCount: Number(headerMatch[4] ?? 1),
        lines: [],
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("*** Begin Patch") ||
      line.startsWith("*** Update File: ") ||
      line.startsWith("*** Add File: ") ||
      line.startsWith("*** Delete File: ") ||
      line.startsWith("*** End Patch") ||
      line.startsWith("*** Move to: ")
    ) {
      continue;
    }
    if (
      line.startsWith(" ") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith("\\")
    ) {
      current.lines.push(line);
    }
  }

  if (current) {
    hunks.push(current);
  }
  return hunks;
}

export function reverseApplyUnifiedDiff(
  currentContent: string,
  diff: string,
): string {
  const normalizedContent = normalizeLineEndings(currentContent);
  const sourceLines = splitContentLines(normalizedContent);
  const hunks = parseUnifiedDiffHunks(diff);
  if (hunks.length === 0) {
    return normalizedContent;
  }

  const nextLines: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const targetIndex = Math.max(0, hunk.newStart - 1);
    if (targetIndex > sourceLines.length) {
      throw new Error("Claude rewind patch target is out of range.");
    }
    nextLines.push(...sourceLines.slice(cursor, targetIndex));
    cursor = targetIndex;
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) {
        continue;
      }
      const marker = line[0] ?? " ";
      const value = line.slice(1);
      if (marker === " ") {
        if (sourceLines[cursor] !== value) {
          throw new Error("Claude rewind patch context mismatch.");
        }
        nextLines.push(value);
        cursor += 1;
        continue;
      }
      if (marker === "+") {
        if (sourceLines[cursor] !== value) {
          throw new Error("Claude rewind patch added-line mismatch.");
        }
        cursor += 1;
        continue;
      }
      if (marker === "-") {
        nextLines.push(value);
      }
    }
  }
  nextLines.push(...sourceLines.slice(cursor));
  return nextLines.join("\n");
}

function replaceFirstOccurrence(
  source: string,
  searchValue: string,
  replacement: string,
) {
  if (!searchValue) {
    return source;
  }
  const index = source.indexOf(searchValue);
  if (index < 0) {
    return null;
  }
  return (
    source.slice(0, index) + replacement + source.slice(index + searchValue.length)
  );
}

function reverseApplyStructuredEdit(
  currentContent: string,
  entry: ClaudeRewindRestorePlanEntry,
) {
  const oldText = normalizeLineEndings(entry.oldText ?? "");
  const newText = normalizeLineEndings(entry.newText ?? "");
  const normalizedCurrent = normalizeLineEndings(currentContent);

  if (!entry.oldText && !entry.newText) {
    return null;
  }
  if (oldText === newText) {
    return normalizedCurrent;
  }
  if (newText && normalizedCurrent.includes(newText)) {
    return replaceFirstOccurrence(normalizedCurrent, newText, oldText);
  }
  if (oldText && normalizedCurrent.includes(oldText)) {
    return normalizedCurrent;
  }
  if (!oldText && newText) {
    if (normalizedCurrent === newText) {
      return "";
    }
    return replaceFirstOccurrence(normalizedCurrent, newText, "");
  }
  if (oldText && !newText && normalizedCurrent.length === 0) {
    return oldText;
  }
  return null;
}

async function readWorkspaceSnapshot(
  workspaceId: string,
  path: string,
): Promise<ClaudeRewindWorkspaceSnapshot> {
  try {
    const response = await readWorkspaceFile(workspaceId, path);
    if (response.truncated) {
      throw new Error(`Claude rewind cannot safely restore truncated file: ${path}`);
    }
    const content = normalizeLineEndings(response.content);
    return {
      path,
      exists: true,
      content,
      newline: detectNewlineStyle(response.content),
    };
  } catch (error) {
    if (isWorkspaceFileMissingError(error)) {
      return {
        path,
        exists: false,
        content: "",
        newline: "\n",
      };
    }
    throw error;
  }
}

async function writeWorkspaceSnapshot(
  workspaceId: string,
  snapshot: ClaudeRewindWorkspaceSnapshot,
  createdDirs: Set<string>,
) {
  if (!snapshot.exists) {
    try {
      await trashWorkspaceItem(workspaceId, snapshot.path);
    } catch (error) {
      if (!isWorkspaceFileMissingError(error)) {
        throw error;
      }
    }
    return;
  }

  const parentDir = dirname(snapshot.path);
  if (parentDir && !createdDirs.has(parentDir)) {
    await createWorkspaceDirectory(workspaceId, parentDir);
    createdDirs.add(parentDir);
  }
  await writeWorkspaceFile(
    workspaceId,
    snapshot.path,
    applyPreferredLineEndings(snapshot.content, snapshot.newline),
  );
}

function cloneSnapshot(
  snapshot: ClaudeRewindWorkspaceSnapshot,
): ClaudeRewindWorkspaceSnapshot {
  return {
    path: snapshot.path,
    exists: snapshot.exists,
    content: snapshot.content,
    newline: snapshot.newline,
  };
}

function collectTouchedPaths(plan: ClaudeRewindRestorePlanEntry[]) {
  const touched = new Set<string>();
  plan.forEach((entry) => {
    touched.add(entry.path);
    if (entry.previousPath) {
      touched.add(entry.previousPath);
    }
  });
  return Array.from(touched);
}

function computeRewoundSnapshots(
  originalSnapshots: Map<string, ClaudeRewindWorkspaceSnapshot>,
  plan: ClaudeRewindRestorePlanEntry[],
) {
  const nextSnapshots = new Map<string, ClaudeRewindWorkspaceSnapshot>();
  const skippedEntries: ClaudeRewindRestorePlanEntry[] = [];
  const changedPaths = new Set<string>();
  originalSnapshots.forEach((snapshot, path) => {
    nextSnapshots.set(path, cloneSnapshot(snapshot));
  });

  for (const entry of plan) {
    if (entry.kind === "add") {
      const currentSnapshot = nextSnapshots.get(entry.path);
      if (currentSnapshot) {
        currentSnapshot.exists = false;
        currentSnapshot.content = "";
      } else {
        nextSnapshots.set(entry.path, {
          path: entry.path,
          exists: false,
          content: "",
          newline: "\n",
        });
      }
      changedPaths.add(entry.path);
      continue;
    }

    if (entry.kind === "delete" && !entry.diff) {
      const currentSnapshot =
        nextSnapshots.get(entry.path) ??
        originalSnapshots.get(entry.path) ?? {
          path: entry.path,
          exists: false,
          content: "",
          newline: "\n" as const,
        };
      nextSnapshots.set(entry.path, {
        path: entry.path,
        exists: true,
        content: currentSnapshot.content,
        newline: currentSnapshot.newline,
      });
      continue;
    }

    if (entry.kind === "rename") {
      if (!entry.previousPath) {
        skippedEntries.push(entry);
        continue;
      }
      const currentSnapshot =
        nextSnapshots.get(entry.path) ??
        originalSnapshots.get(entry.path);
      if (!currentSnapshot?.exists) {
        skippedEntries.push(entry);
        continue;
      }
      let revertedContent = currentSnapshot.content;
      if (entry.diff) {
        try {
          revertedContent = reverseApplyUnifiedDiff(currentSnapshot.content, entry.diff);
        } catch {
          skippedEntries.push(entry);
          continue;
        }
      }
      nextSnapshots.set(entry.previousPath, {
        path: entry.previousPath,
        exists: true,
        content: revertedContent,
        newline: currentSnapshot.newline,
      });
      nextSnapshots.set(entry.path, {
        path: entry.path,
        exists: false,
        content: "",
        newline: currentSnapshot.newline,
      });
      changedPaths.add(entry.previousPath);
      changedPaths.add(entry.path);
      continue;
    }

    if (!entry.diff) {
      skippedEntries.push(entry);
      continue;
    }

    const currentSnapshot =
      nextSnapshots.get(entry.path) ??
      originalSnapshots.get(entry.path) ?? {
        path: entry.path,
        exists: false,
        content: "",
        newline: "\n" as const,
      };
    const baseContent =
      entry.kind === "delete"
        ? ""
        : currentSnapshot.exists
          ? currentSnapshot.content
          : "";
    const structuredRevertedContent = reverseApplyStructuredEdit(
      baseContent,
      entry,
    );
    let revertedContent = structuredRevertedContent;
    if (revertedContent === null) {
      try {
        revertedContent = reverseApplyUnifiedDiff(baseContent, entry.diff);
      } catch {
        skippedEntries.push(entry);
        continue;
      }
    }
    nextSnapshots.set(entry.path, {
      path: entry.path,
      exists: true,
      content: revertedContent,
      newline: currentSnapshot.newline,
    });
    changedPaths.add(entry.path);
  }

  return {
    snapshots: nextSnapshots,
    skippedEntries,
    changedPaths: Array.from(changedPaths),
  };
}

async function writeSnapshotCollection(
  workspaceId: string,
  snapshots: Map<string, ClaudeRewindWorkspaceSnapshot>,
) {
  const entries = Array.from(snapshots.values());
  const createdDirs = new Set<string>();
  const writeEntries = entries
    .filter((entry) => entry.exists)
    .sort((left, right) => left.path.localeCompare(right.path));
  const deleteEntries = entries
    .filter((entry) => !entry.exists)
    .sort((left, right) => right.path.localeCompare(left.path));

  for (const entry of writeEntries) {
    await writeWorkspaceSnapshot(workspaceId, entry, createdDirs);
  }
  for (const entry of deleteEntries) {
    await writeWorkspaceSnapshot(workspaceId, entry, createdDirs);
  }
}

export async function applyClaudeRewindWorkspaceRestore(params: {
  workspaceId: string;
  workspacePath: string;
  impactedItems: ConversationItem[];
}) {
  const plan = collectClaudeRewindRestorePlan(
    params.workspacePath,
    params.impactedItems,
  );
  if (plan.length === 0) {
    return null;
  }

  const touchedPaths = collectTouchedPaths(plan);
  const originalSnapshots = new Map<string, ClaudeRewindWorkspaceSnapshot>();
  for (const path of touchedPaths) {
    originalSnapshots.set(
      path,
      await readWorkspaceSnapshot(params.workspaceId, path),
    );
  }

  const {
    snapshots: rewoundSnapshots,
    skippedEntries,
    changedPaths,
  } = computeRewoundSnapshots(
    originalSnapshots,
    plan,
  );
  const changedSnapshotMap = new Map<string, ClaudeRewindWorkspaceSnapshot>();
  changedPaths.forEach((path) => {
    const snapshot = rewoundSnapshots.get(path);
    if (snapshot) {
      changedSnapshotMap.set(path, snapshot);
    }
  });
  await writeSnapshotCollection(params.workspaceId, changedSnapshotMap);

  return {
    touchedPaths,
    originalSnapshots: Array.from(originalSnapshots.values()).map(cloneSnapshot),
    skippedPaths: skippedEntries.map((entry) => entry.path),
  };
}

export async function restoreClaudeRewindWorkspaceSnapshots(
  workspaceId: string,
  snapshots: ClaudeRewindWorkspaceSnapshot[],
) {
  if (snapshots.length === 0) {
    return;
  }
  const snapshotMap = new Map<string, ClaudeRewindWorkspaceSnapshot>();
  snapshots.forEach((snapshot) => {
    snapshotMap.set(snapshot.path, cloneSnapshot(snapshot));
  });
  await writeSnapshotCollection(workspaceId, snapshotMap);
}
