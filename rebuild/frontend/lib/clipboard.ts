/**
 * 剪贴板工具：clipboard.writeText 在非安全上下文（如部分 WebView / 内嵌预览）
 * 会抛 NotAllowedError。用 execCommand('copy') 降级兜底。
 */

export async function copyPlainText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // clipboard API 不可用，降级 execCommand
  }

  // 创建临时 textarea → 选中 → 复制 → 清理
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  ta.setAttribute("readonly", "");
  document.body.appendChild(ta);

  const range = document.createRange();
  range.selectNodeContents(ta);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
    sel?.removeAllRanges();
  }
}
