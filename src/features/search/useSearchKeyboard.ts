import { useEffect, useState, type KeyboardEvent } from "react";

interface SearchKeyboardOptions {
  itemCount: number;
  columnCount: number;
  onConfirm: (index: number) => void;
  onClose: () => void;
}

export function useSearchKeyboard({
  itemCount,
  columnCount,
  onConfirm,
  onClose,
}: SearchKeyboardOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(itemCount - 1, 0)));
  }, [itemCount]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (itemCount === 0) return;

    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm(selectedIndex);
      return;
    }

    const movement: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columnCount,
      ArrowDown: columnCount,
    };

    const delta = movement[event.key];
    if (delta === undefined) return;

    event.preventDefault();
    setSelectedIndex((current) => Math.min(Math.max(current + delta, 0), itemCount - 1));
  }

  return { selectedIndex, setSelectedIndex, handleKeyDown };
}
