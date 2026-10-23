// Synthetic, secret-shaped test values; none is a credential. See docs/CONTRIBUTING.md, "Before opening
// a pull request".

export const GITHUB_PAT =
  "ghp_" + "syntheticGitHubToken01234567890abcdefghijklmnopqrstuv";
export const GITHUB_USER_TOKEN =
  "ghu_" + "syntheticGitHubUserToken01234567890abcdefghijklmnopqr";
export const GITHUB_FINE_GRAINED_PAT =
  "github_" + "pat_synthetictoken1234567890abcdef";
export const OPENAI_PROJECT_KEY = "sk-" + "proj-synthetictoken1234567890abcdef";
export const OPENAI_KEY = "sk-" + "synthetictoken1234567890ABCDEF1234567890";
export const ANTHROPIC_KEY = "sk-" + "ant-synthetictoken1234567890ABCDEF";
export const JWT_TOKEN =
  "ey" + "JhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signatureabcdefg";

export const GITHUB_PAT_ALPHANUMERIC =
  "ghp_" + "synthetic0123456789abcdefghijklmnopqrstuvwxyz";
export const SK_CREDENTIAL_LONG = "sk-" + "syntheticcredential1234567890abcdef";
export const SK_CREDENTIAL = "sk-" + "syntheticcredential123456789";
export const SK_EXAMPLE_CREDENTIAL = "sk-" + "examplecredential123456789";

export const POSTGRES_URL_WITH_PASSWORD =
  "postgres://admin:s3cretpw@db.example.com:5432/app";
export const HTTP_URL_WITH_USERINFO = "http://user:pass@127.0.0.1:4096/";

export const OPAQUE_ABCDEFGH = "abcdefgh1234567890";
export const OPAQUE_ABCDEFGHIJ = "abcdefghij1234567890";
export const CSRF_TOKEN_VALUE = "abcdef1234567890abcd";
export const CSRF_TOKEN_PREFIX = "abcdef1234567890";
export const BEARER_DASHED = "dGhpcy1pcy1hLXNlY3JldC10b2tlbg";
export const BASIC_DASHED_PADDED = "YWJjLWRlZi1naGk=";
export const HEADER_VALUE_OPAQUE = "syntheticapikey1234567890abcd";
export const PGPASSWORD_ASSIGNMENT = "PGPASSWORD=postgrespass123";
export const SKSYNTHETIC_KEY = "sksynthetic1234567890abcdef";
export const SKSYNTHETIC_KEY_LONG = "sksynthetic1234567890abcdef1234567890";
