// Pure (no Firebase): shared by the server's AI helper and the app.
// Filming equipment (cameras, lights, sound…). The equipment team's gear isn't booked ahead (owner, Nov 3), so while
// that's off the AI never offers it as something to "make or find". Props that only LOOK like gear are fine as picks.
export const FILM_GEAR = /\b(cameras?|camcorders?|fx3|fx30|a7s|lens(es)?|tripods?|gimbals?|drones?|lights?|lighting|led panels?|softbox(es)?|ring ?lights?|mics?|microphones?|lav(alier)?s?|boom (mic|pole)s?|audio|sound (kit|gear)|batter(y|ies)|chargers?|sd cards?|memory cards?|monitors?|c-?stands?|light stands?|reflectors?|diffusers?|camera rigs?|sliders?|filming gear|equipment)\b/i
export const isFilmGear = (name: string) => FILM_GEAR.test(name)

// Not props (owner, Nov 4: "don't suggest dumb things like batteries or cables"): the arts team's "Tech props" category
// (id 'gear') and supplies are never offered by the AI, nor anything that's a battery, cable, charger or adapter.
export const NOT_A_PROP = /\b(batter(y|ies)|cables?|cords?|chargers?|charging|adapters?|power ?banks?|extension cords?|power strips?|power bars?|hdmi|usb|dongles?|sd cards?|memory cards?|(duct|gaffer|painter'?s?|masking|scotch|electrical) tape|zip ?ties?)\b/i
export function aiSkips(it: { categoryId?: unknown; name?: unknown; tags?: unknown } | undefined): boolean {
  if (!it) return true
  if (it.categoryId === 'gear') return true
  if (Array.isArray(it.tags) && it.tags.some(t => String(t).toLowerCase() === 'supplies')) return true
  return NOT_A_PROP.test(String(it.name ?? ''))
}
