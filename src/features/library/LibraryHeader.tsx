import {
  Button,
  Dropdown,
  Option,
  ToggleButton,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckboxChecked20Filled,
  CheckboxUnchecked20Regular,
  Grid20Filled,
  Grid20Regular,
  GridDots20Regular,
} from "@fluentui/react-icons";
import type { GridDensity, SortOption } from "../../types";

interface LibraryHeaderProps {
  title: string;
  count: number;
  sortOption: SortOption;
  density: GridDensity;
  multiSelectMode: boolean;
  onToggleMultiSelect: () => void;
  onSortChange: (option: SortOption) => void;
  onDensityChange: (density: GridDensity) => void;
}

const sortLabels: Record<SortOption, string> = {
  "name-asc": "名称 A–Z",
  "name-desc": "名称 Z–A",
  format: "文件格式",
};

const useStyles = makeStyles({
  root: {
    minWidth: 0,
    minHeight: "72px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  heading: {
    minWidth: 0,
  },
  title: {
    margin: 0,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase500,
  },
  subtitle: {
    marginTop: "2px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalXS,
  },
  dropdown: {
    minWidth: "126px",
  },
  densityGroup: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "2px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
});

export function LibraryHeader({
  title,
  count,
  sortOption,
  density,
  multiSelectMode,
  onToggleMultiSelect,
  onSortChange,
  onDensityChange,
}: LibraryHeaderProps) {
  const styles = useStyles();

  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.subtitle}>共 {count} 张表情</div>
      </div>

      <div className={styles.actions}>
        <Tooltip content={multiSelectMode ? "退出多选" : "进入多选模式"} relationship="label">
          <ToggleButton
            size="small"
            checked={multiSelectMode}
            icon={multiSelectMode ? <CheckboxChecked20Filled /> : <CheckboxUnchecked20Regular />}
            onClick={onToggleMultiSelect}
          >
            多选
          </ToggleButton>
        </Tooltip>

        <Dropdown
          className={styles.dropdown}
          size="small"
          aria-label="排序方式"
          value={sortLabels[sortOption]}
          selectedOptions={[sortOption]}
          onOptionSelect={(_, data) => data.optionValue && onSortChange(data.optionValue as SortOption)}
        >
          <Option value="name-asc">名称 A–Z</Option>
          <Option value="name-desc">名称 Z–A</Option>
          <Option value="format">文件格式</Option>
        </Dropdown>

        <div className={styles.densityGroup} aria-label="网格密度">
          <Tooltip content="紧凑" relationship="label">
            <Button
              size="small"
              appearance={density === "compact" ? "subtle" : "transparent"}
              aria-pressed={density === "compact"}
              icon={<GridDots20Regular />}
              onClick={() => onDensityChange("compact")}
            />
          </Tooltip>
          <Tooltip content="标准" relationship="label">
            <Button
              size="small"
              appearance={density === "comfortable" ? "subtle" : "transparent"}
              aria-pressed={density === "comfortable"}
              icon={density === "comfortable" ? <Grid20Filled /> : <Grid20Regular />}
              onClick={() => onDensityChange("comfortable")}
            />
          </Tooltip>
          <Tooltip content="宽松" relationship="label">
            <Button
              size="small"
              appearance={density === "large" ? "subtle" : "transparent"}
              aria-pressed={density === "large"}
              icon={<Grid20Regular />}
              onClick={() => onDensityChange("large")}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
