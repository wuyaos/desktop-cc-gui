import { describe, expect, it } from "vitest";
import {
  inferCommandOutputRenderMeta,
  renderCodeOutputHtml,
  renderShellOutputHtml,
} from "./shellOutputHighlight";

describe("renderShellOutputHtml", () => {
  it("highlights command and flags", () => {
    const html = renderShellOutputHtml("ls -la ./src");
    expect(html).toContain('session-activity-shell-token-command">ls<');
    expect(html).toContain('session-activity-shell-token-flag">-la<');
    expect(html).toContain('session-activity-shell-token-path">./src<');
  });

  it("highlights ls-like metadata tokens", () => {
    const html = renderShellOutputHtml("drwxr-xr-x 6 user staff 192 Mar 11 16:40 assets");
    expect(html).toContain('session-activity-shell-token-permission">drwxr-xr-x<');
    expect(html).toContain('session-activity-shell-token-number">192<');
    expect(html).toContain('session-activity-shell-token-time">Mar<');
    expect(html).toContain('session-activity-shell-token-time">16:40<');
  });

  it("marks error line and escapes html", () => {
    const html = renderShellOutputHtml("fatal error: <broken>");
    expect(html).toContain("session-activity-command-line-error");
    expect(html).toContain("&lt;broken&gt;");
  });

  it("detects markdown render mode for markdown file reads", () => {
    const meta = inferCommandOutputRenderMeta("cat README.md", "# Title\n\n- item");
    expect(meta.mode).toBe("markdown");
  });

  it("detects code render mode for source file reads", () => {
    const meta = inferCommandOutputRenderMeta(
      'sed -n "1,260p" src/main/java/com/example/demo/UserService.java',
      "public class UserService {}",
    );
    expect(meta.mode).toBe("code");
    expect(meta.language).toBe("java");
  });

  it("renders code output with highlighted token markup", () => {
    const html = renderCodeOutputHtml("public class UserService {}", "java");
    expect(html).toContain('class="token');
  });

  it("detects markdown render mode for wrapped shell read command", () => {
    const meta = inferCommandOutputRenderMeta(
      `/bin/zsh -lc "zsh -lc 'source ~/.zshrc && sed -n \\"1,260p\\" README.md'"`,
      "### Title\n\n- item",
    );
    expect(meta.mode).toBe("markdown");
  });

  it("detects code render mode for wrapped nl read command", () => {
    const meta = inferCommandOutputRenderMeta(
      `/bin/zsh -lc "zsh -lc 'source ~/.zshrc && nl -ba src/main/java/com/example/demo/NewsController.java'"`,
      "1 public class NewsController {}",
    );
    expect(meta.mode).toBe("code");
    expect(meta.language).toBe("java");
  });

  it("detects code render mode for wrapped xml file read command", () => {
    const meta = inferCommandOutputRenderMeta(
      `/bin/zsh -lc "zsh -lc 'source ~/.zshrc && cat pom.xml'"`,
      '<?xml version="1.0" encoding="UTF-8"?><project></project>',
    );
    expect(meta.mode).toBe("code");
    expect(meta.language).toBe("markup");
    expect(meta.filePath).toBe("pom.xml");
  });

  it("renders prefixed line numbers as separate code line-number token", () => {
    const html = renderCodeOutputHtml("12 import java.util.List;", "java");
    expect(html).toContain("session-activity-code-line-number");
    expect(html).toContain('class="token');
  });
});
