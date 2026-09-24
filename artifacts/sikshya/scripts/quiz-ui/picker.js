export async function getDocumentAsync() {
  return window.nextQuizFile ? { canceled: false, assets: [window.nextQuizFile] } : { canceled: true };
}
