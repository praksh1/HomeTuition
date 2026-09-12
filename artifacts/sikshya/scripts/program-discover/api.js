// These fixtures have no active test pilot. A request here is a regression, not a
// reason to send synthetic UI-test data to an external API.
export async function apiGet() { throw new Error("Unexpected API request in discovery rendering fixture"); }
export const apiPost = apiGet;
