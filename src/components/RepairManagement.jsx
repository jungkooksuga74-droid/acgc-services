import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Search, Eye, CalendarDays, CheckCircle2, ChevronDown, Clock3, FileText, Image, ImagePlus, LoaderCircle, Play, ShieldCheck, Upload, Wrench, X } from "lucide-react";
import toast from "react-hot-toast";
import { approveWarrantyClaim, rejectWarrantyClaim, completeRepair, closeDuplicateRepair, createAdminRepairRequest, getAdminCustomerRepairProducts, getRepairRequests, issueRepairQuotation, reviewRepairPaymentProof, recordRepairPayment, generateRepairReceipt, scheduleRepair, startRepair } from "@/api/repairs";
import { uploadFiles } from "@/api/uploads";
import { searchCustomers } from "@/api/users";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import RepairReceiptModal from "@/components/RepairReceiptModal";
import MediaPreviewModal from "@/components/MediaPreviewModal";
import FilterDropdown from "@/components/FilterDropdown";
import useNotificationHighlight from "@/hooks/useNotificationHighlight";
import { useAuth } from "@/contexts/AuthContext";

const money = (value) => `PHP ${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = { pending_review: "Pending Review", quotation_pending_approval: "Awaiting Customer Decision", quotation_declined: "Quotation Declined", customer_accepted: "Quotation Accepted", admin_approved: "Warranty Approved", scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed", cancelled: "Closed", rejected: "Repair Rejected" };
const warrantyInspectionFindingPresets = [
  "No visible damage found during inspection.",
  "Product is misaligned and needs adjustment.",
  "Hardware is loose or damaged and needs repair.",
  "Sealant or weather stripping is worn and needs replacement.",
  "Frame is damaged and needs repair.",
  "Glass is damaged and needs replacement.",
  "Corrosion is present on the product components.",
  "Water leakage is present around the product.",
  "Others",
];
const adminNextStep = (repair) => {
  if (repair.payment?.proofReviewStatus === "pending") return "Review the customer’s payment proof.";
  if (repair.status === "pending_review" && repair.workflowType === "warranty") return "Inspect the claim, then approve it or issue a quote if coverage does not apply.";
  if (repair.status === "pending_review") return "Inspect the issue and prepare a quotation for the customer.";
  if (repair.status === "quotation_pending_approval") return "Waiting for the customer to accept or decline the quotation.";
  if (["customer_accepted", "admin_approved"].includes(repair.status)) return "Arrange the service dates with the customer.";
  if (repair.status === "scheduled") return "Start the repair when the service visit begins.";
  if (repair.status === "in_progress") return "Record completion notes and optional photos when finished.";
  if (repair.status === "completed") return "No further action required.";
  if (["cancelled", "quotation_declined", "rejected"].includes(repair.status)) return "Request closed. Review the ticket details if needed.";
  return "Review the ticket details and update the customer.";
};
const isVideo = (url) => /\.(mp4|webm|mov)(\?|$)/i.test(url);
const repairDateKey = (value) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};
const repairDateLabel = (value) => value ? new Date(value).toLocaleDateString("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }) : "—";
const getDisplayRepairHistory = (history = []) => history.reduce((visible, entry) => {
  const currentTime = new Date(entry.createdAt).getTime();
  const isDuplicate = visible.some((previous) => {
    const previousTime = new Date(previous.createdAt).getTime();
    return previous.event === entry.event
      && previous.detail === entry.detail
      && String(previous.actor || "") === String(entry.actor || "")
      && Number.isFinite(currentTime)
      && Number.isFinite(previousTime)
      && Math.abs(currentTime - previousTime) <= 60_000;
  });
  return isDuplicate ? visible : [...visible, entry];
}, []);
const getActualStartDate = (repair) => repair.startedAt || repair.history?.find((entry) => entry.event === "in_progress")?.createdAt;
const getWarrantyCoverageText = (warranty) => {
  const status = String(warranty?.status || "Coverage unknown").replaceAll("_", " ");
  if (!warranty?.expiresAt) return status;
  const expiry = new Date(warranty.expiresAt).toLocaleDateString("en-PH");
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === "active") return `Active through ${expiry}`;
  if (normalizedStatus === "voided") return `Voided (originally valid through ${expiry})`;
  if (normalizedStatus === "expired") return `Expired on ${expiry}`;
  return `${status} · through ${expiry}`;
};
const getRepairServiceType = (repair, verbose = false) => {
  if (repair.workflowType === "warranty") return verbose ? "Warranty claim · Free service" : "Warranty claim";
  const status = String(repair.warranty?.status || "").toLowerCase();
  const expiryValue = repair.warranty?.expiresAt;
  const expiry = expiryValue ? new Date(expiryValue) : null;
  const expired = status === "no_warranty" || (expiry && !Number.isNaN(expiry.getTime()) ? expiry < new Date() : status === "expired");
  if (repair.warranty?.issueExcluded && !expired) return "Paid repair · excluded issue";
  if (expired) return verbose ? "Out-of-warranty paid repair" : "Out-of-warranty repair";
  return "Paid repair";
};
const getRepairProductOptionLabel = (product) => {
  const dimensions = product.width > 0 && product.height > 0
    ? `${product.width} × ${product.height} ${product.measurementUnit || "in"}`
    : "Size not specified";
  const warrantyStatus = String(product.warranty?.status || "unknown").replaceAll("_", " ");
  const warrantyExpiry = product.warranty?.expiresAt
    ? new Date(product.warranty.expiresAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "";
  const warranty = warrantyExpiry && warrantyStatus === "active"
    ? `Warranty active until ${warrantyExpiry}`
    : warrantyExpiry && warrantyStatus === "expired"
      ? `Warranty expired on ${warrantyExpiry}`
      : warrantyExpiry && warrantyStatus === "voided"
        ? `Warranty voided (originally until ${warrantyExpiry})`
        : `Warranty ${warrantyStatus}`;
  return `${product.productName} · ${dimensions} · Qty ${product.quantity || 1} · ${warranty}`;
};
const getRepairStatusBadgeClass = (status, dark) => {
  if (status === "rejected") return dark ? "bg-red-500/15 text-red-300" : "bg-red-100 text-red-700";
  if (status === "completed") return dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-700";
  if (status === "pending_review") return dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-800";
  return dark ? "bg-sky-500/15 text-sky-300" : "bg-sky-500/10 text-sky-700";
};
const isRepairReceiptEligible = (repair) => repair?.workflowType === "warranty"
  ? repair.status === "completed" && repair.payment?.status === "not_required"
  : repair?.workflowType === "paid"
    && Number(repair.payment?.verifiedAmount || repair.payment?.proofAmount || 0) >= Number(repair.quotation?.total || 0)
    && ((repair.payment?.status === "paid" && Boolean(repair.payment?.verifiedAt && repair.payment?.verifiedBy) && (repair.payment?.records || []).some((record) => Number(record.amount) > 0 && record.paymentDate && record.method && record.verifiedAt && record.verifiedBy)) || (Boolean(repair.receipt?.number) && repair.payment?.status === "received" && repair.payment?.proofReviewStatus === "approved" && repair.payment?.proofReviewedAt && repair.history?.some((entry) => entry.event === "payment_proof_approved" && entry.actor)));
const getVerifiedPaymentAmountForUi = (repair) => Number(repair?.payment?.verifiedAmount)
  || (repair?.payment?.status === "received" && repair.payment.proofReviewStatus === "approved" ? Number(repair.payment.proofAmount) || 0 : 0);

export default function RepairManagement({ darkMode, hideOverview = false }) {
  const { user } = useAuth();
  const repairModuleAccess = user?.staff_access?.modules?.repair_management;
  const canCreateRepair = user?.role !== "skilled_worker" || (
    repairModuleAccess?.enabled === true && repairModuleAccess.actions?.create === true
  );
  const canManageRepairs = user?.role !== "skilled_worker" || (
    repairModuleAccess?.enabled === true && repairModuleAccess.actions?.manage === true
  );
  const canManagePayments = ["admin", "super_admin"].includes(user?.role);
  const location = useLocation();
  const highlightedNotificationRecordId = useNotificationHighlight(location);
  const [repairs, setRepairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [queue, setQueue] = useState("all");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(null);
  const [action, setAction] = useState("");
  const quotationSubmitLock = useRef(false);
  const [detailsTab, setDetailsTab] = useState("details");
  const detailsBodyRef = useRef(null);
  const [review, setReview] = useState({ inspectionNotes: "", decisionReason: "" });
  const [reviewFindingChoice, setReviewFindingChoice] = useState("");
  const [reviewFindingMenuOpen, setReviewFindingMenuOpen] = useState(false);
  const [reviewFindingActiveIndex, setReviewFindingActiveIndex] = useState(0);
  const reviewFindingMenuRef = useRef(null);
  const reviewFindingTriggerRef = useRef(null);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false);
  const [startConfirm, setStartConfirm] = useState(null);
  const [quote, setQuote] = useState({ inspectionNotes: "", decisionReason: "", quotationNotes: "", laborCost: "", parts: [{ description: "", cost: "" }], voidWarranty: false });
  const [quotePreview, setQuotePreview] = useState(false);
  const [inspectionEvidenceFiles, setInspectionEvidenceFiles] = useState([]);
  const [schedule, setSchedule] = useState({ startDate: "", finishDate: "", notes: "" });
  const [completion, setCompletion] = useState({ notes: "" });
  const [repairDraft, setRepairDraft] = useState({ customerId: "", orderId: "", productIndex: "", customerName: "", customerEmail: "", customerPhone: "", orderTracking: "", productName: "", issueDescription: "", workflowType: "paid" });
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerProducts, setCustomerProducts] = useState([]);
  const [customerProductsLoading, setCustomerProductsLoading] = useState(false);
  const [productChoice, setProductChoice] = useState("");
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [paymentRejectionReason, setPaymentRejectionReason] = useState("");
  const [duplicateResolutionReason, setDuplicateResolutionReason] = useState("");
  const [paymentRecordDraft, setPaymentRecordDraft] = useState({ amount: "", paymentDate: "", method: "", reference: "" });
  const [paymentConfirm, setPaymentConfirm] = useState(null);
  const [paymentVerifiedConfirmed, setPaymentVerifiedConfirmed] = useState(false);
  const [paymentMethodForProof, setPaymentMethodForProof] = useState("Online payment");
  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [previewMedia, setPreviewMedia] = useState(null);
  const [receiptRepair, setReceiptRepair] = useState(null);
  const dark = darkMode;
  const card = dark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const field = `w-full rounded-lg border px-3 py-2.5 text-sm ${dark ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`;
  const todayDate = new Date();
  const todayDateKey = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
  useEffect(() => {
    if (!action && !receiptRepair && !previewMedia && !startConfirm) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleModalKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (previewMedia) setPreviewMedia(null);
      else if (receiptRepair) setReceiptRepair(null);
      else if (completeConfirmOpen) setCompleteConfirmOpen(false);
      else if (startConfirm) setStartConfirm(null);
      else setAction("");
    };
    document.addEventListener("keydown", handleModalKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleModalKeyDown);
    };
  }, [action, previewMedia, receiptRepair, completeConfirmOpen, startConfirm]);
  useEffect(() => {
    if (action !== "review" || !reviewFindingMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!reviewFindingMenuRef.current?.contains(event.target)) setReviewFindingMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("touchstart", closeOnOutsideClick);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("touchstart", closeOnOutsideClick);
    };
  }, [action, reviewFindingMenuOpen]);
  useEffect(() => {
    if (!reviewFindingMenuOpen) return;
    document.getElementById(`warranty-inspection-finding-option-${reviewFindingActiveIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [reviewFindingMenuOpen, reviewFindingActiveIndex]);
  const load = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    try { const response = await getRepairRequests(); setRepairs(response.repairs || []); }
    catch (error) { toast.error(error?.data?.message || error.message || "Unable to load repair queue."); }
    finally { if (showLoading) setLoading(false); }
  }, []);
  useEffect(() => { void load({ showLoading: true }); const unsubscribe = subscribeToRealtime(["repairs"], () => { void load(); }); return unsubscribe; }, [load]);
  useEffect(() => {
    if (action !== "create" || selectedCustomer || customerSearch.trim().length < 2) {
      setCustomerSuggestions([]);
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setCustomerSearchLoading(true);
      try {
        const response = await searchCustomers(customerSearch.trim());
        if (active) setCustomerSuggestions(response.customers || []);
      } catch (error) {
        if (active) toast.error(error?.data?.message || error.message || "Unable to search customer accounts.");
      } finally {
        if (active) setCustomerSearchLoading(false);
      }
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [action, customerSearch, selectedCustomer]);
  const visible = useMemo(() => repairs.filter((repair) => (
    queue === "all"
      || (queue === "completed" && repair.status === "completed")
      || (queue === "rejected" && repair.status === "rejected")
      || (["warranty", "paid"].includes(queue) && repair.workflowType === queue && !["rejected", "completed"].includes(repair.status))
  ) && `${repair.customerName} ${repair.customerEmail} ${repair.productName} ${repair.orderTracking}`.toLowerCase().includes(search.toLowerCase())), [repairs, queue, search]);
  const counts = { all: repairs.length, warranty: repairs.filter((repair) => repair.workflowType === "warranty" && !["rejected", "completed"].includes(repair.status)).length, warrantyTotal: repairs.filter((repair) => repair.workflowType === "warranty" && repair.status !== "rejected").length, paid: repairs.filter((repair) => repair.workflowType === "paid" && !["rejected", "completed"].includes(repair.status)).length, completed: repairs.filter((repair) => repair.status === "completed").length, rejected: repairs.filter((repair) => repair.status === "rejected").length, pending: repairs.filter((repair) => ["pending_review", "quotation_pending_approval"].includes(repair.status)).length };
  const open = (repair, name) => {
    setActive(repair); setAction(name);
    setRejectConfirmOpen(false);
    if (name === "payment") { setPaymentRejectionReason(""); setPaymentMethodForProof("Online payment"); }
    if (name === "details") { setDetailsTab("details"); setPaymentRecordDraft({ amount: "", paymentDate: todayDateKey, method: "", reference: "" }); setDuplicateResolutionReason(""); }
    if (name === "review") { setReview({ inspectionNotes: "", decisionReason: "" }); setReviewFindingChoice(""); setReviewFindingMenuOpen(false); setReviewFindingActiveIndex(0); }
    if (name === "quote") { setQuote({ inspectionNotes: "", decisionReason: repair.warranty?.decisionReason || "", quotationNotes: "", laborCost: "", parts: [{ description: "", cost: "" }], voidWarranty: repair.workflowType === "warranty" }); setQuotePreview(false); setInspectionEvidenceFiles([]); }
    if (name === "schedule") setSchedule({ startDate: repairDateKey(repair.schedule?.startDate || repair.schedule?.date), finishDate: repairDateKey(repair.schedule?.finishDate || repair.schedule?.startDate || repair.schedule?.date), notes: repair.schedule?.notes || "" });
    if (name === "complete") setCompletion({ notes: "" });
  };
  const reviewPayment = (actionName) => {
    if (actionName === "reject" && !paymentRejectionReason.trim()) return toast.error("Provide a reason for rejecting this proof.");
    if (actionName === "approve") {
      const total = Number(active?.quotation?.total || 0);
      const paid = getVerifiedPaymentAmountForUi(active);
      const amount = Number(active?.payment?.proofAmount || 0);
      setPaymentRecordDraft({ amount: String(amount), paymentDate: todayDateKey, method: paymentMethodForProof, reference: active?.payment?.proofTransactionNumber || "" });
      setPaymentVerifiedConfirmed(false);
      setPaymentConfirm({ type: "proof", fullyPaid: amount >= Math.max(0, total - paid) });
      return;
    }
    return run(active, () => reviewRepairPaymentProof(active._id, { action: actionName, reason: paymentRejectionReason.trim(), method: paymentMethodForProof }));
  };
  const submitPaymentConfirmation = async () => {
    const confirmation = paymentConfirm;
    if (!active || !confirmation) return;
    const amount = Number(paymentRecordDraft.amount);
    const total = Number(active.quotation?.total || 0);
    const paid = getVerifiedPaymentAmountForUi(active);
    const remaining = Math.max(0, total - paid);
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) return toast.error("Enter a valid payment amount no greater than the remaining balance.");
    if (!paymentRecordDraft.paymentDate) return toast.error("Enter the date the payment was received.");
    if (!paymentRecordDraft.method) return toast.error("Choose a payment method.");
    if (["Bank transfer", "GCash", "Online payment"].includes(paymentRecordDraft.method) && !paymentRecordDraft.reference.trim()) return toast.error("Enter the transaction reference for this payment method.");
    if (!paymentVerifiedConfirmed) return toast.error("Confirm that the payment was received and verified.");
    setPaymentConfirm(null);
    if (confirmation.type === "proof") return run(active, () => reviewRepairPaymentProof(active._id, { action: "approve", amount, paymentDate: paymentRecordDraft.paymentDate, method: paymentRecordDraft.method, reference: paymentRecordDraft.reference, confirmed: true, confirmFullyPaid: amount >= remaining }));
    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    return run(active, () => recordRepairPayment(active._id, { amount, paymentDate: paymentRecordDraft.paymentDate, method: paymentRecordDraft.method, reference: paymentRecordDraft.reference, requestId, confirmed: true, confirmFullyPaid: amount >= remaining }));
  };
  const openReceipt = async (repair) => {
    setBusy(String(repair._id));
    try {
      const response = await generateRepairReceipt(repair._id);
      setReceiptRepair(response.repair);
      await load();
      if (response.reprinted) toast.success("Reopening the existing repair receipt.");
    } catch (error) { toast.error(error?.data?.message || error.message || "Receipt is unavailable until full payment is verified."); }
    finally { setBusy(""); }
  };
  const run = async (repair, operation) => {
    setBusy(String(repair._id));
    try {
      const result = await operation();
      await load();
      setAction(""); setActive(null); setStartConfirm(null);
      toast.success(result?.alreadyIssued ? "This quotation was already issued and is awaiting the customer's decision." : "Repair workflow updated.");
    }
    catch (error) {
      const message = error?.data?.message || error.message || "Unable to update repair.";
      if (error?.status === 409 || error?.response?.status === 409) {
        // A concurrent customer/admin action may have advanced the ticket since this dialog opened.
        // Refresh the list and dismiss the stale form so the user sees the current workflow state.
        try { await load(); } catch { /* Keep the original conflict message visible. */ }
        setAction("");
        setActive(null);
      }
      toast.error(message);
    }
    finally { setBusy(""); }
  };
  const submitQuotation = async () => {
    if (quotationSubmitLock.current) return;
    if (quote.inspectionNotes.trim().length < 15) return toast.error("Inspection findings must be at least 15 characters.");
    if (active?.workflowType === "warranty" && quote.decisionReason.trim().length < 10) return toast.error("Warranty exclusion reason must be at least 10 characters.");
    const parts = quote.parts.filter((part) => part.description.trim() || String(part.cost).trim() !== "").map((part) => ({ description: part.description.trim() || "Part or material", cost: Number(part.cost || 0) }));
    if (!parts.length && Number(quote.laborCost) <= 0) return toast.error("Add at least one priced part or service fee.");
    if (parts.some((part) => !Number.isFinite(part.cost) || part.cost < 0) || !Number.isFinite(Number(quote.laborCost)) || Number(quote.laborCost) < 0) return toast.error("Quotation amounts must be zero or more.");
    quotationSubmitLock.current = true;
    try {
      await run(active, async () => {
        const upload = inspectionEvidenceFiles.length ? await uploadFiles(inspectionEvidenceFiles, undefined, { purpose: "repair-evidence" }) : { files: [] };
        return issueRepairQuotation(active._id, { ...quote, parts, laborCost: Number(quote.laborCost), evidenceUrls: (upload.files || []).map((file) => file.url) });
      });
    } finally { quotationSubmitLock.current = false; }
  };
  const addEvidenceFiles = (fileList) => {
    const chosen = Array.from(fileList || []);
    const images = chosen.filter((file) => file.type.startsWith("image/"));
    if (images.length !== chosen.length) toast.error("Only image files can be attached.");
    const seen = new Set(evidenceFiles.map((file) => `${file.name}-${file.size}-${file.lastModified}`));
    const uniqueImages = images.filter((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (evidenceFiles.length + uniqueImages.length > 10) toast.error("You can attach up to ten completion photos.");
    setEvidenceFiles([...evidenceFiles, ...uniqueImages].slice(0, 10));
  };
  const handleEvidenceSelection = (event) => {
    addEvidenceFiles(event.target.files);
    event.target.value = "";
  };
  const submitComplete = async () => {
    try {
      const upload = evidenceFiles.length ? await uploadFiles(evidenceFiles, undefined, { purpose: "repair-evidence" }) : { files: [] };
      await run(active, () => completeRepair(active._id, { notes: completion.notes, evidenceUrls: (upload.files || []).map((file) => file.url) }));
      setEvidenceFiles([]);
    } catch (error) { toast.error(error?.data?.message || error.message || "Unable to complete repair."); }
  };
  const submitDuplicateResolution = () => {
    if (duplicateResolutionReason.trim().length < 10) return toast.error("Explain why this duplicate ticket is being closed (at least 10 characters).");
    void run(active, async () => {
      await closeDuplicateRepair(active._id, duplicateResolutionReason.trim());
      setDuplicateResolutionReason("");
    });
  };
  const chooseCustomer = async (customer) => {
    setProductMenuOpen(false);
    setCustomerSearchLoading(false);
    setSelectedCustomer(customer);
    setCustomerSearch([customer.first_name, customer.last_name].filter(Boolean).join(" "));
    setCustomerSuggestions([]);
    setCustomerProducts([]);
    setProductChoice("");
    setRepairDraft((current) => ({ ...current, customerId: customer._id, orderId: "", productIndex: "", customerName: [customer.first_name, customer.last_name].filter(Boolean).join(" "), customerEmail: customer.email || "", customerPhone: customer.phone || "", orderTracking: "", productName: "", workflowType: "paid" }));
    setCustomerProductsLoading(true);
    try {
      const response = await getAdminCustomerRepairProducts(customer._id);
      setSelectedCustomer({ ...customer, ...(response.customer || {}) });
      setCustomerProducts(response.products || []);
      if (!(response.products || []).length) setProductChoice("manual");
    } catch (error) {
      toast.error(error?.data?.message || error.message || "Unable to load this customer's products.");
    } finally { setCustomerProductsLoading(false); }
  };
  const clearSelectedCustomer = () => {
    setProductMenuOpen(false);
    setCustomerSearchLoading(false);
    setSelectedCustomer(null);
    setCustomerSearch("");
    setCustomerProducts([]);
    setProductChoice("");
    setRepairDraft((current) => ({ ...current, customerId: "", orderId: "", productIndex: "", customerName: "", customerEmail: "", customerPhone: "", orderTracking: "", productName: "", workflowType: "paid" }));
  };
  const chooseProduct = (value) => {
    setProductMenuOpen(false);
    setProductChoice(value);
    if (!value || value === "manual") {
      setRepairDraft((current) => ({ ...current, orderId: "", productIndex: "", orderTracking: "", productName: "", workflowType: "paid" }));
      return;
    }
    const selectedProduct = customerProducts.find((product) => `${product.orderId}:${product.productIndex}` === value);
    if (!selectedProduct) return;
    setRepairDraft((current) => ({ ...current, orderId: String(selectedProduct.orderId), productIndex: String(selectedProduct.productIndex), orderTracking: selectedProduct.orderTracking || "", productName: selectedProduct.productName, workflowType: selectedProduct.warranty?.status === "active" ? "warranty" : "paid" }));
  };
  const openCreateRepair = () => {
    setProductMenuOpen(false);
    setRepairDraft({ customerId: "", orderId: "", productIndex: "", customerName: "", customerEmail: "", customerPhone: "", orderTracking: "", productName: "", issueDescription: "", workflowType: "paid" });
    setCustomerSearch("");
    setCustomerSuggestions([]);
    setSelectedCustomer(null);
    setCustomerProducts([]);
    setCustomerProductsLoading(false);
    setProductChoice("");
    setAction("create");
  };
  const selectedRepairProduct = customerProducts.find((product) => `${product.orderId}:${product.productIndex}` === productChoice);
  const activeRepairForProduct = (product) => repairs
    .filter((repair) => ["pending_review", "quotation_pending_approval", "customer_accepted", "admin_approved", "scheduled", "in_progress"].includes(repair.status)
      && String(repair.order?._id || repair.order || "") === String(product.orderId)
      && Number(repair.productIndex) === Number(product.productIndex))
    .sort((first, second) => Number(Boolean(first.duplicateReview?.flagged)) - Number(Boolean(second.duplicateReview?.flagged)) || new Date(first.createdAt || 0) - new Date(second.createdAt || 0))[0] || null;
  const activeCustomerProductRows = customerProducts.flatMap((product) => {
    const repair = activeRepairForProduct(product);
    return repair ? [{ product, repair }] : [];
  });
  const displayedRepairHistory = getDisplayRepairHistory(active?.history || []);
  const submitRepair = async (event) => {
    event.preventDefault();
    if (selectedCustomer && !productChoice) {
      toast.error("Choose a product or enter details manually.");
      return;
    }
    setBusy("create-repair");
    try {
      await createAdminRepairRequest(repairDraft);
      setRepairDraft({ customerId: "", orderId: "", productIndex: "", customerName: "", customerEmail: "", customerPhone: "", orderTracking: "", productName: "", issueDescription: "", workflowType: "paid" });
      setCustomerSearch(""); setSelectedCustomer(null); setCustomerProducts([]); setProductChoice("");
      setAction("");
      await load();
      toast.success("Repair ticket created.");
    } catch (error) {
      if (error?.data?.code === "ACTIVE_REPAIR_EXISTS" && error.data.existingRepair) {
        setActive(error.data.existingRepair);
        setAction("details");
        void load();
        toast.error(error?.data?.message || "An active repair already exists for this project item.");
      } else toast.error(error?.data?.message || error.message || "Unable to create repair ticket.");
    }
    finally { setBusy(""); }
  };

  return <section className={`mt-6 overflow-hidden rounded-3xl border p-4 shadow-sm sm:p-6 ${card}`}>
    {!hideOverview && <><div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-2xl bg-red-700/10 text-red-600"><Wrench size={20} /></span><div><h2 className="text-lg font-extrabold tracking-tight">Warranty & Paid Repair Tickets</h2><p className={`text-xs ${muted}`}>Review each ticket’s next step, then use its action button to continue the existing workflow.</p></div></div>
    <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{[["All Tickets", counts.all, "bg-slate-500/10"], ["Needs attention", counts.pending, "bg-amber-500/10"], ["Warranty Claims", counts.warrantyTotal, "bg-emerald-500/10"], ["Paid repairs", counts.paid, "bg-sky-500/10"]].map(([title, count, tone]) => <div key={title} className={`rounded-2xl border p-3 ${dark ? "border-slate-700" : "border-slate-200"}`}><span className={`mb-2 flex size-8 items-center justify-center rounded-xl ${tone}`}><Clock3 size={15} /></span><p className={`text-[11px] font-medium ${muted}`}>{title}</p><p className="mt-0.5 text-xl font-extrabold">{count}</p></div>)}</div></>}
    {!hideOverview && <div className={`mt-4 rounded-xl border px-4 py-3 text-xs leading-5 ${dark ? "border-slate-700 bg-slate-950/50 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}><span className={`font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Repair flow:</span> Review request, inspect it, then approve or issue a quote. The customer responds to a quote when one is needed. Next, schedule the repair, start the work, and mark it complete. Warranty approvals do not need a customer-paid quotation.</div>}
    <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="hidden flex-wrap items-center gap-1.5 md:flex">{[["all", "All Tickets", counts.all], ["warranty", "Warranty Claims", counts.warranty], ["paid", "Paid Repair Requests", counts.paid], ["completed", "Completed Repairs", counts.completed], ["rejected", "Rejected Repair", counts.rejected]].map(([key, title, count]) => <button key={key} type="button" onClick={() => setQueue(key)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${queue === key ? dark ? "border-red-800/70 bg-red-950/50 text-red-100 shadow-sm" : "border-red-200 bg-red-50 text-red-950 shadow-sm" : dark ? "border-slate-700 bg-slate-800 text-slate-300 shadow-sm hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"}`}>{title}<span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${queue === key ? dark ? "bg-red-800 text-red-50" : "bg-red-200 text-red-900" : dark ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-700"}`}>{count}</span></button>)}</div><div className="w-full md:hidden"><FilterDropdown label="Repair ticket filter" value={queue} options={[["all", `All Tickets (${counts.all})`], ["warranty", `Warranty Claims (${counts.warranty})`], ["paid", `Paid Repair Requests (${counts.paid})`], ["completed", `Completed Repairs (${counts.completed})`], ["rejected", `Rejected Repair (${counts.rejected})`]]} onChange={setQueue} darkMode={dark} /></div><div className="flex flex-col gap-2 sm:flex-row"><label className="relative w-full lg:max-w-xs"><Search size={14} className="absolute left-3 top-3 opacity-50" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, product, order..." className={`${field} pl-9`} /></label>{canCreateRepair && <button type="button" onClick={openCreateRepair} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white">Add Repair</button>}</div></div>
    {loading ? <p className={`mt-5 flex items-center gap-2 text-sm ${muted}`}><LoaderCircle size={16} className="animate-spin" />Loading repair tickets...</p> : visible.length === 0 ? <div className={`mt-4 rounded-2xl border border-dashed p-9 text-center text-sm ${muted}`}><Wrench size={22} className="mx-auto mb-2 opacity-40" /><p className="font-semibold">No tickets match this view</p><p className="mt-1 text-xs">Try another filter or search term.</p></div> : <><div className={`mt-4 hidden overflow-x-auto rounded-2xl border md:block ${dark ? "border-slate-700" : "border-slate-200"}`}><table className="w-full min-w-[980px] border-collapse text-left"><thead className={dark ? "bg-slate-800/80" : "bg-slate-50"}><tr className={`text-[11px] uppercase tracking-wide ${muted}`}><th className="px-4 py-3 font-bold">Product</th><th className="px-4 py-3 font-bold">Customer / Repair ID</th><th className="px-4 py-3 font-bold">Request type</th><th className="px-4 py-3 font-bold">Status</th><th className="px-4 py-3 font-bold">Evidence</th><th className="px-4 py-3 font-bold">Schedule / Quote</th><th className="px-4 py-3 text-right font-bold">Actions</th></tr></thead><tbody className={dark ? "divide-y divide-slate-800" : "divide-y divide-slate-100"}>{visible.map((repair) => <tr key={repair._id} data-notification-record-id={String(repair._id)} data-notification-target="repair" className={`align-top transition-colors ${highlightedNotificationRecordId === String(repair._id) ? "notification-target-highlight" : ""} ${dark ? "hover:bg-slate-800/50" : "hover:bg-slate-50"}`}>
      <td className="max-w-[260px] px-4 py-4"><p className="font-bold">{repair.productName}</p>{repair.duplicateReview?.flagged && <span className="mt-1 inline-flex rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-800 dark:text-amber-300">Duplicate · review</span>}</td>
      <td className="px-4 py-4"><p className="max-w-[190px] truncate text-sm font-semibold">{repair.customerName}</p><p className={`mt-1 max-w-[190px] truncate text-xs ${muted}`}>{repair.customerEmail}</p><p className={`mt-1 break-all font-mono text-xs font-semibold ${dark ? "text-red-300" : "text-red-700"}`}>Repair ID: {repair.repairTrackingId}</p></td>
      <td className="px-4 py-4"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${repair.workflowType === "warranty" ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>{getRepairServiceType(repair)}</span><p className={`mt-2 text-xs ${muted}`}>{getWarrantyCoverageText(repair.warranty)}</p></td>
      <td className="px-4 py-4"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${getRepairStatusBadgeClass(repair.status, dark)}`}>{label[repair.status] || repair.status}</span><p className={`mt-2 max-w-[190px] text-[11px] leading-4 ${muted}`}>{adminNextStep(repair)}</p></td>
      <td className="px-4 py-4">{repair.mediaUrls?.length ? <div className="flex items-center gap-1.5">{repair.mediaUrls.slice(0, 3).map((url, index) => <button key={url} type="button" onClick={() => setPreviewMedia(url)} aria-label={`Preview evidence ${index + 1}`} className="size-11 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">{isVideo(url) ? <video src={url} className="h-full w-full object-cover" /> : <img src={url} alt="Repair evidence" className="h-full w-full object-cover" />}</button>)}{repair.mediaUrls.length > 3 && <span className={`text-[10px] ${muted}`}>+{repair.mediaUrls.length - 3}</span>}</div> : <span className={`text-xs ${muted}`}>No photos</span>}</td>
      <td className="px-4 py-4">{repair.quotation?.issuedAt && <p className="text-xs font-semibold">Quote <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(repair.quotation.total)}</span></p>}{repair.schedule?.startDate || repair.schedule?.date ? <><p className="mt-1 text-xs">Start: {repairDateLabel(["in_progress", "completed"].includes(repair.status) ? (getActualStartDate(repair) || repair.schedule.startDate || repair.schedule.date) : (repair.schedule.startDate || repair.schedule.date))}</p><p className={`mt-1 text-xs ${muted}`}>Finish: {repairDateLabel(repair.status === "completed" ? (repair.completion?.completedAt || repair.schedule.finishDate || repair.schedule.startDate || repair.schedule.date) : (repair.schedule.finishDate || repair.schedule.startDate || repair.schedule.date))}</p></> : !repair.quotation?.issuedAt && <span className={`text-xs ${muted}`}>Not scheduled</span>}</td>
      <td className="px-4 py-4"><div className="flex min-w-[170px] flex-wrap justify-end gap-1.5"><button type="button" onClick={() => open(repair, "details")} className={`rounded-lg border p-2 transition hover:bg-slate-500/10 ${dark ? "border-slate-700" : "border-slate-200"}`} aria-label="View ticket details"><Eye size={20} strokeWidth={2.6} /></button>{canManagePayments && isRepairReceiptEligible(repair) && <button type="button" onClick={() => void openReceipt(repair)} title={repair.receipt?.number ? "Reprint repair receipt" : "Generate repair receipt"} aria-label={repair.receipt?.number ? "Reprint repair receipt" : "Generate repair receipt"} className="rounded-lg bg-emerald-700 p-2 text-white"><FileText size={15} /></button>}{canManagePayments && repair.payment?.proofReviewStatus === "pending" && <button type="button" onClick={() => open(repair, "payment")} className="rounded-lg bg-sky-700 px-2.5 py-2 text-[10px] font-bold text-white">Review proof</button>}{canManageRepairs && repair.status === "pending_review" && repair.workflowType === "warranty" && <><button type="button" disabled={busy === String(repair._id)} onClick={() => open(repair, "review")} className="rounded-lg bg-emerald-700 px-2.5 py-2 text-[10px] font-bold text-white">Inspect</button><button type="button" disabled={busy === String(repair._id)} onClick={() => open(repair, "quote")} className="rounded-lg border border-amber-500 px-2.5 py-2 text-[10px] font-bold text-amber-700">Void / Quote</button></>}{canManageRepairs && repair.status === "pending_review" && repair.workflowType === "paid" && <button type="button" disabled={busy === String(repair._id)} onClick={() => open(repair, "quote")} className="rounded-lg bg-amber-600 px-2.5 py-2 text-[10px] font-bold text-white">Inspect / Quote</button>}{canManageRepairs && ["customer_accepted", "admin_approved"].includes(repair.status) && <button type="button" onClick={() => open(repair, "schedule")} className="rounded-lg bg-indigo-600 px-2.5 py-2 text-[10px] font-bold text-white">Schedule</button>}{canManageRepairs && repair.status === "scheduled" && <><button type="button" onClick={() => open(repair, "schedule")} className="rounded-lg border px-2.5 py-2 text-[10px] font-bold">Reschedule</button><button type="button" disabled={busy === String(repair._id)} onClick={() => setStartConfirm(repair)} title="Start repair" aria-label={`Start ${repair.productName} repair`} className={`rounded-lg p-2 ${dark ? "bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/70" : "bg-emerald-100 text-emerald-700"}`}><Play size={18} /></button></>}{canManageRepairs && repair.status === "in_progress" && <button type="button" onClick={() => open(repair, "complete")} className="rounded-lg bg-emerald-700 px-2.5 py-2 text-[10px] font-bold text-white">Complete</button>}{busy === String(repair._id) && <LoaderCircle size={16} className="animate-spin self-center" />}</div></td>
    </tr>)}</tbody></table></div><div className="mt-4 space-y-2.5 md:hidden">{visible.map((repair) => <article key={repair._id} data-notification-record-id={String(repair._id)} data-notification-target="repair" className={"overflow-hidden rounded-2xl border p-3.5 shadow-sm " + (highlightedNotificationRecordId === String(repair._id) ? "notification-target-highlight " : "") + (dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-[#f8f8f7]")}>
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-bold">{repair.productName}</h3><p className={"mt-0.5 truncate text-[11px] " + muted}>{repair.customerName}</p><p className={`mt-1 break-all font-mono text-xs font-semibold ${dark ? "text-red-300" : "text-red-700"}`}>Repair ID: {repair.repairTrackingId}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${getRepairStatusBadgeClass(repair.status, dark)}`}>{label[repair.status] || repair.status}</span></div>
      <div className={"mt-3 grid grid-cols-2 gap-3 border-t pt-2.5 " + (dark ? "border-slate-700" : "border-slate-200")}><div className="min-w-0"><p className={"text-[9px] font-semibold uppercase tracking-wide " + muted}>Request type</p><p className="mt-0.5 truncate text-xs font-medium">{getRepairServiceType(repair)}</p><p className={"mt-0.5 truncate text-[10px] " + muted}>{getWarrantyCoverageText(repair.warranty)}</p></div><div className="min-w-0"><p className={"text-[9px] font-semibold uppercase tracking-wide " + muted}>{repair.schedule?.startDate || repair.schedule?.date ? "Repair dates" : "Estimate"}</p><p className="mt-0.5 truncate text-xs font-semibold">{repair.schedule?.startDate || repair.schedule?.date ? `${repairDateLabel(["in_progress", "completed"].includes(repair.status) ? (getActualStartDate(repair) || repair.schedule.startDate || repair.schedule.date) : (repair.schedule.startDate || repair.schedule.date))} - ${repairDateLabel(repair.status === "completed" ? (repair.completion?.completedAt || repair.schedule.finishDate || repair.schedule.startDate || repair.schedule.date) : (repair.schedule.finishDate || repair.schedule.startDate || repair.schedule.date))}` : repair.quotation?.issuedAt ? money(repair.quotation.total) : repair.workflowType === "warranty" ? "No charge" : "Pending review"}</p><p className={"mt-0.5 truncate text-[10px] " + muted}>{repair.createdByAdmin ? "Admin created" : (repair.quotation?.issuedAt ? "Repair quotation" : "Parts + service")}</p></div></div>
       <p className={"mt-2 line-clamp-2 text-[11px] leading-4 " + (dark ? "text-slate-300" : "text-slate-600")}>{repair.issueDescription}</p>
      <p className={`mt-2 rounded-lg px-3 py-2 text-[11px] leading-4 ${dark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}><span className="font-bold">Next step: </span>{adminNextStep(repair)}</p>
      <div className={"mt-2.5 flex items-center justify-between border-t pt-2.5 " + (dark ? "border-slate-700" : "border-slate-200")}>
        {repair.mediaUrls?.[0] ? <button type="button" onClick={() => setPreviewMedia(repair.mediaUrls[0])} aria-label="Preview repair evidence" className="size-9 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">{isVideo(repair.mediaUrls[0]) ? <video src={repair.mediaUrls[0]} className="h-full w-full object-cover" /> : <img src={repair.mediaUrls[0]} alt="Repair evidence" className="h-full w-full object-cover" />}</button> : <span className={"text-[10px] " + muted}>No photo</span>}
        <div className="flex items-center gap-1.5"><button type="button" onClick={() => open(repair, "details")} title="View repair details" aria-label="View repair details" className={"rounded-lg border p-2 " + (dark ? "border-slate-700 text-slate-200" : "border-slate-200 bg-white text-slate-700")}><Eye size={20} strokeWidth={2.6} /></button>{canManagePayments && isRepairReceiptEligible(repair) && <button type="button" onClick={() => void openReceipt(repair)} title={repair.receipt?.number ? "Reprint repair receipt" : "Generate repair receipt"} aria-label={repair.receipt?.number ? "Reprint repair receipt" : "Generate repair receipt"} className="rounded-lg bg-emerald-700 p-2 text-white"><FileText size={15} /></button>}{canManagePayments && repair.payment?.proofReviewStatus === "pending" && <button type="button" onClick={() => open(repair, "payment")} title="Review payment proof" aria-label="Review payment proof" className="rounded-lg bg-sky-700 p-2 text-white"><FileText size={15} /></button>}{canManageRepairs && repair.status === "pending_review" && repair.workflowType === "warranty" && <><button type="button" disabled={busy === String(repair._id)} onClick={() => open(repair, "review")} title="Inspect and approve claim" aria-label="Inspect and approve claim" className="rounded-lg bg-emerald-700 p-2 text-white"><ShieldCheck size={15} /></button><button type="button" disabled={busy === String(repair._id)} onClick={() => open(repair, "quote")} title="Void warranty and issue quote" aria-label="Void warranty and issue quote" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-700"><FileText size={15} /></button></>}{canManageRepairs && repair.status === "pending_review" && repair.workflowType === "paid" && <button type="button" disabled={busy === String(repair._id)} onClick={() => open(repair, "quote")} title="Inspect and issue quotation" aria-label="Inspect and issue quotation" className="rounded-lg bg-amber-600 p-2 text-white"><FileText size={15} /></button>}{canManageRepairs && ["customer_accepted", "admin_approved"].includes(repair.status) && <button type="button" onClick={() => open(repair, "schedule")} title="Schedule repair" aria-label="Schedule repair" className="rounded-lg bg-indigo-600 p-2 text-white"><CalendarDays size={15} /></button>}{canManageRepairs && repair.status === "scheduled" && <><button type="button" onClick={() => open(repair, "schedule")} title="Reschedule repair" aria-label="Reschedule repair" className={"rounded-lg border p-2 " + (dark ? "border-slate-700" : "border-slate-200 bg-white")}><CalendarDays size={15} /></button><button type="button" disabled={busy === String(repair._id)} onClick={() => setStartConfirm(repair)} title="Start repair" aria-label={`Start ${repair.productName} repair`} className={`rounded-lg p-2 ${dark ? "bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/70" : "bg-emerald-100 text-emerald-700"}`}><Play size={18} /></button></>}{canManageRepairs && repair.status === "in_progress" && <button type="button" onClick={() => open(repair, "complete")} title="Complete repair" aria-label="Complete repair" className="rounded-lg bg-emerald-700 p-2 text-white"><CheckCircle2 size={15} /></button>}{busy === String(repair._id) && <LoaderCircle size={16} className="animate-spin" />}</div>
      </div>
    </article>)}</div></>}
    {action && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-0 min-[560px]:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setAction(""); }}><section role="dialog" aria-modal="true" className={`${["details", "create", "review", "quote"].includes(action) ? "flex min-h-0 flex-col overflow-hidden p-0" : "overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"} ${action === "create" ? "h-[calc(100dvh-48px)] max-h-[calc(100dvh-48px)] w-full max-w-[680px] rounded-2xl border shadow-2xl max-[619px]:h-[100dvh] max-[619px]:max-h-[100dvh] max-[619px]:rounded-none max-[619px]:border-0" : action === "review" ? "h-[530px] max-h-[calc(100dvh-48px)] w-full max-w-[560px] rounded-2xl border shadow-2xl max-[559px]:h-[100dvh] max-[559px]:max-h-[100dvh] max-[559px]:rounded-none max-[559px]:border-0" : action === "quote" ? "h-[min(700px,calc(100dvh-48px))] max-h-[calc(100dvh-48px)] w-full max-w-[680px] rounded-2xl border shadow-2xl max-[559px]:h-[100dvh] max-[559px]:max-h-[100dvh] max-[559px]:rounded-none max-[559px]:border-0" : "h-[100dvh] max-h-[100dvh] w-full max-w-none overscroll-contain rounded-none border-0 shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-2xl sm:border"} ${["details", "create", "review", "quote"].includes(action) ? "sm:p-0" : "sm:p-5"} ${card}`}><header className={action === "details"
        ? `shrink-0 flex items-start justify-between gap-4 border-b px-5 py-4 sm:rounded-t-xl sm:px-6 sm:py-5 ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-[#faf9f7]"}`
        : action === "review"
          ? `shrink-0 flex items-start justify-between gap-4 border-b px-6 py-5 ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`
        : action === "quote"
          ? `shrink-0 flex items-start justify-between gap-4 border-b px-4 py-4 sm:px-6 sm:py-5 ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`
        : action === "create"
          ? `shrink-0 flex items-start justify-between gap-4 border-b px-4 py-3 sm:px-5 ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`
          : `sticky top-[-1rem] z-10 -mx-4 -mt-4 mb-4 flex items-start justify-between px-4 pt-4 pb-2 backdrop-blur sm:static sm:mx-0 sm:mt-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:pb-0 ${dark ? "bg-slate-900/95" : "bg-white/95"}`}>
        <div className="min-w-0">
          <h3 className={action === "details" ? "text-lg font-extrabold tracking-tight sm:text-xl" : action === "review" ? "text-lg font-bold" : action === "create" ? "text-lg font-bold" : "font-bold"}>{action === "review" ? "Inspect & Approve Warranty Claim" : action === "quote" ? "Inspection & Quotation Builder" : action === "schedule" ? "Schedule repair" : action === "complete" ? "Complete repair" : action === "create" ? "Add repair ticket" : action === "payment" ? "Review customer payment proof" : "Repair ticket details"}</h3>
          <p className={`${action === "details" ? "mt-1 text-xs sm:text-sm" : action === "review" ? "mt-1 text-[12.5px]" : action === "create" ? "mt-0.5 text-[12.5px]" : "mt-1 text-xs"} ${muted}`}>{active?.productName} · {active?.customerName}</p>
        </div>
        <button type="button" onClick={() => { setAction(""); setReviewFindingMenuOpen(false); }} aria-label="Close panel" className={`flex ${action === "review" || action === "create" ? "size-8 rounded-[9px] border" : "size-9 rounded-lg"} shrink-0 items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 ${action === "review" ? "focus-visible:ring-blue-500/40" : "focus-visible:ring-red-500"} ${dark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-100"}`}><X size={18} /></button>
      </header>
      {action === "create" && <form onSubmit={submitRepair} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5" style={{ WebkitOverflowScrolling: "touch" }}>
          <p className={`flex-none rounded-[9px] border p-3 text-[13px] leading-5 ${dark ? "border-slate-700 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}>Manually create a repair ticket and enter the available customer, product, and issue details.</p>
          <div className="relative flex-none">
            <label className="block text-[12.5px] font-semibold">Find customer account (optional)<input value={customerSearch} onChange={(event) => { setProductMenuOpen(false); setCustomerSearch(event.target.value); setSelectedCustomer(null); setCustomerProducts([]); setProductChoice(""); setRepairDraft((current) => ({ ...current, customerId: "", orderId: "", productIndex: "", customerName: "", customerEmail: "", customerPhone: "", orderTracking: "", productName: "", workflowType: "paid" })); }} placeholder="Search by name, phone, or email" className={`${field} mt-1.5 h-[42px] rounded-[9px]`} /></label>
            {customerSearchLoading && <span className={`mt-1 block text-[11px] ${muted}`}>Searching customer accounts...</span>}
            {customerSuggestions.length > 0 && <ul className={`absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border p-1 shadow-xl ${card}`}>{customerSuggestions.map((customer) => <li key={customer._id}><button type="button" onClick={() => void chooseCustomer(customer)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-500/10"><span className="block text-sm font-semibold">{customer.first_name} {customer.last_name}</span><span className={`block text-xs ${muted}`}>{customer.email} {customer.phone ? `· ${customer.phone}` : ""}</span></button></li>)}</ul>}
            {selectedCustomer && <div className={`mt-2 flex flex-col gap-2 rounded-[9px] border p-2.5 sm:flex-row sm:items-center sm:justify-between ${dark ? "border-emerald-800 bg-emerald-950/30" : "border-emerald-200 bg-emerald-50"}`}><div className="flex min-w-0 items-center gap-2.5"><span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">{(selectedCustomer.customerName || `${selectedCustomer.first_name || ""} ${selectedCustomer.last_name || ""}`).trim().charAt(0).toUpperCase()}</span><div className="min-w-0"><p className="break-words text-xs font-bold">Account selected: {selectedCustomer.customerName || `${selectedCustomer.first_name || ""} ${selectedCustomer.last_name || ""}`}</p><p className={`mt-0.5 break-words text-[11px] ${dark ? "text-slate-400" : "text-slate-600"}`}>{selectedCustomer.customerPhone || selectedCustomer.phone || "No phone on account"} · {selectedCustomer.customerEmail || selectedCustomer.email}</p></div></div><button type="button" onClick={clearSelectedCustomer} className={`self-start shrink-0 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold sm:self-auto ${dark ? "border-slate-600 bg-slate-900 text-slate-200" : "border-slate-300 bg-white text-slate-700"}`}>Clear account</button></div>}
          </div>
          {!selectedCustomer && <div className="flex-none grid gap-3 sm:grid-cols-2"><label className="block text-[12.5px] font-semibold">Customer name<input required maxLength={180} value={repairDraft.customerName} onChange={(event) => setRepairDraft({ ...repairDraft, customerName: event.target.value })} className={`${field} mt-1.5 h-[42px] rounded-[9px]`} /></label><label className="block text-[12.5px] font-semibold">Phone number<input value={repairDraft.customerPhone} onChange={(event) => setRepairDraft({ ...repairDraft, customerPhone: event.target.value })} className={`${field} mt-1.5 h-[42px] rounded-[9px]`} /></label><label className="block text-[12.5px] font-semibold">Email (optional)<input type="email" value={repairDraft.customerEmail} onChange={(event) => setRepairDraft({ ...repairDraft, customerEmail: event.target.value })} className={`${field} mt-1.5 h-[42px] rounded-[9px]`} /></label></div>}
          {selectedCustomer && <div className="flex-none">
            <div className="relative">
              <span className="block text-[12.5px] font-semibold">Customer product / project{customerProductsLoading && <span className={`ml-2 font-normal ${muted}`}>Loading products...</span>}</span>
              {!customerProductsLoading && <>
                <button type="button" aria-haspopup="listbox" aria-expanded={productMenuOpen} aria-controls="repair-product-options" aria-required="true" onClick={() => setProductMenuOpen((open) => !open)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setProductMenuOpen(false); } }} className={`mt-1.5 flex h-[42px] w-full items-center justify-between gap-3 rounded-[9px] border px-3 text-left text-sm ${dark ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-300 bg-white text-slate-900"}`}>
                  <span className="min-w-0 truncate">{selectedRepairProduct ? `${getRepairProductOptionLabel(selectedRepairProduct)}${activeRepairForProduct(selectedRepairProduct) ? ` · ${label[activeRepairForProduct(selectedRepairProduct).status] || activeRepairForProduct(selectedRepairProduct).status}` : ""}` : productChoice === "manual" ? "No associated product / enter details manually" : activeCustomerProductRows.length > 0 ? "Select a product" : "Choose a product or enter details manually"}</span>
                  <ChevronDown size={16} className={`shrink-0 transition-transform ${productMenuOpen ? "rotate-180" : ""}`} />
                </button>
                {productMenuOpen && <div id="repair-product-options" role="listbox" aria-label="Customer product / project" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setProductMenuOpen(false); } }} className={`absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-[9px] border p-1.5 shadow-xl ${dark ? "border-slate-700 bg-slate-900" : "border-slate-300 bg-white"}`}>
                  <button type="button" role="option" aria-selected={!productChoice} onClick={() => chooseProduct("")} className={`w-full rounded-md px-2.5 py-2.5 text-left text-[13px] ${dark ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}>{activeCustomerProductRows.length > 0 ? "Select a product" : "Choose a product or enter details manually"}</button>
                  {customerProducts.map((product) => {
                    const activeRepair = activeRepairForProduct(product);
                    const value = `${product.orderId}:${product.productIndex}`;
                    return <button key={value} type="button" role="option" aria-selected={productChoice === value} disabled={Boolean(activeRepair)} onClick={() => chooseProduct(value)} className={`w-full rounded-md px-2.5 py-2.5 text-left text-[13px] leading-5 whitespace-normal [overflow-wrap:anywhere] disabled:cursor-not-allowed ${activeRepair ? dark ? "text-amber-300 opacity-80" : "text-amber-800 opacity-90" : dark ? "text-slate-100 hover:bg-slate-800" : "text-slate-800 hover:bg-slate-100"}`}>
                      {getRepairProductOptionLabel(product)}{activeRepair ? ` · ${label[activeRepair.status] || activeRepair.status}` : ""}
                    </button>;
                  })}
                  {activeCustomerProductRows.length === 0 && <button type="button" role="option" aria-selected={productChoice === "manual"} onClick={() => chooseProduct("manual")} className={`w-full rounded-md px-2.5 py-2.5 text-left text-[13px] leading-5 whitespace-normal ${dark ? "text-slate-100 hover:bg-slate-800" : "text-slate-800 hover:bg-slate-100"}`}>No associated product / enter details manually</button>}
                </div>}
              </>}
            </div>
            {activeCustomerProductRows.length > 0 && <div className={`relative mt-2 space-y-2 overflow-hidden rounded-[9px] border border-l-4 p-3 text-[12.5px] leading-5 ${dark ? "border-amber-800 border-l-amber-500 bg-amber-950/30 text-amber-200" : "border-amber-300 border-l-amber-500 bg-amber-50 text-amber-950"}`}><p className="font-bold text-amber-800 dark:text-amber-300">Active repair already exists</p><p className="leading-5">Products with an active repair are disabled. Choose a different project item, or open the existing ticket below.</p>{activeCustomerProductRows.map(({ product, repair }) => <div key={`${product.orderId}:${product.productIndex}`} className={`flex flex-col gap-2 rounded-lg border p-2 ${dark ? "border-slate-700 bg-slate-900" : "border-amber-200 bg-white"} sm:flex-row sm:items-center sm:justify-between`}><span className="min-w-0 break-words"><span className="font-semibold">{product.productName}</span> · {label[repair.status] || repair.status} · {repair.repairTrackingId}{(repair.schedule?.startDate || repair.schedule?.date) && ` · Scheduled ${new Date(repair.schedule.startDate || repair.schedule.date).toLocaleDateString("en-PH", { dateStyle: "medium" })}`}</span><button type="button" onClick={() => open(repair, "details")} className={`shrink-0 self-start rounded-lg border px-2.5 py-1.5 font-bold sm:self-auto ${dark ? "border-slate-600 bg-slate-800 text-slate-200" : "border-slate-300 bg-white text-slate-800"}`}>View ticket</button></div>)}</div>}
            {!customerProductsLoading && customerProducts.length === 0 && <p className={`mt-1 text-xs ${muted}`}>No completed order products were found. Enter the product details manually.</p>}
          </div>}
          {selectedRepairProduct && <div className={`flex-none overflow-hidden rounded-[9px] border ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className={`border-b px-3.5 py-2.5 text-[13px] font-bold ${dark ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-slate-50 text-slate-900"}`}>Product details from customer order</div>
            <dl className="grid grid-cols-1 gap-x-5 gap-y-3 p-3.5 sm:grid-cols-2">
              <div><dt className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Order / transaction:</dt><dd className="mt-0.5 break-words text-[13.5px] font-semibold">{selectedRepairProduct.orderTracking || "Not available"}</dd></div>
              <div><dt className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Phone number:</dt><dd className="mt-0.5 break-words text-[13.5px] font-semibold">{selectedCustomer?.customerPhone || selectedCustomer?.phone || "Not provided"}</dd></div>
              <div className="sm:col-span-2"><dt className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Site address:</dt><dd className="mt-0.5 break-words text-[13.5px] font-semibold">{selectedRepairProduct.siteAddress || selectedCustomer?.siteAddress || "Not provided"}</dd></div>
              <div><dt className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Product size:</dt><dd className="mt-0.5 text-[13.5px] font-semibold">{selectedRepairProduct.width > 0 && selectedRepairProduct.height > 0 ? `${selectedRepairProduct.width} × ${selectedRepairProduct.height} ${selectedRepairProduct.measurementUnit || "in"}` : "Not specified"}</dd></div>
              <div><dt className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Quantity:</dt><dd className="mt-0.5 text-[13.5px] font-semibold">{selectedRepairProduct.quantity || 1}</dd></div>
              <div><dt className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Installation date:</dt><dd className="mt-0.5 text-[13.5px] font-semibold">{selectedRepairProduct.installationDate ? new Date(selectedRepairProduct.installationDate).toLocaleDateString("en-PH", { dateStyle: "medium" }) : "Not available"}</dd></div>
              <div><dt className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Warranty:</dt><dd className={`mt-0.5 text-[13.5px] font-semibold ${selectedRepairProduct.warranty?.status === "active" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{getWarrantyCoverageText(selectedRepairProduct.warranty)}</dd></div>
              {selectedRepairProduct.warranty?.startsAt && <div><dt className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Warranty started:</dt><dd className="mt-0.5 text-[13.5px] font-semibold">{new Date(selectedRepairProduct.warranty.startsAt).toLocaleDateString("en-PH", { dateStyle: "medium" })}</dd></div>}
            </dl>
          </div>}
          <label className="flex-none block text-[12.5px] font-semibold">Product or service<input required readOnly={Boolean(selectedRepairProduct)} value={repairDraft.productName} onChange={(event) => setRepairDraft({ ...repairDraft, productName: event.target.value })} className={`${field} mt-1.5 h-[42px] rounded-[9px] read-only:opacity-80`} /></label>
          {!repairDraft.orderId && <label className="flex-none block text-[12.5px] font-semibold">Order / transaction reference (optional)<input value={repairDraft.orderTracking} onChange={(event) => setRepairDraft({ ...repairDraft, orderTracking: event.target.value })} className={`${field} mt-1.5 h-[42px] rounded-[9px]`} /></label>}
          {!repairDraft.orderId && <label className="flex-none block text-[12.5px] font-semibold">Repair type<select value={repairDraft.workflowType} onChange={(event) => setRepairDraft({ ...repairDraft, workflowType: event.target.value })} className={`${field} mt-1.5 h-[42px] rounded-[9px]`}><option value="paid">Paid repair / quote required</option><option value="warranty">Warranty review</option></select></label>}
          <label className="flex-none block text-[12.5px] font-semibold">Repair issue<textarea required rows={4} value={repairDraft.issueDescription} onChange={(event) => setRepairDraft({ ...repairDraft, issueDescription: event.target.value })} className={`${field} mt-1.5 min-h-24 resize-y rounded-[9px]`} /></label>
        </div>
        <div className={`flex-none border-t px-4 py-3 sm:px-5 ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}><div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end"><button type="button" onClick={() => setAction("")} className={`h-[42px] rounded-[9px] border px-4 text-sm font-semibold ${dark ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}>Cancel</button><button disabled={busy === "create-repair"} className="h-[42px] rounded-[9px] bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50 sm:min-w-40">{busy === "create-repair" ? "Saving…" : "Create repair ticket"}</button></div></div>
      </form>}
      {action === "details" && <div ref={detailsBodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pb-5"><div role="tablist" className={`grid w-full grid-cols-2 items-stretch gap-2 border-b py-3 sm:gap-3 ${dark ? "border-slate-700 bg-[#0d1b2a]" : "border-slate-100 bg-slate-50/80"}`} aria-label="Repair ticket details">{[{ id: "details", number: 1, title: "Details", detail: "Customer and project information" }, { id: "history", number: 2, title: "Repair history", detail: "Updates recorded for this repair ticket" }].map((tab) => <button key={tab.id} id={`repair-details-tab-${tab.number}`} type="button" role="tab" aria-selected={detailsTab === tab.id} aria-controls={`repair-details-panel-${tab.id}`} tabIndex={detailsTab === tab.id ? 0 : -1} onClick={() => { setDetailsTab(tab.id); detailsBodyRef.current?.scrollTo({ top: 0 }); }} onKeyDown={(event) => { if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return; event.preventDefault(); const targetId = detailsTab === "details" ? "history" : "details"; setDetailsTab(targetId); detailsBodyRef.current?.scrollTo({ top: 0 }); requestAnimationFrame(() => document.getElementById(`repair-details-tab-${targetId === "details" ? 1 : 2}`)?.focus()); }} className={`flex min-h-[62px] w-full min-w-0 items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${detailsTab === tab.id ? (dark ? "border-red-400 bg-red-500/15 shadow-sm" : "border-red-600 bg-red-50 shadow-sm") : dark ? "border-slate-700 bg-slate-900/50 hover:bg-slate-800" : "border-slate-200 bg-white hover:bg-slate-50"}`}><span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${detailsTab === tab.id ? "bg-red-600 text-white" : dark ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`} aria-hidden="true">{tab.number}</span><span className="min-w-0"><span className={`block truncate text-xs font-bold sm:text-sm ${dark ? "text-slate-100" : "text-slate-800"}`}>{tab.title}</span><span className={`hidden truncate text-[11px] sm:block ${dark ? "text-slate-400" : "text-slate-500"}`}>{tab.detail}</span></span></button>)}</div>{detailsTab === "details" && <div role="tabpanel" id="repair-details-panel-details" aria-labelledby="repair-details-tab-1" className="space-y-4 text-sm">
        {active.duplicateReview?.flagged && <div className={`rounded-xl border p-3 ${dark ? "border-amber-800 bg-amber-950/30 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}><p className="font-bold">Possible duplicate ticket · administrator review</p><p className="mt-1 text-xs">This record was flagged during the duplicate repair audit. Its payment records, schedule, and repair history are preserved. Review it against the primary ticket before taking action.</p>{active.duplicateReview.duplicateOf && <p className="mt-1 break-all text-xs">Primary ticket record: {String(active.duplicateReview.duplicateOf)}</p>}{active.duplicateReview.resolutionReason && <p className="mt-2 text-xs"><span className="font-bold">Review resolution:</span> {active.duplicateReview.resolutionReason}</p>}{canManageRepairs && ["admin", "super_admin"].includes(user?.role) && active.status !== "completed" && !["cancelled", "rejected"].includes(active.status) && <div className="mt-3 border-t border-amber-500/20 pt-3"><label className="block text-xs font-semibold">Reason for closing this duplicate ticket<textarea value={duplicateResolutionReason} onChange={(event) => setDuplicateResolutionReason(event.target.value)} maxLength={1200} rows={2} className={`${field} mt-1`} placeholder="Record the administrator’s review decision." /></label><button type="button" onClick={submitDuplicateResolution} disabled={Boolean(busy)} className="mt-2 rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Close as duplicate</button><p className="mt-1 text-[10px]">This requires administrator confirmation and preserves all ticket records. It does not change payment records.</p></div>}</div>}
        <div className={`grid gap-x-5 gap-y-4 rounded-2xl border p-4 shadow-sm sm:grid-cols-2 sm:p-5 ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
          <div className={`min-w-0 rounded-xl border p-3 ${dark ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-slate-50"}`}><p className={`text-[11px] font-bold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-600"}`}>Current status</p><p className="mt-1.5"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getRepairStatusBadgeClass(active.status, dark)}`}>{label[active.status] || active.status}</span></p></div>
          <div className={`min-w-0 rounded-xl border p-3 ${dark ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-slate-50"}`}><p className={`text-[11px] font-bold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-600"}`}>Request type</p><p className={`mt-1.5 text-sm font-semibold leading-5 ${dark ? "text-slate-100" : "text-slate-900"}`}>{getRepairServiceType(active, true)}</p></div>
          <section className={`min-w-0 border-t pt-4 sm:col-span-2 ${dark ? "border-slate-700" : "border-slate-200"}`}>
            <h4 className={`text-[11px] font-extrabold uppercase tracking-wider ${dark ? "text-slate-300" : "text-slate-700"}`}>Customer information</h4>
            <div className="mt-3 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
              <div className="min-w-0"><p className={`text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-600"}`}>Customer name</p><p className={`mt-1 break-words text-[15px] font-semibold leading-5 ${dark ? "text-slate-100" : "text-slate-900"}`}>{active.customerName}</p></div>
              <div className="min-w-0"><p className={`text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-600"}`}>Email address</p><p className={`mt-1 break-all text-sm leading-5 ${dark ? "text-slate-200" : "text-slate-800"}`}>{active.customerEmail || "No email available"}</p></div>
              <div className="min-w-0"><p className={`text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-600"}`}>Phone number</p><p className={`mt-1 break-words text-sm font-semibold leading-5 ${dark ? "text-slate-100" : "text-slate-900"}`}>{active.customerPhone || "Not provided"}</p></div>
              <div className="min-w-0"><p className={`text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-600"}`}>Order</p><p className={`mt-1 break-words text-sm leading-5 ${dark ? "text-slate-200" : "text-slate-800"}`}>{active.orderTracking || "Not available"}</p></div>
              <div className="min-w-0 sm:col-span-2"><p className={`text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-600"}`}>Site address</p><p className={`mt-1 break-words text-sm leading-5 ${dark ? "text-slate-200" : "text-slate-800"}`}>{active.siteAddress || "Not provided"}</p></div>
            </div>
          </section>
          <div className={`min-w-0 border-t pt-3 ${dark ? "border-slate-700" : "border-slate-200"} ${active.createdByAdmin ? "" : "sm:col-span-2"}`}><p className={`text-[11px] font-bold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-600"}`}>Product</p><p className={`mt-1.5 break-words text-sm font-semibold leading-5 ${dark ? "text-slate-100" : "text-slate-900"}`}>{active.productName}</p>{active.installationDate && <p className={`mt-1 text-xs ${dark ? "text-slate-400" : "text-slate-600"}`}>Installed {new Date(active.installationDate).toLocaleDateString("en-PH", { dateStyle: "medium" })}</p>}</div>
          {active.createdByAdmin && <div className={`min-w-0 border-t pt-3 ${dark ? "border-slate-700" : "border-slate-200"}`}><p className={`text-[11px] font-bold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-600"}`}>Ticket source</p><p className={`mt-1.5 text-sm font-semibold leading-5 ${dark ? "text-slate-100" : "text-slate-900"}`}>Admin created</p></div>}
        </div>
        {(active.schedule?.startDate || active.schedule?.date) && <section className={`rounded-2xl border p-4 ${dark ? "border-slate-700" : "border-slate-200"}`}><h4 className="text-xs font-bold uppercase tracking-wider">Repair dates</h4><p className="mt-2 text-sm font-semibold">Scheduled start: {repairDateLabel(active.schedule.startDate || active.schedule.date)}</p>{getActualStartDate(active) && <p className="mt-1 text-sm font-semibold">Actual start: {repairDateLabel(getActualStartDate(active))}</p>}<p className="mt-1 text-sm font-semibold">Scheduled finish: {repairDateLabel(active.schedule.finishDate || active.schedule.startDate || active.schedule.date)}</p>{active.completion?.completedAt && <p className="mt-1 text-sm font-semibold">Actual completion: {repairDateLabel(active.completion.completedAt)}</p>}{active.schedule.notes && <p className={`mt-2 text-xs ${muted}`}>{active.schedule.notes}</p>}</section>}<section className={`rounded-2xl border p-4 ${dark ? "border-slate-700" : "border-slate-200"}`}><h4 className="text-xs font-bold uppercase tracking-wider">Reported issue</h4><p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 ${dark ? "text-slate-300" : "text-slate-700"}`}>{active.issueDescription || "No issue description provided."}</p>{active.mediaUrls?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{active.mediaUrls.map((url, index) => <button key={`${url}-${index}`} type="button" onClick={() => setPreviewMedia(url)} aria-label={`Preview repair evidence ${index + 1}`} className="size-16 overflow-hidden rounded-xl border border-slate-300 bg-slate-100">{isVideo(url) ? <video src={url} className="h-full w-full object-cover" /> : <img src={url} alt={`Repair evidence ${index + 1}`} className="h-full w-full object-cover" />}</button>)}</div>}</section>
        <div className="grid gap-3 sm:grid-cols-2"><section className={`rounded-2xl border p-4 ${dark ? "border-slate-700 bg-slate-950/30" : "border-slate-200 bg-white"}`}><h4 className="text-xs font-bold uppercase tracking-wider">Warranty assessment</h4><p className="mt-2 font-semibold">{active.warranty?.issueExcluded ? "Excluded for this repair issue only" : active.warranty?.status || "Coverage unknown"}</p><p className={`mt-1 whitespace-pre-wrap break-words text-xs leading-5 ${muted}`}>{active.warranty?.decisionReason || "No warranty exclusion recorded."}</p>{active.warranty?.expiresAt && <p className={`mt-2 text-xs ${muted}`}>Original coverage: {getWarrantyCoverageText(active.warranty)}</p>}</section><section className={`rounded-2xl border p-4 ${dark ? "border-slate-700 bg-slate-950/30" : "border-slate-200 bg-white"}`}><h4 className="text-xs font-bold uppercase tracking-wider">Inspection findings</h4><p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-5 ${dark ? "text-slate-300" : "text-slate-700"}`}>{active.inspection?.notes || "This ticket has not been inspected yet."}</p>{active.inspection?.evidenceUrls?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{active.inspection.evidenceUrls.map((url, index) => <button key={url} type="button" onClick={() => setPreviewMedia(url)} aria-label={`Preview inspection evidence ${index + 1}`} className="size-14 overflow-hidden rounded-lg border"><img src={url} alt={`Inspection evidence ${index + 1}`} className="h-full w-full object-cover" /></button>)}</div>}</section></div>
        {active.quotation?.issuedAt && <section className={`overflow-hidden rounded-2xl border ${dark ? "border-slate-700" : "border-slate-200"}`}><div className={`flex items-center justify-between gap-3 px-4 py-3 ${dark ? "bg-slate-800/70" : "bg-slate-50"}`}><div><h4 className="text-xs font-bold uppercase tracking-wider">Repair quotation</h4><p className={`mt-1 text-[10px] ${muted}`}>Issued {new Date(active.quotation.issuedAt).toLocaleDateString("en-PH")}</p><p className="mt-1 text-[10px] font-bold">{active.status === "quotation_pending_approval" ? "Awaiting customer decision" : active.status === "customer_accepted" ? "Accepted" : active.status === "quotation_declined" ? "Declined" : label[active.status] || active.status}</p>{active.quotation.customerDecisionAt && <p className={`mt-1 text-[10px] ${muted}`}>Decision recorded {new Date(active.quotation.customerDecisionAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</p>}</div><span className="text-sm font-extrabold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(active.quotation.total)}</span></span></div><div className="space-y-2 p-4">{(active.quotation.parts || []).map((part, index) => <div key={`${part.description}-${index}`} className="flex items-start justify-between gap-4 text-xs"><span className="min-w-0 break-words">{part.description}</span><span className="shrink-0 font-semibold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(part.cost)}</span></span></div>)}<div className="flex items-start justify-between gap-4 border-t border-slate-500/20 pt-2 text-xs"><span>Labor and service</span><span className="shrink-0 font-semibold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(active.quotation.laborCost)}</span></span></div>{active.quotation.notes && <p className={`border-t border-slate-500/20 pt-2 text-xs ${muted}`}>{active.quotation.notes}</p>}{active.quotationHistory?.length > 0 && <details className="border-t border-slate-500/20 pt-2"><summary className="cursor-pointer text-xs font-bold">Previous quotations ({active.quotationHistory.length})</summary>{active.quotationHistory.map((version, index) => <p key={`${version.issuedAt}-${index}`} className={`mt-2 text-xs ${muted}`}>{repairDateLabel(version.issuedAt)} · <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(version.total)}</span> · {version.customerDecisionAt ? "Decision recorded" : "Superseded"}</p>)}</details>}</div></section>}
        {active.workflowType === "paid" && active.quotation?.issuedAt && (() => { const total = Number(active.quotation.total || 0); const paid = getVerifiedPaymentAmountForUi(active); const balance = Math.max(0, total - paid); const fullyPaid = isRepairReceiptEligible(active); return <section className={`rounded-2xl border p-4 ${dark ? "border-slate-700 bg-slate-950/30" : "border-slate-200 bg-white"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-xs font-bold uppercase tracking-wider">Payment status</h4><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${fullyPaid ? "bg-emerald-100 text-emerald-800" : paid > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{fullyPaid ? "Paid" : paid > 0 ? "Partially Paid" : "Pending"}</span></div>{fullyPaid && canManagePayments && <button type="button" onClick={() => void openReceipt(active)} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">{active.receipt?.number ? "Reprint receipt" : "Generate receipt"}</button>}</div><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><div><dt className={muted}>Repair charge</dt><dd className="mt-1 font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(total)}</span></dd></div><div><dt className={muted}>Verified amount paid</dt><dd className="mt-1 font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(paid)}</span></dd></div><div><dt className={muted}>Remaining balance</dt><dd className="mt-1 font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(balance)}</span></dd></div></dl>{active.payment?.verifiedAt && <p className={`mt-2 text-[10px] ${muted}`}>Last verified {new Date(active.payment.verifiedAt).toLocaleString("en-PH")}{active.payment.verifiedByRole ? ` by ${active.payment.verifiedByRole.replaceAll("_", " ")}` : ""}.</p>}{active.payment?.proofReviewStatus === "pending" && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Customer payment proof is awaiting admin verification. Uploading proof does not mark this repair as Paid.</p>}{active.payment?.proofReviewStatus === "rejected" && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">Proof rejected: {active.payment.proofRejectionReason || "Customer can submit replacement proof."}</p>}{canManagePayments && balance > 0 && <button type="button" onClick={() => { setPaymentRecordDraft({ amount: balance.toFixed(2), paymentDate: todayDateKey, method: "", reference: "" }); setPaymentVerifiedConfirmed(false); setPaymentConfirm({ type: "admin", fullyPaid: false }); }} disabled={busy === String(active._id)} className="mt-4 inline-flex items-center gap-2 border-t border-slate-500/15 pt-3 text-xs font-bold text-sky-700 disabled:opacity-50">Record payment</button>}{active.payment?.records?.length > 0 && <ol className="mt-3 space-y-2 border-t border-slate-500/15 pt-3">{active.payment.records.map((record, index) => <li key={record.id || `${record.verifiedAt}-${index}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs"><span><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(record.amount)}</span> · {record.method || "Payment"}{record.reference ? ` · Ref ${record.reference}` : ""}</span><span className={muted}>{record.paymentDate ? new Date(record.paymentDate).toLocaleDateString("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }) : record.verifiedAt ? new Date(record.verifiedAt).toLocaleDateString("en-PH") : "Verified"}</span></li>)}</ol>}{balance > 0 && <p className={`mt-3 text-xs ${muted}`}>Receipt generation is unavailable until an administrator verifies the full repair charge.</p>}</section>; })()}
        </div>}{detailsTab === "history" && <section role="tabpanel" id="repair-details-panel-history" aria-labelledby="repair-details-tab-2" className={`rounded-2xl border p-4 sm:p-5 ${dark ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white shadow-sm"}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-extrabold">Repair history</h4>
              <p className={`mt-1 text-xs ${muted}`}>Updates recorded for this repair ticket</p>
            </div>
            {displayedRepairHistory.length > 0 && <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${dark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>{displayedRepairHistory.length} {displayedRepairHistory.length === 1 ? "update" : "updates"}</span>}
          </div>
          {displayedRepairHistory.length ? <ol className="mt-5 space-y-0" aria-label="Repair history timeline">{displayedRepairHistory.map((entry, index) => {
            const eventLabel = String(entry.event || "Update").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
            const eventDate = new Date(entry.createdAt);
            const hasValidDate = !Number.isNaN(eventDate.getTime());
            const isLatest = index === displayedRepairHistory.length - 1;
            return <li key={`${entry.createdAt}-${index}`} className="relative flex gap-3.5 pb-5 last:pb-0">
              {!isLatest && <span aria-hidden="true" className={`absolute left-[9px] top-5 h-[calc(100%-1.25rem)] w-px ${dark ? "bg-slate-700" : "bg-slate-200"}`} />}
              <span aria-hidden="true" className={`relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${isLatest ? "bg-red-600/15" : dark ? "bg-slate-800" : "bg-slate-100"}`}>
                <span className={`size-2 rounded-full ${isLatest ? "bg-red-600" : dark ? "bg-slate-500" : "bg-slate-400"}`} />
              </span>
              <div className={`min-w-0 flex-1 rounded-xl border px-3.5 py-3 ${isLatest ? dark ? "border-red-500/30 bg-red-500/5" : "border-red-200 bg-red-50/50" : dark ? "border-slate-700 bg-slate-950/40" : "border-slate-200 bg-slate-50/70"}`}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <p className={`text-sm font-bold ${isLatest ? dark ? "text-red-200" : "text-red-800" : dark ? "text-slate-100" : "text-slate-800"}`}>{eventLabel}</p>
                  {hasValidDate && <time dateTime={eventDate.toISOString()} className={`text-[11px] font-medium ${muted}`}>{eventDate.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</time>}
                </div>
                {entry.detail && <p className={`mt-2 break-words text-sm leading-5 ${dark ? "text-slate-300" : "text-slate-600"}`}>{entry.detail}</p>}
              </div>
            </li>;
          })}</ol> : <div className={`mt-4 rounded-xl border border-dashed p-5 text-center ${dark ? "border-slate-700 bg-slate-950/40" : "border-slate-200 bg-slate-50"}`}><Clock3 size={18} className={`mx-auto ${muted}`} /><p className={`mt-2 text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>No history updates yet</p><p className={`mt-1 text-xs ${muted}`}>Changes to this repair will appear here.</p></div>}
        </section>}
      </div>}
      {action === "payment" && <div className="space-y-4"><div className={`rounded-xl border p-4 ${dark ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-slate-50"}`}><div className="flex justify-between gap-4 text-sm"><span className={muted}>Quoted amount</span><strong><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(active?.quotation?.total)}</span></strong></div><div className="mt-2 flex justify-between gap-4 text-sm"><span className={muted}>Customer submitted</span><strong><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(active?.payment?.proofAmount)}</span></strong></div>{active?.payment?.proofTransactionNumber && <p className={`mt-2 text-xs ${muted}`}>Reference: {active.payment.proofTransactionNumber}</p>}</div><label className="block text-xs font-semibold">Payment method<FilterDropdown label="Payment method" value={paymentMethodForProof} options={[["Online payment", "Online payment"], ["Cash", "Cash"]]} onChange={setPaymentMethodForProof} darkMode={dark} className="mt-1" /></label>{active?.payment?.proofUrl && <button type="button" onClick={() => setPreviewMedia(active.payment.proofUrl)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold text-sky-700"><FileText size={15} />View proof · {active.payment.proofFileName || "Payment document"}</button>}{active?.payment?.proofUrl && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(active.payment.proofUrl) && <button type="button" onClick={() => setPreviewMedia(active.payment.proofUrl)} aria-label="Preview customer payment proof" className="mt-2 block w-full"><img src={active.payment.proofUrl} alt="Customer payment proof" className="max-h-80 w-full rounded-xl border object-contain" /></button>}<label className="block text-xs font-semibold">Rejection reason (required only when rejecting)<textarea value={paymentRejectionReason} onChange={(event) => setPaymentRejectionReason(event.target.value)} rows={3} className={field} placeholder="Explain what needs to be corrected" /></label><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => reviewPayment("reject")} disabled={busy === String(active?._id)} className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50">Reject proof</button><button type="button" onClick={() => reviewPayment("approve")} disabled={busy === String(active?._id)} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"><CheckCircle2 size={15} className="mr-1 inline" />Verify payment</button></div></div>}            {action === "review" && <form onSubmit={(event) => { event.preventDefault(); if (!reviewFindingChoice || !review.inspectionNotes.trim()) return toast.error("Add inspection findings."); run(active, () => approveWarrantyClaim(active._id, { inspectionNotes: review.inspectionNotes, decisionReason: "" })); }} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-6">
          <div className="space-y-[10px]">
            <label id="warranty-inspection-finding-label" className="block text-[12.5px] font-bold">Inspection findings</label>
            <div className="relative" ref={reviewFindingMenuRef}>
              <button ref={reviewFindingTriggerRef} type="button" role="combobox" aria-labelledby="warranty-inspection-finding-label" aria-haspopup="listbox" aria-expanded={reviewFindingMenuOpen} aria-controls="warranty-inspection-finding-list" aria-activedescendant={reviewFindingMenuOpen ? "warranty-inspection-finding-option-" + reviewFindingActiveIndex : undefined} onClick={() => { const selectedIndex = ["", ...warrantyInspectionFindingPresets].indexOf(reviewFindingChoice); setReviewFindingActiveIndex(Math.max(0, selectedIndex)); setReviewFindingMenuOpen((open) => !open); }} onKeyDown={(event) => {
                const choices = ["", ...warrantyInspectionFindingPresets];
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (!reviewFindingMenuOpen) {
                    const selectedIndex = choices.indexOf(reviewFindingChoice);
                    setReviewFindingActiveIndex(Math.max(0, selectedIndex));
                    setReviewFindingMenuOpen(true);
                  } else {
                    setReviewFindingActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
                  }
                } else if (event.key === "Enter" && reviewFindingMenuOpen) {
                  event.preventDefault();
                  const choice = choices[reviewFindingActiveIndex] || "";
                  setReviewFindingChoice(choice);
                  setReview({ ...review, inspectionNotes: choice && choice !== "Others" ? choice : "" });
                  setReviewFindingMenuOpen(false);
                } else if (event.key === "Escape" && reviewFindingMenuOpen) {
                  event.preventDefault();
                  event.stopPropagation();
                  setReviewFindingMenuOpen(false);
                }
              }} className={"flex h-11 w-full items-center justify-between gap-3 rounded-[9px] border px-3 text-left text-[13.5px] transition focus:outline-none focus:ring-[3px] focus:ring-blue-500/20 " + (reviewFindingMenuOpen ? "ring-[3px] ring-blue-500/20 " : "") + (dark ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-300 bg-white text-slate-900")}>
                <span className={"min-w-0 truncate " + (reviewFindingChoice ? "" : muted)}>{reviewFindingChoice || "Select an inspection finding"}</span>
                <ChevronDown size={16} className={"shrink-0 transition-transform " + (reviewFindingMenuOpen ? "rotate-180 " : "") + muted} />
              </button>
              {reviewFindingMenuOpen && <div id="warranty-inspection-finding-list" role="listbox" aria-labelledby="warranty-inspection-finding-label" className={"absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[300px] overflow-y-auto rounded-[10px] border p-1.5 shadow-xl " + (dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white")}>
                {["", ...warrantyInspectionFindingPresets].map((choice, index) => {
                  const selected = Boolean(choice) && reviewFindingChoice === choice;
                  const isOthers = choice === "Others";
                  const optionColor = selected
                    ? dark ? "bg-emerald-900/40 font-bold text-emerald-200" : "bg-emerald-50 font-bold text-emerald-800"
                    : !choice ? muted : dark ? "text-slate-200 hover:bg-slate-800" : "text-slate-800 hover:bg-slate-100";
                  const activeColor = reviewFindingActiveIndex === index && !selected ? (dark ? "bg-slate-800" : "bg-slate-100") : "";
                  return <button key={choice || "placeholder"} id={"warranty-inspection-finding-option-" + index} type="button" role="option" aria-selected={selected} onMouseEnter={() => setReviewFindingActiveIndex(index)} onClick={() => { setReviewFindingChoice(choice); setReview({ ...review, inspectionNotes: choice && choice !== "Others" ? choice : "" }); setReviewFindingMenuOpen(false); reviewFindingTriggerRef.current?.focus(); }} className={"flex w-full items-center justify-between gap-3 rounded-md px-[10px] py-[9px] text-left text-[13.5px] transition " + (isOthers ? "mt-1 border-t pt-3 " + (dark ? "border-slate-700" : "border-slate-200") + " " : "") + optionColor + " " + activeColor}>
                    <span>{choice || "Select an inspection finding"}</span>{selected && <CheckCircle2 size={16} className="shrink-0" />}
                  </button>;
                })}
              </div>}
            </div>
            {reviewFindingChoice === "Others" && <textarea required aria-label="Inspection findings" value={review.inspectionNotes} onChange={(event) => setReview({ ...review, inspectionNotes: event.target.value })} rows={3} className={field + " min-h-[84px] resize-y rounded-[9px] focus:outline-none focus:ring-[3px] focus:ring-blue-500/20"} placeholder="Enter inspection findings" />}
          </div>
          <label className="block text-[12.5px] font-bold">Reason for rejection <span className={muted}>(required only if rejecting)</span><textarea value={review.decisionReason} onChange={(event) => setReview({ ...review, decisionReason: event.target.value })} rows={3} className={field + " mt-2 min-h-[84px] resize-y rounded-[9px] focus:outline-none focus:ring-[3px] focus:ring-blue-500/20"} placeholder="Explain why this warranty claim is being rejected" /></label>
        </div>
        <div className={"flex-none border-t px-6 py-4 " + (dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white")}><div className="flex flex-col-reverse gap-2.5 min-[560px]:flex-row min-[560px]:justify-end">
          <button type="button" disabled={busy === String(active?._id)} onClick={() => { if (!reviewFindingChoice || review.inspectionNotes.trim().length < 15) return toast.error("Add detailed inspection findings."); if (review.decisionReason.trim().length < 10) return toast.error("Add a rejection reason of at least 10 characters."); setRejectConfirmOpen(true); }} className={"h-11 rounded-[9px] border px-5 text-sm font-bold disabled:opacity-50 max-[559px]:w-full " + (dark ? "border-red-400 text-red-300 hover:bg-red-950/30" : "border-red-600 bg-white text-red-700 hover:bg-red-50")}>Reject repair</button>
          <button disabled={busy === String(active?._id)} className="inline-flex h-11 items-center justify-center gap-2 rounded-[9px] bg-emerald-700 px-5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50 max-[559px]:w-full"><CheckCircle2 size={16} />Approve free warranty service</button>
        </div></div>
      </form>}
      {action === "quote" && <form onSubmit={(event) => { event.preventDefault(); if (!quotePreview) { setQuotePreview(true); return; } void submitQuotation(); }} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" style={{ WebkitOverflowScrolling: "touch" }}>
        <label className="block text-xs font-semibold">Inspection findings<textarea required minLength={15} value={quote.inspectionNotes} onChange={(event) => setQuote({ ...quote, inspectionNotes: event.target.value })} rows={3} className={field} placeholder="Describe the observed damage and inspection evidence" /></label>
        {active.workflowType === "warranty" && <label className="block text-xs font-semibold">Reason for warranty exclusion on this repair issue<textarea required value={quote.decisionReason} onChange={(event) => setQuote({ ...quote, decisionReason: event.target.value })} rows={2} className={field} placeholder="For example, damage caused by customer misuse" /></label>}
        <div><div className="mb-2 flex items-center justify-between"><b className="text-sm">Itemized parts and materials</b><button type="button" onClick={() => setQuote({ ...quote, parts: [...quote.parts, { description: "", cost: "" }] })} className="rounded-lg border px-2 py-1 text-xs">Add item</button></div>{quote.parts.map((part, index) => <div key={index} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_130px_auto]"><input placeholder="Part or material (optional)" value={part.description} onChange={(event) => setQuote({ ...quote, parts: quote.parts.map((entry, i) => i === index ? { ...entry, description: event.target.value } : entry) })} className={field} /><input type="number" min="0" step="0.01" placeholder="PHP cost" value={part.cost} onChange={(event) => setQuote({ ...quote, parts: quote.parts.map((entry, i) => i === index ? { ...entry, cost: event.target.value } : entry) })} className={field} /><button type="button" onClick={() => setQuote({ ...quote, parts: quote.parts.filter((_, i) => i !== index) })} className="rounded-lg border px-3 text-xs" aria-label={`Remove item ${index + 1}`}>Remove</button></div>)}</div>
        <label className="block text-xs font-semibold">Service fee (PHP)<input type="number" min="0" step="0.01" value={quote.laborCost} onChange={(event) => setQuote({ ...quote, laborCost: event.target.value })} className={field} /></label>
        <label className="block text-xs font-semibold">Quotation notes<textarea value={quote.quotationNotes} onChange={(event) => setQuote({ ...quote, quotationNotes: event.target.value })} rows={2} className={field} placeholder="Repair scope, limitations, and terms" /></label>
        <label className="block text-xs font-semibold">Inspection photos (optional, up to 10)<input type="file" accept="image/*" multiple onChange={(event) => { const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/")); setInspectionEvidenceFiles(files.slice(0, 10)); event.target.value = ""; }} className={`mt-1 block w-full text-xs ${field}`} /></label>{inspectionEvidenceFiles.length > 0 && <p className="text-xs text-slate-500">{inspectionEvidenceFiles.length} inspection photo(s) selected.</p>}
        <p className="rounded-lg bg-slate-500/10 p-3 text-xs font-semibold">Parts and materials subtotal: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(quote.parts.reduce((sum, part) => sum + (Number(part.cost) || 0), 0))}</span></p><p className="rounded-lg bg-slate-500/10 p-3 text-sm font-bold">Quotation total: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(quote.parts.reduce((sum, part) => sum + (Number(part.cost) || 0), 0) + (Number(quote.laborCost) || 0))}</span></p>
        {quotePreview && <section className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-xs text-slate-800"><h4 className="font-bold">Preview before issuing</h4><p className="mt-2 whitespace-pre-wrap">Findings: {quote.inspectionNotes}</p>{quote.decisionReason && <p className="mt-1 whitespace-pre-wrap">Issue exclusion: {quote.decisionReason}</p>}<ul className="mt-2 space-y-1">{quote.parts.filter((part) => part.description.trim()).map((part, index) => <li key={index} className="flex justify-between gap-3"><span>{part.description}</span><span><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(part.cost)}</span></span></li>)}</ul><p className="mt-1 flex justify-between"><span>Service fee</span><span><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(quote.laborCost)}</span></span></p><p className="mt-2 border-t border-amber-300 pt-2 font-extrabold">Total <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(quote.parts.reduce((sum, part) => sum + (Number(part.cost) || 0), 0) + (Number(quote.laborCost) || 0))}</span></p>{quote.quotationNotes && <p className="mt-2 whitespace-pre-wrap">Notes: {quote.quotationNotes}</p>}<p className="mt-2 font-semibold">Issue this quotation to the customer?</p></section>}
        </div>
        <div className={`flex-none border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-[#faf9f7]"}`}><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{quotePreview && <button type="button" onClick={() => setQuotePreview(false)} className="rounded-lg border px-4 py-2.5 text-sm font-bold">Edit quotation</button>}<button disabled={busy === String(active?._id)} className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{quotePreview ? "Confirm and issue quotation" : "Preview quotation"}</button></div></div>
      </form>}
      {action === "schedule" && <form onSubmit={(event) => { event.preventDefault(); run(active, () => scheduleRepair(active._id, { startDate: schedule.startDate, finishDate: schedule.finishDate, notes: schedule.notes, reschedule: active.status === "scheduled" })); }} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold">Start date<input required type="date" min={todayDateKey} value={schedule.startDate} onChange={(event) => setSchedule({ ...schedule, startDate: event.target.value, finishDate: schedule.finishDate && schedule.finishDate < event.target.value ? event.target.value : schedule.finishDate })} className={field} /></label><label className="block text-xs font-semibold">Expected finish date<input required type="date" min={schedule.startDate || todayDateKey} value={schedule.finishDate} onChange={(event) => setSchedule({ ...schedule, finishDate: event.target.value })} className={field} /></label></div><label className="block text-xs font-semibold">Scheduling notes<textarea value={schedule.notes} onChange={(event) => setSchedule({ ...schedule, notes: event.target.value })} rows={2} className={field} /></label><button className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white">Save schedule</button></form>}
      {action === "complete" && <form onSubmit={(event) => { event.preventDefault(); setCompleteConfirmOpen(true); }} className="space-y-3"><label className="block text-xs font-semibold">Completion notes<textarea required value={completion.notes} onChange={(event) => setCompletion({ ...completion, notes: event.target.value })} rows={3} className={field} /></label><div><div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs font-semibold">Completion photos <span className={`ml-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${dark ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-600"}`}>Optional</span></span><span className={`text-[10px] font-medium ${muted}`}>{evidenceFiles.length} / 10</span></div><label onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addEvidenceFiles(event.dataTransfer.files); }} className={`relative flex min-h-[100px] cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 transition focus-within:ring-2 focus-within:ring-emerald-500/30 ${dark ? "border-slate-700 bg-slate-950/50 hover:border-emerald-500/70 hover:bg-slate-900" : "border-slate-300 bg-slate-50/80 hover:border-emerald-500 hover:bg-emerald-50/50"}`}><input type="file" accept="image/*" multiple disabled={evidenceFiles.length >= 10} onChange={handleEvidenceSelection} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" aria-label="Choose repair completion photos" /><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${dark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-100 text-emerald-700"}`}><ImagePlus size={20} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold">{evidenceFiles.length ? "Add more photos" : "Add completion photos"}</span><span className={`mt-1 block text-[10px] leading-4 ${muted}`}>Drag and drop or browse · Images only · Up to 10 photos</span></span><span className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-bold ${dark ? "border-slate-700 bg-slate-800 text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}><Upload size={13} />Browse</span></label>{evidenceFiles.length > 0 && <ul className="mt-2 grid gap-2 sm:grid-cols-2">{evidenceFiles.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 ${dark ? "border-slate-700 bg-slate-950/60" : "border-slate-200 bg-white"}`}><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700"><Image size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold" title={file.name}>{file.name}</span><span className={`block text-[9px] ${muted}`}>{(file.size / (1024 * 1024)).toFixed(2)} MB</span></span><button type="button" onClick={() => setEvidenceFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`} className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${dark ? "text-slate-400 hover:bg-red-950/50 hover:text-red-300" : "text-slate-500 hover:bg-red-50 hover:text-red-700"}`}><X size={14} /></button></li>)}</ul>}</div><button disabled={busy === String(active?._id)} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">Mark repair completed</button></form>}
    </section></div>}
    {startConfirm && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="start-repair-title" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== String(startConfirm._id)) setStartConfirm(null); }}><section className={"w-full max-w-md rounded-2xl border p-5 shadow-2xl " + (dark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900")}><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700"><Play size={19} /></span><div><h3 id="start-repair-title" className="font-bold">Confirm repair start</h3><p className={"mt-1 text-sm " + muted}>Start repair work for <span className="font-semibold">{startConfirm.productName || "this item"}</span>?</p></div><button type="button" onClick={() => setStartConfirm(null)} disabled={busy === String(startConfirm._id)} aria-label="Close confirmation" className={"ml-auto rounded-lg p-1.5 " + muted}><X size={18} /></button></div><p className={"mt-3 text-xs leading-5 " + muted}>The actual start date will be recorded when you confirm.</p><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setStartConfirm(null)} disabled={busy === String(startConfirm._id)} className="min-h-10 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50">Cancel</button><button type="button" disabled={busy === String(startConfirm._id)} onClick={() => void run(startConfirm, () => startRepair(startConfirm._id))} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy === String(startConfirm._id) ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}Confirm Start</button></div></section></div>}
{completeConfirmOpen && action === "complete" && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="complete-repair-title" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== String(active?._id)) setCompleteConfirmOpen(false); }}><section className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${card}`}><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700"><CheckCircle2 size={20} /></span><div><h3 id="complete-repair-title" className="font-bold">Confirm repair completion</h3><p className={`mt-1 text-sm ${muted}`}>Mark the repair for <span className="font-semibold">{active?.productName || "this item"}</span> as completed?</p></div><button type="button" onClick={() => setCompleteConfirmOpen(false)} disabled={busy === String(active?._id)} aria-label="Close confirmation" className={`ml-auto rounded-lg p-1.5 ${muted}`}><X size={18} /></button></div><p className={`mt-3 text-xs leading-5 ${muted}`}>The completion notes and any photos you added will be saved with this update.</p><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setCompleteConfirmOpen(false)} disabled={busy === String(active?._id)} className="min-h-10 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50">Back to details</button><button type="button" disabled={busy === String(active?._id)} onClick={() => { setCompleteConfirmOpen(false); void submitComplete(); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy === String(active?._id) ? <LoaderCircle size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}Confirm completion</button></div></section></div>}
    {rejectConfirmOpen && action === "review" && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="reject-repair-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setRejectConfirmOpen(false); }}><section className={`max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border p-5 shadow-2xl ${card}`}><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-600"><X size={20} /></span><div><h3 id="reject-repair-title" className="font-bold">Confirm repair rejection</h3><p className={`mt-1 text-xs ${muted}`}>This will close the warranty claim for {active?.productName || "this product"}.</p></div></div><div className={`mt-4 rounded-xl border p-3 ${dark ? "border-slate-700 bg-slate-950/60" : "border-slate-200 bg-slate-50"}`}><p className={`text-[10px] font-bold uppercase tracking-wider ${muted}`}>Rejection reason</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{review.decisionReason}</p></div><p className={`mt-3 text-xs leading-5 ${muted}`}>The customer will be notified of this decision. Confirm only if the inspection findings and reason are accurate.</p><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setRejectConfirmOpen(false)} className="min-h-10 rounded-lg border px-4 text-sm font-semibold">Back to inspection</button><button type="button" disabled={busy === String(active?._id)} onClick={() => { setRejectConfirmOpen(false); void run(active, () => rejectWarrantyClaim(active._id, review)); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50">Confirm rejection</button></div></section></div>}
        {paymentConfirm && <div className="fixed inset-0 z-[145] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="repair-payment-confirm-title"><form onSubmit={(event) => { event.preventDefault(); void submitPaymentConfirmation(); }} className={`max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl ${card}`}><div><h3 id="repair-payment-confirm-title" className="text-base font-bold">{paymentConfirm.type === "proof" ? "Verify customer payment" : "Record verified payment"}</h3><p className={`mt-1 text-sm ${muted}`}>{paymentConfirm.type === "proof" ? "Review the uploaded proof, confirm the actual payment details, and verify the amount received." : "Record the payment details before changing the repair payment status."}</p></div><div className={`rounded-xl border p-3 text-xs ${dark ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-slate-50"}`}><span className={muted}>Remaining balance: </span><strong><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{money(Math.max(0, Number(active?.quotation?.total || 0) - getVerifiedPaymentAmountForUi(active)))}</span></strong>{paymentConfirm.type === "proof" && active?.payment?.proofUrl && <button type="button" onClick={() => setPreviewMedia(active.payment.proofUrl)} className="ml-3 font-semibold text-sky-700 underline">View uploaded proof</button>}</div><div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold">Payment amount<input required type="number" min="0.01" max={Math.max(0, Number(active?.quotation?.total || 0) - getVerifiedPaymentAmountForUi(active))} step="0.01" value={paymentRecordDraft.amount} onChange={(event) => setPaymentRecordDraft((current) => ({ ...current, amount: event.target.value }))} className={field} /></label><label className="block text-xs font-semibold">Payment date<input required type="date" max={todayDateKey} value={paymentRecordDraft.paymentDate} onChange={(event) => setPaymentRecordDraft((current) => ({ ...current, paymentDate: event.target.value }))} className={field} /></label><label className="block text-xs font-semibold">Payment method<FilterDropdown label="Payment method" value={paymentRecordDraft.method} options={[["", "Select method"], ["Cash", "Cash"], ["Online payment", "Online payment"]]} onChange={(method) => setPaymentRecordDraft((current) => ({ ...current, method }))} darkMode={dark} className="mt-1" /></label><label className="block text-xs font-semibold">Payment reference{["Bank transfer", "GCash", "Online payment"].includes(paymentRecordDraft.method) && <span className="text-red-600"> *</span>}<input required={["Bank transfer", "GCash", "Online payment"].includes(paymentRecordDraft.method)} value={paymentRecordDraft.reference} onChange={(event) => setPaymentRecordDraft((current) => ({ ...current, reference: event.target.value }))} maxLength={180} className={field} placeholder="Transaction or reference number" /></label></div><label className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${dark ? "border-slate-700" : "border-slate-200"}`}><input type="checkbox" checked={paymentVerifiedConfirmed} onChange={(event) => setPaymentVerifiedConfirmed(event.target.checked)} className="mt-0.5 accent-emerald-700" /><span>I confirm this payment was actually received and verified. The saved records will update the payment balance{Number(paymentRecordDraft.amount) >= Math.max(0, Number(active?.quotation?.total || 0) - getVerifiedPaymentAmountForUi(active)) ? " and mark the repair Paid" : ""}.</span></label><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setPaymentConfirm(null)} disabled={busy === String(active?._id)} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button><button type="submit" disabled={busy === String(active?._id) || !paymentVerifiedConfirmed} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{paymentConfirm.type === "proof" ? "Verify and save payment" : Number(paymentRecordDraft.amount) >= Math.max(0, Number(active?.quotation?.total || 0) - getVerifiedPaymentAmountForUi(active)) ? "Verify and mark Paid" : "Save partial payment"}</button></div></form></div>}
    <RepairReceiptModal repair={receiptRepair} darkMode={darkMode} onClose={() => setReceiptRepair(null)} />
    <MediaPreviewModal src={previewMedia} darkMode={darkMode} onClose={() => setPreviewMedia(null)} />
  </section>;
}
