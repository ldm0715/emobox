import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPDATE_MIRRORS,
  isMirrorList,
  mirrorHost,
  normalizeMirror,
} from "./mirrorSources";

describe("normalizeMirror", () => {
  it("补一个尾斜杠并去首尾空白", () => {
    expect(normalizeMirror("https://gh-proxy.com")).toBe("https://gh-proxy.com/");
    expect(normalizeMirror("  https://ghproxy.net/  ")).toBe("https://ghproxy.net/");
  });

  it("折叠多个尾斜杠为一个", () => {
    expect(normalizeMirror("https://ghfast.top///")).toBe("https://ghfast.top/");
  });

  it("支持 http 与自定义端口", () => {
    expect(normalizeMirror("http://127.0.0.1:8181")).toBe("http://127.0.0.1:8181/");
  });

  it("拒绝空串与非 http(s) 输入", () => {
    expect(normalizeMirror("")).toBeNull();
    expect(normalizeMirror("   ")).toBeNull();
    expect(normalizeMirror("gh-proxy.com")).toBeNull();
    expect(normalizeMirror("ftp://gh-proxy.com")).toBeNull();
    expect(normalizeMirror("https://")).toBeNull();
  });
});

describe("isMirrorList", () => {
  it("接受非空字符串数组", () => {
    expect(isMirrorList(["https://a.com/", "https://b.com"])).toBe(true);
  });

  it("拒绝非数组、空串项与非字符串项", () => {
    expect(isMirrorList(null)).toBe(false);
    expect(isMirrorList("https://a.com")).toBe(false);
    expect(isMirrorList(["https://a.com/", ""])).toBe(false);
    expect(isMirrorList([1, 2])).toBe(false);
  });
});

describe("mirrorHost", () => {
  it("解析主机名（非默认端口保留），失败回退原文", () => {
    expect(mirrorHost("https://gh-proxy.com/")).toBe("gh-proxy.com");
    expect(mirrorHost("http://127.0.0.1:8181/")).toBe("127.0.0.1:8181");
    expect(mirrorHost("not-a-url")).toBe("not-a-url");
  });
});

describe("DEFAULT_UPDATE_MIRRORS", () => {
  it("默认镜像均为合法且以斜杠结尾", () => {
    expect(DEFAULT_UPDATE_MIRRORS.length).toBeGreaterThan(0);
    for (const mirror of DEFAULT_UPDATE_MIRRORS) {
      expect(normalizeMirror(mirror)).toBe(mirror);
    }
  });
});
