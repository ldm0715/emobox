import { makeStyles, tokens } from "@fluentui/react-components";
import {
  ArrowSync20Regular,
  Copy20Regular,
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
import { useCardStyles, useSectionStyles } from "../styles/common";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: "16px",
  },
  iconBox: {
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    borderRadius: tokens.borderRadiusMedium,
    marginBottom: "14px",
  },
  title: {
    margin: "0 0 6px",
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  text: {
    margin: "0",
    fontSize: tokens.fontSizeBase300,
    lineHeight: "1.65",
    color: tokens.colorNeutralForeground2,
  },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    padding: "1px 5px",
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

const FEATURES: { icon: FluentIcon; title: string; text: ReactNode }[] = [
  {
    icon: FolderAdd20Regular,
    title: "受管导入，原文件永不动",
    text: "图片 / 文件夹导入与拖放都会复制进素材库并生成缩略图；导入文件夹时按子文件夹自动建立同名分组，原始图片绝不改动。",
  },
  {
    icon: Search20Regular,
    title: "秒速搜索",
    text: (
      <>
        全库跨字段即时搜索，支持 <code className="feature-code">组*标签</code> 精确语法；「最近使用」复制即记录、一键回找。
      </>
    ),
  },
  {
    icon: SearchSquare20Regular,
    title: "全局搜索浮层",
    text: "在任何应用里 Ctrl+Alt+Space 唤出独立搜索窗，选中即复制，可选自动粘贴回原窗口（微信 / QQ / 飞书等）。",
  },
  {
    icon: Gif20Regular,
    title: "GIF 动图保真",
    text: "素材库悬停即播动画；复制到微信 / QQ 保留完整动画（按文件通道），不再只有首帧。",
  },
  {
    icon: Copy20Regular,
    title: "智能去重",
    text: "SHA-256 字节级 + dHash 感知双重去重，相似图可预览比对、可强制导入。",
  },
  {
    icon: Grid20Regular,
    title: "完整整理体系",
    text: "分组 / 标签 / 收藏 / 回收站 / 多选批量操作 / 多种排序，全部本地持久化。",
  },
  {
    icon: ScanText20Regular,
    title: "OCR 识图打标签",
    text: "导入后自动识别图片中的文字并转为标签，用文字就能搜到表情；系统 OCR / Tesseract / AI Studio 云端三种引擎可选。",
  },
  {
    icon: ArrowSync20Regular,
    title: "应用内自动更新",
    text: "启动静默检查新版本，内置 GitHub 加速镜像源（可增删、测速排序），安装包经 SHA-256 校验后才安装。",
  },
  {
    icon: LockClosed20Regular,
    title: "本地优先",
    text: "默认全离线，无账号、无使用数据上传，数据全部留在你自己的电脑上。",
  },
];

export function Features() {
  const section = useSectionStyles();
  const card = useCardStyles();
  const styles = useStyles();

  return (
    <section id="features" className={section.section}>
      <div className={section.header}>
        <h2 className={section.title}>从导入到粘贴的完整链路</h2>
        <p className={section.description}>
          不只是「存图」，EmoBox 覆盖了表情素材从进来、整理，到搜出、发出去的每一步。
        </p>
      </div>
      <div className={styles.grid}>
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div key={feature.title} className={card.card}>
              <div className={styles.iconBox}>
                <Icon aria-hidden />
              </div>
              <h3 className={styles.title}>{feature.title}</h3>
              <p className={styles.text}>{feature.text}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
