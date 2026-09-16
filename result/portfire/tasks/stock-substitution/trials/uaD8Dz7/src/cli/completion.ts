import type { CommandSet } from "./command.js";

/**
 * Shell completion.
 *
 * A crew types these commands with cold hands, and the flag names are long
 * because long flags read better in a makefile. Completion is what makes those
 * two facts compatible.
 *
 * The scripts are generated from the command table rather than written out,
 * because a hand written completion drifts within a month and then actively
 * misleads, offering a flag that was renamed and hiding one that was added.
 */

function quote(value: string): string {
  return value.replace(/'/g, "'\\''");
}

export function bashCompletion(commands: CommandSet): string {
  const names = commands.names().join(" ");
  const cases = commands
    .all()
    .map((command) => {
      const flags = command.flags.map((flag) => `--${flag.name}`).join(" ");
      return [
        `    ${command.name})`,
        `      opts='${quote(flags)}'`,
        "      ;;",
      ].join("\n");
    })
    .join("\n");

  return `# portfire bash completion
# add this to your shell with
#   eval "$(portfire completion --shell bash)"
_portfire() {
  local cur prev cmd opts
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W '${names}' -- "$cur") )
    return
  fi

  case "$cmd" in
${cases}
    *)
      opts=''
      ;;
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
  else
    COMPREPLY=( $(compgen -f -- "$cur") )
  fi
}
complete -F _portfire portfire
`;
}

export function zshCompletion(commands: CommandSet): string {
  const lines = commands
    .all()
    .map((command) => `    '${command.name}:${quote(command.summary)}'`)
    .join("\n");
  const cases = commands
    .all()
    .map((command) => {
      const flags = command.flags
        .map((flag) => `        '--${flag.name}[${quote(flag.help)}]'`)
        .join("\n");
      return [
        `      ${command.name})`,
        "        _arguments \\",
        flags.length === 0 ? "          '*:file:_files'" : `${flags} \\`,
        flags.length === 0 ? "" : "          '*:file:_files'",
        "        ;;",
      ]
        .filter((part) => part.length > 0)
        .join("\n");
    })
    .join("\n");

  return `#compdef portfire
# portfire zsh completion
# add this to your shell with
#   eval "$(portfire completion --shell zsh)"
_portfire() {
  local -a commands
  commands=(
${lines}
  )

  _arguments -C '1:command:->command' '*::arg:->args'

  case "$state" in
    command)
      _describe 'command' commands
      ;;
    args)
      case "\${words[1]}" in
${cases}
      esac
      ;;
  esac
}
_portfire "$@"
`;
}

export type Shell = "bash" | "zsh";

export function completionFor(commands: CommandSet, shell: Shell): string {
  return shell === "zsh" ? zshCompletion(commands) : bashCompletion(commands);
}
