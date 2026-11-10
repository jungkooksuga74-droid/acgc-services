import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Search, Eye, CheckCircle2, ChevronDown, CircleCheck, FileText, Image, ImagePlus, LoaderCircle, Package, Plus, ShieldCheck, Upload, Wrench, X, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import RepairReceiptModal from "@/components/RepairReceiptModal";
import MediaPreviewModal from "@/components/MediaPreviewModal";
import FilterDropdown from "@/components/FilterDropdown";
import { createCustomerRepairRequest, getCustomerRepairRequests, respondToRepairQuotation, submitRepairPaymentProof } from "@/api/repairs";
import { uploadFiles } from "@/api/uploads";
import { subscribeToRealtime } from "@/lib/realtimeEvents";

const money = (amount) => `PHP ${Number(amount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const repairDateLabel = (value) => value ? new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }) : "?";
const warrantyDateLabel = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
};
const actualRepairStart = (repair) => repair.startedAt || repair.history?.find((entry) => entry.event === "in_progress")?.createdAt;
const warrantyFor = (order, item) => {
  const period = String(item?.warranty_period || order?.warranty_period || "").trim().toLowerCase();
  const status = String(item?.warranty_status || order?.warranty_status || "").toLowerCase();
  const noWarranty = status === "no_warranty" || period === "no warranty";
  const expiryValue = item?.warranty_expiry_date || order?.warranty_expiry_date;
  let expiry = expiryValue ? new Date(expiryValue) : null;
  if (!expiry && !noWarranty && period) {
    const customDays = Number(item?.custom_warranty_days || order?.custom_warranty_days);
    const match = period.match(/^(\d+(?:\.\d+)?)\s*(days?|months?|years?)?$/);
    const days = period === "custom" ? (customDays > 0 ? customDays : 90) : match ? Math.round(Number(match[1]) * ((match[2] || "days").startsWith("year") ? 365 : (match[2] || "days").startsWith("month") ? 30 : 1)) : 90;
    const start = item?.warranty_start_date || order?.warranty_start_date || order?.createdAt;
    if (start) { expiry = new Date(start); expiry.setUTCDate(expiry.getUTCDate() + days); }
  }
  const validExpiry = expiry && !Number.isNaN(expiry.getTime());
  const active = !noWarranty && (validExpiry ? expiry >= new Date() : status === "active");
  const expired = !noWarranty && (validExpiry ? expiry < new Date() : status === "expired");
  return { active, expired, expiry, noWarranty, status };
};
const repairServiceType = (repair, verbose = false) => {
  if (repair.workflowType === "warranty") return verbose ? "Warranty claim · Free service" : "Warranty claim";
  const status = String(repair.warranty?.status || "").toLowerCase();
  const expiryValue = repair.warranty?.expiresAt || repair.warranty?.expiry;
  const expiry = expiryValue ? new Date(expiryValue) : null;
  const expired = status === "no_warranty" || (expiry && !Number.isNaN(expiry.getTime()) ? expiry < new Date() : status === "expired");
  if (repair.warranty?.issueExcluded && !expired) return "Paid repair · excluded issue";
  if (expired) return verbose ? "Out-of-warranty paid repair" : "Out-of-warranty repair";
  return "Paid repair";
};
const statusLabels = {
  pending_review: "Pending Review", quotation_pending_approval: "Awaiting Your Decision", quotation_declined: "Quotation Declined", customer_accepted: "Quotation Accepted",
  admin_approved: "Warranty Approved", scheduled: "Scheduled", in_progress: "Repair in Progress", completed: "Completed", cancelled: "Closed", rejected: "Repair Rejected",
};
const activeRepairStatuses = new Set(["pending_review", "quotation_pending_approval", "customer_accepted", "admin_approved", "scheduled", "in_progress"]);
const normalizeProductName = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const removeDuplicateQuotationEvents = (history = []) => history.filter((entry, index) => {
  if (entry.event !== "quotation_issued") return true;
  const createdAt = new Date(entry.createdAt).getTime();
  const previous = history[index - 1];
  return !(previous?.event === entry.event
    && previous.detail === entry.detail
    && String(previous.actor || "") === String(entry.actor || "")
    && Math.abs(createdAt - new Date(previous.createdAt).getTime()) <= 120000);
});
const progressSteps = ["pending_review", "quotation_pending_approval", "scheduled", "in_progress", "completed"];
export default function CustomerRepairRequests({ darkMode, projects = [] }) {
  const [repairs, setRepairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [previewMedia, setPreviewMedia] = useState(null);
  const [receiptRepair, setReceiptRepair] = useState(null);
  const [rejectionDetails, setRejectionDetails] = useState(null);
  const [detailsRepair, setDetailsRepair] = useState(null);
  const [detailsTab, setDetailsTab] = useState("details");
  const detailsBodyRef = useRef(null);
  const [duplicateRepair, setDuplicateRepair] = useState(null);
  const [quotationConfirmation, setQuotationConfirmation] = useState(null);
  const [selected, setSelected] = useState("");
  const [requestMode, setRequestMode] = useState("warranty");
  const [outOfWarrantyAcknowledged, setOutOfWarrantyAcknowledged] = useState(false);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [issue, setIssue] = useState("");
  const [media, setMedia] = useState([]);
  const [paymentProofFiles, setPaymentProofFiles] = useState({});
  const [paymentProofAmounts, setPaymentProofAmounts] = useState({});
  const [paymentProofReferences, setPaymentProofReferences] = useState({});
  const [proofBusyId, setProofBusyId] = useState("");
  const [expandedPaymentId, setExpandedPaymentId] = useState("");
  const [notes, setNotes] = useState({});
  const [historyFilter, setHistoryFilter] = useState("all");
  const completedOrders = useMemo(() => projects.filter((order) => String(order.status).toLowerCase() === "completed"), [projects]);
  const activeCount = repairs.filter((repair) => ["admin_approved", "customer_accepted", "scheduled", "in_progress"].includes(repair.status)).length;
  const needsActionCount = repairs.filter((repair) => ["pending_review", "quotation_pending_approval"].includes(repair.status)).length;
  const visibleRepairs = historyFilter === "all" ? repairs : historyFilter === "cancelled"
    ? repairs.filter((repair) => ["cancelled", "quotation_declined", "rejected"].includes(repair.status)) : historyFilter === "in_progress"
    ? repairs.filter((repair) => ["admin_approved", "customer_accepted", "scheduled", "in_progress"].includes(repair.status))
    : repairs.filter((repair) => repair.status === historyFilter);
  const repairFilterCount = (value) => value === "all" ? repairs.length : value === "cancelled"
    ? repairs.filter((repair) => ["cancelled", "quotation_declined", "rejected"].includes(repair.status)).length
    : value === "in_progress" ? repairs.filter((repair) => ["admin_approved", "customer_accepted", "scheduled", "in_progress"].includes(repair.status)).length
    : repairs.filter((repair) => repair.status === value).length;
  const historyFilters = [
    { value: "all", label: "All" },
    { value: "pending_review", label: "Pending" },
    { value: "quotation_pending_approval", label: "Quotation" },
    { value: "in_progress", label: "In progress" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Closed" },
  ];
  const mobileHistoryFilterOptions = historyFilters.map((filter) => [
    filter.value,
    `${filter.label} (${repairFilterCount(filter.value)})`,
  ]);
  const selectedParts = selected.split(":");
  const selectedOrder = completedOrders.find((order) => String(order._id) === selectedParts[0]);
  const selectedIndex = Number(selectedParts[1]);
  const selectedItem = selectedOrder?.items?.[selectedIndex];
  const selectedWarranty = warrantyFor(selectedOrder, selectedItem);
  const getActiveRepairForProduct = (order, itemIndex, item) => repairs.find((repair) => {
    if (!activeRepairStatuses.has(repair.status)) return false;
    const repairOrderId = String(repair.order?._id || repair.order || "");
    const sameOrder = repairOrderId
      ? repairOrderId === String(order?._id)
      : Boolean(order?.tracking && repair.orderTracking === order.tracking
        && normalizeProductName(repair.productName) === normalizeProductName(item?.name));
    return sameOrder && Number(repair.productIndex ?? 0) === Number(itemIndex);
  }) || null;
  const selectedActiveRepair = selectedOrder && selectedItem
    ? getActiveRepairForProduct(selectedOrder, selectedIndex, selectedItem)
    : null;
  const orderProductOptions = completedOrders.flatMap((order) => (order.items || []).map((item, index) => {
    const coverage = warrantyFor(order, item);
    const activeRepair = getActiveRepairForProduct(order, index, item);
    const warrantyExpiry = warrantyDateLabel(coverage.expiry);
    const warrantyLabel = coverage.active
      ? `Warranty Active${warrantyExpiry ? ` until ${warrantyExpiry}` : ""}`
      : coverage.noWarranty
        ? "No warranty coverage"
        : `Warranty Expired${warrantyExpiry ? ` on ${warrantyExpiry}` : ""}`;
    const dimensions = Number(item.width) > 0 && Number(item.height) > 0 ? `${item.width} × ${item.height} ${item.measurement_unit || item.measurementUnit || "in"} · ` : "";
    const value = `${order._id}:${index}`;
    return { order, item, index, activeRepair, warranty: coverage, value, text: `${item.name || "Ordered product"} · ${dimensions}Qty ${item.quantity || 1} · ${warrantyLabel}${activeRepair ? ` · ${statusLabels[activeRepair.status] || activeRepair.status}` : ""}` };
  }));
  const selectedProductOption = orderProductOptions.find((option) => option.value === selected);
  const productSearchTerm = productSearch.trim().toLocaleLowerCase();
  const requestModeProductOptions = orderProductOptions.filter((option) => requestMode === "warranty"
    ? option.warranty.active
    : option.warranty.expired || option.warranty.noWarranty);
  const unconfirmedWarrantyProducts = orderProductOptions.filter((option) => !option.warranty.active && !option.warranty.expired && !option.warranty.noWarranty).length;
  const filteredProductOptions = requestModeProductOptions.filter((option) => option.text.toLocaleLowerCase().includes(productSearchTerm) || String(option.order.tracking || "").toLocaleLowerCase().includes(productSearchTerm));
  const panel = darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900";
  const field = `mt-1 w-full rounded-lg border px-3 py-2.5 text-sm ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-800"}`;
  const detailsHistory = detailsRepair ? removeDuplicateQuotationEvents(detailsRepair.history || []) : [];

  const load = useCallback(async () => {
    try { const response = await getCustomerRepairRequests(); setRepairs(response.repairs || []); }
    catch (error) { toast.error(error?.data?.message || error.message || "Unable to load repair history."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); return subscribeToRealtime(["repairs"], () => { void load(); }); }, [load]);
  useEffect(() => { if (!requestOpen) { setProductDropdownOpen(false); setProductSearch(""); } }, [requestOpen]);

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedOrder || !selectedItem || !issue.trim()) return toast.error("Choose an order product and describe the issue.");
    if (requestMode === "warranty" ? !selectedWarranty.active : !(selectedWarranty.expired || selectedWarranty.noWarranty)) return toast.error("Choose a product that matches the selected repair request type.");
    if (selectedActiveRepair) {
      setDuplicateRepair(selectedActiveRepair);
      return;
    }
    if (!media.length || media.some((file) => !file.type.startsWith("image/"))) return toast.error("Upload at least one defect image. Videos are not accepted.");
    if (requestMode === "paid" && !outOfWarrantyAcknowledged) return toast.error("Confirm that you understand this is an out-of-warranty paid repair request.");
    setSubmitting(true);
    setSubmitStage("Uploading photos");
    setUploadProgress(0);
    try {
      const uploaded = await uploadFiles(media, setUploadProgress, { purpose: "repair-media" });
      setSubmitStage("Saving request");
      await createCustomerRepairRequest({ orderId: selectedOrder._id, productIndex: selectedIndex, workflowType: requestMode, issueDescription: issue.trim(), mediaUrls: (uploaded.files || []).map((file) => file.url), outOfWarrantyAcknowledged: requestMode === "paid" && outOfWarrantyAcknowledged });
      setSelected(""); setIssue(""); setMedia([]); setOutOfWarrantyAcknowledged(false); setRequestOpen(false);
      toast.success("Repair request submitted.");
      void load();
    } catch (error) {
      if (error?.data?.code === "ACTIVE_REPAIR_EXISTS" && error.data.existingRepair) setDuplicateRepair(error.data.existingRepair);
      else toast.error(error?.data?.message || error.message || "Unable to submit repair request.");
    }
    finally { setSubmitting(false); setSubmitStage(""); setUploadProgress(0); }
  };
  const respond = (repair, action) => setQuotationConfirmation({ repair, action });
  const confirmQuotationResponse = async () => {
    if (!quotationConfirmation) return;
    const { repair, action } = quotationConfirmation;
    setQuotationConfirmation(null);
    setBusyId(String(repair._id));
    try {
      await respondToRepairQuotation(repair._id, { action, notes: notes[repair._id] || "" });
      await load(); toast.success(action === "accept" ? "Quotation accepted." : "Request cancelled.");
    } catch (error) { toast.error(error?.data?.message || error.message || "Unable to submit quotation response."); }
    finally { setBusyId(""); }
  };
  const submitPaymentProof = async (repair) => {
    const file = paymentProofFiles[repair._id];
    if (file && file.size > 4 * 1024 * 1024) return toast.error("Payment proof must be 4 MB or smaller.");
    const remaining = Math.max(0, Number(repair.quotation?.total || 0) - Number(repair.payment?.verifiedAmount || 0));
    const amount = Number(paymentProofAmounts[repair._id] ?? "");
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) return toast.error(`Enter an amount no greater than the remaining balance of ${money(remaining)}.`);
    setProofBusyId(String(repair._id));
    try {
      const payload = {
        amount,
        transactionNumber: paymentProofReferences[repair._id] || "",
      };
      if (file) {
        const uploaded = await uploadFiles([file], undefined, { purpose: "payment-proofs" });
        const proof = uploaded.files?.[0];
        if (!proof?.url) throw new Error("The payment proof upload did not return a file URL.");
        payload.proofUrl = proof.url;
        payload.proofFileName = proof.originalName || file.name;
      }
      await submitRepairPaymentProof(repair._id, payload);
      setPaymentProofFiles((current) => ({ ...current, [repair._id]: null }));
      await load();
      toast.success("Payment proof submitted for review.");
    } catch (error) { toast.error(error?.data?.message || error.message || "Unable to submit payment proof."); }
    finally { setProofBusyId(""); }
  };
  const addMediaFiles = (fileList) => {
    const chosen = Array.from(fileList || []);
    const images = chosen.filter((file) => file.type.startsWith("image/"));
    if (images.length !== chosen.length) toast.error("Only image files can be attached.");
    const seen = new Set(media.map((file) => `${file.name}-${file.size}-${file.lastModified}`));
    const uniqueImages = images.filter((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (media.length + uniqueImages.length > 6) toast.error("You can attach up to six images.");
    setMedia([...media, ...uniqueImages].slice(0, 6));
  };
  const handleMediaSelection = (event) => {
    addMediaFiles(event.target.files);
    event.target.value = "";
  };
  const paymentProofPanel = (repair) => {
    if (repair.workflowType !== "paid" || !repair.quotation?.issuedAt || ["pending_review", "quotation_pending_approval", "quotation_declined", "cancelled", "rejected"].includes(repair.status)) return null;
    const payment = repair.payment || {};
    const proofPending = payment.proofReviewStatus === "pending";
    const paymentVerified = Number(payment.verifiedAmount || 0) > 0 || payment.status === "received";
    const proofRejected = payment.proofReviewStatus === "rejected";
    const total = Number(repair.quotation?.total || 0);
    const paid = Number(payment.verifiedAmount || 0);
    const balance = Math.max(0, total - paid);
    const fullyPaid = ["paid", "received"].includes(payment.status) && paid >= total;
    const file = paymentProofFiles[repair._id];
    const expanded = expandedPaymentId === String(repair._id);
    const panelId = `repair-payment-${repair._id}`;
    const paymentStateClass = fullyPaid
      ? darkMode ? "bg-emerald-400/15 text-emerald-200" : "bg-emerald-100 text-emerald-800"
      : paid > 0
        ? darkMode ? "bg-amber-400/15 text-amber-200" : "bg-amber-100 text-amber-800"
        : proofRejected
          ? darkMode ? "bg-red-400/15 text-red-200" : "bg-red-100 text-red-800"
          : darkMode ? "bg-amber-400/15 text-amber-200" : "bg-amber-100 text-amber-800";
    return <section className={`mt-1 overflow-hidden rounded-[10px] border ${darkMode ? "border-[#3d4862] bg-[#2a3246] text-[#e8ebf2]" : "border-slate-200 bg-white text-slate-900"}`}>
      <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpandedPaymentId(expanded ? "" : String(repair._id))} className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 p-2.5 text-left sm:flex sm:justify-between sm:gap-3 sm:p-[14px] sm:px-4 ${darkMode ? "hover:bg-[#343e55]/50" : "hover:bg-slate-50"}`}>
        <span className="min-w-0 sm:order-1">
          <span className="block text-[13px] font-extrabold sm:text-[15px]">Repair Payment</span>
        </span>
        <span className="row-span-2 flex shrink-0 items-center gap-1.5 sm:order-3 sm:gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold sm:gap-1.5 sm:px-2.5 sm:text-[10px] ${paymentStateClass}`}>
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {fullyPaid ? "Paid" : paid > 0 ? "Partially Paid" : proofRejected ? "Proof rejected" : "Pending"}
          </span>
          <ChevronDown size={16} aria-hidden="true" className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
        </span>
        <span className={`col-span-2 row-start-2 block text-[11px] leading-[1.35] sm:order-2 sm:flex-1 sm:text-[12.5px] sm:leading-4 ${darkMode ? "text-[#a9b3c7]" : "text-slate-600"}`}>
          {proofPending ? `Your payment details${payment.proofUrl ? " and proof" : ""} are awaiting admin review. This does not mark the repair as Paid.` : paymentVerified ? payment.proofReviewStatus === "approved" ? "Your submitted payment details were verified by an administrator." : "Your payment was recorded and verified by an administrator." : proofRejected ? `Payment submission was rejected: ${payment.proofRejectionReason || "Please review and resubmit your payment details."}` : "Upload proof optionally after making a payment. An administrator verifies all payment amounts."}
        </span>
      </button>

      {expanded && <div id={panelId} className="px-[14px] pb-[14px] sm:px-4 sm:pb-4">
      <dl className={`mt-3 grid grid-cols-1 divide-y overflow-hidden rounded-[10px] border min-[761px]:grid-cols-3 min-[761px]:divide-x min-[761px]:divide-y-0 ${darkMode ? "divide-[#3d4862] border-[#3d4862] bg-[#343e55]" : "divide-slate-200 border-slate-200 bg-slate-50"}`}>
        <div className="flex min-h-[52px] flex-col justify-center px-3 py-1.5">
          <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>Charge</dt>
          <dd className="text-[15px] font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(total)}</span></dd>
        </div>
        <div className="flex min-h-[52px] flex-col justify-center px-3 py-1.5">
          <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>Verified paid</dt>
          <dd className="text-[15px] font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(paid)}</span></dd>
        </div>
        <div className="flex min-h-[52px] flex-col justify-center px-3 py-1.5">
          <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>Balance</dt>
          <dd className="text-[15px] font-bold text-amber-700 dark:text-amber-300">{money(balance)}</dd>
        </div>
      </dl>

      {payment.proofUrl && <button type="button" onClick={() => setPreviewMedia(payment.proofUrl)} className="mt-2 inline-flex text-xs font-semibold text-sky-700 underline dark:text-sky-300">View submitted proof{payment.proofFileName ? `: ${payment.proofFileName}` : ""}</button>}

      {!proofPending && !fullyPaid && balance > 0 && <div className="mt-3 grid grid-cols-1 items-end gap-3 min-[761px]:grid-cols-[minmax(250px,1.2fr)_130px_minmax(220px,1fr)_auto]">
        <label className="block min-w-0 text-xs font-bold">
          <span className="mb-[5px] block">Proof file (image or PDF, max 4 MB) <span className={`font-normal ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>(optional)</span></span>
          <span className={`relative flex h-10 min-w-0 items-center gap-2 overflow-hidden rounded-[9px] border px-2.5 text-xs font-normal ${darkMode ? "border-[#3d4862] bg-[#343e55]" : "border-slate-200 bg-white"}`}>
            <span className={`inline-flex h-[30px] shrink-0 items-center rounded-[7px] border px-2.5 text-[12.5px] font-semibold ${darkMode ? "border-[#3d4862] bg-[#2a3246]" : "border-slate-200 bg-slate-50"}`}>Choose File</span>
            <span className={`min-w-0 truncate ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>{file?.name || "No file chosen"}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" aria-label="Proof file (image or PDF, max 4 MB)" onChange={(event) => { setPaymentProofFiles((current) => ({ ...current, [repair._id]: event.target.files?.[0] || null })); event.target.value = ""; }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </span>
        </label>
        <label className="block text-xs font-bold">
          <span className="mb-[5px] block">Amount paid</span>
          <input type="number" min="0.01" max={balance} step="0.01" value={paymentProofAmounts[repair._id] ?? ""} onChange={(event) => setPaymentProofAmounts((current) => ({ ...current, [repair._id]: event.target.value }))} className={`h-10 w-full rounded-[9px] border px-3 text-sm font-medium ${darkMode ? "border-[#3d4862] bg-[#343e55] text-[#e8ebf2]" : "border-slate-200 bg-white text-slate-900"}`} />
        </label>
        <label className="block min-w-0 text-xs font-bold">
          <span className="mb-[5px] block">Transaction/reference number (optional)</span>
          <input type="text" maxLength={180} value={paymentProofReferences[repair._id] || ""} onChange={(event) => setPaymentProofReferences((current) => ({ ...current, [repair._id]: event.target.value }))} className={`h-10 w-full rounded-[9px] border px-3 text-sm font-medium ${darkMode ? "border-[#3d4862] bg-[#343e55] text-[#e8ebf2]" : "border-slate-200 bg-white text-slate-900"}`} />
        </label>
        <button type="button" disabled={proofBusyId === String(repair._id)} onClick={() => submitPaymentProof(repair)} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[9px] bg-sky-700 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 min-[761px]:w-auto">
          {proofBusyId === String(repair._id) ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}
          {proofBusyId === String(repair._id) ? "Submitting..." : proofRejected ? "Resubmit payment proof" : "Submit payment proof"}
        </button>
      </div>}
      </div>}
    </section>;
  };

  return <section className={`customer-repair-requests ${darkMode ? "is-dark" : ""} mb-6 overflow-hidden rounded-[14px] border shadow-sm ${darkMode ? "border-[#3d4862] bg-[#2a3246] text-[#e8ebf2]" : "border-slate-200 bg-white text-slate-900"}`}>
    <div className={`relative overflow-hidden border-b p-5 sm:p-7 ${darkMode ? "border-slate-700 bg-gradient-to-br from-slate-900 via-slate-900 to-red-950/40" : "border-slate-100 bg-gradient-to-br from-rose-50 via-white to-slate-50"}`}>
      <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 size-64 rounded-full border border-red-500/10" />
      <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-center">
        <div className="flex items-start gap-4">
          <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-100 text-red-700"}`}><Wrench size={22} /></span>
          <div><p className={`text-[10px] font-black uppercase tracking-[0.22em] ${darkMode ? "text-red-300" : "text-red-700"}`}>Customer care</p><h2 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">Warranty & Repair Service</h2><p className={`mt-2 max-w-2xl text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Get help with a completed order. Follow inspections, quotations, appointments, and repair progress in one place.</p></div>
        </div>
        <button type="button" onClick={() => setRequestOpen(true)} disabled={!completedOrders.length} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-900/15 transition hover:-translate-y-0.5 hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={18} />Request service<ArrowUpRight size={16} /></button>
      </div>
      <div className={`relative mt-5 rounded-xl border px-4 py-3 text-xs leading-5 ${darkMode ? "border-slate-700 bg-slate-950/50 text-slate-300" : "border-slate-200 bg-white/80 text-slate-600"}`}>
        <span className={`font-bold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>How it works:</span> Submit your request and photos. Our team reviews it. If a quote is needed, you decide whether to continue. Then we schedule and complete the repair. Approved warranty claims do not require a customer-paid quote.
      </div>
    </div>

    <div className="p-4 sm:p-6">
      <div className="mb-4">
        {!loading && repairs.length > 0 && <>
          <div className="hidden flex-wrap items-center gap-2 sm:flex" role="tablist" aria-label="Filter service requests">
            {historyFilters.map((filter) => <button key={filter.value} type="button" role="tab" aria-selected={historyFilter === filter.value} onClick={() => setHistoryFilter(filter.value)} className={`inline-flex h-[38px] shrink-0 items-center gap-2 rounded-full border px-3 text-[13px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${historyFilter === filter.value ? darkMode ? "border-red-500 bg-red-500/10 text-red-300" : "border-red-300 bg-red-50 text-red-700" : darkMode ? "border-[#3d4862] bg-[#343e55] text-[#e8ebf2] hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}><span className="whitespace-nowrap">{filter.label}</span><span className={`inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11.5px] tabular-nums ${historyFilter === filter.value ? "bg-red-600 text-white" : darkMode ? "bg-[#3d4862] text-[#a9b3c7]" : "bg-slate-100 text-slate-600"}`}>{repairFilterCount(filter.value)}</span></button>)}
          </div>
          <div className="w-full sm:hidden">
            <FilterDropdown
              label="Service request filter"
              value={historyFilter}
              options={mobileHistoryFilterOptions}
              onChange={setHistoryFilter}
              darkMode={darkMode}
            />
          </div>
        </>}
      </div>
      {loading ? <div className={`flex items-center gap-3 rounded-2xl border p-6 text-sm ${darkMode ? "border-slate-700 bg-slate-950/50 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}><LoaderCircle size={18} className="animate-spin text-red-600" />Loading your repair history...</div> : repairs.length === 0 ? <div className={`rounded-2xl border border-dashed px-5 py-9 text-center ${darkMode ? "border-slate-700 bg-slate-950/40" : "border-slate-200 bg-slate-50"}`}><span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-red-700/10 text-red-700"><Package size={22} /></span><h4 className="mt-3 text-sm font-bold">No service requests yet</h4><p className={`mx-auto mt-1 max-w-sm text-xs leading-5 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>If a completed product needs attention, submit a repair or warranty request to get started.</p>{completedOrders.length > 0 && <button type="button" onClick={() => setRequestOpen(true)} className="mt-4 rounded-xl bg-red-700 px-4 py-2.5 text-xs font-bold text-white">Start a request</button>}</div> : visibleRepairs.length === 0 ? <div className={`rounded-2xl border border-dashed px-5 py-8 text-center text-sm ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>No requests in this status.</div> : <><div className={`hidden min-[761px]:block overflow-x-auto rounded-[14px] border ${darkMode ? "border-[#3d4862] bg-[#2a3246]" : "border-slate-200 bg-white"}`}><table className="block w-full min-w-[980px] border-collapse text-left"><thead className={`block border-b ${darkMode ? "border-[#3d4862] bg-[#343e55]" : "border-slate-200 bg-slate-50"}`}><tr className={`grid grid-cols-[minmax(130px,1.05fr)_minmax(150px,1.2fr)_minmax(150px,1.2fr)_minmax(160px,1.3fr)_minmax(140px,1.15fr)_minmax(80px,0.65fr)_minmax(185px,1.5fr)] text-[10.5px] uppercase tracking-[.08em] ${darkMode ? "text-[#a9b3c7]" : "text-slate-600"}`}><th className="px-[14px] py-3 font-bold">Product</th><th className="px-[14px] py-3 font-bold">Order</th><th className="px-[14px] py-3 font-bold">Service type</th><th className="px-[14px] py-3 font-bold">Status / Progress</th><th className="px-[14px] py-3 font-bold">Repair Schedule</th><th className="px-[14px] py-3 font-bold">Evidence</th><th className="px-[14px] py-3 font-bold">Actions</th></tr></thead><tbody className={`block divide-y ${darkMode ? "divide-[#3d4862]" : "divide-slate-200"}`}>{visibleRepairs.map((repair) => {
        const steps = repair.workflowType === "warranty" ? ["pending_review", "scheduled", "in_progress", "completed"] : progressSteps;
        const stepForStatus = repair.status === "admin_approved" ? 1 : repair.status === "customer_accepted" ? 2 : steps.indexOf(repair.status);
        const awaitingQuote = repair.status === "quotation_pending_approval";
        const paymentPanel = paymentProofPanel(repair);
        const closed = ["cancelled", "quotation_declined", "rejected"].includes(repair.status);
        const progress = repair.status === "completed" ? 100 : closed ? 0 : Math.max(8, ((stepForStatus + 1) / steps.length) * 100);
        const statusTone = repair.status === "completed" ? "emerald" : repair.status === "rejected" ? "red" : awaitingQuote ? "amber" : "sky";
        const statusStyle = statusTone === "emerald" ? (darkMode ? "bg-emerald-400/15 text-emerald-200" : "bg-emerald-50 text-emerald-800") : statusTone === "red" ? (darkMode ? "bg-red-400/15 text-red-200" : "bg-red-50 text-red-700") : statusTone === "amber" ? (darkMode ? "bg-amber-400/15 text-amber-200" : "bg-amber-50 text-amber-800") : (darkMode ? "bg-sky-400/15 text-sky-200" : "bg-sky-50 text-sky-800");
        const progressStyle = statusTone === "emerald" ? "bg-emerald-600" : statusTone === "red" ? "bg-red-600" : statusTone === "amber" ? "bg-amber-500" : "bg-sky-600";
        return <Fragment key={repair._id}><tr className={`grid min-h-[78px] grid-cols-[minmax(130px,1.05fr)_minmax(150px,1.2fr)_minmax(150px,1.2fr)_minmax(160px,1.3fr)_minmax(140px,1.15fr)_minmax(80px,0.65fr)_minmax(185px,1.5fr)] items-center gap-y-0 px-0 transition-colors ${darkMode ? "hover:bg-[#343e55]/60" : "hover:bg-slate-50"}`}>
          <td className="min-w-0 px-[14px] py-3"><p className="whitespace-nowrap text-[14.5px] font-extrabold">{repair.productName}</p></td>
          <td className="min-w-0 px-[14px] py-3"><p className={`inline-flex whitespace-nowrap rounded-[6px] bg-slate-100 px-2 py-1 font-mono text-[11.5px] font-bold text-slate-700 ${darkMode ? "bg-[#343e55] text-[#e8ebf2]" : ""}`}>{repair.repairTrackingId || "Generating…"}</p><p className={`mt-1 whitespace-nowrap text-[12.5px] ${darkMode ? "text-[#a9b3c7]" : "text-slate-600"}`}>Submitted {new Date(repair.requestedAt || repair.createdAt).toLocaleDateString("en-PH")}</p></td>
          <td className="min-w-0 px-[14px] py-3"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${repair.workflowType === "warranty" ? darkMode ? "bg-emerald-400/15 text-emerald-200" : "bg-emerald-50 text-emerald-800" : darkMode ? "bg-[#343e55] text-[#e8ebf2]" : "bg-slate-100 text-slate-700"}`}>{repairServiceType(repair)}</span><p className={`mt-1 whitespace-nowrap text-[12.5px] ${darkMode ? "text-[#a9b3c7]" : "text-slate-600"}`}>{repair.workflowType === "warranty" ? `Coverage ${repair.warranty?.status || "unknown"}` : repair.quotation?.issuedAt ? `Quotation ${money(repair.quotation.total)}` : "Estimate pending"}</p></td>
          <td className="min-w-0 px-[14px] py-3"><span className={`repair-status-pill inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold ${statusStyle}`}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{statusLabels[repair.status] || "Repair update"}</span><div className={`mt-1.5 h-[5px] w-[150px] max-w-full overflow-hidden rounded-full ${darkMode ? "bg-[#3d4862]" : "bg-slate-200"}`}><div className={`h-full rounded-full ${closed ? "bg-transparent" : progressStyle}`} style={{ width: `${progress}%` }} /></div><p className={`mt-1 whitespace-nowrap text-[11.5px] ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>{closed ? repair.status === "rejected" ? "Claim rejected" : "Request closed" : `${Math.round(progress)}% complete`}</p></td>
          <td className="min-w-0 px-[14px] py-3">{repair.schedule?.date ? <p className="whitespace-nowrap text-[12.5px] leading-[18px]"><span className={darkMode ? "text-[#a9b3c7]" : "text-slate-500"}>Start: </span><strong>{repairDateLabel(["in_progress", "completed"].includes(repair.status) ? (actualRepairStart(repair) || repair.schedule.startDate || repair.schedule.date) : (repair.schedule.startDate || repair.schedule.date))}</strong><br /><span className={darkMode ? "text-[#a9b3c7]" : "text-slate-500"}>Finish: </span><strong>{repairDateLabel(repair.status === "completed" ? (repair.completion?.completedAt || repair.schedule.finishDate || repair.schedule.startDate || repair.schedule.date) : (repair.schedule.finishDate || repair.schedule.startDate || repair.schedule.date))}</strong></p> : repair.quotation?.issuedAt ? <span className={`whitespace-nowrap text-[13px] ${darkMode ? "text-[#a9b3c7]" : "text-slate-600"}`}>Quote issued</span> : <span className={`whitespace-nowrap text-[13px] ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>Awaiting review</span>}</td>
          <td className="min-w-0 px-[14px] py-3"><div className="flex items-center gap-1.5">{repair.mediaUrls?.length ? repair.mediaUrls.slice(0, 3).map((url, index) => <button key={url} type="button" onClick={() => setPreviewMedia(url)} aria-label={`Preview repair evidence ${index + 1}`} className={`size-10 overflow-hidden rounded-[9px] border ${darkMode ? "border-[#3d4862]" : "border-slate-200"} bg-slate-100`}>{/\.(mp4|webm|mov)(\?|$)/i.test(url) ? <video src={url} className="h-full w-full object-cover" /> : <img src={url} alt="Repair evidence" className="h-full w-full object-cover" />}</button>) : <span className={`whitespace-nowrap text-xs ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>No photos</span>}{repair.mediaUrls?.length > 3 && <span className="text-[10px]">+{repair.mediaUrls.length - 3}</span>}</div></td>
          <td className="min-w-0 px-[14px] py-3"><div className="flex flex-nowrap items-center gap-2"><button type="button" onClick={() => { setDetailsRepair(repair); setDetailsTab("details"); }} title="View ticket details" aria-label="View ticket details" className={`flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${darkMode ? "border-[#3d4862] bg-[#343e55] text-[#e8ebf2] hover:border-red-400 hover:text-red-300" : "border-slate-200 bg-white text-slate-700 hover:border-red-300 hover:text-red-700"}`}><Eye size={18} strokeWidth={2.4} /></button>{repair.status === "rejected" && <button type="button" onClick={() => setRejectionDetails(repair)} title="View repair rejection details" aria-label="View repair rejection details" className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${darkMode ? "border-red-400/30 bg-red-400/10 text-red-200 hover:bg-red-400/20" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}><FileText size={14} /></button>}{repair.receipt?.number && <button type="button" onClick={() => setReceiptRepair(repair)} title="View issued repair receipt" aria-label="View issued repair receipt" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white"><FileText size={15} /></button>}{awaitingQuote && <><button type="button" disabled={busyId === String(repair._id)} onClick={() => respond(repair, "accept")} className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">Accept</button><button type="button" disabled={busyId === String(repair._id)} onClick={() => respond(repair, "decline")} className={`inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border px-3 text-xs font-bold transition-colors disabled:opacity-50 ${darkMode ? "border-red-400/50 bg-transparent text-red-200 hover:bg-red-400/10" : "border-red-300 bg-transparent text-red-700 hover:bg-red-50"}`}>Decline</button></>}</div>
          </td>
        </tr>{paymentPanel && <tr className="block"><td colSpan={7} className={`block px-4 pb-4 ${darkMode ? "bg-[#232b3e]/40" : "bg-slate-50/60"}`}><div className="w-full">{paymentPanel}</div></td></tr>}</Fragment>;
      })}</tbody></table></div><div className="grid grid-cols-1 gap-3 min-[761px]:hidden">{visibleRepairs.map((repair) => {
        const steps = repair.workflowType === "warranty" ? ["pending_review", "scheduled", "in_progress", "completed"] : progressSteps;
        const stepForStatus = repair.status === "admin_approved" ? 1 : repair.status === "customer_accepted" ? 2 : steps.indexOf(repair.status);
        const awaitingQuote = repair.status === "quotation_pending_approval";
        const closed = ["cancelled", "quotation_declined", "rejected"].includes(repair.status);
        const progress = repair.status === "completed" ? 100 : closed ? 0 : Math.max(8, ((stepForStatus + 1) / steps.length) * 100);
        const statusTone = repair.status === "completed" ? "emerald" : repair.status === "rejected" ? "red" : awaitingQuote ? "amber" : "sky";
        const statusStyle = statusTone === "emerald" ? (darkMode ? "bg-emerald-400/15 text-emerald-200" : "bg-emerald-50 text-emerald-800") : statusTone === "red" ? (darkMode ? "bg-red-400/15 text-red-200" : "bg-red-50 text-red-700") : statusTone === "amber" ? (darkMode ? "bg-amber-400/15 text-amber-200" : "bg-amber-50 text-amber-800") : (darkMode ? "bg-sky-400/15 text-sky-200" : "bg-sky-50 text-sky-800");
        const progressStyle = statusTone === "emerald" ? "bg-emerald-600" : statusTone === "red" ? "bg-red-600" : statusTone === "amber" ? "bg-amber-500" : "bg-sky-600";
        return <article key={repair._id} className={`overflow-hidden rounded-2xl border shadow-sm ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"}`}>
          <header className={`border-b p-3 ${darkMode ? "border-slate-800 bg-slate-900/60" : "border-slate-100 bg-slate-50/70"}`}>
            <div className="flex min-w-0 items-start gap-3">
              <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${repair.workflowType === "warranty" ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}><Wrench size={16} /></span>
              <div className="min-w-0"><h4 className="truncate text-sm font-extrabold">{repair.productName}</h4><p className={`mt-1 break-all font-mono text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{repair.repairTrackingId || "Generating..."}</p><p className={`mt-0.5 text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Submitted {new Date(repair.requestedAt || repair.createdAt).toLocaleDateString("en-PH")}</p></div>
            </div>
          </header>
          <div className="space-y-3 p-3">
            <section><p className={`mb-1 text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Service type</p><span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${repair.workflowType === "warranty" ? darkMode ? "bg-emerald-400/15 text-emerald-200" : "bg-emerald-50 text-emerald-800" : darkMode ? "bg-[#343e55] text-[#e8ebf2]" : "bg-slate-100 text-slate-700"}`}>{repairServiceType(repair)}</span><p className={`mt-1 text-[11px] ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{repair.workflowType === "warranty" ? `Coverage ${repair.warranty?.status || "unknown"}` : repair.quotation?.issuedAt ? `Quotation ${money(repair.quotation.total)}` : "Estimate pending"}</p></section>
            <section><p className={`mb-1 text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Status / Progress</p><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyle}`}><span className="size-1.5 rounded-full bg-current" aria-hidden="true" />{statusLabels[repair.status] || "Repair update"}</span><div className={`mt-1.5 h-1 w-full overflow-hidden rounded-full ${darkMode ? "bg-[#3d4862]" : "bg-slate-200"}`}><div className={`h-full rounded-full ${closed ? "bg-transparent" : progressStyle}`} style={{ width: `${progress}%` }} /></div><p className={`mt-1 text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{closed ? repair.status === "rejected" ? "Claim rejected" : "Request closed" : `${Math.round(progress)}% complete`}</p></section>
            <section><p className={`mb-1 text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Repair Schedule</p>{repair.schedule?.date ? <div className="grid grid-cols-2 gap-2"><p className={`text-[11px] leading-4 ${darkMode ? "text-slate-300" : "text-slate-700"}`}><span className={`block text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Start</span><strong>{repairDateLabel(["in_progress", "completed"].includes(repair.status) ? (actualRepairStart(repair) || repair.schedule.startDate || repair.schedule.date) : (repair.schedule.startDate || repair.schedule.date))}</strong></p><p className={`text-[11px] leading-4 ${darkMode ? "text-slate-300" : "text-slate-700"}`}><span className={`block text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Finish</span><strong>{repairDateLabel(repair.status === "completed" ? (repair.completion?.completedAt || repair.schedule.finishDate || repair.schedule.startDate || repair.schedule.date) : (repair.schedule.finishDate || repair.schedule.startDate || repair.schedule.date))}</strong></p></div> : repair.quotation?.issuedAt ? <p className={`text-[11px] ${darkMode ? "text-slate-400" : "text-slate-600"}`}>Quote issued</p> : <p className={`text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Awaiting review</p>}</section>
            <div className="grid grid-cols-2 gap-3">
              <section><p className={`mb-1 text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Evidence</p><div className="flex flex-wrap items-center gap-1">{repair.mediaUrls?.length ? repair.mediaUrls.slice(0, 3).map((url, index) => <button key={url} type="button" onClick={() => setPreviewMedia(url)} aria-label={`Preview repair evidence ${index + 1}`} className={`size-9 overflow-hidden rounded-lg border ${darkMode ? "border-[#3d4862]" : "border-slate-200"} bg-slate-100`}>{/\.(mp4|webm|mov)(\?|$)/i.test(url) ? <video src={url} className="h-full w-full object-cover" /> : <img src={url} alt="Repair evidence" className="h-full w-full object-cover" />}</button>) : <span className={`text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>No photos</span>}{repair.mediaUrls?.length > 3 && <span className={`text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>+{repair.mediaUrls.length - 3}</span>}</div></section>
              <section><p className={`mb-1 text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Actions</p><div className="flex flex-wrap items-center gap-1.5"><button type="button" onClick={() => { setDetailsRepair(repair); setDetailsTab("details"); }} title="View ticket details" aria-label="View ticket details" className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${darkMode ? "border-[#3d4862] bg-[#343e55] text-[#e8ebf2]" : "border-slate-200 bg-white text-slate-700"}`}><Eye size={16} strokeWidth={2.4} /></button>{repair.status === "rejected" && <button type="button" onClick={() => setRejectionDetails(repair)} title="View repair rejection details" aria-label="View repair rejection details" className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${darkMode ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-red-200 bg-red-50 text-red-700"}`}><FileText size={13} /></button>}{repair.receipt?.number && <button type="button" onClick={() => setReceiptRepair(repair)} title="View issued repair receipt" aria-label="View issued repair receipt" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white"><FileText size={14} /></button>}{awaitingQuote && <><button type="button" disabled={busyId === String(repair._id)} onClick={() => respond(repair, "accept")} className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-emerald-700 px-2 text-[11px] font-bold text-white disabled:opacity-50">Accept</button><button type="button" disabled={busyId === String(repair._id)} onClick={() => respond(repair, "decline")} className={`inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border px-2 text-[11px] font-bold disabled:opacity-50 ${darkMode ? "border-red-400/50 text-red-200" : "border-red-300 text-red-700"}`}>Decline</button></>}</div></section>
            </div>
            {paymentProofPanel(repair)}
          </div>
        </article>;
      })}</div></>}
    </div>

    {detailsRepair && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/75 p-0 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsRepair(null); }}><section role="dialog" aria-modal="true" aria-labelledby="customer-repair-details-title" className={`flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:max-w-4xl sm:rounded-2xl sm:border ${panel}`}><header className={`flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6 sm:py-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-[#faf9f7]"}`}><div className="min-w-0"><h3 id="customer-repair-details-title" className="text-lg font-extrabold tracking-tight sm:text-xl">Repair ticket details</h3><p className={`mt-1 break-words text-xs sm:text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{detailsRepair.productName} · {detailsRepair.customerName} · Repair ID: {detailsRepair.repairTrackingId || "Pending"}</p></div><button type="button" onClick={() => setDetailsRepair(null)} aria-label="Close repair ticket details" className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-200"}`}><X size={20} /></button></header><div ref={detailsBodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-1 sm:px-6 sm:pb-5"><div role="tablist" aria-label="Repair ticket details" className={`grid w-full grid-cols-2 items-stretch gap-2 border-b py-3 sm:gap-3 ${darkMode ? "border-slate-700 bg-slate-900/70" : "border-slate-100 bg-slate-50/80"}`}>{[{ id: "details", number: 1, title: "Details", detail: "Customer and project information" }, { id: "history", number: 2, title: "Repair history", detail: "Updates recorded for this repair ticket" }].map((tab) => <button key={tab.id} id={`customer-repair-tab-${tab.number}`} type="button" role="tab" aria-selected={detailsTab === tab.id} aria-controls={`customer-repair-panel-${tab.id}`} tabIndex={detailsTab === tab.id ? 0 : -1} onClick={() => { setDetailsTab(tab.id); detailsBodyRef.current?.scrollTo({ top: 0 }); }} onKeyDown={(event) => { if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return; event.preventDefault(); const target = detailsTab === "details" ? "history" : "details"; setDetailsTab(target); requestAnimationFrame(() => document.getElementById(`customer-repair-tab-${target === "details" ? 1 : 2}`)?.focus()); }} className={`flex min-h-[62px] w-full min-w-0 items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${detailsTab === tab.id ? darkMode ? "border-red-400 bg-red-500/15 shadow-sm" : "border-red-600 bg-red-50 shadow-sm" : darkMode ? "border-slate-700 bg-slate-900/50 hover:bg-slate-800" : "border-slate-200 bg-white hover:bg-slate-50"}`}><span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${detailsTab === tab.id ? "bg-red-600 text-white" : darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`}>{tab.number}</span><span className="min-w-0"><span className={`block truncate text-xs font-bold sm:text-sm ${darkMode ? "text-slate-100" : "text-slate-800"}`}>{tab.title}</span><span className={`hidden truncate text-[11px] sm:block ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{tab.detail}</span></span></button>)}</div>{detailsTab === "details" && <div role="tabpanel" id="customer-repair-panel-details" aria-labelledby="customer-repair-tab-1" className="space-y-4 pt-3">
      <div className={`grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 ${darkMode ? "border-slate-700 bg-slate-950/40" : "border-slate-200 bg-slate-50"}`}><div><p className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Status</p><p className="mt-1"><span className="inline-flex rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-bold text-sky-700">{statusLabels[detailsRepair.status] || "Repair update"}</span></p></div><div><p className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Service type</p><p className="mt-1 text-sm font-semibold">{repairServiceType(detailsRepair)}</p></div><div><p className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Ticket</p><p className="mt-1 break-all text-sm font-semibold">{detailsRepair.repairTrackingId || "Ticket number pending"}</p></div><div><p className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Submitted</p><p className="mt-1 text-sm font-semibold">{new Date(detailsRepair.requestedAt || detailsRepair.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</p></div></div>
<section className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}><div className="grid gap-3 sm:grid-cols-2"><div className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-[#f0f1ee]"}`}><p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Current status</p><p className="mt-1.5"><span className="inline-flex rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-bold text-sky-700">{statusLabels[detailsRepair.status] || "Repair update"}</span></p></div><div className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-[#f0f1ee]"}`}><p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Request type</p><p className="mt-1.5 text-sm font-semibold">{repairServiceType(detailsRepair, true)}</p></div></div><div className={`mt-4 border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><h4 className="text-[11px] font-extrabold uppercase tracking-wider">Customer information</h4><div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2"><div><p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Customer name</p><p className="mt-1 text-[15px] font-semibold">{detailsRepair.customerName || "Not available"}</p></div><div><p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Email address</p><p className="mt-1 break-all text-sm">{detailsRepair.customerEmail || "Not provided"}</p></div><div><p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Phone number</p><p className="mt-1 text-sm font-semibold">{detailsRepair.customerPhone || "Not provided"}</p></div><div><p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Order</p><p className="mt-1 text-sm">{detailsRepair.orderTracking || "Not available"}</p></div><div className="sm:col-span-2"><p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Site address</p><p className="mt-1 break-words text-sm">{detailsRepair.siteAddress || "Not provided"}</p></div></div><div className={`mt-4 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Product</p><p className="mt-1.5 text-sm font-semibold">{detailsRepair.productName}</p>{detailsRepair.installationDate && <p className="mt-1 text-xs opacity-70">Installed {repairDateLabel(detailsRepair.installationDate)}</p>}</div></div></section>
      <section className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white"}`}><h4 className="text-xs font-bold uppercase tracking-wide">Reported issue</h4><p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{detailsRepair.issueDescription || "No issue details provided."}</p>{detailsRepair.mediaUrls?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{detailsRepair.mediaUrls.map((url, index) => <button key={`${url}-${index}`} type="button" onClick={() => setPreviewMedia(url)} aria-label={`View repair photo ${index + 1}`} className="size-16 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">{/\.(mp4|webm|mov)(\?|$)/i.test(url) ? <video src={url} className="h-full w-full object-cover" /> : <img src={url} alt={`Repair evidence ${index + 1}`} className="h-full w-full object-cover" />}</button>)}</div>}</section>
      {(detailsRepair.schedule?.startDate || detailsRepair.schedule?.date) && <section className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><h4 className="text-xs font-bold uppercase tracking-wide">Repair schedule</h4><p className="mt-2 text-sm font-semibold">Scheduled start: {repairDateLabel(detailsRepair.schedule.startDate || detailsRepair.schedule.date)}</p>{actualRepairStart(detailsRepair) && <p className="mt-1 text-sm font-semibold">Actual start: {repairDateLabel(actualRepairStart(detailsRepair))}</p>}<p className="mt-1 text-sm font-semibold">Scheduled finish: {repairDateLabel(detailsRepair.schedule.finishDate || detailsRepair.schedule.startDate || detailsRepair.schedule.date)}</p>{detailsRepair.completion?.completedAt && <p className="mt-1 text-sm font-semibold">Actual completion: {repairDateLabel(detailsRepair.completion.completedAt)}</p>}{detailsRepair.schedule.notes && <p className={`mt-2 whitespace-pre-wrap text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{detailsRepair.schedule.notes}</p>}</section>}
      {detailsRepair.inspection?.notes && <section className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><h4 className="text-xs font-bold uppercase tracking-wide">Admin inspection findings</h4><p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{detailsRepair.inspection.notes}</p>{detailsRepair.inspection.evidenceUrls?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{detailsRepair.inspection.evidenceUrls.map((url, index) => <button key={url} type="button" onClick={() => setPreviewMedia(url)} aria-label={`View inspection evidence ${index + 1}`} className="size-16 overflow-hidden rounded-lg border"><img src={url} alt={`Inspection evidence ${index + 1}`} className="h-full w-full object-cover" /></button>)}</div>}</section>}
      {detailsRepair.warranty?.decisionReason && <section className={`rounded-2xl border p-4 ${darkMode ? "border-amber-800/60 bg-amber-950/20" : "border-amber-200 bg-amber-50/70"}`}><h4 className="text-xs font-bold uppercase tracking-wide">Warranty assessment</h4><p className="mt-2 text-sm font-semibold">{detailsRepair.warranty.issueExcluded ? "Excluded for this repair issue" : detailsRepair.warranty.status || "Coverage reviewed"}</p>{(detailsRepair.warranty.startsAt || detailsRepair.warranty.expiresAt) && <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-600"}`}>Original product warranty: {detailsRepair.warranty.startsAt ? `started ${repairDateLabel(detailsRepair.warranty.startsAt)}` : "start date unavailable"}{detailsRepair.warranty.expiresAt ? ` · expires ${repairDateLabel(detailsRepair.warranty.expiresAt)}` : ""}</p>}<p className={`mt-1 whitespace-pre-wrap text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{detailsRepair.warranty.decisionReason}</p></section>}
      {detailsRepair.quotation?.issuedAt && <section className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><div className="flex items-center justify-between gap-3"><div><h4 className="text-xs font-bold uppercase tracking-wide">Repair quotation</h4><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Issued {repairDateLabel(detailsRepair.quotation.issuedAt)}</p></div><span className="text-sm font-extrabold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(detailsRepair.quotation.total)}</span></span></div><dl className="mt-3 space-y-2 text-sm">{(detailsRepair.quotation.parts || []).map((part, index) => <div key={`${part.description}-${index}`} className="flex justify-between gap-4"><dt className={darkMode ? "text-slate-300" : "text-slate-600"}>{part.description}</dt><dd className="shrink-0 font-semibold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(part.cost)}</span></dd></div>)}<div className="flex justify-between gap-4 border-t border-slate-500/20 pt-2"><dt>Service fee</dt><dd className="shrink-0 font-semibold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(detailsRepair.quotation.laborCost)}</span></dd></div></dl><p className="mt-2 border-t border-slate-500/20 pt-2 text-sm font-extrabold">Total <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(detailsRepair.quotation.total)}</span></p>{detailsRepair.quotation.notes && <p className={`mt-3 border-t pt-3 text-sm ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-600"}`}>{detailsRepair.quotation.notes}</p>}{detailsRepair.quotation.customerDecisionAt && <p className={`mt-3 text-xs font-semibold ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Your {detailsRepair.status === "quotation_declined" ? "decline" : "acceptance"} was recorded {new Date(detailsRepair.quotation.customerDecisionAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}.</p>}{detailsRepair.quotationHistory?.length > 0 && <details className="mt-3 border-t border-slate-500/20 pt-3"><summary className="cursor-pointer text-xs font-bold">Previous quotation versions ({detailsRepair.quotationHistory.length})</summary><ol className="mt-2 space-y-2">{detailsRepair.quotationHistory.map((version, index) => <li key={`${version.issuedAt}-${index}`} className="rounded-lg bg-slate-500/5 p-2 text-xs">{repairDateLabel(version.issuedAt)} · <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(version.total)}</span>{version.notes ? ` · ${version.notes}` : ""}</li>)}</ol></details>}</section>}
      {detailsRepair.completion?.notes && <section className={`rounded-2xl border p-4 ${darkMode ? "border-emerald-800 bg-emerald-950/20" : "border-emerald-200 bg-emerald-50/70"}`}><h4 className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-300"><CircleCheck size={16} />Repair completed</h4><p className={`mt-2 whitespace-pre-wrap text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{detailsRepair.completion.notes}</p><p className={`mt-2 text-xs font-semibold ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{detailsRepair.payment?.status === "not_required" ? "Payment status: Not required" : `Verified paid: ${money(detailsRepair.payment?.verifiedAmount)} of ${money(detailsRepair.quotation?.total)} · Balance: ${money(Math.max(0, Number(detailsRepair.quotation?.total || 0) - Number(detailsRepair.payment?.verifiedAmount || 0)))} · Status: ${["paid", "received"].includes(detailsRepair.payment?.status) ? "Paid" : detailsRepair.payment?.status === "partial" ? "Partially Paid" : "Pending"}`}</p></section>}
      </div>}{detailsTab === "history" && <section role="tabpanel" id="customer-repair-panel-history" aria-labelledby="customer-repair-tab-2" className={`rounded-2xl border p-4 sm:p-5 ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white shadow-sm"}`}><div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-extrabold">Repair history</h4><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Updates recorded for this ticket</p></div>{detailsHistory.length > 0 && <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>{detailsHistory.length} updates</span>}</div>{detailsHistory.length ? <ol className="mt-4 space-y-3">{detailsHistory.map((entry, index) => { const eventDate = new Date(entry.createdAt); const validDate = !Number.isNaN(eventDate.getTime()); return <li key={`${entry.createdAt}-${index}`} className="flex gap-3"><span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${index === detailsHistory.length - 1 ? "bg-red-600" : "bg-slate-400"}`} /><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-bold">{String(entry.event || "Update").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())}</p>{validDate && <time dateTime={eventDate.toISOString()} className={`text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{eventDate.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</time>}</div>{entry.detail && <p className={`mt-1 whitespace-pre-wrap text-sm leading-5 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{entry.detail}</p>}</div></li>; })}</ol> : <p className={`mt-3 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>No history updates yet.</p>}</section>}
      {detailsRepair.payment?.proofUrl && <button type="button" onClick={() => setPreviewMedia(detailsRepair.payment.proofUrl)} className="inline-flex items-center gap-2 text-sm font-semibold text-sky-700 underline"><FileText size={15} />View submitted payment proof{detailsRepair.payment.proofFileName ? ` · ${detailsRepair.payment.proofFileName}` : ""}</button>}
      </div></section></div>}
    {requestOpen && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-0 sm:p-3" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setRequestOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="repair-request-title" className={`h-[100dvh] max-h-[100dvh] w-full overflow-y-auto border p-5 shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:max-w-xl sm:rounded-2xl ${panel}`}><header className="mb-4 flex items-start justify-between"><div><h3 id="repair-request-title" className="font-bold">{requestMode === "warranty" ? "Request Warranty Claim" : "Request Out-of-Warranty Repair"}</h3><p className="mt-1 text-xs opacity-70">{requestMode === "warranty" ? "Choose a completed order product with active warranty coverage." : "Choose a completed order product that is outside active warranty coverage."}</p></div><button type="button" onClick={() => setRequestOpen(false)} aria-label="Close request form"><X size={18} /></button></header><div role="group" aria-label="Repair request type" className={"mb-4 grid grid-cols-2 gap-2 rounded-xl border p-1 " + (darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-slate-50")}>
        {[{ value: "warranty", label: "Warranty Claim" }, { value: "paid", label: "Out-of-Warranty Repair" }].map((tab) => <button key={tab.value} type="button" aria-pressed={requestMode === tab.value} onClick={() => { setRequestMode(tab.value); setSelected(""); setProductDropdownOpen(false); setProductSearch(""); setOutOfWarrantyAcknowledged(false); setIssue(""); setMedia([]); }} className={"min-h-10 rounded-lg px-2.5 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 " + (requestMode === tab.value ? darkMode ? "bg-red-700 text-white shadow-sm" : "bg-red-700 text-white shadow-sm" : darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-white")}>{tab.label}</button>)}
      </div>
      {unconfirmedWarrantyProducts > 0 && <p className={`mb-4 rounded-xl border p-3 text-xs leading-5 ${darkMode ? "border-sky-800 bg-sky-950/30 text-sky-200" : "border-sky-200 bg-sky-50 text-sky-800"}`}>{unconfirmedWarrantyProducts} completed project{unconfirmedWarrantyProducts === 1 ? " has" : "s have"} no confirmed warranty expiry yet, so {unconfirmedWarrantyProducts === 1 ? "it is" : "they are"} not listed as out-of-warranty. Please contact ACGC to confirm coverage.</p>}
      <form id="repair-request-form" onSubmit={submit} className="space-y-4"><div><label htmlFor="customer-repair-order-product" className="block text-xs font-semibold">Completed project product</label><div className="relative mt-1">
        <button id="customer-repair-order-product" type="button" role="combobox" aria-haspopup="listbox" aria-expanded={productDropdownOpen} aria-controls="customer-repair-order-products" aria-required="true" onClick={() => { if (productDropdownOpen) setProductSearch(""); setProductDropdownOpen((open) => !open); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setProductDropdownOpen(false); setProductSearch(""); } }} className={`flex h-[42px] w-full items-center justify-between gap-3 rounded-xl border px-3 text-left text-sm ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-red-300 bg-white text-slate-800"}`}>
          <span className="min-w-0 truncate">{selectedProductOption?.text || "Select product"}</span><ChevronDown size={16} className={`shrink-0 transition-transform ${productDropdownOpen ? "rotate-180" : ""}`} />
        </button>
        {productDropdownOpen && <div onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setProductDropdownOpen(false); setProductSearch(""); } }} className={`absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl border p-1.5 shadow-xl ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
          <div className="relative px-1 pb-2 pt-1"><Search size={15} className={`absolute left-3.5 top-3.5 ${darkMode ? "text-slate-400" : "text-slate-500"}`} /><input type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Search products..." aria-label="Search order products" className={`h-9 w-full rounded-md border pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-brand ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500" : "border-slate-200 bg-white text-slate-800 placeholder:text-slate-500"}`} /></div>
          <div id="customer-repair-order-products" role="listbox" aria-label="Order product">
          <button type="button" role="option" aria-selected={!selected} onClick={() => { setSelected(""); setProductDropdownOpen(false); setProductSearch(""); setOutOfWarrantyAcknowledged(false); }} className={`w-full rounded-xl px-2.5 py-2 text-left text-sm ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}>Select product</button>
          {filteredProductOptions.map(({ value, text, activeRepair }) => <button key={value} type="button" role="option" aria-selected={selected === value} disabled={Boolean(activeRepair)} onClick={() => { setSelected(value); setProductDropdownOpen(false); setProductSearch(""); setOutOfWarrantyAcknowledged(false); }} className={`w-full whitespace-normal break-words [overflow-wrap:anywhere] rounded-xl px-2.5 py-2.5 text-left text-[13px] leading-5 disabled:cursor-not-allowed ${activeRepair ? darkMode ? "text-amber-300 opacity-90" : "text-amber-800 opacity-90" : darkMode ? "text-slate-100 hover:bg-slate-800" : "text-slate-800 hover:bg-slate-100"}`} title={text}>{text}</button>)}
          {filteredProductOptions.length === 0 && <p className={`px-2.5 py-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{requestMode === "warranty" ? "No completed products with active warranty were found." : "No completed products outside warranty were found."}</p>}
          </div>
        </div>}
      </div></div>{selectedActiveRepair && <div role="status" className="rounded-xl border border-amber-400 bg-amber-100 p-3 text-xs text-amber-950 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">Repair request already active</p><span className="inline-flex items-center rounded-full border border-amber-500 bg-amber-300 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-amber-950">Active · {statusLabels[selectedActiveRepair.status] || selectedActiveRepair.status}</span></div><p className="mt-1">This product already has an active repair. Open the existing ticket from Repair History.</p></div>}{selectedItem && <div className={`flex items-center gap-2 rounded-lg p-3 text-xs ${selectedWarranty.active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-slate-500/10 text-slate-600 dark:text-slate-300"}`}><ShieldCheck size={15} />{selectedWarranty.active ? `Warranty Active${selectedWarranty.expiry ? ` · Valid until ${warrantyDateLabel(selectedWarranty.expiry)}` : ""}` : selectedWarranty.noWarranty ? "No warranty coverage" : `Warranty Expired${selectedWarranty.expiry ? ` · Expired ${warrantyDateLabel(selectedWarranty.expiry)}` : ""}`}</div>}<label className="block text-xs font-semibold">Describe the problem<textarea required maxLength={4000} rows={4} value={issue} onChange={(event) => setIssue(event.target.value)} className={field} /></label><div><div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs font-semibold">Defect photos <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700">Required</span></span><span className="text-[10px] font-medium text-slate-500">{media.length} / 6</span></div><label onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addMediaFiles(event.dataTransfer.files); }} className={`relative flex min-h-[112px] cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-dashed px-4 py-4 transition focus-within:ring-2 focus-within:ring-red-500/30 ${darkMode ? "border-slate-700 bg-slate-950/50 hover:border-red-500/70 hover:bg-slate-900" : "border-slate-300 bg-slate-50/80 hover:border-red-400 hover:bg-red-50/50"}`}><input type="file" accept="image/*" multiple required={media.length === 0} disabled={media.length >= 6} onChange={handleMediaSelection} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" aria-label="Choose defect images" /><span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-red-500/10 text-red-300" : "bg-red-100 text-red-700"}`}><ImagePlus size={21} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold">{media.length ? "Add more photos" : "Choose defect photos"}</span><span className={`mt-1 block text-[10px] leading-4 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Drag and drop or browse. JPG, PNG, WEBP. Up to 6 images</span></span><span className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-bold ${darkMode ? "border-slate-700 bg-slate-800 text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}><Upload size={13} />Browse</span></label><p className="mt-1.5 text-[10px] text-slate-500">Upload clear photos showing the damaged area from different angles.</p>{media.length > 0 && <ul className="mt-2 grid gap-2 sm:grid-cols-2">{media.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 ${darkMode ? "border-slate-700 bg-slate-950/60" : "border-slate-200 bg-white"}`}><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700"><Image size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold" title={file.name}>{file.name}</span><span className="block text-[9px] text-slate-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</span></span><button type="button" onClick={() => setMedia((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700"><X size={14} /></button></li>)}</ul>}</div>{selectedItem && requestMode === "paid" && (selectedWarranty.expired || selectedWarranty.noWarranty) && <div className={"rounded-xl border p-3 text-xs " + (darkMode ? "border-amber-700/60 bg-amber-950/30 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900")}><p className="font-bold">This is an out-of-warranty paid repair request, not a warranty claim.</p><p className="mt-1 leading-5">ACGC will inspect the project and provide a quotation. No paid repair work begins until you accept it.</p><label className="mt-3 flex cursor-pointer items-start gap-2 font-semibold leading-5"><input type="checkbox" required checked={outOfWarrantyAcknowledged} onChange={(event) => setOutOfWarrantyAcknowledged(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-red-700" /><span>I understand this request is outside warranty coverage and may require payment.</span></label></div>}<div className="flex justify-end gap-2"><button type="button" onClick={() => setRequestOpen(false)} className="rounded-lg border px-4 py-2 text-xs">Cancel</button><button type="submit" disabled={submitting || !selectedItem || Boolean(selectedActiveRepair) || (requestMode === "paid" && !outOfWarrantyAcknowledged)} className="rounded-lg bg-red-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{submitting ? submitStage === "Uploading photos" ? `Uploading photos ${uploadProgress}%` : "Saving request..." : (requestMode === "warranty" ? "Submit warranty claim" : "Submit paid repair request")}</button></div></form></section></div>}
    {quotationConfirmation && <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/70 p-4" role="alertdialog" aria-modal="true" aria-labelledby="quotation-confirm-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) setQuotationConfirmation(null); }}><section className={`max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-2xl ${panel}`}><div className="flex items-start gap-3"><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${quotationConfirmation.action === "accept" ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"}`}>{quotationConfirmation.action === "accept" ? <CheckCircle2 size={20} /> : <XCircle size={20} />}</span><div className="min-w-0"><h3 id="quotation-confirm-title" className="font-bold">{quotationConfirmation.action === "accept" ? "Accept this quotation?" : "Decline this quotation?"}</h3><p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{quotationConfirmation.repair.productName}</p></div><button type="button" onClick={() => setQuotationConfirmation(null)} disabled={Boolean(busyId)} aria-label="Close confirmation" className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-slate-500/10 disabled:opacity-50"><X size={18} /></button></div>
      <div className={`mt-4 rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900/70" : "border-slate-200 bg-slate-50"}`}>
        {quotationConfirmation.repair.warranty?.issueExcluded && <div className="mb-3 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-xs"><p className="font-bold text-amber-800 dark:text-amber-200">Warranty exclusion for this repair issue</p><p className="mt-1 whitespace-pre-wrap">{quotationConfirmation.repair.warranty.decisionReason}</p></div>}
        {quotationConfirmation.repair.inspection?.notes && <div className="mb-3"><h4 className="text-[10px] font-bold uppercase tracking-wide opacity-60">Inspection findings</h4><p className="mt-1 whitespace-pre-wrap text-xs leading-5">{quotationConfirmation.repair.inspection.notes}</p></div>}
        {(quotationConfirmation.repair.inspection?.evidenceUrls || []).length > 0 && <div className="mb-3"><h4 className="mb-2 text-[10px] font-bold uppercase tracking-wide opacity-60">Inspection photos</h4><div className="flex flex-wrap gap-2">{quotationConfirmation.repair.inspection.evidenceUrls.map((url, index) => <button key={`${url}-${index}`} type="button" onClick={() => setPreviewMedia(url)} className="size-16 overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"><img src={url} alt={`Inspection evidence ${index + 1}`} className="h-full w-full object-cover" /></button>)}</div></div>}
        <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wide opacity-60">Itemized quotation</h4>
        <dl className="space-y-2 text-xs">{(quotationConfirmation.repair.quotation?.parts || []).map((part, index) => <div key={`${part.description}-${index}`} className="flex justify-between gap-4"><dt className="min-w-0 break-words">{part.description || "Part or material"}</dt><dd className="shrink-0 font-semibold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(part.cost)}</span></dd></div>)}<div className="flex justify-between gap-4 border-t border-dashed border-slate-400/50 pt-2"><dt>Labor and service fee</dt><dd className="shrink-0 font-semibold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(quotationConfirmation.repair.quotation?.laborCost)}</span></dd></div></dl>
        {quotationConfirmation.repair.quotation?.notes && <div className="mt-3 border-t border-slate-400/30 pt-3"><h4 className="text-[10px] font-bold uppercase tracking-wide opacity-60">Quotation notes and repair scope</h4><p className="mt-1 whitespace-pre-wrap text-xs leading-5">{quotationConfirmation.repair.quotation.notes}</p></div>}
        <div className="mt-3 flex justify-between border-t border-slate-400/40 pt-3 text-sm font-extrabold"><span>Total amount</span><span><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(quotationConfirmation.repair.quotation?.total)}</span></span></div>
      </div>
      <p className={`mt-3 text-sm leading-5 ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{quotationConfirmation.action === "accept" ? "Accepting confirms that you agree to the itemized repair quotation above. Our team can then proceed with scheduling." : "Declining means you do not want to proceed with this paid repair. Your ticket and inspection history will remain saved."}</p><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setQuotationConfirmation(null)} disabled={Boolean(busyId)} className="min-h-10 rounded-lg border px-4 text-sm font-semibold">Go back</button><button type="button" onClick={() => void confirmQuotationResponse()} disabled={Boolean(busyId)} className={`min-h-10 rounded-lg px-4 text-sm font-bold text-white disabled:opacity-50 ${quotationConfirmation.action === "accept" ? "bg-emerald-700" : "bg-red-700"}`}>{quotationConfirmation.action === "accept" ? "Confirm acceptance" : "Confirm decline"}</button></div></section></div>}
    <RepairReceiptModal repair={receiptRepair} darkMode={darkMode} onClose={() => setReceiptRepair(null)} />
    {rejectionDetails && <div className="fixed inset-0 z-[145] flex items-center justify-center bg-slate-950/70 p-0 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setRejectionDetails(null); }}><section role="dialog" aria-modal="true" aria-labelledby="repair-rejection-title" className={`h-[100dvh] w-full overflow-y-auto p-5 shadow-2xl sm:h-auto sm:max-h-[85dvh] sm:max-w-xl sm:rounded-2xl ${panel}`}><header className="mb-5 flex items-start justify-between gap-4"><div><span className="inline-flex rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">Repair rejected</span><h3 id="repair-rejection-title" className="mt-2 text-lg font-extrabold">Rejection details</h3><p className="mt-1 text-xs opacity-70">{rejectionDetails.productName} · Order {rejectionDetails.orderTracking || "—"}</p></div><button type="button" onClick={() => setRejectionDetails(null)} aria-label="Close rejection details" className="rounded-lg p-2 hover:bg-slate-500/10"><X size={18} /></button></header><div className="space-y-3"><div className={`rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-slate-50"}`}><h4 className="text-[10px] font-bold uppercase tracking-wider opacity-60">Reported issue</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{rejectionDetails.issueDescription || "No issue description was provided."}</p></div><div className="rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900/60 dark:bg-red-950/20"><h4 className="text-[10px] font-bold uppercase tracking-wider text-red-800 dark:text-red-300">Reason for rejection</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{rejectionDetails.warranty?.decisionReason || "No rejection reason was provided."}</p></div>{rejectionDetails.inspection?.notes && <div className={`rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white"}`}><h4 className="text-[10px] font-bold uppercase tracking-wider opacity-60">Inspection findings</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{rejectionDetails.inspection.notes}</p></div>}{rejectionDetails.mediaUrls?.length > 0 && <div className={`rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white"}`}><h4 className="mb-3 text-[10px] font-bold uppercase tracking-wider opacity-60">Submitted photos</h4><div className="flex flex-wrap gap-2">{rejectionDetails.mediaUrls.map((url, index) => <button key={url} type="button" onClick={() => setPreviewMedia(url)} aria-label={`View submitted photo ${index + 1}`} className="size-16 overflow-hidden rounded-lg border border-slate-200"><img src={url} alt={`Submitted repair evidence ${index + 1}`} className="h-full w-full object-cover" /></button>)}</div></div>}</div><footer className="mt-5 flex justify-end"><button type="button" onClick={() => setRejectionDetails(null)} className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white dark:bg-slate-700">Close</button></footer></section></div>}
    {duplicateRepair && <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/75 p-4"><section role="dialog" aria-modal="true" aria-labelledby="active-repair-title" className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${panel}`}><h3 id="active-repair-title" className="text-base font-bold">Repair request already in progress</h3><p className="mt-2 text-sm leading-6">You already have an active repair request for this product under this project. Please wait until it is completed or closed before submitting another request.</p><div className={`mt-4 rounded-xl border p-3 text-sm ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-slate-50"}`}><p><span className="font-semibold">Ticket:</span> {duplicateRepair.repairTrackingId || "Pending"}</p><p className="mt-1"><span className="font-semibold">Status:</span> {statusLabels[duplicateRepair.status] || duplicateRepair.status}</p>{(duplicateRepair.schedule?.startDate || duplicateRepair.schedule?.date) && <p className="mt-1"><span className="font-semibold">Scheduled:</span> {new Date(duplicateRepair.schedule.startDate || duplicateRepair.schedule.date).toLocaleDateString("en-PH", { dateStyle: "medium" })}</p>}</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDuplicateRepair(null)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Close</button><button type="button" onClick={() => { setRequestOpen(false); setDetailsRepair(duplicateRepair); setDuplicateRepair(null); }} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white">View existing ticket</button></div></section></div>}
    <MediaPreviewModal src={previewMedia} darkMode={darkMode} onClose={() => setPreviewMedia(null)} />
  </section>;
}
