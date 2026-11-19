import { describe, expect, it } from "vitest";
import {
  calculateProfit,
  demoInputs,
  exportTemplate,
  importTemplate,
  type Inputs,
} from "./profitCalculator";

const golden: Inputs = {
  price: "100",
  packQuantity: "1",
  unitPrice: "20",
  unitQuantity: "1",
  inbound: "5",
  outbound: "8",
  packaging: "2",
  platform: "3",
  ad: "10",
  reserve: "0",
  refund: "20",
  residual: "50",
  returnShipping: "10",
  target: "30",
};

describe("Pinduoduo profit calculator", () => {
  it("matches the frozen Brand OS refund case and applies the entered platform fee", () => {
    expect(calculateProfit(golden).result?.outcome).toEqual({
      before: 5200,
      loss: 450,
      profit: 4750,
      margin: 4750,
      status: "passed",
    });
    expect(
      calculateProfit({ ...golden, platform: "0" }).result?.outcome.profit,
    ).toBe(5050);
  });

  it("requires refund assumptions when exposure is nonzero", () => {
    expect(
      calculateProfit({ ...golden, residual: "", returnShipping: "" }),
    ).toEqual({
      result: null,
      missing: ["residual", "returnShipping"],
      invalid: [],
    });
    expect(
      calculateProfit({
        ...golden,
        refund: "0",
        residual: "",
        returnShipping: "",
      }).result?.outcome.loss,
    ).toBe(0);
  });

  it("includes refunds in effective pricing thresholds and rounds toward safety", () => {
    const inputs = { ...golden, platform: "3", monthly: "1000" };
    const result = calculateProfit(inputs).result!;
    expect(result.breakEven).toBe(5104);
    expect(result.targetPrice).toBe(7389);
    expect(result.monthlyOrders).toBe("22");
    expect(
      calculateProfit({ ...inputs, price: "51.03" }).result?.outcome.status,
    ).toBe("loss");
    expect(
      calculateProfit({ ...inputs, price: "73.88" }).result?.outcome.status,
    ).toBe("below");
    expect(result.prices.find((item) => item.key === "goal")?.status).toBe(
      "passed",
    );
  });

  it("accounts for purchasing and refund coupling once when solving the pack price limit", () => {
    const inputs = {
      ...golden,
      platform: "0",
      packQuantity: "3",
      unitQuantity: "7",
    };
    expect(
      calculateProfit(inputs).result?.limits.find(
        (item) => item.key === "unitPrice",
      )?.upper,
    ).toBe(16045);
    expect(
      calculateProfit({ ...inputs, unitPrice: "160.45" }).result?.outcome
        .status,
    ).not.toBe("loss");
    expect(
      calculateProfit({ ...inputs, unitPrice: "160.46" }).result?.outcome
        .status,
    ).toBe("loss");
  });

  it("keeps fractional-cent pack allocations until the final half-up round", () => {
    const result = calculateProfit({
      ...golden,
      unitPrice: "0.01",
      inbound: "0.01",
      unitQuantity: "2",
      outbound: "0",
      platform: "0",
      packaging: "0",
      ad: "0",
      refund: "0",
    }).result!;
    expect(result.totalCost).toBe(1);
    expect(result.costs.slice(0, 2).map((item) => item.amount)).toEqual([1, 1]);
  });

  it("caps higher refunds and keeps the standard scenario identical to the headline", () => {
    const result = calculateProfit({ ...golden, refund: "80" }).result!;
    expect(result.refunds.map((item) => item.rate)).toEqual([
      10000, 8000, 5600,
    ]);
    expect(result.refunds.find((item) => item.key === "base")).toMatchObject(
      result.outcome,
    );
  });

  it("handles impossible thresholds and export/import", () => {
    const result = calculateProfit({
      ...golden,
      platform: "100",
      monthly: "200",
    }).result!;
    expect(result.breakEven).toBeNull();
    expect(result.targetPrice).toBeNull();
    expect(result.monthlyOrders).toBeNull();
    expect(importTemplate(exportTemplate(demoInputs))).toMatchObject({
      price: "39.9",
      target: "30",
    });
    expect(importTemplate("39.9,12,4.5,0.8,0.6,5,101,30")).toBeNull();
    expect(importTemplate("39.9\t12\t4.5\t0.8\t0.6\t5\t12\t")).toMatchObject({
      target: "",
    });
  });
});
