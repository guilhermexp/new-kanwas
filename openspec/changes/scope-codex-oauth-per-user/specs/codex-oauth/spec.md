# codex-oauth

## ADDED Requirements

### Requirement: Per-user Codex credential isolation

The system SHALL store each user's Codex OAuth credential in a location keyed by
the authenticated user's id, so that one user's credential is never readable,
usable, or removable by another user. The credential SHALL NOT be stored at a
single instance-global path shared across users and organizations.

#### Scenario: Two users hold independent credentials

- **GIVEN** user A has completed the Codex device login
- **AND** user B has not connected Codex
- **WHEN** user B requests `GET /codex-auth/status`
- **THEN** the response reports `connected: false`
- **AND** user B's agent invocations do not use user A's credential

#### Scenario: One user cannot disconnect another user's credential

- **GIVEN** user A has a connected Codex credential
- **WHEN** user B calls `DELETE /codex-auth`
- **THEN** only user B's credential location is affected
- **AND** user A's credential remains intact and `connected: true` for user A

#### Scenario: Credential path is derived from the authenticated user

- **WHEN** the controller handles any `codex-auth` route
- **THEN** it passes the authenticated `user.id` to the service
- **AND** the service resolves the credential directory from that id

### Requirement: Per-user device-login session scoping

The system SHALL associate each in-progress device-login session with the user
who started it, and SHALL reject polling of a session by any other user.

#### Scenario: Polling another user's session is rejected

- **GIVEN** user A started a device login and received `sessionId` S
- **WHEN** user B polls `GET /codex-auth/:sessionId` with S
- **THEN** the request does not return user A's session state
- **AND** it is treated as a non-existent session for user B

#### Scenario: Expired session is cleaned up

- **GIVEN** a device-login session whose `expiresAt` has passed
- **WHEN** the owning user polls that session
- **THEN** the session is removed and an expiry error is returned

### Requirement: Agent invocation uses the invoking user's credential

The agent runtime SHALL run the Codex `app-server` with the `CODEX_HOME` of the
user who owns the invocation, and SHALL NOT fall back to a shared instance
credential.

#### Scenario: Engine resolves CODEX_HOME from the invoking user

- **WHEN** `CodexEngine` executes for an invocation owned by user A
- **THEN** the spawned `CodexProcessManager` uses user A's per-user `CODEX_HOME`

#### Scenario: Host credentials are not seeded into user homes

- **GIVEN** the operator host has a `~/.codex/auth.json`
- **WHEN** a per-user `CODEX_HOME` is prepared
- **THEN** the host credential is NOT copied into it
- **AND** a user without a completed device flow has no usable Codex credential

### Requirement: Atomic credential file write

The system SHALL write the Codex `auth.json` atomically, so that a crash during
write cannot leave the credential file missing or truncated.

#### Scenario: Write replaces the file in one atomic step

- **WHEN** the service persists exchanged tokens
- **THEN** it writes to a temp file with `0o600` mode
- **AND** atomically renames it over the destination `auth.json`
- **AND** never deletes the existing `auth.json` before the replacement is in place

### Requirement: Robust frontend device-login polling

The frontend SHALL stop polling once the device-login session expires and report
a clear error, and SHALL NOT reset the poll timer on unrelated parent re-renders.

#### Scenario: Polling stops at expiry

- **GIVEN** a started device login with a known `expiresAt`
- **WHEN** the current time passes `expiresAt`
- **THEN** the poll loop stops
- **AND** an expiry error message is shown to the user

#### Scenario: Parent re-render does not restart the timer

- **WHEN** the parent settings component re-renders while a poll is in progress
- **THEN** the existing poll interval is not torn down and recreated

#### Scenario: Verification links open safely

- **WHEN** the user opens any Codex verification URL in a new tab
- **THEN** the link is opened with `noopener,noreferrer`
