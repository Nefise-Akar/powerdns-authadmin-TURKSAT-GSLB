/**
 * lib/validators/gslb-region-rules.ts
 *
 * Parser + normalizer for GSLB region rule tokens - the strings that become a
 * PowerGSLB view `rule` (space-separated). Mirrors what PowerGSLB 2.4 accepts
 * (`view/rule.py`, `view/geoip.py`) so a bad token is rejected here with a
 * readable message instead of as PowerGSLB's generic "internal error".
 *
 * Accepted tokens:
 *   - IPv4 / IPv6 CIDR. A bare address is a host route (/32, /128). Host bits
 *     are ACCEPTED and cleared to the network address (`10.1.2.3/8` →
 *     `10.0.0.0/8`): PowerGSLB matches by containment, so host bits never
 *     change which clients match, and storing the canonical form keeps the
 *     drift check and PowerGSLB's unique-rule constraint meaningful.
 *   - `country:XX` - ISO 3166-1 alpha-2 (plus XK, which the GeoIP databases
 *     emit for Kosovo); case-insensitive, stored upper-case.
 *   - `continent:XX` - one of AF AN AS EU NA OC SA; stored upper-case.
 *
 * Rejected: a prefix-0 CIDR (`0.0.0.0/0`, `::/0`). PowerGSLB treats a rule
 * with prefix-0 in both families as the catch-all and serves its records only
 * when no specific view matched (README "Record selection"); that role belongs
 * to its `Public` view. A region is a specific site, so a match-all token is
 * always a mistake here.
 *
 * Dependency-free (no "server-only") so client code can share it.
 */

/** PowerGSLB stores `views.rule` as VARCHAR(255). */
export const MAX_GSLB_RULE_LENGTH = 255;

export const GSLB_CONTINENT_CODES: ReadonlySet<string> = new Set([
  "AF",
  "AN",
  "AS",
  "EU",
  "NA",
  "OC",
  "SA",
]);

/** Same set PowerGSLB 2.4.3 validates against (249 assigned codes + XK). */
export const GSLB_COUNTRY_CODES: ReadonlySet<string> = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS " +
    "BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE " +
    "EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
    "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC " +
    "LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA " +
    "NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO " +
    "TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK"
  ).split(" "),
);

export type RuleTokenResult = { ok: true; token: string } | { ok: false; error: string };

/**
 * Validate and canonicalize one token.
 *
 * @example
 *   normalizeRuleToken("10.1.2.3/8")     // { ok: true, token: "10.0.0.0/8" }
 *   normalizeRuleToken("country:tr")     // { ok: true, token: "country:TR" }
 *   normalizeRuleToken("2001:DB8::1/32") // { ok: true, token: "2001:db8::/32" }
 */
export function normalizeRuleToken(raw: string): RuleTokenResult {
  const input = raw.trim();
  if (input === "") return { ok: false, error: "Empty token." };

  const geo = /^(country|continent):(.*)$/i.exec(input);
  if (geo) {
    const kind = geo[1]!.toLowerCase();
    const code = geo[2]!.toUpperCase();
    const known = kind === "country" ? GSLB_COUNTRY_CODES : GSLB_CONTINENT_CODES;
    if (!known.has(code)) {
      return {
        ok: false,
        error:
          kind === "country"
            ? `'${input}' is not a known ISO 3166-1 alpha-2 country code.`
            : `'${input}' is not a continent code (AF, AN, AS, EU, NA, OC, SA).`,
      };
    }
    return { ok: true, token: `${kind}:${code}` };
  }

  return normalizeCidr(input);
}

/**
 * Validate a list of tokens: normalizes each, drops duplicates (after
 * normalization, keeping operator order) and enforces the joined length.
 * Returns every problem at once so the form can show them together.
 */
