import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
} from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";

interface LibraryMessageProps {
  message: string;
  onDismiss: () => void;
}

export function LibraryMessage({ message, onDismiss }: LibraryMessageProps) {
  return (
    <MessageBar intent="error">
      <MessageBarBody>
        <MessageBarTitle>无法导入表情</MessageBarTitle>
        {message}
      </MessageBarBody>
      <MessageBarActions
        containerAction={
          <Button appearance="transparent" aria-label="关闭错误提示" icon={<Dismiss20Regular />} onClick={onDismiss} />
        }
      />
    </MessageBar>
  );
}
