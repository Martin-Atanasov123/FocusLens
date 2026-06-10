import { describe, expect, it } from "vitest";
import { domainFromUrl } from "../src/domain.js";

describe("domainFromUrl", () => {
  it("extracts hostnames from http(s) URLs", () => {
    expect(domainFromUrl("https://www.youtube.com/watch?v=abc")).toBe("youtube.com");
    expect(domainFromUrl("http://example.org/page")).toBe("example.org");
    expect(domainFromUrl("https://docs.github.com/en")).toBe("docs.github.com");
  });

  it("never returns paths or query strings", () => {
    const d = domainFromUrl("https://bank.com/account?id=secret#frag");
    expect(d).toBe("bank.com");
  });

  it("returns null for untrackable schemes", () => {
    expect(domainFromUrl("chrome://extensions")).toBeNull();
    expect(domainFromUrl("about:blank")).toBeNull();
    expect(domainFromUrl("chrome-extension://abc/popup.html")).toBeNull();
    expect(domainFromUrl("data:text/html,hi")).toBeNull();
  });

  it("returns a generic label for file URLs", () => {
    expect(domainFromUrl("file:///C:/docs/report.pdf")).toBe("local files");
  });

  it("handles garbage input", () => {
    expect(domainFromUrl(undefined)).toBeNull();
    expect(domainFromUrl(null)).toBeNull();
    expect(domainFromUrl("")).toBeNull();
    expect(domainFromUrl("not a url")).toBeNull();
  });

  it("lowercases and strips www only as a prefix", () => {
    expect(domainFromUrl("https://WWW.Example.COM")).toBe("example.com");
    expect(domainFromUrl("https://wwwx.example.com")).toBe("wwwx.example.com");
  });
});
