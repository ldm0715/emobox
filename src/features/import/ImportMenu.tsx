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
  onImportImages: () => void;
  onImportFolder: () => void;
  onCollectFromClipboard: () => void;
}

export function ImportMenu({
  label,
  appearance = "secondary",
  disabled = false,
  onImportImages,
  onImportFolder,
  onCollectFromClipboard,
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
          <MenuItem icon={<ImageAdd20Regular />} onClick={onImportImages}>
            导入图片
          </MenuItem>
          <MenuItem icon={<FolderAdd20Regular />} onClick={onImportFolder}>
            导入文件夹（仅索引原路径）
          </MenuItem>
          <MenuItem
            icon={<ClipboardImage20Regular />}
            onClick={onCollectFromClipboard}
            disabled={disabled}
          >
            从剪贴板收藏
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}