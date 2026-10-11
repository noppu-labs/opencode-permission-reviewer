// Git blob hashes of the security-critical files actually inspected for this kit.
export const PINNED_BLOBS = {
  "src/policy.ts": "69522b8244cc041dfedbfaf4690706624b2aab80",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/context.ts": "e328d5e958f93377a98036188391422c0551dac3",
  "src/context/evidence-sections.ts":
    "9fc5c436c2193c15bc67792cabc73983505f52b3",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/context/prompt-budget.ts": "36dd6eedf5817478a64eeb5829b8db117082a67c",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/context/actor-sections.ts": "df48b253d9deb19a73cb661ba7131f8a4772558a",
  "src/context/capability-section.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "f2b1e6b9a5937ff8ad421cef0dd869b028a83e68",
  "src/context/evidence-layout.ts": "35e438dbcdd4b59be5e8829da6293c1ae203799b",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/context/intent-history.ts": "4f8ef5419a5ccbbbd37a47d93ffe9e265006d85a",
  "src/context/message-summary.ts": "80977fe2e1c286142247e71f7ce0875742451b62",
  "src/context/pending-permission.ts":
    "97ba73673a05a5a9d118098b266b1f6177ea2ad0",
  "src/context/synthetic-parts.ts": "e9da061fa189c9df4566cf0976e4d88607000603",
  "src/config.ts": "de7f2cda9fea53bed690b0316ac929965b7ce8f5",
  "src/config-fields.ts": "ad5aa5bcee0d873c523a8b903bf43ed676fabe01",
  "src/config-knobs.ts": "e576c89b91d0eee6eec91998a4680728025792c4",
  "src/config-policy-rules.ts": "c114277b0c48c7edba60e15be44f80f84cd6f9d4",
  "src/config-risk-policy.ts": "b0153a9fbe82baebecbbb3dd1afe0196978bab91",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/config-rule-condition.ts": "c5d475f4a06542cf79f67058f5ab3d55100c7821",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/reviewer-model.ts": "e8b33fa484ff8de522060c5a4a1d6426d55f9845",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/decision.ts": "4d806acf86e01fec23c9b93d2d98e0b57aa7bb3a",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/is-record.ts": "35b95a114cf76583162098c99d66d72f9cb3b9dd",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/decision-gates.ts": "f54307ffb219fb625546db1a88652ee031c45621",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/decision-schema.ts": "e60339d6fb71ac232b79c1261a02aae265f05852",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/policy/policy-engine.ts": "a9975ee01dd909ec4c163128561178ca88aa5933",
  "src/policy/policy-conditions.ts": "1a4ce441512dd037f31200f8d8df1f786e1d0c37",
  "src/policy/profile-templates.ts": "a88bfdeb093dba5e7b18c68ed26560efd853045b",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/escalation.ts": "eb7d21b7e1c138315c303a45585a342adef26d44",
  "src/core/review-engine.ts": "4bf4a5cc2dd3855688d08b51bacb3b874a3cbc51",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/core/review-result-gates.ts": "406386573d1a7ab3381bde6ce5d81fbd4eac11f2",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/emergency-brake.ts": "0589f1c4c3a42c911228ed3db8a67b536bca25a5",
  "src/brake-arguments.ts": "4f9e33b37e7a631f058ab9f1663c513151de1593",
  "src/brake-rm-flags.ts": "f01b8f6cce63f423cd457fe44ad37057073daa66",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-root-target.ts": "17c8a09bff9cb9653b332728c637785ddaee7c63",
  "src/brake-find-root.ts": "4c083bf94bf7a61df3574f1b8406b3eae6fda0c3",
  "src/brake-block-device.ts": "66af9ea6b35fb1e8e0e941e550e1996b8558c482",
  "src/brake-device-copy.ts": "284ddab26fcb742e25ba644eab95da822cd618dd",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-device-tools.ts": "428f505cec8d4c903d69f6b602eec1ad73683980",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-network-export.ts": "f44ec03d976cce0833d3e232b56a2924408c0888",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/gnu-long-options.ts": "0d1606fcdd1e5758e377b258e006fb963458d46e",
  "src/gnu-long-option-tables.ts": "dab722c262570838172c2a1afe3040f7cfa762f8",
  "src/redact.ts": "145a65e8ef1b9d1f5eb84256ddeb77565df31fbf",
  "src/capability/command-parser.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "51b07f1137833796f26e45dc2156adaff4433609",
  "src/capability/bash-analyzer.ts": "74fc89978ba4f023c9238d662933c4d2a987edea",
  "src/capability/bash-command-tables.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "73211db1442714db02f6fbb79f47a1548c4a5e86",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/capability/bash-facts.ts": "5dccd1c7c6909dbe02e7643ff2a8a6747fa98aec",
  "src/capability/bash-mutation.ts": "faa0c8d39af857f106d66fed2d54f03ca08acd5a",
  "src/shell-effective-commands.ts": "66e9183f50e24ff07424ffa211ded46dca6ba4ce",
  "src/effective-command-walk.ts": "aedd2ffc4ef201aba00595e543d26e2a0f600421",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-wrapper-options.ts": "485e789ca42726abe0b5c89b2c16ed5e67ddf619",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-command-strings.ts": "0794d8de3dc08ebc7ac275f7a16f85806aad1751",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/env-split-string.ts": "1e65da835a70a6e8131dc50437c94efe884947a5",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/ssh-remote-command.ts": "64cd51b44423ff524b709f619e90e5650200cc67",
  "src/shell-lexer.ts": "d62563cfdd2eb71dfaffd70c624fd0de1d05a301",
  "src/element-at.ts": "592422429eaad69ccdfa77a80d61ac4e0ea05453",
  "src/shell-lexer-tables.ts": "58c9f179339388419441f59e639ac29549674dc8",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-token.ts": "b3b12c1046ff0b94a41d9a175a5475dc19a17865",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-redirections.ts": "8cb0fd65e22202d460d9d917a5e92b338a194445",
  "src/shell-redirection-operators.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "579703335deab3052f2b1f8b39d34cea10266ba2",
  "src/shell-lex-state.ts": "a44b5716ccba161d751bcc1be39aaf1ffd05e92e",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-quote-scan.ts": "30acc8301b6b44bc45b742bfcfe7ae536958e0da",
  "src/shell-scanner.ts": "f95ccb4dfbe52845197d51ca531e2751fa0372cf",
  "src/ssh-value-options.ts": "79b1030f4e03d09415238c06cdb0acffdbda2bee",
  "src/capability/heredoc-extractor.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "8db082b16ec9ad879f3c6e1271748761a1fbc3c1",
  "src/system-one/review.ts": "59165a01f319fa69796127051dade97a79f2205a",
  "src/system-one/system-one-questions.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "5008341e04e7fc87061e82001cfc43b91fd06846",
  "src/system-one/system-one-answers.ts":
    "928ff1d66890c8dc51e111e8b030fcfc4fb16e9c",
  "src/system-one/system-one-choices.ts":
    "c8d2471455a27cb91bfa965199b7812287b92fe6",
  "src/system-one/system-one-consistency.ts":
    "9658f16a6a3ab91e63506906ab41113d5fa77615",
  "src/system-one/system-one-verdict.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "cda97035dfdbe291a11540290d1e235e116480c5",
  "src/capability/capability-facts.ts":
    "9d86550d9c6f8775a3923dac9d1aed51a817f0da",
  "src/capability/capability-report.ts":
    "91e3d8b4ef18becfd7d0bb66dd2b76b80368d343",
  "src/capability/segment-heads.ts": "0591a3d6f45ee63c63f322c54dfa7f2a8b6e6ead",
  "src/capability/action-class.ts": "ea4cf57e8579197fe3b56111c5fe60dd0c3fc9ce",
  "src/capability/sensitive-path-reads.ts":
    "e0db1d3fcb8d89ceee3a4f6ff533417c97b15dff",
  "src/capability/effective-command-classifiers.ts":
    "ab58f309f3c719e607a77687ee2a4aec4ebc51a7",
  "src/capability/executable-recognition.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "b1eafef1054206665fed857e749c3337b488f7cb",
  "src/capability/execution-classifiers.ts":
    "c111e9a3dfe91c33b6d69ce74eb791b636f8f1de",
  "src/capability/file-effect-classifiers.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "b03fa54cda5b0c69752aad779d8e6123bbd3f320",
  "src/capability/network-classifiers.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "b80906f712349b3df832ea319806ac470b733215",
  "src/capability/process-classifiers.ts":
    "b578ec0a5ff7535fab34e1fc2a1ca74af454b699",
  "src/capability/mutation-operands.ts":
    "5d6f8ae63819d2f6919a71d97b2d2008f0d5a36f",
  "src/capability/read-only-tool-mutations.ts":
    "684c044741a3788a2c504a42a9250bbbafb9ed7a",
  "src/capability/git-subcommand-forms.ts":
    "1f4206bf0cad0d17779c139fd95241ccb5b65b0b",
  "src/capability/heredoc-delimiter.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "abae24b0e331469527d25e6c3719ceea81a8932e",
  "src/capability/heredoc-word-quotes.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "b9e1c43faf29d302d48f967ec740a2b9eb7c230c",
  "src/capability/ansi-c-quoting.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "d2f0eabf08316462275c01b7edd4ebac2ef98308",
  "src/capability/heredoc-scan-context.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "f70b351151236060ff9746f8ed766d3f94a4a9df",
  "src/capability/heredoc-bodies.ts":
    "d766923e0629d09e4bba8867d0e27d6739f19d98",
  "src/capability/heredoc-body-records.ts":
    "1a1f75eabf46123da6efe46e7e0df5cabe824ebb",
  "src/capability/heredoc-body-text.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "a2fc69df649d7e71bf683008fbae3c2036b7640b",
};
