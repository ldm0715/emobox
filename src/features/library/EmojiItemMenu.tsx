import {
  MenuItem,
  MenuList,
  MenuPopover,
} from "@fluentui/react-components";
import {
  ClipboardImage20Regular,
  Delete20Regular,
  FolderOpen20Regular,
  FolderArrowRight20Regular,
  Star20Filled,
  Star20Regular,
} from "@fluentui/react-icons";

interface EmojiItemMenuProps {
  favorite: boolean;
  onToggleFavorite: () => void;
}

export function EmojiItemMenu({ favorite, onToggleFavorite }: EmojiItemMenuProps) {
  return (
    <MenuPopover>
      <MenuList>
        <MenuItem icon={favorite ? <Star20Filled /> : <Star20Regular />} onClick={onToggleFavorite}>
          {favorite ? "取消收藏" : "收藏"}
        </MenuItem>
        <MenuItem icon={<ClipboardImage20Regular />} disabled>复制（即将支持）</MenuItem>
        <MenuItem icon={<FolderArrowRight20Regular />} disabled>移至分组（即将支持）</MenuItem>
        <MenuItem icon={<FolderOpen20Regular />} disabled>查看文件位置（即将支持）</MenuItem>
        <MenuItem icon={<Delete20Regular />} disabled>删除（即将支持）</MenuItem>
      </MenuList>
    </MenuPopover>
  );
}
