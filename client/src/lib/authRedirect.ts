/** Always redirect auth emails back to wherever the app is running (localhost or production). */
export function getAuthRedirectUrl(): string {
  return window.location.origin;
}
