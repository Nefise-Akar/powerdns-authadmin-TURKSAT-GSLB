## lib/gslb

Typed client for the PowerGSLB admin API (`POST <base>/admin/w2ui`, Basic Auth,
form-encoded). See ADR-0024.

This is a protocol adapter, like `lib/pdns`: RBAC, audit and DB writes happen
in the caller. `registry.ts` is the one sanctioned DB bridge (it loads a
`gslb_backends` row and decrypts the service-account password) and carries an
explicit lint exception.
