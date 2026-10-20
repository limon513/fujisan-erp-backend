/** What can be uploaded: detected from the file's bytes, never from its name. */
export const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const FILE_CATEGORIES = ["LAYOUT", "PHOTO", "NID", "DOCUMENT", "AGREEMENT", "DEED", "OTHER"];

export const fileSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  width: true,
  height: true,
  category: true,
  entityType: true,
  entityId: true,
  version: true,
  uploadedById: true,
  createdAt: true,
};
