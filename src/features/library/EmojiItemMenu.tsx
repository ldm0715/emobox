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
  Rename20Regular,
  Star20Filled,
  Star20Regular,
  ArrowUpload20Regular,
  Tag20Regular,
} from "@fluentui/react-icons";

export type EmojiItemMenuMode = "default" | "trash" | "group";

interface EmojiItemMenuProps {
  mode?: EmojiItemMenuMode;
  favorite: boolean;
  /** true = 菜单操作的是多选选区；复制/重命名/查看文件位置是单项操作，多选时隐藏。 */
  multi?: boolean;
  onToggleFavorite: () => void;
  onCopy: () => void;
  onMoveToGroup: () => void;
  onRemoveFromGroup?: () => void;
  onAddTags: () => void;
  onRename?: () => void;
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
  onRename,
  onShowInExplorer,
  onDelete,
  onRestore,
  onPermanentlyDelete,
}: EmojiItemMenuProps) {
  if (mode === "trash") {
    // 回收站只允许 恢复 / 彻底删除——复制与查看文件位置对已进回收站的素材不合理
    //（查看会暴露 assets/trash 内部路径，复制会绕过恢复流程取用已删除文件）。
    return (
      <MenuPopover>
        <MenuList>
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
          {!multi && onRename && (
            <MenuItem icon={<Rename20Regular />} onClick={onRename}>
              重命名
            </MenuItem>
          )}
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
        {!multi && onRename && (
          <MenuItem icon={<Rename20Regular />} onClick={onRename}>
            重命名
          </MenuItem>
        )}
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
