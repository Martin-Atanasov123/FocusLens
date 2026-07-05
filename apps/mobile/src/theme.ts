// Dark "premium blocker" palette (Opal-inspired): near-black surfaces with a
// green tint, mint accent used for glows, borders and CTAs. Key names are kept
// from the old warm palette so screens don't need import changes — `amber` is
// simply the accent slot.
export const C = {
  bg: "#070A08", // near-black with a green undertone (matches Opal refs)
  surf: "#141A16",
  surf2: "#1E2521",
  border: "rgba(255,255,255,0.08)",
  ink: "#F2F6F3",
  ink2: "rgba(242,246,243,0.64)",
  ink3: "rgba(242,246,243,0.40)",
  amber: "#A9EEC8", // accent (mint) — dark text on top, see onAccent
  green: "#7DE8A9",
  red: "#F08573",

  // Extra tokens for the dark design
  onAccent: "#08130C", // text/icons placed on mint backgrounds
  glass: "rgba(255,255,255,0.05)", // translucent card fill
  glassHi: "rgba(255,255,255,0.09)",
  glow: "rgba(169,238,200,0.32)", // mint glow (shadows, halos)
  glowFaint: "rgba(169,238,200,0.10)", // radial card tint
  navBg: "#141917", // bottom pill nav
  flame: "#F5B96B", // streak / warning accent
};

// Shared gradient stops for mint CTA buttons (use with expo-linear-gradient,
// horizontal: start {x:0,y:0} → end {x:1,y:0}).
export const CTA_GRADIENT = [
  "rgba(169,238,200,0.16)",
  "rgba(169,238,200,0.55)",
] as const;
