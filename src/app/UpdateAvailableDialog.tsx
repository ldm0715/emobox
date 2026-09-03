import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Option,
  ProgressBar,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowSync16Regular,
  Dismiss16Regular,
  Globe20Regular,
} from "@fluentui/react-icons";
import { listen } from "@tauri-apps/api/event";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";
import { useAppSettings } from "../components/ThemeProvider";
import {
  UPDATE_DOWNLOAD_PROGRESS_EVENT,
  cancelUpdateDownload,
  getErrorMessage,
  installPendingUpdate,
  startUpdateDownload,
  testMirrorSpeed,
} from "../lib/tauri";
import { mirrorHost } from "../lib/mirrorSources";
import logoUrl from "../assets/logo.png";
import { formatBytes, useStyles } from "./aboutUpdate";
import { LatencyTag } from "./mirrorLatency";
import type {
  MirrorSpeedResult,
  UpdateCheckResult,
  UpdateDownloadProgress,
} from "../types";

/** 官方直连选项（恒在列表末尾兜底；candidate_urls 对它原样保留）。 */
const DIRECT_MIRROR = "github.com/";

/** 「按镜像列表顺序尝试」选项文案：与检查更新同一条源链路。 */
const LIST_ORDER_LABEL = "镜像列表顺序（与检查更新一致）";

/** 「官方直连」独立选项文案（选中 = 只走直连，跳过镜像）。 */
const DIRECT_LABEL = "官方直连（恒定兜底）";

// 延迟三档展示（latencyGrade / LatencyTag）抽在 ./mirrorLatency，
// 与设置页镜像面板共用同一套档位语义与配色。

// 弹窗布局样式：品牌横幅（logo + 大号新版本号 + 元信息）→ 更新说明卡片
// （限高滚动）→ 下载源分区（标题行 + 说明 + 全宽下拉）→ 下载进度。
// 颜色一律 token，勿写十六进制。
const useVersionBadgeStyles = makeStyles({
  hero: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground2,
  },
  heroLogo: {
    width: "44px",
    height: "44px",
    display: "block",
    flexShrink: 0,
  },
  heroText: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalSNudge,
  },
  heroVersionNew: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorBrandForeground1,
    lineHeight: tokens.lineHeightBase600,
  },
  heroMeta: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalSNudge,
    flexWrap: "wrap",
    rowGap: tokens.spacingVerticalSNudge,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  // 更新说明卡片：限高滚动，防止长更新说明把弹窗撑出屏幕。
  notesCard: {
    marginTop: tokens.spacingVerticalM,
    maxHeight: "216px",
    overflowY: "auto",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  // 下载源分区：标题行（标签 + 全部测速）→ 说明 → 全宽下拉。
  mirrorSection: {
    marginTop: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  mirrorHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalS,
  },
  mirrorLabel: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalSNudge,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  mirrorLabelIcon: {
    display: "flex",
    alignItems: "center",
    color: tokens.colorNeutralForeground2,
    "& svg": {
      display: "block",
      flexShrink: 0,
    },
  },
  mirrorHint: {
    marginTop: tokens.spacingVerticalSNudge,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
  },
  mirrorDropdown: {
    marginTop: tokens.spacingVerticalSNudge,
    width: "100%",
  },
  // Option 行内容：名称左、延迟档位右。
  mirrorOptionContent: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalS,
    width: "100%",
    minWidth: 0,
  },
});

export interface UpdateAvailableDialogProps {
  /** 启动静默检查 / 设置页手动检查发现的新版本；null 时弹窗不显示。 */
  result: UpdateCheckResult | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNotifyError: (message: string) => void;
}

/**
 * 「发现新版本」弹窗（应用内更新的唯一下载安装界面）。只在确认有新版本时
 * 打开——没有"检查中/已是最新"等状态，检查职责在启动静默检查与设置页
 * 「检查更新」按钮。常挂载 + open 控制（勿改回条件挂载——截断退场动画）；
 * available 结果在 open 变 true 时快照进本地 state，退场期间不闪空。
 */
