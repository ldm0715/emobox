import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectImageFromClipboard,
  importFolder as importFolderCmd,
  importManagedPaths,
} from "../../lib/tauri";
import type { FolderImportSummary, ManagedImportSummary } from "../../types";

const imageFilters = [{
  name: "支持的图片",
  extensions: ["png", "jpg", "jpeg", "gif", "webp"],
}];

// 加载条最短可见时长：拖放几张图 / 剪贴板收藏单张这类导入常在几百毫秒内结束，
// 进度条即时熄灭用户感知不到导入发生过，故结束后统一再停留片刻。
const IMPORT_INDICATOR_MIN_VISIBLE_MS = 600;

function toUserMessage(error: unknown): string {
  if (typeof error === "string") {
    if (error.includes("目录不存在") || error.includes("路径不存在")) return "所选路径已经不存在，请重新选择。";
    if (error.includes("无法访问") || error.includes("拒绝访问")) return "无法读取所选文件，请确认访问权限。";
    if (error.includes("不支持的图片格式")) return "所选文件中包含不支持的图片格式。";
    return error;
  }
  return "导入失败，请确认文件仍然存在且可以访问。";
}

/**
 * 导入/剪贴板收藏动作集。错误不持有内部 state，统一经 onError 回调抛给调用方
 * （App 传入 notifyError → error toast；统一通知模型见 App.tsx notifyError 注释）。
 *
 * isImporting 由 beginImport/endImport 托管，四个导入入口共用一条加载条
 * （EmojiLibraryView 状态行）；并发导入按计数归零后才计时熄灭，防止先结束的
 * 把仍在进行的导入的加载条提前藏掉。
 */
export function useLibraryImport(onError: (message: string) => void) {
  const [isImporting, setIsImporting] = useState(false);
  const activeImportsRef = useRef(0);
  const hideTimerRef = useRef<number | undefined>(undefined);

  const beginImport = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    activeImportsRef.current += 1;
    setIsImporting(true);
  }, []);

  const endImport = useCallback(() => {
    activeImportsRef.current = Math.max(0, activeImportsRef.current - 1);
    if (activeImportsRef.current > 0) return;
    hideTimerRef.current = window.setTimeout(
      () => setIsImporting(false),
      IMPORT_INDICATOR_MIN_VISIBLE_MS,
    );
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

  // 文件夹导入：递归复制进受管库，顶层子文件夹自动建同名分组。
  // Phase 22：targetGroupId 有值时（当前浏览分组视图内发起）全部图片只归入该
  // 分组，抑制子文件夹自动建组。
  const importFolder = useCallback(
    async (
      skipPerceptualDedup = false,
      targetGroupId?: number,
    ): Promise<FolderImportSummary | null> => {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "选择要导入的表情包文件夹",
        });
        if (typeof selected !== "string") return null;
        beginImport();
        try {
          return await importFolderCmd(selected, skipPerceptualDedup, targetGroupId);
        } finally {
          endImport();
        }
      } catch (dialogError) {
        onError(toUserMessage(dialogError));
        return null;
      }
    },
    [beginImport, endImport, onError],
  );

  const importPaths = useCallback(
    async (
      paths: string[],
      skipPerceptualDedup = false,
      targetGroupId?: number,
    ): Promise<ManagedImportSummary | null> => {
      if (paths.length === 0) return null;
      beginImport();
      try {
        return await importManagedPaths(paths, skipPerceptualDedup, targetGroupId);
      } catch (importError) {
        onError(toUserMessage(importError));
        return null;
      } finally {
        endImport();
      }
    },
    [beginImport, endImport, onError],
  );

  const importImages = useCallback(
    async (targetGroupId?: number): Promise<ManagedImportSummary | null> => {
      try {
        const selected = await open({
          directory: false,
          multiple: true,
          title: "选择要保存到 EmoBox 的图片",
          filters: imageFilters,
        });
        const paths = typeof selected === "string" ? [selected] : selected;
        if (!paths || paths.length === 0) return null;
        return await importPaths(paths, false, targetGroupId);
      } catch (dialogError) {
        onError(toUserMessage(dialogError));
        return null;
      }
    },
    [importPaths, onError],
  );

  const collectFromClipboard = useCallback(
    async (skipPerceptualDedup = false, downloadWebGif = false, targetGroupId?: number) => {
      beginImport();
      try {
        return await collectImageFromClipboard(skipPerceptualDedup, downloadWebGif, targetGroupId);
      } catch (invokeError) {
        onError(toUserMessage(invokeError));
        return null;
      } finally {
        endImport();
      }
    },
    [beginImport, endImport, onError],
  );

  return {
    isImporting,
    importImages,
    importFolder,
    importPaths,
    collectFromClipboard,
  };
}
