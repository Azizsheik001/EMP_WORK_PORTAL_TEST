// Map common timezone abbreviations to IANA names.
// iOS 26+ (and other strict Intl implementations) reject abbreviations like "IST"
// and require canonical IANA identifiers.
const TZ_MAP = {
  IST: 'Asia/Kolkata',
  CST: 'America/Chicago',
  EST: 'America/New_York',
  PST: 'America/Los_Angeles',
  MST: 'America/Denver',
  CT: 'America/Chicago',
  ET: 'America/New_York',
  PT: 'America/Los_Angeles',
  GMT: 'Etc/GMT',
  UTC: 'Etc/UTC',
};

export function resolveTimezone(tz) {
  if (!tz) return 'Asia/Kolkata';
  const trimmed = String(tz).trim();
  if (!trimmed) return 'Asia/Kolkata';
  return TZ_MAP[trimmed.toUpperCase()] || trimmed;
}
