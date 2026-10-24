# Publish source and matching downloads

Run publishing from a Windows development checkout. Install Git, sign in with
the official GitHub CLI (`gh auth login`), prepare the local build tools described
in the Android and installer guides, and use an existing repository with a
`main` branch and the included Windows workflow. The signed-in account needs
push, Actions read and release permissions. Publishing does not sign an installer.

1. Update the changed component versions with `tools/version.mjs` and update
   the relevant product guide.
2. Write a short public commit message and release notes in local text files,
   for example `work/commit.txt` and `work/release-notes.md`. Describe capabilities,
   fixes and installation limits. Identify downloads as unsigned previews.
   Review these files for secrets, personal data and private discussion before
   publishing. They are sent to GitHub as public text.
3. From the project root, run:

   ```powershell
   .\Publish.ps1 -Repository owner/repository -MessageFile work/commit.txt -NotesFile work/release-notes.md
   ```

The command builds a fresh clean snapshot, runs isolated tests, verifies clean
startup and installer install/upgrade/uninstall behavior, then pushes that exact
source tree to a verification branch. After its Windows check passes, it promotes
the same commit to `main` using a normal push. Concurrent changes stop publication;
there is no force push. A second Windows check verifies `main`. Matching Setup,
portable ZIP, checksums and verification reports are uploaded to a draft preview.
Every uploaded digest and the release tag are checked before the draft is published.

The configured installation is never a Git staging directory. Saved content,
settings, phone approvals, keys, logs, build caches and private working notes are
excluded by the distribution allowlist. Publishing does not restart the local
server or send device commands. Public commit/release text is supplied separately
and must be reviewed as well as source files.

Use `-PrepareOnly` to stop after local preparation without contacting GitHub.
Use `-GitHubCli tools/path/to/gh.exe` for a project-local CLI, and optionally
`-GitHubConfig tools/path/to/private` for its existing credential store.
Do not put tokens in command arguments or repository URLs.

If a network connection or CI wait is interrupted, repeat the same command with
`-Resume`. It checks the saved repository identity, version, tree, artifact hash
and text hashes. It cannot adopt an unrelated draft or replace mismatched assets.
Read `work/publication-session.json` for the last completed stage. A failure may
leave an unpublished verification branch or draft; it does not bypass a gate.
After an abrupt process termination, confirm that no publisher is running before
removing the stale `work/publication.lock` file. Do not remove a live lock.

An unsigned preview and hosted CI do not replace code signing or testing on a
clean Windows machine and actual Android/TV devices.
