// Apps that open links in their own built-in browser, where Google refuses to sign anyone in
// (owner report Oct 15: an invited person tapped "Sign in with Google" and nothing happened).
export function inAppBrowser(ua: string): string | null {
  const apps: [RegExp, string][] = [
    [/Instagram/i, 'Instagram'], [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'], [/Messenger/i, 'Messenger'],
    [/Snapchat/i, 'Snapchat'], [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'], [/LinkedInApp/i, 'LinkedIn'],
    [/GSA\//i, 'the Google app'], [/Line\//i, 'LINE'], [/Twitter|XApp/i, 'X'], [/Pinterest/i, 'Pinterest'],
    [/; wv\)/i, 'an app'],
  ]
  for (const [re, name] of apps) if (re.test(ua)) return name
  return null
}
