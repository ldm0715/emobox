import { afterEach, describe, expect, it } from "vitest";
import { topmostOpenModalSurface } from "./dialogFocusGuard";

/** 造一个 Fluent DialogSurface 形态的节点（role + aria-modal + tabIndex=-1）。 */
function mountSurface(options: {
  role?: "dialog" | "alertdialog";
  ariaModal?: string;
  ariaHidden?: string;
  label: string;
}): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", options.role ?? "dialog");
  if (options.ariaModal !== undefined) el.setAttribute("aria-modal", options.ariaModal);
  if (options.ariaHidden !== undefined) el.setAttribute("aria-hidden", options.ariaHidden);
  el.tabIndex = -1;
  el.dataset.label = options.label;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("topmostOpenModalSurface", () => {
  it("没有任何模态时返回 null", () => {
    expect(topmostOpenModalSurface(document)).toBeNull();
  });

  it("取文档序最后一个——嵌套弹窗的 portal 晚于父弹窗挂载，所以它在最上层", () => {
    mountSurface({ label: "parent", ariaModal: "true" });
    mountSurface({ role: "alertdialog", label: "nested-confirm", ariaModal: "true" });
    expect(topmostOpenModalSurface(document)?.dataset.label).toBe("nested-confirm");
  });

  it("跳过 aria-hidden 的已关闭弹窗（unmountOnClose={false} 时会留在 DOM 里）", () => {
    mountSurface({ label: "open", ariaModal: "true" });
    mountSurface({ label: "closed", ariaModal: "true", ariaHidden: "true" });
    expect(topmostOpenModalSurface(document)?.dataset.label).toBe("open");
  });

  it("忽略非模态弹窗（modalType=\"non-modal\" 不设 aria-modal，本就不该陷阱焦点）", () => {
    mountSurface({ label: "modal", ariaModal: "true" });
    mountSurface({ label: "non-modal" });
    expect(topmostOpenModalSurface(document)?.dataset.label).toBe("modal");
  });

  it("全部关闭时返回 null，不会误抓 aria-hidden 的残留节点", () => {
    mountSurface({ label: "closed-a", ariaModal: "true", ariaHidden: "true" });
    mountSurface({ label: "closed-b", ariaModal: "true", ariaHidden: "true" });
    expect(topmostOpenModalSurface(document)).toBeNull();
  });
});
