# Third-party notices

Freero's own code is under the MIT licence (`LICENSE`). Some files in this repository are other
people's work under their own terms, which the MIT licence does not cover. Each is listed here
(or, for the self-hosted fonts, beside the files: `apps/web/src/ui/fonts/files/*.LICENSE.txt`,
`apps/web/src/engine/text/fonts/files/*.LICENSE.txt`). `npm run check:licenses` fails if a bundled
icon set has no section here.

## Cloud architecture icon sets (#4)

`apps/web/src/features/icons/lib/cloud/` holds the vendors' official cloud architecture icons,
drawn from each vendor's own download by `npm run icons:cloud` (`scripts/cloud-icons.mjs`; where
each came from, with the package's SHA-256: `manifest.json` there). Freero offers them in its icon
and shape libraries as built-in, read-only packs that people place on their own diagrams. Each
icon is converted to Freero's icon format (the SVG primitives an icon may draw, as for any
uploaded SVG) and otherwise not altered: never recoloured, cropped or reshaped. They are not
offered as, or used for, Freero's own branding. Why each vendor's terms allow this, quoted and
dated: `docs/design/cloud-icons.md`.

## AWS Architecture Icons

© Amazon Web Services, Inc. or its affiliates. All rights reserved. From the official AWS
Architecture Icons package, https://aws.amazon.com/architecture/icons/ — AWS allows customers and
partners to use these assets to create architecture diagrams. Amazon Web Services, AWS, the names
of AWS services and their icons are trademarks of Amazon.com, Inc. or its affiliates. Freero is not
affiliated with, sponsored or endorsed by AWS. Excluded: the group icons carrying the AWS logo.

## Azure architecture icons

© Microsoft Corporation. From the official Azure architecture icons package,
https://learn.microsoft.com/en-us/azure/architecture/icons/ — Microsoft permits the use of these
icons in architectural diagrams, training materials, or documentation, and their copying,
distribution and display only for that use; Microsoft reserves all other rights. Don't crop, flip,
rotate, distort or change an icon's shape, don't use one to represent your own product or service,
and label each with its service's full name. Freero draws each gradient in one colour (its icon
format has no gradients). Microsoft, Azure and the names of Azure services are trademarks of the
Microsoft group of companies. Freero is not affiliated with or endorsed by Microsoft.

## Kubernetes Icons Set

The Kubernetes Icons Set by The Kubernetes Authors,
https://github.com/kubernetes/community/tree/master/icons, licensed under a choice of Apache-2.0 or
CC BY 4.0; Freero uses it under the Creative Commons Attribution 4.0 International licence,
https://creativecommons.org/licenses/by/4.0/. Changes: converted to Freero's icon format; the
labeled control-plane icons' text labels are removed (the other icons are the unlabeled versions).
Kubernetes is a registered trademark of The Linux Foundation; use of it as a trademark is subject
to The Linux Foundation's Trademark Usage Guidelines, https://www.linuxfoundation.org/trademark-usage/.

## Not bundled: Google Cloud icons

Google's icon page (https://cloud.google.com/icons) offers its product icons "for your diagrams,
technical documentation, and more" but grants no licence to copy or redistribute them, so Freero
does not ship them. Anyone may download them from Google and upload them as their own shape pack.
