/**
 * Profile field key constants matching the frontend domain profile system.
 *
 * These mirror the keys used in:
 *   - frontend-vite-react/src/types/domain.ts          (DomainProfile interface)
 *   - frontend-vite-react/src/constants/profile-presets.ts (PROFILE_PRESET_FIELDS)
 *   - frontend-vite-react/src/utils/social-links.ts    (SOCIAL_PLATFORMS)
 *   - frontend-vite-react/src/components/domain/AddMultipleFieldsForm.tsx (COMMON_FIELDS)
 *   - frontend-vite-react/src/hooks/useDomainOperations.ts (buildInitialFields)
 */

// ─── Base Profile Fields ────────────────────────────────────────────────────
// Always available on the registration form
export const FIELD_NAME = "name";
export const FIELD_BIO = "bio";
export const FIELD_AVATAR = "avatar";
export const FIELD_WEBSITE = "website";
export const FIELD_TWITTER = "twitter";
export const FIELD_GITHUB = "github";

// ─── System / Auto-populated Fields ─────────────────────────────────────────
export const FIELD_PROFILE_TYPE = "profile_type";
export const FIELD_EPK = "epk"; // encryption public key (from wallet)

// ─── Social Platforms ───────────────────────────────────────────────────────
export const FIELD_DISCORD = "discord";
export const FIELD_DISCORD_ID = "discord_id";
export const FIELD_DISCORD_VERIFY = "discord_verify";
export const FIELD_TELEGRAM = "telegram";
export const FIELD_TWITCH = "twitch";
export const FIELD_YOUTUBE = "youtube";
export const FIELD_INSTAGRAM = "instagram";
export const FIELD_TIKTOK = "tiktok";
export const FIELD_EMAIL = "email";

// ─── Extended Profile Fields ────────────────────────────────────────────────
export const FIELD_TICKER = "ticker";
export const FIELD_LOCATION = "location";
export const FIELD_PLATFORM = "platform";
export const FIELD_BANNER = "banner";
export const FIELD_DESCRIPTION = "description"; // alias for bio

// ─── Profile Types ──────────────────────────────────────────────────────────
export type ProfileType = "personal" | "dao" | "company" | "game" | "creator";

export const PROFILE_TYPES: readonly ProfileType[] = [
  "personal",
  "dao",
  "company",
  "game",
  "creator",
] as const;

// ─── Helpers for building field arrays ──────────────────────────────────────

/** Build a personal profile field set */
export function personalFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  email?: string;
  telegram?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "personal" }, extra);
}

/** Build a DAO profile field set */
export function daoFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  ticker?: string;
  discord?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "dao" }, extra);
}

/** Build a company profile field set */
export function companyFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  email?: string;
  location?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "company" }, extra);
}

/** Build a game profile field set */
export function gameFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  platform?: string;
  discord?: string;
  twitch?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "game" }, extra);
}

/** Build a creator profile field set */
export function creatorFields(opts: {
  name: string;
  bio?: string;
  avatar?: string;
  website?: string;
  twitter?: string;
  github?: string;
  youtube?: string;
  instagram?: string;
  tiktok?: string;
}, extra?: [string, string][]): [string, string][] {
  return buildFields({ ...opts, [FIELD_PROFILE_TYPE]: "creator" }, extra);
}

/** Generic builder — filters out undefined/empty values, appends extras, enforces max 10 */
function buildFields(
  record: Record<string, string | undefined>,
  extra?: [string, string][],
): [string, string][] {
  const fields: [string, string][] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== "") {
      fields.push([key, value]);
    }
  }
  if (extra) {
    for (const pair of extra) {
      fields.push(pair);
    }
  }
  if (fields.length > 10) {
    throw new Error(`Too many fields (${fields.length}) — contract supports max 10`);
  }
  return fields;
}
