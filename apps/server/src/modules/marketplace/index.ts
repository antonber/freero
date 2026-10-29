// Public API of modules/marketplace [S2]: community listings of the Apps & agents page (#87).
// It owns the listings and their status; modules/moderation's operators decide (approve, reject,
// remove, restore, feature) and record each decision, then apply it here with `decideListing`.
export {
  // what people do (its routes)
  submitListing,
  listingFor,
  liveListings,
  // for modules/moderation
  decideListing,
  listingForModeration,
  listingsForReview,
  moderatedListings,
  reportableListing,
  type ListingDecision,
  // for modules/privacy (the person's data export)
  listingsExportOf,
} from './service';
