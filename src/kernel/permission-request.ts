export interface PermissionToolSource {
  messageID: string;
  callID: string;
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: PermissionToolSource;
}
