// Heuristic hint flags for evidence: a remote ssh command, and script content sent to an interpreter.

import type { FileEvidence } from "./evidence-file-reader.ts";

export function commandSignals(
  remoteCommand: string,
  hasStdin: boolean,
): Record<string, boolean> {
  return {
    stagingHint: /\bstag(?:e|ing)?\b/i.test(remoteCommand),
    productionHint: /\bprod(?:uction)?\b/i.test(remoteCommand),
    executesStdin:
      hasStdin &&
      /\b(?:python(?:3)?|bash|sh|node|ruby|perl)\s+-$/.test(remoteCommand),
    secretReadHint:
      /\b(?:env|printenv)\b|(?:^|[\s/])\.env\b|\/proc\/\d+\/environ\b|(?:cat|sed|grep)\s+[^\n;]*(?:credential|secret|token|private[_-]?key)/i.test(
        remoteCommand,
      ),
    mutationHint:
      /\b(?:rm|mv|cp|install|deploy|restart|stop|start|kill|reboot|shutdown|chmod|chown|truncate|tee|docker\s+(?:rm|restart|stop|kill|compose\s+(?:up|down))|kubectl\s+(?:apply|delete|patch|rollout)|systemctl\s+(?:restart|stop|start|enable|disable))\b/i.test(
        remoteCommand,
      ),
  };
}

export function analyzeScriptContent(content: string): Record<string, unknown> {
  const outboundUrls = [
    ...content.matchAll(/https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g),
  ]
    .map((match) => match[0])
    .slice(0, 8);
  return {
    credentialPathReadHint:
      /(?:read_text|read_bytes|open)\s*\([^)]*(?:\.ssh\/id_|\.aws\/credentials|\.env\b|credential|private[_-]?key)/i.test(
        content,
      ) ||
      /Path\s*\([^)]*(?:\.ssh\/id_|\.aws\/credentials|\.env\b|credential|private[_-]?key)[^)]*\)\s*\.\s*(?:read_text|read_bytes|open)/i.test(
        content,
      ),
    environmentEnumerationHint:
      /\bos\.environ\b|\bprocess\.env\b|\bprintenv\b|(?:^|[^\w])env(?:[^\w]|$)/m.test(
        content,
      ),
    networkUploadHint:
      /\brequests?\.(?:post|put|patch)\s*\(|\burlopen\s*\([^)]*(?:data\s*=|Request)|\bmethod\s*=\s*["'](?:POST|PUT|PATCH)["']|\bcurl\b[^\n]*(?:--data|-d\b|-T\b|--upload-file)/i.test(
        content,
      ),
    dynamicExecutionHint:
      /\b(?:exec|eval|compile)\s*\(|\bsubprocess\.(?:run|Popen|call)\s*\(|\bos\.system\s*\(|\bchild_process\.(?:exec|spawn)\s*\(/i.test(
        content,
      ),
    fileMutationHint:
      /\.(?:write_text|write_bytes|unlink|rename|replace)\s*\(|\bopen\s*\([^)]*,\s*["'][wax+]|\bshutil\.(?:rmtree|move|copy|copy2)\s*\(|\bos\.(?:remove|unlink|rename|replace)\s*\(/i.test(
        content,
      ),
    databaseMutationHint:
      /\b(?:alter|drop|truncate|delete\s+from|update|insert\s+into|create\s+(?:table|index)|grant|revoke)\b/i.test(
        content,
      ),
    outboundUrls,
  };
}

export function stdinSignals(
  stdin: FileEvidence | undefined,
): Record<string, unknown> | undefined {
  if (!stdin?.content) return;
  return analyzeScriptContent(stdin.content);
}
