import type { StorybookConfig } from "@storybook/vue3-vite";

const config = {
  stories: ["../webview/**/*.stories.@(js|mjs|ts)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest"
  ],
  framework: {
    name: "@storybook/vue3-vite",
    options: {
      docgen: "vue-component-meta"
    }
  },
  docs: {
    autodocs: "tag"
  }
} satisfies StorybookConfig;

export default config;
