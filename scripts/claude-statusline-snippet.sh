# Documentation only: nothing runs this file.
#
# Paste this ONE line into ~/.claude/statusline-command.sh, right after the line that reads stdin into $input
# (for example `input=$(cat)`), so the widget can read Claude Code's rate limits:

mkdir -p ~/.claude/usage-widget && printf '%s' "$input" > ~/.claude/usage-widget/claude.json
