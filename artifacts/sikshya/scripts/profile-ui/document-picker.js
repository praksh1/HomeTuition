export async function getDocumentAsync() {
  if (window.testIdentitySelected) return { canceled: false, assets: [{ uri: "test://not-an-identity-document", name: "synthetic-upload-fixture.pdf", mimeType: "application/pdf", size: 100 }] };
  return window.testPhotoSelected ? { canceled: false, assets: [{ uri: "test://photo", name: "profile.jpg", mimeType: "image/jpeg", size: 100 }] } : { canceled: true, assets: [] };
}