export function normalizeRuleTokens(
  raw: readonly string[],
): { ok: true; tokens: string[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const tokens: string[] = [];
  for (const item of raw) {
    if (item.trim() === "") continue;
    const result = normalizeRuleToken(item);
    if (!result.ok) errors.push(result.error);
    else if (!tokens.includes(result.token)) tokens.push(result.token);
  }
  if (errors.length > 0) return { ok: false, errors };
  if (tokens.length === 0) return { ok: false, errors: ["Add at least one rule."] };
  const joined = tokens.join(" ");
  if (joined.length > MAX_GSLB_RULE_LENGTH) {
    return {
      ok: false,
      errors: [
        `Rules are too long for PowerGSLB (${joined.length} of ${MAX_GSLB_RULE_LENGTH} characters). Merge ranges into wider CIDRs.`,
      ],
    };
  }
  return { ok: true, tokens };
}

/**
 * Canonical comparison form for a PowerGSLB rule string: whitespace-collapsed
 * and case-folded (geo tokens are case-insensitive there, and hex digits of
 * IPv6 are too). Used by the drift check against hand-edited remote rules.
 */
export function canonicalRule(rule: string): string {
  return rule.trim().split(/\s+/).join(" ").toLowerCase();
}

/**
 * Validate and canonicalize a single IP address (no prefix). Shared with the
 * GSLB record members, whose content must be a plain address.
 *
 * @example normalizeIpAddress("2001:DB8:0::1") // { family: 6, address: "2001:db8::1" }
 */
export function normalizeIpAddress(text: string): { family: 4 | 6; address: string } | null {
  const input = text.trim();
  const v4 = parseIpv4(input);
  if (v4 !== null) return { family: 4, address: formatIpv4(v4) };
  const v6 = parseIpv6(input);
  if (v6 !== null) return { family: 6, address: formatIpv6(v6) };
  return null;
}

/**
 * The region whose CIDR rules contain `address`, longest prefix first (so a
 * /24 office range beats a /16 campus range). Geo tokens are ignored - an IP
 * alone can't be placed in a country without GeoIP. On equal prefixes the
 * earlier region wins. Used to pre-select a member's region in the forms.
 *
 * @example regionForAddress("10.20.1.5", [{ slug: "a", rules: ["10.20.0.0/16"] }]) // "a"
 */
export function regionForAddress(
  address: string,
  regions: ReadonlyArray<{ slug: string; rules: readonly string[] }>,
): string | null {
  const input = address.trim();
  const v4 = parseIpv4(input);
  const v6 = v4 === null ? parseIpv6(input) : null;
  if (v4 === null && v6 === null) return null;
  const value = (v4 ?? v6)!;
  const bits = v4 !== null ? 32 : 128;

  let best: { slug: string; prefix: number } | null = null;
  for (const region of regions) {
    for (const rule of region.rules) {
      const slash = rule.indexOf("/");
      if (slash === -1) continue;
      const network =
        bits === 32 ? parseIpv4(rule.slice(0, slash)) : parseIpv6(rule.slice(0, slash));
      if (network === null) continue;
      const prefix = Number(rule.slice(slash + 1));
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) continue;
      const hostBits = BigInt(bits - prefix);
      if (value >> hostBits !== network >> hostBits) continue;
      if (!best || prefix > best.prefix) best = { slug: region.slug, prefix };
    }
  }
  return best?.slug ?? null;
}

// =============================================================================
// CIDR
// =============================================================================

const TOKEN_FORMATS_HINT = "Use a CIDR (10.0.0.0/8, 2001:db8::/32), country:XX or continent:XX.";

function normalizeCidr(input: string): RuleTokenResult {
  const slash = input.indexOf("/");
  const addressPart = slash === -1 ? input : input.slice(0, slash);
  const prefixPart = slash === -1 ? null : input.slice(slash + 1);

  const v4 = parseIpv4(addressPart);
  const v6 = v4 === null ? parseIpv6(addressPart) : null;
  if (v4 === null && v6 === null) {
    return { ok: false, error: `'${input}' is not a valid rule. ${TOKEN_FORMATS_HINT}` };
  }
  const bits = v4 !== null ? 32 : 128;

  let prefix = bits;
  if (prefixPart !== null) {
    if (!/^\d{1,3}$/.test(prefixPart) || Number(prefixPart) > bits) {
      return { ok: false, error: `'${input}' has an invalid prefix length (0-${bits}).` };
    }
    prefix = Number(prefixPart);
  }
  if (prefix === 0) {
    return {
      ok: false,
      error: `'${input}' matches every client. PowerGSLB reserves match-all rules for its catch-all (Public) view; a region must be a specific site.`,
    };
  }

  const value = (v4 ?? v6)!;
  const hostBits = BigInt(bits - prefix);
  const network = (value >> hostBits) << hostBits;
  const formatted = v4 !== null ? formatIpv4(network) : formatIpv6(network);
  return { ok: true, token: `${formatted}/${prefix}` };
}

function parseIpv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    // No leading zeros: `010` is octal to some parsers and decimal to others.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6(text: string): bigint | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text) || text.length > 45) return null;

  let groups: string[];
  const doubleColon = text.indexOf("::");
  if (doubleColon !== -1) {
    if (text.slice(doubleColon + 1).includes("::")) return null;
    const head = text.slice(0, doubleColon);
    const tail = text.slice(doubleColon + 2);
    const headGroups = head === "" ? [] : head.split(":");
    const tailGroups = tail === "" ? [] : tail.split(":");
    const embedded = tailGroups.at(-1)?.includes(".") ? 2 : 0;
    const missing = 8 - headGroups.length - tailGroups.length - (embedded ? 1 : 0);
    if (missing < 1) return null;
    groups = [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
  } else {
    groups = text.split(":");
  }

  const last = groups.at(-1);
  if (last?.includes(".")) {
    const v4 = parseIpv4(last);
    if (v4 === null) return null;
    groups = [
      ...groups.slice(0, -1),
      ((v4 >> 16n) & 0xffffn).toString(16),
      (v4 & 0xffffn).toString(16),
    ];
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => ((value >> shift) & 0xffn).toString()).join(".");
}

/** RFC 5952: lower-case, no leading zeros, longest zero run (≥2 groups) as `::`. */
function formatIpv6(value: bigint): string {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));

  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }

  const hex = groups.map((g) => g.toString(16));
  if (bestLength < 2) return hex.join(":");
  const head = hex.slice(0, bestStart).join(":");
  const tail = hex.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
}
