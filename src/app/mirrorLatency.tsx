import { Spinner, makeStyles, tokens } from "@fluentui/react-components";
import {
  CheckmarkCircle16Regular,
  ErrorCircle16Regular,
  Warning16Regular,
} from "@fluentui/react-icons";
import type { MirrorSpeedResult } from "../types";

// ---------- 镜像测速延迟三档（更新弹窗与设置页镜像面板共用） ----------

/** 延迟档位：<300ms 良好（绿）/ 300-800ms 一般（橙）/ ≥800ms 较慢（红）；失败=不可用（红）。 */
export function latencyGrade(
  result: MirrorSpeedResult | undefined,
): "good" | "fair" | "slow" | "idle" {
  if (result == null) return "idle";
  if (!result.ok || result.latencyMs == null) return "slow";
  if (result.latencyMs < 300) return "good";
  if (result.latencyMs < 800) return "fair";
  return "slow";
}

const GRADE_LABEL = {
  good: "良好",
  fair: "一般",
  slow: "较慢",
  idle: "未测速",
} as const;

/** 延迟档位标签：图标（勾/感叹/叉）+ 「128 ms · 良好」样式文本。
 * 失败原因经原生 title 提示（不用 Fluent Tooltip——本标签会渲染进
 * Dropdown 的 listbox Option 里，弹层组件在 listbox 内定位不可靠）。 */
export function LatencyTag({
  result,
  busy = false,
}: {
  result: MirrorSpeedResult | undefined;
  busy?: boolean;
}) {
  const styles = useLatencyTagStyles();
  if (busy) return <Spinner size="extra-tiny" />;
  const grade = latencyGrade(result);
  const className =
    grade === "good"
      ? styles.latencyGood
      : grade === "fair"
        ? styles.latencyFair
        : grade === "slow"
          ? styles.latencySlow
          : styles.latencyIdle;
  const detail =
    result == null
      ? "未测速"
      : !result.ok || result.latencyMs == null
        ? "不可用"
        : `${result.latencyMs} ms · ${GRADE_LABEL[grade]}`;
  const title =
    result != null && !result.ok && result.error ? result.error : undefined;
  return (
    <span className={className} title={title}>
      {grade === "good" ? (
        <CheckmarkCircle16Regular />
      ) : grade === "fair" ? (
        <Warning16Regular />
      ) : grade === "slow" ? (
        <ErrorCircle16Regular />
      ) : null}
      <span>{detail}</span>
    </span>
  );
}

/** 档位配色。良好 <300ms 绿 / 一般 300-800ms 橙 / 较慢与不可用红 / 未测速灰。 */
const useLatencyTagStyles = makeStyles({
  latencyGood: {
    color: tokens.colorPaletteGreenForeground1,
    fontSize: tokens.fontSizeBase200,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalSNudge,
    "& svg": {
      display: "block",
      flexShrink: 0,
    },
  },
  latencyFair: {
    color: tokens.colorPaletteMarigoldForeground1,
    fontSize: tokens.fontSizeBase200,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalSNudge,
    "& svg": {
      display: "block",
      flexShrink: 0,
    },
  },
  latencySlow: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalSNudge,
    "& svg": {
      display: "block",
      flexShrink: 0,
    },
  },
  latencyIdle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalSNudge,
  },
});
