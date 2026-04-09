// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LanguageSelector } from "./LanguageSelector";
import { saveLanguage } from "../../../i18n";

const changeLanguageMock = vi.fn();
const useTranslationMock = vi.fn(() => ({
  t: (key: string) => {
    const dict: Record<string, string> = {
      "settings.language": "Language",
      "settings.languageZh": "中文",
      "settings.languageEn": "English",
    };
    return dict[key] ?? key;
  },
  i18n: {
    language: "zh",
    changeLanguage: changeLanguageMock,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => useTranslationMock(),
}));

vi.mock("../../../i18n", () => ({
  saveLanguage: vi.fn(),
}));

describe("LanguageSelector", () => {
  beforeEach(() => {
    changeLanguageMock.mockReset();
    vi.mocked(saveLanguage).mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders two icon+text language buttons", () => {
    render(<LanguageSelector />);

    expect(screen.getByRole("radio", { name: "中文" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "English" })).toBeTruthy();
  });

  it("switches language when clicking inactive option", () => {
    render(<LanguageSelector />);

    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    expect(changeLanguageMock).toHaveBeenCalledWith("en");
    expect(saveLanguage).toHaveBeenCalledWith("en");
  });

  it("does not trigger change when clicking current language", () => {
    render(<LanguageSelector />);

    fireEvent.click(screen.getByRole("radio", { name: "中文" }));

    expect(changeLanguageMock).not.toHaveBeenCalled();
    expect(saveLanguage).not.toHaveBeenCalled();
  });
});
