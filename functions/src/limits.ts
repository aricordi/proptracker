// "Too many requests" / "quota" / "busy" answers from Gemini or Google Drive.
// The import waits and retries these instead of marking the photo as failed.
export const isRateLimit = (msg: string) =>
  /\b429\b|RESOURCE_EXHAUSTED|rate ?limit|rateLimitExceeded|userRateLimit|quota|Too Many Requests|\b503\b|UNAVAILABLE|overloaded/i.test(msg)
