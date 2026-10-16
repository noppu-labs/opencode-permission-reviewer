// Git blob hashes of the security-critical files actually inspected for this kit.
// biome-ignore-all lint/security/noSecrets: every entry below is a git blob SHA-1
// (40 hex chars) pinned for the parity check, not a credential.
//
// The source snapshot (lib/source-snapshot.mjs) hashes each pinned file's bytes
// the way git hashes a blob object and compares against the entry here; the
// parity test (tests/plugin-refusals.test.mjs) refuses the plugin unless every
// entry matches, so a benchmark run can never silently analyze with a locally
// modified copy of a pinned source file. The snapshot also records the whole
// `src/` tree by content hash and the checked-out commit for provenance.
//
// After changing one of the pinned files, re-pin in the same commit:
//
//   git hash-object <path>        # or: git rev-parse HEAD:<path> on a clean tree
//
// and replace the entry's hash with the result. The hash follows the file's
// content only, so a rename keeps it and any edit changes it; a stale entry
// fails the parity test with the file's path in the difference record.
//
// The CI benchmark job runs this parity check first: a pull request that
// changes a pinned file fails it until the entry is re-pinned, which is the
// intended reminder rather than a flake.
export const PINNED_BLOBS = {
  "src/policy.ts": "69522b8244cc041dfedbfaf4690706624b2aab80",
  "src/context.ts": "e328d5e958f93377a98036188391422c0551dac3",
  "src/context/evidence-sections.ts":
    "9fc5c436c2193c15bc67792cabc73983505f52b3",
  "src/context/prompt-budget.ts": "36dd6eedf5817478a64eeb5829b8db117082a67c",
  "src/context/actor-sections.ts": "df48b253d9deb19a73cb661ba7131f8a4772558a",
  "src/context/capability-section.ts":
    "f2b1e6b9a5937ff8ad421cef0dd869b028a83e68",
  "src/context/evidence-layout.ts": "35e438dbcdd4b59be5e8829da6293c1ae203799b",
  "src/context/intent-history.ts": "c4cc97c882001967b0eb8e6c2c14bbbdf9fb6f3b",
  "src/context/message-summary.ts": "273812d5e4dd57f75d39cb155088283de941ea67",
  "src/context/pending-permission.ts":
    "97ba73673a05a5a9d118098b266b1f6177ea2ad0",
  "src/context/synthetic-parts.ts": "d57f10540a5b243a4da49f3dc72deb71d307d322",
  "src/config.ts": "5202f85ae9fc790d3b24f9c843489525a7428d16",
  "src/config-fields.ts": "5a95a9cf02bea0f33e3eaa086b91269b5769ba9c",
  "src/config-knobs.ts": "e576c89b91d0eee6eec91998a4680728025792c4",
  "src/config-policy-rules.ts": "c114277b0c48c7edba60e15be44f80f84cd6f9d4",
  "src/config-risk-policy.ts": "b0153a9fbe82baebecbbb3dd1afe0196978bab91",
  "src/config-rule-condition.ts": "c5d475f4a06542cf79f67058f5ab3d55100c7821",
  "src/system-one-routing.ts": "53d6af514304ac772ed00ffee508b3d32e595aed",
  "src/reviewer-model.ts": "e8b33fa484ff8de522060c5a4a1d6426d55f9845",
  "src/decision.ts": "4d806acf86e01fec23c9b93d2d98e0b57aa7bb3a",
  "src/is-record.ts": "e659b433eacbe23c2a76e43b22c02be146df74ba",
  "src/decision-gates.ts": "f54307ffb219fb625546db1a88652ee031c45621",
  "src/decision-schema.ts": "e60339d6fb71ac232b79c1261a02aae265f05852",
  "src/policy/policy-engine.ts": "a9975ee01dd909ec4c163128561178ca88aa5933",
  "src/policy/policy-conditions.ts": "1a4ce441512dd037f31200f8d8df1f786e1d0c37",
  "src/policy/profile-templates.ts": "a88bfdeb093dba5e7b18c68ed26560efd853045b",
  "src/escalation.ts": "7ad6baccad7b426f439e9689235485a24fccef5d",
  "src/core/review-engine.ts": "4bf4a5cc2dd3855688d08b51bacb3b874a3cbc51",
  "src/core/review-result-gates.ts": "406386573d1a7ab3381bde6ce5d81fbd4eac11f2",
  "src/emergency-brake.ts": "30f14fc975622a1cc46107c39a511ae76913c214",
  "src/reviewed-command.ts": "d7f4893e9f590680cfc10d2e4b9ffc1743fb17b7",
  "src/brake-arguments.ts": "9e67d27ca7194e5dca9023a4e2265931263ed328",
  "src/brake-rm-flags.ts": "034adfcdccaf0c0f567c1c0f16ba7d1eff336a09",
  "src/brake-root-target.ts": "82548f17b0fc651c65cf30decb1e0d848d097a10",
  "src/brake-root-rm.ts": "8389ffd387fec486d49fa6583b713fbb4df28b21",
  "src/brake-find-root.ts": "2ebefecea8bfc28a165ea41739319a4dd3c7738e",
  "src/brake-find-exec.ts": "a4c8be903faf42139a2ca35b94d687e49e4e6b95",
  "src/brake-block-device.ts": "30299a9ed68dc2338159d6639022103d45754a0b",
  "src/brake-device-copy.ts": "d11bbd124821d2c7f5258b5d2682d8e9ec13fe1c",
  "src/brake-partition-tools.ts": "2d7e552d88f20157cdcede7ad7e87c613660254c",
  "src/brake-formatter-options.ts": "28cdc2bc3963739cf6871c2e0220d1c4eab77491",
  "src/brake-format-tools.ts": "daf7a46a83231837f38a0c6f0b61e2bc62656991",
  "src/brake-device-tools.ts": "c595f135a7abe9cee8bb096ee084ae1fc6cb4a72",
  "src/brake-network-export.ts": "f44ec03d976cce0833d3e232b56a2924408c0888",
  "src/gnu-long-options.ts": "30c8898cdc53a467422f0e0341a466ffff6246a5",
  "src/gnu-long-option-tables.ts": "1dbd4ced0748f8b185aa7dea3d2ca0c0f1095f38",
  "src/redact.ts": "145a65e8ef1b9d1f5eb84256ddeb77565df31fbf",
  "src/capability/command-parser.ts":
    "51b07f1137833796f26e45dc2156adaff4433609",
  "src/capability/bash-analyzer.ts": "74fc89978ba4f023c9238d662933c4d2a987edea",
  "src/capability/bash-command-tables.ts":
    "73211db1442714db02f6fbb79f47a1548c4a5e86",
  "src/capability/bash-facts.ts": "5dccd1c7c6909dbe02e7643ff2a8a6747fa98aec",
  "src/capability/bash-mutation.ts": "e7abc1607cc2c7e01f95e0ea6684e7d60850bede",
  "src/shell-effective-commands.ts": "03ea05a61143f16d90875b81dd4b024e95a90e54",
  "src/effective-command-walk.ts": "cb48baa68c789856e95449d791afef887d63cbd0",
  "src/shell-wrapper-options.ts": "79dab2c3dab7d845f3dc14da5affbfe7573ed1c4",
  "src/shell-command-strings.ts": "a533f7743f4edf42449c18e77f95c939738343d9",
  "src/env-split-string.ts": "a111921edee4bc7fc2672229619bf3a9e37a2305",
  "src/ssh-remote-command.ts": "3b286efa96c402c2628ad4399c4b6e09341c2764",
  "src/shell-lexer.ts": "3e713acbab6633f16140d5091419ce1fb0ae502d",
  "src/element-at.ts": "592422429eaad69ccdfa77a80d61ac4e0ea05453",
  "src/shell-lexer-tables.ts": "d962f14223b70f233fcc11c637f1c0f817d3757d",
  "src/shell-token.ts": "b3b12c1046ff0b94a41d9a175a5475dc19a17865",
  "src/shell-redirections.ts": "8cb0fd65e22202d460d9d917a5e92b338a194445",
  "src/shell-redirection-operators.ts":
    "579703335deab3052f2b1f8b39d34cea10266ba2",
  "src/shell-lex-state.ts": "5acf1a9d6a2cf5a99699582927895cf0401e3275",
  "src/shell-quote-scan.ts": "4381d682749bf462455ea907f2b1234816525d96",
  "src/shell-scanner.ts": "42dd3011f81805637b542a18e7d3b6010d3b8a38",
  "src/shell-substitution.ts": "1d79b4a38d484f5038a25bf5cf28293d57a041da",
  "src/shell-substitution-end.ts": "42a3dbfbc0c8936aba579a6b25a1f5ac702024cc",
  "src/shell-substitution-heredoc.ts":
    "398a3e08c0524b9366118d8dfb20fbfc26389ec7",
  "src/ssh-value-options.ts": "fbf84d1a7168a0219f91597a1e7a269eb794ab0f",
  "src/watch-command.ts": "c30f312ce01c01132107c0ddad83cd7b8992718e",
  "src/capability/heredoc-extractor.ts":
    "a3aa96c4d856cce9fdc185a1011a62ba8bedc958",
  "src/system-one/review.ts": "59165a01f319fa69796127051dade97a79f2205a",
  "src/system-one/system-one-questions.ts":
    "5008341e04e7fc87061e82001cfc43b91fd06846",
  "src/system-one/system-one-answers.ts":
    "928ff1d66890c8dc51e111e8b030fcfc4fb16e9c",
  "src/system-one/system-one-choices.ts":
    "c8d2471455a27cb91bfa965199b7812287b92fe6",
  "src/system-one/system-one-consistency.ts":
    "9658f16a6a3ab91e63506906ab41113d5fa77615",
  "src/system-one/system-one-verdict.ts":
    "cda97035dfdbe291a11540290d1e235e116480c5",
  "src/capability/capability-facts.ts":
    "9d86550d9c6f8775a3923dac9d1aed51a817f0da",
  "src/capability/capability-report.ts":
    "91e3d8b4ef18becfd7d0bb66dd2b76b80368d343",
  "src/capability/segment-heads.ts": "0966f7a888e487113f548b6c90868a20a78debe4",
  "src/capability/action-class.ts": "ea4cf57e8579197fe3b56111c5fe60dd0c3fc9ce",
  "src/capability/sensitive-path-reads.ts":
    "abfae5e5adccfe21f419a9d4fe3ca077d7fa1573",
  "src/capability/effective-command-classifiers.ts":
    "ab58f309f3c719e607a77687ee2a4aec4ebc51a7",
  "src/capability/executable-recognition.ts":
    "b1eafef1054206665fed857e749c3337b488f7cb",
  "src/capability/execution-classifiers.ts":
    "c111e9a3dfe91c33b6d69ce74eb791b636f8f1de",
  "src/capability/file-effect-classifiers.ts":
    "b03fa54cda5b0c69752aad779d8e6123bbd3f320",
  "src/capability/network-classifiers.ts":
    "b80906f712349b3df832ea319806ac470b733215",
  "src/capability/process-classifiers.ts":
    "b578ec0a5ff7535fab34e1fc2a1ca74af454b699",
  "src/capability/mutation-operands.ts":
    "5d6f8ae63819d2f6919a71d97b2d2008f0d5a36f",
  "src/capability/read-only-tool-mutations.ts":
    "684c044741a3788a2c504a42a9250bbbafb9ed7a",
  "src/capability/git-subcommand-forms.ts":
    "7575566966af5a9bccac2a72dd336e9dadaa99e2",
  "src/git-global-options.ts": "35752e52090120b61ed4679fcc3b1f1566cd8f01",
  "src/capability/heredoc-delimiter.ts":
    "00cecfdb88d89810ec418166077b056507ff89e1",
  "src/capability/heredoc-word-quotes.ts":
    "b9e1c43faf29d302d48f967ec740a2b9eb7c230c",
  "src/capability/ansi-c-quoting.ts":
    "d2f0eabf08316462275c01b7edd4ebac2ef98308",
  "src/capability/heredoc-scan-context.ts":
    "84d5fa683ccfe5c73696557656aa25abb5c7683d",
  "src/capability/heredoc-bodies.ts":
    "d766923e0629d09e4bba8867d0e27d6739f19d98",
  "src/capability/heredoc-body-records.ts":
    "dd80e0f91f7f46ebb4f28dff1dbcb0e3137420d9",
  "src/capability/heredoc-body-text.ts":
    "a2fc69df649d7e71bf683008fbae3c2036b7640b",
};
