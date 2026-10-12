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
  "src/emergency-brake.ts": "30f14fc975622a1cc46107c39a511ae76913c214",
  "src/reviewed-command.ts": "ae5f1d2e20ff9f4c4928e40354e29af88c2ab390",
  "src/brake-arguments.ts": "9e67d27ca7194e5dca9023a4e2265931263ed328",
  "src/brake-rm-flags.ts": "034adfcdccaf0c0f567c1c0f16ba7d1eff336a09",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-root-target.ts": "82548f17b0fc651c65cf30decb1e0d848d097a10",
  "src/brake-root-rm.ts": "8389ffd387fec486d49fa6583b713fbb4df28b21",
  "src/brake-find-root.ts": "2ebefecea8bfc28a165ea41739319a4dd3c7738e",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-find-exec.ts": "a4c8be903faf42139a2ca35b94d687e49e4e6b95",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-block-device.ts": "30299a9ed68dc2338159d6639022103d45754a0b",
  "src/brake-device-copy.ts": "d11bbd124821d2c7f5258b5d2682d8e9ec13fe1c",
  "src/brake-partition-tools.ts": "2d7e552d88f20157cdcede7ad7e87c613660254c",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-formatter-options.ts": "28cdc2bc3963739cf6871c2e0220d1c4eab77491",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-format-tools.ts": "daf7a46a83231837f38a0c6f0b61e2bc62656991",
  "src/brake-device-tools.ts": "c595f135a7abe9cee8bb096ee084ae1fc6cb4a72",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/brake-network-export.ts": "f44ec03d976cce0833d3e232b56a2924408c0888",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/gnu-long-options.ts": "30c8898cdc53a467422f0e0341a466ffff6246a5",
  "src/gnu-long-option-tables.ts": "1dbd4ced0748f8b185aa7dea3d2ca0c0f1095f38",
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
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/capability/bash-mutation.ts": "f0d7250a40503c82752fb4e1a9e5647e2305f651",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-effective-commands.ts": "03ea05a61143f16d90875b81dd4b024e95a90e54",
  "src/effective-command-walk.ts": "d7512e429391d088bf07802f994281ce1eff49bb",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-wrapper-options.ts": "f325db8c81d62277a56248460f45b4eba343c19a",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-command-strings.ts": "0794d8de3dc08ebc7ac275f7a16f85806aad1751",
  "src/env-split-string.ts": "a111921edee4bc7fc2672229619bf3a9e37a2305",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/ssh-remote-command.ts": "3b286efa96c402c2628ad4399c4b6e09341c2764",
  "src/shell-lexer.ts": "fe0473cca73ccf6640d4a7778d23054c09af5370",
  "src/element-at.ts": "592422429eaad69ccdfa77a80d61ac4e0ea05453",
  "src/shell-lexer-tables.ts": "d962f14223b70f233fcc11c637f1c0f817d3757d",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-token.ts": "e232a38e72580851ccfd6b619b2741f9ff0ac761",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-redirections.ts": "8cb0fd65e22202d460d9d917a5e92b338a194445",
  "src/shell-redirection-operators.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "579703335deab3052f2b1f8b39d34cea10266ba2",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-lex-state.ts": "5c63390b394b84a962217eba5170194726249209",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-quote-scan.ts": "30acc8301b6b44bc45b742bfcfe7ae536958e0da",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-scanner.ts": "c724106c916ed2a5ed29423d453b4537c15eb85d",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/shell-substitution.ts": "cad24b6a081ac303e3e550596eb084207f047443",
  "src/shell-substitution-end.ts": "42a3dbfbc0c8936aba579a6b25a1f5ac702024cc",
  "src/shell-substitution-heredoc.ts":
    // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
    "26154f41333f1dba56266390a1bec08721b3ec04",
  "src/ssh-value-options.ts": "3dd7031f084517dfda29ca343af0601fa1e8a111",
  "src/watch-command.ts": "c30f312ce01c01132107c0ddad83cd7b8992718e",
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
  "src/capability/segment-heads.ts": "c3ff33f0c995091bf9c32da79e259bc5c3e84929",
  "src/capability/action-class.ts": "ea4cf57e8579197fe3b56111c5fe60dd0c3fc9ce",
  "src/capability/sensitive-path-reads.ts":
    "abfae5e5adccfe21f419a9d4fe3ca077d7fa1573",
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
    "7575566966af5a9bccac2a72dd336e9dadaa99e2",
  // biome-ignore lint/security/noSecrets: a git blob SHA-1 (40 hex chars) pinned for the parity check, not a credential
  "src/git-global-options.ts": "d7e4bb98e8946f79243400acf4c44c58a3632594",
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
