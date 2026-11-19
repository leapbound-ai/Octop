import { request } from "../request";

export type Category = "electrical" | "textile" | "food_contact";
export type TermStatus = "found" | "ambiguous" | "absent";
export type Question = { id: string; label: string; ask: string; why: string };
export type Term = {
  id: string;
  status: TermStatus;
  value: string | null;
  quote: string | null;
  start: number | null;
  end: number | null;
  manual?: boolean;
};

export type TermReview = Pick<Term, "status" | "value">;

export type Reply = {
  reply_id: string;
  rfq_id: string;
  supplier_id: string;
  supplier_name: string;
  product_title: string;
  candidate_id: string;
  raw_text: string;
  terms: Term[] | null;
  created_at: number;
  parsed_at: number | null;
};

export type InquiryInput = {
  title: string;
  candidate_id: string;
  plan_price: string | null;
  monthly_qty: number | null;
  categories: Category[];
};
export type InquirySummary = InquiryInput & {
  rfq_id: string;
  supplier_count: number;
  parsed_count: number;
  archived: boolean;
  created_at: number;
  updated_at: number;
};
export type Inquiry = InquirySummary & {
  questions: Question[];
  replies: Reply[];
};

export type Supplier = {
  supplier_id: string;
  name: string;
  shop_url: string;
  last_contact: number | null;
  version_count: number;
};

const base = "/sourcing-rfq";
const rfqPath = (id: string) => base + "/rfqs/" + encodeURIComponent(id);

export const listInquiries = (signal?: AbortSignal) =>
  request<InquirySummary[]>(base + "/rfqs", { signal });
export const getInquiry = (id: string, signal?: AbortSignal) =>
  request<Inquiry>(rfqPath(id), { signal });
export const createInquiry = (body: InquiryInput) =>
  request<Inquiry>(base + "/rfqs", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const archiveInquiry = (id: string, archived: boolean) =>
  request<Inquiry>(rfqPath(id), {
    method: "PATCH",
    body: JSON.stringify({ archived }),
  });
export const listSuppliers = (signal?: AbortSignal) =>
  request<Supplier[]>(base + "/suppliers", { signal });
export const getSupplierHistory = (id: string, signal?: AbortSignal) =>
  request<Reply[]>(base + "/suppliers/" + encodeURIComponent(id) + "/history", {
    signal,
  });
export const saveReply = (
  id: string,
  body: {
    supplier_id?: string;
    name?: string;
    shop_url?: string;
    raw_text: string;
  },
) =>
  request<Reply>(rfqPath(id) + "/replies", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const parseReply = (id: string) =>
  request<Reply>(base + "/replies/" + encodeURIComponent(id) + "/parse", {
    method: "POST",
  });

export const reviewTerm = (
  replyId: string,
  termId: string,
  review: TermReview | null,
) =>
  request<Reply>(
    base +
      "/replies/" +
      encodeURIComponent(replyId) +
      "/terms/" +
      encodeURIComponent(termId),
    { method: "PUT", body: JSON.stringify({ review }) },
  );
