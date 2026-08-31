import { GriffelStyle, tokens } from "@fluentui/react-components";

// TagPickerDialog 与 MoveToGroupDialog 共用的选择器弹窗样式
// （两文件原本逐行复制；actions 一处 flex-end 一处 space-between，留在各自文件）。

export interface PickerDialogStyles {
  surface: GriffelStyle;
  content: GriffelStyle;
  subtitle: GriffelStyle;
  listScroll: GriffelStyle;
  listEmpty: GriffelStyle;
  row: GriffelStyle;
  count: GriffelStyle;
  selectAllRow: GriffelStyle;
  inlineCreate: GriffelStyle;
}

export const pickerDialogStyles: PickerDialogStyles = {
  surface: {
    width: "min(480px, calc(100vw - 48px))",
    maxHeight: "min(640px, calc(100vh - 48px))",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
  },
  listScroll: {
    maxHeight: "260px",
    minHeight: "60px",
    overflowY: "auto",
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    padding: tokens.spacingVerticalXS,
  },
  listEmpty: {
    padding: tokens.spacingVerticalL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  count: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  selectAllRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: tokens.spacingVerticalXS,
  },
  inlineCreate: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "end",
    columnGap: tokens.spacingHorizontalS,
  },
};
