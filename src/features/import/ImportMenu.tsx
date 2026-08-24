import {
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  type MenuButtonProps,
} from "@fluentui/react-components";
import { ClipboardImage20Regular, FolderAdd20Regular, ImageAdd20Regular } from "@fluentui/react-icons";

interface ImportMenuProps {
  label: string;
  appearance?: MenuButtonProps["appearance"];
  disabled?: boolean;
  onImportFolder: () => void;
}

export function ImportMenu({
  label,
  appearance = "secondary",
  disabled = false,
  onImportFolder,
}: ImportMenuProps) {
  return (
    <Menu positioning="below-end">
      <MenuTrigger disableButtonEnhancement>
        <MenuButton appearance={appearance} disabled={disabled} icon={<FolderAdd20Regular />}>
          {label}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<ImageAdd20Regular />} disabled>
            导入图片（即将支持）
          </MenuItem>
          <MenuItem icon={<FolderAdd20Regular />} onClick={onImportFolder}>
            导入文件夹
          </MenuItem>
          <MenuItem icon={<ClipboardImage20Regular />} disabled>
            从剪贴板收藏（即将支持）
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
