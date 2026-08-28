import { makeStyles, tokens } from "@fluentui/react-components";
import { ImageMultiple48Regular } from "@fluentui/react-icons";
import { ImportMenu } from "../import/ImportMenu";

interface EmptyLibraryStateProps {
  importing: boolean;
  onImportImages: () => void;
  onImportFolder: () => void;
  onCollectFromClipboard: () => void;
}

const useStyles = makeStyles({
  root: {
    minHeight: "360px",
    display: "grid",
    placeItems: "center",
    padding: tokens.spacingHorizontalXXL,
  },
  content: {
    maxWidth: "420px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    color: tokens.colorNeutralForeground2,
    textAlign: "center",
  },
  illustration: {
    width: "80px",
    height: "80px",
    display: "grid",
    placeItems: "center",
    marginBottom: tokens.spacingVerticalL,
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    borderRadius: tokens.borderRadiusXLarge,
  },
  title: {
    margin: 0,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  description: {
    maxWidth: "360px",
    marginTop: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalL,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
});

export function EmptyLibraryState({
  importing,
  onImportImages,
  onImportFolder,
  onCollectFromClipboard,
}: EmptyLibraryStateProps) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <div className={styles.illustration}><ImageMultiple48Regular /></div>
        <h2 className={styles.title}>还没有表情</h2>
        <p className={styles.description}>导入图片会保存到 EmoBox 素材库；导入文件夹会把图片复制进素材库并按子文件夹自动分组（没有子文件夹时按文件夹本身建一个组）。</p>
        <ImportMenu
          label="导入表情"
          appearance="primary"
          disabled={importing}
          onImportImages={onImportImages}
          onImportFolder={onImportFolder}
          onCollectFromClipboard={onCollectFromClipboard}
        />
      </div>
    </div>
  );
}