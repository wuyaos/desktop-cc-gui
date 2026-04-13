import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  createWorkspaceDirectory,
  readWorkspaceFile,
  trashWorkspaceItem,
  writeWorkspaceFile,
} from "../../../services/tauri";
import {
  applyClaudeRewindWorkspaceRestore,
  collectClaudeRewindRestorePlan,
  restoreClaudeRewindWorkspaceSnapshots,
  reverseApplyUnifiedDiff,
} from "./claudeRewindRestore";

vi.mock("../../../services/tauri", () => ({
  readWorkspaceFile: vi.fn(),
  writeWorkspaceFile: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  trashWorkspaceItem: vi.fn(),
}));

function fileToolItem(
  id: string,
  overrides: Partial<Extract<ConversationItem, { kind: "tool" }>>,
): Extract<ConversationItem, { kind: "tool" }> {
  return {
    id,
    kind: "tool",
    toolType: "fileChange",
    title: "File changes",
    detail: "{}",
    status: "completed",
    changes: [],
    ...overrides,
  };
}

describe("claudeRewindRestore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createWorkspaceDirectory).mockResolvedValue(undefined);
    vi.mocked(writeWorkspaceFile).mockResolvedValue(undefined);
    vi.mocked(trashWorkspaceItem).mockResolvedValue(undefined);
  });

  it("collects rename restore plan entries with Windows workspace paths", () => {
    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-rename", {
        changes: [
          {
            path: "C:\\Repo\\src\\new-name.ts",
            kind: "rename",
            diff: [
              "*** Begin Patch",
              "*** Update File: src/old-name.ts",
              "*** Move to: src/new-name.ts",
              "@@ -1 +1 @@",
              "-const oldName = true;",
              "+const newName = true;",
              "*** End Patch",
            ].join("\n"),
          },
        ],
      }),
    ];

    expect(
      collectClaudeRewindRestorePlan("C:/Repo", impactedItems),
    ).toEqual([
      {
        path: "src/new-name.ts",
        kind: "rename",
        previousPath: "src/old-name.ts",
        diff: [
          "*** Begin Patch",
          "*** Update File: src/old-name.ts",
          "*** Move to: src/new-name.ts",
          "@@ -1 +1 @@",
          "-const oldName = true;",
          "+const newName = true;",
          "*** End Patch",
        ].join("\n"),
        sourceItemId: "tool-rename",
      },
    ]);
  });

  it("reverse-applies unified diffs back to the previous content", () => {
    const reverted = reverseApplyUnifiedDiff(
      "line-1\nline-new\nline-3",
      "@@ -1,3 +1,3 @@\n line-1\n-line-old\n+line-new\n line-3",
    );

    expect(reverted).toBe("line-1\nline-old\nline-3");
  });

  it("removes files that were added after the rewind target", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "export const created = true;\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-add", {
        changes: [
          {
            path: "src/new.ts",
            kind: "added",
            diff: "@@ -0,0 +1,1 @@\n+export const created = true;",
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.touchedPaths).toEqual(["src/new.ts"]);
    expect(trashWorkspaceItem).toHaveBeenCalledWith("ws-1", "src/new.ts");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("removes added files even when the tool entry does not include inline diff", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "export const created = true;\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-add-no-diff", {
        changes: [
          {
            path: "src/LoginAttempt.java",
            kind: "added",
          },
        ],
      }),
    ];

    await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(trashWorkspaceItem).toHaveBeenCalledWith(
      "ws-1",
      "src/LoginAttempt.java",
    );
  });

  it("recreates files that were deleted after the rewind target", async () => {
    vi.mocked(readWorkspaceFile).mockRejectedValue(
      new Error("Failed to open file: No such file or directory"),
    );

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-delete", {
        changes: [
          {
            path: "src/removed.ts",
            kind: "deleted",
            diff: "@@ -1,2 +0,0 @@\n-const before = 1;\n-export default before;",
          },
        ],
      }),
    ];

    await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      "ws-1",
      "src/removed.ts",
      "const before = 1;\nexport default before;",
    );
  });

  it("prefers structured old/new replacement when diff context no longer matches", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: [
        "package demo;",
        "",
        "prefix from another thread",
        "const value = 'after';",
        "suffix from another thread",
        "",
      ].join("\n"),
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-structured-replace", {
        detail: JSON.stringify({
          input: {
            file_path: "src/App.tsx",
            old_string: "const value = 'before';",
            new_string: "const value = 'after';",
          },
        }),
        changes: [
          {
            path: "src/App.tsx",
            kind: "modified",
            diff: "@@ -10,1 +10,1 @@\n-context that no longer exists\n-const value = 'before';\n+const value = 'after';",
          },
        ],
      }),
    ];

    await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      "ws-1",
      "src/App.tsx",
      [
        "package demo;",
        "",
        "prefix from another thread",
        "const value = 'before';",
        "suffix from another thread",
        "",
      ].join("\n"),
    );
  });

  it("skips unrecoverable file entries without diff data instead of failing rewind", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "public class ApiResponse {}\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-missing-diff", {
        changes: [
          {
            path: "src/main/java/com/example/demo/dto/response/ApiResponse.java",
            kind: "modified",
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.skippedPaths).toEqual([
      "src/main/java/com/example/demo/dto/response/ApiResponse.java",
    ]);
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(trashWorkspaceItem).not.toHaveBeenCalled();
  });

  it("restores original snapshots when rewind rollback is needed", async () => {
    await restoreClaudeRewindWorkspaceSnapshots("ws-1", [
      {
        path: "src/App.tsx",
        exists: true,
        content: "const value = 1;\n",
        newline: "\n",
      },
      {
        path: "src/new.ts",
        exists: false,
        content: "",
        newline: "\n",
      },
    ]);

    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      "ws-1",
      "src/App.tsx",
      "const value = 1;\n",
    );
    expect(trashWorkspaceItem).toHaveBeenCalledWith("ws-1", "src/new.ts");
  });
});
