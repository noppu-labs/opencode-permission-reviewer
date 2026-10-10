// Synthetic, secret-shaped test values; none is a credential. See CONTRIBUTING.md, "Before opening
// a pull request".

export const GITHUB_PAT =
  // biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
  "ghp_" + "syntheticGitHubToken01234567890abcdefghijklmnopqrstuv";
export const GITHUB_USER_TOKEN =
  // biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
  "ghu_" + "syntheticGitHubUserToken01234567890abcdefghijklmnopqr";
export const GITHUB_FINE_GRAINED_PAT =
  // biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
  "github_" + "pat_synthetictoken1234567890abcdef";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const OPENAI_PROJECT_KEY = "sk-" + "proj-synthetictoken1234567890abcdef";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const OPENAI_KEY = "sk-" + "synthetictoken1234567890ABCDEF1234567890";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const ANTHROPIC_KEY = "sk-" + "ant-synthetictoken1234567890ABCDEF";
export const JWT_TOKEN =
  // biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
  "ey" + "JhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signatureabcdefg";

export const GITHUB_PAT_ALPHANUMERIC =
  // biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
  "ghp_" + "synthetic0123456789abcdefghijklmnopqrstuvwxyz";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const SK_CREDENTIAL_LONG = "sk-" + "syntheticcredential1234567890abcdef";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const SK_CREDENTIAL = "sk-" + "syntheticcredential123456789";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const SK_EXAMPLE_CREDENTIAL = "sk-" + "examplecredential123456789";

export const POSTGRES_URL_WITH_PASSWORD =
  // biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
  "postgres://admin:s3cretpw@db.example.com:5432/app";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const HTTP_URL_WITH_USERINFO = "http://user:pass@127.0.0.1:4096/";

// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const OPAQUE_ABCDEFGH = "abcdefgh1234567890";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const OPAQUE_ABCDEFGHIJ = "abcdefghij1234567890";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const CSRF_TOKEN_VALUE = "abcdef1234567890abcd";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const CSRF_TOKEN_PREFIX = "abcdef1234567890";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const BEARER_DASHED = "dGhpcy1pcy1hLXNlY3JldC10b2tlbg";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const BASIC_DASHED_PADDED = "YWJjLWRlZi1naGk=";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const HEADER_VALUE_OPAQUE = "syntheticapikey1234567890abcd";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const PGPASSWORD_ASSIGNMENT = "PGPASSWORD=postgrespass123";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const SKSYNTHETIC_KEY = "sksynthetic1234567890abcdef";
// biome-ignore lint/security/noSecrets: synthetic fixture (CONTRIBUTING), not a credential
export const SKSYNTHETIC_KEY_LONG = "sksynthetic1234567890abcdef1234567890";
