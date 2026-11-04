// Public API of modules/gallery [S2]: the community template gallery (#162). Routes are routes.ts;
// moderation decides what is public through these, the uploads sweep keeps the files templates
// use, and the data export carries a person's submissions.
export {
  reportableGalleryTemplate,
  galleryForModeration,
  moderatedGalleryTemplates,
  galleryForReview,
  decideGalleryTemplate,
  galleryExportOf,
  galleryUploadReferences,
  type GalleryDecision,
} from './service';
