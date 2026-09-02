import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  ProgressBar,
  Spinner,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircle16Regular,
  ChevronDown16Regular,
  ChevronUp16Regular,
  Delete16Regular,
  Dismiss16Regular,
  ErrorCircle16Regular,
  Info16Regular,
} from "@fluentui/react-icons";
import { Collapse } from "@fluentui/react-motion-components-preview";
import { listen } from "@tauri-apps/api/event";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useAppSettings } from "../components/ThemeProvider";
import {
  UPDATE_DOWNLOAD_PROGRESS_EVENT,
  cancelUpdateDownload,
  checkForUpdate,
  getErrorMessage,
  installPendingUpdate,
  startUpdateDownload,
  testMirrorSpeed,
} from "../lib/tauri";
import {
  DEFAULT_UPDATE_MIRRORS,
  mirrorHost,
  normalizeMirror,
} from "../lib/mirrorSources";
import type {
  MirrorSpeedResult,
  UpdateCheckResult,
  UpdateDownloadProgress,
} from "../types";

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXL,
  },
  text: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalSNudge,
  },
  labelRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  description: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
    maxWidth: "480px",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
    rowGap: tokens.spacingVerticalSNudge,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
  },
  statusOk: {
    color: tokens.colorPaletteGreenForeground1,
    display: "inline-flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalSNudge,
  },
  statusError: {
    color: tokens.colorPaletteRedForeground1,
    display: "inline-flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalSNudge,
  },
  actionsRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
    rowGap: tokens.spacingVerticalS,
  },
  notesToggle: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
  },
  releaseNotes: {
    marginTop: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
    "& h1, & h2, & h3, & h4": {
      color: tokens.colorNeutralForeground1,
      fontSize: tokens.fontSizeBase400,
      fontWeight: tokens.fontWeightSemibold,
      lineHeight: tokens.lineHeightBase400,
      margin: `${tokens.spacingVerticalS} 0 ${tokens.spacingVerticalSNudge}`,
      "&:first-child": {
        marginTop: 0,
      },
    },
    "& p": {
      margin: `${tokens.spacingVerticalSNudge} 0`,
    },
    "& ul, & ol": {
      margin: `${tokens.spacingVerticalSNudge} 0`,
      paddingLeft: "20px",
    },
    "& li": {
      margin: `${tokens.spacingVerticalSNudge} 0`,
    },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: tokens.fontSizeBase200,
      backgroundColor: tokens.colorNeutralBackground3,
      borderRadius: tokens.borderRadiusSmall,
      padding: "1px 4px",
    },
    "& pre": {
      backgroundColor: tokens.colorNeutralBackground3,
      borderRadius: tokens.borderRadiusMedium,
      padding: tokens.spacingVerticalS,
      overflowX: "auto",
    },
    "& a": {
      color: tokens.colorBrandForeground1,
    },
    "& hr": {
      border: "none",
      borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },
    "& blockquote": {
      margin: `${tokens.spacingVerticalSNudge} 0`,
      padding: `0 ${tokens.spacingHorizontalM}`,
      borderLeft: `3px solid ${tokens.colorNeutralStroke2}`,
      color: tokens.colorNeutralForeground3,
    },
  },
  progressRow: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalSNudge,
    marginTop: tokens.spacingVerticalS,
  },
  progressCaption: {
    display: "flex",
    justifyContent: "space-between",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  // GitHub 仓库 chip：与开源依赖 chip 同款范式（aboutDependencies.tsx）。
  repoChip: {
    display: "inline-flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    cursor: "pointer",
    "& svg": {
      width: "20px",
      height: "20px",
      display: "block",
      flexShrink: 0,
    },
    ":hover": {
      color: tokens.colorBrandForeground1,
      border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
    ":focus-visible": {
      outlineWidth: tokens.strokeWidthThick,
      outlineStyle: "solid",
      outlineColor: tokens.colorBrandStroke1,
      outlineOffset: "2px",
    },
  },
  panelSurface: {
    width: "min(560px, calc(100vw - 48px))",
  },
  mirrorList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  mirrorRow: {
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr) auto auto auto",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    ":hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
  },
  mirrorOrder: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textAlign: "center",
  },
  mirrorHost: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
  },
  mirrorPin: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  mirrorEmpty: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    padding: `${tokens.spacingVerticalS} 0`,
  },
  addRow: {
    display: "flex",
    columnGap: tokens.spacingHorizontalS,
    alignItems: "flex-start",
  },
  addInput: {
    flexGrow: 1,
    minWidth: "240px",
    input: {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: tokens.fontSizeBase200,
    },
  },
  inlineError: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
    marginTop: tokens.spacingVerticalSNudge,
  },
});

