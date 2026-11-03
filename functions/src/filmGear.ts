// Pure (no Firebase): shared by the server's AI helper and the app.
// Filming equipment (cameras, lights, sound…). The equipment team's gear isn't booked ahead (owner, Nov 3), so while
// that's off the AI never offers it as something to "make or find". Props that only LOOK like gear are fine as picks.
export const FILM_GEAR = /\b(cameras?|camcorders?|fx3|fx30|a7s|lens(es)?|tripods?|gimbals?|drones?|lights?|lighting|led panels?|softbox(es)?|ring ?lights?|mics?|microphones?|lav(alier)?s?|boom (mic|pole)s?|audio|sound (kit|gear)|batter(y|ies)|chargers?|sd cards?|memory cards?|monitors?|c-?stands?|light stands?|reflectors?|diffusers?|camera rigs?|sliders?|filming gear|equipment)\b/i
export const isFilmGear = (name: string) => FILM_GEAR.test(name)
