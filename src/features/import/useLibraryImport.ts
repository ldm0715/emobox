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

export function useLibraryImport() {
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");

  // 文件夹导入：递归复制进受管库，顶层子文件夹自动建同名分组。
  const importFolder = useCallback(
    async (skipPerceptualDedup = false): Promise<FolderImportSummary | null> => {
      setError("");
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "选择要导入的表情包文件夹",
        });
        if (typeof selected !== "string") return null;
        setIsImporting(true);
        try {
          return await importFolderCmd(selected, skipPerceptualDedup);
        } finally {
          setIsImporting(false);
        }
      } catch (dialogError) {
        setError(toUserMessage(dialogError));
        return null;
      }
    },
    [],
  );

  const importPaths = useCallback(
    async (
      paths: string[],
      skipPerceptualDedup = false,
    ): Promise<ManagedImportSummary | null> => {
      if (paths.length === 0) return null;
      setIsImporting(true);
      setError("");
      try {
        return await importManagedPaths(paths, skipPerceptualDedup);
      } catch (importError) {
        setError(toUserMessage(importError));
        return null;
      } finally {
        setIsImporting(false);
      }
    },
    [],
  );

  const importImages = useCallback(async (): Promise<ManagedImportSummary | null> => {
    setError("");
    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: "选择要保存到 EmoBox 的图片",
        filters: imageFilters,
      });
      const paths = typeof selected === "string" ? [selected] : selected;
      if (!paths || paths.length === 0) return null;
      return await importPaths(paths);
    } catch (dialogError) {
      setError(toUserMessage(dialogError));
      return null;
    }
  }, [importPaths]);

  const collectFromClipboard = useCallback(
    async (skipPerceptualDedup = false, downloadWebGif = false) => {
      setError("");
      try {
        return await collectImageFromClipboard(skipPerceptualDedup, downloadWebGif);
      } catch (invokeError) {
        setError(toUserMessage(invokeError));
        return null;
      }
    },
    [],
  );

  return {
    isImporting,
    error,
    setError,
    importImages,
    importFolder,
    importPaths,
    collectFromClipboard,
  };
}