function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

/** 标题行（可选 Info 图标 Tooltip），与 SettingsMenu 的 LabelInfo 同范式。 */
function RowLabel({ label, detail }: { label: string; detail?: string }) {
  const styles = useStyles();
  return (
    <div className={styles.labelRow}>
      <span>{label}</span>
      {detail && (
        <Tooltip content={detail} relationship="description" withArrow>
          <span tabIndex={0} aria-label={`${label}详细说明`}>
            <Info16Regular />
          </span>
        </Tooltip>
      )}
    </div>
  );
}

/** simple-icons 的 GitHub 单色标识（CC0），仓库 chip 用。 */
export function GithubIcon() {
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

// ---------- 检查更新卡片 ----------

interface UpdateCardProps {
  appVersion: string | null;
  onNotifyError: (message: string) => void;
}

export function UpdateCard({ appVersion, onNotifyError }: UpdateCardProps) {
  const styles = useStyles();
  const { updateMirrors } = useAppSettings();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null);
  const [installConfirmOpen, setInstallConfirmOpen] = useState(false);

  // 下载进度事件（Rust emit_to main）。handler 只 setState，注册一次即可。
  useEffect(() => {
    const promise = listen<UpdateDownloadProgress>(
      UPDATE_DOWNLOAD_PROGRESS_EVENT,
      (event) => {
        setProgress(event.payload);
      },
    );
    return () => {
      void promise.then((unlisten) => unlisten());
    };
  }, []);

  async function handleCheck() {
    setChecking(true);
    setNotesOpen(false);
    try {
      setResult(await checkForUpdate(updateMirrors));
    } catch (error) {
      onNotifyError(`检查更新失败：${getErrorMessage(error)}`);
    } finally {
      setChecking(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setProgress(null);
    try {
      const outcome = await startUpdateDownload(updateMirrors);
      if (outcome.status === "completed") {
        setInstallConfirmOpen(true);
      }
      // cancelled：回到「发现新版本」状态即可。
    } catch (error) {
      onNotifyError(`下载更新失败：${getErrorMessage(error)}`);
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }

  async function handleInstall() {
    setInstallConfirmOpen(false);
    try {
      // 成功路径：Rust 启动安装器后 app.exit(0)，本 promise 大概率等不到返回。
      await installPendingUpdate();
    } catch (error) {
      onNotifyError(`启动安装程序失败：${getErrorMessage(error)}`);
    }
  }

  const available = result?.status === "available" ? result : null;
  const percent =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  return (
    <div className={mergeClasses(styles.card, styles.row)}>
      <div className={styles.text}>
        <RowLabel
          label="检查更新"
          detail="检查 GitHub Releases 上的新版本；检查与下载按「镜像源」列表加速，全部失败时回退官方直连。安装包下载后先做 SHA-256 校验再启动安装器。"
        />
        {result == null && (
          <div className={styles.description}>
            {appVersion
              ? `当前版本 v${appVersion}，没有检查过更新。`
              : "没有检查过更新。"}
          </div>
        )}
        {result?.status === "upToDate" && (
          <div className={mergeClasses(styles.statusRow, styles.statusOk)}>
            <CheckmarkCircle16Regular />
            <span>已是最新版本（v{result.currentVersion}）</span>
          </div>
        )}
        {result?.status === "noRelease" && (
          <div className={styles.description}>
            仓库还没有发布任何版本，发布后即可在此检查更新。
          </div>
        )}
        {result?.status === "error" && (
          <div className={mergeClasses(styles.statusRow, styles.statusError)}>
            <ErrorCircle16Regular />
            <span>{result.message}</span>
          </div>
        )}
        {available && !downloading && (
          <>
            <div className={styles.statusRow}>
              <span>
                发现新版本 <strong>v{available.latestVersion}</strong>
                {available.currentVersion && `（当前 v${available.currentVersion}）`}
                {formatBytes(available.size) && ` · ${formatBytes(available.size)}`}
              </span>
              {available.notes && (
                <button
                  type="button"
                  className={mergeClasses(
                    styles.statusRow,
                    styles.notesToggle,
                  )}
                  onClick={() => setNotesOpen((open) => !open)}
                >
                  {notesOpen ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
                  <span>{notesOpen ? "收起更新内容" : "查看更新内容"}</span>
                </button>
              )}
            </div>
            <Collapse visible={Boolean(available.notes) && notesOpen} unmountOnExit>
              <div className={styles.releaseNotes}>
                <Markdown remarkPlugins={[remarkGfm]}>{available.notes ?? ""}</Markdown>
              </div>
            </Collapse>
          </>
        )}
        {downloading && (
          <div className={styles.progressRow}>
            <ProgressBar
              value={
                progress?.total && progress.total > 0
                  ? progress.received / progress.total
                  : undefined
              }
            />
            <div className={styles.progressCaption}>
              <span>
                {percent != null ? `正在下载 ${percent}%` : "正在下载…"}
              </span>
              <span>
                {formatBytes(progress?.received) ?? "0 B"}
                {progress?.total ? ` / ${formatBytes(progress.total)}` : ""}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className={styles.actionsRow}>
        {available && !downloading && (
          <Button appearance="primary" onClick={() => void handleDownload()}>
            下载并安装
          </Button>
        )}
        {downloading && (
          <Button
            appearance="secondary"
            icon={<Dismiss16Regular />}
            onClick={() => void cancelUpdateDownload()}
          >
            取消
          </Button>
        )}
        {!downloading && (
          <Button
            appearance={available ? "secondary" : "primary"}
            disabled={checking}
            icon={checking ? <Spinner size="extra-tiny" /> : undefined}
            onClick={() => void handleCheck()}
          >
            检查更新
          </Button>
        )}
      </div>
      <ConfirmInstallDialog
        open={installConfirmOpen}
        onOpenChange={setInstallConfirmOpen}
        onConfirm={() => void handleInstall()}
      />
    </div>
  );
}

/** 下载完成后的安装确认（ConfirmDialog 模式：alert 弹窗，确认即退出应用）。 */
function ConfirmInstallDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)} modalType="alert">
      <DialogSurface style={{ width: "min(440px, calc(100vw - 48px))" }}>
        <DialogBody>
          <DialogTitle>安装更新</DialogTitle>
          <DialogContent>
            <div style={{ whiteSpace: "pre-line", color: tokens.colorNeutralForeground2 }}>
              安装包已下载并通过 SHA-256 校验。
              {"\n"}将启动安装程序并退出 EmoBox，安装完成后请重新打开。
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="subtle" onClick={() => onOpenChange(false)}>
              稍后再说
            </Button>
            <Button appearance="primary" onClick={onConfirm}>
              立即安装
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------- 镜像源卡片 + 管理面板 ----------

interface MirrorSourceCardProps {
  onNotifyError: (message: string) => void;
}

export function MirrorSourceCard({ onNotifyError }: MirrorSourceCardProps) {
  const styles = useStyles();
  const { updateMirrors } = useAppSettings();
  const [panelOpen, setPanelOpen] = useState(false);
  // 测速结果（mirror → result）。放在卡片层：面板测完关闭后，摘要行仍能展示。
  const [latencies, setLatencies] = useState<Record<string, MirrorSpeedResult>>({});

  const okLatencies = updateMirrors
    .map((mirror) => latencies[mirror])
    .filter((result): result is MirrorSpeedResult => result?.ok === true && result.latencyMs != null);
  const testedCount = updateMirrors.filter((mirror) => latencies[mirror] != null).length;
  const best = okLatencies.reduce<number | null>(
    (min, result) => (min == null || (result.latencyMs ?? 0) < min ? result.latencyMs : min),
    null,
  );
  const summary =
    testedCount === 0
      ? `${updateMirrors.length} 个镜像 · 未测速`
      : best != null
        ? `${updateMirrors.length} 个镜像 · ${testedCount} 个可用 · 最快 ${best} ms`
        : `${updateMirrors.length} 个镜像 · 0 个可用`;

  return (
    <>
      <div className={mergeClasses(styles.card, styles.row)}>
        <div className={styles.text}>
          <RowLabel
            label="镜像源"
            detail="检查更新与下载安装包时按列表顺序尝试这些 GitHub 加速镜像（gh-proxy 风格前缀代理），全部失败时自动回退官方直连。支持自行添加与测速排序。"
          />
          <div className={styles.description}>{summary}</div>
        </div>
        <Button onClick={() => setPanelOpen(true)}>管理镜像源</Button>
      </div>
      <MirrorSourcePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        latencies={latencies}
        setLatencies={setLatencies}
        onNotifyError={onNotifyError}
      />
    </>
  );
}

interface MirrorSourcePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  latencies: Record<string, MirrorSpeedResult>;
  setLatencies: Dispatch<SetStateAction<Record<string, MirrorSpeedResult>>>;
  onNotifyError: (message: string) => void;
}

function MirrorSourcePanel({
  open,
  onOpenChange,
  latencies,
  setLatencies,
  onNotifyError,
}: MirrorSourcePanelProps) {
  const styles = useStyles();
  const { updateMirrors, setUpdateMirrors } = useAppSettings();
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [testingOne, setTestingOne] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);

  // 打开时清空输入与错误（面板常挂载 + open prop，避免退场动画期间闪回旧值）。
  useEffect(() => {
    if (open) {
      setInput("");
      setInputError(null);
    }
  }, [open]);

  function handleAdd() {
    const normalized = normalizeMirror(input);
    if (!normalized) {
      setInputError("镜像地址须以 http:// 或 https:// 开头，例如 https://my-mirror.example/");
      return;
    }
    if (updateMirrors.includes(normalized)) {
      setInputError("该镜像已在列表中。");
      return;
    }
    setUpdateMirrors([...updateMirrors, normalized]);
    setInput("");
    setInputError(null);
  }

  function handleRemove(mirror: string) {
    setUpdateMirrors(updateMirrors.filter((item) => item !== mirror));
    setLatencies((current) => {
      const next = { ...current };
      delete next[mirror];
      return next;
    });
  }

  function handleResetDefaults() {
    setUpdateMirrors([...DEFAULT_UPDATE_MIRRORS]);
    setLatencies({});
  }

  async function handleTestOne(mirror: string) {
    setTestingOne(mirror);
    try {
      const result = await testMirrorSpeed(mirror);
      setLatencies((current) => ({ ...current, [mirror]: result }));
    } catch (error) {
      onNotifyError(`镜像测速失败：${getErrorMessage(error)}`);
    } finally {
      setTestingOne(null);
    }
  }

  async function handleTestAll() {
    setTestingAll(true);
    try {
      // 串行逐个测，避免并发抢带宽影响延迟读数。
      const collected: Record<string, MirrorSpeedResult> = {};
      for (const mirror of updateMirrors) {
        try {
          collected[mirror] = await testMirrorSpeed(mirror);
        } catch (error) {
          collected[mirror] = {
            ok: false,
            latencyMs: null,
            error: getErrorMessage(error),
          };
        }
      }
      setLatencies((current) => ({ ...current, ...collected }));
      // 测速后按延迟升序重排并持久化——列表顺序即检查/下载的尝试优先级。
      const latencyOf = (mirror: string) => {
        const result = collected[mirror];
        return result?.ok && result.latencyMs != null
          ? result.latencyMs
          : Number.MAX_SAFE_INTEGER;
      };
      setUpdateMirrors([...updateMirrors].sort((a, b) => latencyOf(a) - latencyOf(b)));
    } finally {
      setTestingAll(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className={styles.panelSurface}>
        <DialogBody>
          <DialogTitle
            action={
              <Tooltip content="关闭" relationship="label">
                <Button
                  appearance="subtle"
                  aria-label="关闭镜像源管理"
                  icon={<Dismiss16Regular />}
                  onClick={() => onOpenChange(false)}
                />
              </Tooltip>
            }
          >
            镜像源管理
          </DialogTitle>
          <DialogContent>
            <div className={styles.description}>
              按列表顺序尝试加速检查更新与下载安装包（gh-proxy 风格前缀代理）；全部失败时自动回退官方直连。测速后按延迟升序重排。
            </div>
            <div className={styles.mirrorList}>
              {updateMirrors.length === 0 && (
                <div className={styles.mirrorEmpty}>
                  没有镜像源，将直接使用官方直连（可能较慢或无法连接）。
                </div>
              )}
              {updateMirrors.map((mirror, index) => {
                const result = latencies[mirror];
                const busy = testingAll || testingOne === mirror;
                return (
                  <div key={mirror} className={styles.mirrorRow}>
                    <span className={styles.mirrorOrder}>{index + 1}</span>
                    <span className={styles.mirrorHost} title={mirror}>
                      {mirrorHost(mirror)}
                    </span>
                    <span className={styles.mirrorPin}>
                      {busy ? (
                        <Spinner size="extra-tiny" />
                      ) : result == null ? (
                        "未测速"
                      ) : result.ok ? (
                        `${result.latencyMs} ms`
                      ) : (
                        <Tooltip content={result.error ?? "测速失败"} relationship="description">
                          <span>失败</span>
                        </Tooltip>
                      )}
                    </span>
                    <Button
                      size="small"
                      appearance="subtle"
                      disabled={testingAll || testingOne === mirror}
                      icon={testingOne === mirror ? <Spinner size="extra-tiny" /> : undefined}
                      onClick={() => void handleTestOne(mirror)}
                    >
                      测速
                    </Button>
                    <Button
                      size="small"
                      appearance="subtle"
                      aria-label={`删除镜像 ${mirrorHost(mirror)}`}
                      disabled={testingAll}
                      icon={<Delete16Regular />}
                      onClick={() => handleRemove(mirror)}
                    />
                  </div>
                );
              })}
            </div>
            <div>
              <div className={styles.addRow}>
                <Input
                  className={styles.addInput}
                  placeholder="https://your-mirror.example/"
                  value={input}
                  aria-label="添加镜像源地址"
                  onChange={(_, data) => {
                    setInput(data.value);
                    setInputError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleAdd();
                    }
                  }}
                />
                <Button appearance="primary" onClick={handleAdd}>
                  添加
                </Button>
              </div>
              {inputError && <div className={styles.inlineError}>{inputError}</div>}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="subtle" disabled={testingAll} onClick={handleResetDefaults}>
              恢复默认
            </Button>
            <Button
              disabled={testingAll || updateMirrors.length === 0}
              onClick={() => void handleTestAll()}
            >
              {testingAll ? "测速中…" : "全部测速"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
