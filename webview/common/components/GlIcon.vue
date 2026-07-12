<script setup lang="ts">
import account from "@gitlab/svgs/dist/sprite_icons/account.svg";
import arrowRight from "@gitlab/svgs/dist/sprite_icons/arrow-right.svg";
import branch from "@gitlab/svgs/dist/sprite_icons/branch.svg";
import bold from "@gitlab/svgs/dist/sprite_icons/bold.svg";
import check from "@gitlab/svgs/dist/sprite_icons/check.svg";
import checkCircle from "@gitlab/svgs/dist/sprite_icons/check-circle.svg";
import chevronDown from "@gitlab/svgs/dist/sprite_icons/chevron-down.svg";
import chevronRight from "@gitlab/svgs/dist/sprite_icons/chevron-right.svg";
import chevronUp from "@gitlab/svgs/dist/sprite_icons/chevron-up.svg";
import close from "@gitlab/svgs/dist/sprite_icons/close.svg";
import code from "@gitlab/svgs/dist/sprite_icons/code.svg";
import comment from "@gitlab/svgs/dist/sprite_icons/comment.svg";
import comments from "@gitlab/svgs/dist/sprite_icons/comments.svg";
import commit from "@gitlab/svgs/dist/sprite_icons/commit.svg";
import externalLink from "@gitlab/svgs/dist/sprite_icons/external-link.svg";
import file from "@gitlab/svgs/dist/sprite_icons/file-modified.svg";
import fileTree from "@gitlab/svgs/dist/sprite_icons/file-tree.svg";
import folder from "@gitlab/svgs/dist/sprite_icons/folder.svg";
import information from "@gitlab/svgs/dist/sprite_icons/information-o.svg";
import italic from "@gitlab/svgs/dist/sprite_icons/italic.svg";
import link from "@gitlab/svgs/dist/sprite_icons/link.svg";
import list from "@gitlab/svgs/dist/sprite_icons/list-bulleted.svg";
import listNumbered from "@gitlab/svgs/dist/sprite_icons/list-numbered.svg";
import notifications from "@gitlab/svgs/dist/sprite_icons/notifications.svg";
import paperAirplane from "@gitlab/svgs/dist/sprite_icons/paper-airplane.svg";
import pencil from "@gitlab/svgs/dist/sprite_icons/pencil.svg";
import quote from "@gitlab/svgs/dist/sprite_icons/quote.svg";
import remove from "@gitlab/svgs/dist/sprite_icons/remove.svg";
import reply from "@gitlab/svgs/dist/sprite_icons/reply.svg";
import retry from "@gitlab/svgs/dist/sprite_icons/retry.svg";
import spinner from "@gitlab/svgs/dist/sprite_icons/spinner.svg";
import strikethrough from "@gitlab/svgs/dist/sprite_icons/strikethrough.svg";
import warning from "@gitlab/svgs/dist/sprite_icons/warning.svg";
import upload from "@gitlab/svgs/dist/sprite_icons/upload.svg";

const icons = {
  account, "arrow-right": arrowRight, bold, branch, check, "check-circle": checkCircle,
  "chevron-down": chevronDown, "chevron-right": chevronRight, "chevron-up": chevronUp, close, comment, comments,
  code, commit, "external-link": externalLink, file, "file-tree": fileTree, folder,
  information, italic, link, list, "list-numbered": listNumbered, notifications, "paper-airplane": paperAirplane, pencil,
  quote, remove, reply, retry, spinner, strikethrough, upload, warning
} as const;

export type GlIconName = keyof typeof icons;
const props = withDefaults(defineProps<{ name: GlIconName; size?: number; label?: string }>(), { size: 16 });
</script>

<template>
  <span
    class="gl-icon"
    :style="{ '--gl-icon-url': `url(&quot;${icons[props.name]}&quot;)`, '--gl-icon-size': `${size}px` }"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  />
</template>

<style scoped>
.gl-icon {
  width: var(--gl-icon-size);
  height: var(--gl-icon-size);
  display: inline-block;
  flex: none;
  background: currentColor;
  mask: var(--gl-icon-url) center / contain no-repeat;
  -webkit-mask: var(--gl-icon-url) center / contain no-repeat;
}
</style>
