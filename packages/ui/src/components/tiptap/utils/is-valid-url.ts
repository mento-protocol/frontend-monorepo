export function isValidUrl(url: string) {
  return /^https?:\/\/\S+$/.test(url);
}
