/**
 * 工具 shell 模式描述文本映射。
 * 如果某个工具需要手写 shell 语法说明，在此添加 import + 条目。
 * 没有条目的工具使用自动生成的描述。
 */
import readShell from "./read.shell.txt"
import writeShell from "./write.shell.txt"
import editShell from "./edit.shell.txt"
import grepShell from "./grep.shell.txt"
import globShell from "./glob.shell.txt"
import bashShell from "./bash.shell.txt"
import historyShell from "./history.shell.txt"
import codesearchShell from "./codesearch.shell.txt"
import skillShell from "./skill.shell.txt"
import changeDirectoryShell from "./change_directory.shell.txt"
import webfetchShell from "./webfetch.shell.txt"
import lspShell from "./lsp.shell.txt"
import memoryShell from "./memory.shell.txt"
import multieditShell from "./multiedit.shell.txt"
import notebookEditShell from "./notebook-edit.shell.txt"
import applyPatchShell from "./apply_patch.shell.txt"
import questionShell from "./question.shell.txt"
import planShell from "./plan.shell.txt"

export const SHELL_DESCRIPTIONS: Record<string, string | undefined> = {
  read: readShell,
  write: writeShell,
  edit: editShell,
  grep: grepShell,
  glob: globShell,
  bash: bashShell,
  history: historyShell,
  codesearch: codesearchShell,
  skill: skillShell,
  change_directory: changeDirectoryShell,
  webfetch: webfetchShell,
  lsp: lspShell,
  memory: memoryShell,
  multiedit: multieditShell,
  "notebook-edit": notebookEditShell,
  apply_patch: applyPatchShell,
  question: questionShell,
  plan_enter: planShell,
  plan_exit: planShell,
}
