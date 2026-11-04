# Cloud architecture icon sets (#4)

The owner decided to bundle the vendors' cloud architecture icons in Freero's icon and shape
libraries, as built-in, read-only packs, wherever each vendor's terms allow it. This is what each
vendor's current terms say, read on **2026-11-04**, and what follows for Freero.

The question asked of each set: may a product bundle the icons in a shape library whose users
place them, unchanged, on their own diagrams (not as logos, not as the product's branding), and
what notice does it owe?

| Set | Terms read | Key sentence | Verdict | Notice owed |
|---|---|---|---|---|
| AWS Architecture Icons | https://aws.amazon.com/architecture/icons/ (package `Icon-package_07312026`) | "We allow customers and partners to use these toolkits and assets to create architecture diagrams." | **Bundle.** | AWS's copyright and trademarks; no endorsement implied |
| Azure architecture icons | https://learn.microsoft.com/en-us/azure/architecture/icons/ (page dated 2026-07-09, package `Azure_Public_Service_Icons_V24`, with its `Microsoft_Terms_of_Use.pdf` and `Azure_Icons_FAQ.pdf`) | "You can copy, distribute, and display the icons only for the permitted use" | **Bundle, for diagrams only.** | Microsoft's permitted use and don'ts; trademarks; label each icon |
| Kubernetes Icons Set | https://github.com/kubernetes/community/tree/master/icons (README, commit `812ca4f1`) | "licensed under a choice of either Apache-2.0 or CC-BY-4.0" | **Bundle.** | CC BY 4.0 attribution: credit, licence link, changes made |
| Google Cloud icons | https://cloud.google.com/icons and its guide `google-cloud-product-icons.pdf` (May 2026) | "Here you can find the Google Cloud product icons you need for your diagrams, technical documentation, and more." | **Don't bundle.** | — |

## AWS

The icons page grants use for architecture diagrams to "customers and partners" and says "You can
build diagrams with preexisting libraries on third-party tools", which is what a whiteboard's
shape library is. The page has no FAQ, no modification or redistribution clause and no licence
file in the package; the copyright line reserves all other rights. So Freero takes the narrow
reading: the icons are offered only as icons people place on their own architecture diagrams,
unchanged, never as Freero's branding and never suggesting AWS endorses Freero. The package's group
icons that carry the AWS logo (`AWS-Cloud-logo_*`) are left out: a logo is a trademark, not a
diagram icon, and AWS's trademark guidelines govern it. The library shows AWS's copyright and
trademark notice beside the set. **Residual risk:** the grant is informal; if AWS asks, the set
is removed by deleting it from `CLOUD_ICON_SETS` and regenerating.

## Azure

Microsoft's terms are explicit: the icons may be used "in architectural diagrams, training
materials, or documentation", and copied, distributed and displayed only for that use. A shape
library for drawing architecture diagrams distributes them for that use. The page's and the FAQ's
don'ts apply to the icons as people use them: don't crop, flip, rotate, distort or change an icon's
shape; don't use one to represent your own product or service; label each icon with the service's
full name. Freero repeats these in the library's notice, keeps the icons' proportions (icons
resize with their aspect locked) and never recolours them. **One deviation:** Freero's icon format
(the primitives `sanitizeSvg` keeps, for security) has no gradients, so each gradient is drawn in
its middle colour; shapes are unchanged. The notice says so. If Microsoft objects, the set goes
the same way as AWS's; drawing gradients exactly would need gradient support in `IconNode`.

## Kubernetes

The Kubernetes Icons Set is under Apache-2.0 or CC BY 4.0, at the user's choice; Freero takes
CC BY 4.0: credit the Kubernetes Authors, link the licence, say what changed (converted to
Freero's icon format; the control-plane icons exist only labeled, and their text labels, which
aren't drawing primitives, drop out; the rest are the unlabeled versions). The Kubernetes logo is
not part of the set and isn't bundled; "Kubernetes" is a Linux Foundation trademark.

## Google Cloud

Neither the icon page nor its guide grants any licence: the page offers the icons "for your
diagrams, technical documentation, and more", and the guide's pages are marked "Proprietary &
Confidential". Google's brand resources require an application and approval. Without a grant to
copy or redistribute, a product may not ship them. (An older Google deck said the logos "may be
used freely and without permission" to reference Google's technology; that wording isn't in the
current terms and covers using them in a diagram, not repackaging them.) Freero does not bundle
them; people can download them from Google and upload them as their own shape pack, as before.
`scripts/license-check.mjs` fails if a Google Cloud set appears.

## How the sets are built

`npm run icons:cloud` (`scripts/cloud-icons.mjs`) finds each set's current package on its official
page (AWS's and Azure's file names change with each release), downloads it into a new, empty
temporary directory, and reads it in memory: nothing is extracted, run or trusted. Every SVG goes
through `sanitizeSvg` with `keepColours` (one-colour icons keep their colour instead of becoming
recolourable). The result, per set, is `apps/web/src/features/icons/lib/cloud/<set>.json`, plus
`manifest.json` (package URL, version, SHA-256, date, licence, icon count), which
`scripts/license-check.mjs` reads. What each set takes:

- **AWS:** the service icons at 64 px (one drawing per service), the resource icons (light
  versions), the category icons at 64 px and the group icons (without the logo ones, light only).
- **Azure:** every service icon; one copy of an icon filed under several categories.
- **Kubernetes:** the unlabeled resource and infrastructure icons, and the control-plane icons.

In the app, `features/icons/lib/cloudPacks.ts` imports each set with its own `import()` (one chunk
per set, never in the board bundle; `cloudIcons.test.ts` checks it with a real build) the first
time the library shows it or searches everything. The source picker lists "Cloud architecture
icons" and each set; the shape library links to each set, carrying its search. A placed cloud icon
is an ordinary `icon` element with `art: 'color'` (never recoloured), holding its own drawing.

## When to look again

Each time the sets are regenerated: re-read the four pages above, update this file's date and
quotes if they changed, and the notices in `THIRD_PARTY_NOTICES.md` and the library
(`cloudNotice*` in `features/icons/locales`).
