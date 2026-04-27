# Rogue Hero 4 Enhancement Roadmap

## Visual Identity

- Build a brighter neon-arcane look: saturated biome accents, additive glow, animated glyph lines, screen-space energy motes, and stronger hit flashes.
- Give each biome a visual rule: Verdant = pollen and growth arcs, Frostforge = crystalline shards, Cathedral = ash and ember bloom, Tide = ripple distortion, Voidline = chromatic drift, Clockwork = brass ticks and steam trails.
- Make tempo states visually loud: Cold gets crisp blue afterimages, Flow gets clean green trails, Hot gets amber sparks, Critical gets red/violet bloom and edge instability.

## Attacks and Animations

- Upgrade existing card attacks with unique Pixi VFX before changing balance: slash crescents, projectile trails, impact rings, sigil pulses, trap arming animations, and screen-space shock lines.
- Add new attack families once visual hooks are stable: chain lightning, orbiting blades, prism beams, gravity wells, ricochet arcs, frost lances, ember mines, and clockwork saws.
- Keep attack readability strict: every high-damage move needs a clear windup, travel path, impact, and fade.

## Enemies

- Refresh enemy silhouettes with Pixi shapes and sprite-like animation: constructs unfold, beasts pounce, ethereal enemies shimmer, bosses deform or split during phases.
- Add enemies that exploit 4-player chaos: tether splitters, shield relays, projectile conductors, revive interrupters, tempo leeches, and arena-control wardens.
- Make bosses more theatrical with phase transition filters, arena tint shifts, animated UI warnings, and distinctive screen effects.

## Current Implemented Slice

- Rogue Hero 4 now has a Pixi overlay renderer above the legacy Canvas scene.
- The overlay adds animated ambient motes, energy ribbons, soft scanlines, vignette, and chromatic edge flashes.
- This gives the project an immediate new visual layer while keeping gameplay, tests, and multiplayer behavior unchanged.
