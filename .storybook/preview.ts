import type { Preview } from "@storybook/vue3-vite";
import { computed, watchEffect } from "vue";
import "../webview/common/theme.css";
import "./storybook.css";

const lightTheme = {
  colorScheme: "light",
  "--vscode-font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "--vscode-editor-font-family": "'Cascadia Code', Consolas, monospace",
  "--vscode-font-size": "13px",
  "--vscode-foreground": "#24292f",
  "--vscode-editor-foreground": "#24292f",
  "--vscode-editor-background": "#ffffff",
  "--vscode-sideBar-background": "#f6f8fa",
  "--vscode-editorWidget-background": "#ffffff",
  "--vscode-menu-background": "#ffffff",
  "--vscode-descriptionForeground": "#57606a",
  "--vscode-widget-border": "#d0d7de",
  "--vscode-panel-border": "#d8dee4",
  "--vscode-focusBorder": "#0969da",
  "--vscode-textLink-foreground": "#0969da",
  "--vscode-list-hoverBackground": "#eaeef2",
  "--vscode-list-hoverForeground": "#24292f",
  "--vscode-input-background": "#ffffff",
  "--vscode-input-foreground": "#24292f",
  "--vscode-button-background": "#0969da",
  "--vscode-button-foreground": "#ffffff"
};

const darkTheme = {
  colorScheme: "dark",
  "--vscode-font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "--vscode-editor-font-family": "'Cascadia Code', Consolas, monospace",
  "--vscode-font-size": "13px",
  "--vscode-foreground": "#d7d4dc",
  "--vscode-editor-foreground": "#e6e2eb",
  "--vscode-editor-background": "#1f1e24",
  "--vscode-sideBar-background": "#25232b",
  "--vscode-editorWidget-background": "#2c2933",
  "--vscode-menu-background": "#332e3b",
  "--vscode-descriptionForeground": "#aaa4b2",
  "--vscode-widget-border": "#403c48",
  "--vscode-panel-border": "#403c48",
  "--vscode-focusBorder": "#5b9cf6",
  "--vscode-textLink-foreground": "#75aaf7",
  "--vscode-list-hoverBackground": "#393541",
  "--vscode-list-hoverForeground": "#f0edf4",
  "--vscode-input-background": "#1f1e24",
  "--vscode-input-foreground": "#e6e2eb",
  "--vscode-button-background": "#3b76c4",
  "--vscode-button-foreground": "#ffffff"
};

const preview: Preview = {
  tags: ["autodocs", "test"],
  globalTypes: {
    vscodeTheme: {
      description: "Simulated VS Code theme",
      toolbar: {
        icon: "paintbrush",
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" }
        ],
        dynamicTitle: true
      }
    }
  },
  initialGlobals: {
    vscodeTheme: "dark"
  },
  decorators: [
    (story, context) => ({
      components: { Story: story() },
      setup() {
        const dark = computed(() => context.globals.vscodeTheme !== "light");
        const theme = computed(() => dark.value ? darkTheme : lightTheme);
        watchEffect(() => {
          const root = document.documentElement;
          const body = document.body;
          for (const [key, value] of Object.entries(theme.value)) {
            if (key.startsWith("--")) root.style.setProperty(key, value);
          }
          root.classList.toggle("vscode-dark", dark.value);
          root.classList.toggle("vscode-light", !dark.value);
          body.classList.toggle("vscode-dark", dark.value);
          body.classList.toggle("vscode-light", !dark.value);
        });
        return { dark, theme };
      },
      template: `
        <div class="storybook-vscode-root" :class="{ 'vscode-dark': dark, 'vscode-light': !dark }" :style="theme">
          <Story />
        </div>
      `
    })
  ],
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    options: {
      storySort: {
        order: ["References", "Workspace", "Sidebar", "Review", "Components"]
      }
    },
    a11y: {
      test: "error"
    }
  }
};

export default preview;
