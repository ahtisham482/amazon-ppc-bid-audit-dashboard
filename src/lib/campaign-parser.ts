export interface ParsedCampaign {
  productCode: string;
  adType: string;
  mode: string;
  matchType: string;
  strategy: string;
  raw: string;
  valid: boolean;
}

const FALLBACK = (name: string): ParsedCampaign => ({
  productCode: name,
  adType: "",
  mode: "",
  matchType: "",
  strategy: "",
  raw: name,
  valid: false,
});

export function parseCampaignName(name: string): ParsedCampaign {
  if (!name) return FALLBACK(name);
  const parts = name
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return FALLBACK(name);

  const productCode = parts[0];
  const adType = parts[1]; // "SP" | "SB"

  let mode = "";
  let matchType = "";
  let strategy = "";

  if (parts.length >= 3) {
    const p2 = parts[2];
    if (p2.toLowerCase() === "auto") {
      mode = "Auto";
      matchType = "Auto";
      strategy = parts[3] ?? "";
    } else {
      mode = p2; // "M" = Manual
      if (parts.length >= 4) {
        const p3 = parts[3];
        // "PT | Asin" spans two pipe-segments — merge them
        if (p3 === "PT" && parts[4]?.toLowerCase() === "asin") {
          matchType = "PT / Asin";
          strategy = parts[5] ?? "";
        } else {
          matchType = p3;
          strategy = parts[4] ?? "";
        }
      }
    }
  }

  return {
    productCode,
    adType,
    mode,
    matchType,
    strategy,
    raw: name,
    valid: true,
  };
}

export function matchTypeLabel(matchType: string): string {
  switch (matchType.toLowerCase()) {
    case "exact":
      return "Exact — precise keyword match";
    case "phrase":
      return "Phrase — keyword must appear in order";
    case "broad":
      return "Broad — widest keyword coverage";
    case "auto":
      return "Auto — Amazon chooses the targets";
    case "pt / asin":
    case "pt":
      return "Product targeting — specific ASINs or categories";
    default:
      return matchType;
  }
}
