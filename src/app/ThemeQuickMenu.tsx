import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
} from "@fluentui/react-components";
import {
  Checkmark20Regular,
  Desktop20Regular,
  WeatherMoon24Regular,
  WeatherMoon20Regular,
  WeatherSunny24Regular,
  WeatherSunny20Regular,
} from "@fluentui/react-icons";
import { useAppSettings, type ThemePreference } from "../components/ThemeProvider";

const options: Array<{ value: ThemePreference; label: string; icon: React.ReactElement }> = [
  { value: "system", label: "跟随系统", icon: <Desktop20Regular /> },
  { value: "light", label: "浅色", icon: <WeatherSunny20Regular /> },
  { value: "dark", label: "深色", icon: <WeatherMoon20Regular /> },
];

export function ThemeQuickMenu() {
  const { theme, resolvedTheme, setTheme } = useAppSettings();

  return (
    <Menu positioning="below-end">
      <Tooltip content="主题" relationship="label">
        <MenuTrigger disableButtonEnhancement>
          <Button
            appearance="subtle"
            aria-label="主题"
            icon={resolvedTheme === "dark" ? <WeatherMoon24Regular /> : <WeatherSunny24Regular />}
          />
        </MenuTrigger>
      </Tooltip>
      <MenuPopover>
        <MenuList>
          {options.map((option) => (
            <MenuItem
              key={option.value}
              icon={option.icon}
              secondaryContent={theme === option.value ? <Checkmark20Regular /> : undefined}
              onClick={() => setTheme(option.value)}
            >
              {option.label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
