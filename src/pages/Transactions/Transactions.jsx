import CustomerDropdown from "@/components/CustomerDropdown";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FileText,
  FileDown,
  CheckCircle,
  Eye,
  Search,
  EyeClosed,
  Pencil,
  Lock,
  Star,
  Trash2,
  X,
  Info,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  TriangleAlert,
  Paperclip,
  LoaderCircle,
  MessageSquare,
  Ban,
  Receipt,
} from "lucide-react";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import toast from "react-hot-toast";
import AppToaster from "@/components/AppToaster";

import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import ContractModal from "../../components/ContractModal";
import TransactionDetailsModal from "../../components/TransactionDetailsModal";
import ExtraChargeReceiptModal from "../../components/ExtraChargeReceiptModal";
import { addExtraChargeReceiptContext, addProjectPaymentReceiptContext } from "@/lib/extraChargeReceipt";
import { getAdminOrders, createOrGetProjectPaymentReceipt, acceptContract, declineContract, updateOrderStatus, cancelAdminOrder, deleteOrderReview, setOrderReviewVisibility, respondToCustomerReview, downloadTransactionReport } from "@/api/orders";
import { hasAcceptedTransactionContract, isRecordedCancelledTransaction } from "@/lib/transactionAcceptance";
import { formatDateToMMDDYYYY, formatDateTimeToMMDDYYYY, formatDateToMMMDDYYYY } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { recordActivity } from "@/lib/activityLog";
import ProfileAvatar from "../../components/ui/ProfileAvatar";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { getCustomerPaymentProof, getPaymentSummary, getSavedPaymentTermsLabel, getUnresolvedPaymentProofRecords, isPaymentProofConfirmed, validateCustomerPaymentAmount } from "./paymentProofUtils";
import { getAdminPaymentStatusLabel, getPaymentStatusBadgeClassName, statusBadgeBaseClassName } from "@/lib/statusBadgeStyles";
import { uploadAdminPaymentDocument, uploadFiles } from "@/api/uploads";
import { API_BASE } from "@/api/client";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { useIsMobile } from "@/hooks/useIsMobile";
import useNotificationHighlight from "@/hooks/useNotificationHighlight";
import { hasStaffModulePermission } from "../../../shared/staffPermissions.js";

const TRANSACTION_REPORT_OPTIONS = [
  { value: "all_reports", label: "All Reports" },
  { value: "all_transactions", label: "All Transactions" },
  { value: "completed_projects", label: "Completed Projects" },
  { value: "active_projects", label: "Active Projects" },
  { value: "pending_transactions", label: "Pending Transactions" },
  { value: "customer_feedback", label: "Customer Feedback" },
  { value: "payment_records", label: "Payment Records" },
  { value: "warranty_records", label: "Warranty Records" },
];

const ADMIN_FEEDBACK_RESPONSE_TEMPLATES = [
  {
    value: "thanks",
    label: "Thank the customer",
    response: "Thank you for taking the time to share your feedback. We appreciate your support and hope to serve you again.",
  },
  {
    value: "positive",
    label: "Respond to a positive review",
    response: "Thank you for your kind feedback. We’re glad you had a positive experience with our team.",
  },
  {
    value: "concern",
    label: "Respond to a concern",
    response: "Thank you for bringing this to our attention. We’re sorry your experience did not meet expectations. Please contact our team so we can assist you.",
  },
];

