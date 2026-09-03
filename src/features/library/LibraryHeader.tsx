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
  Apps20Filled,
  Apps20Regular,
  ArrowClockwise20Regular,
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
  /** 已加载项是否已全部选中（全选按钮切换为「取消全选」）。 */
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onToggleMultiSelect: () => void;
  onSortChange: (option: SortOption) => void;
  onDensityChange: (density: GridDensity) => void;
  /** 刷新图库：当前视图全量重拉。导入进行中禁用。 */
  onRefresh: () => void;
  refreshDisabled?: boolean;
}

const sortLabels: Record<SortOption, string> = {
  "name-asc": "名称 A–Z",
  "name-desc": "名称 Z–A",
  format: "文件格式",
  "added-time": "按添加时间",
  "modified-time": "按修改时间",
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
  allSelected,
  onToggleSelectAll,
  onToggleMultiSelect,
  onSortChange,
  onDensityChange,
  onRefresh,
  refreshDisabled,
}: LibraryHeaderProps) {
  const styles = useStyles();

  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.subtitle}>共 {count} 张表情</div>
      </div>

      <div className={styles.actions}>
        <Tooltip content="刷新图库" relationship="label">
          <Button
            size="small"
            appearance="subtle"
            aria-label="刷新图库"
            icon={<ArrowClockwise20Regular />}
            disabled={refreshDisabled}
            onClick={onRefresh}
          />
        </Tooltip>

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

        {multiSelectMode && (
          <Tooltip content={allSelected ? "取消全选（已加载项）" : "全选已加载项"} relationship="label">
            <Button size="small" onClick={onToggleSelectAll}>
              {allSelected ? "取消全选" : "全选"}
            </Button>
          </Tooltip>
        )}

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
          <Option value="added-time">按添加时间</Option>
          <Option value="modified-time">按修改时间</Option>
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
              icon={density === "large" ? <Apps20Filled /> : <Apps20Regular />}
              onClick={() => onDensityChange("large")}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
