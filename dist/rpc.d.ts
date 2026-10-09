/** Portable, read-only protocol. No UI message can approve a permission. */
declare const ReviewerRpc: {
    readonly id: "opencode-permission-reviewer";
    readonly methods: {
        readonly identity: {
            readonly input: {
                readonly type: "object";
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "string";
            };
        };
        readonly status: {
            readonly input: {
                readonly type: "object";
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
            };
        };
        readonly snapshot: {
            readonly input: {
                readonly type: "object";
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
            };
        };
    };
    readonly events: {
        readonly "review.updated": {
            readonly schema: {
                readonly type: "object";
            };
        };
    };
};

export { ReviewerRpc };
