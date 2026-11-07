# Greptile CLI command reference

Complete flag matrix for `greptile` 3.5.2. This skill remains installable by CLI 3.4.0; versioned
exceptions are called out below. If installed `--help` differs, follow it. The common workflows are
in `SKILL.md`.

## Contents

- Synopsis
- Global
- `greptile review`
- `greptile review status`
- `greptile review show`
- `greptile config`
- `greptile init`
- `greptile settings`
- `greptile skills`
- `greptile login` / `logout` / `whoami`
- `greptile fix`
- `greptile onboard` / `update`
- Compatibility and internal commands
- Recipes

## Synopsis

```sh
greptile login [--api-key] | logout | whoami
greptile review [-b BRANCH] [--layout comments|diff | --diff] [--resume] [--include PATH...]
                [--instructions TEXT] [--json | --text | --agent] [--context LINES]
                [--width COLUMNS] [--no-color]
greptile review show [ID]   # same output flags as review
greptile review status [--commit REF] [--json | --text | --agent]
greptile config [PATH] [--json]
greptile init [--json]
greptile settings list [--json] [--org [ORG]]
greptile settings get KEY [--json] [--org [ORG]]
greptile settings set KEY VALUE [--org [ORG]]
greptile settings unset KEY [--org [ORG]]
greptile settings members [list] [--json] [--org [ORG]]
greptile settings members invite EMAIL... [--role member|admin] [--org [ORG]]
greptile settings members revoke EMAIL_OR_ID [--org [ORG]]
greptile settings path
greptile skills list [--json] | install [NAME...] [-g] [-f] [--json] | update [--json]
greptile fix install | status [--json] | uninstall [--remove-mappings]
greptile onboard
greptile update
```

## Global

| Flag                | Effect                                                             |
| ------------------- | ------------------------------------------------------------------ |
| `-V`, `--version`   | Print the CLI version and exit.                                    |
| `-h`, `--help`      | Print help for the command and exit.                               |
| `--width <COLUMNS>` | Welcome-screen width, `80`–`240`. Only applies to bare `greptile`. |

Bare `greptile` starts onboarding when setup is incomplete, otherwise it prints a welcome screen.
It is interactive and unsuitable for unattended discovery; use `greptile --help`.

## `greptile review`

Reviews the current branch against its base. Requires a git repo with a remote, and reviews
committed work only. It diffs the selected base's merge base through `HEAD`; uncommitted and binary
files are excluded with warnings. The remote is resolved as the branch upstream, otherwise
`origin`, otherwise the sole configured remote.

Explicit display flags override saved `review.*` settings. The layout, context, and width defaults
below apply when no corresponding setting is saved.