function Transactions() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const hidePaymentAmounts = user?.role === "skilled_worker" && user?.staff_access?.hide_payment_amounts === true;
  const { darkMode } = useAdminTheme();
  const canGenerateTransactionReport = ["admin", "super_admin"].includes(user?.role);
  const canManageFeedbackVisibility = ["admin", "super_admin"].includes(user?.role);
  const canCancelTransactions = hasStaffModulePermission(user, "transactions", "cancel");
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] =
    useState(() => {
      if (typeof window === "undefined") return true;
      const stored = localStorage.getItem("sidebarOpen");
      return stored !== null ? JSON.parse(stored) : true;
    });

  const [activeTable, setActiveTable] =
    useState("all");
  const [showTransactionActions, setShowTransactionActions] = useState(true);
  const [cancelTransactionOrder, setCancelTransactionOrder] = useState(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellationLoading, setCancellationLoading] = useState(false);

  const location = useLocation();
  const highlightedNotificationRecordId = useNotificationHighlight(location);

  useEffect(() => {
    if (location?.state?.activeTable) {
      const requestedTable = location.state.activeTable;
      setActiveTable(
        requestedTable === "warranty_in" || requestedTable === "warranty_out"
          ? "projects"
          : requestedTable
      );
      navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
    }
  }, [location, navigate]);

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  const [receiptPage, setReceiptPage] =
    useState(1);
  const [allPage, setAllPage] = useState(1);
  const [inProgressPage, setInProgressPage] = useState(1);
  const [feedbackPage, setFeedbackPage] = useState(1);

  const [projectPage, setProjectPage] =
    useState(1);
  const [cancelledPage, setCancelledPage] =
    useState(1);
  const [tableSearch, setTableSearch] = useState("");
  const [showGenerateReportModal, setShowGenerateReportModal] = useState(false);
  const [reportType, setReportType] = useState("all_transactions");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [reportProjectStatus, setReportProjectStatus] = useState("all");
  const [reportCustomer, setReportCustomer] = useState("all");
  const [reportPaymentStatus, setReportPaymentStatus] = useState("all");
  const [reportSearch, setReportSearch] = useState("");
  const [reportGenerationLoading, setReportGenerationLoading] = useState(false);
  const reportGenerationSubmittingRef = useRef(false);

  useEffect(() => {
    setReceiptPage(1);
    setAllPage(1);
    setInProgressPage(1);
    setFeedbackPage(1);
    setProjectPage(1);
    setCancelledPage(1);
  }, [activeTable]);

  const rowsPerPage = 10;

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [feedbackPreviewOrder, setFeedbackPreviewOrder] = useState(null);
  const [feedbackDeleteOrder, setFeedbackDeleteOrder] = useState(null);
  const [feedbackDeleting, setFeedbackDeleting] = useState(false);
  const [feedbackVisibilityUpdating, setFeedbackVisibilityUpdating] = useState(false);
  const [feedbackReplyOrder, setFeedbackReplyOrder] = useState(null);
  const [feedbackReplyText, setFeedbackReplyText] = useState("");
  const [feedbackReplyTemplate, setFeedbackReplyTemplate] = useState("");
  const [feedbackReplySaving, setFeedbackReplySaving] = useState(false);
  const [selectedFeedbackKeys, setSelectedFeedbackKeys] = useState(() => new Set());
  const [showContractModal, setShowContractModal] = useState(false);
  const [showFullContractModal, setShowFullContractModal] = useState(false);
  const [contractPreviewOrder, setContractPreviewOrder] = useState(null);
  const [contractPreviewData, setContractPreviewData] = useState(null);
  const [selectedExtraChargeReceipt, setSelectedExtraChargeReceipt] = useState(null);
  const openProjectPaymentReceipt = async (order) => {
    try {
      const result = await createOrGetProjectPaymentReceipt(order?._id || order?.id);
      if (!result?.receipt) throw new Error("The project receipt could not be generated.");
      setSelectedExtraChargeReceipt(addProjectPaymentReceiptContext({ ...result.receipt, order: result.order?._id || result.receipt.order }, { ...order, ...result.order }));
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "The project receipt is not available yet.");
    }
  };
  const openSavedProjectPaymentReceipt = (order) => {
    const receipt = order?.project_payment_receipts?.[0];
    if (!receipt) return;
    setSelectedExtraChargeReceipt(addProjectPaymentReceiptContext(receipt, order));
  };
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false);
  const [editPaymentOrder, setEditPaymentOrder] = useState(null);
  const [editPaymentMethod, setEditPaymentMethod] = useState("Cash");
  const [editPaymentAmount, setEditPaymentAmount] = useState("0.00");
  const [editPaymentTransactionNumber, setEditPaymentTransactionNumber] = useState("");
  const [editPaymentReason, setEditPaymentReason] = useState("");
  const [editPaymentAction, setEditPaymentAction] = useState("record");
  const [editPaymentRecordId, setEditPaymentRecordId] = useState("");
  const [editPaymentDate, setEditPaymentDate] = useState("");
  const [editPaymentProofFile, setEditPaymentProofFile] = useState(null);
  const [editPaymentProofPreviewUrl, setEditPaymentProofPreviewUrl] = useState("");
  const editPaymentProofInputRef = useRef(null);
  const [editPaymentRequestId, setEditPaymentRequestId] = useState("");
  const [lowDownpaymentWarning, setLowDownpaymentWarning] = useState(null);
  const [lowDownpaymentReason, setLowDownpaymentReason] = useState("");
  const [lowDownpaymentSellerApprovalParty, setLowDownpaymentSellerApprovalParty] = useState("");
  const [lowDownpaymentSellerApprovalConfirmed, setLowDownpaymentSellerApprovalConfirmed] = useState(false);
  const [lowDownpaymentWarningError, setLowDownpaymentWarningError] = useState("");
  const [paymentActionLoading, setPaymentActionLoading] = useState(false);
  const [paymentDocumentPreview, setPaymentDocumentPreview] = useState(null);
  const [paymentDocumentLoading, setPaymentDocumentLoading] = useState(false);
  const openPaymentDocumentPreview = (url, name = "Payment proof") => {
    if (!url) return;
    const isPdf = /\.pdf(?:$|[?#])/i.test(`${name} ${url}`);
    setPaymentDocumentPreview({ url, name, type: isPdf ? "application/pdf" : "image/preview", loading: false });
  };
  const [discrepancyResolutionNotes, setDiscrepancyResolutionNotes] = useState({});
  const paymentActionSubmittingRef = useRef(false);

  useEffect(() => () => {
    if (paymentDocumentPreview?.url?.startsWith("blob:")) URL.revokeObjectURL(paymentDocumentPreview.url);
  }, [paymentDocumentPreview?.url]);

  useEffect(() => {
    if (!editPaymentProofPreviewUrl) return undefined;
    return () => URL.revokeObjectURL(editPaymentProofPreviewUrl);
  }, [editPaymentProofPreviewUrl]);

  const handleEditPaymentProofSelection = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
    if (!supportedTypes.includes(file.type)) {
      toast.error("Choose a JPEG, PNG, WEBP, GIF, or PDF file.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Payment proof must be 4 MB or smaller.");
      return;
    }
    setEditPaymentProofPreviewUrl(URL.createObjectURL(file));
    setEditPaymentProofFile(file);
  };

  const clearEditPaymentProofSelection = () => {
    setEditPaymentProofPreviewUrl("");
    setEditPaymentProofFile(null);
    if (editPaymentProofInputRef.current) editPaymentProofInputRef.current.value = "";
  };

  const isCompletedProject = (order) => {
    const status = (order.status || "").toString().toLowerCase();
    const contractStatus = (order.contract_status || "").toString().toLowerCase();
    const progress = Number(order.progress || 0);
    const invalidStatuses = ["cancelled", "declined", "contract_declined", "rejected"];

    if (invalidStatuses.includes(status) || invalidStatuses.includes(contractStatus)) {
      return false;
    }

    const batchItems = Array.isArray(order.items) ? order.items : [];
    const allBatchItemsCompleted = batchItems.length > 1 && batchItems.every((item) => {
      const stages = Array.isArray(item?.progress_stages) ? item.progress_stages : [];
      if (stages.length > 0) {
        return stages.every((stage) =>
          stage.completed === true || ["done", "completed"].includes(String(stage.status || "").toLowerCase())
        );
      }
      return Number(item?.progress) >= 100;
    });

    return status === "completed" || progress >= 100 || allBatchItemsCompleted;
  };

  const formatCancelledStatus = (value) => String(value || "—")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  const formatCancelledDate = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "—"
      : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date);
  };

  const isEligibleForAdminCancellation = (order) => {
    const status = String(order?.status || "").toLowerCase();
    const contractStatus = String(order?.contract_status || "").toLowerCase();
    return canCancelTransactions
      && status !== "cancelled"
      && !["declined", "rejected", "contract_declined"].includes(status)
      && !["declined", "rejected", "contract_declined"].includes(contractStatus)
      && !isCompletedProject(order);
  };

  const getFeedbackEntries = (order) => {
    const entries = [];
    const hasOrderReview = order.review?.submittedAt || order.review?.rating;
    if (hasOrderReview) {
      entries.push({
        ...order,
        review: order.review,
        reviewItemIndex: null,
        reviewProductName: order.items?.length > 1
          ? "Batch order"
          : order.items?.[0]?.name || order.items?.[0]?.product_name || "Project",
      });
    }

    (order.items || []).forEach((item, itemIndex) => {
      if (!item?.review?.submittedAt && !item?.review?.rating) return;
      entries.push({
        ...order,
        review: item.review,
        reviewItemIndex: itemIndex,
        reviewProductName: item.name || item.product_name || `Product ${itemIndex + 1}`,
      });
    });

    return entries;
  };

  const transactionOrders = orders.filter(hasAcceptedTransactionContract);
  const financialOrders = transactionOrders.filter((order) => {
    const status = String(order.status || "").toLowerCase();
    const contractStatus = String(order.contract_status || "").toLowerCase();
    const excludedStatuses = ["declined", "rejected", "cancelled", "contract_declined"];
    return !excludedStatuses.includes(status) && !excludedStatuses.includes(contractStatus);
  });
  const getTransactionTotal = (order) => getPaymentSummary(order).totalAmount;
  const getConfirmedPayment = (order) => getPaymentSummary(order).paidAmount;

  // Warranty helpers
  const getInstallationStage = (order, item = null) => {
    const stages = item?.progress_stages?.length
      ? item.progress_stages
      : order?.progress_stages || order?.stages || [];
    return stages.find((stage) => {
      const stageKey = String(stage.key || "").toLowerCase();
      const stageName = String(stage.name || "").toLowerCase();
      const isInstallation = (stageKey.includes("installation") || stageName.includes("installation"))
        && !stageKey.includes("schedul")
        && !stageName.includes("schedul");
      return isInstallation;
    }) || null;
  };

  const getInstallationCompletionDate = (order, item = null) => {
    const installationStage = getInstallationStage(order, item);
    const isComplete = installationStage?.completed === true
      || ["done", "completed"].includes(String(installationStage?.status || "").toLowerCase());
    if (!isComplete) return null;
    const stageDate = installationStage?.installationCompletedAt
      || installationStage?.completedAt
      || installationStage?.date;
    if (stageDate) {
      const parsedStageDate = new Date(stageDate);
      if (!Number.isNaN(parsedStageDate.getTime()) && parsedStageDate <= new Date()) return parsedStageDate;
    }

    return null;
  };

  const getInstallationScheduleDate = (order, item = null) => {
    const installationStage = getInstallationStage(order, item);
    return installationStage?.proposedInstallationDate
      || installationStage?.date
      || null;
  };

  const parseWarrantyPeriod = (value) => {
    // Accepts strings like '1 year', '12 months', or numeric days
    if (!value) return null;
    if (typeof value === "number") return { days: value };
    const v = value.toString().toLowerCase();
    const yearMatch = v.match(/(\d+)\s*year/);
    if (yearMatch) return { days: Number(yearMatch[1]) * 365 };
    const monthMatch = v.match(/(\d+)\s*month/);
    if (monthMatch) return { days: Number(monthMatch[1]) * 30 };
    const daysMatch = v.match(/(\d+)\s*day/);
    if (daysMatch) return { days: Number(daysMatch[1]) };
    const n = Number(v);
    if (!isNaN(n)) return { days: n };
    return null;
  };

  const getWarrantyExpiry = (order) => {
    // Prefer explicit expiry field
    if (!order) return null;
    if (order.warranty_expiry_date) return new Date(order.warranty_expiry_date);
    if (order.warrantyExpiryDate) return new Date(order.warrantyExpiryDate);

    const completed = getInstallationCompletionDate(order);
    if (!completed) return null;

    // Check for warranty_period on order or items
    const period = order.warranty_period || order.warranty || order.warrantyPeriod || (order.items && order.items[0] && (order.items[0].warranty_period || order.items[0].warranty));
    const parsed = parseWarrantyPeriod(period);
    if (parsed && parsed.days) {
      const expiry = new Date(completed);
      expiry.setDate(expiry.getDate() + parsed.days);
      return expiry;
    }

    return null;
  };

  const getWarrantyRecords = (order) => {
    const itemRecords = (order?.items || [])
      .filter((item) => item?.warranty_start_date || item?.warranty_expiry_date || item?.warranty_status)
      .map((item) => ({
        status: String(item.warranty_status || "").toLowerCase(),
        start: item.warranty_start_date ? new Date(item.warranty_start_date) : null,
        expiry: item.warranty_expiry_date ? new Date(item.warranty_expiry_date) : null,
      }));
    if (itemRecords.length) return itemRecords;
    return order?.warranty_start_date || order?.warranty_expiry_date || order?.warranty_status
      ? [{
          status: String(order.warranty_status || "").toLowerCase(),
          start: order.warranty_start_date ? new Date(order.warranty_start_date) : null,
          expiry: getWarrantyExpiry(order),
        }]
      : [];
  };

  const getWarrantyStatus = (order) => {
    const items = Array.isArray(order.items) && order.items.length ? order.items : [order];
    const perProduct = order.warranty_assignment_mode === "per_product";
    const statuses = items.map((item) => {
      const status = String(item.warranty_status || order.warranty_status || "").toLowerCase();
      const period = item.warranty_period || (perProduct ? "" : order.warranty_period) || "";
      if (status === "no_warranty" || String(period).trim().toLowerCase() === "no warranty") return "No warranty";
      if (!period && !status && !item.warranty_start_date && !item.warranty_expiry_date) return "Not assigned";

      const isPending = status === "pending";
      const installationDate = getInstallationCompletionDate(order, item === order ? null : item);
      const startValue = isPending
        ? installationDate
        : item.warranty_start_date || (perProduct ? null : order.warranty_start_date) || installationDate;
      const start = startValue ? new Date(startValue) : null;
      const durationDays = period === "Custom"
        ? Number(item.custom_warranty_days || order.custom_warranty_days) || 90
        : parseWarrantyPeriod(period)?.days || Number(period) || null;
      const expiryValue = isPending
        ? null
        : item.warranty_expiry_date || (perProduct ? null : order.warranty_expiry_date);
      const expiry = expiryValue
        ? new Date(expiryValue)
        : start && durationDays
          ? new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000)
          : null;
      const now = new Date();

      if (status === "expired" || (expiry && expiry <= now)) return "Expired";
      if (
        (status === "active" || (installationDate && durationDays) || (!status && expiry)) &&
        (!start || start <= now) &&
        (!expiry || expiry > now)
      ) return "Active";
      if ((start && start > now) || installationDate) return "Pending activation";
      return "Pending installation";
    });

    const uniqueStatuses = [...new Set(statuses)];
    return uniqueStatuses.length === 1 ? uniqueStatuses[0] : "Mixed";
  };

  const getWarrantyStatusClass = (status) => {
    if (status === "Active") return "bg-emerald-100 text-emerald-700";
    if (status === "Expired" || status === "No warranty" || status === "Not assigned") return "bg-slate-100 text-slate-600";
    if (status === "Mixed") return "bg-blue-100 text-blue-700";
    return "bg-amber-100 text-amber-800";
  };

  const activeWarrantyCount = transactionOrders.reduce((count, order) => (
    count + getWarrantyRecords(order).filter(({ status, start, expiry }) => (
      (!start || start <= new Date()) && (status === "active" || (!status && expiry && new Date() <= expiry))
    )).length
  ), 0);

  const getReportRecordDates = (order, type) => {
    const transactionDate = order.transactionCreatedAt || order.acceptedAt || order.createdAt;
    const feedbackDates = [order.review, ...(order.items || []).map((item) => item.review)]
      .flatMap((review) => review ? [review.submittedAt || review.updatedAt] : []);
    const paymentRecords = order.payment_records || [];
    const paymentDates = paymentRecords.length
      ? paymentRecords.map((record) => record.payment_date || record.verified_at || record.recorded_at || record.submitted_at || record.createdAt)
      : (Number(order.amount_paid || order.payment_amount || order.paid_amount) > 0
        ? [order.payment_proof_confirmed_at || order.updatedAt || transactionDate]
        : []);
    const warrantyDates = [
      ...(order.warranty_period || order.warranty_start_date || order.warranty_expiry_date || order.warranty_status || order.warranty_terms
        ? [order.warranty_start_date || order.warranty_expiry_date || order.updatedAt || transactionDate]
        : []),
      ...(order.items || []).flatMap((item) => item.warranty_period || item.warranty_start_date || item.warranty_expiry_date || item.warranty_status || item.warranty_terms
        ? [item.warranty_start_date || item.warranty_expiry_date || order.updatedAt || transactionDate]
        : []),
    ];
    const datesByType = {
      customer_feedback: feedbackDates,
      payment_records: paymentDates,
      warranty_records: warrantyDates,
    };
    return type === "all_reports"
      ? [transactionDate, ...feedbackDates, ...paymentDates, ...warrantyDates]
      : datesByType[type] || [transactionDate];
  };
  const reportRecordDates = transactionOrders
    .flatMap((order) => getReportRecordDates(order, reportType))
    .map((value) => {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    })
    .filter(Boolean)
    .sort();
  const reportMinDate = reportRecordDates[0] || "";
  const reportMaxDate = reportRecordDates.at(-1) || "";
  const reportAvailableMonths = new Set(reportRecordDates.map((date) => date.slice(0, 7)));

  const isReportDateMonthAvailable = (date) => !date || reportAvailableMonths.has(date.slice(0, 7));

  const handleReportStartDateChange = (date) => {
    if (!isReportDateMonthAvailable(date)) {
      toast.error("There are no records in the selected month. Choose a month with transaction records.");
      return;
    }
    setReportStartDate(date);
    if (date && reportEndDate && date > reportEndDate) setReportEndDate("");
  };

  const handleReportEndDateChange = (date) => {
    if (!isReportDateMonthAvailable(date)) {
      toast.error("There are no records in the selected month. Choose a month with transaction records.");
      return;
    }
    setReportEndDate(date);
    if (date && reportStartDate && date < reportStartDate) setReportStartDate("");
  };

  const updateOrderLocally = (orderId, patch) => {
    setOrders((prev) =>
      prev.map((order) =>
        order._id === orderId || order.id === orderId
          ? { ...order, ...patch }
          : order
      )
    );
  };

  const handleConfirmProjectCancellation = async () => {
    if (!cancelTransactionOrder || cancellationLoading) return;
    const reason = cancellationReason.trim();
    if (!reason) {
      toast.error("Enter a cancellation reason.");
      return;
    }
    const orderId = String(cancelTransactionOrder._id || cancelTransactionOrder.id || "");
    if (!orderId) return;
    setCancellationLoading(true);
    try {
      const response = await cancelAdminOrder(orderId, { reason });
      if (!response?.order) throw new Error("The server did not confirm project cancellation.");
      setOrders((current) => current.map((order) => String(order._id || order.id || "") === orderId ? response.order : order));
      recordActivity(user, `Cancelled project ${response.order.tracking || orderId}.`, "Transactions");
      setCancelTransactionOrder(null);
      setCancellationReason("");
      setActiveTable("cancelled");
      setCancelledPage(1);
      toast.success("Project cancelled successfully.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to cancel this project.");
    } finally {
      setCancellationLoading(false);
    }
  };

  const handleGenerateTransactionReport = async (event) => {
    event.preventDefault();
    if (reportGenerationSubmittingRef.current || reportGenerationLoading) return;
    if (reportStartDate && reportEndDate && reportStartDate > reportEndDate) {
      toast.error("Start date must be on or before end date.");
      return;
    }
    if ((reportStartDate && ((reportMinDate && reportStartDate < reportMinDate) || (reportMaxDate && reportStartDate > reportMaxDate)))
      || (reportEndDate && ((reportMinDate && reportEndDate < reportMinDate) || (reportMaxDate && reportEndDate > reportMaxDate)))) {
      toast.error("Choose dates within the available transaction record dates.");
      return;
    }
    if (!isReportDateMonthAvailable(reportStartDate) || !isReportDateMonthAvailable(reportEndDate)) {
      toast.error("Choose a month that contains records for this report.");
      return;
    }
    reportGenerationSubmittingRef.current = true;
    setReportGenerationLoading(true);
    try {
      const { blob, filename } = await downloadTransactionReport({
        type: reportType,
        startDate: reportStartDate,
        endDate: reportEndDate,
        startAt: reportStartDate ? new Date(`${reportStartDate}T00:00:00`).toISOString() : "",
        endAt: reportEndDate ? new Date(`${reportEndDate}T23:59:59.999`).toISOString() : "",
        projectStatus: reportHasProjectStatus ? reportProjectStatus : "all",
        customer: reportCustomer,
        paymentStatus: reportHasPaymentStatus ? reportPaymentStatus : "all",
        search: reportSearch.trim(),
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setShowGenerateReportModal(false);
      toast.success("Transaction report downloaded.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to generate transaction report.");
    } finally {
      reportGenerationSubmittingRef.current = false;
      setReportGenerationLoading(false);
    }
  };

  const handleDeleteCustomerFeedback = async () => {
    if (!feedbackDeleteOrder) return;
    const orderId = feedbackDeleteOrder._id || feedbackDeleteOrder.id;
    if (!orderId) return;

    setFeedbackDeleting(true);
    setPaymentActionLoading(true);
    try {
      const response = await deleteOrderReview(orderId, feedbackDeleteOrder.reviewItemIndex);
      setOrders((previous) => previous.map((order) =>
        order._id === orderId || order.id === orderId
          ? response.order || (
            Number.isInteger(feedbackDeleteOrder.reviewItemIndex)
              ? {
                  ...order,
                  items: order.items.map((item, itemIndex) => itemIndex === feedbackDeleteOrder.reviewItemIndex
                    ? { ...item, review: null }
                    : item),
                }
              : { ...order, review: null }
          )
          : order
      ));
      recordActivity(
        user,
        `Deleted customer feedback for ${feedbackDeleteOrder.reviewProductName || "order"} ${feedbackDeleteOrder.tracking || orderId}.`,
        "Transactions",
      );
      setFeedbackPreviewOrder((previous) =>
        previous && (previous._id === orderId || previous.id === orderId) ? null : previous
      );
      setFeedbackDeleteOrder(null);
      toast.success("Customer feedback deleted.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to delete customer feedback.");
    } finally {
      setFeedbackDeleting(false);
    }
  };

  const handleToggleFeedbackVisibility = async (feedback) => {
    const orderId = feedback?._id || feedback?.id;
    if (!orderId || feedbackVisibilityUpdating) return;
    const hiddenFromCustomers = feedback.review?.hiddenFromCustomers !== true;
    setFeedbackVisibilityUpdating(true);
    try {
      const response = await setOrderReviewVisibility(orderId, {
        itemIndex: feedback.reviewItemIndex,
        hiddenFromCustomers,
      });
      setOrders((previous) => previous.map((order) => {
        if (String(order._id || order.id) !== String(orderId)) return order;
        if (response.order) return response.order;
        if (Number.isInteger(feedback.reviewItemIndex)) {
          return { ...order, items: order.items.map((item, index) => index === feedback.reviewItemIndex
            ? { ...item, review: { ...item.review, hiddenFromCustomers } }
            : item) };
        }
        return { ...order, review: { ...order.review, hiddenFromCustomers } };
      }));
      recordActivity(user, `${hiddenFromCustomers ? "Hid" : "Restored"} customer feedback for ${feedback.reviewProductName || "order"} ${feedback.tracking || orderId} ${hiddenFromCustomers ? "from" : "for"} customers.`, "Transactions");
      toast.success(hiddenFromCustomers ? "Review hidden from all customers." : "Review is visible to customers again.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to update review visibility.");
    } finally {
      setFeedbackVisibilityUpdating(false);
    }
  };

  const openFeedbackReply = (feedback) => {
    setFeedbackReplyOrder(feedback);
    setFeedbackReplyText(feedback?.review?.adminResponse || "");
    setFeedbackReplyTemplate("");
  };

  const handleSaveFeedbackReply = async (event) => {
    event.preventDefault();
    if (!feedbackReplyOrder || feedbackReplySaving || !feedbackReplyText.trim()) return;
    const orderId = feedbackReplyOrder._id || feedbackReplyOrder.id;
    setFeedbackReplySaving(true);
    try {
      const response = await respondToCustomerReview(orderId, {
        itemIndex: feedbackReplyOrder.reviewItemIndex,
        response: feedbackReplyText.trim(),
      });
      const savedOrder = response.order;
      setOrders((previous) => previous.map((order) =>
        String(order._id || order.id) === String(orderId) && savedOrder ? savedOrder : order
      ));
      setFeedbackReplyOrder(null);
      toast.success("Admin response saved.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to save admin response.");
    } finally {
      setFeedbackReplySaving(false);
    }
  };

  const buildContractDataFromOrder = (order) => {
    if (!order) return null;

    const amount = getPaymentSummary(order).totalAmount;
    const downPayment = getPaymentSummary(order).requiredAmount;
    const items = (order.items || []).map((item) => ({
      name: item.name || "Item",
      category: item.category || item.product_type || "General",
      quantity: item.quantity || 0,
      width: item.width || "—",
      height: item.height || "—",
      area: item.area || 0,
      unitPrice: Number(item.unit_price || 0),
      amount: Number(item.line_total || (item.is_estimate ? item.estimated_price : 0) || (item.quantity || 0) * Number(item.unit_price || 0)),
      warrantyPeriod: item.warranty_period,
      warrantyCustomDays: item.custom_warranty_days,
      warrantyStartDate: item.warranty_start_date,
      warrantyExpiryDate: item.warranty_expiry_date,
    }));

    const contractStatus = order.contract_status?.replace(/_/g, " ") || order.status?.replace(/_/g, " ") || "Pending";
    const accepted = (order.contract_status || order.status || "").toString().toLowerCase() === "accepted" || order.status === "contract_accepted";

    return {
      orderNumber: order.tracking || order._id || "N/A",
      contractDate: order.updatedAt ? formatDateToMMDDYYYY(order.updatedAt) : formatDateToMMDDYYYY(order.createdAt),
      orderDate: order.createdAt ? formatDateToMMDDYYYY(order.createdAt) : "N/A",
      status: order.status?.replace(/_/g, " ") || "Pending",
      contractStatus,
      customerName: order.customer?.first_name || order.customer_name || "Customer",
      customerEmail: order.customer?.email || order.customer_email || "N/A",
      customerPhone: order.customer?.phone || order.customer_phone || "N/A",
      projectLocation: order.shipping_address || "N/A",
      siteInspectionDate: order.inspection_date ? formatDateToMMDDYYYY(order.inspection_date) : "TBD",
      paymentTerms: order.payment_terms || "Standard payment terms apply.",
      contractTerms: order.contract_terms || "",
      subtotal: amount,
      totalProjectCost: amount,
      downPayment,
      items,
      accepted,
      acceptanceMethod: accepted ? "Online Acceptance" : null,
      acceptanceDate: accepted && order.updatedAt ? formatDateTimeToMMDDYYYY(order.updatedAt) : null,
      acceptedBy: order.customer?.first_name || order.customer_name || "Customer",
      contractId: order.tracking || order._id || "N/A",
      customerAccountId: order.customer?._id || order.customer || "N/A",
    };
  };

  const openContractModal = (order) => {
    if (!order) return;
    const data = buildContractDataFromOrder(order);
    setContractPreviewOrder(order);
    setContractPreviewData(data);
    setShowContractModal(true);
  };

  const openReadOnlyContract = (order) => {
    if (!order) return;
    setContractPreviewOrder(order);
    setContractPreviewData(buildContractDataFromOrder(order));
    setShowContractModal(false);
    setShowFullContractModal(true);
  };

  const openEditPaymentModal = (order) => {
    if (!order) return;
    const proof = getCustomerPaymentProof(order);
    const method = proof.paymentMethod || order.payment_method || (order.acceptance_method === "online" ? "Online" : "Cash");
    const hasUnconfirmedProof = proof.status === "pending" || (
      !(order.payment_records || []).length && Boolean(order.payment_proof_submitted_at && !isPaymentProofConfirmed(order))
    );
    const latestVerifiedRecord = [...(order.payment_records || [])].reverse().find((record) => record.status === "verified");

    setEditPaymentOrder(order);
    setEditPaymentMethod(method);
    setEditPaymentAmount(hasUnconfirmedProof && proof.amount > 0 ? String(proof.amount) : "");
    setEditPaymentTransactionNumber(proof.transactionNumber || order.transaction_number || order.transactionNumber || "");
    setEditPaymentReason("");
    setEditPaymentAction(hasUnconfirmedProof ? "verify" : "record");
    setEditPaymentRecordId(String(latestVerifiedRecord?._id || ""));
    setEditPaymentDate(new Date().toISOString().slice(0, 10));
    setEditPaymentProofFile(null);
    setEditPaymentProofPreviewUrl("");
    setEditPaymentRequestId(globalThis.crypto?.randomUUID?.() || `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setShowEditPaymentModal(true);
  };

  const closeContractModal = () => {
    setShowContractModal(false);
    setShowFullContractModal(false);
    setContractPreviewOrder(null);
    setContractPreviewData(null);
  };

  const closeEditPaymentModal = () => {
    setShowEditPaymentModal(false);
    setEditPaymentOrder(null);
    setEditPaymentMethod("Cash");
    setEditPaymentAmount("0.00");
    setEditPaymentTransactionNumber("");
    setEditPaymentReason("");
    setEditPaymentAction("record");
    setEditPaymentRecordId("");
    setEditPaymentDate("");
    setEditPaymentProofFile(null);
    setEditPaymentProofPreviewUrl("");
    setEditPaymentRequestId("");
    setLowDownpaymentWarning(null);
    setLowDownpaymentReason("");
    setLowDownpaymentSellerApprovalParty("");
    setLowDownpaymentSellerApprovalConfirmed(false);
    setLowDownpaymentWarningError("");
    setDiscrepancyResolutionNotes({});
  };

  const viewAdminPaymentSupportingDocument = async (orderId, recordId, document) => {
    if (paymentDocumentLoading) return;
    const documentType = document.format === "pdf" ? "application/pdf" : `image/${document.format === "jpg" ? "jpeg" : document.format}`;
    setPaymentDocumentPreview({ url: null, name: document.original_name, type: documentType, loading: true });
    setPaymentDocumentLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `${API_BASE}/orders/admin/${encodeURIComponent(orderId)}/payment-records/${encodeURIComponent(recordId)}/documents/${encodeURIComponent(document._id)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Unable to view the payment document.");
      }
      const blob = await response.blob();
      setPaymentDocumentPreview({
        url: URL.createObjectURL(blob),
        name: document.original_name,
        type: documentType || blob.type,
        loading: false,
      });
    } catch (error) {
      setPaymentDocumentPreview(null);
      toast.error(error.message || "Unable to view the payment document.");
    } finally {
      setPaymentDocumentLoading(false);
    }
  };

  const handleSavePaymentSupportingDocument = async () => {
    if (!editPaymentOrder || !editPaymentProofFile || paymentActionSubmittingRef.current || paymentActionLoading) return;
    const orderId = editPaymentOrder._id || editPaymentOrder.id;
    const proof = getCustomerPaymentProof(editPaymentOrder);
    const pendingRecord = proof.status === "pending"
      ? editPaymentOrder.payment_records?.find((record) => String(record._id) === String(proof.recordId))
      : null;
    const selectedRecord = editPaymentOrder.payment_records?.find((record) => String(record._id) === String(editPaymentRecordId));
    const targetRecord = pendingRecord || selectedRecord || editPaymentOrder.payment_records?.at(-1);
    if (!targetRecord) {
      toast.error("Save the payment record before adding a supporting document.");
      return;
    }

    paymentActionSubmittingRef.current = true;
    setPaymentActionLoading(true);
    try {
      const response = await uploadAdminPaymentDocument(orderId, targetRecord._id, editPaymentProofFile, editPaymentRequestId);
      const updated = response?.order || editPaymentOrder;
      updateOrderLocally(orderId, updated);
      setEditPaymentOrder(updated);
      clearEditPaymentProofSelection();
      setEditPaymentRequestId(globalThis.crypto?.randomUUID?.() || `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      toast.success("Supporting document saved. Payment status and amount are unchanged.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to save the supporting document.");
    } finally {
      paymentActionSubmittingRef.current = false;
      setPaymentActionLoading(false);
    }
  };

  const handleSavePaymentEdit = async ({
    acceptLowerDownpayment = false,
    reasonOverride,
    sellerApprovalConfirmed = false,
    sellerApprovalParty = "",
  } = {}) => {
    if (!editPaymentOrder) return;
    if (paymentActionSubmittingRef.current || paymentActionLoading) return;
    const amountValidation = validateCustomerPaymentAmount(editPaymentAmount, Number.MAX_SAFE_INTEGER);
    if (!amountValidation.valid) {
      toast.error(amountValidation.message);
      return;
    }
    const nextAmount = amountValidation.amount;

    const orderId = editPaymentOrder._id || editPaymentOrder.id;
    const previouslyRecordedPayment = editPaymentOrder.payment_records?.find((record) => record.request_id === editPaymentRequestId);
    if (previouslyRecordedPayment && editPaymentProofFile) {
      paymentActionSubmittingRef.current = true;
      setPaymentActionLoading(true);
      try {
        const uploadResponse = await uploadAdminPaymentDocument(orderId, previouslyRecordedPayment._id, editPaymentProofFile, editPaymentRequestId);
        const updated = uploadResponse?.order || editPaymentOrder;
        updateOrderLocally(orderId, updated);
        setEditPaymentOrder(updated);
        toast.success("Supporting document added to the payment record.");
        closeEditPaymentModal();
      } catch (error) {
        toast.error(error?.data?.message || error?.message || "Unable to save the supporting document.");
      } finally {
        paymentActionSubmittingRef.current = false;
        setPaymentActionLoading(false);
      }
      return;
    }
    if (nextAmount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }

    const existingSummary = getPaymentSummary(editPaymentOrder);
    const proof = getCustomerPaymentProof(editPaymentOrder);
    const pendingSubmission = proof.status === "pending" || (
      !(editPaymentOrder.payment_records || []).length && Boolean(editPaymentOrder.payment_proof_submitted_at && !isPaymentProofConfirmed(editPaymentOrder))
    );
    const selectedRecord = (editPaymentOrder.payment_records || []).find((record) => String(record._id) === editPaymentRecordId);
    const isAdjusting = !pendingSubmission && editPaymentAction === "adjust";
    const amountBeingReplaced = isAdjusting ? Number(selectedRecord?.verified_amount) || 0 : 0;
    const paidBeforeThisPayment = Math.max(existingSummary.paidAmount - amountBeingReplaced, 0);
    const remainingRequiredDownpayment = Math.max(existingSummary.requiredAmount - paidBeforeThisPayment, 0);
    const lowerPaymentReason = String(reasonOverride ?? editPaymentReason).trim();
    const isBelowRemainingDownpayment = Math.round(nextAmount * 100) < Math.round(remainingRequiredDownpayment * 100);
    if (isBelowRemainingDownpayment && !acceptLowerDownpayment) {
      setLowDownpaymentReason("");
      setLowDownpaymentSellerApprovalParty("");
      setLowDownpaymentSellerApprovalConfirmed(false);
      setLowDownpaymentWarningError("");
      setLowDownpaymentWarning({
        requiredAmount: existingSummary.requiredAmount,
        enteredAmount: nextAmount,
        remainingDownpayment: Math.max(remainingRequiredDownpayment - nextAmount, 0),
        remainingProjectBalance: Math.max(existingSummary.remainingAmount + amountBeingReplaced - nextAmount, 0),
      });
      return;
    }
    if (acceptLowerDownpayment && !lowerPaymentReason) {
      setLowDownpaymentWarningError("Provide a reason for accepting the lower payment.");
      return;
    }
    if (acceptLowerDownpayment && !sellerApprovalConfirmed) {
      setLowDownpaymentWarningError("Confirm that the seller approved this lower payment before proceeding.");
      return;
    }
    if (acceptLowerDownpayment && !String(sellerApprovalParty).trim()) {
      setLowDownpaymentWarningError("Record the seller or authorized party who approved this lower payment.");
      return;
    }
    const maxAllowedAmount = existingSummary.remainingAmount + amountBeingReplaced;
    if (Math.round(nextAmount * 100) > Math.round(maxAllowedAmount * 100)) {
      toast.error("Payment cannot exceed the remaining project balance.");
      return;
    }
    if (isAdjusting && !selectedRecord) {
      toast.error("Select the verified payment record to adjust.");
      return;
    }
    const submittedAmount = Number(proof.submittedAmount ?? proof.amount) || 0;
    const amountChanged = (pendingSubmission && Math.round(nextAmount * 100) !== Math.round(submittedAmount * 100))
      || (isAdjusting && Math.round(nextAmount * 100) !== Math.round(amountBeingReplaced * 100));
    const sellerApprovalPayload = acceptLowerDownpayment
      ? {
          seller_approval_confirmed: sellerApprovalConfirmed,
          seller_approval_party: String(sellerApprovalParty).trim(),
        }
      : {};
    if ((pendingSubmission || isAdjusting) && amountChanged && !lowerPaymentReason) {
      toast.error("Explain why the verified amount differs from the submitted or previously verified amount.");
      return;
    }
    const isAdminRecording = !pendingSubmission && !isAdjusting && editPaymentAction === "record";
    if (isAdminRecording && (!editPaymentDate || Number.isNaN(new Date(editPaymentDate).getTime()) || new Date(editPaymentDate) > new Date())) {
      toast.error("Provide a valid payment date that is not in the future.");
      return;
    }

    paymentActionSubmittingRef.current = true;
    setPaymentActionLoading(true);
    let paymentRecorded = false;
    try {
      let updated = editPaymentOrder;
      const supportingDocumentRecordId = isAdminRecording ? "" : isAdjusting ? editPaymentRecordId : proof.recordId;
      if (editPaymentProofFile && supportingDocumentRecordId) {
        const uploadResponse = await uploadAdminPaymentDocument(orderId, supportingDocumentRecordId, editPaymentProofFile, editPaymentRequestId);
        updated = uploadResponse?.order || updated;
        setEditPaymentOrder(updated);
        updateOrderLocally(orderId, updated);
      }
      const payload = {
        payment_record_action: pendingSubmission
          ? {
              action: acceptLowerDownpayment ? "accept_downpayment_exception" : "verify",
              ...(proof.recordId ? { record_id: proof.recordId } : {}),
              verified_amount: nextAmount,
              reason: lowerPaymentReason,
              ...sellerApprovalPayload,
            }
          : isAdjusting
            ? {
                action: "adjust",
                record_id: editPaymentRecordId,
                verified_amount: nextAmount,
                reason: lowerPaymentReason,
                ...(acceptLowerDownpayment ? { accept_downpayment_exception: true } : {}),
                ...sellerApprovalPayload,
              }
          : {
              action: "record",
              verified_amount: nextAmount,
              payment_method: editPaymentMethod,
              transaction_number: editPaymentTransactionNumber || editPaymentOrder.transaction_number || "",
              request_id: editPaymentRequestId,
              payment_date: editPaymentDate,
              reason: lowerPaymentReason,
              ...(acceptLowerDownpayment ? { accept_downpayment_exception: true } : {}),
              ...sellerApprovalPayload,
            },
      };

      const response = await updateOrderStatus(orderId, payload);
      updated = response?.order || updated;
      paymentRecorded = isAdminRecording && Boolean(updated.payment_records?.some((record) => record.request_id === editPaymentRequestId));
      if (isAdminRecording && editPaymentProofFile) {
        setEditPaymentOrder(updated);
        updateOrderLocally(orderId, updated);
      }
      if (isAdminRecording && editPaymentProofFile) {
        const recordedPayment = updated.payment_records?.find((record) => record.request_id === editPaymentRequestId);
        if (!recordedPayment) throw new Error("The payment record was saved, but its supporting document could not be associated.");
        const uploadResponse = await uploadAdminPaymentDocument(orderId, recordedPayment._id, editPaymentProofFile, editPaymentRequestId);
        updated = uploadResponse?.order || updated;
      }
      updateOrderLocally(orderId, {
        ...updated,
        payment_proof_amount: updated.payment_proof_amount ?? editPaymentOrder.payment_proof_amount ?? 0,
        payment_method: editPaymentMethod,
      });
      setEditPaymentOrder(updated);

      const updatedSummary = getPaymentSummary(updated);
      const remainingAfter = updatedSummary.remainingAmount;
      toast.success(
        updatedSummary.status.key === "paid"
          ? "Payment verified. Customer is now marked as Fully Paid."
          : `${pendingSubmission ? "Payment verified" : isAdjusting ? "Verified payment adjusted" : "Payment recorded"}. Status: ${updatedSummary.status.label}. Remaining balance: ₱${remainingAfter.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      );
    } catch (error) {
      console.error("Save payment edit failed", error);
      const errorMessage = error?.data?.message || error?.message || "Unable to save payment update.";
      toast.error(paymentRecorded
        ? `Payment was recorded, but the supporting document could not be saved: ${errorMessage}`
        : errorMessage);
      return;
    } finally {
      paymentActionSubmittingRef.current = false;
      setPaymentActionLoading(false);
    }

    closeEditPaymentModal();
  };

  const handleRejectPaymentProof = async () => {
    if (!editPaymentOrder) return;
    if (paymentActionSubmittingRef.current || paymentActionLoading) return;
    const proof = getCustomerPaymentProof(editPaymentOrder);
    if (!editPaymentReason.trim()) {
      toast.error("Provide a reason for rejecting this payment proof.");
      return;
    }
    const orderId = editPaymentOrder._id || editPaymentOrder.id;
    paymentActionSubmittingRef.current = true;
    setPaymentActionLoading(true);
    try {
      const response = await updateOrderStatus(orderId, {
        payment_record_action: {
          action: "reject",
          ...(proof.recordId ? { record_id: proof.recordId } : {}),
          reason: editPaymentReason.trim(),
        },
      });
      updateOrderLocally(orderId, response?.order || {});
      toast.success("Payment proof rejected. The customer was notified.");
      closeEditPaymentModal();
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to reject payment proof.");
    } finally {
      paymentActionSubmittingRef.current = false;
      setPaymentActionLoading(false);
    }
  };

  const handleUpdatePaymentDiscrepancyStatus = async (event) => {
    const { orderId, recordId, discrepancyId, action } = event.currentTarget.dataset;
    const reason = String(discrepancyResolutionNotes[discrepancyId] || "").trim();
    if (!reason) {
      toast.error("Add a note before updating the discrepancy status.");
      return;
    }
    if (paymentActionSubmittingRef.current || paymentActionLoading) return;
    paymentActionSubmittingRef.current = true;
    setPaymentActionLoading(true);
    try {
      const response = await updateOrderStatus(orderId, {
        payment_record_action: { action, record_id: recordId, discrepancy_id: discrepancyId, reason },
      });
      const updated = response?.order || editPaymentOrder;
      updateOrderLocally(orderId, updated);
      setEditPaymentOrder(updated);
      setDiscrepancyResolutionNotes((previous) => ({ ...previous, [discrepancyId]: "" }));
      toast.success(action === "resolve_discrepancy" ? "Payment discrepancy resolved." : "Discrepancy marked under review.");
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to update the payment discrepancy.");
    } finally {
      paymentActionSubmittingRef.current = false;
      setPaymentActionLoading(false);
    }
  };

  const openFullContractModal = () => {
    if (!contractPreviewOrder) return;
    setShowContractModal(false);
    setShowFullContractModal(true);
  };

  const createPrintClone = (el) => {
    const clone = el.cloneNode(true);
    clone.style.width = "794px";
    clone.style.height = "auto";
    clone.style.overflow = "visible";
    clone.style.position = "relative";
    clone.style.maxHeight = "none";
    clone.style.maxWidth = "794px";
    clone.style.border = "0";
    clone.style.borderRadius = "0";
    clone.style.boxShadow = "none";

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.opacity = "0";
    wrapper.style.pointerEvents = "none";
    wrapper.style.zIndex = "-1";
    wrapper.appendChild(clone);

    document.body.appendChild(wrapper);
    return { wrapper, clone };
  };

  const printContract = async () => {
    const el = document.getElementById("contract-content");
    if (!el) {
      toast.error("Unable to locate contract content for printing.");
      return;
    }

    const { wrapper, clone } = createPrintClone(el);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataUrl = await toPng(clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast.error("Please allow popups to print the contract.");
        return;
      }

      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Contract Print</title><style>@page{size:A4 portrait;margin:10mm;}html,body{margin:0;padding:0;background:#fff;}img{width:100%;height:auto;display:block;print-color-adjust:exact;-webkit-print-color-adjust:exact;}.no-print{display:none !important;}</style></head><body><img src="${dataUrl}" alt="Contract" /></body></html>`);
      printWindow.document.close();
      printWindow.focus();

      printWindow.onload = () => {
        printWindow.print();
      };
    } catch (err) {
      console.error("Failed to prepare contract for printing", err);
      toast.error("Failed to print contract.");
    } finally {
      if (wrapper?.parentNode) document.body.removeChild(wrapper);
    }
  };

  const downloadContractPDF = async () => {
    const el = document.getElementById("contract-content");
    if (!el) {
      toast.error("Unable to locate contract content for PDF export.");
      return;
    }

    const { wrapper, clone } = createPrintClone(el);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataUrl = await toPng(clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgProps = pdf.getImageProperties(dataUrl);
      const pageMargin = 28.35;
      const printableWidth = pdfWidth - pageMargin * 2;
      const printableHeight = pdfHeight - pageMargin * 2;
      const imgWidth = printableWidth;
      const imgHeight = (imgProps.height * printableWidth) / imgProps.width;

      let heightLeft = imgHeight;
      let position = pageMargin;
      pdf.addImage(dataUrl, "PNG", pageMargin, position, imgWidth, imgHeight);
      heightLeft -= printableHeight;

      while (heightLeft > 0) {
        position -= printableHeight;
        pdf.addPage();
        pdf.addImage(dataUrl, "PNG", pageMargin, position, imgWidth, imgHeight);
        heightLeft -= printableHeight;
      }

      pdf.save(`contract-${contractPreviewOrder?.tracking || contractPreviewOrder?._id || "export"}.pdf`);
    } catch (err) {
      console.error("Failed to export contract PDF", err);
      toast.error("Failed to download contract as PDF.");
    } finally {
      if (wrapper.parentNode) document.body.removeChild(wrapper);
    }
  };

  const downloadContractPNG = async () => {
    const el = document.getElementById("contract-content");
    if (!el) {
      toast.error("Unable to locate contract content for PNG export.");
      return;
    }

    const clone = el.cloneNode(true);
    clone.style.width = "794px";
    clone.style.height = "auto";
    clone.style.overflow = "visible";
    clone.style.position = "relative";
    clone.style.maxHeight = "none";
    clone.style.border = "0";
    clone.style.borderRadius = "0";
    clone.style.boxShadow = "none";

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.opacity = "0";
    wrapper.style.pointerEvents = "none";
    wrapper.appendChild(clone);

    document.body.appendChild(wrapper);

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const dataUrl = await toPng(clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `contract-${contractPreviewOrder?.tracking || contractPreviewOrder?._id || "export"}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to export contract PNG", err);
      toast.error("Failed to download contract as PNG.");
    } finally {
      document.body.removeChild(wrapper);
    }
  };

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    let refreshQueued = false;
    const fetchOrders = async (showLoading = true) => {
      if (requestInFlight) {
        refreshQueued = true;
        return;
      }
      requestInFlight = true;
      if (showLoading) setLoading(true);
      try {
        const res = await getAdminOrders({ module: "transactions" });
        if (active && res && res.orders) {
          setOrders(res.orders);
          setEditPaymentOrder((current) => {
            if (!current) return current;
            const currentId = String(current._id || current.id || "");
            const latest = res.orders.find((order) => String(order._id || order.id || "") === currentId);
            return latest ? { ...current, ...latest } : current;
          });
          setContractPreviewOrder((current) => {
            if (!current) return current;
            const currentId = String(current._id || current.id || "");
            const latest = res.orders.find((order) => String(order._id || order.id || "") === currentId);
            return latest ? { ...current, ...latest } : current;
          });
        }
      } catch (err) {
        console.error("Failed to fetch orders", err);
      } finally {
        if (active && showLoading) setLoading(false);
        requestInFlight = false;
        if (active && refreshQueued) {
          refreshQueued = false;
          void fetchOrders(false);
        }
      }
    };

    fetchOrders();

    const refreshOrders = () => {
      if (document.visibilityState === "visible") fetchOrders(false);
    };
    const unsubscribeRealtime = subscribeToRealtime(["orders", "reviews", "repairs"], refreshOrders);
    window.addEventListener("focus", refreshOrders);
    document.addEventListener("visibilitychange", refreshOrders);

    return () => {
      active = false;
      window.removeEventListener("focus", refreshOrders);
      document.removeEventListener("visibilitychange", refreshOrders);
      unsubscribeRealtime();
    };
  }, []);

  // Receipts & Contracts: orders that have a contract and are not cancelled/declined
  const receipts = transactionOrders.filter((o) => {
    const status = (o.contract_status || "").toString().toLowerCase();
    const orderStatus = (o.status || "").toString().toLowerCase();
    const blockedStatuses = [
      "pending",
      "sent",
      "contract_sent",
      "declined",
      "rejected",
      "cancelled",
      "contract_declined",
    ];

    return (
      hasAcceptedTransactionContract(o) &&
      !blockedStatuses.includes(status) &&
      !blockedStatuses.includes(orderStatus)
    );
  });

  const filteredReceipts = receipts.filter((o) => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    const customer = (o.customer_name || o.customer?.first_name || "").toString().toLowerCase();
    const project = (o.items?.[0]?.name || "").toString().toLowerCase();
    const tracking = (o.tracking || "").toString().toLowerCase();
    return tracking.includes(q) || customer.includes(q) || project.includes(q);
  });

  const activeTransactionOrders = transactionOrders.filter((order) => String(order.status || "").toLowerCase() !== "cancelled");
  const cancelledTransactions = transactionOrders.filter(isRecordedCancelledTransaction);
  const inProgressProjects = activeTransactionOrders.filter((order) => !isCompletedProject(order));

  // Completed projects: orders that are completed by status or progress
  const completedProjects = transactionOrders.filter((o) => isCompletedProject(o));
  const feedbackOrders = transactionOrders.flatMap(getFeedbackEntries);
  const financialTotals = financialOrders.reduce((totals, order) => {
    const total = getTransactionTotal(order);
    const collected = getConfirmedPayment(order);
    totals.revenue += total;
    totals.collected += collected;
    totals.pending += Math.max(total - collected, 0);
    return totals;
  }, { revenue: 0, collected: 0, pending: 0 });
  const validRatings = feedbackOrders
    .map((order) => Number(order.review?.rating))
    .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
  const averageRating = validRatings.length
    ? validRatings.reduce((total, rating) => total + rating, 0) / validRatings.length
    : 0;
  const formatCurrency = (amount) => hidePaymentAmounts ? "••••••" : `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const summaryMetrics = [
    { label: "Total Revenue", value: formatCurrency(financialTotals.revenue), color: "text-rose-300" },
    { label: "Total Collected", value: formatCurrency(financialTotals.collected), color: "text-emerald-300" },
    { label: "Pending Balance", value: formatCurrency(financialTotals.pending), color: "text-amber-200" },
    { label: "Completed Projects", value: completedProjects.length.toLocaleString(), color: "text-emerald-300" },
    { label: "Average Customer Rating", value: `${averageRating.toFixed(1)} / 5 (${validRatings.length})`, color: "text-orange-300" },
  ];
  const filteredFeedbackOrders = feedbackOrders.filter((order) => {
    if (!tableSearch) return true;
    const query = tableSearch.toLowerCase();
    const customer = (order.customer_name || order.customer?.first_name || "").toString().toLowerCase();
    const products = (order.reviewProductName || "").toLowerCase();
    const tracking = (order.tracking || "").toString().toLowerCase();
    const title = (order.review?.title || "").toLowerCase();
    const comment = (order.review?.comment || "").toLowerCase();
    return [customer, products, tracking, title, comment].some((value) => value.includes(query));
  });
  const feedbackSelectionKey = (feedback) => `${String(feedback._id || feedback.id)}:${Number.isInteger(feedback.reviewItemIndex) ? feedback.reviewItemIndex : "order"}`;
  const selectableFeedbackOrders = filteredFeedbackOrders.filter((feedback) => feedback.review?.hiddenFromCustomers !== true);
  const selectedFeedbackOrders = feedbackOrders.filter((feedback) => selectedFeedbackKeys.has(feedbackSelectionKey(feedback)) && feedback.review?.hiddenFromCustomers !== true);
  const allVisibleFeedbackSelected = selectableFeedbackOrders.length > 0 && selectableFeedbackOrders.every((feedback) => selectedFeedbackKeys.has(feedbackSelectionKey(feedback)));
  const toggleFeedbackSelection = (feedback, selected) => {
    const key = feedbackSelectionKey(feedback);
    setSelectedFeedbackKeys((current) => {
      const next = new Set(current);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const toggleAllVisibleFeedback = (selected) => {
    setSelectedFeedbackKeys((current) => {
      const next = new Set(current);
      selectableFeedbackOrders.forEach((feedback) => {
        const key = feedbackSelectionKey(feedback);
        if (selected) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };
  const handleHideSelectedFeedback = async () => {
    if (!selectedFeedbackOrders.length || feedbackVisibilityUpdating) return;
    setFeedbackVisibilityUpdating(true);
    const updatedOrders = new Map();
    let failures = 0;
    for (const feedback of selectedFeedbackOrders) {
      try {
        const response = await setOrderReviewVisibility(feedback._id || feedback.id, {
          itemIndex: feedback.reviewItemIndex,
          hiddenFromCustomers: true,
        });
        if (response.order) updatedOrders.set(String(response.order._id || response.order.id), response.order);
      } catch (error) {
        failures += 1;
      }
    }
    if (updatedOrders.size) {
      setOrders((current) => current.map((order) => updatedOrders.get(String(order._id || order.id)) || order));
      recordActivity(user, `Hid ${updatedOrders.size} customer review${updatedOrders.size === 1 ? "" : "s"} from customers.`, "Transactions");
    }
    setSelectedFeedbackKeys(new Set());
    if (updatedOrders.size) toast.success(`${updatedOrders.size} review${updatedOrders.size === 1 ? "" : "s"} hidden from customers.`);
    if (failures) toast.error(`${failures} selected review${failures === 1 ? "" : "s"} could not be hidden.`);
    setFeedbackVisibilityUpdating(false);
  };
  const filteredAllOrders = activeTransactionOrders.filter((o) => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    const customer = (o.customer_name || o.customer?.first_name || "").toString().toLowerCase();
    const project = (o.items?.[0]?.name || "").toString().toLowerCase();
    const tracking = (o.tracking || "").toString().toLowerCase();
    return tracking.includes(q) || customer.includes(q) || project.includes(q);
  });
  const filteredInProgressProjects = inProgressProjects.filter((o) => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    const customer = (o.customer_name || o.customer?.first_name || "").toString().toLowerCase();
    const project = (o.items?.[0]?.name || "").toString().toLowerCase();
    const tracking = (o.tracking || "").toString().toLowerCase();
    return tracking.includes(q) || customer.includes(q) || project.includes(q);
  });
  const transactionTabs = [
    { key: "all", label: "All", count: activeTransactionOrders.length },
    { key: "in_progress", label: "Ongoing Project", count: inProgressProjects.length },
    { key: "projects", label: "Completed Projects", count: completedProjects.length },
    { key: "receipts", label: "Contract & Warranties", count: receipts.length },
    { key: "feedback", label: "Customer Feedbacks", count: feedbackOrders.length },
    { key: "cancelled", label: "Cancelled", count: cancelledTransactions.length },
  ];
  const reportCustomerOptions = (() => {
    const customers = new Map();
    orders.forEach((order) => {
      const name = order.customer_name || `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() || order.customer_email || "Customer";
      const customerId = order.customer?._id || order.customer?.id || (typeof order.customer === "string" ? order.customer : "");
      const value = customerId ? String(customerId) : `name:${name}`;
      customers.set(value, { value, label: name });
    });
    return [...customers.values()].sort((first, second) => first.label.localeCompare(second.label));
  })();
  const reportHasProjectStatus = ["all_reports", "all_transactions", "completed_projects", "active_projects", "pending_transactions"].includes(reportType);
  const reportHasPaymentStatus = ["all_reports", "all_transactions", "pending_transactions", "payment_records"].includes(reportType);

  useEffect(() => {
    if (!highlightedNotificationRecordId) return;
    const targetIndex = transactionOrders.findIndex((order) => String(order._id || order.id) === highlightedNotificationRecordId);
    setActiveTable("all");
    setTableSearch("");
    if (targetIndex >= 0) setAllPage(Math.floor(targetIndex / rowsPerPage) + 1);
  }, [highlightedNotificationRecordId, orders]);

  const receiptLastIndex =
    receiptPage * rowsPerPage;

  const receiptFirstIndex =
    receiptLastIndex - rowsPerPage;

  const currentReceipts = filteredReceipts.slice(
    receiptFirstIndex,
    receiptLastIndex
  );
  const allTotalPages = Math.max(1, Math.ceil(filteredAllOrders.length / rowsPerPage));
  const currentAll = filteredAllOrders.slice((allPage - 1) * rowsPerPage, allPage * rowsPerPage);
  const inProgressTotalPages = Math.max(1, Math.ceil(filteredInProgressProjects.length / rowsPerPage));
  const currentInProgress = filteredInProgressProjects.slice((inProgressPage - 1) * rowsPerPage, inProgressPage * rowsPerPage);
  const feedbackTotalPages = Math.max(1, Math.ceil(filteredFeedbackOrders.length / rowsPerPage));
  const currentFeedback = filteredFeedbackOrders.slice((feedbackPage - 1) * rowsPerPage, feedbackPage * rowsPerPage);

  const receiptTotalPages = Math.max(1, Math.ceil(
    filteredReceipts.length / rowsPerPage
  ));

  const projectLastIndex =
    projectPage * rowsPerPage;

  const projectFirstIndex =
    projectLastIndex - rowsPerPage;

  const currentProjects =
    completedProjects.slice(
      projectFirstIndex,
      projectLastIndex
    );

  const projectTotalPages = Math.max(1, Math.ceil(
    completedProjects.length / rowsPerPage
  ));

  const filteredCompleted = completedProjects.filter((o) => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    const customer = (o.customer_name || o.customer?.first_name || "").toString().toLowerCase();
    const project = (o.items?.[0]?.name || "").toString().toLowerCase();
    const tracking = (o.tracking || "").toString().toLowerCase();
    return tracking.includes(q) || customer.includes(q) || project.includes(q);
  });

  const currentProjectsFiltered = filteredCompleted.slice(projectFirstIndex, projectLastIndex);

  const projectTotalPagesFiltered = Math.max(1, Math.ceil(filteredCompleted.length / rowsPerPage));

  const cancelledLastIndex =
    cancelledPage * rowsPerPage;

  const cancelledFirstIndex =
    cancelledLastIndex - rowsPerPage;

  const currentCancelled =
    cancelledTransactions.slice(
      cancelledFirstIndex,
      cancelledLastIndex
    );

  const cancelledTotalPages = Math.max(1, Math.ceil(
    cancelledTransactions.length / rowsPerPage
  ));

  const filteredCancelled = cancelledTransactions.filter((o) => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    const customer = (o.customer_name || o.customer?.first_name || "").toString().toLowerCase();
    const project = (o.items?.[0]?.name || "").toString().toLowerCase();
    const tracking = (o.tracking || "").toString().toLowerCase();
    const reason = String(o.cancellation_reason || "").toLowerCase();
    const cancellationActor = String(o.cancelled_by_name || "").toLowerCase();
    return [tracking, customer, project, reason, cancellationActor].some((value) => value.includes(q));
  });

  const currentCancelledFiltered = filteredCancelled.slice(cancelledFirstIndex, cancelledLastIndex);

  const cancelledTotalPagesFiltered = Math.max(1, Math.ceil(filteredCancelled.length / rowsPerPage));

  const currentData = isMobile && activeTable !== "cancelled"
    ? activeTable === "all"
      ? filteredAllOrders
      : activeTable === "in_progress"
        ? filteredInProgressProjects
        : activeTable === "receipts"
        ? filteredReceipts
        : activeTable === "projects"
          ? filteredCompleted
          : filteredFeedbackOrders
    : activeTable === "all"
      ? currentAll
      : activeTable === "in_progress"
      ? currentInProgress
      : activeTable === "receipts"
      ? currentReceipts
      : activeTable === "projects"
      ? currentProjectsFiltered
      : activeTable === "feedback"
      ? currentFeedback
      : currentCancelledFiltered;

  const activePage = activeTable === "all"
    ? allPage
    : activeTable === "in_progress"
    ? inProgressPage
    : activeTable === "receipts"
    ? receiptPage
    : activeTable === "projects"
    ? projectPage
    : activeTable === "feedback"
    ? feedbackPage
    : cancelledPage;
  const activeTotalPages = activeTable === "all"
    ? allTotalPages
    : activeTable === "in_progress"
    ? inProgressTotalPages
    : activeTable === "receipts"
    ? receiptTotalPages
    : activeTable === "projects"
    ? projectTotalPagesFiltered
    : activeTable === "feedback"
    ? feedbackTotalPages
    : cancelledTotalPagesFiltered;
  const setActivePage = (page) => {
    if (activeTable === "all") setAllPage(page);
    else if (activeTable === "in_progress") setInProgressPage(page);
    else if (activeTable === "receipts") setReceiptPage(page);
    else if (activeTable === "projects") setProjectPage(page);
    else if (activeTable === "feedback") setFeedbackPage(page);
    else setCancelledPage(page);
  };

  const renderClientCell = (order, customerName) => (
    <ProfileAvatar name={customerName} email={order.customer?.email || order.customer_email || ""} />
  );

  const editPaymentModalContent = showEditPaymentModal && editPaymentOrder ? (() => {
    const shellClass = darkMode
      ? "mobile-fullscreen-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      : "mobile-fullscreen-overlay fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30 p-4";
    const modalClass = darkMode
      ? "mobile-fullscreen-dialog flex min-h-0 max-h-[90vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#17283d] shadow-[0_18px_60px_rgba(2,6,23,0.45)] ring-1 ring-slate-700"
      : "mobile-fullscreen-dialog flex min-h-0 max-h-[90vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.12)] ring-1 ring-slate-200";
    const titleClass = darkMode ? "text-red-400" : "text-red-500";
    const nameClass = darkMode ? "text-slate-100" : "text-slate-900";
    const subtitleClass = darkMode ? "text-slate-400" : "text-slate-500";
    const closeButtonClass = darkMode
      ? "rounded-md p-1.5 text-slate-400 transition hover:bg-slate-700 hover:text-slate-100"
      : "rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900";
    const headerPanelClass = darkMode ? "border-t border-slate-700 bg-[#1d2f45]" : "border-t border-slate-200 bg-slate-50";
    const alertClass = darkMode
      ? "flex items-start gap-3 rounded-xl border border-red-500/40 bg-[#2b1d1d] px-3 py-3 text-sm text-red-200"
      : "flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700";
    const alertIconClass = darkMode ? "text-red-400" : "text-red-500";
    const bodyClass = darkMode ? "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3 text-slate-200 sm:px-5 sm:py-4" : "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3 text-slate-700 sm:px-5 sm:py-4";
    const labelClass = darkMode ? "text-slate-400" : "text-slate-500";
    const inputClass = darkMode
      ? "w-full rounded-xl border border-slate-600 bg-[#1d2f45] px-3 py-2.5 text-base text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-500/30"
      : "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-100";
    const panelClass = darkMode ? "rounded-xl border border-slate-700 bg-[#1d2f45]" : "rounded-xl border border-slate-200 bg-slate-50";
    const optionWrapClass = darkMode ? "grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-[#1d2f45] p-1" : "grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1";
    const optionBaseClass = darkMode ? "bg-[#132238] text-slate-300" : "bg-white text-slate-600";
    const onlineSelectedClass = darkMode ? "border border-red-500/50 bg-[#2d1d1d] text-red-200" : "border border-red-200 bg-red-50 text-red-700";
    const cashSelectedClass = darkMode ? "border border-emerald-500/50 bg-emerald-500/15 text-emerald-200" : "border border-emerald-200 bg-emerald-50 text-emerald-700";
    const linkClass = darkMode
      ? "flex w-full items-center justify-between rounded-xl border border-slate-600 bg-[#1d2f45] px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-700"
      : "flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-100";
    const previewCardClass = darkMode ? "rounded-xl border border-slate-700 bg-[#132238] p-3 shadow-sm" : "rounded-xl border border-slate-200 bg-white p-3 shadow-sm";
    const secondaryTextClass = darkMode ? "text-slate-300" : "text-slate-600";
    const tertiaryTextClass = darkMode ? "text-slate-400" : "text-slate-500";
    const strongTextClass = darkMode ? "text-slate-100" : "text-slate-900";
    const footerCancelClass = darkMode ? "rounded-xl border border-slate-600 bg-[#15263f] px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-700" : "rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100";
    const footerSaveClass = darkMode ? "rounded-xl border border-red-500/50 bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500" : "rounded-xl border border-red-200 bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500";
    const proofIconBoxClass = darkMode ? "inline-flex h-5 w-5 items-center justify-center rounded bg-slate-700 text-slate-200" : "inline-flex h-5 w-5 items-center justify-center rounded bg-slate-200 text-slate-700";
    const proofLinkClass = darkMode
      ? "flex items-center gap-2 rounded-lg border border-slate-700 bg-[#1d2f45] px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700 hover:text-white"
      : "flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-900";
    const currentProof = getCustomerPaymentProof(editPaymentOrder);
    const pendingPaymentProof = currentProof.status === "pending" || (
      !(editPaymentOrder.payment_records || []).length && Boolean(editPaymentOrder.payment_proof_submitted_at && !isPaymentProofConfirmed(editPaymentOrder))
    );
    const footerClass = pendingPaymentProof
      ? darkMode
        ? "grid grid-cols-2 gap-2 border-t border-slate-700 bg-[#1d2f45] px-4 py-3 min-[560px]:grid-cols-3 sm:gap-3 sm:px-5 sm:py-4"
        : "grid grid-cols-2 gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 min-[560px]:grid-cols-3 sm:gap-3 sm:px-5 sm:py-4"
      : darkMode
        ? "grid grid-cols-2 gap-2 border-t border-slate-700 bg-[#1d2f45] px-4 py-3 sm:gap-3 sm:px-5 sm:py-4"
        : "grid grid-cols-2 gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:gap-3 sm:px-5 sm:py-4";
    const verifiedPaymentRecords = (editPaymentOrder.payment_records || []).filter((record) => record.status === "verified");
    const selectedVerifiedRecord = verifiedPaymentRecords.find((record) => String(record._id) === editPaymentRecordId);
    const adjustingVerifiedPayment = !pendingPaymentProof && editPaymentAction === "adjust";
    const adminRecordingPayment = !pendingPaymentProof && !adjustingVerifiedPayment && editPaymentAction === "record";
    const maxConfirmableAmount = getPaymentSummary(editPaymentOrder).remainingAmount
      + (adjustingVerifiedPayment ? Number(selectedVerifiedRecord?.verified_amount) || 0 : 0);
    const paymentSummary = getPaymentSummary(editPaymentOrder);
    const orderId = editPaymentOrder._id || editPaymentOrder.id;
    const supportingDocuments = (editPaymentOrder.payment_records || []).flatMap((record) => (
      (record.supporting_documents || []).map((document) => ({
        ...document,
        paymentRecordId: String(record._id),
      }))
    ));

    return (
      <div className={shellClass}>
        <div className={modalClass}>
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
            <div>
              <div className={`text-[11px] font-extrabold uppercase tracking-[0.18em] ${titleClass}`}>EDIT PAYMENT</div>
              <div className={`mt-1 text-[15px] font-bold ${nameClass}`}>{editPaymentOrder.customer_name || `${editPaymentOrder.customer?.first_name || ""} ${editPaymentOrder.customer?.last_name || ""}`.trim() || "Customer"}</div>
              <div className={`text-[12px] ${subtitleClass}`}>{editPaymentOrder.items?.[0]?.name || "Sliding Window"}</div>
            </div>
            <button type="button" onClick={closeEditPaymentModal} className={closeButtonClass} aria-label="Close edit payment modal">
              <X size={16} />
            </button>
          </div>

          <div className={`${headerPanelClass} shrink-0`}>
            <div className={`${alertClass} mx-3 my-3 sm:mx-5`}>
              <Info size={18} className={`mt-0.5 shrink-0 ${alertIconClass}`} />
              <span>You may update the amount paid, payment method, and transaction number.</span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-1">
          <div className={`${bodyClass} order-2 lg:order-1`}>
            {!pendingPaymentProof && verifiedPaymentRecords.length > 0 && (
              <div>
                <label htmlFor="payment-action-mode" className={`mb-2 block text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>PAYMENT ACTION</label>
                <CustomerDropdown darkMode={darkMode}
                  id="payment-action-mode"
                  value={editPaymentAction}
                  onChange={(event) => {
                    const nextAction = event.target.value;
                    setEditPaymentAction(nextAction);
                    if (nextAction === "adjust") {
                      const record = verifiedPaymentRecords.find((entry) => String(entry._id) === editPaymentRecordId) || verifiedPaymentRecords.at(-1);
                      setEditPaymentRecordId(String(record?._id || ""));
                      setEditPaymentAmount(String(record?.verified_amount ?? ""));
                    } else {
                      setEditPaymentAmount("");
                    }
                    setEditPaymentReason("");
                  }}
                  className={inputClass}
                >
                  <option value="record">Record a new payment</option>
                  <option value="adjust">Correct a verified payment</option>
                </CustomerDropdown>
              </div>
            )}
            {adjustingVerifiedPayment && (
              <div>
                <label htmlFor="payment-record-to-adjust" className={`mb-2 block text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>VERIFIED PAYMENT TO CORRECT</label>
                <CustomerDropdown darkMode={darkMode}
                  id="payment-record-to-adjust"
                  value={editPaymentRecordId}
                  onChange={(event) => {
                    setEditPaymentRecordId(event.target.value);
                    const record = verifiedPaymentRecords.find((entry) => String(entry._id) === event.target.value);
                    setEditPaymentAmount(String(record?.verified_amount ?? ""));
                    setEditPaymentReason("");
                  }}
                  className={inputClass}
                >
                  {verifiedPaymentRecords.map((record) => (
                    <option key={record._id} value={record._id}>
                      {formatDateToMMMDDYYYY(record.verified_at)} · ₱{Number(record.verified_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </option>
                  ))}
                </CustomerDropdown>
              </div>
            )}
            {(() => {
              const proof = getCustomerPaymentProof(editPaymentOrder);
              if (proof.submitted) {
                return (
                  <div className="space-y-3">
                    <div className={darkMode ? "rounded-xl border border-amber-400/30 bg-[#2f2a18] px-3 py-2.5 text-sm text-amber-100 shadow-sm" : "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 shadow-sm"}>
                      <p className="font-medium leading-6">
                        Customer says they paid <span className={darkMode ? "font-bold text-white" : "font-bold text-slate-900"}>₱{Number(proof.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>. Confirm it matches what you received.
                      </p>
                      {(() => {
                        const customerAmount = Number(proof.amount || 0);
                        const adminAmount = Number(editPaymentAmount || 0);
                        const differs = Math.round(customerAmount * 100) !== Math.round(adminAmount * 100);
                        return differs ? (
                          <p role="alert" className="mt-2 font-semibold">
                            Payment discrepancy: customer-reported <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(customerAmount)}</span>, admin amount to verify <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(adminAmount)}</span>, difference <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Math.abs(customerAmount - adminAmount))}</span>. Add a reason and review any supporting evidence before saving.
                          </p>
                        ) : null;
                      })()}
                      <button
                        type="button"
                        onClick={() => {
                          const nextValue = Number(proof.amount || 0).toFixed(2);
                          setEditPaymentAmount(nextValue);
                          setTimeout(() => {
                            document.getElementById("edit-payment-amount-field")?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                          }, 50);
                        }}
                        className={darkMode
                          ? "mt-2 inline-flex items-center justify-center rounded-xl border border-amber-400/50 bg-gradient-to-r from-amber-500 to-yellow-500 px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-950 shadow-sm transition hover:brightness-110"
                          : "mt-2 inline-flex items-center justify-center rounded-xl border border-amber-300 bg-gradient-to-r from-amber-400 to-yellow-400 px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-amber-950 shadow-sm transition hover:brightness-105"}
                      >
                        Use this amount
                      </button>
                    </div>

                    <div>
                      <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>PROOF OF PAYMENT</div>
                      <button type="button" onClick={() => proof.fileUrl && openPaymentDocumentPreview(proof.fileUrl, proof.fileName || "Payment proof")} className={linkClass}
                      >
                        <span className="flex items-center gap-2">
                          <span className={proofIconBoxClass}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                              <path d="M10.5 13.5l6.1-6.1a3.2 3.2 0 1 1 4.5 4.5l-8.8 8.8a4.8 4.8 0 1 1-6.8-6.8l8.5-8.5" />
                            </svg>
                          </span>
                          <span className="font-medium">View Proof of Payment</span>
                        </span>
                        <span className={tertiaryTextClass}>↗</span></button>

                      {proof.fileUrl ? (
                        <div className={`mt-3 overflow-hidden rounded-xl border p-3 ${panelClass}`}>
                          <button type="button" onClick={() => openPaymentDocumentPreview(proof.fileUrl, proof.fileName || "Proof of payment")} className={darkMode ? "block w-full overflow-hidden rounded-lg border border-slate-700 bg-white" : "block w-full overflow-hidden rounded-lg border border-slate-200 bg-white"}>
                            <img
                              src={proof.fileUrl}
                              alt="Proof of payment"
                              className="max-h-[420px] w-full object-contain"
                            /></button>
                        </div>
                      ) : null}

                      <div className={`mt-3 overflow-hidden rounded-xl border p-3 ${panelClass}`}>
                        <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.16em] ${labelClass}`}>Customer Payment Submissions (1)</div>

                        <div className={previewCardClass}>
                          <div className={`mb-3 flex items-center justify-between gap-3 text-sm ${secondaryTextClass}`}>
                            <span className={darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-700"}>Payment #1</span>
                            <span className={tertiaryTextClass}>{formatDateToMMMDDYYYY(new Date())}</span>
                          </div>

                          <div className={`grid gap-2 text-sm sm:grid-cols-[1fr_auto] sm:items-end ${secondaryTextClass}`}>
                            <div>
                              <div className={`text-[11px] font-medium ${tertiaryTextClass}`}>Customer declared</div>
                              <div className={`mt-1 text-[15px] font-semibold ${strongTextClass}`}>
                                ₱{Number(proof.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            </div>

                            <div className={darkMode ? "inline-flex items-center rounded-full border border-amber-400/40 bg-[#2f2a18] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300" : "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700"}>
                              Awaiting confirmation
                            </div>
                          </div>

                          <div className={`mt-4 space-y-2 border-t pt-3 text-sm ${secondaryTextClass} ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">Submitted amount</span>
                              <span className={darkMode ? "font-semibold text-red-400" : "font-semibold text-red-600"}>₱{Number(proof.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            {proof.transactionNumber && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">Transaction</span>
                                <span className={darkMode ? "font-semibold text-slate-100" : "font-semibold text-slate-800"}>{proof.transactionNumber}</span>
                              </div>
                            )}
                            {proof.fileName && (
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">Attachment</span>
                                <span className={`max-w-[150px] truncate text-right font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`} title={proof.fileName}>{proof.fileName}</span>
                              </div>
                            )}
                          </div>

                          <div className="mt-3">
                            <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.14em] ${labelClass}`}>View proof</div>
                            <button type="button" onClick={() => proof.fileUrl && openPaymentDocumentPreview(proof.fileUrl, proof.fileName || "Payment proof")} className={proofLinkClass}
                            >
                              <span className={proofIconBoxClass}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                                  <path d="M10.5 13.5l6.1-6.1a3.2 3.2 0 1 1 4.5 4.5l-8.8 8.8a4.8 4.8 0 1 1-6.8-6.8l8.5-8.5" />
                                </svg>
                              </span>
                              <span className="truncate">{proof.fileName || "Proof of payment"}</span></button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div>
                  <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>PROOF OF PAYMENT</div>
                  <p className={tertiaryTextClass}>Customer has not submitted proof of payment yet.</p>
                </div>
              );
            })()}

            <section className={`${panelClass} space-y-3 p-3`}>
              <div>
                <h3 className={`text-[11px] font-extrabold uppercase tracking-[0.16em] ${labelClass}`}>Admin Proof of Payment (Optional)</h3>
                <p className={`mt-1 text-xs leading-5 ${tertiaryTextClass}`}>Attach separate supporting evidence. This does not replace the customer proof or change the payment amount or status.</p>
              </div>

              {supportingDocuments.map((document) => (
                <div key={document._id || document.client_upload_id} className={`${previewCardClass} flex flex-wrap items-center justify-between gap-3`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={17} className="shrink-0 text-red-500" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-semibold ${strongTextClass}`} title={document.original_name}>{document.original_name}</p>
                      <p className={`mt-0.5 text-[11px] ${tertiaryTextClass}`}>
                        Added by {document.uploaded_by_name || "Administrator"} ({document.uploaded_by_role || "admin"}) · {formatDateTimeToMMDDYYYY(document.uploaded_at)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={paymentDocumentLoading}
                    onClick={() => viewAdminPaymentSupportingDocument(orderId, document.paymentRecordId, document)}
                    className="shrink-0 rounded-lg border border-slate-500/30 px-3 py-2 text-xs font-semibold text-sky-500 transition hover:bg-sky-500/10 disabled:cursor-wait disabled:opacity-60"
                  >
                    {paymentDocumentLoading ? "Loading..." : "View Proof"}
                  </button>
                </div>
              ))}

              <input
                ref={editPaymentProofInputRef}
                id="admin-supporting-payment-document"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                onChange={handleEditPaymentProofSelection}
                className="sr-only"
              />
              {editPaymentProofFile ? (
                <div className={`${previewCardClass} space-y-3`}>
                  {editPaymentProofFile.type === "application/pdf" ? (
                    <iframe src={editPaymentProofPreviewUrl} title={`Preview of ${editPaymentProofFile.name}`} className="h-48 w-full rounded-lg border border-slate-500/20 bg-white" />
                  ) : (
                    <img src={editPaymentProofPreviewUrl} alt={`Preview of ${editPaymentProofFile.name}`} className="max-h-48 w-full rounded-lg bg-white object-contain" />
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`min-w-0 flex-1 truncate text-xs font-semibold ${strongTextClass}`} title={editPaymentProofFile.name}>{editPaymentProofFile.name}</p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" disabled={paymentActionLoading} onClick={clearEditPaymentProofSelection} className={`${footerCancelClass} px-3 py-2 text-xs`}>Remove</button>
                      <button type="button" disabled={paymentActionLoading} onClick={() => editPaymentProofInputRef.current?.click()} className={`${footerCancelClass} px-3 py-2 text-xs`}>Replace file</button>
                      <button type="button" disabled={paymentActionLoading || !editPaymentOrder.payment_records?.length} onClick={handleSavePaymentSupportingDocument} className={`${footerSaveClass} px-3 py-2 text-xs`}>Save Document</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={paymentActionLoading}
                  onClick={() => editPaymentProofInputRef.current?.click()}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm font-semibold transition disabled:opacity-60 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700/60" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
                >
                  <Paperclip size={16} aria-hidden="true" />
                  Upload Image/File
                </button>
              )}
            </section>

            {(editPaymentOrder.payment_records || []).length > 0 && (
              <section className={`${panelClass} px-3 py-3`}>
                <h3 className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.16em] ${labelClass}`}>PAYMENT HISTORY</h3>
                <div className="space-y-2">
                  {[...editPaymentOrder.payment_records].sort((first, second) => new Date(second.payment_date || second.submitted_at || 0) - new Date(first.payment_date || first.submitted_at || 0)).map((record) => (
                    <div key={record._id || record.request_id} className={previewCardClass}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <strong className={strongTextClass}>{record.record_source === "admin_recorded" ? "Admin-Recorded Payment" : `Customer payment · ${record.status}`}</strong>
                        <span className={tertiaryTextClass}>{formatDateToMMMDDYYYY(record.payment_date || record.recorded_at || record.verified_at || record.submitted_at)}</span>
                      </div>
                      <p className={`mt-1 text-sm ${secondaryTextClass}`}>
                        {record.submitted_amount != null && <>Submitted <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(record.submitted_amount))}</span> · </>}
                        {record.verified_amount != null && <>Verified <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(record.verified_amount))}</span></>}
                        {record.payment_method ? ` · ${record.payment_method}` : ""}
                      </p>
                        {(record.discrepancies || []).map((discrepancy) => (
                          <div key={discrepancy._id} className={`mt-3 rounded-lg border p-3 ${darkMode ? "border-amber-500/40 bg-amber-500/10" : "border-amber-200 bg-amber-50"}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <strong className={darkMode ? "text-amber-200" : "text-amber-900"}>Payment discrepancy · {discrepancy.status.replaceAll("_", " ")}</strong>
                              <span className={`text-[11px] ${tertiaryTextClass}`}>{formatDateTimeToMMDDYYYY(discrepancy.detected_at)}</span>
                            </div>
                            <p className={`mt-1 text-xs ${secondaryTextClass}`}>
                              Customer reported <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(discrepancy.customer_reported_amount))}</span> · Admin recorded <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(discrepancy.admin_recorded_amount))}</span> · Difference <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(discrepancy.difference))}</span>
                            </p>
                            {discrepancy.reason && <p className={`mt-1 text-xs ${secondaryTextClass}`}>Admin reason: {discrepancy.reason}</p>}
                            {(discrepancy.status_history || []).map((entry, historyIndex) => (
                              <p key={`${entry.status}-${historyIndex}`} className={`mt-1 text-[11px] ${tertiaryTextClass}`}>
                                {entry.status.replaceAll("_", " ")} · {formatDateTimeToMMDDYYYY(entry.changed_at)}{entry.changed_by_name ? ` · ${entry.changed_by_name} (${entry.changed_by_role || "admin"})` : ""}{entry.note ? ` · ${entry.note}` : ""}
                              </p>
                            ))}
                            {discrepancy.status !== "resolved" ? (
                              <div className="mt-3 space-y-2">
                                <textarea
                                  value={discrepancyResolutionNotes[discrepancy._id] || ""}
                                  onChange={(event) => setDiscrepancyResolutionNotes((previous) => ({ ...previous, [discrepancy._id]: event.target.value }))}
                                  rows={2}
                                  maxLength={1000}
                                  placeholder="Review or resolution note"
                                  aria-label="Payment discrepancy review or resolution note"
                                  className={`${inputClass} resize-y text-sm`}
                                />
                                <div className="flex flex-wrap justify-end gap-2">
                                  {discrepancy.status === "pending_review" && (
                                    <button type="button" data-order-id={orderId} data-record-id={record._id} data-discrepancy-id={discrepancy._id} data-action="review_discrepancy" disabled={paymentActionLoading} onClick={handleUpdatePaymentDiscrepancyStatus} className={`${footerCancelClass} px-3 py-2 text-xs`}>
                                      Mark Under Review
                                    </button>
                                  )}
                                  <button type="button" data-order-id={orderId} data-record-id={record._id} data-discrepancy-id={discrepancy._id} data-action="resolve_discrepancy" disabled={paymentActionLoading} onClick={handleUpdatePaymentDiscrepancyStatus} className={`${footerSaveClass} px-3 py-2 text-xs`}>
                                    Resolve Discrepancy
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className={`mt-2 text-xs font-semibold ${secondaryTextClass}`}>Resolved {discrepancy.resolved_at ? `· ${formatDateTimeToMMDDYYYY(discrepancy.resolved_at)}` : ""}{discrepancy.resolved_by_name ? ` · ${discrepancy.resolved_by_name} (${discrepancy.resolved_by_role || "admin"})` : ""}{discrepancy.resolution_note ? ` · ${discrepancy.resolution_note}` : ""}</p>
                            )}
                          </div>
                        ))}
                      {record.admin_reason && <p className={`mt-1 text-xs ${tertiaryTextClass}`}>Admin note: {record.admin_reason}</p>}
                      {record.downpayment_exception?.status === "approved" && <p className="mt-1 text-xs font-bold text-amber-600">Downpayment Exception Approved · shortfall <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(record.downpayment_exception.shortfall) || 0)}</span> · {record.downpayment_exception.reason}</p>}
                      {record.proof_file_url && <button type="button" onClick={() => openPaymentDocumentPreview(record.proof_file_url, record.proof_file_name || "Payment proof")} className="mt-2 inline-flex text-xs font-semibold text-sky-600 underline">View payment proof{record.proof_file_name ? `: ${record.proof_file_name}` : ""}</button>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div>
              <label className={`mb-2 block text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>AMOUNT CONFIRMED (P)</label>
              <input
                id="edit-payment-amount-field"
                type="number"
                min="0"
                max={maxConfirmableAmount}
                step="0.01"
                value={editPaymentAmount}
                onChange={(e) => setEditPaymentAmount(e.target.value)}
                className={inputClass}
              />
              <div className={`mt-2 text-xs ${tertiaryTextClass}`}>
                Already paid: ₱{getPaymentSummary(editPaymentOrder).paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Downpayment to be Paid: ₱{getPaymentSummary(editPaymentOrder).requiredAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              {editPaymentOrder.payment_proof_submitted_at && !isPaymentProofConfirmed(editPaymentOrder) && (
                <div className={`mt-1 text-xs ${tertiaryTextClass}`}>
                  The submitted amount is prefilled. Adjust it only if the amount actually received differs.
                </div>
              )}
            </div>

            {adminRecordingPayment && (
              <>
                <div>
                  <label htmlFor="admin-payment-date" className={`mb-2 block text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>PAYMENT DATE</label>
                  <input
                    id="admin-payment-date"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={editPaymentDate}
                    onChange={(event) => setEditPaymentDate(event.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="admin-payment-note" className={`mb-2 block text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>ADMIN NOTE / REASON <span className={tertiaryTextClass}>(optional)</span></label>
                  <textarea
                    id="admin-payment-note"
                    value={editPaymentReason}
                    onChange={(event) => setEditPaymentReason(event.target.value)}
                    placeholder="Optional note about who received the payment or related details."
                    rows={3}
                    maxLength={1000}
                    className={`${inputClass} resize-y`}
                  />
                </div>
              </>
            )}

              {(pendingPaymentProof || adjustingVerifiedPayment) && (
              <div>
                <label htmlFor="payment-verification-reason" className={`mb-2 block text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>
                  Verification / rejection reason <span className={tertiaryTextClass}>(required only if the amount differs or proof is rejected)</span>
                </label>
                <textarea
                  id="payment-verification-reason"
                  value={editPaymentReason}
                  onChange={(event) => setEditPaymentReason(event.target.value)}
                  placeholder="Add a reason only if the verified amount differs from the submitted amount or you reject the proof."
                  rows={3}
                  className={`${inputClass} resize-y`}
                />
              </div>
            )}

            <div>
              <div className={`mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>PAYMENT METHOD</div>
              <div className={optionWrapClass}>
                <button
                  type="button"
                  onClick={() => setEditPaymentMethod("Cash")}
                  className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${editPaymentMethod === "Cash" ? cashSelectedClass : optionBaseClass}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full ${editPaymentMethod === "Cash" ? (darkMode ? "bg-emerald-400/20 text-emerald-300" : "bg-emerald-100 text-emerald-700") : darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <path d="M3 8.5h12.5a3 3 0 0 1 0 6H3V8.5zm0 0V6.5a2 2 0 0 1 2-2h12.5" />
                      <path d="M18 9.5h3v5h-3" />
                    </svg>
                  </span>
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => setEditPaymentMethod("Online")}
                  className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${editPaymentMethod === "Online" ? onlineSelectedClass : optionBaseClass}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full ${editPaymentMethod === "Online" ? (darkMode ? "bg-red-400/20 text-red-300" : "bg-red-100 text-red-700") : darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <rect x="2.5" y="5" width="15" height="14" rx="2.5" />
                      <path d="M8 19h9.5a2.5 2.5 0 0 0 2.5-2.5V9.5" />
                      <path d="M14 12h5" />
                    </svg>
                  </span>
                  Online
                </button>
              </div>
            </div>

            {editPaymentMethod === "Online" && (
              <div>
                <div className={`mb-2 flex items-center justify-between gap-2 text-[11px] font-extrabold uppercase tracking-[0.18em] ${labelClass}`}>
                  <span>TRANSACTION NUMBER</span>
                  <span className={darkMode ? "text-slate-500" : "text-slate-400"}>{adminRecordingPayment && !editPaymentProofFile ? "Required unless proof is uploaded" : "Optional"}</span>
                </div>
                <input
                  type="text"
                  value={editPaymentTransactionNumber}
                  onChange={(e) => setEditPaymentTransactionNumber(e.target.value)}
                  placeholder="e.g. TXN-20240101-0001"
                  className={inputClass}
                />
              </div>
            )}

            <div className={panelClass + " px-3 py-2"}>
              {(() => {
                const paymentSummary = getPaymentSummary(editPaymentOrder);
                const preview = getPaymentSummary({
                  ...editPaymentOrder,
                  amount_paid: paymentSummary.paidAmount
                    - (adjustingVerifiedPayment ? Number(selectedVerifiedRecord?.verified_amount) || 0 : 0)
                    + (Number(editPaymentAmount) || 0),
                });
                return (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className={darkMode ? "font-medium text-slate-300" : "font-medium text-slate-600"}>Payment Status Preview</span>
                <span className={`${statusBadgeBaseClassName} ${getPaymentStatusBadgeClassName(preview.status.key, darkMode)}`}>{getAdminPaymentStatusLabel(preview.status)}</span>
              </div>
                );
              })()}
            </div>

            <div className={panelClass + " px-3 py-3"}>
              <div className="flex items-center justify-between gap-3">
                <span className={darkMode ? "text-sm text-slate-300" : "text-sm text-slate-600"}>Remaining Balance After This Payment</span>
                <span className={darkMode ? "text-sm font-bold text-red-400" : "text-sm font-bold text-red-600"}>
                  ₱{Math.max(getPaymentSummary(editPaymentOrder).remainingAmount + (adjustingVerifiedPayment ? Number(selectedVerifiedRecord?.verified_amount) || 0 : 0) - (Number(editPaymentAmount || 0)), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          <details className={`order-1 mx-3 my-2 rounded-xl border p-3 lg:hidden ${darkMode ? "border-slate-700 bg-[#132238]" : "border-slate-200 bg-slate-50"}`}>
            <summary className="group flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold marker:hidden">
              <span className={strongTextClass}>Payment Summary</span>
              <span className="flex shrink-0 items-center gap-2 text-red-500"><span><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentSummary.totalAmount)}</span></span><ChevronDown size={16} className="text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" /></span>
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-slate-500/20 pt-3 text-xs sm:grid-cols-3">
              <div className="min-w-0"><span className={tertiaryTextClass}>ORDER TRACKING ID</span><p className={`mt-1 break-all font-bold ${strongTextClass}`}>{editPaymentOrder.tracking || editPaymentOrder._id}</p></div>
              <div><span className={tertiaryTextClass}>TOTAL PROJECT COST</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentSummary.totalAmount)}</span></p></div>
              <div><span className={tertiaryTextClass}>{editPaymentOrder.payment_terms === "full_payment" ? "REQUIRED FULL PAYMENT" : "REQUIRED DOWNPAYMENT"}</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentSummary.requiredAmount)}</span></p><p className={`mt-1 text-[10px] ${tertiaryTextClass}`}>Site Inspection terms: {getSavedPaymentTermsLabel(editPaymentOrder.payment_terms)}</p></div>
              <div><span className={tertiaryTextClass}>AMOUNT ALREADY PAID</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentSummary.paidAmount)}</span></p></div>
              <div><span className={tertiaryTextClass}>DOWNPAYMENT REMAINING</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Math.max(paymentSummary.requiredAmount - paymentSummary.paidAmount, 0))}</span></p></div>
              <div><span className={tertiaryTextClass}>REMAINING PROJECT BALANCE</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentSummary.remainingAmount)}</span></p></div>
            </div>
          </details>

          <aside className={`order-2 hidden border-b p-3 sm:p-4 lg:order-2 lg:block lg:overflow-y-auto lg:border-b-0 lg:border-l ${darkMode ? "border-slate-700 bg-[#132238]" : "border-slate-200 bg-slate-50"}`} aria-label="Payment summary">
            <h3 className={`mb-3 text-xs font-extrabold uppercase tracking-[0.16em] ${tertiaryTextClass}`}>Payment Summary</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3 lg:grid-cols-1">
              <div className="min-w-0"><span className={tertiaryTextClass}>ORDER TRACKING ID</span><p className={`mt-1 break-all font-bold ${strongTextClass}`}>{editPaymentOrder.tracking || editPaymentOrder._id}</p></div>
              <div><span className={tertiaryTextClass}>TOTAL PROJECT COST</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentSummary.totalAmount)}</span></p></div>
              <div><span className={tertiaryTextClass}>{editPaymentOrder.payment_terms === "full_payment" ? "REQUIRED FULL PAYMENT" : "REQUIRED DOWNPAYMENT"}</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentSummary.requiredAmount)}</span></p><p className={`mt-1 text-[10px] ${tertiaryTextClass}`}>Site Inspection terms: {getSavedPaymentTermsLabel(editPaymentOrder.payment_terms)}</p></div>
              <div><span className={tertiaryTextClass}>AMOUNT ALREADY PAID</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentSummary.paidAmount)}</span></p></div>
              <div><span className={tertiaryTextClass}>DOWNPAYMENT REMAINING</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Math.max(paymentSummary.requiredAmount - paymentSummary.paidAmount, 0))}</span></p></div>
              <div><span className={tertiaryTextClass}>REMAINING PROJECT BALANCE</span><p className={`mt-1 font-bold ${strongTextClass}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentSummary.remainingAmount)}</span></p></div>
            </div>
          </aside>
          </div>

          <div className={`${footerClass} shrink-0`}>
            <button type="button" disabled={paymentActionLoading} onClick={closeEditPaymentModal} className={`${footerCancelClass} min-w-0 text-center leading-tight`}>Cancel</button>
            {pendingPaymentProof && (
              <button type="button" disabled={paymentActionLoading} onClick={handleRejectPaymentProof} className={`${footerCancelClass} min-w-0 text-center leading-tight`}>Reject Proof</button>
            )}
            <button type="button" disabled={paymentActionLoading} onClick={handleSavePaymentEdit} className={`${footerSaveClass} min-w-0 text-center leading-tight ${pendingPaymentProof ? "col-span-2 min-[560px]:col-span-1" : ""}`}>{paymentActionLoading ? "Saving..." : "Save Changes"}</button>
          </div>
        </div>
      </div>
    );
  })() : null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />

      <div className="flex-1 min-h-0 flex flex-col">
        <Navbar />

        <main className="flex-1 min-h-0 overflow-y-auto p-6 !pb-[calc(10rem+env(safe-area-inset-bottom))] sm:!pb-[calc(10rem+env(safe-area-inset-bottom))] lg:!pb-24">

          <AdminPageHeader
            title="Transactions"
            description="Manage receipts, contracts and completed projects."
            compactStats
            statsClassName="grid-cols-1 min-[430px]:grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5"
            stats={[
              ...summaryMetrics,
            ]}
          />

          <div className="mt-6 md:hidden">
            <CustomerDropdown darkMode={darkMode}
              aria-label="Transaction category"
              value={activeTable}
              onChange={(event) => setActiveTable(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
            >
              {transactionTabs.map((tab) => (
                <option key={tab.key} value={tab.key}>{tab.label} ({tab.count})</option>
              ))}
            </CustomerDropdown>
          </div>

          <div className={`mt-6 hidden max-w-full flex-wrap gap-1.5 rounded-2xl border p-1.5 md:flex ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-100"}`} role="tablist" aria-label="Filter transactions">
            {transactionTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTable === tab.key}
                onClick={() => setActiveTable(tab.key)}
                className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${activeTable === tab.key ? (darkMode ? "border-red-700 bg-red-950/60 text-red-100 shadow-sm shadow-black/10" : "border-red-200 bg-red-50 text-red-950 shadow-sm") : (darkMode ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900")}`}
              >
                {tab.label}
                <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${activeTable === tab.key ? (darkMode ? "bg-red-800 text-red-50" : "bg-red-200 text-red-900") : (darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-700")}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="text"
              placeholder={activeTable === "feedback" ? "Search customer, product, tracking, review..." : "Search tracking, customer, project..."}
              value={tableSearch}
              onChange={(e) => {
                setTableSearch(e.target.value);
                if (activeTable === "feedback") setFeedbackPage(1);
                if (activeTable === "in_progress") setInProgressPage(1);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 sm:max-w-sm ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500" : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"}`}
            />
            <div className="flex flex-wrap items-center gap-3">
              {canManageFeedbackVisibility && activeTable === "feedback" && selectedFeedbackOrders.length > 0 && (
                <button
                  type="button"
                  onClick={handleHideSelectedFeedback}
                  disabled={feedbackVisibilityUpdating}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-wait disabled:opacity-60"
                >
                  <EyeClosed size={16} aria-hidden="true" />
                  {feedbackVisibilityUpdating ? "Hiding reviews..." : `Hide selected (${selectedFeedbackOrders.length})`}
                </button>
              )}
              {canGenerateTransactionReport && (
                <button
                  type="button"
                  onClick={() => setShowGenerateReportModal(true)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-red-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                >
                  <FileDown size={17} aria-hidden="true" />
                  Generate Report
                </button>
              )}
            </div>
          </div>

          <div className={`mt-6 overflow-hidden rounded-3xl border shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className={darkMode ? "bg-slate-800/80" : "bg-slate-50"}>
                    {activeTable === "feedback" ? (
                      <tr>
                        <th className="p-4 text-left"><div className="flex items-center gap-2">{canManageFeedbackVisibility && <input type="checkbox" aria-label="Select all visible reviews" checked={allVisibleFeedbackSelected} disabled={selectableFeedbackOrders.length === 0} onChange={(event) => toggleAllVisibleFeedback(event.target.checked)} className="h-4 w-4 accent-red-700" />}<span>Customer</span></div></th>
                        <th className="p-4 text-left">Product / Order</th>
                        <th className="p-4 text-left">Rating</th>
                        <th className="p-4 text-left">Photos</th>
                        <th className="p-4 text-left">Submitted</th>
                        <th
                          className={`${showTransactionActions ? "p-4" : "px-1 py-4"} text-center transition-[width,padding] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none`}
                          style={{ width: showTransactionActions ? "160px" : "56px" }}
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${showTransactionActions ? "max-w-16 translate-x-0 opacity-100" : "max-w-0 -translate-x-1 opacity-0"}`}>Actions</span>
                            <button
                              type="button"
                              onClick={() => setShowTransactionActions((visible) => !visible)}
                              className={`inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border shadow-[0_2px_8px_rgba(15,23,42,0.18)] ring-1 ring-black/5 transition-[transform,background-color,border-color,box-shadow,color] duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 motion-reduce:transition-none ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 ring-white/10 hover:border-red-800 hover:bg-slate-700 hover:text-red-300" : "border-slate-200 bg-white text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"}`}
                              title={showTransactionActions ? "Hide all actions" : "Show all actions"}
                              aria-label={showTransactionActions ? "Hide all action buttons" : "Show all action buttons"}
                              aria-expanded={showTransactionActions}
                            >
                              <ChevronLeft className={`transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${showTransactionActions ? "rotate-0" : "rotate-180"}`} size={18} aria-hidden="true" />
                            </button>
                          </div>
                        </th>
                      </tr>
                    ) : activeTable === "cancelled" ? (
                      <tr className={`border-b ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                        <th className={`px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Customer Name</th>
                        <th className={`px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Product / Project Description</th>
                        <th className={`px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Original Project Date</th>
                        <th className={`px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Cancellation Date</th>
                        <th className={`px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Previous Project Status</th>
                        <th className={`px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Cancelled By</th>
                        <th className={`px-4 py-3 text-center text-[10px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Actions</th>
                      </tr>
                    ) : (
                      <tr>
                        <th className="p-4 text-left">Client</th>
                        <th className="p-4 text-left">Product / Project</th>
                        <th className="p-4 text-left">Est. Profit (33.33%)</th>
                        <th className="p-4 text-left">Paid / Total</th>
                        <th className="p-4 text-left">Method</th>
                        <th className="p-4 text-left">Customer Type</th>
                        <th className="p-4 text-left">Project Progress</th>
                        {activeTable === "receipts" && <th className="p-4 text-left">Warranty Status</th>}
                        <th className="p-4 text-left">Status</th>
                        <th
                          className={`${showTransactionActions ? "p-4" : "px-1 py-4"} text-center transition-[width,padding] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none`}
                          style={{ width: showTransactionActions ? ("190px") : "56px" }}
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${showTransactionActions ? "max-w-16 translate-x-0 opacity-100" : "max-w-0 -translate-x-1 opacity-0"}`}>Actions</span>
                            <button
                              type="button"
                              onClick={() => setShowTransactionActions((visible) => !visible)}
                              className={`inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border shadow-[0_2px_8px_rgba(15,23,42,0.18)] ring-1 ring-black/5 transition-[transform,background-color,border-color,box-shadow,color] duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 motion-reduce:transition-none ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 ring-white/10 hover:border-red-800 hover:bg-slate-700 hover:text-red-300" : "border-slate-200 bg-white text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"}`}
                              title={showTransactionActions ? "Hide all actions" : "Show all actions"}
                              aria-label={showTransactionActions ? "Hide all action buttons" : "Show all action buttons"}
                              aria-expanded={showTransactionActions}
                            >
                              <ChevronLeft className={`transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${showTransactionActions ? "rotate-0" : "rotate-180"}`} size={18} aria-hidden="true" />
                            </button>
                          </div>
                        </th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {currentData.map((order, index) => {
                      const customerName = order.customer_name || (order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : "N/A");
                      const productLabel = Array.isArray(order.items) && order.items.length > 0
                        ? (order.items.length > 1 ? "Batch Order" : (order.items[0].name || order.items[0].product_name || "Project"))
                        : "N/A";
                      const paymentSummary = getPaymentSummary(order);
                      const amountVal = paymentSummary.totalAmount;
                      const paidAmount = paymentSummary.paidAmount;
                      const paymentProgress = amountVal > 0 ? Math.min(Math.max((paidAmount / amountVal) * 100, 0), 100) : 0;
                      const amount = hidePaymentAmounts ? "••••••" : `₱${Number(amountVal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                      const inspectionLabel = productLabel;
                      const orderType = order.order_type === "walk_in_customer" ? "Walk-in" : "Website";
                      const paymentMethod = order.payment_method || (order.acceptance_method === "online" ? "Online" : "Cash");
                      const projectCategory = isCompletedProject(order) ? "Completed" : "In Progress";
                      const statusLabel = getAdminPaymentStatusLabel(paymentSummary.status);
                      const isFullyPaid = paymentSummary.status.key === "paid";
                      const showNeedsConfirmation = (order.payment_records || []).length > 0
                        ? getUnresolvedPaymentProofRecords(order).length > 0
                        : Boolean(order.payment_proof_submitted_at && !isPaymentProofConfirmed(order));
                      const canGenerateProjectReceipt = isFullyPaid && !showNeedsConfirmation;
                      const warrantyStatus = getWarrantyStatus(order);
                      const warrantyStatusLabel = warrantyStatus === "Pending installation" ? "Pending" : warrantyStatus;

                      if (activeTable === "cancelled") {
                        const cancellationDate = order.cancellation_date || order.updatedAt;
                        return (
                          <tr key={order._id || order.id || index} className={`border-t transition-colors ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800/60" : "border-slate-100 text-slate-700 hover:bg-slate-50"}`}>
                            <td className={`px-4 py-4 text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{customerName}</td>
                            <td className={`px-4 py-4 text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{productLabel}</td>
                            <td className={`whitespace-nowrap px-4 py-4 text-sm tabular-nums ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{formatCancelledDate(order.createdAt)}</td>
                            <td className={`whitespace-nowrap px-4 py-4 text-sm font-medium tabular-nums ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{formatCancelledDate(cancellationDate)}</td>
                            <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200" : "border-slate-200 bg-slate-100 text-slate-700"}`}>{formatCancelledStatus(order.cancellation_previous_status)}</span></td>
                            <td className={`px-4 py-4 text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{formatCancelledStatus(order.cancelled_by_name)}</td>
                            <td className="px-4 py-4 text-center">
                              <button type="button" title="View Transaction" aria-label={`View cancelled project ${order.tracking || "details"}`} onClick={() => openContractModal(order)} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${darkMode ? "bg-blue-500/15 text-blue-300" : "bg-blue-100 text-blue-600"}`}>
                                <Eye size={18} aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr
                          key={activeTable === "feedback" ? `${order._id || order.id || index}-${Number.isInteger(order.reviewItemIndex) ? `item-${order.reviewItemIndex}` : "order-review"}` : order._id || index}
                          data-notification-record-id={order._id || order.id ? String(order._id || order.id) : undefined}
                          data-notification-target="payment"
                          className={`border-t transition-colors ${highlightedNotificationRecordId === String(order._id || order.id || "") ? "notification-target-highlight" : "hover:bg-gray-50"}`}
                        >
                          {activeTable === "feedback" ? (
                            <>
                              <td className="p-4"><div className="flex items-center gap-3">{canManageFeedbackVisibility && <input type="checkbox" aria-label={`Select review from ${customerName}`} checked={selectedFeedbackKeys.has(feedbackSelectionKey(order))} disabled={order.review?.hiddenFromCustomers === true} onChange={(event) => toggleFeedbackSelection(order, event.target.checked)} className="h-4 w-4 shrink-0 accent-red-700" />}{renderClientCell(order, customerName)}</div></td>
                              <td className="p-4">
                                <div className="space-y-1">
                                  <div className="font-semibold text-slate-900">{order.reviewProductName || "Order feedback"}</div>
                                  <div className="text-xs text-slate-500">{Number.isInteger(order.reviewItemIndex) ? "Product review" : "Order review"}</div>
                                  <div className="text-xs text-slate-500">Order ID: {order.tracking || order._id || order.id || "—"}</div>
                                </div>
                              </td>
                              <td className="p-4">
                                <div className="flex items-center gap-1" aria-label={`${Number(order.review?.rating || 0)} out of 5 stars`}>
                                  {Array.from({ length: 5 }, (_, starIndex) => (
                                    <Star key={starIndex} size={15} className={starIndex < Number(order.review?.rating || 0) ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
                                  ))}
                                  <span className="ml-1 text-sm font-semibold text-slate-700">{Number(order.review?.rating || 0)}/5</span>
                                </div>
                              </td>
                              <td className="p-4">
                                <div className="flex flex-wrap gap-2">
                                  {(order.review?.photos || []).map((photo, photoIndex) => (
                                    <button key={`${photo}-${photoIndex}`} type="button" onClick={() => openPaymentDocumentPreview(photo, `Review photo ${photoIndex + 1}`)} aria-label={`Open review photo ${photoIndex + 1}`}>
                                      <img src={photo} alt={`Review attachment ${photoIndex + 1}`} className="h-12 w-12 rounded-md border border-slate-200 object-cover" /></button>
                                  ))}
                                  {!(order.review?.photos || []).length && <span className="text-sm text-slate-400">None</span>}
                                </div>
                              </td>
                              <td className="whitespace-nowrap p-4 text-sm text-slate-600">
                                {order.review?.submittedAt ? formatDateToMMMDDYYYY(order.review.submittedAt) : "—"}
                              </td>
                              <td
                                className={`${showTransactionActions ? "p-4" : "px-1 py-4"} text-center transition-[width,padding] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none`}
                                style={{ width: showTransactionActions ? "204px" : "56px" }}
                              >
                                <div className={`mx-auto flex flex-nowrap justify-center gap-2 overflow-hidden transition-[width,opacity,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${showTransactionActions ? "translate-x-0 opacity-100" : "translate-x-2 opacity-0 pointer-events-none"}`} style={{ width: showTransactionActions ? "168px" : "0px" }}>
                                  <button type="button" onClick={() => setFeedbackPreviewOrder(order)} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${darkMode ? "bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`} aria-label={`View feedback for ${order.reviewProductName || "order"} from ${customerName}`} title="View feedback">
                                    <Eye size={20} strokeWidth={2.6} aria-hidden="true" />
                                  </button>
                                  {canManageFeedbackVisibility && <button type="button" onClick={() => openFeedbackReply(order)} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${darkMode ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`} aria-label={`${order.review?.adminResponse ? "Edit" : "Reply to"} feedback for ${order.reviewProductName || "order"} from ${customerName}`} title={order.review?.adminResponse ? "Edit Admin Response" : "Reply to Feedback"}>
                                    <MessageSquare size={17} aria-hidden="true" />
                                  </button>}
                                  {canManageFeedbackVisibility && <button type="button" disabled={feedbackVisibilityUpdating} onClick={() => handleToggleFeedbackVisibility(order)} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50 ${darkMode ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`} aria-label={`${order.review?.hiddenFromCustomers === true ? "Show" : "Hide"} review from customers`} title={order.review?.hiddenFromCustomers === true ? "Show review to customers" : "Hide review from customers"}>
                                    {order.review?.hiddenFromCustomers === true ? <Eye size={17} aria-hidden="true" /> : <EyeClosed size={17} aria-hidden="true" />}
                                  </button>}
                                  <button type="button" onClick={() => setFeedbackDeleteOrder(order)} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "bg-red-100 text-red-600 hover:bg-red-200"}`} aria-label={`Delete feedback for ${order.reviewProductName || "order"} from ${customerName}`} title="Delete Customer Feedback">
                                    <Trash2 size={17} aria-hidden="true" />
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-4"><div className="max-w-[180px]"><p className="truncate text-sm font-semibold text-slate-800">{customerName}</p><p className="mt-1 truncate text-xs text-slate-500">{order.customer?.email || order.customer_email || ""}</p></div></td>
                              <td className="p-4"><div className="font-semibold text-slate-900">{inspectionLabel}</div></td>
                              <td className="p-4 font-bold text-slate-900"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency((Number(amountVal) || 0) * 0.3333)}</span></td>
                              <td className="p-4">
                                <div className="font-bold text-emerald-600">{hidePaymentAmounts ? "••••••" : `₱${paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
                                <div className="text-xs text-slate-500">of {amount}</div>
                                {!hidePaymentAmounts && <div className="mt-2 flex items-center gap-2">
                                  <div role="progressbar" aria-label="Payment progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(paymentProgress)} className={`h-1.5 min-w-16 flex-1 overflow-hidden rounded-full ${darkMode ? "bg-slate-700" : "bg-slate-200"}`}>
                                    <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${paymentProgress}%` }} />
                                  </div>
                                  <span className="shrink-0 text-[10px] font-semibold text-slate-500">{Math.round(paymentProgress)}%</span>
                                </div>}
                              </td>
                              <td className="p-4"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${paymentMethod === "Online" ? (darkMode ? "border border-rose-400/40 bg-rose-500/15 text-rose-300" : "bg-rose-50 text-rose-700") : (darkMode ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700")}`}>{paymentMethod}</span></td>
                              <td className="p-4"><span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">{orderType}</span></td>
                              <td className="p-4"><span className={`inline-flex rounded-md px-3 py-1 text-xs font-semibold ${projectCategory === "Completed" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-violet-50 text-violet-700"}`}>{projectCategory}</span></td>
                              {activeTable === "receipts" && <td className="p-4"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getWarrantyStatusClass(warrantyStatus)}`}>{warrantyStatusLabel}</span></td>}
                              <td className="p-4"><div className="flex flex-col items-start gap-1.5"><span className={`${statusBadgeBaseClassName} !max-w-none !whitespace-nowrap !break-normal ${getPaymentStatusBadgeClassName(isFullyPaid ? "paid" : paymentSummary.status.key, darkMode)}`}>{paymentSummary.status.key === "partial" ? "Partial" : statusLabel}</span>{showNeedsConfirmation && (<span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${darkMode ? "border border-rose-400/40 bg-rose-500/15 text-rose-300" : "bg-rose-100 text-rose-700"}`}>Unverified</span>)}</div></td>
                              <td
                                className={`${showTransactionActions ? "p-4" : "px-1 py-4"} text-right transition-[width,padding] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none`}
                                style={{ width: showTransactionActions ? `${190 + ((canGenerateProjectReceipt || order.project_payment_receipts?.length > 0) ? 36 : 0) + (canCancelTransactions ? 36 : 0)}px` : "56px" }}
                              ><div className={`ml-auto flex flex-nowrap justify-end gap-2 overflow-hidden transition-[width,opacity,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${showTransactionActions ? "translate-x-0 opacity-100" : "translate-x-2 opacity-0 pointer-events-none"}`} style={{ width: showTransactionActions ? `${128 + ((canGenerateProjectReceipt || order.project_payment_receipts?.length > 0) ? 36 : 0) + (canCancelTransactions ? 36 : 0)}px` : "0px" }}><button title="View Transaction" onClick={() => openContractModal(order)} className="shrink-0 p-2 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition"><Eye size={20} strokeWidth={2.6} /></button>{isFullyPaid ? (<button type="button" title="Fully paid" aria-label="Fully paid. Payment editing is locked." disabled className={`shrink-0 cursor-not-allowed rounded-lg p-2 ${darkMode ? "bg-slate-700 text-slate-400" : "bg-slate-100 text-slate-500"}`}><Lock size={18} aria-hidden="true" /></button>) : (<button type="button" title="Add Payment" aria-label="Add Payment" onClick={() => openEditPaymentModal(order)} className="shrink-0 p-2 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 transition"><Pencil size={18} /></button>)}<button type="button" title="View Contract" aria-label="View Contract" onClick={() => openReadOnlyContract(order)} className="shrink-0 p-2 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition"><FileText size={18} /></button>{(canGenerateProjectReceipt || order.project_payment_receipts?.length > 0) && <button type="button" title={canGenerateProjectReceipt ? "Generate or view project payment receipt" : "View project payment receipt"} aria-label={`View project payment receipt for ${order.tracking || "project"}`} onClick={() => (canGenerateProjectReceipt ? void openProjectPaymentReceipt(order) : openSavedProjectPaymentReceipt(order))} className="shrink-0 rounded-lg bg-emerald-100 p-2 text-emerald-700 transition hover:bg-emerald-200"><Receipt size={18} aria-hidden="true" /></button>}{isEligibleForAdminCancellation(order) && <button type="button" title="Cancel Transaction" aria-label={`Cancel project ${order.tracking || "transaction"}`} onClick={() => { setCancelTransactionOrder(order); setCancellationReason(""); }} className={`shrink-0 rounded-lg p-2 ${darkMode ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "bg-red-100 text-red-700 hover:bg-red-200"}`}><Ban size={18} aria-hidden="true" /></button>}</div></td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 p-3 md:hidden">
              {currentData.map((order, index) => {
                const customerName = order.customer_name || (order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : "N/A");
                if (activeTable === "feedback") {
                  const feedbackRowKey = `${order._id || order.id || index}-${Number.isInteger(order.reviewItemIndex) ? `item-${order.reviewItemIndex}` : "order-review"}`;
                  return (
                    <article key={feedbackRowKey} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {canManageFeedbackVisibility && <label className="mb-2 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" aria-label={`Select review from ${customerName}`} checked={selectedFeedbackKeys.has(feedbackSelectionKey(order))} disabled={order.review?.hiddenFromCustomers === true} onChange={(event) => toggleFeedbackSelection(order, event.target.checked)} className="h-4 w-4 accent-red-700" />Select review</label>}
                          <p className="truncate text-sm font-semibold">{order.reviewProductName || "Order feedback"}</p>
                          <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{customerName} · {order.tracking || order._id || order.id || "—"}</p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-slate-500">{order.review?.submittedAt ? formatDateToMMMDDYYYY(order.review.submittedAt) : "—"}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1" aria-label={`${Number(order.review?.rating || 0)} out of 5 stars`}>
                          {Array.from({ length: 5 }, (_, starIndex) => (
                            <Star key={starIndex} size={14} className={starIndex < Number(order.review?.rating || 0) ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
                          ))}
                          <span className="ml-1 text-xs font-semibold">{Number(order.review?.rating || 0)}/5</span>
                        </div>
                        {order.review?.hiddenFromCustomers === true && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">Hidden from customers</span>}
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setFeedbackPreviewOrder(order)} aria-label={`View feedback for ${order.reviewProductName || "order"}`} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${darkMode ? "bg-blue-500/15 text-blue-300" : "bg-blue-100 text-blue-600"}`}>
                            <Eye size={20} strokeWidth={2.6} aria-hidden="true" />
                          </button>
                          {canManageFeedbackVisibility && <button type="button" onClick={() => openFeedbackReply(order)} aria-label={`${order.review?.adminResponse ? "Edit" : "Reply to"} feedback for ${order.reviewProductName || "order"}`} title={order.review?.adminResponse ? "Edit Admin Response" : "Reply to Feedback"} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${darkMode ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-700"}`}>
                            <MessageSquare size={17} aria-hidden="true" />
                          </button>}
                          {canManageFeedbackVisibility && <button type="button" disabled={feedbackVisibilityUpdating} onClick={() => handleToggleFeedbackVisibility(order)} aria-label={`${order.review?.hiddenFromCustomers === true ? "Show" : "Hide"} review from customers`} title={order.review?.hiddenFromCustomers === true ? "Show review to customers" : "Hide review from customers"} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg disabled:opacity-50 ${darkMode ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-700"}`}>
                            {order.review?.hiddenFromCustomers === true ? <Eye size={17} aria-hidden="true" /> : <EyeClosed size={17} aria-hidden="true" />}
                          </button>}
                          <button type="button" onClick={() => setFeedbackDeleteOrder(order)} aria-label={`Delete feedback for ${order.reviewProductName || "order"}`} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-100 text-red-600"}`}>
                            <Trash2 size={17} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      {order.review?.comment && <p className={`mt-2 line-clamp-2 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{order.review.comment}</p>}
                    </article>
                  );
                }
                if (activeTable === "cancelled") {
                  const productLabel = Array.isArray(order.items) && order.items.length > 0 ? (order.items.length > 1 ? "Batch Order" : (order.items[0].name || order.items[0].product_name || "Project")) : "N/A";
                  return (
                    <article key={order._id || order.id || index} className={`rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">{productLabel}</p>
                          <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{customerName}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${darkMode ? "border-rose-400/30 bg-rose-500/15 text-rose-300" : "border-rose-200 bg-rose-50 text-rose-700"}`}>Cancelled</span>
                      </div>
                      <dl className={`mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                        <div><dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Original Project Date</dt><dd className="mt-1 font-medium tabular-nums">{formatCancelledDate(order.createdAt)}</dd></div>
                        <div><dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Cancellation Date</dt><dd className="mt-1 font-medium tabular-nums">{formatCancelledDate(order.cancellation_date)}</dd></div>
                        <div><dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Previous Project Status</dt><dd className="mt-1 font-semibold">{formatCancelledStatus(order.cancellation_previous_status)}</dd></div>
                        <div><dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Cancelled By</dt><dd className="mt-1 font-medium">{formatCancelledStatus(order.cancelled_by_name)}</dd></div>
                      </dl>
                      <div className="mt-3 flex justify-end">
                        <button type="button" title="View Transaction" aria-label={`View cancelled project ${order.tracking || "details"}`} onClick={() => openContractModal(order)} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${darkMode ? "bg-blue-500/15 text-blue-300" : "bg-blue-100 text-blue-600"}`}><Eye size={18} aria-hidden="true" /></button>
                      </div>
                    </article>
                  );
                }
                const productLabel = Array.isArray(order.items) && order.items.length > 0 ? (order.items.length > 1 ? "Batch Order" : (order.items[0].name || order.items[0].product_name || "Project")) : "N/A";
                const paymentSummary = getPaymentSummary(order);
                const amountVal = paymentSummary.totalAmount;
                const paymentMethod = order.payment_method || (order.acceptance_method === "online" ? "Online" : "Cash");
                const isFullyPaid = paymentSummary.status.key === "paid";
                const hasUnverifiedPayment = (order.payment_records || []).length > 0
                  ? getUnresolvedPaymentProofRecords(order).length > 0
                  : Boolean(order.payment_proof_submitted_at && !isPaymentProofConfirmed(order));
                const canGenerateProjectReceipt = isFullyPaid && !hasUnverifiedPayment;
                return (
                  <div
                    key={order._id || index}
                    data-notification-record-id={order._id || order.id ? String(order._id || order.id) : undefined}
                    data-notification-target="payment"
                    className={`rounded-2xl border p-3 transition-colors ${highlightedNotificationRecordId === String(order._id || order.id || "") ? "notification-target-highlight" : "border-gray-200 bg-gray-50"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{productLabel}</p>
                        <p className="mt-1 text-xs text-slate-500">{customerName}</p>
                      </div>
                      <span className={`${statusBadgeBaseClassName} !max-w-none shrink-0 !whitespace-nowrap !break-normal text-[10px] ${getPaymentStatusBadgeClassName(isFullyPaid ? "paid" : paymentSummary.status.key, darkMode)}`}>
                        {isFullyPaid ? "Fully Paid" : getAdminPaymentStatusLabel(paymentSummary.status)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Method</p>
                        <p className="mt-1 font-medium text-slate-700">{paymentMethod}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Est. Profit (33.33%)</p>
                        <p className="mt-1 font-semibold text-slate-900"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency((Number(amountVal) || 0) * 0.3333)}</span></p>
                      </div>
                    </div>
                    {activeTable === "receipts" && (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3 text-xs">
                        <span className="text-slate-500">Warranty Status</span>
                        <span className={`inline-flex rounded-full px-2.5 py-1 font-semibold ${getWarrantyStatusClass(getWarrantyStatus(order))}`}>
                          {getWarrantyStatus(order) === "Pending installation" ? "Pending" : getWarrantyStatus(order)}
                        </span>
                      </div>
                    )}
                    <div className="mt-3 flex justify-end gap-2">
                      <button title="View Transaction" onClick={() => openContractModal(order)} className="p-2 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition"><Eye size={20} strokeWidth={2.6} /></button>
                      {isFullyPaid ? (
                        <button type="button" title="Fully paid" aria-label="Fully paid. Payment editing is locked." disabled className="cursor-not-allowed rounded-lg bg-slate-100 p-2 text-slate-500">
                          <Lock size={18} aria-hidden="true" />
                        </button>
                      ) : (
                        <button type="button" title="Add Payment" aria-label="Add Payment" onClick={() => openEditPaymentModal(order)} className="p-2 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 transition"><Pencil size={18} /></button>
                      )}
                      <button type="button" title="View Contract" aria-label="View Contract" onClick={() => openReadOnlyContract(order)} className="p-2 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition"><FileText size={18} /></button>
                      {(canGenerateProjectReceipt || order.project_payment_receipts?.length > 0) && <button type="button" title={canGenerateProjectReceipt ? "Generate or view project payment receipt" : "View project payment receipt"} aria-label={`View project payment receipt for ${order.tracking || "project"}`} onClick={() => (canGenerateProjectReceipt ? void openProjectPaymentReceipt(order) : openSavedProjectPaymentReceipt(order))} className="shrink-0 rounded-lg bg-emerald-100 p-2 text-emerald-700 transition hover:bg-emerald-200"><Receipt size={18} aria-hidden="true" /></button>}{isEligibleForAdminCancellation(order) && <button type="button" title="Cancel Transaction" aria-label={`Cancel project ${order.tracking || "transaction"}`} onClick={() => { setCancelTransactionOrder(order); setCancellationReason(""); }} className={`rounded-lg p-2 ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-100 text-red-700"}`}><Ban size={18} aria-hidden="true" /></button>}

                    </div>
                  </div>
                );
              })}
            </div>

            {activeTable === "cancelled" && <div className={`flex items-center justify-between gap-3 border-t p-3 text-xs md:hidden ${darkMode ? "border-slate-700 bg-slate-900 text-slate-300" : "border-slate-200 bg-gray-50 text-slate-700"}`}>
              <span>Page {activePage} of {activeTotalPages}</span>
              <div className="flex gap-2">
                <button type="button" disabled={activePage === 1} onClick={() => setActivePage(activePage - 1)} className={`rounded-lg border px-3 py-2 font-semibold disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-white"}`}>Previous</button>
                <button type="button" disabled={activePage === activeTotalPages} onClick={() => setActivePage(activePage + 1)} className={`rounded-lg border px-3 py-2 font-semibold disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-white"}`}>Next</button>
              </div>
            </div>}

            {/* Pagination */}

            <div className="hidden justify-center items-center p-4 border-t bg-gray-50 gap-4 md:flex">

              <span className="text-sm text-gray-600">
                Page {" "}
                {activePage}
                {" "}of{" "}
                {activeTotalPages}
              </span>

              <div className="flex gap-2">

                <button
                  disabled={activePage === 1}
                  onClick={() => setActivePage(activePage - 1)}
                  className="px-4 py-2 border rounded-lg"
                >
                  Previous
                </button>

                {[...Array(activeTotalPages)].map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setActivePage(index + 1)}
                    className={`w-10 h-10 rounded-lg ${
                      activePage === index + 1
                        ? "bg-red-600 text-white"
                        : "bg-white border"
                    }`}
                  >
                    {index + 1}
                  </button>
                ))}

                <button
                  disabled={activePage === activeTotalPages}
                  onClick={() => setActivePage(activePage + 1)}
                  className="px-4 py-2 border rounded-lg"
                >
                  Next
                </button>

              </div>

            </div>

          </div>

          <AppToaster />

          {cancelTransactionOrder && (
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
              role="presentation"
              onMouseDown={(event) => event.target === event.currentTarget && !cancellationLoading && setCancelTransactionOrder(null)}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="cancel-project-title"
                className={`w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl ${darkMode ? "border-slate-700 bg-[#132238] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <header className={`flex items-start justify-between gap-4 border-b p-5 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div>
                    <h2 id="cancel-project-title" className="text-lg font-bold">Cancel This Project?</h2>
                    <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                      Are you sure you want to cancel this transaction? Cancelling this transaction will mark the entire project as Cancelled and move it to the Cancelled list in Transaction and Progress Monitor.
                    </p>
                  </div>
                  <button type="button" onClick={() => setCancelTransactionOrder(null)} disabled={cancellationLoading} aria-label="Close cancellation confirmation" className={`rounded-lg p-1.5 disabled:opacity-50 ${darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}>
                    <X size={18} aria-hidden="true" />
                  </button>
                </header>
                <div className="space-y-4 p-5">
                  <dl className={`grid grid-cols-2 gap-3 rounded-xl border p-3 text-sm ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-slate-50"}`}>
                    <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Project / Transaction Reference</dt><dd className="mt-1 break-all font-mono text-xs font-semibold">{cancelTransactionOrder.tracking || cancelTransactionOrder._id || cancelTransactionOrder.id || "—"}</dd></div>
                    <div><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Customer Name</dt><dd className="mt-1 font-semibold">{cancelTransactionOrder.customer_name || `${cancelTransactionOrder.customer?.first_name || ""} ${cancelTransactionOrder.customer?.last_name || ""}`.trim() || "N/A"}</dd></div>
                    <div className="col-span-2"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Current Project Status</dt><dd className="mt-1 font-semibold">{cancelTransactionOrder.status || "—"}</dd></div>
                  </dl>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold">Cancellation Reason <span className="text-red-600">*</span></span>
                    <textarea
                      required
                      maxLength={1000}
                      value={cancellationReason}
                      onChange={(event) => setCancellationReason(event.target.value)}
                      disabled={cancellationLoading}
                      rows={4}
                      className={`w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-500/20 disabled:opacity-60 ${darkMode ? "border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500 focus:border-red-400" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-red-500"}`}
                    />
                  </label>
                </div>
                <footer className={`flex flex-col-reverse justify-end gap-2 border-t p-5 sm:flex-row ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <button type="button" onClick={() => setCancelTransactionOrder(null)} disabled={cancellationLoading} className={`rounded-lg border px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>Keep Transaction</button>
                  <button type="button" onClick={handleConfirmProjectCancellation} disabled={cancellationLoading || !cancellationReason.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-50">
                    {cancellationLoading && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                    {cancellationLoading ? "Cancelling..." : "Confirm Cancellation"}
                  </button>
                </footer>
              </section>
            </div>
          )}

          {showGenerateReportModal && (
            <div
              className="transaction-report-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
              role="presentation"
              onMouseDown={(event) => event.target === event.currentTarget && !reportGenerationLoading && setShowGenerateReportModal(false)}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="generate-report-title"
                className={`w-full max-w-2xl overflow-hidden rounded-2xl border shadow-2xl ${darkMode ? "border-slate-700 bg-[#132238] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <header className={`flex items-start justify-between gap-4 border-b px-5 py-4 ${darkMode ? "border-slate-700 bg-[#0f1b2c]" : "border-slate-200 bg-slate-50"}`}>
                  <div>
                    <h2 id="generate-report-title" className="text-lg font-bold">Generate Transaction Report</h2>
                    <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Choose a report and optional filters. All Reports creates a separate worksheet for each category.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowGenerateReportModal(false)}
                    disabled={reportGenerationLoading}
                    aria-label="Close report dialog"
                    className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-50 ${darkMode ? "border-slate-600 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}
                  >
                    <X size={17} aria-hidden="true" />
                  </button>
                </header>

                <form onSubmit={handleGenerateTransactionReport}>
                  <div className="grid max-h-[65vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className={`mb-1.5 block text-xs font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Report category</span>
                      <CustomerDropdown darkMode={darkMode}
                        value={reportType}
                        onChange={(event) => setReportType(event.target.value)}
                        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 ${darkMode ? "border-slate-600 bg-[#1d2f45] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
                      >
                        {TRANSACTION_REPORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </CustomerDropdown>
                    </label>

                    <label className="block">
                      <span className={`mb-1.5 block text-xs font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Start date</span>
                      <input
                        type="date"
                        value={reportStartDate}
                        min={reportMinDate || undefined}
                        max={[reportEndDate, reportMaxDate].filter(Boolean).sort()[0] || undefined}
                        onChange={(event) => handleReportStartDateChange(event.target.value)}
                        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 ${darkMode ? "border-slate-600 bg-[#1d2f45] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
                      />
                    </label>
                    <label className="block">
                      <span className={`mb-1.5 block text-xs font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>End date</span>
                      <input
                        type="date"
                        value={reportEndDate}
                        min={[reportStartDate, reportMinDate].filter(Boolean).sort().at(-1) || undefined}
                        max={reportMaxDate || undefined}
                        onChange={(event) => handleReportEndDateChange(event.target.value)}
                        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 ${darkMode ? "border-slate-600 bg-[#1d2f45] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
                      />
                    </label>

                    {reportHasProjectStatus && (
                      <label className="block">
                        <span className={`mb-1.5 block text-xs font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Project status</span>
                        <CustomerDropdown darkMode={darkMode}
                          value={reportProjectStatus}
                          onChange={(event) => setReportProjectStatus(event.target.value)}
                          className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 ${darkMode ? "border-slate-600 bg-[#1d2f45] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
                        >
                          <option value="all">All Status</option>
                          <option value="pending">Pending</option>
                          <option value="active">Active / In Progress</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </CustomerDropdown>
                      </label>
                    )}

                    {reportHasPaymentStatus && (
                      <label className="block">
                        <span className={`mb-1.5 block text-xs font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Payment status</span>
                        <CustomerDropdown darkMode={darkMode}
                          value={reportPaymentStatus}
                          onChange={(event) => setReportPaymentStatus(event.target.value)}
                          className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 ${darkMode ? "border-slate-600 bg-[#1d2f45] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
                        >
                          <option value="all">All Payment Status</option>
                          <option value="pending">Pending</option>
                          <option value="partial_downpayment">Partial Downpayment</option>
                          <option value="downpayment">Paid</option>
                          <option value="partial">Partial Payment</option>
                          <option value="paid">Fully Paid</option>
                        </CustomerDropdown>
                      </label>
                    )}

                    <label className="block">
                      <span className={`mb-1.5 block text-xs font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Customer</span>
                      <CustomerDropdown darkMode={darkMode}
                        value={reportCustomer}
                        onChange={(event) => setReportCustomer(event.target.value)}
                        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 ${darkMode ? "border-slate-600 bg-[#1d2f45] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
                      >
                        <option value="all">All customers</option>
                        {reportCustomerOptions.map((customer) => <option key={customer.value} value={customer.value}>{customer.label}</option>)}
                      </CustomerDropdown>
                    </label>

                    <label className="block sm:col-span-2">
                      <span className={`mb-1.5 block text-xs font-bold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Search</span>
                      <input
                        type="search"
                        maxLength={200}
                        value={reportSearch}
                        onChange={(event) => setReportSearch(event.target.value)}
                        placeholder="Customer, tracking ID, order ID, or transaction reference"
                        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 ${darkMode ? "border-slate-600 bg-[#1d2f45] text-slate-100 placeholder:text-slate-400" : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"}`}
                      />
                    </label>
                  </div>

                  <footer className={`flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end ${darkMode ? "border-slate-700 bg-[#0f1b2c]" : "border-slate-200 bg-slate-50"}`}>
                    <button
                      type="button"
                      onClick={() => setShowGenerateReportModal(false)}
                      disabled={reportGenerationLoading}
                      className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={reportGenerationLoading}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      {reportGenerationLoading ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <FileDown size={16} aria-hidden="true" />}
                      {reportGenerationLoading ? "Generating..." : "Generate Excel Report"}
                    </button>
                  </footer>
                </form>
              </section>
            </div>
          )}

          {showContractModal && contractPreviewOrder && (
            <TransactionDetailsModal
              order={contractPreviewOrder}
              onClose={closeContractModal}
              onViewContract={openFullContractModal}
              hidePaymentAmounts={hidePaymentAmounts}
              includeRepairHistory
            />
          )}

          {selectedExtraChargeReceipt && <ExtraChargeReceiptModal receipt={selectedExtraChargeReceipt} darkMode={darkMode} enableSend={["admin", "super_admin"].includes(user?.role)} onClose={() => setSelectedExtraChargeReceipt(null)} />}

          {editPaymentModalContent}

          {paymentDocumentPreview && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-0 backdrop-blur-sm sm:p-4">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="payment-document-preview-title"
                className={`flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden sm:h-[min(90vh,54rem)] sm:max-h-[90vh] sm:max-w-4xl sm:rounded-xl sm:border ${darkMode ? "border-slate-700 bg-[#17283d] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <header className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-5 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div className="min-w-0">
                    <h2 id="payment-document-preview-title" className="truncate text-sm font-bold">Payment proof</h2>
                    <p className={`truncate text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`} title={paymentDocumentPreview.name}>{paymentDocumentPreview.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPaymentDocumentPreview(null)}
                    aria-label="Close payment proof preview"
                    title="Close preview"
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${darkMode ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </header>
                <div className={`flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-5 ${darkMode ? "bg-[#0f1b2c]" : "bg-slate-100"}`}>
                  {paymentDocumentPreview.loading ? (
                    <div className={`flex flex-col items-center gap-3 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`} role="status" aria-live="polite">
                      <LoaderCircle size={28} className="animate-spin text-red-500" aria-hidden="true" />
                      Loading payment document...
                    </div>
                  ) : paymentDocumentPreview.type === "application/pdf" ? (
                    <iframe
                      src={paymentDocumentPreview.url}
                      title={`Payment proof: ${paymentDocumentPreview.name}`}
                      className="h-full min-h-0 w-full rounded-lg border border-slate-500/20 bg-white"
                    />
                  ) : (
                    <img
                      src={paymentDocumentPreview.url}
                      alt={`Payment proof: ${paymentDocumentPreview.name}`}
                      className="max-h-full max-w-full rounded-lg object-contain"
                    />
                  )}
                </div>
                <footer className={`flex shrink-0 justify-end border-t px-4 py-3 sm:px-5 ${darkMode ? "border-slate-700 bg-[#17283d]" : "border-slate-200 bg-white"}`}>
                  <a
                    href={paymentDocumentPreview.url}
                    download={paymentDocumentPreview.name}
                    className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                  >
                    Download
                  </a>
                </footer>
              </section>
            </div>
          )}

          {lowDownpaymentWarning && editPaymentOrder && (() => {
            const summary = getPaymentSummary(editPaymentOrder);
            const exceptionInputClass = darkMode
              ? "w-full rounded-xl border border-slate-600 bg-[#1d2f45] px-3 py-2.5 text-base text-slate-100 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-500/30"
              : "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100";
            const exceptionFooterClass = darkMode
              ? "flex justify-end gap-3 border-t border-slate-700 bg-[#1d2f45] px-5 py-4"
              : "flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4";
            const exceptionCancelClass = darkMode
              ? "rounded-xl border border-slate-600 bg-[#15263f] px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-700"
              : "rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100";
            const exceptionApproveClass = darkMode
              ? "rounded-xl border border-red-500/50 bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60"
              : "rounded-xl border border-red-200 bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60";
            return (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
                <section className={`w-full max-w-xl rounded-2xl border shadow-2xl ${darkMode ? "border-slate-700 bg-[#132238] text-slate-100" : "border-slate-200 bg-white text-slate-900"}`} role="alertdialog" aria-modal="true" aria-labelledby="downpayment-exception-title">
                  <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                    <h2 id="downpayment-exception-title" className="text-base font-black">Confirm Lower Downpayment</h2>
                    <div className="mt-2 flex items-start gap-2 text-sm font-semibold text-amber-700 dark:text-amber-200">
                      <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                      <p>Admin review required: The entered payment is below the required downpayment amount. Confirm that the seller or an authorized approver has accepted this amount, then record the approval details before proceeding.</p>
                    </div>
                  </div>
                  <div className="space-y-3 px-5 py-4 text-sm">
                    <p className="text-xs font-semibold text-slate-500">Order {editPaymentOrder.tracking || editPaymentOrder._id}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><span className="text-xs text-slate-500">{editPaymentOrder.payment_terms === "full_payment" ? "Required full payment" : "Required downpayment"} · {getSavedPaymentTermsLabel(editPaymentOrder.payment_terms)}</span><p className="mt-1 font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(lowDownpaymentWarning.requiredAmount)}</span></p></div>
                      <div><span className="text-xs text-slate-500">Entered payment</span><p className="mt-1 font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(lowDownpaymentWarning.enteredAmount)}</span></p></div>
                      <div><span className="text-xs text-slate-500">Remaining shortfall</span><p className="mt-1 font-bold text-amber-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(lowDownpaymentWarning.remainingDownpayment)}</span></p></div>
                      <div><span className="text-xs text-slate-500">Remaining project balance</span><p className="mt-1 font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(lowDownpaymentWarning.remainingProjectBalance)}</span></p></div>
                    </div>
                    <p className={`rounded-lg px-3 py-2 text-xs ${darkMode ? "bg-amber-500/10 text-amber-200" : "bg-amber-50 text-amber-900"}`}>The configured downpayment remains unchanged. Approval verifies only the submitted amount; it does not mark the downpayment as paid.</p>
                    <label htmlFor="downpayment-seller-approval-party" className="block text-xs font-bold">Seller or authorized approving party <span className="text-red-500">(required)</span></label>
                    <input
                      id="downpayment-seller-approval-party"
                      type="text"
                      maxLength={200}
                      value={lowDownpaymentSellerApprovalParty}
                      onChange={(event) => {
                        setLowDownpaymentSellerApprovalParty(event.target.value);
                        setLowDownpaymentWarningError("");
                      }}
                      placeholder="Name of seller or authorized approver"
                      className={exceptionInputClass}
                    />
                    <label className="flex items-start gap-2 text-xs font-semibold">
                      <input
                        type="checkbox"
                        checked={lowDownpaymentSellerApprovalConfirmed}
                        onChange={(event) => {
                          setLowDownpaymentSellerApprovalConfirmed(event.target.checked);
                          setLowDownpaymentWarningError("");
                        }}
                        className="mt-0.5 accent-red-600"
                      />
                      <span>I confirm that the seller or authorized party above approved accepting this lower payment.</span>
                    </label>
                    <label htmlFor="downpayment-exception-reason" className="block text-xs font-bold">Reason for accepting this lower payment <span className="text-red-500">(required)</span></label>
                    <textarea
                      id="downpayment-exception-reason"
                      value={lowDownpaymentReason}
                      onChange={(event) => {
                        setLowDownpaymentReason(event.target.value);
                        setLowDownpaymentWarningError("");
                      }}
                      placeholder="Record the customer agreement and why this lower amount is accepted."
                      rows={3}
                      maxLength={1000}
                      className={exceptionInputClass}
                    />
                    {lowDownpaymentWarningError && <p role="alert" className="text-sm font-semibold text-red-600">{lowDownpaymentWarningError}</p>}
                  </div>
                  <div className={exceptionFooterClass}>
                    <button type="button" disabled={paymentActionLoading} onClick={() => { setLowDownpaymentWarning(null); setLowDownpaymentReason(""); setLowDownpaymentSellerApprovalParty(""); setLowDownpaymentSellerApprovalConfirmed(false); setLowDownpaymentWarningError(""); }} className={exceptionCancelClass}>Cancel</button>
                    <button
                      type="button"
                      disabled={paymentActionLoading || !lowDownpaymentReason.trim() || !lowDownpaymentSellerApprovalParty.trim() || !lowDownpaymentSellerApprovalConfirmed}
                      onClick={() => handleSavePaymentEdit({
                        acceptLowerDownpayment: true,
                        reasonOverride: lowDownpaymentReason,
                        sellerApprovalConfirmed: lowDownpaymentSellerApprovalConfirmed,
                        sellerApprovalParty: lowDownpaymentSellerApprovalParty,
                      })}
                      className={exceptionApproveClass}
                    >
                      {paymentActionLoading ? "Saving..." : "Record Approved Exception"}
                    </button>
                  </div>
                </section>
              </div>
            );
          })()}

          {showFullContractModal && contractPreviewOrder && contractPreviewData && (
            <ContractModal
              isOpen={showFullContractModal}
              onClose={closeContractModal}
              inspection={contractPreviewOrder}
              contractData={contractPreviewData}
              onDownload={downloadContractPDF}
              onPrint={printContract}
              hidePaymentAmounts={hidePaymentAmounts}
            />
          )}

          {feedbackReplyOrder && (
            <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/55 p-4" role="presentation">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="feedback-reply-title"
                className={`w-full max-w-lg rounded-2xl border p-5 shadow-xl ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 id="feedback-reply-title" className="text-lg font-bold">{feedbackReplyOrder.review?.adminResponse ? "Edit Admin Response" : "Reply to Feedback"}</h2>
                    <p className={`mt-1 truncate text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      {feedbackReplyOrder.customer_name || `${feedbackReplyOrder.customer?.first_name || ""} ${feedbackReplyOrder.customer?.last_name || ""}`.trim() || "Customer"}
                      {feedbackReplyOrder.reviewProductName ? ` · ${feedbackReplyOrder.reviewProductName}` : ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => setFeedbackReplyOrder(null)} aria-label="Close reply dialog" className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    <X size={17} aria-hidden="true" />
                  </button>
                </div>
                <form onSubmit={handleSaveFeedbackReply} className="mt-5 space-y-4">
                  <label htmlFor="feedback-admin-response" className="block text-sm font-semibold">Admin Response</label>
                  <CustomerDropdown darkMode={darkMode}
                    aria-label="Choose a response template"
                    value={feedbackReplyTemplate}
                    onChange={(event) => {
                      const template = ADMIN_FEEDBACK_RESPONSE_TEMPLATES.find((entry) => entry.value === event.target.value);
                      setFeedbackReplyTemplate(event.target.value);
                      if (template) setFeedbackReplyText(template.response);
                    }}
                    className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-300 bg-white text-slate-800"}`}
                  >
                    <option value="">Choose a response template</option>
                    {ADMIN_FEEDBACK_RESPONSE_TEMPLATES.map((template) => (
                      <option key={template.value} value={template.value}>{template.label}</option>
                    ))}
                  </CustomerDropdown>
                  <textarea
                    id="feedback-admin-response"
                    value={feedbackReplyText}
                    onChange={(event) => {
                      setFeedbackReplyText(event.target.value);
                      setFeedbackReplyTemplate("");
                    }}
                    maxLength={1000}
                    rows={5}
                    required
                    placeholder="Write a response to this feedback"
                    className={`w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{feedbackReplyText.length}/1000</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setFeedbackReplyOrder(null)} disabled={feedbackReplySaving} className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>Cancel</button>
                      <button type="submit" disabled={feedbackReplySaving || !feedbackReplyText.trim()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                        {feedbackReplySaving && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
                        {feedbackReplySaving ? "Saving..." : "Submit Response"}
                      </button>
                    </div>
                  </div>
                </form>
              </section>
            </div>
          )}

          {feedbackPreviewOrder && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
              role="presentation"
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="feedback-preview-title"
                className={`flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <header className={`flex items-start justify-between gap-4 border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div className="min-w-0">
                    <h2 id="feedback-preview-title" className="text-lg font-semibold">Customer feedback</h2>
                    <p className={`mt-1 truncate text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      {feedbackPreviewOrder.customer_name || `${feedbackPreviewOrder.customer?.first_name || ""} ${feedbackPreviewOrder.customer?.last_name || ""}`.trim() || "Customer"}
                      {feedbackPreviewOrder.tracking ? ` · ${feedbackPreviewOrder.tracking}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFeedbackPreviewOrder(null)}
                    aria-label="Close feedback"
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                  >
                    <X size={17} aria-hidden="true" />
                  </button>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                  <section className={`rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-slate-50"}`}>
                    <h3 className={`border-b pb-2 text-[11px] font-semibold uppercase tracking-wide ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>Customer Info</h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <dt className={`shrink-0 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Full Name</dt>
                        <dd className="min-w-0 break-words text-right font-medium">
                          {feedbackPreviewOrder.customer_name || `${feedbackPreviewOrder.customer?.first_name || ""} ${feedbackPreviewOrder.customer?.last_name || ""}`.trim() || "N/A"}
                        </dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className={`shrink-0 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Email / Contact</dt>
                        <dd className="min-w-0 break-all text-right font-medium">
                          {feedbackPreviewOrder.customer?.email || feedbackPreviewOrder.customer_email || feedbackPreviewOrder.customer?.phone || feedbackPreviewOrder.customer_phone || "N/A"}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className={`rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-slate-50"}`}>
                    <h3 className={`border-b pb-2 text-[11px] font-semibold uppercase tracking-wide ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>Project Summary</h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <dt className={`shrink-0 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Product / Project</dt>
                        <dd className="min-w-0 text-right font-medium">
                          {feedbackPreviewOrder.reviewProductName || (feedbackPreviewOrder.items || []).map((item) => item.name || item.product_name).filter(Boolean).join(", ") || "N/A"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className={darkMode ? "text-slate-400" : "text-slate-500"}>Category</dt>
                        <dd className="text-right font-medium">{isCompletedProject(feedbackPreviewOrder) ? "Completed Project" : "In Progress"}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className={darkMode ? "text-slate-400" : "text-slate-500"}>Total Amount</dt>
                        <dd className="text-right font-semibold">₱{getPaymentSummary(feedbackPreviewOrder).totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                      </div>
                    </dl>
                  </section>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1" aria-label={`${Number(feedbackPreviewOrder.review?.rating || 0)} out of 5 stars`}>
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          size={18}
                          className={index < Number(feedbackPreviewOrder.review?.rating || 0) ? "fill-amber-400 text-amber-400" : darkMode ? "text-slate-600" : "text-slate-300"}
                          aria-hidden="true"
                        />
                      ))}
                      <span className={`ml-1 text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                        {Number(feedbackPreviewOrder.review?.rating || 0)}/5
                      </span>
                    </div>
                    <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      {feedbackPreviewOrder.review?.submittedAt ? formatDateToMMMDDYYYY(feedbackPreviewOrder.review.submittedAt) : "—"}
                    </span>
                  </div>

                  {feedbackPreviewOrder.review?.title && (
                    <h3 className="text-base font-semibold">{feedbackPreviewOrder.review.title}</h3>
                  )}
                  <p className={`whitespace-pre-line break-words text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                    {feedbackPreviewOrder.review?.comment || "No written feedback."}
                  </p>

                  <div>
                    <h3 className={`mb-2 text-sm font-medium ${darkMode ? "text-slate-200" : "text-slate-800"}`}>Photos</h3>
                    {(feedbackPreviewOrder.review?.photos || []).length > 0 ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {feedbackPreviewOrder.review.photos.map((photo, index) => (
                          <button
                            type="button"
                            onClick={() => openPaymentDocumentPreview(photo, `Review photo ${index + 1}`)}
                            key={`${photo}-${index}`}
                            aria-label={`Open review photo ${index + 1}`}
                            className={`aspect-square overflow-hidden rounded-lg border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}
                          >
                            <img src={photo} alt={`Review photo ${index + 1}`} className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className={`text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>No photos submitted.</p>
                    )}
                  </div>
                </div>

                <footer className={`flex justify-end border-t px-5 py-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
                  <button
                    type="button"
                    onClick={() => setFeedbackPreviewOrder(null)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                  >
                    Close
                  </button>
                </footer>
              </section>
            </div>
          )}

          {feedbackDeleteOrder && (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4"
              role="presentation"
            >
              <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-feedback-title"
                aria-describedby="delete-feedback-description"
                className={`w-full max-w-md rounded-2xl border p-5 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <h2 id="delete-feedback-title" className="text-lg font-semibold">
                  Delete {Number.isInteger(feedbackDeleteOrder.reviewItemIndex) ? "Product" : "Customer"} Feedback?
                </h2>
                <p id="delete-feedback-description" className={`mt-2 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  This will permanently remove feedback from {feedbackDeleteOrder.customer_name || `${feedbackDeleteOrder.customer?.first_name || ""} ${feedbackDeleteOrder.customer?.last_name || ""}`.trim() || "Customer"} for {feedbackDeleteOrder.reviewProductName || "this order"}. This action cannot be undone.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={feedbackDeleting}
                    onClick={() => setFeedbackDeleteOrder(null)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={feedbackDeleting}
                    onClick={handleDeleteCustomerFeedback}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    {feedbackDeleting ? "Deleting..." : "Delete Customer Feedback"}
                  </button>
                </div>
              </section>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

export default Transactions;
