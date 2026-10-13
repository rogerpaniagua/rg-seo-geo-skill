# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository. Include the exact command or file that triggers it and
what you observed. You will get an answer as soon as possible.

## Scope

This tool fetches URLs it does not control, parses documents written by strangers, serves a local folder (`--build`)
and writes reports that people and AI agents read. The things that matter most:

- SSRF: reaching private, loopback, link-local or metadata addresses, or any origin other than the one being audited.
- Denial of service: inputs that hang, crash or exhaust memory (parsers, decompression, huge sitemaps).
- Escaping the `--build` folder, or reading it from a web page (DNS rebinding).
- Injection through text quoted from an audited site into HTML, Markdown, JSON or terminal output, including text aimed
  at an AI agent that reads the report.
- Writing or reading outside the intended files (`--out`, `--compare`, `--src` symlinks).

## What is already covered

The threat model above has been attacked on purpose. Every confirmed finding is a regression test, see
[`test/security.test.mjs`](test/security.test.mjs) and [`test/security2.test.mjs`](test/security2.test.mjs), and the
"Security" section of the README lists the defences and the known limits.

## Supported versions

Only the latest release on `main`.