| Flag                        | Effect                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-b`, `--branch <BRANCH>`   | Base branch to review against. Omit for the repository default.                                                                                                                           |
| `--resume`                  | Continue the latest locally saved `IN_FLIGHT` review. Branch/include values do not change it; incompatible with `--instructions`.                                                         |
| `--include <paths...>`      | Send named committed files even when gitignored or held back as sensitive. Repeatable, or space-separated.                                                                                |
| `--instructions <TEXT>`     | Extra instructions for this run, same channel as `@greptile <text>` on a PR. Max 2000 characters, non-empty, no control characters, and rejected with `--resume`. Any of those exits `2`. |
| `--json`                    | Print findings as one JSON object on stdout.                                                                                                                                              |
| `--text`                    | Select plain text output. Piped output uses plain text unless `review.output` is saved as `json`.                                                                                         |
| `--agent`                   | Plain text without interactive sign-in or first-run setup; unlike `--text`, also suppresses interactive update notices.                                                                   |
| `--layout <comments\|diff>` | Findings as a list (default) or beside the changed code.                                                                                                                                  |
| `--diff`                    | Shorthand for `--layout diff`.                                                                                                                                                            |
| `--context <LINES>`         | Lines of nearby code around each finding, `0`–`60`, default `15`.                                                                                                                         |
| `--width <COLUMNS>`         | Output width, `40`–`240`. Default: terminal width, then `80`.                                                                                                                             |
| `--color` / `--no-color`    | Force ANSI color on / off.                                                                                                                                                                |

`--layout`, `--context`, `--width`, and the color flags only shape human-readable rendering. They
have no effect on `--json`, so skip them when parsing.

## `greptile review status`

Reports the most recent review for a commit. The answer is the **exit code**; stdout is
supplementary.

| Flag                 | Effect                                              |
| -------------------- | --------------------------------------------------- |
| `--commit <ref>`     | Commit, branch, or tag to resolve. Omit for `HEAD`. |
| `--json`             | Print the status object.                            |
| `--text` / `--agent` | Plain text.                                         |

It also accepts `--layout`, `--diff`, `--context`, `--width`, and the color flags. They do nothing
here, but an out-of-range `--context`/`--width` still exits `2`.

Exit codes: `0` completed, `1` none/signed out/no remote, `3` running, `4` failed, `5` cancelled,
`2` invalid invocation.

The status is read from account- and repository-scoped local history first, and reconciled against
the server only when the local entry is still in flight. If that lookup fails, stderr warns that
the last known state may be stale.

## `greptile review show`

| Flag                            | Effect                                               |
| ------------------------------- | ---------------------------------------------------- |
| `[ID]`                          | Review UUID to fetch. Omit for recent local history. |
| `--json` / `--text` / `--agent` | Structured or plain output.                          |

Plus the same rendering flags as `review`. With no ID and no output flag, in a terminal, this
opens an interactive picker, so always pass `--json` from an agent.

## `greptile config`

Prints the effective **review** configuration: in-repo `.greptile` files merged with the dashboard
config and org-level rules. Not to be confused with `greptile settings`.

| Flag     | Effect                                                     |
| -------- | ---------------------------------------------------------- |
| `[path]` | Resolve as it applies to one file. Omit for the repo root. |
| `--json` | Print the resolved config as JSON.                         |

The command reads local `.greptile` files from the working tree, including uncommitted edits. The
argument must be a **file**, not a directory: scoped rules like `**/*.ts` match files, so a directory
has no single effective config and is rejected. A prospective file path need not exist.

Unlike `review`, `config` exits `1` (not `2`) outside a git repository or with no usable remote. It
exits `2` only for a `[path]` that names a directory or escapes the repository.

Output sections: `settings`, `filters`, `rules`, `instructions`, `rulesMarkdown`, `files`,
`sources`. Filters are always repo-wide; settings, rules, and instructions reflect the given path.

## `greptile settings`

The same command group has two scopes. Local CLI preferences are stored at
`~/.config/greptile/settings.json` (or `$XDG_CONFIG_HOME/greptile/settings.json`). Organization
review settings are stored on the server and require an OAuth account with admin access.

| Subcommand                                  | Effect                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `list [--json] [--org [ORG]]`               | List local keys, or organization keys when `--org` is present.              |
| `get <key> [--json] [--org [ORG]]`          | Print one effective local or `org.*` value and its source.                  |
| `set <key> <value> [--org [ORG]]`           | Save locally, or write an `org.*` value to the server.                      |
| `unset <key> [--org [ORG]]`                 | Remove a local key; write the default for an `org.*` key.                   |
| `members [list] [--json] [--org [ORG]]`     | List the roster and, for admins, pending invites. Bare `members` is `list`. |
| `members invite <email...> [--role <role>]` | Invite deduplicated emails as `member` (default) or `admin`.                |
| `members revoke <email-or-id>`              | Revoke one pending invite by exact email or ID.                             |
| `path`                                      | Print the local settings file location.                                     |

For server-backed commands, `--org` accepts an external ID, slug, or exact name. Omit it when
exactly one eligible organization exists. Multiple eligible organizations require a selector.
Review settings select among administered organizations; member commands select among all
memberships, although a non-admin's slug may not be resolvable, so use the listed external ID.

| Local key        | Values                                           |
| ---------------- | ------------------------------------------------ |
| `color`          | `true` (default), `false`                        |
| `telemetry`      | `true`, `false`; otherwise first-run choice      |
| `apiBaseUrl`     | HTTPS origin with no path; HTTP loopback for dev |
| `webBaseUrl`     | HTTPS origin with no path; HTTP loopback for dev |
| `review.output`  | `auto` (default), `text`, `json`                 |
| `review.layout`  | `comments` (default), `diff`                     |
| `review.context` | integer `0`–`60`, default `15`                   |
| `review.width`   | integer `40`–`240`, default terminal width       |

Organization keys are `org.review.strictness` (`1`–`3`), `org.review.triggerOnUpdates`,
`org.review.shouldUpdateDescription`, `org.review.fixWithAI`, one boolean
`org.review.codingAgents.<id>` key for `cursor`, `claude-code`, `codex`, and `conductor`, and
boolean `included`, `collapsible`, and `defaultOpen` keys under
`org.review.summary.<section>.<field>`. Sections are `summarySection`, `sequenceDiagramSection`,
`issuesTableSection`, and `confidenceScoreSection`.

Bare `greptile settings` opens the interactive hub for a human at a TTY. `--json`, piped output,
or an agent environment prints the local settings list. The settings file never contains
credentials; those live separately in `~/.greptile/auth.json` and must not be printed.

## `greptile skills`

Greptile-authored skills are fetched from the API for install and update; they are not bundled.

| Subcommand           | Effect                                                                   |
| -------------------- | ------------------------------------------------------------------------ |
| `list [--json]`      | List installed copies in the project root and home. Bare `skills` lists. |
| `install [names...]` | Fetch and install named compatible skills, or every compatible skill.    |
| `update [--json]`    | Fetch the catalog and replace stale installed copies in both scopes.     |

| `install` flag   | Effect                                                     |
| ---------------- | ---------------------------------------------------------- |
| `-g`, `--global` | Install for every project instead of just this repository. |
| `-f`, `--force`  | Replace a skill that is already installed.                 |
| `--json`         | Print the install result as JSON.                          |

Skills are written to `.agents/skills/<name>/` (the Agent Skills standard directory), plus
`.claude/skills/` and `.codex/skills/` when those agents are set up at the same root. Each target
directory is decided independently: an existing copy is left alone and reported as skipped unless
`--force` is passed, while a directory that does not have the skill yet still receives it.

An interactive install with no scope flag asks for project or user scope. Non-interactive install
defaults to the project; `--global` selects the home directory. A named unknown or incompatible
skill rejects the whole install with exit `2`; an unnamed all-skill install silently takes the
compatible subset. Update leaves retired catalog entries on disk and reports them as unmanaged.

## `greptile login` / `logout` / `whoami`

| Command  | Notes                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login`  | Interactive browser OAuth. `--api-key` reads a key from a masked prompt or stdin; never pass the secret as an argument.                                                                        |
| `logout` | Removes stored credentials on this device.                                                                                                                                                     |
| `whoami` | Prints the signed-in account and organizations. **Exits `0` with no stored credentials**, printing `Not signed in. …` to stdout; non-zero only for a corrupt, expired, or rejected credential. |

`whoami` is the only one of the three an agent should run. Prefer `GREPTILE_API_KEY` in the
environment over any stored credential flow.

## `greptile fix`

macOS-only setup for Greptile's "Fix in Claude Code" deep links.

| Subcommand                      | Notes                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| `install`                       | Installs or repairs the URL handler app. Interactive.                  |
| `status [--json]`               | Reports readiness. Safe for an agent.                                  |
| `uninstall [--remove-mappings]` | Removes the app; keeps repo folder mappings unless the flag is passed. |

## `greptile init`

Enables Greptile on the current repository for an organization or namespace admin. It requires
OAuth account sign-in on every deployment; API keys are rejected. Non-interactively
it only reports: exit `0` when the repository is already enabled, `1` when it is not enabled or
cannot be found. Enabling requires the interactive yes/no confirmation. A member is told to ask an
organization admin. Nothing is created in the repository itself; enabling happens in the Greptile
workspace.

With `--json` (never prompts) it prints one object to stdout. Fictional example:
`{"repo":"acme/widget","host":"github.com","enabled":true,"canManage":true,"status":"enabled"}`.
`canManage` says whether the caller may enable the repository (`null` when the server predates the permission check, so treat it as unknown and let the enable attempt decide). `status` is one of:

| `status`             | Exit | Meaning                                                                       |
| -------------------- | ---- | ----------------------------------------------------------------------------- |
| `enabled`            | `0`  | Reviews already run on this repository.                                       |
| `not_enabled`        | `1`  | Connected but off; admins can run `init` interactively, members ask an admin. |
| `not_connected`      | `1`  | Repository identified locally but not connected to the workspace.             |
| `unsupported_server` | `1`  | The Greptile server predates `init`.                                          |

Local failures (not a git repository, no usable remote) and API or auth errors keep plain-text
stderr with exit `1` and no JSON.

## `greptile onboard` / `update`

`onboard` is deprecated: setup now starts automatically from commands that need it (including bare
`greptile`). It prints a one-screen status to stderr and exits when it detects a non-interactive
invocation (`0`, or `1` when signed out); in a terminal it opens the setup wizard (or, once set up,
a notice pointing at `greptile init` and `greptile settings`).

`update` is **not** interactive, but it replaces the running CLI in place, so leave it to the user.
Homebrew installs must use `brew upgrade greptile` instead, which the command says itself.

## Compatibility and internal commands

- `greptile review run` is a hidden compatibility alias for bare `greptile review`.
- `greptile onboard` is hidden and deprecated, as described above.
- `greptile __bridge-open <url>` and `greptile __bridge-server` are hidden Fix-service internals.
  Do not invoke them directly.
- `greptile environment` requires CLI 3.7.0+, server access, and repository-admin rights. Before setup,
  verify `greptile environment setup-instructions --help` lists `set`, `show`, and `edit`. If `environment`
  is unknown, upgrade the CLI; earlier releases hid it behind a beta environment variable.

The environment tree is `show`; `setup-script set [file]|show|edit`; `setup-instructions set
[file]|show|edit`; `env-var list|set [NAME] [VALUE]|delete <NAME>`; `network-policy show|set <build|review> <mode>`;
`build`; `log`; `invalidate`; `trex-simulate run <PR...>|show`; `blockers [--all]`; `blockers history [--page N]`; `blockers resolve|skip <ID>`; and `delete`. Every path accepts
`--json` and `--no-input`. `build`, `log`, and `trex-simulate run` accept
`--follow`; invalidation, environment deletion, and blocker resolution/skipping accept `--force`.
`blockers` lists open blockers in instance-count order. Each entry includes instance count, last seen
and its PR, all reported PRs and reasons, and who resolved or skipped it and when. `--all` also includes
closed blockers; `blockers history --page N` pages the latest 100 closed blockers, 10 per page, newest
closure first. `--json` returns the selected blocker array for lists, or `{blockers, page, pageCount,
total}` for history. PRs and reasons reflect the newest 100 instances per blocker, matching the web.

Resolving marks a blocker fixed; it reopens if TREX faces it again. Skipping tells TREX to work around
it when testing, or give up testing if it cannot. Both commands ask for confirmation interactively;
scripts and agents must pass `--force`.
The command is `blockers`; `issues` is removed. Update existing DB environment-agent
prompt overrides to use `blockers` with `--force` for unattended resolve/skip commands.

Environment variables are secret by default. A secret value must come from a masked prompt, stdin,
or an atomic dotenv batch; passing it as an argument is rejected, and secret values are never shown
again. `--non-secret` stores a visible value and permits `[VALUE]`. Saving config does not build it;
run `environment build` to create an active build before a TREX simulation. `trex-simulate run <PR...>`
runs TREX against up to 5 of the current repository's pull requests as a review would, without posting to
them; each environment configuration allows 5 such runs, and changing the setup script, variables, or setup
instructions starts a new configuration and marks earlier results outdated. With `--follow` it prints each
status change, then the results. `trex-simulate show` lists the results and the runs remaining. Destructive
scripted invalidation and deletion require `--force`.

`environment network-policy show` displays both scopes (unset means full). For custom access,
repeat `--domain`, for example `environment network-policy set review custom --domain example.com
--domain '*.example.org'`. Build policy changes do not start a build; they apply to the next build,
such as one started by `environment build`. Review policy
changes apply to the next review VM without a rebuild.

`greptile environment` and related command paths are newer than this skill's 3.4.0 minimum.
Repository settings can disable the last enabled repository in CLI 3.5.0+, and CLI 3.5.1+ gives
members the explicit admin guidance described for `init`. Use installed help and upgrade when a
documented path is absent.

## Recipes

### Review, then act on the findings

```bash
greptile review --json > /tmp/review.json
jq -r '.confidence' /tmp/review.json
jq -r '.comments[] | select(.severity == "P0" or .securityIssue) | "\(.path):\(.startLine) \(.body)"' /tmp/review.json
```

### Wait out an in-flight review

```bash
for _ in $(seq 1 60); do
  greptile review status --json && break
  status=$?
  [ "$status" -eq 3 ] || break
  sleep 10
done
```

`review status` exits `0` as soon as the commit has a completed review. Any code other than `3`
breaks the loop. There is nothing left to wait for.

### Gate a push on a completed review

```bash
greptile review status
case $? in
  0) ;;                                          # reviewed
  3) echo "Greptile review still running"; exit 1 ;;
  *) echo "Run 'greptile review' before pushing"; exit 1 ;;
esac
```

### Review only what changed against a specific base

```bash
greptile review --branch main --json
```

When unsure of the base, omit `-b`. The CLI resolves the repository default branch itself.
