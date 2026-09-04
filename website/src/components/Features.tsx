import { makeStyles, tokens } from "@fluentui/react-components";
import {
  ArrowRepeatAll20Regular,
  FolderAdd20Regular,
  Gif20Regular,
  Grid20Regular,
  LockClosed20Regular,
  ScanText20Regular,
  Search20Regular,
  SearchSquare20Regular,
  type FluentIcon,
} from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { useSectionStyles } from "../styles/common";

/* ------------------------------------------------------------------ */
/* 特性：9 项横向紧凑小卡，3 列铺满宽度（图标 + 名称 + 一行说明）          */
/* ------------------------------------------------------------------ */

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "14px",
    maxWidth: "1080px",
    marginLeft: "auto",
    marginRight: "auto",
  },
  tile: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "14px 16px",
    textAlign: "left",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  tileIcon: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "34px",
    height: "34px",
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  tileBody: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  },
  tileName: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  tileText: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: "1.5",
    color: tokens.colorNeutralForeground2,
  },
});

type Feature = { icon: FluentIcon; name: string; text: ReactNode };

const FEATURES: Feature[] = [
  {
    icon: FolderAdd20Regular,
    name: "受管导入",
    text: "图片 / 文件夹复制进素材库，原文件永不动。",
  },
  {
    icon: Search20Regular,
    name: "秒速搜索",
    text: "跨文件名、分组、标签即时搜索。",
  },
  {
    icon: SearchSquare20Regular,
    name: "全局搜索浮层",
    text: "任意窗口 Ctrl+Alt+Space 唤起。",
  },
  {
    icon: Gif20Regular,
    name: "GIF 动图保真",
    text: "悬停即播，粘贴到微信 / QQ 不丢动画。",
  },
  {
    icon: ArrowRepeatAll20Regular,
    name: "智能去重",
    text: "SHA-256 字节级 + dHash 感知双通道。",
  },
  {
    icon: Grid20Regular,
    name: "整理体系",
    text: "分组 / 标签 / 收藏 / 回收站 / 多选批量。",
  },
  {
    icon: ScanText20Regular,
    name: "OCR 识图打标签",
    text: "自动识别图中文字，三种引擎可选。",
  },
  {
    icon: LockClosed20Regular,
    name: "本地优先",
    text: "全离线、无账号，数据不出本机。",
  },
];

export function Features() {
  const section = useSectionStyles();
  const styles = useStyles();

  return (
    <section id="features" className={section.section}>
      <div className={section.header}>
        <h2 className={section.title}>从导入到粘贴的完整流程</h2>
        <p className={section.description}>
          EmoBox 不只是存图工具——素材从导入、整理，到搜索、复制、发出，都在这台电脑上完成。
        </p>
      </div>

      <div className={styles.grid}>
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div key={feature.name} className={styles.tile}>
              <span className={styles.tileIcon}>
                <Icon aria-hidden />
              </span>
              <div className={styles.tileBody}>
                <span className={styles.tileName}>{feature.name}</span>
                <span className={styles.tileText}>{feature.text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
