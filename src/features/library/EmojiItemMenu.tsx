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
  ArrowUpload20Regular,
  Tag20Regular,
} from "@fluentui/react-icons";

export type EmojiItemMenuMode = "default" | "trash" | "group";

interface EmojiItemMenuProps {
  mode?: EmojiItemMenuMode;
  favorite: boolean;
  /** true = 菜单操作的是多选选区；复制/查看文件位置是单项操作，多选时隐藏。 */
  multi?: boolean;
  onToggleFavorite: () => void;
  onCopy: () => void;
  onMoveToGroup: () => void;
  onRemoveFromGroup?: () => void;
  onAddTags: () => void;
  onShowInExplorer: () => void;
  onDelete: () => void;
  onRestore?: () => void;
  onPermanentlyDelete?: () => void;
}

export function EmojiItemMenu({
  mode = "default",
  favorite,
  multi = false,
  onToggleFavorite,
  onCopy,
  onMoveToGroup,
  onRemoveFromGroup,
  onAddTags,
  onShowInExplorer,
  onDelete,
  onRestore,
  onPermanentlyDelete,
}: EmojiItemMenuProps) {
  if (mode === "trash") {
    return (
      <MenuPopover>
        <MenuList>
          {!multi && (
            <MenuItem icon={<ClipboardImage20Regular />} onClick={onCopy}>
              复制到剪贴板
            </MenuItem>
          )}
          {!multi && (
            <MenuItem icon={<FolderOpen20Regular />} onClick={onShowInExplorer}>
              查看文件位置
            </MenuItem>
          )}
          {onRestore && (
            <MenuItem icon={<ArrowUpload20Regular />} onClick={onRestore}>
              从回收站恢复
            </MenuItem>
          )}
          {onPermanentlyDelete && (
            <MenuItem icon={<Delete20Regular />} onClick={onPermanentlyDelete}>
              彻底删除
            </MenuItem>
          )}
        </MenuList>
      </MenuPopover>
    );
  }

  if (mode === "group") {
    return (
      <MenuPopover>
        <MenuList>
          <MenuItem
            icon={favorite ? <Star20Filled /> : <Star20Regular />}
            onClick={onToggleFavorite}
          >
            {favorite ? "取消收藏" : "收藏"}
          </MenuItem>
          {!multi && (
            <MenuItem icon={<ClipboardImage20Regular />} onClick={onCopy}>
              复制到剪贴板
            </MenuItem>
          )}
          <MenuItem icon={<FolderArrowRight20Regular />} onClick={onMoveToGroup}>
            移至其他分组
          </MenuItem>
          {onRemoveFromGroup && (
            <MenuItem icon={<FolderArrowRight20Regular />} onClick={onRemoveFromGroup}>
              从当前分组移除
            </MenuItem>
          )}
          <MenuItem icon={<Tag20Regular />} onClick={onAddTags}>
            管理标签
          </MenuItem>
          {!multi && (
            <MenuItem icon={<FolderOpen20Regular />} onClick={onShowInExplorer}>
              查看文件位置
            </MenuItem>
          )}
          <MenuItem icon={<Delete20Regular />} onClick={onDelete}>
            移入回收站
          </MenuItem>
        </MenuList>
      </MenuPopover>
    );
  }

  return (
    <MenuPopover>
      <MenuList>
        <MenuItem
          icon={favorite ? <Star20Filled /> : <Star20Regular />}
          onClick={onToggleFavorite}
        >
          {favorite ? "取消收藏" : "收藏"}
        </MenuItem>
        {!multi && (
          <MenuItem icon={<ClipboardImage20Regular />} onClick={onCopy}>
            复制到剪贴板
          </MenuItem>
        )}
        <MenuItem icon={<FolderArrowRight20Regular />} onClick={onMoveToGroup}>
          加入分组
        </MenuItem>
        <MenuItem icon={<Tag20Regular />} onClick={onAddTags}>
          管理标签
        </MenuItem>
        {!multi && (
          <MenuItem icon={<FolderOpen20Regular />} onClick={onShowInExplorer}>
            查看文件位置
          </MenuItem>
        )}
        <MenuItem icon={<Delete20Regular />} onClick={onDelete}>
          移入回收站
        </MenuItem>
      </MenuList>
    </MenuPopover>
  );
}