export function UpdateAvailableDialog({
  result,
  open,
  onOpenChange,
  onNotifyError,
}: UpdateAvailableDialogProps) {
  const styles = useStyles();
  const badgeStyles = useVersionBadgeStyles();
  const { updateMirrors } = useAppSettings();
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null);
  const [installConfirmOpen, setInstallConfirmOpen] = useState(false);
  // 下载源选择：null = 按镜像列表顺序（Rust 侧兜底直连）；非空 = 单一指定源。
  const [selectedMirror, setSelectedMirror] = useState<string | null>(null);
  const [latencies, setLatencies] = useState<Record<string, MirrorSpeedResult>>({});
  const [testingAll, setTestingAll] = useState(false);
  const [testingOne, setTestingOne] = useState<string | null>(null);
  // open 变 true 时快照 available 结果（防退场动画期间 props 闪回 null）。
  const [snapshot, setSnapshot] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    if (open && result?.status === "available") {
      setSnapshot(result);
      setProgress(null);
      setDownloading(false);
      // 默认下载源 = 本次检查成功拉到清单的那个源（后端 checkedVia 报告；
      // null = 走的官方直连兜底 → 默认选「官方直连」项）。列表里已不存在时
      // 回退首选镜像，再退直连。
      const via = result.checkedVia ?? DIRECT_MIRROR;
      setSelectedMirror(
        mirrorEntries.some((entry) => entry.value === via)
          ? via
          : (updateMirrors[0] ?? DIRECT_MIRROR),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, result]);

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

  // 关闭弹窗时若有下载在途，自动取消——「稍后」即放弃本次下载，避免它
  // 在无人看管的界面继续跑；重开弹窗重新开始即可。
  useEffect(() => {
    if (!open && downloading) {
      void cancelUpdateDownload();
    }
  }, [open, downloading]);

  // 可测速的源 = 用户镜像 + 官方直连（「镜像列表顺序」哨兵项不参与测速）。
  const testableSources = [...updateMirrors.filter((m) => m.trim() !== ""), DIRECT_MIRROR];
  // 下拉选项序列：镜像列表顺序（selectedMirror=null）→ 用户镜像 → 官方直连。
  const mirrorEntries = [
    { value: "default", label: LIST_ORDER_LABEL },
    ...testableSources.map((m) => ({
      value: m,
      label: m === DIRECT_MIRROR ? DIRECT_LABEL : mirrorHost(m),
    })),
  ];
  // 触发框文案必须受控：listbox 折叠时 Option 未注册，Fluent 从
  // selectedOptions 派生的显示文案为空（Selection 契约：受控 selectedOptions
  // 时 value 须一并受控）。
  const selectedDisplay =
    selectedMirror == null
      ? LIST_ORDER_LABEL
      : selectedMirror === DIRECT_MIRROR
        ? DIRECT_LABEL
        : mirrorHost(selectedMirror);

  async function handleTestOne(mirror: string) {
    setTestingOne(mirror);
    try {
      const result = await testMirrorSpeed(mirror);
      setLatencies((current) => ({ ...current, [mirror]: result }));
    } catch (error) {
      setLatencies((current) => ({
        ...current,
        [mirror]: { ok: false, latencyMs: null, error: getErrorMessage(error) },
      }));
    } finally {
      setTestingOne(null);
    }
  }

  // 串行逐个测（并发抢带宽影响读数），测完自动选中延迟最低的可用源。
  async function handleTestAll() {
    setTestingAll(true);
    try {
      const collected: Record<string, MirrorSpeedResult> = {};
      for (const mirror of testableSources) {
        try {
          collected[mirror] = await testMirrorSpeed(mirror);
        } catch (error) {
          collected[mirror] = {
            ok: false,
            latencyMs: null,
            error: getErrorMessage(error),
          };
        }
        setLatencies((current) => ({ ...current, [mirror]: collected[mirror] }));
      }
      const best = testableSources
        .map((mirror) => ({ mirror, result: collected[mirror] }))
        .filter(({ result }) => result.ok && result.latencyMs != null)
        .sort((a, b) => (a.result.latencyMs ?? 0) - (b.result.latencyMs ?? 0))[0];
      if (best) setSelectedMirror(best.mirror);
    } finally {
      setTestingAll(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setProgress(null);
    try {
      // 用户选了源 → 只用该源（Rust 侧仍兜底直连）；没选 → 镜像列表顺序。
      const outcome = await startUpdateDownload(
        selectedMirror ? [selectedMirror] : updateMirrors,
      );
      if (outcome.status === "completed") {
        setInstallConfirmOpen(true);
      }
      // cancelled：回到「发现新版本」状态，用户可重试或稍后。
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

  const available = snapshot?.status === "available" ? snapshot : null;
  const percent =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  return (
    <>
      <Dialog
        open={open && available != null}
        onOpenChange={(_, data) => onOpenChange(data.open)}
        modalType="alert"
      >
        <DialogSurface style={{ width: "min(520px, calc(100vw - 48px))" }}>
          <DialogBody>
            <DialogTitle>发现新版本</DialogTitle>
            <DialogContent>
              {available && (
                <div className={badgeStyles.hero}>
                  <img src={logoUrl} alt="" className={badgeStyles.heroLogo} />
                  <div className={badgeStyles.heroText}>
                    <span className={badgeStyles.heroVersionNew}>
                      v{available.latestVersion}
                    </span>
                    <span className={badgeStyles.heroMeta}>
                      <span>当前 v{available.currentVersion}</span>
                      {available.size != null && (
                        <>
                          <span>·</span>
                          <span>安装包 {formatBytes(available.size)}</span>
                        </>
                      )}
                      {available.pubDate && (
                        <>
                          <span>·</span>
                          <span>{new Date(available.pubDate).toLocaleDateString()}</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              )}
              {available?.notes && (
                <div className={badgeStyles.notesCard}>
                  <div className={styles.releaseNotes}>
                    <Markdown remarkPlugins={[remarkGfm]}>{available.notes}</Markdown>
                  </div>
                </div>
              )}
              {/* 下载源：默认选中检查时命中清单的镜像（checkedVia）；全部测速后自动选最快可用源。 */}
              <div className={badgeStyles.mirrorSection}>
                <div className={badgeStyles.mirrorHeader}>
                  <div className={badgeStyles.mirrorLabel}>
                    <span className={badgeStyles.mirrorLabelIcon}>
                      <Globe20Regular />
                    </span>
                    <span>下载源</span>
                  </div>
                  <Button
                    size="small"
                    appearance="secondary"
                    disabled={testingAll}
                    icon={testingAll ? <Spinner size="extra-tiny" /> : <ArrowSync16Regular />}
                    onClick={() => void handleTestAll()}
                  >
                    {testingAll ? "测速中…" : "全部测速"}
                  </Button>
                </div>
                <div className={badgeStyles.mirrorHint}>
                  默认选中检查更新时命中的源；全部失败时自动回退官方直连，测速后自动选择最快的可用源。
                </div>
                <Dropdown
                  className={badgeStyles.mirrorDropdown}
                  // value 必须一并受控：listbox 折叠时 Option 未注册，Fluent 从
                  // selectedOptions 派生的触发框文案为空（Selection 契约注释）。
                  value={selectedDisplay}
                  selectedOptions={selectedMirror ? [selectedMirror] : ["default"]}
                  onOptionSelect={(_, data) => {
                    setSelectedMirror(
                      data.optionValue === "default" ? null : String(data.optionValue),
                    );
                  }}
                >
                  {mirrorEntries.map(({ value, label }) => (
                    <Option key={value} value={value} text={label}>
                      <span className={badgeStyles.mirrorOptionContent}>
                        <span>{label}</span>
                        {value !== "default" && (
                          <LatencyTag
                            result={latencies[value]}
                            busy={testingAll || testingOne === value}
                          />
                        )}
                      </span>
                    </Option>
                  ))}
                </Dropdown>
              </div>
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
            </DialogContent>
            <DialogActions>
              {downloading ? (
                <Button
                  appearance="secondary"
                  icon={<Dismiss16Regular />}
                  onClick={() => void cancelUpdateDownload()}
                >
                  取消下载
                </Button>
              ) : (
                <>
                  <Button appearance="subtle" onClick={() => onOpenChange(false)}>
                    稍后
                  </Button>
                  <Button appearance="primary" onClick={() => void handleDownload()}>
                    下载并安装
                  </Button>
                </>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={installConfirmOpen}
        onOpenChange={(_, data) => setInstallConfirmOpen(data.open)}
        modalType="alert"
      >
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
              <Button appearance="subtle" onClick={() => setInstallConfirmOpen(false)}>
                稍后再说
              </Button>
              <Button appearance="primary" onClick={() => void handleInstall()}>
                立即安装
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
