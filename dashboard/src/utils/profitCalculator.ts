export const engineVersion = "pdd-profit-1";
export const fieldGroups = {
  sale: ["price", "target"],
  sourcing: ["unitPrice", "outbound", "packaging"],
  pack: ["packQuantity", "unitQuantity", "inbound"],
  fees: ["platform", "ad", "insurance", "reserve"],
  returns: ["refund", "residual", "returnShipping"],
  overhead: ["monthly"],
} as const;
export type InputKey = (typeof fieldGroups)[keyof typeof fieldGroups][number];
export type Inputs = Partial<Record<InputKey, string>>;
export const startInputs: Inputs = {
  target: "30",
  packQuantity: "1",
  unitQuantity: "1",
};
export const storeFields = [
  "target",
  "outbound",
  "packaging",
  "platform",
  "ad",
  "insurance",
  "reserve",
  "refund",
  "residual",
  "returnShipping",
  "monthly",
] as const;
export const templateFields = [
  "price",
  "unitPrice",
  "outbound",
  "packaging",
  "platform",
  "ad",
  "refund",
  "target",
] as const;
const percentFields = ["target", "platform", "refund", "residual"];
const quantityFields = ["packQuantity", "unitQuantity"];

export function fieldUnit(key: InputKey) {
  if (percentFields.includes(key)) return "%";
  if (quantityFields.includes(key)) return "quantity";
  return "¥";
}

export function isValidInput(key: InputKey, value: string) {
  if (quantityFields.includes(key)) return /^[1-9][0-9]{0,3}$/.test(value);
  if (!/^[0-9]{1,8}(\.[0-9]{1,2})?$/.test(value)) return false;
  if (key !== "monthly" && Number(value) >= 100000) return false;
  if (key === "price") return Number(value) > 0;
  return !percentFields.includes(key) || Number(value) <= 100;
}

export const demoInputs: Inputs = {
  ...startInputs,
  price: "39.9",
  unitPrice: "12",
  outbound: "4.5",
  packaging: "0.8",
  platform: "0.6",
  ad: "5",
  refund: "12",
  residual: "50",
  returnShipping: "5",
  insurance: "0.6",
  monthly: "1800",
};

const BPS = 10000n;
const scaled = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};

function rounded(numerator: bigint, denominator: bigint): number {
  const absolute = numerator < 0n ? -numerator : numerator;
  const value = Number((2n * absolute + denominator) / (2n * denominator));
  return numerator < 0n && value ? -value : value;
}

function floorRatio(numerator: bigint, denominator: bigint): bigint {
  return numerator / denominator - (numerator % denominator < 0n ? 1n : 0n);
}

function ceilRatio(numerator: bigint, denominator: bigint): bigint {
  return -floorRatio(-numerator, denominator);
}

type Status = "loss" | "even" | "below" | "passed";
interface Outcome {
  before: number;
  loss: number;
  profit: number;
  margin: number;
  status: Status;
}
type LimitKey = "outbound" | "ad" | "adShare" | "unitPrice" | "refund";
type PriceKey = "lower" | "current" | "higher" | "goal";
type RefundKey = "conservative" | "base" | "optimistic";
type CostKey =
  | "purchase"
  | "inbound"
  | "outbound"
  | "packaging"
  | "insurance"
  | "reserve"
  | "platform"
  | "ad"
  | "refundLoss";

export interface ProfitResult {
  outcome: Outcome;
  totalCost: number;
  breakEven: number | null;
  targetPrice: number | null;
  monthlyOrders: string | null;
  costs: {
    key: CostKey;
    amount: number;
    costShare: number;
    saleShare: number;
  }[];
  limits: {
    key: LimitKey;
    current: number;
    upper: number | null;
    state: "ok" | "edge" | "over";
  }[];
  prices: (Outcome & { key: PriceKey; price: number })[];
  refunds: (Outcome & { key: RefundKey; rate: number })[];
}

interface Calculation {
  result: ProfitResult | null;
  missing: InputKey[];
  invalid: InputKey[];
}

