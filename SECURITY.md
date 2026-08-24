# Security policy

If you find a vulnerability in Inbase, please report it privately.

**Do not** open a public issue for a security report.

Use [GitHub private vulnerability reporting](https://github.com/jk-wd/inbase/security/advisories/new)
when it is available. Otherwise, email the maintainer through the address on
their GitHub profile.

Please include:

- A description of the issue
- Steps to reproduce, or a proof of concept if you have one
- Affected versions, if you know them

This project runs a local Vite server and applies patch files to a target
directory you choose. Treat that target as trusted input: do not point Inbase
at untrusted trees, and do not apply patches from untrusted sessions.
