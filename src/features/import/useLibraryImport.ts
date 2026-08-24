import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { scanDirectory } from "../../lib/tauri";
import type { ScanSummary } from "../../types";

function toUserMessage(error: unknown): string {
  if (typeof error === "string") {
    if (error.includes("目录不存在")) return "这个文件夹已经不存在，请重新选择。";
    if (error.includes("无法访问")) return "无法读取这个文件夹，请确认访问权限。";
  }
  return "导入失败，请确认文件夹仍然存在且可以访问。";
}

export function useLibraryImport() {
  const [directory, setDirectory] = useState("");
  const [result, setResult] = useState<ScanSummary | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");

  const scanPath = useCallback(async (path: string): Promise<ScanSummary | null> => {
    setIsImporting(true);
    setError("");

    try {
      const summary = await scanDirectory(path);
      setDirectory(summary.directory);
      setResult(summary);
      return summary;
    } catch (scanError) {
      setError(toUserMessage(scanError));
      return null;
    } finally {
      setIsImporting(false);
    }
  }, []);

  const importFolder = useCallback(async (): Promise<ScanSummary | null> => {
    setError("");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择表情包文件夹",
      });
      if (typeof selected !== "string") return null;
      return await scanPath(selected);
    } catch (dialogError) {
      setError(toUserMessage(dialogError));
      return null;
    }
  }, [scanPath]);

  const rescan = useCallback(async () => {
    if (!directory) return null;
    return await scanPath(directory);
  }, [directory, scanPath]);

  return {
    directory,
    result,
    isImporting,
    error,
    setError,
    importFolder,
    rescan,
  };
}
