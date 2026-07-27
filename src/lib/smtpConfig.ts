/**
 * SMTP transport configuration helpers.
 *
 * Port and TLS mode must be resolved together. Deriving them separately is what
 * broke password reset in production: the env set SMTP_PORT=465 with no
 * SMTP_SECURE, so `secure` evaluated to false while the socket still connected
 * to 465. Port 465 is implicit TLS, so a plaintext connect there hangs until the
 * greeting times out and the mail is silently dropped.
 */

/** Port 465 is implicit TLS ("SMTPS") — the connection must start encrypted. */
const IMPLICIT_TLS_PORT = 465;

/** Submission port used when SMTP_PORT is unset or unparseable. */
const DEFAULT_SMTP_PORT = 587;

export interface SmtpTransportSecurity {
  port: number;
  secure: boolean;
}

/**
 * Resolve the SMTP port and TLS mode from env together, so they cannot diverge.
 *
 * `secure` is derived from the *parsed* port rather than a string compare: a
 * value like ' 465' or '0465' parses to 465 and would connect to the implicit
 * TLS port, but would not equal the string '465'.
 *
 * An explicit SMTP_SECURE=true still forces TLS on any port (e.g. a relay doing
 * implicit TLS somewhere other than 465).
 */
export function resolveSmtpTransportSecurity(
  portEnv: string | undefined = process.env.SMTP_PORT,
  secureEnv: string | undefined = process.env.SMTP_SECURE
): SmtpTransportSecurity {
  const parsed = Number.parseInt(portEnv ?? '', 10);
  const port = Number.isFinite(parsed) ? parsed : DEFAULT_SMTP_PORT;

  return {
    port,
    secure: secureEnv === 'true' || port === IMPLICIT_TLS_PORT,
  };
}
