import { ImageMultiple24Regular } from "@fluentui/react-icons";
import { makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    width: "32px",
    height: "32px",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundColor: tokens.colorBrandBackground,
    borderRadius: tokens.borderRadiusMedium,
  },
});

export function AppIcon() {
  const styles = useStyles();
  return (
    <span className={styles.root} aria-hidden="true">
      <ImageMultiple24Regular />
    </span>
  );
}
