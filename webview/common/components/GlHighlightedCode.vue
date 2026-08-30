<script setup lang="ts">
import { computed } from "vue";
import { highlightCodeLine, resolveSyntaxLanguage } from "../syntaxHighlight";

const props = defineProps<{
  code: string;
  language?: string;
  filePath?: string;
}>();

const resolvedLanguage = computed(() => resolveSyntaxLanguage(props.language, props.filePath));
const tokens = computed(() => highlightCodeLine(props.code || " ", resolvedLanguage.value));
</script>

<template>
  <code class="gl-highlighted-code" :data-syntax-language="resolvedLanguage">
    <span
      v-for="(token, index) in tokens"
      :key="`${index}:${token.text}`"
      :class="token.kind ? `syntax-${token.kind}` : undefined"
      :data-token-kind="token.kind"
    >{{ token.text }}</span>
  </code>
</template>

<style scoped>
.gl-highlighted-code { color: var(--vscode-editor-foreground, var(--gl-text-strong)); }
.syntax-comment { color: var(--gl-syntax-comment); }
.syntax-keyword { color: var(--gl-syntax-keyword); }
.syntax-number { color: var(--gl-syntax-number); }
.syntax-property { color: var(--gl-syntax-property); }
.syntax-string { color: var(--gl-syntax-string); }
.syntax-tag { color: var(--gl-syntax-tag); }
.syntax-type { color: var(--gl-syntax-type); }
</style>
