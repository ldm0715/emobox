import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
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
 */
export function useLibraryImport(onError: (message: string) => void) {
  const [isImporting, setIsImporting] = useState(false);

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
        setIsImporting(true);
        try {
          return await importFolderCmd(selected, skipPerceptualDedup, targetGroupId);
        } finally {
          setIsImporting(false);
        }
      } catch (dialogError) {
        onError(toUserMessage(dialogError));
        return null;
      }
    },
    [onError],
  );

  const importPaths = useCallback(
    async (
      paths: string[],
      skipPerceptualDedup = false,
      targetGroupId?: number,
    ): Promise<ManagedImportSummary | null> => {
      if (paths.length === 0) return null;
      setIsImporting(true);
      try {
        return await importManagedPaths(paths, skipPerceptualDedup, targetGroupId);
      } catch (importError) {
        onError(toUserMessage(importError));
        return null;
      } finally {
        setIsImporting(false);
      }
    },
    [onError],
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
      try {
        return await collectImageFromClipboard(skipPerceptualDedup, downloadWebGif, targetGroupId);
      } catch (invokeError) {
        onError(toUserMessage(invokeError));
        return null;
      }
    },
    [onError],
  );

  return {
    isImporting,
    importImages,
    importFolder,
    importPaths,
    collectFromClipboard,
  };
}
