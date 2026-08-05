"""内联样式常量 —— 与 phase0-archive/code/md_renderer.py 逐字符一致。

这些字符串值参与 xhs 的 str.replace 二次优化，**改动即破坏 1:1 复刻**，
修改前必须同步核对归档文件。
"""

from __future__ import annotations

HR_STYLE = "border:none;border-top:1px solid #e8e8e8;margin:18px 0"
H1_STYLE = "font-size:22px;font-weight:bold;line-height:1.4;margin:0 0 16px 0"
H2_STYLE = "font-size:18px;font-weight:bold;line-height:1.5;margin:22px 0 10px 0"
BOLD_STYLE = "font-size:15px;line-height:1.8;margin:0 0 12px 0;font-weight:bold;color:#333"
EMOJI_STYLE = "font-size:16px;font-weight:bold;line-height:1.8;margin:18px 0 6px 0;color:#222"
META_STYLE = "font-size:14px;color:#999;line-height:1.8;margin:0 0 12px 0"
P_STYLE = "font-size:15px;line-height:1.8;margin:0 0 12px 0;color:#333"
LI_STYLE = "font-size:15px;line-height:1.8;margin-bottom:3px"
QUOTE_STYLE = "font-size:13px;color:#999;line-height:1.6;margin:0 0 14px 0;font-style:italic"
TAG_STYLE = "font-size:13px;color:#4a90d9;line-height:2;margin:16px 0 0 0"

EMOJI_PREFIXES = (
    "📌", "🎬", "👀", "💡", "❤️", "🔥", "✨", "📊", "🎯", "🏆",
    "🗡️", "⚔️", "👑", "🤖", "🌑", "🎵", "⭐", "💥", "🌀", "📖",
)

# ── 小红书专用（纯文字场景的字号/行距下调） ──
XHS_H1_STYLE = "font-size:21px;font-weight:bold;line-height:1.5;margin:0 0 12px 0;color:#111"
XHS_HR_STYLE = "text-align:center;font-size:14px;color:#ccc;margin:14px 0;letter-spacing:4px"
XHS_EMOJI_STYLE = "margin:16px 0 4px 0;color:#111"
