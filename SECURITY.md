# Security policy

Freero is open-source software, and the hosted service at https://freero.app runs it (operated by
Kaiten Gaming LLC). This policy covers both. How the software and the hosted service protect data:
the [security overview](https://freero.app/security).

## Reporting a vulnerability

Email **security@freero.app** (the contact in https://freero.app/.well-known/security.txt). Please
don't open a public GitHub issue, pull request or discussion for a vulnerability.

Include what you can:

- what is affected (a URL, an API endpoint, an MCP tool, a file and line in this repository);
- the steps to reproduce it, with a proof of concept if you have one;
- what an attacker could do with it, and what access they would need;
- whether you have told anyone else, and how you would like to be credited.

## What happens next

- We acknowledge your report within 3 business days and tell you whether we can reproduce it.
- We keep you posted at least every 14 days until it is resolved.
- We fix confirmed issues in this repository and deploy the fix to the hosted service. The fix's
  commit says what it fixes once it is safe to say.
- We ask you to keep the issue private until a fix is out, or for 90 days from your report,
  whichever comes first; if we need longer, we will explain why and agree a date with you.
- We credit you in the fix's notes unless you prefer not to be named. There is no paid bug bounty.

## Scope

In scope:

- the code in this repository (server, web app, marketing site, MCP server, scripts, Docker image);
- the hosted service at https://freero.app.

Not in scope:

- other people's Freero servers: report to their operator (if the cause is in Freero's code, tell us
  too);
- the services the hosted service uses (its hosting, email, storage, DNS and analytics providers;
  see https://freero.app/subprocessors): report to them;
- denial of service, load or volume testing, spam, and social engineering or phishing of anyone;
- findings from automated scanners without a demonstrated impact, missing security headers or
  cookie flags without one, and self-XSS.

## Testing the hosted service safely

We will not pursue or ask anyone to pursue legal action against research that follows these rules,
done in good faith:

- use only accounts and boards you own, or that their owners have allowed you to test;
- never access, change or delete other people's data beyond the minimum needed to show the issue,
  and stop and tell us as soon as you reach any;
- don't degrade the service for others (no denial of service, no high-volume automated requests);
- don't keep data you came across, and delete it once the report is resolved.

If in doubt, write to security@freero.app first.

## Supported versions

Fixes go to the `main` branch and the hosted service. There are no maintained release branches: if
you run Freero yourself, update to the latest `main` (or the image built from it) to get fixes.
Operators of their own servers should set `SECURITY_CONTACT` so their `/.well-known/security.txt`
names their own contact ([docs/operations.md](docs/operations.md)).