export function calculateProfit(inputs: Inputs): Calculation {
  const required: InputKey[] = [
    "price",
    "target",
    "unitPrice",
    "outbound",
    "packaging",
    "packQuantity",
    "unitQuantity",
    "platform",
    "ad",
    "refund",
  ];
  if (Number(inputs.refund) > 0) required.push("residual", "returnShipping");
  const keys = Object.values(fieldGroups).flat();
  const missing = required.filter((key) => !inputs[key]);
  const invalid = keys.filter(
    (key) => !!inputs[key] && !isValidInput(key, inputs[key]!),
  );
  if (missing.length || invalid.length)
    return { result: null, missing, invalid };

  const value = (key: InputKey) => scaled(inputs[key] || "0");
  const pack = BigInt(inputs.packQuantity!);
  const unit = BigInt(inputs.unitQuantity!);
  const price = value("price");
  const fee = value("platform");
  const target = value("target");
  const refund = value("refund");
  const residual = value("residual");

  // One exact denominator keeps pack allocations and both refund ratios unrounded
  // until the final display. Price thresholds round upward, spending limits downward.
  const denominator = unit * BPS * BPS;
  const allocated = pack * BPS * BPS;
  const purchase = value("unitPrice") * allocated;
  const inbound = value("inbound") * allocated;
  const outbound = value("outbound") * denominator;
  const packaging = value("packaging") * denominator;
  const insurance = value("insurance") * denominator;
  const reserve = value("reserve") * denominator;
  const ad = value("ad") * denominator;
  const nonRate =
    purchase + inbound + outbound + packaging + insurance + reserve + ad;
  const exposure =
    value("returnShipping") * unit * BPS +
    ((purchase + inbound) / BPS / BPS) * (BPS - residual);
  const loss = exposure * refund;
  const platformAt = (sale: bigint) => sale * fee * unit * BPS;

  function outcome(
    sale: bigint,
    refundLoss: bigint,
    refundScale = 1n,
  ): Outcome {
    const before = sale * denominator - nonRate - platformAt(sale);
    const net = before * refundScale - refundLoss;
    const resultDenominator = denominator * refundScale;
    const marginDenominator = sale * resultDenominator;
    const profit = rounded(net, resultDenominator);
    const status =
      net < 0n
        ? "loss"
        : net === 0n
        ? "even"
        : net * BPS >= target * marginDenominator
        ? "passed"
        : "below";
    return {
      before: rounded(before, denominator),
      loss: rounded(refundLoss, resultDenominator),
      profit,
      margin: rounded(net * BPS, marginDenominator),
      status,
    };
  }

  const platform = platformAt(price);
  const total = nonRate + platform + loss;
  const net = price * denominator - total;
  function threshold(margin: bigint): number | null {
    const afterRates = BPS - fee - margin;
    if (afterRates <= 0n)
      return afterRates === 0n && nonRate + loss === 0n ? 1 : null;
    return Math.max(
      1,
      Number(ceilRatio(nonRate + loss, afterRates * unit * BPS)),
    );
  }
  const breakEven = threshold(0n);
  const targetPrice = threshold(target);
  const costs: [CostKey, bigint][] = [
    ["purchase", purchase],
    ["inbound", inbound],
    ["outbound", outbound],
    ["packaging", packaging],
    ["platform", platform],
    ["ad", ad],
    ["insurance", insurance],
    ["reserve", reserve],
    ["refundLoss", loss],
  ];

  // A higher supplier pack price raises both allocated purchase cost and refund losses.
  const unitPriceImpact = pack * (BPS * BPS + refund * (BPS - residual));
  const rawLimits: [LimitKey, bigint, bigint, bigint, bigint?][] = [
    ["outbound", value("outbound"), net + outbound, denominator],
    ["ad", value("ad"), net + ad, denominator],
    [
      "adShare",
      ad * BPS,
      (net + ad) * BPS,
      price * denominator,
      price * denominator,
    ],
    [
      "unitPrice",
      value("unitPrice"),
      net + value("unitPrice") * unitPriceImpact,
      unitPriceImpact,
    ],
    ["refund", refund, net + loss, exposure],
  ];
  const limits: ProfitResult["limits"] = rawLimits.map(
    ([key, current, budget, impact, currentDenominator = 1n]) => {
      let upper = impact === 0n ? null : floorRatio(budget, impact);
      if (key === "refund" && (upper === null || upper > BPS))
        upper = budget >= 0n ? BPS : -1n;
      return {
        key,
        current: rounded(current, currentDenominator),
        upper: upper === null || upper < 0n ? null : Number(upper),
        state: net < 0n ? "over" : net === 0n ? "edge" : "ok",
      };
    },
  );

  const priceOptions: [PriceKey, bigint][] = [];
  if (price > 100n) priceOptions.push(["lower", price - 100n]);
  priceOptions.push(["current", price], ["higher", price + 100n]);
  if (targetPrice !== null) priceOptions.push(["goal", BigInt(targetPrice)]);

  const refundOptions: [RefundKey, bigint][] = [
    ["conservative", (refund * 3n > BPS * 2n ? BPS * 2n : refund * 3n) * 5n],
    ["base", refund * 10n],
    ["optimistic", refund * 7n],
  ];
  return {
    missing: [],
    invalid: [],
    result: {
      outcome: outcome(price, loss),
      totalCost: rounded(total, denominator),
      breakEven,
      targetPrice,
      monthlyOrders:
        inputs.monthly && net > 0n
          ? String(ceilRatio(value("monthly") * denominator, net))
          : null,
      costs: costs.map(([key, amount]) => ({
        key,
        amount: rounded(amount, denominator),
        costShare: total === 0n ? 0 : rounded(amount * BPS, total),
        saleShare: rounded(amount * BPS, price * denominator),
      })),
      limits,
      prices: priceOptions.map(([key, sale]) => ({
        key,
        price: Number(sale),
        ...outcome(sale, loss),
      })),
      refunds: refundOptions.map(([key, rate]) => ({
        key,
        rate: rounded(rate, 10n),
        ...outcome(price, exposure * rate, 10n),
      })),
    },
  };
}

export function importTemplate(text: string): Inputs | null {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines[0] === templateFields.join(",")) lines.shift();
  if (lines.length !== 1) return null;
  const fields = lines[0]
    .split(/[,，\t]/)
    .map((part) => part.trim().replace(/%$/, ""));
  if (fields.length !== templateFields.length) return null;
  const entries = templateFields.map(
    (key, index) => [key, fields[index]] as const,
  );
  return entries.every(([key, value]) => !value || isValidInput(key, value))
    ? Object.fromEntries(entries)
    : null;
}

export function exportTemplate(inputs: Inputs): string {
  return (
    templateFields.join(",") +
    "\n" +
    templateFields.map((key) => inputs[key] ?? "").join(",") +
    "\n"
  );
}
