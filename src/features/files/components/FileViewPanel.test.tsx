/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileViewPanel } from "./FileViewPanel";
import {
  getCodeIntelDefinition,
  getCodeIntelReferences,
  readWorkspaceFile,
} from "../../../services/tauri";

function createDoc(text: string) {
  const lines = text.split("\n");
  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    starts.push(cursor);
    cursor += line.length + 1;
  }
  const lineFor = (lineNumber: number) => {
    const safeLine = Math.min(Math.max(lineNumber, 1), lines.length);
    const lineText = lines[safeLine - 1] ?? "";
    const from = starts[safeLine - 1] ?? 0;
    return {
      number: safeLine,
      from,
      to: from + lineText.length,
      length: lineText.length,
      text: lineText,
    };
  };
  const lineAt = (offset: number) => {
    const safeOffset = Math.min(Math.max(offset, 0), text.length);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (safeOffset >= (starts[index] ?? 0)) {
        return lineFor(index + 1);
      }
    }
    return lineFor(1);
  };
  return {
    length: text.length,
    lines: lines.length,
    line: lineFor,
    lineAt,
  };
}

vi.mock("@uiw/react-codemirror", async () => {
  const React = await import("react");
  const MockCodeMirror = React.forwardRef<
    { view: any },
    { value?: string; onChange?: (value: string) => void }
  >((props, ref) => {
    const viewRef = React.useRef<any>({
      state: {
        doc: createDoc(props.value ?? ""),
        selection: { main: { head: 0 } },
      },
      dispatch: vi.fn((transaction: any) => {
        const anchor = transaction?.selection?.anchor;
        if (typeof anchor === "number") {
          viewRef.current.state.selection.main.head = anchor;
        }
      }),
      focus: vi.fn(),
      posAtCoords: vi.fn(() => 0),
    });

    React.useEffect(() => {
      viewRef.current.state.doc = createDoc(props.value ?? "");
    }, [props.value]);

    React.useImperativeHandle(ref, () => ({ view: viewRef.current }), []);

    return (
      <textarea
        data-testid="mock-codemirror"
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  });

  return {
    __esModule: true,
    default: MockCodeMirror,
  };
});

vi.mock("../../app/components/OpenAppMenu", () => ({
  OpenAppMenu: () => <div data-testid="open-app-menu" />,
}));

vi.mock("../../../components/FileIcon", () => ({
  default: () => <span data-testid="file-icon" />,
}));

vi.mock("../../../services/tauri", () => ({
  readWorkspaceFile: vi.fn(),
  writeWorkspaceFile: vi.fn(),
  getGitFileFullDiff: vi.fn(),
  getCodeIntelDefinition: vi.fn(),
  getCodeIntelReferences: vi.fn(),
}));

function buildLocation(path: string, line: number, character: number) {
  return {
    uri: `file:///repo/${path}`,
    path,
    range: {
      start: { line, character },
      end: { line, character: character + 1 },
    },
  };
}

describe("FileViewPanel navigation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("navigates directly when definition has a single target", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "class Main {}",
      truncated: false,
    });
    vi.mocked(getCodeIntelDefinition).mockResolvedValue({
      result: [buildLocation("src/Foo.java", 9, 2)],
    } as any);
    const onNavigateToLocation = vi.fn();

    render(
      <FileViewPanel
        workspaceId="ws-1"
        workspacePath="/repo"
        filePath="src/Main.java"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onNavigateToLocation={onNavigateToLocation}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    fireEvent.click(screen.getByTitle(/gotoDefinition/i));

    await waitFor(() => {
      expect(getCodeIntelDefinition).toHaveBeenCalled();
      expect(onNavigateToLocation).toHaveBeenCalledWith("src/Foo.java", {
        line: 10,
        column: 3,
      });
    });
  });

  it("shows definition candidates when multiple targets are returned", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "class Main {}",
      truncated: false,
    });
    vi.mocked(getCodeIntelDefinition).mockResolvedValue({
      result: [
        buildLocation("src/Foo.java", 3, 1),
        buildLocation("src/Bar.java", 12, 6),
      ],
    } as any);
    const onNavigateToLocation = vi.fn();

    render(
      <FileViewPanel
        workspaceId="ws-2"
        workspacePath="/repo"
        filePath="src/Main.java"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onNavigateToLocation={onNavigateToLocation}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    fireEvent.click(screen.getByTitle(/gotoDefinition/i));

    await waitFor(() => {
      expect(screen.getByText("src/Foo.java")).toBeTruthy();
      expect(screen.getByText("src/Bar.java")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("src/Bar.java"));

    expect(onNavigateToLocation).toHaveBeenCalledWith("src/Bar.java", {
      line: 13,
      column: 7,
    });
  });

  it("renders reference list and allows click-through navigation", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "class Main {}",
      truncated: false,
    });
    vi.mocked(getCodeIntelReferences).mockResolvedValue({
      result: [
        buildLocation("src/Foo.java", 5, 4),
        buildLocation("src/Baz.java", 17, 8),
      ],
    } as any);
    const onNavigateToLocation = vi.fn();

    render(
      <FileViewPanel
        workspaceId="ws-3"
        workspacePath="/repo"
        filePath="src/Main.java"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onNavigateToLocation={onNavigateToLocation}
        onClose={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    fireEvent.click(screen.getByTitle(/findReferences/i));

    await waitFor(() => {
      expect(getCodeIntelReferences).toHaveBeenCalled();
      expect(screen.getByText("src/Foo.java")).toBeTruthy();
      expect(screen.getByText("src/Baz.java")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("src/Baz.java"));

    expect(onNavigateToLocation).toHaveBeenCalledWith("src/Baz.java", {
      line: 18,
      column: 9,
    });
  });
});
