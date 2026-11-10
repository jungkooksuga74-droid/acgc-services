import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import AppToaster from "@/components/AppToaster";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/button";
import {
  Home,
  ShoppingCart,
  Info,
  User,
  Building2,
  Hash,
  LockKeyhole,
  LogOut,
  Search,
  Mail,
  Phone,
  MapPin,
  Save,
  Ruler,
  Package,
  ArrowRight,
  Plus,
  Minus,
  FileText,
  Eye,
  EyeOff,
  Pencil,
  Bell,
  Check,
  CheckCheck,
  CheckCircle,
  AlertTriangle,
  Star,
  StarHalf,
  Clock3,
  Moon,
  Sun,
  ArrowLeft,
  ArrowUpRight,
  X,
  ClipboardList,
  CalendarDays,
  CreditCard,
  Trash2,
  Paperclip,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Scissors,
  Truck,
} from "lucide-react";
import logo from "../../assets/images/ACGCLOGO1.png";
import { useAuth } from "@/contexts/AuthContext";
import { isPasswordPolicySatisfied, PASSWORD_POLICY_HINT, PASSWORD_POLICY_MESSAGE } from "@/lib/passwordStrength";
import { getProduct, getProducts } from "@/api/products";
import { API_BASE, apiFetch } from "@/api/client";
import { resolveBackendImageUrl } from "@/lib/resolveBackendImageUrl";
import {
  createOrder,
  getOrders,
  trackOrder,
  acceptContract,
  declineContract,
  submitOrderReview,
  getProductReviews,
  getProductReviewSummaries,
  cancelCustomerOrder,
} from "@/api/orders";
import { uploadFiles } from "@/api/uploads";
import ContractModal from "../../components/ContractModal";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";
import FullAddressField from "@/components/FullAddressField";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";
import { createUnsavedSnapshot } from "@/lib/unsavedSnapshot";
import { getStreetAddressError, isValidStreetAddress, normalizeFullAddress } from "@/lib/fullAddressValidation";
import AboutBusinessContent from "@/components/AboutBusinessContent";
import FilterDropdown from "@/components/FilterDropdown";
import CustomerDropdown from "@/components/CustomerDropdown";
import OtpCodeInput from "@/components/OtpCodeInput";
import ProductPriceEstimator, { getProductEstimatorState } from "@/components/ProductPriceEstimator";
import ProductSpecifications, { getProductDimensionsLabel } from "@/components/ProductSpecifications";
import { getProductEstimatorQuantityError, MAX_PRODUCT_ESTIMATOR_QUANTITY } from "@/lib/productEstimatorQuantity";
import { formatOrderItemMeasurements } from "@/components/OrderProgressTimeline";
import OrderTimelineModal from "@/components/OrderTimelineModal";
import InstallationBillingPanel from "@/components/InstallationBillingPanel";
import ExtraChargeReceiptModal from "@/components/ExtraChargeReceiptModal";
import { addExtraChargeReceiptContext, addProjectPaymentReceiptContext } from "@/lib/extraChargeReceipt";
import { calculateEstimate } from "@/lib/estimator";
import { buildOrderTimelineStages, calculateStageProgressPercent } from "@/lib/orderTimeline";
import { getProgressColor } from "@/lib/utils";
import { paginateItems } from "@/lib/pagination";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAdminContactPhone } from "@/hooks/useAdminContactPhone";
import { getSystemSettings } from "@/api/users";
import { requestEmailChange, resendEmailChangeCode, verifyEmailChangeCode } from "@/api/auth";
import { getCart, saveCart } from "@/api/cart";
import { formatDateToMMMDDYYYY, formatDateTimeToMMMDDYYYY, formatTimeAgo } from "@/lib/dateUtils";
import { buildDelayNotifications, sortCustomerNotificationsNewestFirst } from "@/lib/delayNotifications";
import CustomerRepairRequests from "@/components/CustomerRepairRequests";
import UsernameChangeFlow from "@/components/UsernameChangeFlow";
import { getCustomerRepairRequests } from "@/api/repairs";
import {
  getCustomerOrderNotificationMessage,
  getOrderStatusClasses,
  getOrderStatusLabel,
  isOrderStatusCompleted,
  getSiteInspectionNotificationMessage,
  normalizeOrderStatus,
  normalizeOrderStatusKey,
} from "./orderStatusUtils";
import { formatCustomerPaymentAmountInput, getCustomerPaymentProof, getPaymentSummary, getSavedPaymentTermsLabel, getUnresolvedPaymentProofRecords, isPaymentProofConfirmed, validateCustomerPaymentAmount } from "@/pages/Transactions/paymentProofUtils";
import { getContractSignoffBadgeClassName, getPaymentStatusLabel, isAwaitingContractSignoff, statusBadgeBaseClassName } from "@/lib/statusBadgeStyles";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { useCustomerPermissions } from "@/hooks/useCustomerPermissions";
import { buildProductPriceSnapshot, getDefaultBladeCount, getDefaultExtraChargeSelections, getDefaultProductLineTotal, getProductLineBreakdown, getProductLineTotal } from "@/lib/productPricing";
import { clearPendingProductAction, clearPendingProductWorkflowState, getPendingProductAction, getPendingProductWorkflowState, savePendingProductWorkflowState, updatePendingProductAction } from "@/lib/pendingProductAction";
import { getOptimizedProductImageUrl, getProductImageSource, getProductImageSrcSet, handleProductImageError, handleProductImageLoad } from "@/lib/productImageUtils";
import { getFinalProjectCost } from "@/lib/orderPricing";
import { getPhilippinePhoneError, isValidPhilippinePhone, normalizePhoneInput } from "@/lib/phoneValidation";
import { getCustomerPaymentContact } from "@/api/users";
import ProfileAvatar from "../../components/ui/ProfileAvatar";

const getPaymentSupportPhone = (value) => {
  const original = String(value || "").trim();
  if (!original) return null;

  const normalized = normalizePhoneInput(value);
  if (!isValidPhilippinePhone(normalized)) {
    const dialable = original.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
    return dialable ? { display: original, href: `tel:${dialable}` } : null;
  }
  const digits = normalized.replace(/\D/g, "");
  const international = digits.startsWith("0") ? `+63${digits.slice(1)}` : `+${digits}`;
  const localDigits = digits.startsWith("0") ? digits.slice(1) : digits.slice(2);
  return { display: `+63 ${localDigits.slice(0, 3)} ${localDigits.slice(3, 6)} ${localDigits.slice(6)}`, href: `tel:${international}` };
};

const PRODUCT_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'%3E%3Crect width='600' height='400' fill='%23e2e8f0'/%3E%3Cpath d='M248 148h104a28 28 0 0 1 28 28v48a28 28 0 0 1-28 28H248a28 28 0 0 1-28-28v-48a28 28 0 0 1 28-28Zm0 20a8 8 0 0 0-8 8v48a8 8 0 0 0 8 8h104a8 8 0 0 0 8-8v-48a8 8 0 0 0-8-8H248Zm18 22a16 16 0 1 1 0 32 16 16 0 0 1 0-32Zm50 35 17-21 31 40H244l34-42 25 30 13-7Z' fill='%2394a3b8'/%3E%3Ctext x='300' y='292' text-anchor='middle' font-family='Arial, sans-serif' font-size='24' font-weight='700' fill='%23475569'%3EProduct image%3C/text%3E%3C/svg%3E";

const CUSTOMER_READ_NOTIFICATIONS_KEY = "acgc-customer-read-notifications";
const CUSTOMER_DARK_MODE_KEY = "acgc-customer-dark-mode";
const CUSTOMER_PENDING_ORDER_STATUSES = new Set(["order_submitted", "admin_review", "contract_sent", "contract_accepted"]);
const CUSTOMER_CLOSED_ORDER_STATUSES = new Set(["cancelled", "contract_declined", "declined", "rejected"]);
const isCustomerPendingOrder = (order) => {
  const status = normalizeOrderStatusKey(order?.status);
  const contractStatus = normalizeOrderStatusKey(order?.contract_status);
  if (status === "completed" || CUSTOMER_CLOSED_ORDER_STATUSES.has(status) || contractStatus === "declined") return false;
  return CUSTOMER_PENDING_ORDER_STATUSES.has(status) || contractStatus === "sent";
};
const isCustomerActiveOrder = (order) => {
  const status = normalizeOrderStatusKey(order?.status);
  const contractStatus = normalizeOrderStatusKey(order?.contract_status);
  return status !== "completed" && !CUSTOMER_CLOSED_ORDER_STATUSES.has(status) && contractStatus !== "declined" && !isCustomerPendingOrder(order);
};
const isOrderCompletedAndReviewable = (order) => {
  if (!order) return false;
  const status = normalizeOrderStatusKey(order?.status);
  if (["cancelled", "declined", "contract_declined", "rejected"].includes(status)) return false;

  const isStageComplete = (stage) =>
    stage?.completed === true || ["done", "completed"].includes(normalizeOrderStatusKey(stage?.status));
  const orderStages = Array.isArray(order.progress_stages) ? order.progress_stages : [];
  const orderStagesComplete = orderStages.length > 0 && orderStages.every(isStageComplete);
  const orderFieldsComplete = status === "completed" && Number(order.progress) >= 100;
  const batchItems = Array.isArray(order.items) ? order.items : [];
  const batchItemsComplete = batchItems.length > 1 && batchItems.every((item) => {
    const itemStages = Array.isArray(item?.progress_stages) ? item.progress_stages : [];
    return itemStages.length > 0
      ? itemStages.every(isStageComplete)
      : Number(item?.progress) >= 100;
  });

  if (!orderFieldsComplete && !orderStagesComplete && !batchItemsComplete) return false;
  if (orderStagesComplete || batchItemsComplete) return true;

  const lastStage = orderStages[orderStages.length - 1];
  const lastStageStatus = normalizeOrderStatusKey(lastStage?.status);
  if (!lastStage) return true;
  return Boolean(lastStage.completed || lastStageStatus === "done" || lastStageStatus === "completed");
};

const getOrderSubmissionMessage = (response, action) => {
  const baseMessage = `${action} successfully. Tracking ID: ${response.order.tracking}`;
  if (response.notification_email_status === "sent") return `${baseMessage} A confirmation email was sent to your account email.`;
  if (response.notification_email_status === "missing_recipient") return `${baseMessage} No confirmation email was sent because your account has no email address.`;
  return `${baseMessage} We couldn't send the confirmation email right now. Please contact support.`;
};
const ORDER_REVIEW_TOPICS = [
  { value: "quality", label: "Product Quality" },
  { value: "service", label: "Professional Service" },
  { value: "installation", label: "Installation Experience" },
];

const appendReviewTopicPrompt = (comment, label) => {
  const prompt = `${label}:`;
  const alreadyPresent = comment.split("\n").some((line) => {
    const trimmedLine = line.trimStart().toLowerCase();
    return trimmedLine === prompt.toLowerCase() || trimmedLine.startsWith(`${prompt.toLowerCase()} `);
  });
  if (alreadyPresent) return comment;
  return `${comment.trimEnd()}${comment.trim() ? "\n" : ""}${prompt} `;
};

const removeReviewTopicPrompt = (comment, label) => {
  const prompt = `${label}:`;
  const lines = comment.split("\n");
  const promptIndex = lines.findIndex((line) => {
    const trimmedLine = line.trimStart();
    return trimmedLine === prompt || trimmedLine.startsWith(`${prompt} `);
  });
  if (promptIndex === -1) return comment;

  const line = lines[promptIndex];
  const indentation = line.match(/^\s*/)?.[0] || "";
  const answer = line.slice(indentation.length + prompt.length).trimStart();
  if (answer) lines[promptIndex] = `${indentation}${answer}`;
  else lines.splice(promptIndex, 1);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
};

const getReviewCommentBody = (comment, tags) =>
  ORDER_REVIEW_TOPICS.reduce((body, topic) => (
    tags.includes(topic.value)
      ? body.replace(new RegExp(`^${topic.label}:\\s*`, "gim"), "")
      : body
  ), comment).trim();

const getDelayNotificationMessage = (notification) => {
  const stageName = notification.delayStageName || "Project stage";
  if (notification.delayResolved) return "The project delay has been resolved. Your completed progress remains unchanged.";
  const reason = notification.delayReason ? ` Reason: ${notification.delayReason}` : "";
  const expectedResolution = formatDateToMMMDDYYYY(notification.delayExpectedResolution);
  const proposedDate = formatDateToMMMDDYYYY(notification.delayProposedDate);
  const resolutionText = expectedResolution ? ` Expected resolution: ${expectedResolution}.` : proposedDate ? ` Proposed revised date (pending confirmation): ${proposedDate}.` : "";
  return `${stageName} is delayed.${reason}${resolutionText}`;
};

function ProfileTextField({ label, icon: Icon, darkMode, action, inputClassName = "", ...inputProps }) {
  const inputTheme = darkMode
    ? "border-slate-700 bg-slate-900 text-white placeholder:text-slate-400 disabled:text-slate-400"
    : "border-gray-300 bg-white text-slate-900 placeholder:text-gray-400 disabled:border-slate-200 disabled:bg-gray-100 disabled:text-gray-500";

  return (
    <label className={`block text-xs font-semibold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
      <span className="mb-1 flex min-h-4 items-center justify-between gap-2">
        <span>{label}</span>
        {action}
      </span>
      <span className="relative block">
        <Icon size={18} strokeWidth={1.8} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          {...inputProps}
          className={`w-full rounded-xl border py-2.5 pl-11 pr-4 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-500/10 disabled:cursor-not-allowed ${inputTheme} ${inputClassName}`}
        />
      </span>
    </label>
  );
}

const normalizeAddress = (value) => {
  if (!value) return "";
  const cleaned = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[,;]+/g, ",")
    .replace(/\s*[.,]\s*/g, ", ")
    .replace(/\s*,\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const canonical = (text) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\b(city|province|zip|code|street|st|road|rd)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const normalizedParts = [];
  const seen = [];

  for (const part of parts) {
    const key = canonical(part);
    if (!key) {
      normalizedParts.push(part);
      continue;
    }
    const isDuplicate = seen.some(
      (existing) => existing === key || existing.includes(key) || key.includes(existing)
    );
    if (!isDuplicate) {
      seen.push(key);
      normalizedParts.push(part);
    }
  }

  return normalizedParts.join(", ");
};

const buildFullAddress = (user) => {
  if (!user) return "";
  const addressParts = [user.street_address, user.city, user.province, user.zip_code].filter(Boolean);
  return normalizeAddress(addressParts.join(", "));
};

const getStreetAddressOnly = (user = {}) => {
  const canonical = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(city|province|zip|code|street|st|road|rd)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const locationParts = new Set([user.city, user.province, user.zip_code].map(canonical).filter(Boolean));

  return String(user.street_address || "")
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => part && !locationParts.has(canonical(part)))
    .join(", ");
};

const createCustomerProfileDraft = (user = {}) => ({
  first_name: user.first_name || "",
  last_name: user.last_name || "",
  phone: user.phone || "",
  email: user.email || "",
  username: user.username || "",
  street_address: getStreetAddressOnly(user),
  city: user.city || "",
  province: user.province || "",
  zip_code: user.zip_code || "",
  current_password: "",
  new_password: "",
  confirm_password: "",
});

const buildDeliveryAddress = (address = {}) => normalizeAddress(
  [address.street_address, address.city, address.province, address.zip_code].filter(Boolean).join(", ")
);

const renderRatingStars = (rating = 0, size = 18, darkMode = false) => {
  const normalizedRating = Number(rating) || 0;
  const fullStars = Math.floor(normalizedRating);
  const hasHalfStar = normalizedRating - fullStars >= 0.5;

  return Array.from({ length: 5 }, (_, index) => {
    if (index < fullStars) {
      return <Star key={index} size={size} fill="#ffc21a" className="text-amber-500" />;
    }

    if (index === fullStars && hasHalfStar) {
      return <StarHalf key={index} size={size} fill="#ffc21a" className="text-amber-500" />;
    }

    return <Star key={index} size={size} className={darkMode ? "text-slate-600" : "text-slate-300"} />;
  });
};

function CustomerDashboard() {
  const isMobile = useIsMobile();
  const {
    phone: adminContactPhone,
    phoneHref: adminContactPhoneHref,
    address: adminContactAddress,
    addressHref: adminContactAddressHref,
    email: adminContactEmail,
    emailHref: adminContactEmailHref,
  } = useAdminContactPhone();
  const API_HOST = (function getApiHost() {
    try {
      return (API_BASE || "").replace(/\/api$/, "");
    } catch (e) {
      return "";
    }
  })();

  const isLocalBlobOrFile = (url) => typeof url === "string" && (url.startsWith("blob:") || url.startsWith("file:"));

  const ensureAbsoluteUrl = (url) => {
    if (!url) return PRODUCT_IMAGE_PLACEHOLDER;
    if (isLocalBlobOrFile(url)) return PRODUCT_IMAGE_PLACEHOLDER;
    url = resolveBackendImageUrl(url);
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("/")) return API_HOST ? `${API_HOST}${url}` : url;
    if (url.startsWith("uploads/")) return API_HOST ? `${API_HOST}/${url}` : `/${url}`;
    return API_HOST ? `${API_HOST}/${url}` : url;
  };
  const { user, loading, updateProfile, refreshUser, logout } = useAuth();
  const onlineOrderCooldownUntil = user?.online_order_cooldown_until ? new Date(user.online_order_cooldown_until) : null;
  const onlineOrderCooldownActive = Boolean(onlineOrderCooldownUntil && onlineOrderCooldownUntil.getTime() > Date.now());
  const willTriggerCancellationCooldown = (Number(user?.customer_cancellation_count || 0) + 1) % 3 === 0;
  const customerPermissions = useCustomerPermissions();
  const orderOwnerId = user?.id || user?._id;
  const navigate = useNavigate();
  const location = useLocation();
  const initialDashboardParams = new URLSearchParams(location.search);
  const validCustomerTabs = ["home", "products", "orders", "cart", "about", "notifications", "profile", "contracts"];
  const lastCustomerSearchRef = useRef(location.search);
  const restoringCustomerLocationRef = useRef(false);
  const pushCustomerTabHistoryRef = useRef(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  useEffect(() => {
    if (loading || user?.role !== "customer") return undefined;

    const refreshCustomerPermissions = () => {
      if (document.visibilityState !== "visible") return;
      refreshUser().catch((error) => console.warn("Unable to refresh customer permissions", error));
    };
    refreshCustomerPermissions();
    const intervalId = window.setInterval(refreshCustomerPermissions, 30000);
    window.addEventListener("focus", refreshCustomerPermissions);
    document.addEventListener("visibilitychange", refreshCustomerPermissions);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshCustomerPermissions);
      document.removeEventListener("visibilitychange", refreshCustomerPermissions);
    };
  }, [loading, refreshUser, user?.id, user?.role]);

  const canRequestOrders = !maintenanceMode && customerPermissions.can_request_orders;
  const canEstimatePricing = !maintenanceMode && customerPermissions.can_estimate_pricing;
  const canTrackProducts = !maintenanceMode && customerPermissions.can_track_products;
  const canUploadFeedback = !maintenanceMode && customerPermissions.can_upload_feedback;
  const canAccessCustomerRatings = canUploadFeedback;
  const isProductModalReadOnly = !canRequestOrders && !canEstimatePricing;

  const [activeTab, setActiveTabState] = useState(() => {
    const tab = initialDashboardParams.get("tab");
    return validCustomerTabs.includes(tab) ? tab : "home";
  });
  const setActiveTab = (tab) => {
    if (tab !== activeTab) pushCustomerTabHistoryRef.current = true;
    setActiveTabState(tab);
  };
  useEffect(() => {
    if (!canRequestOrders && activeTab === "cart") setActiveTab("home");
  }, [activeTab, canRequestOrders]);

  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem(CUSTOMER_DARK_MODE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [paymentHistoryExpandedByOrder, setPaymentHistoryExpandedByOrder] = useState({});
  const paymentHistorySignatureByOrderRef = useRef(new Map());
  const notifiedContractVersionsRef = useRef(null);
  const hasLoadedCustomerOrdersRef = useRef(false);
  const [repairRequests, setRepairRequests] = useState([]);
  const [customerPaymentContactPhone, setCustomerPaymentContactPhone] = useState("");
  const onlineOrderCooldownMessage = onlineOrderCooldownActive
    ? `Online ordering is restricted for 7 days, until ${formatDateToMMMDDYYYY(onlineOrderCooldownUntil)}. Please visit our shop or contact us by phone${customerPaymentContactPhone ? `: ${customerPaymentContactPhone}` : ""} to place an order during this period.`
    : "";
  const withAdminContactPhone = (message) => {
    const text = String(message || "").trim();
    return customerPaymentContactPhone && !text.includes(customerPaymentContactPhone)
      ? `${text} Contact the shop at ${customerPaymentContactPhone} during this period.`
      : text;
  };
  const renderAdminContactMessage = (message) => {
    const text = String(message || "");
    if (!customerPaymentContactPhone || !text.includes(customerPaymentContactPhone)) return text;

    const [before, ...remaining] = text.split(customerPaymentContactPhone);
    const after = remaining.join(customerPaymentContactPhone);
    const telephoneNumber = customerPaymentContactPhone.replace(/[^\d+]/g, "");
    return (
      <>
        {before}
        <a
          href={`tel:${telephoneNumber}`}
          className="whitespace-nowrap font-bold no-underline"
          aria-label={`Call ${customerPaymentContactPhone}`}
        >
          <Phone size={14} className="mr-1 inline-block align-[-2px]" aria-hidden="true" /><strong className="underline underline-offset-2">{customerPaymentContactPhone}</strong>
        </a>
        {after}
      </>
    );
  };
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersLoadError, setOrdersLoadError] = useState("");
  const [cartItems, setCartItems] = useState([]);
  const [cartPricingProducts, setCartPricingProducts] = useState([]);
  const cartItemsRef = useRef([]);
  const cartSaveQueueRef = useRef(Promise.resolve());
  const cartMutationVersionRef = useRef(0);
  const pendingLandingCartResumeRef = useRef("");
  const [cartLoaded, setCartLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState(() => initialDashboardParams.get("productQ") || "");
  const [categoryFilter, setCategoryFilter] = useState(() => initialDashboardParams.get("productCategory") || "All");
  const [productTypeFilter, setProductTypeFilter] = useState(() => initialDashboardParams.get("productType") || "All");
  const [productPage, setProductPage] = useState(() => Math.max(1, Number(initialDashboardParams.get("productPage")) || 1));
  const [productsPerPage, setProductsPerPage] = useState(() => {
    const requestedValue = initialDashboardParams.get("productPerPage");
    if (requestedValue === "all") return 0;
    const requested = Number(requestedValue);
    return [4, 8, 12, 16].includes(requested) ? requested : 8;
  });
  const browseFiltersRef = useRef({ searchQuery, categoryFilter, productTypeFilter, productsPerPage });
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productError, setProductError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductImageIndex, setSelectedProductImageIndex] = useState(0);
  const [productEstimatorForm, setProductEstimatorForm] = useState({ unit: "in", width: "0", height: "0", blade_glass_type: "", piece_option: "", area_option: "", sale_mode: "blades_only", frame_type: "", custom_frame_size: false, blade_count: 1, extra_charges: [] });
  const [showAboutProduct, setShowAboutProduct] = useState(false);
  const [showCartDecisionModal, setShowCartDecisionModal] = useState(false);
  const [cartDecisionStep, setCartDecisionStep] = useState("choice");
  const [cartDecisionProduct, setCartDecisionProduct] = useState(null);
  const [estimateForm, setEstimateForm] = useState({
    unit: "in",
    width: "",
    height: "",
    quantity: 1,
    notes: "",
    blade_glass_type: "",
    piece_option: "",
    area_option: "",
    sale_mode: "blades_only",
    frame_type: "",
    custom_frame_size: false,
    blade_count: 1,
    is_estimate: true,
  });
  const [estimateFormErrors, setEstimateFormErrors] = useState({});
  const [cartActionError, setCartActionError] = useState("");
  const [batchOrderForm, setBatchOrderForm] = useState({
    phone: "",
    shipping_address: "",
    notes: "",
  });
  const [productReviews, setProductReviews] = useState([]);
  const [productReviewsLoading, setProductReviewsLoading] = useState(false);
  const [productReviewStats, setProductReviewStats] = useState({});

  const toggleDarkMode = () => {
    const nextDarkMode = !darkMode;
    setDarkMode(nextDarkMode);
    toast.success(`${nextDarkMode ? "Dark" : "Light"} mode activated`, {
      id: "customer-theme-mode",
    });
    try {
      localStorage.setItem(CUSTOMER_DARK_MODE_KEY, String(nextDarkMode));
    } catch {
      // Keep the current session theme if storage is unavailable.
    }
  };

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [checkoutMessageFading, setCheckoutMessageFading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [orderRequestMessage, setOrderRequestMessage] = useState("");
  const [orderRequestLoading, setOrderRequestLoading] = useState(false);
  const [contractActionLoading, setContractActionLoading] = useState(false);
  const [contractActionError, setContractActionError] = useState("");
  const [contractActionMessage, setContractActionMessage] = useState("");
  const [contractActionOrderId, setContractActionOrderId] = useState(null);
  const [showContractModal, setShowContractModal] = useState(false);
  const [contractPreviewOrder, setContractPreviewOrder] = useState(null);
  const [contractNotificationRecordId, setContractNotificationRecordId] = useState(null);
  const autoOpenedContractRef = useRef("");
  const landingResumeAttemptRef = useRef("");
  const pendingLandingActionIdRef = useRef("");
  const resumeProductRefreshRef = useRef(null);
  const [contractConfirmModal, setContractConfirmModal] = useState({
    open: false,
    action: null,
    orderId: null,
  });
  const [showOrderReviewModal, setShowOrderReviewModal] = useState(false);
  const [showBatchOrderModal, setShowBatchOrderModal] = useState(false);
  const [showBatchOrderConfirmModal, setShowBatchOrderConfirmModal] = useState(false);
  const [batchOrderAgreed, setBatchOrderAgreed] = useState(false);
  const [showBatchSuccessModal, setShowBatchSuccessModal] = useState(false);
  const [batchSuccessItemCount, setBatchSuccessItemCount] = useState(0);
  const [batchSuccessItems, setBatchSuccessItems] = useState([]);
  const [paymentProofOpenOrderId, setPaymentProofOpenOrderId] = useState(null);
  const [paymentProofForm, setPaymentProofForm] = useState({ amount: "", fileName: "" });
  const [paymentProofError, setPaymentProofError] = useState("");
  const [paymentProofLoading, setPaymentProofLoading] = useState(false);
  const [paymentProofSuccessByOrder, setPaymentProofSuccessByOrder] = useState({});
  const [customerPaymentProofPreview, setCustomerPaymentProofPreview] = useState(null);
  const [adminPaymentDocumentLoadingId, setAdminPaymentDocumentLoadingId] = useState("");
  const paymentProofSubmittingRef = useRef(false);

  useEffect(() => {
    const previewUrl = customerPaymentProofPreview?.url;
    if (!previewUrl?.startsWith("blob:")) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [customerPaymentProofPreview?.url]);
  const [showCustomerReviewModal, setShowCustomerReviewModal] = useState(false);
  const [reviewDetailsOrder, setReviewDetailsOrder] = useState(null);
  const [reviewPhotoPreview, setReviewPhotoPreview] = useState(null);
  const [selectedReviewRatingTab, setSelectedReviewRatingTab] = useState(0);
  const [reviewOrderMode, setReviewOrderMode] = useState("estimate");
  const [orderReviewAgreed, setOrderReviewAgreed] = useState(false);
  const [orderReviewForm, setOrderReviewForm] = useState({
    rating: 0,
    comment: "",
    photos: [],
    photoPreviews: [],
  });
  const [selectedReviewTopics, setSelectedReviewTopics] = useState([]);
  const [generatedReviewSuggestions, setGeneratedReviewSuggestions] = useState({});
  const [reviewFormError, setReviewFormError] = useState("");
  const [reviewFormLoading, setReviewFormLoading] = useState(false);
  const reviewSubmitInFlightRef = useRef(false);
  const [reviewPhotoUploading, setReviewPhotoUploading] = useState(false);
  const [selectedReviewOrder, setSelectedReviewOrder] = useState(null);
  const [batchReviewSession, setBatchReviewSession] = useState(null);
  const [estimateFlowType, setEstimateFlowType] = useState(null);
  const [showDeliveryConfirmModal, setShowDeliveryConfirmModal] = useState(false);
  const [resumeProductRefreshing, setResumeProductRefreshing] = useState(false);
  const [resumeProductRefreshError, setResumeProductRefreshError] = useState("");
  const [deliveryConfirmMode, setDeliveryConfirmMode] = useState("estimate");
  const [deliveryConfirmForm, setDeliveryConfirmForm] = useState({
    phone: "",
    shipping_address: "",
    street_address: "",
    city: "",
    province: "",
    zip_code: "",
  });
  const [deliveryConfirmNotes, setDeliveryConfirmNotes] = useState("");
  const [deliveryConfirmError, setDeliveryConfirmError] = useState("");
  const [showOrderNowModal, setShowOrderNowModal] = useState(false);
  const [orderNowProduct, setOrderNowProduct] = useState(null);
  const [orderNowQuantity, setOrderNowQuantity] = useState(1);
  const [orderNowExtraCharges, setOrderNowExtraCharges] = useState([]);
  const [showCustomerExitConfirm, setShowCustomerExitConfirm] = useState(false);
  const pendingCustomerExitRef = useRef(null);
  const [cancelRequestModal, setCancelRequestModal] = useState({ open: false, order: null });
  const [cancelRequestReason, setCancelRequestReason] = useState("");
  const [cancelRequestReasonError, setCancelRequestReasonError] = useState("");
  const estimateFormBaselineRef = useRef("");
  const deliveryFormBaselineRef = useRef("");
  const orderNowBaselineRef = useRef("");
  const customerReviewBaselineRef = useRef("");
  const batchOrderBaselineRef = useRef("");
  const paymentProofBaselineRef = useRef("");
  const productDetailsBaselineRef = useRef("");
  const productDetailsDirtyRef = useRef(false);
  const [showOrderSuccessModal, setShowOrderSuccessModal] = useState(false);
  const [orderSuccessData, setOrderSuccessData] = useState(null);
  const orderSuccessDialogRef = useRef(null);
  const orderSuccessPrimaryButtonRef = useRef(null);
  const orderSuccessDialogOpen = showBatchSuccessModal || (showOrderSuccessModal && Boolean(orderSuccessData));

  useEffect(() => {
    if (!orderSuccessDialogOpen) return undefined;
    const previouslyFocusedElement = document.activeElement;
    orderSuccessPrimaryButtonRef.current?.focus();
    return () => {
      if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus();
    };
  }, [orderSuccessDialogOpen]);

  const trapOrderSuccessDialogFocus = (event) => {
    if (event.key !== "Tab") return;
    const dialog = orderSuccessDialogRef.current;
    if (!dialog) return;
    const focusableElements = Array.from(dialog.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
    if (!focusableElements.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const getProductDetailsDraftSnapshot = (form = {}) => createUnsavedSnapshot({
    unit: form.unit,
    width: form.width,
    height: form.height,
    // The estimator treats an empty/invalid quantity as 1, so match that
    // calculation here and avoid marking a cleared "1" input as a change.
    quantity: Math.max(1, Number(form.quantity) || 1),
    blade_glass_type: form.blade_glass_type,
    piece_option: form.piece_option,
    area_option: form.area_option,
    sale_mode: form.sale_mode,
    frame_type: form.frame_type,
    frame_blade_count: form.frame_blade_count,
    custom_frame_size: form.custom_frame_size,
    blade_count: form.blade_count,
    extra_charges: form.extra_charges,
  });

  useEffect(() => {
    if (showCartDecisionModal) estimateFormBaselineRef.current = createUnsavedSnapshot(estimateForm);
  }, [showCartDecisionModal]);
  useEffect(() => {
    if (showDeliveryConfirmModal) deliveryFormBaselineRef.current = createUnsavedSnapshot({ form: deliveryConfirmForm, notes: deliveryConfirmNotes });
  }, [showDeliveryConfirmModal]);
  useEffect(() => {
    if (showOrderNowModal) orderNowBaselineRef.current = createUnsavedSnapshot({ quantity: orderNowQuantity, extraCharges: orderNowExtraCharges });
  }, [showOrderNowModal]);
  useEffect(() => {
    if (showCustomerReviewModal) customerReviewBaselineRef.current = createUnsavedSnapshot({ form: orderReviewForm, topics: selectedReviewTopics });
  }, [showCustomerReviewModal]);
  useEffect(() => {
    if (showBatchOrderModal) batchOrderBaselineRef.current = createUnsavedSnapshot(batchOrderForm);
  }, [showBatchOrderModal]);

  const requestCustomerExit = (hasChanges, onDiscard) => {
    if (!hasChanges) {
      onDiscard();
      return;
    }
    pendingCustomerExitRef.current = onDiscard;
    setShowCustomerExitConfirm(true);
  };
  const discardCustomerChanges = () => {
    const discard = pendingCustomerExitRef.current;
    pendingCustomerExitRef.current = null;
    setShowCustomerExitConfirm(false);
    discard?.();
  };

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== "Escape" || showCustomerExitConfirm) return;
      if (reviewPhotoPreview) {
        event.preventDefault();
        setReviewPhotoPreview(null);
      } else
      if (showCustomerReviewModal) {
        event.preventDefault();
        requestCloseCustomerReviewModal();
      } else if (showDeliveryConfirmModal) {
        event.preventDefault();
        handleCancelDeliveryConfirm();
      } else if (showOrderNowModal) {
        event.preventDefault();
        requestCloseOrderNowModal();
      } else if (showCartDecisionModal) {
        event.preventDefault();
        requestCloseCartDecisionModal();
      } else if (cancelRequestModal.open) {
        event.preventDefault();
        requestCloseCancelRequest();
      } else if (showBatchOrderModal) {
        event.preventDefault();
        requestCloseBatchOrder();
      } else if (paymentProofOpenOrderId) {
        event.preventDefault();
        requestClosePaymentProofForm();
      } else if (selectedProduct) {
        event.preventDefault();
        requestCloseProductModal();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showCustomerExitConfirm, reviewPhotoPreview, showCustomerReviewModal, showDeliveryConfirmModal, showOrderNowModal, showCartDecisionModal, showBatchOrderModal, cancelRequestModal.open, cancelRequestReason, paymentProofOpenOrderId, paymentProofForm, selectedProduct, productEstimatorForm, orderReviewForm, selectedReviewTopics, deliveryConfirmForm, deliveryConfirmNotes, orderNowQuantity, orderNowExtraCharges, estimateForm, batchOrderForm]);
  const [cancelRequestSubmitting, setCancelRequestSubmitting] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [installationBillingByOrder, setInstallationBillingByOrder] = useState({});
  const [selectedExtraChargeReceipt, setSelectedExtraChargeReceipt] = useState(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState(null);
  const validOrderFilters = ["all", "order", "pending", "review", "completed", "reviewed", "repair", "cancel"];
  const [orderFilter, setOrderFilter] = useState(() => {
    const filter = initialDashboardParams.get("orderFilter");
    return validOrderFilters.includes(filter) ? filter : "all";
  });
  const [orderPage, setOrderPage] = useState(() => Math.max(1, Number(initialDashboardParams.get("orderPage")) || 1));
  const [orderViewMode, setOrderViewMode] = useState("view2");
  const [selectedOrderForModal, setSelectedOrderForModal] = useState(null);
  const [timelineNotificationTarget, setTimelineNotificationTarget] = useState(null);
  const [contractSummaryExpanded, setContractSummaryExpanded] = useState(true);
  const [contractHistoryTab, setContractHistoryTab] = useState(() => initialDashboardParams.get("contractFilter") === "rejected" ? "rejected" : "accepted");
  const [contractPage, setContractPage] = useState(() => Math.max(1, Number(initialDashboardParams.get("contractPage")) || 1));
  const [warrantyHistoryTab, setWarrantyHistoryTab] = useState(() => ["active", "expired"].includes(initialDashboardParams.get("warrantyTab")) ? initialDashboardParams.get("warrantyTab") : null);

  const handleInstallationBillingLoaded = useCallback((orderId, billing) => {
    if (!orderId) return;
    setInstallationBillingByOrder((current) => ({ ...current, [String(orderId)]: billing }));
  }, []);

  const openExtraChargeReceipt = (receipt, billing, order) => {
    if (!receipt) return;
    if (receipt.receipt_type === "Project Payment Receipt") {
      setSelectedExtraChargeReceipt(addProjectPaymentReceiptContext(receipt, { ...order, project_items: billing?.project_items }));
      return;
    }
    const refId = (value) => String(value && typeof value === "object" ? value._id || value.id || "" : value || "");
    const charge = (billing.charges || []).find((entry) => (
      refId(entry._id) === refId(receipt.extra_charge) || refId(entry.receipt) === refId(receipt._id)
    ));
    const payments = charge?.payments || [];
    const verifiedAmount = payments
      .filter((payment) => payment.status === "verified")
      .reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const total = Number(receipt.total || charge?.total || 0);
    setSelectedExtraChargeReceipt({
      ...addExtraChargeReceiptContext(receipt, { ...order, project_items: billing.project_items }, billing.charges || []),
      payment_status: verifiedAmount >= total ? "Paid" : verifiedAmount > 0 ? "Partially Paid" : "Unpaid",
      payments,
    });
  };

  const openLatestExtraChargeReceipt = (billing, order) => {
    const receipts = [...(Array.isArray(billing?.receipts) ? billing.receipts : []), ...(Array.isArray(billing?.project_receipts) ? billing.project_receipts : [])];
    const latestReceipt = [...receipts].sort((left, right) => {
      const leftDate = new Date(left.issued_at || left.createdAt || left.created_at || 0).getTime();
      const rightDate = new Date(right.issued_at || right.createdAt || right.created_at || 0).getTime();
      return rightDate - leftDate;
    })[0];
    if (!latestReceipt) return;
    openExtraChargeReceipt(latestReceipt, billing, order);
  };

  const commitCartItems = (updater) => {
    if (!cartLoaded) throw new Error("Your cart is still loading. Please try again.");

    const mutationVersion = ++cartMutationVersionRef.current;
    const nextItems = typeof updater === "function" ? updater(cartItemsRef.current) : updater;
    setCartActionError("");
    cartItemsRef.current = nextItems;
    setCartItems(nextItems);
    try {
      localStorage.setItem("customerCart", JSON.stringify(nextItems));
    } catch (error) {
      console.warn("Unable to cache cart locally.", error);
    }

    const saveRequest = cartSaveQueueRef.current
      .catch(() => {})
      .then(async () => {
        const response = await saveCart(nextItems);
        if (mutationVersion === cartMutationVersionRef.current) {
          const savedItems = Array.isArray(response.items) ? response.items : nextItems;
          cartItemsRef.current = savedItems;
          setCartItems(savedItems);
          try {
            localStorage.setItem("customerCart", JSON.stringify(savedItems));
          } catch (error) {
            console.warn("Unable to cache the saved cart locally.", error);
          }
        }
        return response;
      });
    cartSaveQueueRef.current = saveRequest;
    return saveRequest;
  };

  const reportCartSaveError = (error) => {
    console.warn("Unable to save cart to backend.", error);
    setCartActionError("Your cart change could not be saved. Please try again.");
    toast.error("Unable to save your cart.");
  };

  const persistCartMutation = (updater) => {
    setCartActionError("");
    commitCartItems(updater).catch(reportCartSaveError);
  };

  const hasCustomerAcceptedContract = (order) => {
    if (order?.acceptedByCustomer === true) return true;
    return order?.order_type === "walk_in_customer"
      && order?.acceptance_method === "walk_in_signed_contract"
      && Boolean(order?.signed_contract_url)
      && Boolean(order?.contract_signed_date);
  };

  const customerContracts = orders.filter((order) => {
    const status = normalizeOrderStatusKey(order?.status);
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    const isSent = status === "contract_sent"
      || contractStatus === "sent"
      || (Boolean(order?.contractSentAt) && (status === "contract_accepted" || contractStatus === "accepted"));
    return isSent || hasCustomerAcceptedContract(order);
  });
  const rejectedContracts = orders.filter((order) => {
    const status = normalizeOrderStatusKey(order?.status);
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    return status === "contract_declined" || contractStatus === "declined";
  });
  const contractsInTab = contractHistoryTab === "rejected" ? rejectedContracts : customerContracts;
  const CONTRACT_PAGE_SIZE = 5;
  const contractPageCount = Math.max(1, Math.ceil(contractsInTab.length / CONTRACT_PAGE_SIZE));
  const safeContractPage = Math.min(Math.max(1, contractPage), contractPageCount);
  const paginatedContracts = contractsInTab.slice(
    (safeContractPage - 1) * CONTRACT_PAGE_SIZE,
    safeContractPage * CONTRACT_PAGE_SIZE
  );
  const displayedContracts = isMobile ? contractsInTab : paginatedContracts;

  // Expand batch warranties so each product has its own transaction record.
  const warrantyRecords = orders.flatMap((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const hasItemWarranties = items.some((item) => (
      item.warranty_start_date || item.warranty_expiry_date || item.warranty_status
    ));
    if (hasItemWarranties) {
      return items
        .filter((item) => item.warranty_status !== "no_warranty" && (item.warranty_start_date || item.warranty_expiry_date || item.warranty_status))
        .map((item, index) => ({
          ...order,
          warranty_record_id: `${order._id || order.id}-item-${index}`,
          items: [item],
          warranty_period: item.warranty_period || order.warranty_period,
          warranty_start_date: item.warranty_start_date || order.warranty_start_date,
          warranty_expiry_date: item.warranty_expiry_date || order.warranty_expiry_date,
          warranty_status: item.warranty_status || order.warranty_status,
        }));
    }
    return order.warranty_expiry_date || order.warranty_status
      ? [{ ...order, warranty_record_id: `${order._id || order.id}-order`, items: [items[0] || {}] }]
      : [];
  });
  const activeWarranties = warrantyRecords.filter((order) => {
    if (!order.warranty_expiry_date) return false;
    const expiryDate = new Date(order.warranty_expiry_date);
    const today = new Date();
    const startDate = order.warranty_start_date ? new Date(order.warranty_start_date) : null;
    return expiryDate > today && (!startDate || startDate <= today) && (order.warranty_status?.toLowerCase() === "active" || !order.warranty_status);
  });
  const expiredWarranties = warrantyRecords.filter((order) => {
    if (!order.warranty_expiry_date) return false;
    const expiryDate = new Date(order.warranty_expiry_date);
    const today = new Date();
    return expiryDate <= today || order.warranty_status?.toLowerCase() === "expired";
  });
  const warrantiesInTab = warrantyHistoryTab === "expired" ? expiredWarranties : activeWarranties;

  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingResult, setTrackingResult] = useState(null);

  const [profileForm, setProfileForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    username: "",
    street_address: "",
    city: "",
    province: "",
    zip_code: "",
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const profileFormBaselineRef = useRef(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [emailChangeOpen, setEmailChangeOpen] = useState(false);
  const [usernameChangeOpen, setUsernameChangeOpen] = useState(false);
  const [showEmailChangePassword, setShowEmailChangePassword] = useState(false);
  const [emailChangeSaving, setEmailChangeSaving] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState("");
  const [emailChangeForm, setEmailChangeForm] = useState({ new_email: "", confirm_new_email: "", current_password: "" });
  const [emailVerifyOpen, setEmailVerifyOpen] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [emailVerificationCode, setEmailVerificationCode] = useState("");
  const [emailVerifyError, setEmailVerifyError] = useState("");
  const [emailVerifyMessage, setEmailVerifyMessage] = useState("");
  const [emailVerifyLoading, setEmailVerifyLoading] = useState(false);
  const [emailResending, setEmailResending] = useState(false);
  const [emailResendCooldown, setEmailResendCooldown] = useState(0);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState("all");
  const [notificationPage, setNotificationPage] = useState(1);
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(CUSTOMER_READ_NOTIFICATIONS_KEY) || "[]"));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    const synchronizeReadNotifications = (event) => {
      if (event.key !== CUSTOMER_READ_NOTIFICATIONS_KEY) return;
      try {
        setReadNotificationIds(new Set(JSON.parse(event.newValue || "[]")));
      } catch {
        setReadNotificationIds(new Set());
      }
    };
    window.addEventListener("storage", synchronizeReadNotifications);
    return () => window.removeEventListener("storage", synchronizeReadNotifications);
  }, []);
  const [profileTab, setProfileTab] = useState(() => initialDashboardParams.get("profileTab") === "security" ? "security" : "profile");
  const [profileEditing, setProfileEditing] = useState(false);
  const [showDiscardProfileChanges, setShowDiscardProfileChanges] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordModalError, setPasswordModalError] = useState("");
  const [permissionNotice, setPermissionNotice] = useState(null);
  const [maintenanceCountdown, setMaintenanceCountdown] = useState(10);
  const permissionNoticeTimer = useRef(null);

  useEffect(() => {
    if (!checkoutMessage) return undefined;
    const fadeTimer = window.setTimeout(() => setCheckoutMessageFading(true), 5000);
    const dismissTimer = window.setTimeout(() => setCheckoutMessage(""), 5500);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [checkoutMessage]);
  const customerNotificationItems = [...orders.flatMap((order) => {
    const orderId = order._id || order.id || order.tracking;
    const status = normalizeOrderStatusKey(order?.status);
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    const hasPendingContractNotification = status === "contract_sent" || contractStatus === "sent";
    const contractVersion = order.contractVersion || order.currentContractVersion || order.contractId || order.contract_number || "current";
    const notifications = [{
      ...order,
      notificationType: hasPendingContractNotification ? "contract" : "order",
      notificationId: hasPendingContractNotification ? `${orderId}-contract-${contractVersion}` : orderId,
      notificationDate: hasPendingContractNotification
        ? order.contractSentAt || order.contractGeneratedAt || order.updatedAt || order.createdAt
        : order.updatedAt || order.createdAt,
    }];

    if (canAccessCustomerRatings && isOrderCompletedAndReviewable(order) && Array.isArray(order.items)) {
      const reviewableItemIndexes = order.items.length > 1
        ? order.items.map((_, index) => index)
        : order.items.length === 1 ? [0] : [];

      reviewableItemIndexes.forEach((itemIndex) => {
        const item = order.items[itemIndex];
        const hasSubmittedReview = order.items.length > 1
          ? Boolean(item?.review?.submittedAt)
          : Boolean(order.review?.submittedAt || item?.review?.submittedAt);
        if (hasSubmittedReview) return;

        const productName = item?.name || item?.product_name || `Product ${itemIndex + 1}`;
        notifications.unshift({
          ...order,
          notificationType: "product_ready_for_review",
          notificationId: `${orderId}-product-ready-for-review-${itemIndex}`,
          notificationDate: order.updatedAt || order.completed_at || order.createdAt,
          reviewItemIndex: order.items.length > 1 ? itemIndex : null,
          reviewProductName: productName,
          title: "Product Ready for Review",
          message: `${productName} is complete. Share your feedback about this product.`,
        });
      });
    }

    if (order.transaction_approved === true && order.transaction_approved_at) {
      notifications.unshift({
        ...order,
        notificationType: "transaction_approved",
        notificationId: `${orderId}-transaction-approved-${new Date(order.transaction_approved_at).getTime()}`,
        notificationDate: order.transaction_approved_at,
      });
    }

    if (Array.isArray(order.payment_records) && order.payment_records.length > 0) {
      const unresolvedPaymentRecords = new Set(getUnresolvedPaymentProofRecords(order));
      order.payment_records.forEach((record) => {
        const recordId = record._id || `${new Date(record.submitted_at || record.createdAt || 0).getTime()}`;
        (record.discrepancies || []).forEach((discrepancy) => {
          const discrepancyId = discrepancy._id || `${recordId}-${new Date(discrepancy.detected_at || 0).getTime()}`;
          const latestStatusChange = discrepancy.status_history?.at(-1);
          notifications.unshift({
            ...order,
            paymentRecord: record,
            paymentDiscrepancy: discrepancy,
            notificationType: discrepancy.status === "resolved" ? "payment_discrepancy_resolved" : "payment_discrepancy",
            notificationId: `${orderId}-payment-${recordId}-discrepancy-${discrepancyId}-${discrepancy.status}`,
            notificationDate: discrepancy.status === "resolved"
              ? discrepancy.resolved_at || latestStatusChange?.changed_at || discrepancy.detected_at
              : latestStatusChange?.changed_at || discrepancy.detected_at,
          });
        });
        if (record.status === "pending") {
          if (!unresolvedPaymentRecords.has(record)) return;
          if (record.downpayment_exception?.status !== "pending") {
            notifications.unshift({
              ...order,
              paymentRecord: record,
              notificationType: "payment",
              notificationId: `${orderId}-payment-${recordId}-submitted`,
              notificationDate: record.submitted_at || record.createdAt,
            });
          } else {
            notifications.unshift({
              ...order,
              paymentRecord: record,
              notificationType: "downpayment_exception_pending",
              notificationId: `${orderId}-payment-${recordId}-exception-pending-${new Date(record.downpayment_exception.requested_at || 0).getTime()}`,
              notificationDate: record.downpayment_exception.requested_at || record.updatedAt,
            });
          }
        } else if (record.status === "rejected") {
          notifications.unshift({
            ...order,
            paymentRecord: record,
            notificationType: "payment_rejected",
            notificationId: `${orderId}-payment-${recordId}-rejected-${new Date(record.rejected_at || 0).getTime()}`,
            notificationDate: record.rejected_at || record.updatedAt,
          });
        } else if (record.status === "verified") {
          const adjustments = Array.isArray(record.amount_history) ? record.amount_history : [];
          if (record.record_source === "admin_recorded") {
            notifications.unshift({
              ...order,
              paymentRecord: record,
              notificationType: "admin_payment_recorded",
              notificationId: `${orderId}-payment-${recordId}-admin-recorded-${new Date(record.recorded_at || record.verified_at || 0).getTime()}`,
              notificationDate: record.recorded_at || record.verified_at || record.updatedAt,
            });
          } else if (adjustments.length > 0 && !(record.discrepancies || []).length) {
            adjustments.forEach((adjustment, adjustmentIndex) => {
              notifications.unshift({
                ...order,
                paymentRecord: record,
                paymentAdjustment: adjustment,
                notificationType: "payment_amount_updated",
                notificationId: `${orderId}-payment-${recordId}-adjusted-${new Date(adjustment.changed_at || 0).getTime()}-${adjustmentIndex}`,
                notificationDate: adjustment.changed_at || record.verified_at,
              });
            });
          } else if (record.downpayment_exception?.status !== "approved") {
            notifications.unshift({
              ...order,
              paymentRecord: record,
              notificationType: "payment_confirmed",
              notificationId: `${orderId}-payment-${recordId}-verified-${new Date(record.verified_at || 0).getTime()}`,
              notificationDate: record.verified_at || record.updatedAt,
            });
          }
          if (record.downpayment_exception?.status === "approved") {
            notifications.unshift({
              ...order,
              paymentRecord: record,
              notificationType: "downpayment_exception_approved",
              notificationId: `${orderId}-payment-${recordId}-exception-approved-${new Date(record.downpayment_exception.approved_at || record.verified_at || 0).getTime()}`,
              notificationDate: record.downpayment_exception.approved_at || record.verified_at || record.updatedAt,
            });
          }
        }
      });
    } else if (order.payment_proof_submitted_at) {
      notifications.unshift({
        ...order,
        notificationType: "payment",
        notificationId: `${orderId}-payment-${new Date(order.payment_proof_submitted_at).getTime()}`,
        notificationDate: order.payment_proof_submitted_at,
      });

      if (order.payment_proof_confirmed_at) {
        notifications.unshift({
          ...order,
          notificationType: "payment_confirmed",
          notificationId: `${orderId}-payment-confirmed-${new Date(order.payment_proof_confirmed_at).getTime()}`,
          notificationDate: order.payment_proof_confirmed_at,
        });
      }
    }

    const installationNotifications = (order.customer_notifications || [])
      .filter((notification) => {
        if (notification.type !== "installation_up_next") return true;
        if (status === "cancelled") return false;

        const stages = Number.isInteger(notification.itemIndex)
          ? order.items?.[notification.itemIndex]?.progress_stages || []
          : order.progress_stages || [];
        const installationIndex = stages.findIndex((stage) => (
          [stage.key, stage.name].some((value) => {
            const normalizedValue = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
            return normalizedValue === "installation" || normalizedValue.startsWith("installation_");
          })
        ));
        if (installationIndex < 0) return false;

        const installationStage = stages[installationIndex];
        const installationStatus = String(installationStage.status || "").toLowerCase();
        const installationHasStarted = Boolean(installationStage.installationStartedAt) ||
          ["in_progress", "in-progress", "active", "current", "done", "completed"].includes(String(installationStage.status || "").toLowerCase()) ||
          installationStage.completed === true;
        if (installationHasStarted) return true;
        if (["delayed", "on_hold"].includes(installationStatus)) return false;

        return stages.slice(0, installationIndex).every((stage) => {
          const stageDone = stage.completed === true || ["done", "completed"].includes(String(stage.status || "").toLowerCase());
          const subStages = Array.isArray(stage.subStages) ? stage.subStages : [];
          return stageDone && subStages.every((subStage) =>
            subStage.completed === true || ["done", "completed"].includes(String(subStage.status || "").toLowerCase())
          );
        });
      })
      .map((notification) => ({
        ...order,
        notificationType: notification.type,
        notificationId: String(notification._id),
        notificationDate: notification.createdAt,
        title: notification.title,
        message: notification.message,
        stageKey: notification.stageKey,
        stageName: notification.stageName,
        receiptId: notification.receipt ? String(notification.receipt._id || notification.receipt) : "",
        projectReceiptId: notification.project_receipt ? String(notification.project_receipt._id || notification.project_receipt) : "",
        itemIndex: notification.itemIndex,
        completedAt: notification.completedAt,
        installationProductName: notification.productName || (
          Number.isInteger(notification.itemIndex) ? order.items?.[notification.itemIndex]?.name : order.items?.[0]?.name
        ) || "your project",
      }));

    return [...notifications, ...installationNotifications, ...buildDelayNotifications(order)];
  }), ...repairRequests.flatMap((repair) => {
    const eventTitles = {
      pending_review: "Repair request received",
      admin_approved: "Warranty claim approved",
      rejected: "Warranty claim rejected",
      quotation_issued: "Repair quotation ready",
      customer_accepted: "Quotation accepted",
      payment_proof_submitted: "Payment proof submitted",
      payment_proof_approved: "Repair payment verified",
      payment_proof_rejected: "Payment proof needs correction",
      payment_verified: "Repair payment verified",
      receipt_issued: "Repair receipt issued",
      quotation_declined: "Quotation declined",
      scheduled: "Repair visit scheduled",
      in_progress: "Repair in progress",
      completed: "Repair completed",
    };
    const eventStatuses = {
      pending_review: "Pending Review",
      admin_approved: "Warranty Approved",
      rejected: "Repair Rejected",
      quotation_issued: "Quotation Ready",
      customer_accepted: "Quotation Accepted",
      quotation_declined: "Quotation Declined",
      payment_proof_submitted: "Payment Review",
      payment_proof_approved: "Payment Verified",
      payment_proof_rejected: "Action Needed",
      payment_verified: "Payment Verified",
      receipt_issued: "Receipt Available",
      cancelled: "Cancelled",
      scheduled: "Scheduled",
      in_progress: "In Progress",
      completed: "Completed",
    };
    const productName = repair.productName || "your product";
    const requestType = repair.workflowType === "warranty" ? "warranty claim" : "paid repair request";
    const history = repair.history?.length ? repair.history : [{
      event: "pending_review",
      createdAt: repair.requestedAt || repair.createdAt,
    }];

    return history.map((entry, index) => {
      const eventMessages = {
        pending_review: `Your ${requestType} for ${productName} was received and is pending review.`,
        admin_approved: "Your warranty claim was approved. The repair will be provided at no charge.",
        rejected: `Your warranty repair request for ${productName} was rejected after inspection. ${repair.warranty?.decisionReason || "Please contact ACGC if you have questions."}`,
        quotation_issued: `A quotation of PHP ${Number(repair.quotation?.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for ${productName} is ready for your review.`,
        quotation_declined: "You declined the repair quotation. Your repair ticket, inspection findings, and quotation have been kept for reference.",
        customer_accepted: `You accepted the repair quotation${repair.payment?.method ? ` and selected ${String(repair.payment.method).replaceAll("_", " ")}` : ""}.`,
        payment_proof_submitted: "Your payment proof was submitted and is waiting for admin review.",
        payment_proof_approved: entry.detail || "Your repair payment proof was verified by the admin.",
        payment_verified: entry.detail || `An administrator verified your repair payment. Remaining balance: PHP ${Math.max(0, Number(repair.quotation?.total || 0) - Number(repair.payment?.verifiedAmount || 0)).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
        receipt_issued: `Receipt ${repair.receipt?.number || repair.invoiceNumber || ""} is available for your repair.`,
        payment_proof_rejected: `Your payment proof needs correction. ${repair.payment?.proofRejectionReason || "Please review the request and submit a corrected proof."}`,
        scheduled: `Your repair visit is scheduled${repair.schedule?.date ? ` for ${new Date(repair.schedule.date).toLocaleString("en-PH")}` : ""}${repair.schedule?.technician ? ` with ${repair.schedule.technician}` : ""}.`,
        in_progress: `Work on your repair for ${productName} is in progress.`,
        completed: `Your repair for ${productName} is complete${repair.receipt?.number ? `. Receipt ${repair.receipt.number} is available` : ""}.`,
      };

      return {
        _id: repair.order,
        items: [{ name: productName }],
        tracking: repair.orderTracking,
        status: "completed",
        repairProgressStatus: eventStatuses[entry.event] || "Repair Update",
        notificationType: "repair_request",
        notificationId: `repair-${repair._id}-${entry.event}-${entry.createdAt ? new Date(entry.createdAt).getTime() : index}-${index}`,
        notificationDate: entry.createdAt || repair.requestedAt || repair.createdAt,
        title: eventTitles[entry.event] || "Repair request updated",
        message: eventMessages[entry.event] || entry.detail || `There is an update to your repair request for ${productName}.`,
      };
    });
  })];
  const unreadNotificationCount = customerNotificationItems.filter((notification) => !readNotificationIds.has(notification.notificationId)).length;
  const readNotificationCount = customerNotificationItems.length - unreadNotificationCount;
  const filteredNotifications = customerNotificationItems.filter((notification) => {
    const isRead = readNotificationIds.has(notification.notificationId);
    return notificationFilter === "all" || (notificationFilter === "unread" ? !isRead : isRead);
  });
  const notificationPageSize = 10;
  const sortedFilteredNotifications = [...filteredNotifications].sort(sortCustomerNotificationsNewestFirst);
  const notificationTotalPages = Math.max(1, Math.ceil(sortedFilteredNotifications.length / notificationPageSize));
  const currentNotificationPage = Math.min(notificationPage, notificationTotalPages);
  const paginatedCustomerNotifications = sortedFilteredNotifications.slice(
    (currentNotificationPage - 1) * notificationPageSize,
    currentNotificationPage * notificationPageSize,
  );

  const markAllCustomerNotificationsRead = () => {
    const nextReadNotificationIds = new Set(readNotificationIds);
    customerNotificationItems.forEach((notification) => nextReadNotificationIds.add(notification.notificationId));
    setReadNotificationIds(nextReadNotificationIds);
    localStorage.setItem(CUSTOMER_READ_NOTIFICATIONS_KEY, JSON.stringify([...nextReadNotificationIds]));
  };

  const markCustomerNotificationRead = (notificationId) => {
    if (!notificationId || readNotificationIds.has(notificationId)) return;
    const nextReadNotificationIds = new Set(readNotificationIds);
    nextReadNotificationIds.add(notificationId);
    setReadNotificationIds(nextReadNotificationIds);
    localStorage.setItem(CUSTOMER_READ_NOTIFICATIONS_KEY, JSON.stringify([...nextReadNotificationIds]));
  };

  useEffect(() => {
    getSystemSettings()
      .then((response) => {
        const enabled = response.maintenance_mode === true;
        setMaintenanceMode(enabled);
        if (enabled) showPermissionNotice("The system is under maintenance. Please log out and try again later.", { maintenance: true });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    let active = true;
    const checkMaintenanceMode = async () => {
      try {
        const response = await getSystemSettings();
        if (!active) return;
        const enabled = response.maintenance_mode === true;
        setMaintenanceMode(enabled);
        if (enabled) {
          showPermissionNotice("The system is under maintenance. Please log out and try again later.", { maintenance: true });
        } else {
          setPermissionNotice((current) => (current?.maintenance ? null : current));
        }
      } catch {}
    };
    const interval = window.setInterval(checkMaintenanceMode, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user?.id]);

  const showPermissionNotice = (message, options = {}) => {
    if (permissionNoticeTimer.current) {
      clearTimeout(permissionNoticeTimer.current);
    }

    setPermissionNotice((current) => {
      if (current?.maintenance && options.maintenance) return current;
      return { message, maintenance: options.maintenance === true, closing: false };
    });
    if (options.maintenance) {
      setMaintenanceCountdown(10);
      return;
    }
    permissionNoticeTimer.current = setTimeout(() => {
      setPermissionNotice((current) => (current ? { ...current, closing: true } : current));
      permissionNoticeTimer.current = setTimeout(() => setPermissionNotice(null), 350);
    }, 2400);
  };

  useEffect(() => () => {
    if (permissionNoticeTimer.current) clearTimeout(permissionNoticeTimer.current);
  }, []);

  const handleLogoutConfirm = () => {
    logout();
    setConfirmOpen(false);
    navigate("/login");
  };

  useEffect(() => {
    if (!permissionNotice?.maintenance) return undefined;

    setMaintenanceCountdown(5);
    const countdownTimer = setInterval(() => {
      setMaintenanceCountdown((current) => {
        if (current <= 1) {
          clearInterval(countdownTimer);
          handleLogoutConfirm();
          return 0;
        }
        return current - 1;
      });
    }, 1800);

    return () => clearInterval(countdownTimer);
  }, [permissionNotice?.maintenance]);

  useEffect(() => {
    if (user) {
      const savedProfile = createCustomerProfileDraft(user);
      profileFormBaselineRef.current = savedProfile;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileForm(savedProfile);
      setDeliveryConfirmForm({
        phone: user.phone || "",
        shipping_address: buildFullAddress(user),
        street_address: user.street_address || "",
        city: user.city || "",
        province: user.province || "",
        zip_code: user.zip_code || "",
      });
    }
  }, [user]);

  useEffect(() => {
    if (!loading && user && user.role !== "customer") {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return undefined;

    let active = true;
    const loadCart = async () => {
      const mutationVersion = cartMutationVersionRef.current;
      try {
        const response = await getCart();
        if (!active || mutationVersion !== cartMutationVersionRef.current) return;
        const loadedItems =
          Array.isArray(response.items)
            ? response.items.map((item) => ({
                ...item,
                quantity: Math.max(1, Number(item.quantity) || 1),
                selected: item.selected !== false,
              }))
            : [];
        cartItemsRef.current = loadedItems;
        setCartItems(loadedItems);
        setCartActionError("");
        try {
          localStorage.setItem("customerCart", JSON.stringify(loadedItems));
        } catch (storageError) {
          console.warn("Unable to cache the loaded cart locally.", storageError);
        }
      } catch (error) {
        if (!active || mutationVersion !== cartMutationVersionRef.current) return;
        cartItemsRef.current = [];
        setCartItems([]);
        setCartActionError("Unable to load your saved cart. Reconnect and refresh to try again.");
        try {
          localStorage.removeItem("customerCart");
        } catch (storageError) {
          console.warn("Unable to clear the unverified cart cache.", storageError);
        }
        console.warn("Unable to load the saved cart from the backend.", error);
      } finally {
        if (active) setCartLoaded(true);
      }
    };

    loadCart();
    const unsubscribeRealtime = subscribeToRealtime("cart", () => {
      if (document.visibilityState === "visible") loadCart();
    });
    return () => {
      active = false;
      unsubscribeRealtime();
    };
  }, [user]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (lastCustomerSearchRef.current !== location.search) {
      lastCustomerSearchRef.current = location.search;
      restoringCustomerLocationRef.current = true;
      const tab = params.get("tab");
      setActiveTab(validCustomerTabs.includes(tab) ? tab : "home");
      const restoredFilters = {
        searchQuery: params.get("productQ") || "",
        categoryFilter: params.get("productCategory") || "All",
        productTypeFilter: params.get("productType") || "All",
        productsPerPage: params.get("productPerPage") === "all"
          ? 0
          : [4, 8, 12, 16].includes(Number(params.get("productPerPage")))
            ? Number(params.get("productPerPage"))
            : 8,
      };
      browseFiltersRef.current = restoredFilters;
      setSearchQuery(restoredFilters.searchQuery);
      setCategoryFilter(restoredFilters.categoryFilter);
      setProductTypeFilter(restoredFilters.productTypeFilter);
      setProductsPerPage(restoredFilters.productsPerPage);
      setProductPage(Math.max(1, Number(params.get("productPage")) || 1));
      const orderFilterParam = params.get("orderFilter");
      setOrderFilter(validOrderFilters.includes(orderFilterParam) ? orderFilterParam : "all");
      setOrderPage(Math.max(1, Number(params.get("orderPage")) || 1));
      setContractHistoryTab(params.get("contractFilter") === "rejected" ? "rejected" : "accepted");
      setContractPage(Math.max(1, Number(params.get("contractPage")) || 1));
      setWarrantyHistoryTab(["active", "expired"].includes(params.get("warrantyTab")) ? params.get("warrantyTab") : null);
      setProfileTab(params.get("profileTab") === "security" ? "security" : "profile");
      return;
    }

    const stateTab = location.state?.activeTab;
    if (validCustomerTabs.includes(stateTab)) {
      setActiveTab(stateTab);
      navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
    }
  }, [location, navigate]);

  useEffect(() => {
    if (restoringCustomerLocationRef.current) {
      restoringCustomerLocationRef.current = false;
      pushCustomerTabHistoryRef.current = false;
      return;
    }

    const params = new URLSearchParams(location.search);
    if (activeTab === "home") params.delete("tab");
    else params.set("tab", activeTab);
    if (searchQuery.trim()) params.set("productQ", searchQuery.trim());
    else params.delete("productQ");
    if (categoryFilter !== "All") params.set("productCategory", categoryFilter);
    else params.delete("productCategory");
    if (productTypeFilter !== "All") params.set("productType", productTypeFilter);
    else params.delete("productType");
    if (productPage > 1) params.set("productPage", String(productPage));
    else params.delete("productPage");
    if (productsPerPage !== 8) params.set("productPerPage", productsPerPage === 0 ? "all" : String(productsPerPage));
    else params.delete("productPerPage");
    if (orderFilter !== "all") params.set("orderFilter", orderFilter);
    else params.delete("orderFilter");
    if (orderPage > 1) params.set("orderPage", String(orderPage));
    else params.delete("orderPage");
    if (contractHistoryTab !== "accepted") params.set("contractFilter", contractHistoryTab);
    else params.delete("contractFilter");
    if (contractPage > 1) params.set("contractPage", String(contractPage));
    else params.delete("contractPage");
    if (warrantyHistoryTab) params.set("warrantyTab", warrantyHistoryTab);
    else params.delete("warrantyTab");
    if (profileTab !== "profile") params.set("profileTab", profileTab);
    else params.delete("profileTab");

    const nextSearch = params.toString();
    if (nextSearch !== location.search.replace(/^\?/, "")) {
      lastCustomerSearchRef.current = nextSearch ? `?${nextSearch}` : "";
      const replace = !pushCustomerTabHistoryRef.current;
      pushCustomerTabHistoryRef.current = false;
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash}`, { replace });
    } else {
      pushCustomerTabHistoryRef.current = false;
    }
  }, [activeTab, categoryFilter, contractHistoryTab, contractPage, location.hash, location.pathname, location.search, navigate, orderFilter, orderPage, productPage, productTypeFilter, productsPerPage, profileTab, searchQuery, warrantyHistoryTab]);

  const selectedCartItems = cartItems.filter((item) => item.selected);
  const selectedItemCount = selectedCartItems.length;
  const selectedQuantityTotal = selectedCartItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const selectedSubtotal = selectedCartItems.reduce((sum, item) => sum + getItemPriceValue(item), 0);
  const allSelected = cartItems.length > 0 && selectedItemCount === cartItems.length;

  const ratedProductReviews = productReviews.filter((review) => Number(review.rating) > 0);
  const totalRatedReviews = ratedProductReviews.length;

  const productReviewAverageRating = totalRatedReviews
    ? (ratedProductReviews.reduce((sum, review) => sum + Number(review.rating), 0) / totalRatedReviews).toFixed(1)
    : null;

  const averageProductReviewRating = Number(productReviewAverageRating) || 0;

  const reviewRatingCounts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: ratedProductReviews.filter((review) => Math.round(Number(review.rating)) === star).length,
  }));

  const filteredProductReviews = selectedReviewRatingTab
    ? productReviews.filter((review) => Math.round(Number(review.rating || 0)) === selectedReviewRatingTab)
    : productReviews;

  useEffect(() => {
    if (selectedOrderForModal) {
      const contractStatus = selectedOrderForModal.contract_status?.toLowerCase();
      if (contractStatus === "accepted" || contractStatus === "declined") {
        setContractSummaryExpanded(false);
      } else {
        setContractSummaryExpanded(true);
      }
    }
  }, [selectedOrderForModal]);

  function canShowContractForOrder(order) {
    if (!order) return false;

    const status = normalizeOrderStatusKey(order?.status);
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    const contractStageStatus = [
      "contract_sent",
      "contract_accepted",
      "contract_declined",
      "sent",
      "accepted",
      "declined",
    ];

    const hasContractArtifacts = Boolean(
      order.contract_terms ||
      order.contract_amount ||
      order.contract_status ||
      order.contract_number ||
      order.contract_id
    );

    return hasContractArtifacts && (
      contractStageStatus.includes(status) ||
      contractStageStatus.includes(contractStatus)
    );
  }

  const selectedOrderContractStatus = normalizeOrderStatusKey(selectedOrderForModal?.contract_status);
  const selectedOrderStatus = normalizeOrderStatusKey(selectedOrderForModal?.status);
  const selectedOrderHasContractSummary = Boolean(selectedOrderForModal) && canShowContractForOrder(selectedOrderForModal);
  const selectedOrderCanRespondToContract =
    selectedOrderHasContractSummary &&
    (selectedOrderStatus === "contract_sent" || selectedOrderStatus === "site_inspection" || selectedOrderContractStatus === "sent") &&
    !["accepted", "declined"].includes(selectedOrderContractStatus) &&
    !["contract_accepted", "contract_declined", "cancelled"].includes(selectedOrderStatus);

  const isCustomerContractAccepted = (order) => {
    return hasCustomerAcceptedContract(order);
  };

  const getOrderItemReview = (order, itemIndex) => {
    if (!order || !Array.isArray(order.items)) return null;
    if (order.items.length > 1) return order.items[itemIndex]?.review || null;
    return order.review || order.items[itemIndex]?.review || null;
  };

  const getReviewForOrderContext = (order) => (
    Number.isInteger(order?.reviewItemIndex)
      ? getOrderItemReview(order, order.reviewItemIndex)
      : order?.review
  );

  const isOrderReviewEditable = (order, itemIndex = null) => {
    const review = Number.isInteger(itemIndex)
      ? getOrderItemReview(order, itemIndex)
      : getReviewForOrderContext(order);
    if (!review?.submittedAt) return false;
    const submittedAt = new Date(review.submittedAt);
    const editDeadline = new Date(submittedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    return new Date() <= editDeadline;
  };

  const hasOrderReview = (order) => {
    if (Number.isInteger(order?.reviewItemIndex)) {
      return Boolean(getOrderItemReview(order, order.reviewItemIndex)?.submittedAt);
    }
    if (Array.isArray(order?.items) && order.items.length > 1) {
      return order.items.every((_, index) => Boolean(getOrderItemReview(order, index)?.submittedAt));
    }
    return Boolean(order?.review?.submittedAt);
  };

  const hasAnyOrderReview = (order) => Boolean(
    order?.review?.submittedAt ||
    (Array.isArray(order?.items) && order.items.some((_, index) => getOrderItemReview(order, index)?.submittedAt))
  );

  const openCustomerReviewModal = (order, itemIndex = null) => {
    if (!canAccessCustomerRatings) {
      showPermissionNotice("Feedback access is disabled for your account.");
      return;
    }
    const reviewItemIndex = Array.isArray(order?.items) && order.items.length > 1
      ? itemIndex
      : null;
    const existingReview = Number.isInteger(reviewItemIndex)
      ? getOrderItemReview(order, reviewItemIndex) || {}
      : order?.review || {};
    setSelectedReviewOrder({
      ...order,
      reviewItemIndex,
      reviewProductName: Number.isInteger(reviewItemIndex)
        ? order.items[reviewItemIndex]?.name || order.items[reviewItemIndex]?.product_name || "Product"
        : order.items?.[0]?.name || order.items?.[0]?.product_name || "Project",
    });
    setOrderReviewForm({
      rating: existingReview.rating || 0,
      comment: existingReview.comment || "",
      photos: existingReview.photos || [],
      photoPreviews: existingReview.photos || [],
    });
    setSelectedReviewTopics(Array.isArray(existingReview.tags) ? existingReview.tags : []);
    setGeneratedReviewSuggestions({});
    setReviewFormError("");
    setShowCustomerReviewModal(true);
  };

  const openBatchOrderReviewModal = (order) => {
    if (!canAccessCustomerRatings) {
      showPermissionNotice("Feedback access is disabled for your account.");
      return;
    }
    const itemIndexes = (order.items || []).flatMap((_, index) =>
      getOrderItemReview(order, index)?.submittedAt ? [] : [index]
    );
    if (!itemIndexes.length) return;

    setBatchReviewSession({ itemIndexes, currentPosition: 0 });
    openCustomerReviewModal(order, itemIndexes[0]);
  };

  const openOrderReviewDetails = (order, itemIndex = null) => {
    const reviewItemIndex = Array.isArray(order?.items) && order.items.length > 1
      ? itemIndex
      : null;
    const review = Number.isInteger(reviewItemIndex)
      ? getOrderItemReview(order, reviewItemIndex)
      : order?.review || order?.items?.[0]?.review;
    if (!review?.submittedAt) return;

    setReviewDetailsOrder({
      ...order,
      review,
      reviewItemIndex,
      reviewProductName: Number.isInteger(reviewItemIndex)
        ? order.items[reviewItemIndex]?.name || order.items[reviewItemIndex]?.product_name || `Product ${reviewItemIndex + 1}`
        : order.items?.[0]?.name || order.items?.[0]?.product_name || "Project",
    });
  };

  const closeCustomerReviewModal = () => {
    setSelectedReviewOrder(null);
    setBatchReviewSession(null);
    setShowCustomerReviewModal(false);
    setReviewFormError("");
    setOrderReviewForm({ rating: 0, comment: "", photos: [], photoPreviews: [] });
    setSelectedReviewTopics([]);
    setGeneratedReviewSuggestions({});
  };

  const requestCloseCustomerReviewModal = () => requestCustomerExit(
    createUnsavedSnapshot({ form: orderReviewForm, topics: selectedReviewTopics }) !== customerReviewBaselineRef.current,
    closeCustomerReviewModal,
  );

  const handleOrderReviewChange = (field, value) => {
    setOrderReviewForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleReviewTopicToggle = (topic) => {
    const isSelected = selectedReviewTopics.includes(topic.value);
    if (isSelected) {
      setSelectedReviewTopics((current) => current.filter((value) => value !== topic.value));
      const generatedPrompt = generatedReviewSuggestions[topic.value];
      setOrderReviewForm((current) => ({
        ...current,
        comment: removeReviewTopicPrompt(current.comment, generatedPrompt),
      }));
      setGeneratedReviewSuggestions((current) => {
        const next = { ...current };
        delete next[topic.value];
        return next;
      });
      return;
    }

    const prompt = topic.label;
    setSelectedReviewTopics((current) => [...current, topic.value]);
    setGeneratedReviewSuggestions((current) => ({ ...current, [topic.value]: prompt }));
    setOrderReviewForm((current) => ({
      ...current,
      comment: appendReviewTopicPrompt(current.comment, topic.label),
    }));
    setReviewFormError("");
  };

  const handleOrderReviewPhotoChange = async (e) => {
    if (!canAccessCustomerRatings) return;
    const input = e.currentTarget;
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const existingCount = orderReviewForm.photos.length;
    if (existingCount + files.length > 5) {
      setReviewFormError("You may upload up to 5 photos.");
      input.value = "";
      return;
    }
    setReviewPhotoUploading(true);
    setReviewFormError("");
    try {
      const uploads = await uploadFiles(files, undefined, { purpose: "review-photos" });
      if (!uploads.success) {
        throw new Error(uploads.message || "Unable to upload photos.");
      }
      setOrderReviewForm((prev) => ({
        ...prev,
        photos: [...prev.photos, ...(uploads.files || []).map((file) => file.url)],
        photoPreviews: [...prev.photoPreviews, ...(uploads.files || []).map((file) => file.url)],
      }));
    } catch (error) {
      setReviewFormError(error?.data?.message || error?.message || "Unable to upload photos.");
    } finally {
      setReviewPhotoUploading(false);
      input.value = "";
    }
  };

  const handleRemoveReviewPhoto = (index) => {
    setOrderReviewForm((prev) => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index),
      photoPreviews: prev.photoPreviews.filter((_, i) => i !== index),
    }));
  };

  const submitCustomerReview = async () => {
    if (reviewSubmitInFlightRef.current) return;
    if (reviewPhotoUploading) {
      setReviewFormError("Please wait for your photos to finish uploading.");
      return;
    }
    if (!canAccessCustomerRatings) return;
    if (!selectedReviewOrder) return;
    if (!orderReviewForm.rating || orderReviewForm.rating < 1 || orderReviewForm.rating > 5) {
      setReviewFormError("Please select a rating from 1 to 5.");
      return;
    }
    if (getReviewCommentBody(orderReviewForm.comment, selectedReviewTopics).length < 10) {
      setReviewFormError("Comment must be at least 10 characters.");
      return;
    }
    if (orderReviewForm.comment.trim().length > 500) {
      setReviewFormError("Comment cannot exceed 500 characters.");
      return;
    }

    reviewSubmitInFlightRef.current = true;
    setReviewFormLoading(true);
    setReviewFormError("");

    try {
      const payload = {
        rating: orderReviewForm.rating,
        comment: orderReviewForm.comment.trim(),
        tags: selectedReviewTopics,
        photos: orderReviewForm.photos.slice(0, 5),
        ...(Number.isInteger(selectedReviewOrder.reviewItemIndex)
          ? { itemIndex: selectedReviewOrder.reviewItemIndex }
          : {}),
      };
      const response = await submitOrderReview(selectedReviewOrder._id || selectedReviewOrder.id, payload);
      if (response.order) {
        setOrders((prev) => prev.map((order) => (order._id === response.order._id ? response.order : order)));
        if (selectedOrderForModal && (selectedOrderForModal._id || selectedOrderForModal.id) === response.order._id) {
          setSelectedOrderForModal(response.order);
        }

        const nextItemIndex = batchReviewSession?.itemIndexes?.[batchReviewSession.currentPosition + 1];
        if (Number.isInteger(nextItemIndex)) {
          const nextItem = response.order.items[nextItemIndex];
          const nextReview = getOrderItemReview(response.order, nextItemIndex) || {};
          setBatchReviewSession((current) => current ? {
            ...current,
            currentPosition: current.currentPosition + 1,
          } : null);
          setSelectedReviewOrder({
            ...response.order,
            reviewItemIndex: nextItemIndex,
            reviewProductName: nextItem?.name || nextItem?.product_name || "Product",
          });
          setOrderReviewForm({
            rating: nextReview.rating || 0,
            comment: nextReview.comment || "",
            photos: nextReview.photos || [],
            photoPreviews: nextReview.photos || [],
          });
          setSelectedReviewTopics([]);
          setGeneratedReviewSuggestions({});
          toast.success("Review saved. Continue with the next product.");
          return;
        }

        setBatchReviewSession(null);
        setSelectedReviewOrder(response.order);
        toast.success("Thank you for your feedback. Your review has been submitted.");
        closeCustomerReviewModal();
      }
    } catch (error) {
      setReviewFormError(error.data?.message || error.message || "Unable to submit review.");
    } finally {
      reviewSubmitInFlightRef.current = false;
      setReviewFormLoading(false);
    }
  };

  useEffect(() => {
    const previousFilters = browseFiltersRef.current;
    const currentFilters = { searchQuery, categoryFilter, productTypeFilter, productsPerPage };
    const filtersChanged = previousFilters && Object.keys(currentFilters).some(
      (key) => previousFilters[key] !== currentFilters[key]
    );
    browseFiltersRef.current = currentFilters;
    if (filtersChanged) setProductPage(1);
  }, [searchQuery, categoryFilter, productTypeFilter, productsPerPage]);

  useEffect(() => {
    if (loading || !user || !localStorage.getItem("token")) return undefined;

    let active = true;

    const fetchProducts = async () => {
      setIsLoadingProducts(true);
      setProductError("");

      try {
        const response = await getProducts();
        if (!active) return;

        const productsList = (response.products || []).sort(
          (firstProduct, secondProduct) => Number(Boolean(secondProduct.is_featured)) - Number(Boolean(firstProduct.is_featured)),
        );
        setProducts(productsList);
        setIsLoadingProducts(false);

        if (!canAccessCustomerRatings) {
          setProductReviewStats({});
          return;
        }

        const reviewSummaryResponse = await getProductReviewSummaries(
          productsList.slice(0, 12).map((product) => product._id || product.id).filter(Boolean),
        ).catch(() => ({ summaries: {} }));
        const stats = {};
        productsList.slice(0, 12).forEach((product) => {
          const productId = product._id || product.id;
          const summary = reviewSummaryResponse.summaries?.[productId];
          if (!productId) return;
          const ratingCounts = [5, 4, 3, 2, 1].reduce((counts, star) => {
            counts[star] = Math.max(0, Number(summary?.counts?.[star]) || 0);
            return counts;
          }, {});
          const verifiedTotal = [5, 4, 3, 2, 1].reduce((sum, star) => sum + ratingCounts[star] * star, 0);
          const verifiedCount = [5, 4, 3, 2, 1].reduce((sum, star) => sum + ratingCounts[star], 0);
          stats[productId] = {
            averageRating: verifiedCount ? Number((verifiedTotal / verifiedCount).toFixed(1)) : 0,
            ratingsCount: verifiedCount || Math.max(0, Number(summary?.total) || 0),
          };
        });

        if (active) {
          setProductReviewStats(stats);
        }
      } catch (error) {
        if (!active) return;
        setProductError(error.data?.message || error.message || "Unable to load products.");
      } finally {
        if (active) setIsLoadingProducts(false);
      }
    };

    fetchProducts();

    return () => {
      active = false;
    };
  }, [canAccessCustomerRatings, loading, user?.id]);

  useEffect(() => {
    if (loading || !user || !localStorage.getItem("token")) return undefined;

    let active = true;
    let requestInFlight = false;
    const refreshProductPricing = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await getProducts();
        if (!active) return;
        const latestProducts = response.products || [];
        const latestById = new globalThis.Map(latestProducts.map((product) => [String(product._id || product.id), product]));
        const refreshProduct = (currentProduct) => {
          if (!currentProduct) return currentProduct;
          const productId = String(currentProduct._id || currentProduct.id || "");
          return latestById.get(productId) || currentProduct;
        };

        setCartPricingProducts(latestProducts);
        setProducts((current) => current.map(refreshProduct));
        setSelectedProduct(refreshProduct);
        setCartDecisionProduct(refreshProduct);
        setOrderNowProduct(refreshProduct);
      } catch (error) {
        console.warn("Unable to refresh current product pricing.", error);
      } finally {
        requestInFlight = false;
      }
    };

    refreshProductPricing();
    window.addEventListener("focus", refreshProductPricing);
    const unsubscribeRealtime = subscribeToRealtime(["products", "catalog"], refreshProductPricing);

    return () => {
      active = false;
      window.removeEventListener("focus", refreshProductPricing);
      unsubscribeRealtime();
    };
  }, [loading, user?.id]);

  const productCategoryOptions = [...new Set(products.map((product) => String(product.category || "").trim()).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  const productTypeOptions = [...new Set(products.map((product) => String(product.product_type || product.type || "").trim()).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  const normalizedProductSearch = searchQuery.trim().toLowerCase();
  const visibleProducts = products.filter((product) => {
    const matchesSearch = !normalizedProductSearch || [
      product.name,
      product.product_name,
      product.product_type,
      product.category,
      product.variant,
      product.description,
    ].some((value) => String(value || "").toLowerCase().includes(normalizedProductSearch));
    const matchesCategory = categoryFilter === "All" || String(product.category || "").toLowerCase() === categoryFilter.toLowerCase();
    const matchesType = productTypeFilter === "All" || String(product.product_type || product.type || "").toLowerCase() === productTypeFilter.toLowerCase();
    return matchesSearch && matchesCategory && matchesType;
  });
  const effectiveProductsPerPage = productsPerPage === 0 ? Math.max(visibleProducts.length, 1) : productsPerPage;
  const paginatedProducts = paginateItems(visibleProducts, productPage, effectiveProductsPerPage);
  const displayedProducts = isMobile ? visibleProducts : paginatedProducts.items;

  useEffect(() => {
    if (!orderOwnerId) return;
    let active = true;
    let requestInFlight = false;
    let refreshQueued = false;

    const fetchOrders = async (showLoading = true) => {
      if (requestInFlight) {
        refreshQueued = true;
        return;
      }
      requestInFlight = true;
      if (showLoading) setOrdersLoading(true);

      try {
        const [response, paymentContact] = await Promise.all([
          getOrders(),
          getCustomerPaymentContact().catch(() => null),
        ]);
        if (!active) return;
        setCustomerPaymentContactPhone(paymentContact?.phone || "");
        const latestOrders = response.orders || [];
        setOrdersLoadError("");
        hasLoadedCustomerOrdersRef.current = true;
        setOrders(latestOrders);
        setSelectedOrderForModal((current) => {
          if (!current) return current;
          const currentId = String(current._id || current.id || current.tracking || "");
          const latest = latestOrders.find((order) => String(order._id || order.id || order.tracking || "") === currentId);
          return latest ? { ...current, ...latest } : current;
        });
        setContractPreviewOrder((current) => {
          if (!current) return current;
          const currentId = String(current._id || current.id || current.tracking || "");
          const latest = latestOrders.find((order) => String(order._id || order.id || order.tracking || "") === currentId);
          return latest ? { ...current, ...latest } : current;
        });
      } catch (error) {
        if (!active) return;
        setOrdersLoadError(error?.data?.message || error?.message || "Unable to load your orders right now.");
      } finally {
        if (active && showLoading) setOrdersLoading(false);
        requestInFlight = false;
        if (active && refreshQueued) {
          refreshQueued = false;
          void fetchOrders(false);
        }
      }
    };

    const refreshOrders = () => {
      if (document.visibilityState === "visible") fetchOrders(false);
    };

    fetchOrders();
    window.addEventListener("focus", refreshOrders);
    document.addEventListener("visibilitychange", refreshOrders);
    const unsubscribeRealtime = subscribeToRealtime("orders", refreshOrders);

    return () => {
      active = false;
      window.removeEventListener("focus", refreshOrders);
      document.removeEventListener("visibilitychange", refreshOrders);
      unsubscribeRealtime();
    };
  }, [orderOwnerId]);

  useEffect(() => {
    if (!orderOwnerId) return;

    const changedPaymentHistoryKeys = [];
    orders.forEach((order, index) => {
      const id = String(order?._id ?? order?.id ?? order?.tracking ?? `order-${index}`);
      const key = `${orderOwnerId}:${id}`;
      const signature = JSON.stringify(Array.isArray(order?.payment_records) ? order.payment_records : []);
      const previousSignature = paymentHistorySignatureByOrderRef.current.get(key);

      if (previousSignature !== undefined && previousSignature !== signature) {
        changedPaymentHistoryKeys.push(key);
      }

      paymentHistorySignatureByOrderRef.current.set(key, signature);
    });

    if (changedPaymentHistoryKeys.length > 0) {
      setPaymentHistoryExpandedByOrder((current) => {
        const next = { ...current };
        changedPaymentHistoryKeys.forEach((key) => {
          next[key] = true;
        });
        return next;
      });
    }
  }, [orders, orderOwnerId]);

  useEffect(() => {
    if (!hasLoadedCustomerOrdersRef.current) return;
    const currentContractVersions = new Map();
    orders.forEach((order) => {
      const status = normalizeOrderStatusKey(order?.status);
      const contractStatus = normalizeOrderStatusKey(order?.contract_status);
      if (status !== "contract_sent" && contractStatus !== "sent") return;

      const orderId = String(order?._id || order?.id || order?.tracking || "");
      if (!orderId) return;
      const version = String(order.contractVersion || order.currentContractVersion || order.contractId || order.contract_number || order.contractSentAt || order.contract_sent_at || "current");
      const signature = `${orderId}:${version}`;
      currentContractVersions.set(orderId, signature);

      const previousSignature = notifiedContractVersionsRef.current?.get(orderId);
      if (notifiedContractVersionsRef.current && previousSignature !== signature) {
        toast.success("A contract has been sent for your review and acceptance.");
      }
    });

    notifiedContractVersionsRef.current = currentContractVersions;
  }, [orders]);

  useEffect(() => {
    if (!orderOwnerId) {
      setRepairRequests([]);
      return undefined;
    }
    let active = true;
    let inFlight = false;
    const loadRepairRequests = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const response = await getCustomerRepairRequests();
        if (active) setRepairRequests(response.repairs || []);
      } catch (error) {
        console.error("Failed to load customer repair notifications:", error);
      } finally {
        inFlight = false;
      }
    };
    void loadRepairRequests();
    const unsubscribe = subscribeToRealtime("repairs", loadRepairRequests);
    window.addEventListener("focus", loadRepairRequests);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", loadRepairRequests);
    };
  }, [orderOwnerId]);

  useEffect(() => {
    if (activeTab !== "orders" || !orderOwnerId) return undefined;
    let active = true;
    getCustomerPaymentContact()
      .then((contact) => {
        if (active) setCustomerPaymentContactPhone(contact?.phone || "");
      })
      .catch(() => {
        if (active) setCustomerPaymentContactPhone("");
      });
    return () => {
      active = false;
    };
  }, [activeTab, orderOwnerId]);

  useEffect(() => {
    const orderId = new URLSearchParams(location.search).get("orderId");
    if (!orderId || ordersLoading || !orders.length || autoOpenedContractRef.current === orderId) return;

    const order = orders.find((candidate) => String(candidate._id || candidate.id) === String(orderId));
    if (!order) return;

    autoOpenedContractRef.current = orderId;
    setActiveTab("orders");
    setOrderFilter("all");
    setTrackingNumber("");
    const matchingOrderIndex = orders.findIndex((candidate) => String(candidate._id || candidate.id) === String(orderId));
    if (matchingOrderIndex >= 0) setOrderPage(Math.floor(matchingOrderIndex / 5) + 1);
    const orderIdentifier = getOrderIdentifier(order);
    setExpandedOrderId(orderIdentifier);
    setHighlightedOrderId(orderIdentifier);
    navigate(`${location.pathname}?tab=orders`, { replace: true });
  }, [location.pathname, location.search, navigate, orders, ordersLoading]);

  useEffect(() => {
    if (!selectedProduct?._id || !canAccessCustomerRatings || loading || !user || !localStorage.getItem("token")) {
      setProductReviews([]);
      return;
    }

    let active = true;
    const fetchProductReviews = async () => {
      setProductReviewsLoading(true);
      try {
        const response = await getProductReviews(selectedProduct._id);
        if (!active) return;
        setProductReviews(response.reviews || []);
      } catch {
        if (!active) return;
        setProductReviews([]);
      } finally {
        if (active) setProductReviewsLoading(false);
      }
    };

    fetchProductReviews();

    return () => {
      active = false;
    };
  }, [selectedProduct, canAccessCustomerRatings, loading, user?.id]);

  const generateCartId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const parseProductDimensionText = (value) => {
    if (!value) return {};
    const text = String(value);
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:x||by)\s*(\d+(?:\.\d+)?)/i);
    const unitMatch = text.match(/\b(cm|mm|m|ft|in|inch|inches|feet|meter|meters)\b|"/i);
    const unitMap = {
      inch: "in",
      inches: "in",
      feet: "ft",
      meter: "m",
      meters: "m",
    };

    return {
      width: match ? Number(match[1]) : 0,
      height: match ? Number(match[2]) : 0,
      unit: unitMatch ? unitMap[unitMatch[1]?.toLowerCase()] || unitMatch[1]?.toLowerCase() || "in" : "in",
    };
  };

  const getProductDefaultDimensions = (product, quantity = 1) => {
    const parsed = parseProductDimensionText(product?.dimensions || product?.standard_size || product?.size);
    const width = Number(product?.width) > 0 ? Number(product.width) : Number(parsed.width) || 0;
    const height = Number(product?.height) > 0 ? Number(product.height) : Number(parsed.height) || 0;
    const unit = product?.measurement_unit || product?.measurementUnit || parsed.unit || "in";

    return {
      width,
      height,
      unit,
      quantity: Math.max(1, Number(quantity) || 1),
      customized: false,
    };
  };

  const buildOrderItemDimensions = ({ product, width, height, unit, quantity, customized = false }) => {
    const defaultDimensions = getProductDefaultDimensions(product, quantity);
    const useCustomized = customized || Number(width) > 0 || Number(height) > 0;
    const dimensions = useCustomized
      ? {
          width: Number(width) || 0,
          height: Number(height) || 0,
          unit: unit || defaultDimensions.unit || "in",
          quantity: Math.max(1, Number(quantity) || 1),
          customized: true,
        }
      : defaultDimensions;

    return dimensions;
  };

  const areOrderItemDimensionsValid = (dimensions) =>
    Number(dimensions?.width) > 0 &&
    Number(dimensions?.height) > 0 &&
    Number(dimensions?.quantity) > 0 &&
    Boolean(dimensions?.unit);

  const hasValidOrderItemPricingDimensions = (item) => {
    const pricingMethod = String(item?.pricing_method || item?.unit || "").toLowerCase();
    const isBladeProduct = pricingMethod === "blade" || pricingMethod === "per_blade";
    const isMeterProduct = pricingMethod === "per_meter" || pricingMethod === "meter";
    const isPieceProduct = ["per_piece", "piece", "per_set", "set"].includes(pricingMethod);
    const needsCustomFrameDimensions = isBladeProduct && item?.sale_mode === "frame" && Boolean(item?.custom_frame_size);
    if (isMeterProduct) {
      return Number(item?.dimensions?.width) > 0
        && Number(item?.dimensions?.quantity) > 0
        && Boolean(item?.dimensions?.unit);
    }
    if (isPieceProduct) return Number(item?.dimensions?.quantity) > 0;
    if (!isBladeProduct) return areOrderItemDimensionsValid(item?.dimensions);
    if (needsCustomFrameDimensions && !areOrderItemDimensionsValid(item?.dimensions)) return false;
    return Number(item?.dimensions?.quantity) > 0 && Number(item?.blade_count) > 0;
  };

  const getOrderItemDimensionText = (itemOrDimensions) => {
    const dimensions = itemOrDimensions?.dimensions || itemOrDimensions || {};
    const pricingMethod = String(itemOrDimensions?.pricing_method || itemOrDimensions?.unit || "").toLowerCase();
    if ((pricingMethod === "per_meter" || pricingMethod === "meter") && Number(dimensions.width) > 0 && dimensions.unit) {
      return `${dimensions.width} ${dimensions.unit} length`;
    }
    if (["per_piece", "piece", "per_set", "set"].includes(pricingMethod)) {
      const quantity = Math.max(1, Number(dimensions.quantity ?? itemOrDimensions?.quantity) || 1);
      return `${quantity} piece${quantity === 1 ? "" : "s"}`;
    }
    if (!areOrderItemDimensionsValid(dimensions)) return "—";
    return `${dimensions.width} ${dimensions.unit} x ${dimensions.height} ${dimensions.unit}`;
  };

  const buildCustomerOrderItem = (product, options = {}) => {
    const quantity = Math.max(1, Number(options.quantity) || 1);
    const dimensions = buildOrderItemDimensions({
      product,
      width: options.width,
      height: options.height,
      unit: options.measurementUnit || options.unit,
      quantity,
      customized: Boolean(options.customized),
    });

    const orderItem = {
      ...product,
      _id: product?._id,
      product_id: product?._id,
      name: product?.name || product?.product_name || "Product",
      quantity,
      unit: product?.unit || "piece",
      category: product?.category || "",
      product_type: product?.product_type || "",
      width: dimensions.width,
      height: dimensions.height,
      measurementUnit: dimensions.unit,
      measurement_unit: dimensions.unit,
      dimensions,
      customized: dimensions.customized,
      area: Number(options.area) || 0,
      notes: options.notes || "",
      blade_glass_type: options.blade_glass_type || product?.blade_glass_type || product?.default_blade_glass_type || "",
      piece_option: options.piece_option ?? "",
      area_option: options.area_option ?? product?.area_option ?? "",
      sale_mode: options.sale_mode || product?.sale_mode || product?.default_sale_mode || "blades_only",
      frame_type: options.frame_type || product?.frame_type || product?.default_frame_type || "",
      custom_frame_size: Boolean(options.custom_frame_size ?? product?.custom_frame_size),
      frame_price: options.frame_price == null ? product?.frame_price : Number(options.frame_price) || 0,
      blade_count: getDefaultBladeCount(product || {}, {
        sale_mode: options.sale_mode || product?.default_sale_mode,
        frame_type: options.frame_type || product?.default_frame_type,
        blade_count: options.blade_count,
      }),
      extra_charges: options.extra_charges || product?.extra_charges || getDefaultExtraChargeSelections(product),
      estimated_price: Number(options.estimated_price) || 0,
      is_estimate: options.is_estimate == null
        ? Boolean(dimensions.customized)
        : Boolean(options.is_estimate),
    };
    return {
      ...orderItem,
      ...buildProductPriceSnapshot(product || {}, orderItem),
    };
  };

  const getDefaultBladeSelections = (product) => {
    const glassTypes = Array.isArray(product?.blade_glass_types) ? product.blade_glass_types : [];
    const frameTypes = Array.isArray(product?.blade_frame_types) ? product.blade_frame_types : [];
    const defaultFrame = frameTypes.find((frame) => frame.name === product?.default_frame_type) || frameTypes[0];
    const sellBladesOnly = product?.sell_blades_only !== false;
    const defaultSaleMode = product?.default_sale_mode || (sellBladesOnly ? "blades_only" : "frame");
    const defaultBladeCount = defaultSaleMode === "frame"
      ? Number(defaultFrame?.blade_count) || Number(product?.minimum_blades) || 1
      : Number(product?.minimum_blades) || Number(product?.blade_count) || 1;
    return {
      blade_glass_type: product?.default_blade_glass_type || glassTypes[0]?.name || "",
      piece_option: "",
      area_option: "",
      sale_mode: defaultSaleMode === "frame" && !product?.sell_with_frame ? "blades_only" : defaultSaleMode,
      frame_type: defaultFrame?.name || "",
      custom_frame_size: defaultSaleMode === "frame" && frameTypes.length === 0 && Boolean(product?.allow_custom_frame_size),
      blade_count: product?.customer_can_choose_blade_count ? "" : defaultBladeCount,
      extra_charges: getDefaultExtraChargeSelections(product),
    };
  };

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    if (search.get("resumeLandingProduct") !== "1" || loading || !user?.id || !canRequestOrders) return;

    const pendingAction = getPendingProductAction();
    if (!pendingAction || pendingLandingActionIdRef.current === pendingAction.id) return;

    const selection = pendingAction.selection || {};
    const resumeState = {
      ...(pendingAction.resumeState || {}),
      ...(getPendingProductWorkflowState(pendingAction.id, user?.id || user?._id) || {}),
    };
    const snapshot = pendingAction.productSnapshot || {};
    const product = {
      ...snapshot,
      ...(pendingAction.pricingConfiguration || {}),
      _id: snapshot._id || pendingAction.productId,
      id: snapshot.id || pendingAction.productId,
      name: snapshot.name || snapshot.product_name || "Product",
      product_name: snapshot.product_name || snapshot.name || "Product",
    };
    const bladeDefaults = getDefaultBladeSelections(product);
    const savedCharges = Array.isArray(selection.extra_charges) ? selection.extra_charges : [];
    const extraCharges = getDefaultExtraChargeSelections(product).map((charge) => {
      const savedCharge = savedCharges.find((saved) => saved.name === charge.name);
      return savedCharge ? { ...charge, is_selected: savedCharge.is_selected !== false } : charge;
    });

    pendingLandingActionIdRef.current = pendingAction.id;
    setCartDecisionProduct(product);
    setEstimateForm({
      unit: selection.unit || product.measurement_unit || "in",
      width: String(selection.width ?? product.width ?? ""),
      height: String(selection.height ?? product.height ?? ""),
      quantity: Math.max(1, Number(selection.quantity) || 1),
      notes: selection.notes || "",
      customized: Boolean(selection.customized),
      is_estimate: pendingAction.actionType === "estimate",
      blade_glass_type: selection.blade_glass_type || bladeDefaults.blade_glass_type,
      piece_option: selection.piece_option ?? bladeDefaults.piece_option,
      area_option: selection.area_option || bladeDefaults.area_option,
      sale_mode: selection.sale_mode || bladeDefaults.sale_mode,
      frame_type: selection.frame_type || bladeDefaults.frame_type,
      custom_frame_size: Boolean(selection.custom_frame_size),
      blade_count: selection.blade_count || bladeDefaults.blade_count,
      extra_charges: extraCharges,
    });
    setEstimateFormErrors({});
    setDeliveryConfirmMode(resumeState.deliveryConfirmMode || "estimate");
    setDeliveryConfirmForm(resumeState.deliveryConfirmForm || {
      phone: profileForm.phone || user.phone || "",
      shipping_address: buildDeliveryAddress({ street_address: profileForm.street_address || user.street_address || "", city: profileForm.city || user.city || "", province: profileForm.province || user.province || "", zip_code: profileForm.zip_code || user.zip_code || "" }),
      street_address: profileForm.street_address || user.street_address || "",
      city: profileForm.city || user.city || "",
      province: profileForm.province || user.province || "",
      zip_code: profileForm.zip_code || user.zip_code || "",
    });
    setDeliveryConfirmNotes(resumeState.deliveryConfirmNotes ?? selection.notes ?? "");
    setDeliveryConfirmError("");
    setCartActionError("");
    setOrderReviewAgreed(false);
    setActiveTab("products");
    setResumeProductRefreshing(true);
    setResumeProductRefreshError("");
    setShowDeliveryConfirmModal(resumeState.step !== "review");
    setShowOrderReviewModal(resumeState.step === "review");
    setReviewOrderMode(resumeState.reviewOrderMode || "estimate");
  }, [canRequestOrders, location.search, loading, profileForm.city, profileForm.phone, profileForm.province, profileForm.street_address, profileForm.zip_code, user?.city, user?.id, user?.phone, user?.province, user?.street_address, user?.zip_code]);

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    if (search.get("resumeLandingProduct") !== "1" || loading || !user?.id || landingResumeAttemptRef.current) return undefined;

    const pendingAction = getPendingProductAction();
    if (!pendingAction) {
      search.delete("resumeLandingProduct");
      navigate(`${location.pathname}${search.size ? `?${search}` : ""}`, { replace: true });
      return undefined;
    }

    let active = true;

    const resumeLandingProduct = async () => {
      setResumeProductRefreshing(true);
      setResumeProductRefreshError("");
      try {
        const response = await getProduct(pendingAction.productId);
        if (!active || pendingLandingActionIdRef.current !== pendingAction.id) return;

        const product = response.product;
        if (!product || product.is_active === false) {
          toast.error("This product is no longer available. Please choose another product.");
          setShowDeliveryConfirmModal(false);
          setCartDecisionProduct(null);
          setResumeProductRefreshing(false);
          setResumeProductRefreshError("");
          clearPendingProductAction(pendingAction.id);
          clearPendingProductWorkflowState(pendingAction.id, user?.id || user?._id);
          pendingLandingActionIdRef.current = "";
          search.delete("resumeLandingProduct");
          search.set("tab", "products");
          navigate(`${location.pathname}${search.size ? `?${search}` : ""}`, { replace: true });
          return;
        }

        if (!canRequestOrders) {
          showPermissionNotice("Order requests are disabled for your account.");
          return;
        }

        if (landingResumeAttemptRef.current === pendingAction.id) return;

        const selection = pendingAction.selection || {};
        const savedCharges = Array.isArray(selection.extra_charges) ? selection.extra_charges : [];
        const currentCharges = getDefaultExtraChargeSelections(product).map((charge) => {
          const savedCharge = savedCharges.find((saved) => saved.name === charge.name);
          return savedCharge ? { ...charge, is_selected: savedCharge.is_selected !== false } : charge;
        });

        setCartDecisionProduct(product);
        setEstimateForm((current) => {
          const bladeDefaults = getDefaultBladeSelections(product);
          const isGlassAvailable = product.blade_glass_types?.some((glass) => glass.name === current.blade_glass_type);
          const isFrameAvailable = product.blade_frame_types?.some((frame) => frame.name === current.frame_type);
          return {
            ...current,
            unit: current.unit || product.measurement_unit || "in",
            width: String(current.width ?? selection.width ?? product.width ?? ""),
            height: String(current.height ?? selection.height ?? product.height ?? ""),
            quantity: Math.max(1, Number(current.quantity) || 1),
            blade_glass_type: isGlassAvailable ? current.blade_glass_type : selection.blade_glass_type || bladeDefaults.blade_glass_type,
            piece_option: selection.piece_option ?? bladeDefaults.piece_option,
            area_option: product.area_options?.some((option) => option.name === current.area_option)
              ? current.area_option
              : selection.area_option || bladeDefaults.area_option,
            sale_mode: current.sale_mode === "frame" && !product.sell_with_frame ? bladeDefaults.sale_mode : current.sale_mode,
            frame_type: isFrameAvailable ? current.frame_type : selection.frame_type || bladeDefaults.frame_type,
            blade_count: current.blade_count || selection.blade_count || bladeDefaults.blade_count,
            extra_charges: currentCharges.map((charge) => {
              const currentSelection = current.extra_charges?.find((item) => item.name === charge.name);
              return currentSelection ? { ...charge, is_selected: currentSelection.is_selected !== false } : charge;
            }),
          };
        });
        setActiveTab("products");
        const resumeAtReview = pendingAction.resumeState?.step === "review";
        setShowDeliveryConfirmModal(!resumeAtReview);
        setShowOrderReviewModal(resumeAtReview);

        landingResumeAttemptRef.current = pendingAction.id;
        setResumeProductRefreshing(false);
        setResumeProductRefreshError("");
        search.set("tab", "products");
        if (search.toString() !== location.search.replace(/^\?/, "")) {
          navigate(`${location.pathname}?${search}`, { replace: true });
        }
      } catch (error) {
        if (!active) return;
        landingResumeAttemptRef.current = "";
        setResumeProductRefreshing(false);
        setResumeProductRefreshError(error.data?.message || error.message || "Unable to verify current pricing. Retry to continue.");
      }
    };

    resumeProductRefreshRef.current = resumeLandingProduct;
    resumeLandingProduct();
    return () => {
      active = false;
      if (resumeProductRefreshRef.current === resumeLandingProduct) resumeProductRefreshRef.current = null;
    };
  }, [canRequestOrders, location.pathname, location.search, loading, navigate, profileForm.city, profileForm.phone, profileForm.province, profileForm.street_address, profileForm.zip_code, user?.city, user?.id, user?.phone, user?.province, user?.street_address, user?.zip_code]);

  useEffect(() => {
    const pendingActionId = pendingLandingActionIdRef.current;
    if (!pendingActionId) return;
    const pendingAction = getPendingProductAction();
    if (!pendingAction || pendingAction.id !== pendingActionId) return;

    updatePendingProductAction(pendingActionId, {
      selection: {
        ...pendingAction.selection,
        width: estimateForm.width,
        height: estimateForm.height,
        unit: estimateForm.unit,
        quantity: estimateForm.quantity,
        notes: estimateForm.notes,
        customized: estimateForm.customized,
        blade_glass_type: estimateForm.blade_glass_type,
        piece_option: estimateForm.piece_option,
        area_option: estimateForm.area_option,
        sale_mode: estimateForm.sale_mode,
        frame_type: estimateForm.frame_type,
        custom_frame_size: estimateForm.custom_frame_size,
        blade_count: estimateForm.blade_count,
        extra_charges: estimateForm.extra_charges,
      },
    });
    savePendingProductWorkflowState(pendingActionId, user?.id || user?._id, {
      step: showOrderReviewModal ? "review" : "delivery",
      deliveryConfirmMode,
      deliveryConfirmForm,
      deliveryConfirmNotes,
      reviewOrderMode,
    });
  }, [deliveryConfirmForm, deliveryConfirmMode, deliveryConfirmNotes, estimateForm, reviewOrderMode, showOrderReviewModal, user?.id, user?._id]);

  const handleAddToCart = async (product, extraCharges = getDefaultExtraChargeSelections(product), configuration = {}) => {
    if (!canRequestOrders) {
      setCartActionError("Order requests are disabled for your account.");
      return false;
    }
    if (!cartLoaded) {
      setCartActionError("Your cart is still loading. Please try again.");
      return false;
    }
    const isBladeProduct = ["blade", "per_blade"].includes(String(product?.pricing_method || product?.unit || "").toLowerCase());
    const bladeSelections = isBladeProduct
      ? { ...getDefaultBladeSelections(product), ...configuration }
      : {};
    const quantity = Math.max(1, Number(configuration.quantity) || 1);
    const defaultDimensions = getProductDefaultDimensions(product, quantity);
    const hasDimensionOverrides = configuration.width != null || configuration.height != null;
    const usesProductDimensions = configuration.useProductDefaults === true || (
      configuration.customized !== true &&
      (!hasDimensionOverrides || (
        Number(configuration.width) === Number(defaultDimensions.width) &&
        Number(configuration.height) === Number(defaultDimensions.height)
      ))
    );
    const customized = Boolean(configuration.customized) || (
      !usesProductDimensions && (
        Number(configuration.width) !== Number(defaultDimensions.width) ||
        Number(configuration.height) !== Number(defaultDimensions.height)
      )
    );
    const cartItem = buildCustomerOrderItem(product, {
      quantity,
      width: usesProductDimensions ? undefined : configuration.width,
      height: usesProductDimensions ? undefined : configuration.height,
      measurementUnit: configuration.measurementUnit || configuration.unit,
      customized,
      ...bladeSelections,
      extra_charges: extraCharges,
    });
    if (!hasValidOrderItemPricingDimensions(cartItem)) {
      const message = "Please provide valid product dimensions before adding this product to your cart.";
      setCartActionError(message);
      toast.error(message);
      if (String(selectedProduct?._id || selectedProduct?.id || "") !== String(product?._id || product?.id || "")) {
        handleViewProduct(product);
      }
      return false;
    }

    setCartActionError("");
    try {
      let expectedCartId = "";
      const response = await commitCartItems((prev) => {
        const getSelectionKey = (item) => JSON.stringify({
          productId: String(item.product_id?._id || item.product_id || item._id || item.id || ""),
          variant: item.variant || item.color || "",
          width: Number(item.dimensions?.width ?? item.width) || 0,
          height: Number(item.dimensions?.height ?? item.height) || 0,
          unit: item.dimensions?.unit || item.measurement_unit || item.measurementUnit || "in",
          bladeGlassType: item.blade_glass_type || "",
          saleMode: item.sale_mode || "",
          frameType: item.frame_type || "",
          customFrameSize: Boolean(item.custom_frame_size),
          bladeCount: Number(item.blade_count) || 0,
          extraCharges: (item.extra_charges || [])
            .filter((charge) => charge.is_optional)
            .map((charge) => [charge.name || charge.label || "", charge.is_selected !== false]),
        });
        const selectionKey = getSelectionKey(cartItem);
        const existing = prev.find((item) => !item.is_estimate && getSelectionKey(item) === selectionKey);
        if (existing) {
          expectedCartId = String(existing.cartId || "");
          return prev.map((p) =>
            p.cartId === existing.cartId
              ? {
                ...p,
                quantity: (Number(p.quantity) || 0) + cartItem.quantity,
                dimensions: {
                  ...(p.dimensions || {}),
                  quantity: (Number(p.quantity) || 0) + cartItem.quantity,
                },
                selected: true,
              }
              : p
          );
        }

        expectedCartId = generateCartId();
        return [...prev, { ...cartItem, cartId: expectedCartId, selected: true }];
      });

      const savedItems = Array.isArray(response?.items) ? response.items : cartItemsRef.current;
      if (!savedItems.some((item) => String(item.cartId || "") === expectedCartId)) {
        throw new Error("The server did not retain this product in your cart. Please try again.");
      }

      toast.success("Product added to cart.");
      return true;
    } catch (error) {
      reportCartSaveError(error);
      return false;
    }
  };

  useEffect(() => {
    const pendingCartAdd = location.state?.pendingCartAdd;
    if (
      !pendingCartAdd?.actionId ||
      !pendingCartAdd?.productId ||
      loading ||
      user?.role !== "customer" ||
      !cartLoaded ||
      pendingLandingCartResumeRef.current === pendingCartAdd.actionId
    ) return;

    pendingLandingCartResumeRef.current = pendingCartAdd.actionId;
    const clearPendingCartAdd = () => {
      const nextState = { ...(location.state || {}) };
      delete nextState.pendingCartAdd;
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: Object.keys(nextState).length ? nextState : null,
      });
    };
    const product = pendingCartAdd.product;
    if (!product) {
      toast.error("We couldn't restore that product to your cart. Please browse and add it again.");
      clearPendingCartAdd();
      return;
    }

    const options = pendingCartAdd.options || {};
    const extraCharges = Array.isArray(options.extra_charges)
      ? options.extra_charges
      : getDefaultExtraChargeSelections(product);
    handleAddToCart(product, extraCharges, options).finally(clearPendingCartAdd);
  }, [cartLoaded, handleAddToCart, loading, location.hash, location.pathname, location.search, location.state, navigate, user?.role]);

  const handleAddEstimateToCart = async ({ product, width, height, quantity, notes, measurementUnit, blade_glass_type, piece_option, area_option, sale_mode, frame_type, custom_frame_size, blade_count, extra_charges }) => {
    if (!canRequestOrders) {
      setCartActionError("Order requests are disabled for your account.");
      return false;
    }
    if (!canEstimatePricing) {
      setCartActionError("Pricing estimates are disabled for your account.");
      return false;
    }
    const bladeCountError = getProductEstimatorState(product, { blade_count, sale_mode, frame_type, custom_frame_size }).bladeCountError;
    if (bladeCountError) {
      setCartActionError(bladeCountError);
      return false;
    }
    if (!cartLoaded) {
      setCartActionError("Your cart is still loading. Please try again.");
      return false;
    }
    const parsedWidth = Number(width) || 0;
    const parsedHeight = Number(height) || 0;
    const parsedQuantity = Number(quantity) || 1;
    
    const estimationResult = calculateEstimate({
      productName: product.product_name || product.name,
      categoryKey: product.product_type || product.category,
      variantName: product.variant,
      width: parsedWidth,
      height: parsedHeight,
      measurementUnit,
      quantity: parsedQuantity,
      blade_count: product.blade_count || 0,
      base_price: product.base_price || undefined,
      overrideRate: getProductEstimateRate(product, { piece_option, area_option }),
      customization: product.customization || false,
      customization_fee: product.customization_fee || 0,
    });
    
    const area = estimationResult.estimated_area || 0;
    const estimated_price = getProductLineTotal(product, {
      width: parsedWidth,
      height: parsedHeight,
      measurement_unit: measurementUnit,
      quantity: parsedQuantity,
      customized: true,
      blade_glass_type,
      piece_option,
      area_option,
      sale_mode,
      frame_type,
      custom_frame_size,
      blade_count,
      extra_charges,
    }) || estimationResult.estimated_price || 0;

    setCartActionError("");
    try {
      await commitCartItems((prev) => [
        ...prev,
        {
          ...buildCustomerOrderItem(product, {
            quantity: parsedQuantity,
            width: parsedWidth,
            height: parsedHeight,
            measurementUnit,
            customized: true,
            area,
            notes,
            estimated_price,
            is_estimate: true,
            blade_glass_type,
            piece_option,
            area_option,
            sale_mode,
            frame_type,
            custom_frame_size,
            blade_count,
            extra_charges,
          }),
          cartId: generateCartId(),
          selected: true,
        },
      ]);

      toast.success("Estimate added to cart.");
      return true;
    } catch (error) {
      reportCartSaveError(error);
      return false;
    }
  };

  const openCartDecisionModal = (product, step = "choice") => {
    if (onlineOrderCooldownActive && step !== "estimate") {
      showPermissionNotice(onlineOrderCooldownMessage);
      return;
    }
    if (step === "estimate" && !canEstimatePricing) {
      showPermissionNotice("Pricing estimates are disabled for your account.");
      return;
    }
    if (step !== "estimate" && !canRequestOrders) {
      showPermissionNotice("Order requests are disabled for your account.");
      return;
    }
    setCartDecisionProduct(product);
    setCartDecisionStep(step);
    setShowCartDecisionModal(true);
    setEstimateForm({ unit: "in", width: "", height: "", quantity: 1, notes: "", ...getDefaultBladeSelections(product) });
    setEstimateFormErrors({});
    setCartActionError("");
    setEstimateFlowType(step === "estimate" ? "estimate_product" : null);
  };

  const closeCartDecisionModal = () => {
    setShowCartDecisionModal(false);
    setCartDecisionProduct(null);
    setCartDecisionStep("choice");
    setCartActionError("");
    setEstimateFlowType(null);
  };

  const requestCloseCartDecisionModal = () => requestCustomerExit(
    createUnsavedSnapshot(estimateForm) !== estimateFormBaselineRef.current,
    closeCartDecisionModal,
  );

  const handleCartDecisionNoAdd = async () => {
    if (!cartDecisionProduct) return;
    const added = await handleAddToCart(cartDecisionProduct);
    if (added) closeCartDecisionModal();
  };

  const handleCartDecisionEstimate = () => {
    setCartDecisionStep("estimate");
    setEstimateFlowType("add_to_cart_estimate");
  };

  const handleEstimateFormChange = (e) => {
    const { name, value } = e.target;
    setEstimateForm((prev) => ({ ...prev, [name]: value }));

    if (name === 'width' || name === 'height') {
      const numeric = Number(value);
      setEstimateFormErrors((prev) => ({
        ...prev,
        [name]: numeric <= 0 || Number.isNaN(numeric) ? `${name === 'width' ? 'Width' : 'Height'} must be greater than 0.` : undefined,
      }));
    }
  };

  const handleEstimateAddToCart = async () => {
    if (!cartDecisionProduct) return;
    const quantityError = getProductEstimatorQuantityError(estimateForm.quantity);
    if (quantityError) {
      setCartActionError(quantityError);
      return;
    }
    if (!estimateForm.width || !estimateForm.height) {
      setCartActionError("Please enter width and height to estimate.");
      return;
    }
    if (Number(estimateForm.width) <= 0 || Number(estimateForm.height) <= 0) {
      setCartActionError("Width and height must be greater than 0.");
      return;
    }
    if (estimateForm.quantity < 1) {
      setCartActionError("Quantity must be at least 1.");
      return;
    }

    const added = await handleAddEstimateToCart({
      product: cartDecisionProduct,
      width: estimateForm.width,
      height: estimateForm.height,
      quantity: estimateForm.quantity,
      notes: estimateForm.notes,
      measurementUnit: estimateForm.unit,
      blade_glass_type: estimateForm.blade_glass_type,
      sale_mode: estimateForm.sale_mode,
      frame_type: estimateForm.frame_type,
      custom_frame_size: estimateForm.custom_frame_size,
      blade_count: estimateForm.blade_count,
    });
    if (added) closeCartDecisionModal();
  };

  const openOrderReviewModal = () => {
    if (onlineOrderCooldownActive) {
      setCartActionError(onlineOrderCooldownMessage);
      return;
    }
    if (!canRequestOrders) {
      setCartActionError("Order requests are disabled for your account.");
      return;
    }
    if (!cartDecisionProduct) return;
    const quantityError = getProductEstimatorQuantityError(estimateForm.quantity);
    if (quantityError) {
      setCartActionError(quantityError);
      return;
    }
    const bladeCountError = getProductEstimatorState(cartDecisionProduct, estimateForm).bladeCountError;
    if (bladeCountError) {
      setCartActionError(bladeCountError);
      return;
    }
    const needsDimensions = cartDecisionProduct?.pricing_method !== "blade"
      || (estimateForm.sale_mode === "frame" && estimateForm.custom_frame_size);
    if (needsDimensions && (!estimateForm.width || !estimateForm.height)) {
      setCartActionError("Please enter width and height to estimate.");
      return;
    }
    if (Number(estimateForm.quantity) < 1) {
      setCartActionError("Quantity must be at least 1.");
      return;
    }

    setCartActionError("");
    setOrderReviewAgreed(false);
    setShowOrderReviewModal(true);
  };

  const handleEstimateAfterEstimation = async () => {
    if (onlineOrderCooldownActive) {
      setCartActionError(onlineOrderCooldownMessage);
      return;
    }
    if (!canRequestOrders) {
      setCartActionError("Your estimate is ready, but order requests are disabled for your account.");
      return;
    }
    const quantityError = getProductEstimatorQuantityError(estimateForm.quantity);
    if (quantityError) {
      setCartActionError(quantityError);
      return;
    }
    const bladeCountError = getProductEstimatorState(cartDecisionProduct, estimateForm).bladeCountError;
    if (bladeCountError) {
      setCartActionError(bladeCountError);
      return;
    }
    const needsDimensions = cartDecisionProduct?.pricing_method !== "blade"
      || (estimateForm.sale_mode === "frame" && estimateForm.custom_frame_size);
    if (needsDimensions && (!estimateForm.width || !estimateForm.height)) {
      setCartActionError("Please enter width and height to request an order.");
      return;
    }
    if (needsDimensions && (Number(estimateForm.width) <= 0 || Number(estimateForm.height) <= 0)) {
      setCartActionError("Width and height must be greater than 0.");
      return;
    }
    if (estimateFlowType === "add_to_cart_estimate") {
      await handleEstimateAddToCart();
    } else {
      setDeliveryConfirmMode("estimate");
      setDeliveryConfirmForm({
        phone: profileForm.phone || "",
        shipping_address: buildDeliveryAddress({ street_address: profileForm.street_address || "", city: profileForm.city || "", province: profileForm.province || "", zip_code: profileForm.zip_code || "" }),
        street_address: profileForm.street_address || "",
        city: profileForm.city || "",
        province: profileForm.province || "",
        zip_code: profileForm.zip_code || "",
      });
      setDeliveryConfirmError("");
      setShowDeliveryConfirmModal(true);
      setShowCartDecisionModal(false);
    }
  };

  const saveProfileDeliveryInfo = async () => {
    try {
      const payload = {
        phone: deliveryConfirmForm.phone || profileForm.phone || "",
        street_address: deliveryConfirmForm.street_address || profileForm.street_address || "",
        city: deliveryConfirmForm.city || profileForm.city || "",
        province: deliveryConfirmForm.province || profileForm.province || "",
        zip_code: deliveryConfirmForm.zip_code || profileForm.zip_code || "",
      };

      await updateProfile(payload);
      setProfileForm((prev) => ({ ...prev, ...payload }));
    } catch (error) {
      console.error("Failed to update profile delivery info", error);
    }
  };

  const validateDeliveryConfirmForm = () => {
    if (!deliveryConfirmForm.street_address.trim() || !deliveryConfirmForm.phone.trim()) {
      setDeliveryConfirmError("Please complete your delivery information before proceeding.");
      return false;
    }
    const addressError = getStreetAddressError(deliveryConfirmForm.shipping_address || buildDeliveryAddress(deliveryConfirmForm));
    if (addressError) {
      setDeliveryConfirmError(addressError);
      return false;
    }
    if (!isValidPhilippinePhone(deliveryConfirmForm.phone)) {
      setDeliveryConfirmError(getPhilippinePhoneError(deliveryConfirmForm.phone));
      return false;
    }
    setDeliveryConfirmError("");
    return true;
  };

  const handleConfirmAndContinue = async () => {
    if (onlineOrderCooldownActive) {
      setDeliveryConfirmError(onlineOrderCooldownMessage);
      return;
    }
    if (deliveryConfirmMode === "estimate") {
      const quantityError = getProductEstimatorQuantityError(estimateForm.quantity);
      if (quantityError) {
        setDeliveryConfirmError(quantityError);
        return;
      }
      const bladeCountError = getProductEstimatorState(cartDecisionProduct, estimateForm).bladeCountError;
      if (bladeCountError) {
        setDeliveryConfirmError(bladeCountError);
        return;
      }
    }
    if (!validateDeliveryConfirmForm()) return;
    setOrderRequestLoading(true);

    try {
      await saveProfileDeliveryInfo();
      setShowDeliveryConfirmModal(false);
      setReviewOrderMode(deliveryConfirmMode);
      setOrderReviewAgreed(false);
      setShowOrderReviewModal(true);
    } catch (error) {
      setDeliveryConfirmError("Unable to save delivery information. Please try again.");
    } finally {
      setOrderRequestLoading(false);
    }
  };

  const addCreatedOrderToMyOrders = (createdOrder) => {
    if (!createdOrder) return;

    const createdOrderId = createdOrder._id || createdOrder.id || createdOrder.tracking;
    setOrders((prev = []) => {
      const existingIndex = prev.findIndex(
        (order) => (order._id || order.id || order.tracking) === createdOrderId
      );

      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = createdOrder;
        return next;
      }

      return [createdOrder, ...prev];
    });
    setOrderFilter("all");
    setTrackingNumber("");
    setTrackingResult(null);
  };

  const handleSubmitOrderRequest = async () => {
    if (reviewOrderMode === "estimate") {
      const quantityError = getProductEstimatorQuantityError(estimateForm.quantity);
      if (quantityError) {
        setCartActionError(quantityError);
        return;
      }
    }
    if (onlineOrderCooldownUntil && onlineOrderCooldownUntil.getTime() > Date.now()) {
      setCartActionError(onlineOrderCooldownMessage);
      return;
    }
    if (!orderReviewAgreed) {
      setCartActionError("Please confirm the payment policy before submitting.");
      return;
    }
    if (reviewOrderMode !== "orderNow" && cartDecisionProduct) {
      const bladeCountError = getProductEstimatorState(cartDecisionProduct, estimateForm).bladeCountError;
      if (bladeCountError) {
        setCartActionError(bladeCountError);
        return;
      }
    }

    const currentShippingAddress = deliveryConfirmForm.shipping_address || buildDeliveryAddress(deliveryConfirmForm) || buildFullAddress(user);
    const shippingAddressError = getStreetAddressError(currentShippingAddress);
    if (shippingAddressError) {
      setCartActionError(shippingAddressError);
      return;
    }

    setCartActionError("");
    setOrderRequestLoading(true);

    try {
      if (reviewOrderMode === "orderNow") {
        await handleSubmitOrderNow();
      } else {
        if (!cartDecisionProduct) return;

        const parsedWidth = Number(estimateForm.width) || 0;
        const parsedHeight = Number(estimateForm.height) || 0;
        const parsedQuantity = Number(estimateForm.quantity) || 1;
        const bladeSelections = {
          blade_glass_type: estimateForm.blade_glass_type,
          piece_option: estimateForm.piece_option,
          area_option: estimateForm.area_option,
          sale_mode: estimateForm.sale_mode,
          frame_type: estimateForm.frame_type,
          custom_frame_size: estimateForm.custom_frame_size,
          blade_count: estimateForm.blade_count,
          extra_charges: estimateForm.extra_charges,
        };

        const estimationResult = calculateEstimate({
          productName: cartDecisionProduct.product_name || cartDecisionProduct.name,
          categoryKey: cartDecisionProduct.product_type || cartDecisionProduct.category,
          variantName: cartDecisionProduct.variant,
          width: parsedWidth,
          height: parsedHeight,
          measurementUnit: estimateForm.unit,
          quantity: parsedQuantity,
          blade_count: cartDecisionProduct.blade_count || 0,
          base_price: cartDecisionProduct.base_price || undefined,
          overrideRate: getProductEstimateRate(cartDecisionProduct, bladeSelections),
          customization: cartDecisionProduct.customization || false,
          customization_fee: cartDecisionProduct.customization_fee || 0,
        });

        const estimatedPrice = getProductLineTotal(cartDecisionProduct, {
          width: parsedWidth,
          height: parsedHeight,
          measurement_unit: estimateForm.unit,
          quantity: parsedQuantity,
          customized: true,
          ...bladeSelections,
        }) || estimationResult.estimated_price || 0;
        const item = buildCustomerOrderItem(cartDecisionProduct, {
          quantity: parsedQuantity,
          width: parsedWidth,
          height: parsedHeight,
          measurementUnit: estimateForm.unit,
          customized: true,
          area: estimationResult.estimated_area || 0,
          estimated_price: estimatedPrice,
          notes: estimateForm.notes || "",
          is_estimate: estimateForm.is_estimate !== false,
          ...bladeSelections,
        });

        if (!hasValidOrderItemPricingDimensions(item)) {
          setCartActionError("Please provide valid product dimensions before submitting your order.");
          return;
        }

        const response = await createOrder({
          items: [item],
          shipping_address: normalizeFullAddress(deliveryConfirmForm.shipping_address || buildDeliveryAddress(deliveryConfirmForm) || buildFullAddress(user)),
          order_type: "online_order",
        });

        if (pendingLandingActionIdRef.current) {
          const pendingActionId = pendingLandingActionIdRef.current;
          clearPendingProductAction(pendingActionId);
          clearPendingProductWorkflowState(pendingActionId, user?.id || user?._id);
          pendingLandingActionIdRef.current = "";
          landingResumeAttemptRef.current = "";
          const search = new URLSearchParams(location.search);
          search.delete("resumeLandingProduct");
          search.set("tab", "products");
          navigate(`${location.pathname}?${search}`, { replace: true });
        }
        setOrderRequestMessage(getOrderSubmissionMessage(response, "Order requested"));
        addCreatedOrderToMyOrders(response.order);
        const submittedOrderItems = Array.isArray(response.order?.items) && response.order.items.length
          ? response.order.items
          : [item];
        setOrderSuccessData({
          ...response.order,
          items: submittedOrderItems.map((submittedItem) => ({
            ...submittedItem,
            image_url: submittedItem.image_url || item.image_url || "",
            images: submittedItem.images || item.images,
          })),
        });
      }

      setOrderReviewAgreed(false);
      setShowOrderReviewModal(false);
      setShowOrderNowModal(false);
      setShowOrderSuccessModal(true);
      closeCartDecisionModal();
    } catch (error) {
      setCartActionError(error.data?.message || error.message || "Unable to request order.");
    } finally {
      setOrderRequestLoading(false);
    }
  };

  const updateLocalOrder = (updatedOrder) => {
    const updatedOrderId = updatedOrder?._id || updatedOrder?.id;
    if (!updatedOrderId) return;

    setOrders((prev) =>
      prev.map((order) =>
        (order._id || order.id) === updatedOrderId ? updatedOrder : order
      )
    );
    if ((selectedOrderForModal?._id || selectedOrderForModal?.id) === updatedOrderId) {
      setSelectedOrderForModal(updatedOrder);
    }
    if ((contractPreviewOrder?._id || contractPreviewOrder?.id) === updatedOrderId) {
      setContractPreviewOrder(updatedOrder);
    }
  };

  const handleOrderUpdate = (updatedOrder) => {
    updateLocalOrder(updatedOrder);
    if ((selectedOrderForModal?._id || selectedOrderForModal?.id) === (updatedOrder?._id || updatedOrder?.id)) {
      setSelectedOrderForModal(updatedOrder);
    }
  };

  const handleAcceptContract = async (orderId) => {
    if (!orderId || contractActionLoading) return;

    setContractActionError("");
    setContractActionMessage("");
    setContractActionOrderId(orderId);
    setContractActionLoading(true);
    try {
      const response = await acceptContract(orderId);
      updateLocalOrder(response.order);
      setContractActionMessage("Contract accepted and signed successfully.");
      toast.success("Contract accepted and signed successfully.");
      setContractActionOrderId(response.order._id);
      setContractConfirmModal({ open: false, action: null, orderId: null });
      setShowContractModal(false);
    } catch (error) {
      const message = error.data?.message || error.message || "Unable to accept contract.";
      setContractActionError(message);
      toast.error(message);
      setContractActionMessage("");
    } finally {
      setContractActionLoading(false);
    }
  };

  const handleDeclineContract = async (orderId) => {
    if (!orderId || contractActionLoading) return;

    setContractActionError("");
    setContractActionMessage("");
    setContractActionOrderId(orderId);
    setContractActionLoading(true);
    try {
      const response = await declineContract(orderId);
      updateLocalOrder(response.order);
      if (selectedOrderForModal?._id === orderId) {
        setSelectedOrderForModal(response.order);
      }
      setContractActionMessage("Contract declined. Your order has been cancelled and the transaction will not proceed.");
      toast.success("Contract declined and order cancelled.");
      setContractActionOrderId(response.order._id);
      setContractConfirmModal({ open: false, action: null, orderId: null });
      setShowContractModal(false);
    } catch (error) {
      const message = error.data?.message || error.message || "Unable to decline contract.";
      setContractActionError(message);
      toast.error(message);
      setContractActionMessage("");
    } finally {
      setContractActionLoading(false);
    }
  };

  const openContractConfirmModal = (action, orderId) => {
    setContractActionError("");
    setContractConfirmModal({
      open: true,
      action,
      orderId,
    });
  };

  const closeContractConfirmModal = () => {
    setContractConfirmModal({ open: false, action: null, orderId: null });
  };

  const handleConfirmContractAction = async () => {
    if (!contractConfirmModal.orderId || !contractConfirmModal.action) return;

    const orderId = contractConfirmModal.orderId;
    const action = contractConfirmModal.action;
    closeContractConfirmModal();

    if (action === "accept") {
      await handleAcceptContract(orderId);
    } else if (action === "decline") {
      await handleDeclineContract(orderId);
    }
  };

  const handleRemoveFromCart = (cartId) => {
    persistCartMutation((prev) => prev.filter((item) => item.cartId !== cartId));
  };

  const handleDeleteSelectedItems = () => {
    persistCartMutation((prev) => prev.filter((item) => !item.selected));
  };

  const handleToggleCartItem = (cartId) => {
    persistCartMutation((prev) =>
      prev.map((item) =>
        item.cartId === cartId ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const handleSelectAllCartItems = (selected) => {
    persistCartMutation((prev) => prev.map((item) => ({ ...item, selected })));
  };

  const handleUpdateCartQuantity = (cartId, delta) => {
    persistCartMutation((prev) =>
      prev
        .map((item) =>
          item.cartId === cartId
            ? {
                ...item,
                quantity: Math.max(1, (Number(item.quantity) || 1) + delta),
                dimensions: {
                  ...(item.dimensions || {}),
                  quantity: Math.max(1, (Number(item.quantity) || 1) + delta),
                },
              }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handleClearCart = () => {
    persistCartMutation([]);
  };

  const handleViewProduct = (product) => {
    setSelectedProduct(product);
    setSelectedProductImageIndex(0);
    setCartActionError("");
    const defaultDimensions = getProductDefaultDimensions(product, 1);
    const initialEstimatorForm = {
      unit: defaultDimensions.unit || product?.custom_frame_size_unit || "in",
      width: defaultDimensions.width > 0 ? String(defaultDimensions.width) : "0",
      height: defaultDimensions.height > 0 ? String(defaultDimensions.height) : "0",
      quantity: 1,
      extra_charges: getDefaultExtraChargeSelections(product),
      ...getDefaultBladeSelections(product),
    };
    setProductEstimatorForm(initialEstimatorForm);
    productDetailsBaselineRef.current = getProductDetailsDraftSnapshot(initialEstimatorForm);
    productDetailsDirtyRef.current = false;
    setShowAboutProduct(false);
  };

  const closeProductModal = () => {
    setSelectedProduct(null);
    setSelectedProductImageIndex(0);
    setShowAboutProduct(false);
  };

  const updateProductDetailsEstimatorForm = (nextForm) => {
    setProductEstimatorForm(nextForm);
    productDetailsDirtyRef.current = getProductDetailsDraftSnapshot(nextForm) !== productDetailsBaselineRef.current;
  };

  const requestCloseProductModal = () => requestCustomerExit(
    productDetailsDirtyRef.current,
    closeProductModal,
  );

  const openOrderNowModal = (product) => {
    if (onlineOrderCooldownActive) {
      toast.error(onlineOrderCooldownMessage);
      return;
    }
    if (!canRequestOrders) {
      showPermissionNotice("Order requests are disabled for your account.");
      return;
    }
    const orderNowProductWithSelection = selectedProduct?._id === product?._id
      ? { ...product, piece_option: productEstimatorForm.piece_option || "", area_option: productEstimatorForm.area_option || "" }
      : { ...product, piece_option: "", area_option: "" };
    setOrderNowProduct(orderNowProductWithSelection);
    setOrderNowQuantity(1);
    setOrderNowExtraCharges(
      selectedProduct?._id === product?._id
        ? productEstimatorForm.extra_charges
        : getDefaultExtraChargeSelections(product),
    );
    setDeliveryConfirmMode("orderNow");
    setDeliveryConfirmForm({
      phone: profileForm.phone || user?.phone || "",
      shipping_address: buildDeliveryAddress({ street_address: profileForm.street_address || user?.street_address || "", city: profileForm.city || user?.city || "", province: profileForm.province || user?.province || "", zip_code: profileForm.zip_code || user?.zip_code || "" }),
      street_address: profileForm.street_address || user?.street_address || "",
      city: profileForm.city || user?.city || "",
      province: profileForm.province || user?.province || "",
      zip_code: profileForm.zip_code || user?.zip_code || "",
    });
    setDeliveryConfirmNotes("");
    setDeliveryConfirmError("");
    setShowDeliveryConfirmModal(true);
    setCartActionError("");
  };

  const openEstimatedProductOrder = (product) => {
    if (onlineOrderCooldownActive) {
      toast.error(onlineOrderCooldownMessage);
      return;
    }
    if (!canRequestOrders) {
      showPermissionNotice("Order requests are disabled for your account.");
      return;
    }

    setCartDecisionProduct(product);
    setEstimateForm({
      quantity: 1,
      notes: "",
      ...getDefaultBladeSelections(product),
      ...productEstimatorForm,
      is_estimate: true,
    });
    setEstimateFormErrors({});
    setDeliveryConfirmMode("estimate");
    setDeliveryConfirmForm({
      phone: profileForm.phone || user?.phone || "",
      shipping_address: buildDeliveryAddress({ street_address: profileForm.street_address || user?.street_address || "", city: profileForm.city || user?.city || "", province: profileForm.province || user?.province || "", zip_code: profileForm.zip_code || user?.zip_code || "" }),
      street_address: profileForm.street_address || user?.street_address || "",
      city: profileForm.city || user?.city || "",
      province: profileForm.province || user?.province || "",
      zip_code: profileForm.zip_code || user?.zip_code || "",
    });
    setDeliveryConfirmNotes("");
    setDeliveryConfirmError("");
    setCartActionError("");
    setShowDeliveryConfirmModal(true);
    setShowCartDecisionModal(false);
  };

  const closeOrderNowModal = () => {
    setShowOrderNowModal(false);
    setOrderNowProduct(null);
    setOrderNowQuantity(1);
    setCartActionError("");
  };

  const requestCloseOrderNowModal = () => requestCustomerExit(
    createUnsavedSnapshot({ quantity: orderNowQuantity, extraCharges: orderNowExtraCharges }) !== orderNowBaselineRef.current,
    closeOrderNowModal,
  );

  const handleOrderNowQuantityChange = (delta) => {
    setOrderNowQuantity((prev) => Math.max(1, prev + delta));
  };

  const openOrderNowReviewModal = () => {
    if (onlineOrderCooldownActive) {
      setCartActionError(onlineOrderCooldownMessage);
      return;
    }
    if (!orderNowProduct) return;
    setDeliveryConfirmMode("orderNow");
    setDeliveryConfirmForm({
      phone: profileForm.phone || "",
      shipping_address: buildDeliveryAddress({ street_address: profileForm.street_address || "", city: profileForm.city || "", province: profileForm.province || "", zip_code: profileForm.zip_code || "" }),
      street_address: profileForm.street_address || "",
      city: profileForm.city || "",
      province: profileForm.province || "",
      zip_code: profileForm.zip_code || "",
    });
    setDeliveryConfirmError("");
    setShowDeliveryConfirmModal(true);
    setShowOrderNowModal(false);
  };

  const handleSubmitOrderNow = async () => {
    if (onlineOrderCooldownUntil && onlineOrderCooldownUntil.getTime() > Date.now()) {
      setCartActionError(onlineOrderCooldownMessage);
      return;
    }
    if (!orderNowProduct) return;

    const quantity = Math.max(1, Number(orderNowQuantity) || 1);
    const dimensions = getProductDefaultDimensions(orderNowProduct, quantity);
    const lineTotal = getProductLineTotal(orderNowProduct, {
      ...dimensions,
      extra_charges: orderNowExtraCharges,
    });

    const item = buildCustomerOrderItem(orderNowProduct, {
      quantity,
      width: dimensions.width,
      height: dimensions.height,
      measurementUnit: dimensions.unit,
      area: 0,
      estimated_price: lineTotal,
      extra_charges: orderNowExtraCharges,
      notes: "",
      is_estimate: false,
    });

    if (!hasValidOrderItemPricingDimensions(item)) {
      setCartActionError("Please provide valid product dimensions before submitting your order.");
      return;
    }

    const response = await createOrder({
      items: [item],
      notes: deliveryConfirmNotes.trim(),
      shipping_address: normalizeFullAddress(deliveryConfirmForm.shipping_address || buildDeliveryAddress(deliveryConfirmForm) || buildFullAddress(user)),
      order_type: "online_order",
    });

    setOrderRequestMessage(getOrderSubmissionMessage(response, "Order requested"));
    addCreatedOrderToMyOrders(response.order);
    const submittedOrderItems = Array.isArray(response.order?.items) && response.order.items.length
      ? response.order.items
      : [item];
    setOrderSuccessData({
      ...response.order,
      items: submittedOrderItems.map((submittedItem) => ({
        ...submittedItem,
        image_url: submittedItem.image_url || item.image_url || "",
        images: submittedItem.images || item.images,
      })),
    });
    setOrderReviewAgreed(false);
    setShowOrderSuccessModal(true);
  };

  const handleOrderNow = (product) => {
    openOrderNowModal(product);
  };

  const handleDeliveryConfirmChange = (e) => {
    const { name, value } = e.target;
    setDeliveryConfirmForm((prev) => ({
      ...prev,
      [name]: name === "phone" ? normalizePhoneInput(value) : value,
    }));
  };

  const performCancelDeliveryConfirm = () => {
    setDeliveryConfirmError("");
    setShowDeliveryConfirmModal(false);
    if (pendingLandingActionIdRef.current) {
      const pendingActionId = pendingLandingActionIdRef.current;
      clearPendingProductAction(pendingActionId);
      clearPendingProductWorkflowState(pendingActionId, user?.id || user?._id);
      pendingLandingActionIdRef.current = "";
      landingResumeAttemptRef.current = "";
      setResumeProductRefreshing(false);
      setResumeProductRefreshError("");
      const search = new URLSearchParams(location.search);
      search.delete("resumeLandingProduct");
      if (activeTab === "home") search.delete("tab");
      else search.set("tab", activeTab);
      navigate(`${location.pathname}${search.size ? `?${search}` : ""}`, { replace: true });
    }
    if (deliveryConfirmMode === "orderNow") {
      setShowOrderNowModal(false);
      setOrderNowProduct(null);
    } else if (deliveryConfirmMode === "estimate") {
      const nextForm = { ...productEstimatorForm, ...estimateForm };
      setProductEstimatorForm(nextForm);
      productDetailsDirtyRef.current = getProductDetailsDraftSnapshot(nextForm) !== productDetailsBaselineRef.current;
      setSelectedProduct(cartDecisionProduct);
      setCartDecisionProduct(null);
    }
  };

  const handleCancelDeliveryConfirm = () => requestCustomerExit(
    createUnsavedSnapshot({ form: deliveryConfirmForm, notes: deliveryConfirmNotes }) !== deliveryFormBaselineRef.current,
    performCancelDeliveryConfirm,
  );

  const closeDeliveryConfirm = () => requestCustomerExit(
    createUnsavedSnapshot({ form: deliveryConfirmForm, notes: deliveryConfirmNotes }) !== deliveryFormBaselineRef.current,
    () => {
      performCancelDeliveryConfirm();
      setSelectedProduct(null);
    },
  );

  const handleTrackingSubmit = async () => {
    if (!canTrackProducts) {
      showPermissionNotice("Product tracking is disabled for your account.");
      return;
    }
    if (!trackingNumber.trim()) {
      setTrackingResult({ error: "Please enter a tracking number." });
      return;
    }

    try {
      const response = await trackOrder(trackingNumber.trim());
      setTrackingResult({ ...response.order, message: `Showing order: ${response.order.tracking}` });
    } catch (error) {
      setTrackingResult({ error: error.data?.message || error.message || "No order found with that tracking number." });
    }
  };

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfileError("");
    setProfileMessage("");
    setPasswordModalError("");
    const nextValue = name === "phone"
      ? normalizePhoneInput(value)
      : name === "zip_code"
        ? value.replace(/\D/g, "").slice(0, 4)
        : ["first_name", "last_name"].includes(name)
          ? value.replace(/[^\p{L}\s'-]/gu, "").slice(0, 50)
          : ["city", "province"].includes(name)
            ? value.replace(/[^\p{L}\s'-]/gu, "").slice(0, 40)
        : value;
    setProfileForm((prev) => ({ ...prev, [name]: nextValue }));
  };

  const profileHasChanges = () => {
    const baseline = profileFormBaselineRef.current;
    if (!baseline || !user) return false;

    return (
      profileForm.first_name.trim() !== baseline.first_name ||
      profileForm.last_name.trim() !== baseline.last_name ||
      profileForm.phone !== baseline.phone ||
      normalizeFullAddress(profileForm.street_address) !== normalizeFullAddress(baseline.street_address) ||
      profileForm.city.trim() !== baseline.city ||
      profileForm.province.trim() !== baseline.province ||
      profileForm.zip_code.trim() !== baseline.zip_code ||
      Boolean(profileForm.current_password) ||
      Boolean(profileForm.new_password) ||
      Boolean(profileForm.confirm_password)
    );
  };

  const restoreCustomerProfileDraft = ({ exitSettings = false } = {}) => {
    const savedProfile = profileFormBaselineRef.current || createCustomerProfileDraft(user);
    setProfileForm({ ...savedProfile, current_password: "", new_password: "", confirm_password: "" });
    setProfileError("");
    setProfileMessage("");
    setPasswordModalError("");
    setShowPasswordModal(false);
    setShowDiscardProfileChanges(false);
    if (exitSettings) {
      setProfileTab("profile");
      setProfileEditing(false);
    }
  };

  const closeProfileEditor = () => {
    if (profileHasChanges()) {
      setShowDiscardProfileChanges(true);
      return;
    }
    restoreCustomerProfileDraft({ exitSettings: true });
  };

  const confirmCustomerProfileDiscard = () => {
    // Discard always resets the form and keeps Profile Settings open.
    // The user can then choose Back to profile to leave the editor.
    restoreCustomerProfileDraft();
  };

  const keepCustomerProfileEditing = () => {
    setShowDiscardProfileChanges(false);
  };

  const performProfileSave = async ({ showErrorInModal = false } = {}) => {
    const setSaveError = showErrorInModal ? setPasswordModalError : setProfileError;

    if (profileForm.phone.trim() && !isValidPhilippinePhone(profileForm.phone)) {
      setSaveError(getPhilippinePhoneError(profileForm.phone));
      return false;
    }

    if (!profileForm.current_password) {
      setSaveError("Please enter your current password to save profile changes.");
      return false;
    }

    if (!profileForm.first_name.trim() || !profileForm.last_name.trim()) {
      setSaveError("Please enter both first name and last name.");
      return false;
    }

    const addressChanged = normalizeFullAddress(profileForm.street_address) !== normalizeFullAddress(user?.street_address);
    if (addressChanged && !isValidStreetAddress(profileForm.street_address)) {
      setSaveError(getStreetAddressError(profileForm.street_address));
      return false;
    }

    if (profileForm.new_password || profileForm.confirm_password) {
      if (!profileForm.new_password) {
        setSaveError("Please enter a new password.");
        return false;
      }

      if (!isPasswordPolicySatisfied(profileForm.new_password)) {
        setSaveError(PASSWORD_POLICY_MESSAGE);
        return false;
      }

      if (profileForm.new_password !== profileForm.confirm_password) {
        setSaveError("New password and confirmation do not match.");
        return false;
      }
    }

    setProfileSaving(true);
    try {
      const payload = {
        first_name: profileForm.first_name.trim(),
        last_name: profileForm.last_name.trim(),
        phone: profileForm.phone.trim(),
        street_address: normalizeFullAddress(profileForm.street_address),
        city: profileForm.city.trim(),
        province: profileForm.province.trim(),
        zip_code: profileForm.zip_code.trim(),
        current_password: profileForm.current_password,
      };

      if (profileForm.new_password) {
        payload.new_password = profileForm.new_password;
      }

      const response = await updateProfile(payload);
      const nextProfile = response.user || user;
      const savedProfile = createCustomerProfileDraft({
        ...nextProfile,
        email: nextProfile?.email || profileForm.email,
        username: nextProfile?.username || profileForm.username,
      });
      profileFormBaselineRef.current = savedProfile;
      setProfileForm(savedProfile);

      try {
        await refreshUser();
      } catch (refreshError) {
        console.warn("Profile refresh after save failed", refreshError);
      }

      setProfileMessage("Profile updated successfully.");
      toast.success("Your profile changes were saved successfully.");
      return true;
    } catch (error) {
      setSaveError(error.data?.message || error.message || "Failed to update profile.");
      return false;
    } finally {
      setProfileSaving(false);
    }
  };

  const handleProfileSave = async () => {
    setProfileError("");
    setPasswordModalError("");
    setProfileMessage("");

    if (!profileHasChanges()) {
      setProfileMessage("No changes to save.");
      return;
    }

    if (!profileForm.current_password) {
      setShowPasswordModal(true);
      return;
    }

    await performProfileSave();
  };

  const openEmailChange = () => {
    setEmailChangeError("");
    setProfileMessage("");
    setEmailChangeForm({ new_email: "", confirm_new_email: "", current_password: "" });
    setEmailChangeOpen(true);
  };

  const closeEmailChange = () => {
    if (emailChangeSaving) return;
    setEmailChangeOpen(false);
    setEmailChangeError("");
  };

  const handleEmailChangeSubmit = async (event) => {
    event.preventDefault();
    if (emailChangeSaving) return;
    setEmailChangeError("");

    const newEmail = emailChangeForm.new_email.trim().toLowerCase();
    const confirmedEmail = emailChangeForm.confirm_new_email.trim().toLowerCase();
    const currentEmail = String(user?.email || profileForm.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setEmailChangeError("Enter a valid new email address.");
      return;
    }
    if (newEmail !== confirmedEmail) {
      setEmailChangeError("The new email address and confirmation do not match.");
      return;
    }
    if (newEmail === currentEmail) {
      setEmailChangeError("The new email address matches your current email.");
      return;
    }
    if (!emailChangeForm.current_password) {
      setEmailChangeError("Enter your current password to continue.");
      return;
    }

    setEmailChangeSaving(true);
    try {
      const response = await requestEmailChange({
        new_email: newEmail,
        current_password: emailChangeForm.current_password,
      });
      setPendingEmail(response.pending_email || newEmail);
      setEmailVerificationCode("");
      setEmailVerifyError("");
      setEmailVerifyMessage(`A verification code has been sent to ${response.pending_email || newEmail}. Enter the code to verify and update your email.`);
      setEmailResendCooldown(60);
      setEmailChangeOpen(false);
      setEmailVerifyOpen(true);
      setEmailChangeForm({ new_email: "", confirm_new_email: "", current_password: "" });
    } catch (error) {
      setEmailChangeError(error.data?.message || error.message || "Unable to request an email change.");
    } finally {
      setEmailChangeSaving(false);
    }
  };

  useEffect(() => {
    if (!emailVerifyOpen) return undefined;
    const cooldownTimer = window.setInterval(() => {
      setEmailResendCooldown((remaining) => Math.max(remaining - 1, 0));
    }, 1000);
    return () => window.clearInterval(cooldownTimer);
  }, [emailVerifyOpen]);

  const handleEmailCodeVerify = async (event) => {
    event.preventDefault();
    if (emailVerifyLoading) return;
    setEmailVerifyError("");
    if (!/^\d{6}$/.test(emailVerificationCode)) {
      setEmailVerifyError("Enter the six-digit verification code.");
      return;
    }

    setEmailVerifyLoading(true);
    try {
      const response = await verifyEmailChangeCode(emailVerificationCode);
      let updatedUser = null;
      try {
        updatedUser = await refreshUser();
      } catch (refreshError) {
        console.warn("Profile refresh after email verification failed", refreshError);
      }
      const verifiedEmail = updatedUser?.email || response.email || pendingEmail;
      profileFormBaselineRef.current = { ...profileFormBaselineRef.current, email: verifiedEmail };
      setProfileForm((current) => ({ ...current, email: verifiedEmail }));
      setEmailVerifyOpen(false);
      setEmailVerificationCode("");
      setPendingEmail("");
      setEmailVerifyMessage("");
      setProfileMessage(response.message || "Your email address has been updated and verified successfully.");
    } catch (error) {
      setEmailVerifyError(error.data?.message || error.message || "Unable to verify the code.");
    } finally {
      setEmailVerifyLoading(false);
    }
  };

  const handleEmailCodeResend = async () => {
    if (emailResending || emailResendCooldown > 0) return;
    setEmailVerifyError("");
    setEmailResending(true);
    try {
      await resendEmailChangeCode();
      setEmailVerificationCode("");
      setEmailResendCooldown(60);
      setEmailVerifyMessage("A new verification code has been sent.");
    } catch (error) {
      const retryAfter = Number(error.data?.retry_after_seconds) || 0;
      if (retryAfter > 0) setEmailResendCooldown(retryAfter);
      setEmailVerifyError(error.data?.message || error.message || "Unable to resend the verification code.");
    } finally {
      setEmailResending(false);
    }
  };

  const closeEmailVerification = () => {
    if (emailVerifyLoading || emailResending) return;
    setEmailVerifyOpen(false);
    setEmailVerificationCode("");
    setEmailVerifyError("");
    setEmailVerifyMessage("");
    setPendingEmail("");
  };

  const openBatchOrderModal = () => {
    if (onlineOrderCooldownActive) {
      setCheckoutError(onlineOrderCooldownMessage);
      return;
    }
    if (cartItems.length === 0) {
      setCheckoutError("Your cart is empty.");
      return;
    }

    if (selectedItemCount === 0) {
      setCheckoutError("Please select at least one product before proceeding to checkout.");
      return;
    }

    setCheckoutError("");
    setCheckoutMessage("");
    setBatchOrderForm({
      phone: profileForm.phone || user?.phone || "",
      shipping_address: normalizeAddress(
        [profileForm.street_address || user?.street_address, profileForm.city || user?.city, profileForm.province || user?.province, profileForm.zip_code || user?.zip_code]
          .filter(Boolean)
          .join(", ")
      ),
      notes: "",
    });
    setActiveTab("products");
    setShowBatchOrderModal(true);
  };

  const closeBatchOrderModal = () => {
    setShowBatchOrderModal(false);
    setShowBatchOrderConfirmModal(false);
    setBatchOrderAgreed(false);
    setActiveTab("cart");
  };
  const requestCloseBatchOrder = () => requestCustomerExit(
    createUnsavedSnapshot(batchOrderForm) !== batchOrderBaselineRef.current,
    closeBatchOrderModal,
  );

  const handleOpenPaymentProofForm = (orderId) => {
    setPaymentProofOpenOrderId(orderId);
    setPaymentProofError("");
    setPaymentProofLoading(false);
    setPaymentProofForm({ amount: "", fileName: "" });
    paymentProofBaselineRef.current = createUnsavedSnapshot({ amount: "", fileName: "" });
  };

  const requestClosePaymentProofForm = () => requestCustomerExit(
    createUnsavedSnapshot(paymentProofForm) !== paymentProofBaselineRef.current,
    () => {
      setPaymentProofOpenOrderId(null);
      setPaymentProofError("");
      setPaymentProofForm({ amount: "", fileName: "" });
    },
  );

  const handleCancelRequest = (order) => {
    if (!order || String(order.status || "").toLowerCase() === "cancelled") return;
    setCancelRequestReason("");
    setCancelRequestReasonError("");
    setCancelRequestModal({ open: true, order });
  };

  const closeCancelRequest = () => {
    setCancelRequestModal({ open: false, order: null });
    setCancelRequestReason("");
    setCancelRequestReasonError("");
  };
  const requestCloseCancelRequest = () => requestCustomerExit(Boolean(cancelRequestReason.trim()), closeCancelRequest);

  const confirmCancelRequest = async () => {
    if (!cancelRequestModal.order || String(cancelRequestModal.order.status || "").toLowerCase() === "cancelled") {
      setCancelRequestModal({ open: false, order: null });
      return;
    }

    const reason = cancelRequestReason.trim();
    if (!reason) {
      setCancelRequestReasonError("Please tell us why you are cancelling this request.");
      return;
    }

    const orderIdentifier = cancelRequestModal.order._id || cancelRequestModal.order.id || cancelRequestModal.order.tracking;

    try {
      setCancelRequestSubmitting(true);
      const response = await cancelCustomerOrder(orderIdentifier, { reason });
      const updatedOrder = response.order || {
        ...cancelRequestModal.order,
        status: "cancelled",
      };

      setOrders((prevOrders) =>
        prevOrders.map((order) => {
          const currentOrderId = order._id || order.id || order.tracking;
          return currentOrderId === orderIdentifier ? { ...order, ...updatedOrder, status: updatedOrder.status || "cancelled" } : order;
        })
      );

      setExpandedOrderId((prev) => (prev === orderIdentifier ? null : prev));
      setCancelRequestModal({ open: false, order: null });
      setCancelRequestReason("");
      setCancelRequestReasonError("");
      await refreshUser().catch(() => {});
      toast.success(withAdminContactPhone(response.message || "Order request cancelled."));
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Unable to cancel this order request.");
    } finally {
      setCancelRequestSubmitting(false);
    }
  };

  const handlePaymentProofFileChange = (event) => {
    const file = event.target.files && event.target.files[0];
    setPaymentProofForm((prev) => ({
      ...prev,
      file,
      fileName: file ? file.name : "",
    }));
    if (file) setPaymentProofError("");
  };

  const openCustomerPaymentProofPreview = (proofUrl, fileName = "Payment proof") => {
    const url = ensureAbsoluteUrl(proofUrl);
    if (!url) return;
    setCustomerPaymentProofPreview({
      url,
      fileName,
      isPdf: /\.pdf(?:$|[?#])/i.test(`${fileName} ${url}`),
    });
  };

  const viewAdminPaymentSupportingDocument = async (orderId, recordId, document) => {
    const documentKey = String(document._id || "");
    if (!documentKey || adminPaymentDocumentLoadingId) return;
    setAdminPaymentDocumentLoadingId(documentKey);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `${API_BASE}/orders/${encodeURIComponent(orderId)}/payment-records/${encodeURIComponent(recordId)}/documents/${encodeURIComponent(documentKey)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Unable to view the admin supporting document.");
      }
      const fileUrl = URL.createObjectURL(await response.blob());
      setCustomerPaymentProofPreview({
        url: fileUrl,
        fileName: document.original_name || "Admin supporting document",
        isPdf: document.format === "pdf",
        isPrivateDocument: true,
      });
    } catch (error) {
      toast.error(error.message || "Unable to view the admin supporting document.");
    } finally {
      setAdminPaymentDocumentLoadingId("");
    }
  };

  const submitPaymentProof = async (order) => {
    if (paymentProofSubmittingRef.current) return;

    if (!paymentProofForm.file) {
      setPaymentProofError("A payment proof image or PDF is required.");
      return;
    }

    const paymentSummary = getPaymentSummary(order);
    const amountValidation = validateCustomerPaymentAmount(
      paymentProofForm.amount,
      paymentSummary.remainingAmount,
      paymentSummary.downpaymentRemaining,
    );
    if (!amountValidation.valid) {
      setPaymentProofError(amountValidation.message);
      return;
    }
    const normalizedAmount = amountValidation.amount;
    if (getCustomerPaymentProof(order).status === "pending" || (!order.payment_ledger_initialized && order.payment_proof_submitted_at && !isPaymentProofConfirmed(order))) {
      setPaymentProofError("Your previous payment is awaiting confirmation before another payment can be submitted.");
      return;
    }

    paymentProofSubmittingRef.current = true;
    setPaymentProofLoading(true);
    setPaymentProofError("");

    const orderId = order?._id || order?.id || order?.tracking;

    try {
      let uploadedFileName = paymentProofForm.fileName || "";
      let uploadedFileUrl = "";

      if (paymentProofForm.file) {
        const uploadResult = await uploadFiles([paymentProofForm.file], undefined, { purpose: "payment-proofs" });
        const uploadedFile = uploadResult?.files?.[0];
        uploadedFileName = uploadedFile?.originalName || uploadedFile?.filename || paymentProofForm.fileName || "";
        uploadedFileUrl = uploadedFile?.url || "";
      }

      const response = await apiFetch(`/orders/${orderId}/payment-proof`, {
        method: "PUT",
        body: JSON.stringify({
          amount: normalizedAmount,
          payment_method: "Cash",
          proof_file_name: uploadedFileName,
          proof_file_url: uploadedFileUrl,
        }),
      });

      const savedOrder = response.order || {
        ...order,
        payment_status: paymentSummary.status.key,
        payment_proof_amount: normalizedAmount,
        payment_proof_file_name: uploadedFileName,
        payment_proof_file_url: uploadedFileUrl,
        payment_method: "Cash",
      };
      const savedPaymentStatus = savedOrder.payment_status || paymentSummary.status.key;

      setOrders((prev) =>
        prev.map((entry) => {
          const entryId = entry?._id || entry?.id || entry?.tracking;
          if (entryId === orderId) {
            return {
              ...entry,
              ...savedOrder,
              payment_status: savedPaymentStatus,
              payment_proof_amount: normalizedAmount,
              payment_proof_file_name: uploadedFileName,
              payment_proof_file_url: uploadedFileUrl,
              payment_method: savedOrder.payment_method || "Cash",
            };
          }
          return entry;
        })
      );

      if (selectedOrderForModal && (selectedOrderForModal?._id || selectedOrderForModal?.id || selectedOrderForModal?.tracking) === orderId) {
        setSelectedOrderForModal((prev) =>
          prev
            ? {
                ...prev,
                ...savedOrder,
                payment_status: savedPaymentStatus,
                payment_proof_amount: normalizedAmount,
                payment_proof_file_name: uploadedFileName,
                payment_proof_file_url: uploadedFileUrl,
                payment_method: savedOrder.payment_method || "Cash",
              }
            : prev
        );
      }

      setPaymentProofSuccessByOrder((prev) => ({
        ...prev,
        [orderId]: {
          amount: normalizedAmount,
          fileName: uploadedFileName,
          fileUrl: uploadedFileUrl,
        },
      }));

      toast.success(response.message || "Payment proof submitted successfully.");
      setPaymentProofOpenOrderId(null);
      setPaymentProofForm({ amount: "", fileName: "", file: null });
    } catch (error) {
      setPaymentProofError(error?.message || "Unable to submit payment proof.");
    } finally {
      paymentProofSubmittingRef.current = false;
      setPaymentProofLoading(false);
    }
  };

  const handleCheckout = () => {
    if (onlineOrderCooldownActive) {
      setCheckoutError(onlineOrderCooldownMessage);
      return;
    }
    if (cartItems.length === 0) {
      setCheckoutError("Your cart is empty.");
      return;
    }

    if (selectedItemCount === 0) {
      setCheckoutError("Please select at least one product before proceeding to checkout.");
      return;
    }

    setCheckoutError("");
    setCheckoutMessage("");
    setBatchOrderAgreed(false);
    setShowBatchOrderModal(false);
    setShowBatchOrderConfirmModal(true);
  };

  const handleCancelBatchOrderConfirm = () => {
    setShowBatchOrderConfirmModal(false);
    setBatchOrderAgreed(false);
    setShowBatchOrderModal(true);
  };

  const handleConfirmBatchOrder = async () => {
    if (onlineOrderCooldownUntil && onlineOrderCooldownUntil.getTime() > Date.now()) {
      setCheckoutError(onlineOrderCooldownMessage);
      return;
    }
    if (!batchOrderAgreed) return;
    const checkoutAddress = normalizeFullAddress(batchOrderForm.shipping_address || buildFullAddress(user));
    if (!checkoutAddress || !isValidStreetAddress(checkoutAddress)) {
      setCheckoutError(getStreetAddressError(checkoutAddress) || "Please enter a full installation address.");
      return;
    }
    if (!isValidPhilippinePhone(batchOrderForm.phone)) {
      setCheckoutError(getPhilippinePhoneError(batchOrderForm.phone));
      return;
    }
    setCheckoutLoading(true);
    try {
      await cartSaveQueueRef.current;
      const checkedOutCartIds = [...new Set(selectedCartItems.map((item) => String(item.cartId || "")).filter(Boolean))];
      if (checkedOutCartIds.length !== selectedCartItems.length) {
        throw new Error("Some selected cart items are missing their cart IDs. Refresh your cart and try again.");
      }

      const orderItems = selectedCartItems.map((item) => {
        const { product, item: pricingItem } = getCartPricingContext(item);
        return buildCustomerOrderItem(product, {
          quantity: item.quantity,
          width: item.dimensions?.width ?? item.width,
          height: item.dimensions?.height ?? item.height,
          measurementUnit: item.dimensions?.unit || item.measurementUnit || item.measurement_unit,
          customized: item.dimensions?.customized ?? item.customized ?? item.is_estimate,
          area: item.area,
          estimated_price: item.estimated_price,
          notes: batchOrderForm.notes.trim() || item.notes,
          is_estimate: item.is_estimate,
          blade_glass_type: pricingItem.blade_glass_type,
          sale_mode: pricingItem.sale_mode,
          frame_type: pricingItem.frame_type,
          custom_frame_size: pricingItem.custom_frame_size,
          frame_price: pricingItem.frame_price,
          blade_count: pricingItem.blade_count,
          extra_charges: pricingItem.extra_charges,
        });
      });

      if (orderItems.some((item) => !hasValidOrderItemPricingDimensions(item))) {
        setCheckoutError("Please provide valid product dimensions before submitting your order.");
        return;
      }

      const response = await createOrder({
        items: orderItems,
        cart_item_ids: checkedOutCartIds,
        shipping_address: normalizeFullAddress(batchOrderForm.shipping_address || buildFullAddress(user)),
        customer_phone: batchOrderForm.phone.trim(),
      });

      const checkedOutIds = new Set(checkedOutCartIds);
      const remainingItems = cartItemsRef.current.filter((item) => !checkedOutIds.has(String(item.cartId)));
      cartItemsRef.current = remainingItems;
      setCartItems(remainingItems);
      try {
        localStorage.setItem("customerCart", JSON.stringify(remainingItems));
      } catch (storageError) {
        console.warn("Unable to update the local cart cache after checkout.", storageError);
      }

      try {
        const refreshedCart = await getCart();
        const refreshedItems = Array.isArray(refreshedCart.items)
          ? refreshedCart.items.map((item) => ({ ...item, selected: item.selected !== false }))
          : remainingItems;
        cartItemsRef.current = refreshedItems;
        setCartItems(refreshedItems);
        localStorage.setItem("customerCart", JSON.stringify(refreshedItems));
      } catch (refreshError) {
        console.warn("Unable to refresh the cart after checkout; keeping the server-confirmed removal locally.", refreshError);
      }

      setCheckoutMessageFading(false);
      setCheckoutMessage(getOrderSubmissionMessage(response, "Order placed"));
      addCreatedOrderToMyOrders(response.order);
      setBatchSuccessItemCount(
        Array.isArray(response.order?.items) ? response.order.items.length : orderItems.length
      );
      setBatchSuccessItems(orderItems);
      setShowBatchSuccessModal(true);
      setShowBatchOrderModal(false);
      setShowBatchOrderConfirmModal(false);
      setBatchOrderAgreed(false);
    } catch (error) {
      setCheckoutError(error.data?.message || error.message || "Failed to place order.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const getProductPrice = (product) => {
    if (!product) return "Contact us";
    if (["blade", "per_blade"].includes(String(product.pricing_method || product.unit || "").toLowerCase())) {
      const defaultPrice = getDefaultProductLineTotal(product);
      return defaultPrice > 0 ? formatCurrency(defaultPrice) : "Contact us";
    }
    if (["per_piece", "piece", "per_set", "set"].includes(String(product.pricing_method || product.unit || "").toLowerCase())) {
      const basePrice = Number(product.estimated_price_override || product.base_price || product.unit_price || product.estimated_price) || 0;
      return basePrice > 0 ? formatCurrency(basePrice) : "Contact us";
    }
    const override = Number(product.estimated_price_override) || 0;
    if (override > 0) {
      const defaultPrice = getProductLineTotal(product, {
        ...getProductDefaultDimensions(product, 1),
        blade_glass_type: product.default_blade_glass_type,
        sale_mode: product.default_sale_mode,
        frame_type: product.default_frame_type,
        blade_count: Number(product.blade_count) || Number(product.minimum_blades) || 1,
        extra_charges: getDefaultExtraChargeSelections(product),
      });
      return formatCurrency(defaultPrice);
    }
    if (product.pricing_method === "blade" || product.unit === "per_blade") {
      const bladeRates = (product.blade_glass_types || [])
        .map((glass) => Number(glass.price_per_blade) || 0)
        .filter((price) => price > 0);
      const lowestBladeRate = bladeRates.length
        ? Math.min(...bladeRates)
        : Number(product.price_per_blade || product.unit_price) || 0;
      if (lowestBladeRate > 0) return `${formatCurrency(lowestBladeRate)} / blade`;
    }
    const dimensions = getProductDefaultDimensions(product, 1);
    const price = getProductLineTotal(product, dimensions);
    return price > 0 ? formatCurrency(price) : "Contact us";
  };

  const getProductEstimateRate = (product, selections = {}) => {
    const pricingMethod = String(product?.pricing_method || "").toLowerCase();
    const legacyUnit = String(product?.unit || "").toLowerCase();
    if (pricingMethod === "per_meter" || (!pricingMethod && legacyUnit === "per_meter")) {
      return Number(product?.unit_price) || undefined;
    }
    if (pricingMethod === "per_piece" || (!pricingMethod && ["per_piece", "per_set"].includes(legacyUnit))) {
      return Number(product?.estimated_price_override || product?.base_price || product?.unit_price || product?.estimated_price) || undefined;
    }
    if (pricingMethod === "sqft" || (!pricingMethod && legacyUnit === "per_sqft")) {
      return Number(product?.price_per_sqft) || undefined;
    }
    if (pricingMethod === "blade" || (!pricingMethod && legacyUnit === "per_blade")) {
      return Number(product?.price_per_blade) || undefined;
    }
    return undefined;
  };

  const getProductUnitRate = (product) => {
    const pricePerSqft = Number(product.price_per_sqft) || 0;
    const pricePerBlade = Number(product.price_per_blade) || 0;
    const unitPrice = Number(product.unit_price) || 0;
    const unitKey = product.unit || product.pricing_method || "unit";
    const unitLabels = {
      per_sqft: "sq ft",
      sqft: "sq ft",
      per_blade: "blade",
      blade: "blade",
      per_piece: "piece",
      piece: "piece",
      per_meter: "meter",
      meter: "meter",
      per_set: "set",
      set: "set",
    };
    const label = unitLabels[unitKey] || unitKey;

    if (product.pricing_method === "sqft" && pricePerSqft > 0) {
      return `₱${pricePerSqft.toLocaleString()} / ${label}`;
    }
    if (product.pricing_method === "sqft" && Number(product.area_options?.[0]?.price_per_sqft) > 0) {
      return `Variant from ₱${Number(product.area_options[0].price_per_sqft).toLocaleString()} / item`;
    }
    if (product.pricing_method === "blade" && pricePerBlade > 0) {
      if (product.show_price_per_blade === false) return `Starting from ${getProductPrice(product)}`;
      return `₱${pricePerBlade.toLocaleString()} / ${label}`;
    }
    if (pricePerSqft > 0 && label === "sq ft") {
      return `₱${pricePerSqft.toLocaleString()} / ${label}`;
    }
    if (pricePerBlade > 0 && label === "blade") {
      return `₱${pricePerBlade.toLocaleString()} / ${label}`;
    }
    if (unitPrice > 0) {
      return `₱${unitPrice.toLocaleString()} / ${label}`;
    }
    return "Contact us";
  };

  const getCartItemMeasurementDetails = (item) => {
    const width = Number(item.width ?? item.dimensions?.width ?? 0);
    const height = Number(item.height ?? item.dimensions?.height ?? 0);
    const measurementUnit = item.measurementUnit || item.measurement_unit || item.dimensions?.unit || item.unit || "in";
    const rawArea = Number(item.area ?? item.dimensions?.area ?? 0);
    const estimatedPrice = Number(item.estimated_price || 0);
    const quantity = Number(item.quantity || 1);
    const pricingMethod = String(item.pricing_method || item.unit || "").toLowerCase();

    if ((pricingMethod === "per_meter" || pricingMethod === "meter") && width > 0) {
      const toMetersFactor = { in: 0.0254, ft: 0.3048, cm: 0.01, m: 1 };
      const totalLengthMeters = width * (toMetersFactor[measurementUnit] || 1) * quantity;
      return {
        dimensions: `Length ${width} ${measurementUnit}`,
        area: `${totalLengthMeters.toLocaleString(undefined, { maximumFractionDigits: 2 })} m total`,
        unitRate: `₱${Number(item.unit_price || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}/m`,
      };
    }

    if (!width || !height) return null;

    const areaInSqFt =
      rawArea > 0
        ? rawArea
        : measurementUnit === "in"
          ? (width * height * quantity) / 144
          : measurementUnit === "ft"
            ? width * height * quantity
            : measurementUnit === "cm"
              ? (width * height * quantity) / 929.0304
              : measurementUnit === "m"
                ? (width * height * quantity) * 10.7639
                : width * height * quantity;

    const ratePerSqFt =
      Number(item.unit_price) > 0
        ? Number(item.unit_price)
        : areaInSqFt > 0
          ? estimatedPrice / areaInSqFt
          : 0;

    const unitSymbol = measurementUnit === "in" ? '"' : measurementUnit === "ft" ? "'" : measurementUnit === "cm" ? "cm" : measurementUnit === "m" ? "m" : "";

    return {
      dimensions: `${width}${unitSymbol} x ${height}${unitSymbol}`,
      area: `${areaInSqFt > 0 ? areaInSqFt.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0"} sq.ft`,
      unitRate: `₱${Number(ratePerSqFt || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}/sq.ft`,
    };
  };

  function getCartPricingContext(item) {
    const productId = item.product_id || item._id || item.product?._id || item.product?.id;
    const product = cartPricingProducts.find((candidate) => String(candidate._id || candidate.id) === String(productId)) || item;
    const currentCharges = getDefaultExtraChargeSelections(product);
    const previousCharges = Array.isArray(item.extra_charges) ? item.extra_charges : [];
    const extraCharges = currentCharges.map((charge, index) => {
      const previous = previousCharges.find((candidate) => candidate.name === charge.name) || previousCharges[index];
      return {
        ...charge,
        is_selected: charge.is_optional === true
          ? (typeof previous?.is_selected === "boolean" ? previous.is_selected : false)
          : true,
      };
    });
    if (!isBladePricingProduct(product)) return { product, item: { ...item, extra_charges: extraCharges } };

    const glassTypes = Array.isArray(product.blade_glass_types) ? product.blade_glass_types : [];
    const frameTypes = Array.isArray(product.blade_frame_types) ? product.blade_frame_types : [];
    const selectedSaleMode = item.sale_mode || product.default_sale_mode || (product.sell_blades_only === false ? "frame" : "blades_only");
    const saleMode = selectedSaleMode === "frame" && !product.sell_with_frame ? "blades_only" : selectedSaleMode;
    const defaultFrame = frameTypes.find((candidate) => candidate.name === product.default_frame_type) || frameTypes[0];
    const requestedFrameBladeCount = Number(item.frame_blade_count) || 0;
    const frame = frameTypes.find((candidate) => candidate.name === (item.frame_type || defaultFrame?.name)
      && (!requestedFrameBladeCount || Number(candidate.blade_count) === requestedFrameBladeCount))
      || frameTypes.find((candidate) => candidate.name === (item.frame_type || defaultFrame?.name))
      || defaultFrame;
    const customFrameSize = Boolean(item.custom_frame_size && product.allow_custom_frame_size);
    const bladeCount = getDefaultBladeCount(product, {
      sale_mode: saleMode,
      frame_type: frame?.name,
      frame_blade_count: Number(frame?.blade_count) || 0,
      custom_frame_size: customFrameSize,
      blade_count: item.blade_count,
    });
    const selectedGlassExists = glassTypes.some((candidate) => candidate.name === item.blade_glass_type);
    const glassName = selectedGlassExists
      ? item.blade_glass_type
      : product.default_blade_glass_type || glassTypes[0]?.name || "";
    const pricingItem = {
      ...item,
      quantity: Math.max(1, Number(item.quantity) || 1),
      blade_glass_type: glassName,
      sale_mode: saleMode,
      frame_type: frame?.name || "",
      custom_frame_size: customFrameSize,
      frame_price: saleMode === "frame"
        ? Number(customFrameSize ? product.custom_frame_price : frame?.price) || 0
        : 0,
      blade_count: bladeCount,
      extra_charges: extraCharges,
    };
    return { product, item: pricingItem };
  }

  const getCartBladePriceBreakdown = (item) => {
    const { product, item: pricingItem } = getCartPricingContext(item);
    const hasOverride = Number(product.estimated_price_override) > 0;
    const breakdown = getProductLineBreakdown(product, {
      ...pricingItem,
      quantity: Math.max(1, Number(item.quantity || item.dimensions?.quantity) || 1),
      width: item.dimensions?.width ?? item.width,
      height: item.dimensions?.height ?? item.height,
      measurement_unit: item.dimensions?.unit || item.measurement_unit || item.measurementUnit || "in",
    });
    const details = [];
    if (isBladePricingProduct(product) && !hasOverride) {
    const glassTypes = Array.isArray(product.blade_glass_types) ? product.blade_glass_types : [];
    const frameTypes = Array.isArray(product.blade_frame_types) ? product.blade_frame_types : [];
    const glass = glassTypes.find((candidate) => candidate.name === pricingItem.blade_glass_type);
    const frame = frameTypes.find((candidate) => candidate.name === pricingItem.frame_type);
    const bladeCount = Number(pricingItem.blade_count) || 1;
    const bladeRate = Number(glass?.price_per_blade ?? product.price_per_blade) || 0;
    const saleMode = pricingItem.sale_mode;
    const frameName = pricingItem.custom_frame_size ? "Custom frame" : frame?.name || "Frame";
    const framePrice = Number(pricingItem.frame_price) || 0;
    details.push(`${pricingItem.blade_glass_type || "Glass"}${saleMode === "frame" ? ` · ${frameName} frame` : ""} · ${bladeCount} blade${bladeCount === 1 ? "" : "s"}`);
    if (bladeRate > 0) details.push(`${formatCurrency(bladeRate)}/blade`);
    if (framePrice > 0) details.push(`+ Frame (${frameName}): ${formatCurrency(framePrice)}`);
    }
    if (hasOverride) details.push(`Product base price: ${formatCurrency(product.estimated_price_override)}`);
    breakdown.extraCharges.forEach((charge) => {
      if (charge.total > 0) details.push(`+ ${charge.name}: ${formatCurrency(charge.total)}`);
    });
    return details;
  };

  const getProductImage = (product, width = 640) => {
    const source = getProductImageSource(product);
    return source ? getOptimizedProductImageUrl(ensureAbsoluteUrl(source), width) : "";
  };

  const getProductImages = (product) => {
    if (!product) return [{ url: PRODUCT_IMAGE_PLACEHOLDER, label: "Main photo" }];

    const images = [];
    const seen = new Set();
    const addImage = (value, label) => {
      if (Array.isArray(value)) {
        value.forEach((item) => addImage(item, label));
        return;
      }
      const rawUrl = typeof value === "object" && value ? value.url : value;
      if (typeof rawUrl !== "string" || !rawUrl.trim()) return;
      const url = getOptimizedProductImageUrl(ensureAbsoluteUrl(rawUrl), 1200);
      if (seen.has(url) || url === PRODUCT_IMAGE_PLACEHOLDER) return;
      seen.add(url);
      images.push({ url, label });
    };

    addImage(product.image_url, "Main photo");
    addImage(product.image, "Main photo");
    if (product.images && typeof product.images === "object") {
      Object.entries(product.images).forEach(([key, value]) => {
        const label = key === "main" ? "Main photo" : `${key.charAt(0).toUpperCase()}${key.slice(1)} angle`;
        addImage(value, label);
      });
    }

    return images.length ? images : [{ url: PRODUCT_IMAGE_PLACEHOLDER, label: "Product photo" }];
  };

  function getOrderItemImage(item) {
    if (!item) return PRODUCT_IMAGE_PLACEHOLDER;
    let candidate = null;
    if (item.image_url) candidate = item.image_url;
    if (!candidate) candidate = getProductImage(item);
    const productReference = item.product_id || item.product;
    const productId = typeof productReference === "object"
      ? productReference?._id || productReference?.id
      : productReference;
    const product = typeof productReference === "object"
      ? productReference
      : products.find((entry) => String(entry._id || entry.id) === String(productId));
    if (!candidate && product) candidate = getProductImage(product);
    return ensureAbsoluteUrl(candidate);
  }

  const renderOrderConfirmationProducts = (items) => {
    const orderedItems = Array.isArray(items) ? items : [];
    if (!orderedItems.length) return null;

    return (
      <div className="order-success-items" role="list" aria-label="Ordered products">
        {orderedItems.map((item, index) => {
          const productName = item.name || item.product_name || item.product_type || "Product";
          const productId = item.product_id?._id || item.product_id || item._id || productName;
          return (
            <div
              key={`${productId}-${index}`}
              role="listitem"
              className="order-success-item"
              style={{ animationDelay: `${Math.min(index, 3) * 0.08}s` }}
            >
              <div className="order-success-image-wrap">
                <img
                  src={getOrderItemImage(item)}
                  alt={productName}
                  onError={handleProductImageError}
                  className="order-success-image"
                />
                <span className="order-success-quantity">
                  Qty {Math.max(1, Number(item.quantity) || 1)}
                </span>
                <span className="order-success-item-check" aria-hidden="true">
                  <Check size={12} strokeWidth={3} />
                </span>
              </div>
              <p className="order-success-item-name">{productName}</p>
            </div>
          );
        })}
      </div>
    );
  };

  function formatCurrency(amount) {
    return `₱${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatRequiredPaymentAmount(amount) {
    const roundedAmount = Math.round(Number(amount || 0) * 100) / 100;
    return `₱${roundedAmount.toLocaleString(undefined, {
      minimumFractionDigits: Number.isInteger(roundedAmount) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function getItemPriceValue(item) {
    if (!item) return 0;

    if (item.cartId) {
      const { product: currentProduct, item: pricingItem } = getCartPricingContext(item);
      return getProductLineTotal(currentProduct, {
        ...pricingItem,
        quantity: item.quantity || item.dimensions?.quantity || 1,
        width: item.dimensions?.width ?? item.width,
        height: item.dimensions?.height ?? item.height,
        measurement_unit: item.dimensions?.unit || item.measurement_unit || item.measurementUnit || "in",
        customized: item.dimensions?.customized ?? item.customized ?? item.is_estimate,
      });
    }
    if (Number(item.line_total) > 0) {
      return Number(item.line_total);
    }

    const quantity = Number(item.quantity || item.qty || 1) || 1;
    const normalizedArea = Number(item.area || 0) || 0;
    const itemHeight = Number(item.height ?? item.dimensions?.height ?? 0) || 0;
    const itemWidth = Number(item.width ?? item.dimensions?.width ?? 0) || 0;
    const derivedArea = normalizedArea || (itemWidth && itemHeight ? itemWidth * itemHeight / 144 : 0);
    const productRate = Number(
      item.price_per_sqft ??
      item.product?.price_per_sqft ??
      item.product_id?.price_per_sqft ??
      0
    ) || 0;
    const productUnitPrice = Number(
      item.unit_price ??
      item.price ??
      item.amount ??
      item.product?.unit_price ??
      item.product_id?.unit_price ??
      0
    ) || 0;

    if (item.is_estimate && Number(item.estimated_price || item.manual_estimated_total || 0) > 0) {
      return Number(item.estimated_price || item.manual_estimated_total || 0);
    }

    if (Number(item.amount || item.total_price || 0) > 0) {
      return Number(item.amount || item.total_price || 0);
    }

    if (productRate > 0 && derivedArea > 0) {
      return productRate * derivedArea * quantity;
    }

    if (productUnitPrice > 0) {
      return productUnitPrice * quantity;
    }

    if (Number(item.unit_price || 0) > 0) {
      return Number(item.unit_price || 0) * quantity;
    }

    return 0;
  }

  function getOrderTotalValue(order) {
    if (!order) return 0;

    const savedTotal = getFinalProjectCost(order);
    if (savedTotal > 0) return savedTotal;

    const orderItems = Array.isArray(order.items) ? order.items : [];
    if (orderItems.length > 0) {
      return orderItems.reduce((sum, item) => sum + getItemPriceValue(item), 0);
    }

    return Number(order.total_amount || 0);
  };

  const getConfirmationItemDimensionText = (item) => {
    return formatOrderItemMeasurements(item);
  };

  const getConfirmationItemDimensions = (item) => {
    const product = item?.product_id && typeof item.product_id === "object"
      ? item.product_id
      : item?.product || {};
    const dimensions = item?.dimensions || {};
    const productDimensions = product?.dimensions || {};
    const width = Number(dimensions.width ?? item?.width ?? productDimensions.width ?? product?.width) || 0;
    const height = Number(dimensions.height ?? item?.height ?? productDimensions.height ?? product?.height) || 0;
    const unit = String(
      dimensions.unit || item?.measurementUnit || item?.measurement_unit ||
      productDimensions.unit || product?.measurementUnit || product?.measurement_unit || "in"
    ).toLowerCase();
    const unitLabel = unit === "in" ? '"' : ` ${unit}`;
    const quantity = Math.max(1, Number(item?.quantity || item?.qty || dimensions.quantity) || 1);
    const area = Number(item?.area || dimensions.area) || (
      unit === "in" ? (width * height * quantity) / 144
        : unit === "cm" ? (width * height * quantity) / 929.0304
          : unit === "m" ? width * height * quantity * 10.7639
            : width * height * quantity
    );

    if (!(width > 0 && height > 0)) return null;
    return {
      width: `${width.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unitLabel}`,
      height: `${height.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unitLabel}`,
      area: area.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    };
  };

  function isBladePricingProduct(product) {
    return ["blade", "per_blade"].includes(String(product?.pricing_method || product?.unit || "").toLowerCase());
  }

  const getBladeOrderSummaryText = (product, selections = {}, quantity = 1) => {
    if (!isBladePricingProduct(product)) return "";

    return formatOrderItemMeasurements({
      ...product,
      pricing_method: product?.pricing_method || "blade",
      unit: product?.unit || "per_blade",
      quantity: Math.max(1, Number(quantity) || 1),
      blade_glass_type: selections.blade_glass_type || product?.default_blade_glass_type || "",
      sale_mode: selections.sale_mode || product?.default_sale_mode || "blades_only",
      frame_type: selections.frame_type || product?.default_frame_type || "",
      custom_frame_size: Boolean(selections.custom_frame_size),
      blade_count: Number(selections.blade_count) || Number(product?.blade_count) || Number(product?.minimum_blades) || 1,
      blade_frame_types: product?.blade_frame_types || [],
      minimum_blades: product?.minimum_blades,
    });
  };

  const getOrderMeasurementRows = (order) => {
    if (!order || !Array.isArray(order.items)) return [];

    return order.items.map((item, index) => {
      const dimensions = item?.dimensions || {};
      const width = Number(dimensions.width ?? item.width ?? 0) || 0;
      const height = Number(dimensions.height ?? item.height ?? 0) || 0;
      const quantity = Number(item.quantity || item.qty || 1) || 1;
      const unit = String(dimensions.unit || item.measurement_unit || item.measurementUnit || "in");
      const area = Number(item.area || (width * height * quantity) || 0) || 0;
      const label = item.name || item.product_name || item.product?.name || `Project item ${index + 1}`;

      return {
        label,
        quantity,
        width,
        height,
        unit,
        area,
      };
    }).filter((row) => row.width > 0 || row.height > 0);
  };

  const buildContractDataFromOrder = (order) => {
    if (!order) return null;

    const amount = getFinalProjectCost(order);
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

    const contractStatusRaw = String(order.contract_status || "").trim();
    const orderStatusKey = normalizeOrderStatusKey(order?.status);
    const contractStatus = contractStatusRaw
      ? contractStatusRaw.replace(/_/g, " ")
      : (["contract_sent", "contract_accepted", "contract_declined"].includes(orderStatusKey))
        ? String(order.status).replace(/_/g, " ")
        : "No contract yet";

    const accepted = hasCustomerAcceptedContract(order);

    return {
      orderNumber: order.tracking || order._id || "N/A",
      contractDate: formatDateToMMMDDYYYY(order.updatedAt || order.createdAt) || "N/A",
      orderDate: formatDateToMMMDDYYYY(order.createdAt) || "N/A",
      status: order.status?.replace(/_/g, " ") || "Pending",
      orderStatus: order.status || "",
      rawContractStatus: order.contract_status || "",
      contractStatus,
      customerName: order.customer?.first_name || order.customer_name || "Customer",
      customerEmail: order.customer?.email || order.customer_email || "N/A",
      customerPhone: order.customer?.phone || order.customer_phone || "N/A",
      projectLocation: order.shipping_address || "N/A",
      siteInspectionDate: formatDateToMMMDDYYYY(order.inspection_date) || "TBD",
      paymentTerms: order.payment_terms || "Standard payment terms apply.",
      contractTerms: order.contract_terms || "",
      subtotal: amount,
      totalProjectCost: amount,
      downPayment,
      items,
      accepted,
      acceptanceMethod: accepted ? order.acceptanceMethod || (order.acceptance_method === "walk_in_signed_contract" ? "Walk-in Signed Contract" : "Online Acceptance") : null,
      acceptanceDate: accepted && (order.acceptedAt || order.contract_signed_date || order.updatedAt)
        ? formatDateTimeToMMMDDYYYY(order.acceptedAt || order.contract_signed_date || order.updatedAt)
        : null,
      acceptedBy: order.customer?.first_name || order.customer_name || "Customer",
      contractId: order.tracking || order._id || "N/A",
      customerAccountId: order.customer?._id || order.customer || "N/A",
    };
  };

  const openContractModal = (order, notificationRecordId = null) => {
    if (!order || !canShowContractForOrder(order)) return;
    setContractPreviewOrder(order);
    setContractNotificationRecordId(notificationRecordId);
    setShowContractModal(true);
  };

  const closeContractModal = () => {
    setShowContractModal(false);
    setContractPreviewOrder(null);
    setContractNotificationRecordId(null);
  };

  const contractPreviewData = contractPreviewOrder
    ? buildContractDataFromOrder(contractPreviewOrder)
    : null;
  const isContractAccepted = contractPreviewOrder ? hasCustomerAcceptedContract(contractPreviewOrder) : false;
  const previewStatus = normalizeOrderStatusKey(contractPreviewOrder?.status);
  const previewContractStatus = normalizeOrderStatusKey(contractPreviewOrder?.contract_status);
  const isContractAwaitingCustomerResponse = Boolean(contractPreviewOrder)
    && !isContractAccepted
    && contractPreviewOrder.order_type !== "walk_in_customer"
    && Boolean(contractPreviewOrder.contractSentAt || previewContractStatus === "sent" || previewStatus === "contract_sent" || ((previewContractStatus === "accepted" || previewStatus === "contract_accepted") && contractPreviewOrder.contractSentAt));

  const createContractExportClone = () => {
    const element = document.getElementById("contract-content");
    if (!element) return null;

    const clone = element.cloneNode(true);
    clone.style.width = "794px";
    clone.style.height = "auto";
    clone.style.maxHeight = "none";
    clone.style.overflow = "visible";
    clone.style.position = "relative";
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

    return { wrapper, clone };
  };

  const downloadAcceptedContractPNG = async () => {
    const exportClone = createContractExportClone();
    if (!exportClone) {
      toast.error("Unable to locate the accepted contract.");
      return;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataUrl = await toPng(exportClone.clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `accepted-contract-${contractPreviewOrder?.tracking || contractPreviewOrder?._id || "export"}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Failed to export accepted contract PNG", error);
      toast.error("Failed to save the accepted contract as PNG.");
    } finally {
      exportClone.wrapper.remove();
    }
  };

  const printAcceptedContract = async () => {
    const exportClone = createContractExportClone();
    if (!exportClone) {
      toast.error("Unable to locate the accepted contract.");
      return;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dataUrl = await toPng(exportClone.clone, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast.error("Please allow popups to print the accepted contract.");
        return;
      }
      printWindow.document.write(`<!doctype html><html><head><title>Accepted Contract</title><style>@page{size:A4 portrait;margin:10mm;}html,body{margin:0;padding:0;background:#fff;}img{width:100%;height:auto;display:block;print-color-adjust:exact;-webkit-print-color-adjust:exact;}</style></head><body><img src="${dataUrl}" alt="Accepted contract" /></body></html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.onload = () => printWindow.print();
    } catch (error) {
      console.error("Failed to print accepted contract", error);
      toast.error("Failed to print the accepted contract.");
    } finally {
      exportClone.wrapper.remove();
    }
  };

  const getContractStatusLabel = (order) => {
    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
    const orderStatus = normalizeOrderStatusKey(order?.status);

    if (hasCustomerAcceptedContract(order)) return "Accepted";
    if (contractStatus === "sent" || orderStatus === "contract_sent" || (order?.contractSentAt && (contractStatus === "accepted" || orderStatus === "contract_accepted"))) return "Awaiting Contract Sign-off";
    if (contractStatus === "declined" || orderStatus === "contract_declined") return "Declined";
    return normalizeOrderStatus(order?.contract_status) || normalizeOrderStatus(order?.status) || "Unknown";
  };

  const getOrderProgressPercent = (order) => {
    if (!order || normalizeOrderStatusKey(order?.status) === "cancelled") return 0;

    const steps = buildOrderTimelineStages(order).filter((step) => step.key !== "installation_agreement");
    return calculateStageProgressPercent(steps);
  };

  const activeOrdersCount = orders.filter(isCustomerActiveOrder).length;
  const pendingOrdersCount = orders.filter(isCustomerPendingOrder).length;
  const completedProjectsCount = orders.filter(isOrderStatusCompleted).length;

  const getOrderIdentifier = (order, fallback = "") => {
    const id = order?._id ?? order?.id ?? order?.tracking ?? fallback;
    return typeof id === "string" && id.trim() ? id : fallback || "unknown-order";
  };

  const filteredOrders = orders.filter((order) => {
    // If tracking number is entered, filter by tracking ID only
    if (trackingNumber.trim()) {
      return order.tracking.toUpperCase().includes(trackingNumber.trim().toUpperCase());
    }

    const status = normalizeOrderStatus(order?.status);

    // Otherwise, apply status filter
    if (orderFilter === "all") return true;
    if (orderFilter === "pending") return isCustomerPendingOrder(order);
    if (orderFilter === "order") return !["installation", "completed", "cancelled"].includes(status);
    if (orderFilter === "review") return isOrderCompletedAndReviewable(order) && !hasOrderReview(order);
    if (orderFilter === "reviewed") return hasAnyOrderReview(order);
    if (orderFilter === "repair") return false;
    if (orderFilter === "completed") return isOrderStatusCompleted(order);
    if (orderFilter === "cancel") return status === "cancelled";
    return true;
  });

  const ORDER_PAGE_SIZE = 5;
  const orderPageCount = Math.max(1, Math.ceil(filteredOrders.length / ORDER_PAGE_SIZE));
  const safeOrderPage = Math.min(Math.max(1, orderPage), orderPageCount);
  const pageStart = (safeOrderPage - 1) * ORDER_PAGE_SIZE;
  const pagedFilteredOrders = filteredOrders.slice(pageStart, pageStart + ORDER_PAGE_SIZE);
  const displayedOrders = isMobile ? filteredOrders : pagedFilteredOrders;
  const getOrderSortTimestamp = (order) => {
    const timestamp = new Date(order?.updatedAt || order?.createdAt || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };
  const recentOrders = [...orders]
    .sort((firstOrder, secondOrder) => getOrderSortTimestamp(secondOrder) - getOrderSortTimestamp(firstOrder))
    .slice(0, 3);
  const dashboardRecentOrders = [...orders]
    .sort((firstOrder, secondOrder) => {
      const firstDate = new Date(firstOrder?.createdAt || firstOrder?.updatedAt || 0).getTime();
      const secondDate = new Date(secondOrder?.createdAt || secondOrder?.updatedAt || 0).getTime();
      return (Number.isFinite(secondDate) ? secondDate : 0) - (Number.isFinite(firstDate) ? firstDate : 0);
    })
    .slice(0, 5);
  const dashboardRecentNotifications = [...customerNotificationItems]
    .sort(sortCustomerNotificationsNewestFirst)
    .slice(0, 6);
  const showOrdersFilter = (filter) => {
    setTrackingNumber("");
    setOrderFilter(filter);
    setOrderPage(1);
    setActiveTab("orders");
  };

  const openOrderDetailsFromNotification = (order, notificationOrId = null) => {
    const orderIdentifier = getOrderIdentifier(order);
    const notification = notificationOrId && typeof notificationOrId === "object" ? notificationOrId : null;
    const notificationId = notification?.notificationId || notificationOrId;
    markCustomerNotificationRead(notificationId);

    if (notification?.notificationType === "repair_request") {
      setOrderFilter("repair");
      setActiveTab("orders");
      return;
    }

    if (notification?.notificationType === "product_ready_for_review") {
      const reviewOrders = orders.filter((entry) =>
        isOrderCompletedAndReviewable(entry) && !hasOrderReview(entry),
      );
      const reviewOrderIndex = reviewOrders.findIndex((entry) => getOrderIdentifier(entry) === orderIdentifier);
      const reviewOrder = orders.find((entry) => getOrderIdentifier(entry) === orderIdentifier) || order;
      setTrackingNumber("");
      setOrderFilter("review");
      setOrderPage(reviewOrderIndex >= 0 ? Math.floor(reviewOrderIndex / ORDER_PAGE_SIZE) + 1 : 1);
      setExpandedOrderId(orderIdentifier);
      setHighlightedOrderId(orderIdentifier);
      setSelectedOrderForModal(null);
      setTimelineNotificationTarget(null);
      setActiveTab("orders");
      setNotificationsOpen(false);
      openCustomerReviewModal(reviewOrder, notification.reviewItemIndex);
      return;
    }

    const myOrders = orders.filter((entry) =>
      !["installation", "completed", "cancelled"].includes(normalizeOrderStatus(entry?.status)),
    );
    const targetOrders = myOrders.some((entry) => getOrderIdentifier(entry) === orderIdentifier)
      ? myOrders
      : orders;
    const orderIndex = targetOrders.findIndex(
      (entry) => getOrderIdentifier(entry) === orderIdentifier,
    );

    setTrackingNumber("");
    setOrderFilter(targetOrders === myOrders ? "order" : "all");
    setOrderPage(orderIndex >= 0 ? Math.floor(orderIndex / ORDER_PAGE_SIZE) + 1 : 1);
    const isDelayNotification = ["delay", "project_delay"].includes(notification?.notificationType);
    const isInstallationNotification = ["installation_up_next", "installation_completed"].includes(notification?.notificationType);
    const isSiteInspectionNotification = notification?.notificationType === "site_inspection_today";
    const isCancellationCooldownNotification = notification?.notificationType === "order_cancellation_cooldown";
    const isCancellationWarningNotification = notification?.notificationType === "order_cancellation_warning";
    setTimelineNotificationTarget(isDelayNotification ? {
      stageKey: notification.delayStageKey,
      stageName: notification.delayStageName,
      itemIndex: notification.delayItemIndex,
    } : isInstallationNotification ? {
      stageKey: notification.stageKey,
      stageName: notification.stageName || "Installation",
      itemIndex: notification.itemIndex,
    } : null);
    setSelectedOrderForModal(isDelayNotification || isInstallationNotification || isSiteInspectionNotification || isCancellationCooldownNotification || isCancellationWarningNotification ? order : null);
    setExpandedOrderId(orderIdentifier);
    setHighlightedOrderId(orderIdentifier);
    setActiveTab("orders");
  };

  useEffect(() => {
    if (!highlightedOrderId) return undefined;
    if (activeTab !== "orders") {
      setHighlightedOrderId(null);
      return undefined;
    }

    let attempts = 0;
    const scrollInterval = window.setInterval(() => {
      const candidates = Array.from(document.querySelectorAll("[data-notification-record-id]"))
        .filter((element) => element.dataset.notificationRecordId === highlightedOrderId);
      const target = candidates.find((element) => element.closest('[role="dialog"]')) || candidates[0];
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        window.clearInterval(scrollInterval);
      } else if (attempts >= 20) {
        window.clearInterval(scrollInterval);
      }
      attempts += 1;
    }, 100);
    const timeoutId = window.setTimeout(() => setHighlightedOrderId(null), 3500);

    return () => {
      window.clearInterval(scrollInterval);
      window.clearTimeout(timeoutId);
    };
  }, [highlightedOrderId, activeTab]);

  const orderViewClass = orderViewMode === "view2"
    ? "grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
    : orderViewMode === "view3"
      ? "grid gap-5 lg:grid-cols-3"
      : "space-y-6";
  const orderFilterOptions = [
    { value: "all", label: "All Orders" },
    { value: "order", label: "My Orders" },
    { value: "pending", label: "Pending" },
    { value: "completed", label: "Completed" },
    { value: "review", label: "To Review" },
    { value: "reviewed", label: "Reviewed Product" },
    { value: "repair", label: "Request Repair" },
    { value: "cancel", label: "Cancelled" },
  ].map((option) => ({
    ...option,
    count: orders.filter((order) => {
      const status = normalizeOrderStatus(order?.status);
      if (option.value === "all") return true;
      if (option.value === "pending") return isCustomerPendingOrder(order);
      if (option.value === "order") return !["installation", "completed", "cancelled"].includes(status);
      if (option.value === "review") return isOrderCompletedAndReviewable(order) && !hasOrderReview(order);
      if (option.value === "reviewed") return hasAnyOrderReview(order);
      if (option.value === "repair") return isOrderStatusCompleted(order);
      if (option.value === "completed") return isOrderStatusCompleted(order);
      if (option.value === "cancel") return status === "cancelled";
      return false;
    }).length,
  }));

  const estimateWidth = Number(estimateForm.width) || 0;
  const estimateHeight = Number(estimateForm.height) || 0;
  const estimateQuantityError = getProductEstimatorQuantityError(estimateForm.quantity);
  const estimateQuantity = estimateQuantityError ? 0 : Number(estimateForm.quantity);
  const selectedUnitLabel = estimateForm.unit === 'in' ? 'in' : estimateForm.unit === 'ft' ? 'ft' : estimateForm.unit === 'cm' ? 'cm' : 'm';
  const selectedAreaUnitLabel = estimateForm.unit === 'in' ? 'in²' : estimateForm.unit === 'ft' ? 'ft²' : estimateForm.unit === 'cm' ? 'cm²' : 'm²';
  const estimateAreaSelectedUnit = estimateWidth && estimateHeight ? estimateWidth * estimateHeight : 0;
  const estimateTotalAreaSelectedUnit = estimateAreaSelectedUnit * estimateQuantity;
  
  // Use comprehensive calculateEstimate like admin does
  const rawEstimateResult = cartDecisionProduct && !estimateQuantityError ? calculateEstimate({
    productName: cartDecisionProduct.product_name || cartDecisionProduct.name,
    categoryKey: cartDecisionProduct.product_type || cartDecisionProduct.category,
    variantName: cartDecisionProduct.variant,
    width: estimateWidth,
    height: estimateHeight,
    measurementUnit: estimateForm.unit,
    quantity: estimateQuantity,
    blade_count: cartDecisionProduct.blade_count || 0,
    base_price: cartDecisionProduct.base_price || undefined,
    overrideRate: getProductEstimateRate(cartDecisionProduct, estimateForm),
    customization: cartDecisionProduct.customization || false,
    customization_fee: cartDecisionProduct.customization_fee || 0,
  }) : { estimated_area: 0, estimated_price: 0, rate: 0, areaDisplay: '—', rateNote: '' };
  const estimateResult = cartDecisionProduct
    ? {
        ...rawEstimateResult,
        estimated_price: estimateQuantityError ? 0 : getProductLineTotal(cartDecisionProduct, {
          width: estimateWidth,
          height: estimateHeight,
          measurement_unit: estimateForm.unit,
          quantity: estimateQuantity,
          customized: true,
          blade_glass_type: estimateForm.blade_glass_type,
          piece_option: estimateForm.piece_option,
          piece_options: cartDecisionProduct.piece_options || [],
          area_option: estimateForm.area_option,
          area_options: cartDecisionProduct.area_options || [],
          sale_mode: estimateForm.sale_mode,
          frame_type: estimateForm.frame_type,
          custom_frame_size: estimateForm.custom_frame_size,
          blade_count: estimateForm.blade_count,
          extra_charges: estimateForm.extra_charges,
        }),
      }
    : rawEstimateResult;

  const productEstimatorWidth = Number(productEstimatorForm.width) || 0;
  const productEstimatorHeight = Number(productEstimatorForm.height) || 0;
  const productEstimatorState = selectedProduct
    ? getProductEstimatorState(selectedProduct, productEstimatorForm)
    : null;
  const productEstimatorDimensionError = productEstimatorState?.dimensionError || "";
  const productEstimatorQuantityError = productEstimatorState?.quantityError || "";
  const isBladeEstimator = selectedProduct?.pricing_method === "blade";
  const isMeterEstimator = selectedProduct?.pricing_method === "per_meter" || selectedProduct?.unit === "per_meter";
  const isPieceEstimator = ["per_piece", "per_set", "piece", "set"].includes(String(selectedProduct?.pricing_method || selectedProduct?.unit || "").toLowerCase());
  const isAreaEstimator = productEstimatorState?.isAreaEstimator === true;
  const productBladeGlassTypes = Array.isArray(selectedProduct?.blade_glass_types) ? selectedProduct.blade_glass_types : [];
  const productPieceOptions = Array.isArray(selectedProduct?.piece_options) ? selectedProduct.piece_options : [];
  const productAreaOptions = Array.isArray(selectedProduct?.area_options) ? selectedProduct.area_options : [];
  const productBladeFrameTypes = Array.isArray(selectedProduct?.blade_frame_types) ? selectedProduct.blade_frame_types : [];
  const selectedBladeGlass = productBladeGlassTypes.find((glass) => glass.name === productEstimatorForm.blade_glass_type);
  const selectedPieceOption = productPieceOptions.find((option) => option.name === productEstimatorForm.piece_option) || null;
  const selectedAreaOption = productAreaOptions.find((option) => option.name === productEstimatorForm.area_option) || null;
  const selectedBladeFrame = productBladeFrameTypes.find((frame) => frame.name === productEstimatorForm.frame_type);
  const estimatorBladeCount = productEstimatorForm.sale_mode === "frame"
    ? Number(selectedBladeFrame?.blade_count) || Number(productEstimatorForm.blade_count) || 0
    : Number(productEstimatorForm.blade_count) || Number(selectedProduct?.minimum_blades) || 1;
  const productEstimatorNeedsDimensions = (!isBladeEstimator && !isPieceEstimator) || (productEstimatorForm.sale_mode === "frame" && productEstimatorForm.custom_frame_size);
  const rawProductEstimatorResult = selectedProduct && !productEstimatorDimensionError && !productEstimatorQuantityError ? calculateEstimate({
    productName: selectedProduct.product_name || selectedProduct.name,
    categoryKey: selectedProduct.product_type || selectedProduct.category,
    variantName: selectedProduct.variant,
    width: productEstimatorWidth,
    height: productEstimatorHeight,
    measurementUnit: productEstimatorForm.unit,
    quantity: 1,
    blade_count: estimatorBladeCount || selectedProduct.blade_count || 0,
    base_price: selectedProduct.base_price || undefined,
      overrideRate: getProductEstimateRate(selectedProduct, productEstimatorForm),
    customization: selectedProduct.customization || false,
    customization_fee: selectedProduct.customization_fee || 0,
  }) : null;
  const productEstimatorResult = selectedProduct
    ? {
        ...rawProductEstimatorResult,
        estimated_price: productEstimatorDimensionError || productEstimatorQuantityError ? 0 : getProductLineTotal(selectedProduct, {
          width: productEstimatorWidth,
          height: productEstimatorHeight,
          measurement_unit: productEstimatorForm.unit,
          quantity: 1,
          customized: true,
          blade_glass_type: productEstimatorForm.blade_glass_type,
          piece_option: productEstimatorForm.piece_option,
          piece_options: productPieceOptions,
          area_option: productEstimatorForm.area_option,
          area_options: productAreaOptions,
          sale_mode: productEstimatorForm.sale_mode,
          frame_type: productEstimatorForm.frame_type,
          custom_frame_size: productEstimatorForm.custom_frame_size,
          blade_count: estimatorBladeCount,
          extra_charges: productEstimatorForm.extra_charges,
        }),
        rate: isBladeEstimator
          ? Number(selectedBladeGlass?.price_per_blade) || 0
          : isPieceEstimator
            ? Number(selectedProduct.estimated_price_override || selectedProduct.base_price || selectedProduct.unit_price || selectedProduct.estimated_price) || 0
            : isMeterEstimator || isPieceEstimator ? Number(selectedProduct.unit_price || selectedProduct.base_price) || 0
              : isAreaEstimator ? Number(selectedProduct.price_per_sqft) || 0
                : rawProductEstimatorResult?.rate || 0,
        areaDisplay: isBladeEstimator
          ? `${estimatorBladeCount} blade(s)`
          : isMeterEstimator ? `${productEstimatorWidth} ${productEstimatorForm.unit}` : isPieceEstimator ? "1 piece" : rawProductEstimatorResult?.areaDisplay,
      }
    : null;
  const hasBladeEstimate = Boolean(
    isBladeEstimator &&
    selectedBladeGlass &&
    Number(selectedBladeGlass.price_per_blade) > 0 &&
    estimatorBladeCount >= Math.max(1, Number(selectedProduct.minimum_blades) || 1) &&
    (!(Number(selectedProduct.maximum_blades) > 0) || estimatorBladeCount <= Number(selectedProduct.maximum_blades)) &&
    (productEstimatorForm.sale_mode === "blades_only"
      ? selectedProduct.sell_blades_only !== false
      : selectedProduct.sell_with_frame && (productEstimatorForm.custom_frame_size
        ? selectedProduct.allow_custom_frame_size && productEstimatorWidth > 0 && productEstimatorHeight > 0
        : Boolean(selectedBladeFrame))) &&
    Number(productEstimatorResult?.estimated_price) > 0
  );
  const hasProductEstimatorEstimate = !productEstimatorDimensionError && !productEstimatorQuantityError && (isBladeEstimator
    ? hasBladeEstimate
    : isMeterEstimator
      ? productEstimatorWidth > 0 && Number(productEstimatorResult?.estimated_price) > 0
      : isPieceEstimator
        ? (!productPieceOptions.length || Number(selectedPieceOption?.price_per_piece) > 0) && Number(productEstimatorResult?.estimated_price) > 0
      : productAreaOptions.length > 0
        ? (!productEstimatorForm.area_option || Boolean(selectedAreaOption && (Number(selectedAreaOption.price_per_sqft) > 0 || Number(selectedProduct.price_per_sqft) > 0 || Number(selectedProduct.estimated_price_override) > 0))) && Number(productEstimatorResult?.estimated_price) > 0
      : productEstimatorWidth > 0 && productEstimatorHeight > 0 && Number(productEstimatorResult?.estimated_price) > 0);
  const productEstimatorBladeCountError = productEstimatorState?.bladeCountError || "";
  const productEstimatorInputsInvalid = Boolean(productEstimatorDimensionError || productEstimatorQuantityError || productEstimatorBladeCountError);

  const estimateArea = estimateResult.estimated_area || 0;
  const estimateTotalArea = estimateArea;
  const estimateUnitRate = estimateResult.rate || 0;
  const estimateTotalCost = estimateResult.estimated_price || 0;
  const orderReviewMeasurementText = reviewOrderMode === "orderNow"
    ? (() => {
        if (!orderNowProduct) return `Quantity: ${Math.max(1, Number(orderNowQuantity) || 1)}`;
        const quantity = Math.max(1, Number(orderNowQuantity) || 1);
        if (isBladePricingProduct(orderNowProduct)) {
          return getBladeOrderSummaryText(orderNowProduct, getDefaultBladeSelections(orderNowProduct), quantity) || `Quantity: ${quantity}`;
        }
        const defaultDims = getProductDefaultDimensions(orderNowProduct, Math.max(1, Number(orderNowQuantity) || 1));
        if (!defaultDims || Number(defaultDims.width) <= 0 || Number(defaultDims.height) <= 0) {
          return `Quantity: ${Math.max(1, Number(orderNowQuantity) || 1)}`;
        }

        const unit = defaultDims.unit || "in";
        const area = Number(defaultDims.area) > 0
          ? Number(defaultDims.area)
          : unit === "in"
            ? (Number(defaultDims.width) * Number(defaultDims.height) * quantity) / 144
            : unit === "ft"
              ? Number(defaultDims.width) * Number(defaultDims.height) * quantity
              : unit === "cm"
                ? (Number(defaultDims.width) * Number(defaultDims.height) * quantity) / 929.0304
                : unit === "m"
                  ? Number(defaultDims.width) * Number(defaultDims.height) * quantity * 10.7639
                  : Number(defaultDims.width) * Number(defaultDims.height) * quantity;

        return getConfirmationItemDimensionText({
          width: Number(defaultDims.width),
          height: Number(defaultDims.height),
          quantity,
          measurementUnit: unit,
          area,
        });
      })()
    : isBladePricingProduct(cartDecisionProduct)
      ? getBladeOrderSummaryText(cartDecisionProduct, estimateForm, estimateQuantity) || `Quantity: ${estimateQuantity}`
      : getConfirmationItemDimensionText({
          width: estimateWidth,
          height: estimateHeight,
          quantity: estimateQuantity,
          measurementUnit: estimateForm.unit,
          area: estimateArea,
        });
  const estimateCustomizationFee = cartDecisionProduct?.customization ? Number(cartDecisionProduct.customization_fee || 0) : 0;
  const estimateInstallationFee = Number(cartDecisionProduct?.installation_fee || 0);
  const estimateSubtotal = Math.max(0, estimateTotalCost - estimateCustomizationFee);
  const estimateGrandTotal = estimateTotalCost + estimateInstallationFee;
  const orderNowSubtotal = orderNowProduct
    ? getProductLineTotal(orderNowProduct, {
        ...getProductDefaultDimensions(orderNowProduct, Math.max(1, Number(orderNowQuantity) || 1)),
        quantity: Math.max(1, Number(orderNowQuantity) || 1),
        extra_charges: orderNowExtraCharges,
      })
    : 0;
  const orderNowAdditionalCharges = Number(orderNowProduct?.customization_fee || 0);
  const orderNowInstallationFee = Number(orderNowProduct?.installation_fee || 0);
  const orderNowGrandTotal = orderNowSubtotal + orderNowAdditionalCharges + orderNowInstallationFee;
  const orderNowTotal = orderNowGrandTotal;
  const confirmProduct = deliveryConfirmMode === "orderNow" ? orderNowProduct : cartDecisionProduct;
  const confirmQuantity = deliveryConfirmMode === "orderNow" ? Math.max(1, Number(orderNowQuantity) || 1) : estimateQuantity;
  const orderNowDimensions = orderNowProduct
    ? getProductDefaultDimensions(orderNowProduct, confirmQuantity)
    : null;
  const confirmWidth = deliveryConfirmMode === "orderNow"
    ? orderNowDimensions?.width
      ? `${orderNowDimensions.width} ${orderNowDimensions.unit || "in"}`
      : "—"
    : estimateWidth ? `${estimateWidth} ${selectedUnitLabel}` : "—";
  const confirmHeight = deliveryConfirmMode === "orderNow"
    ? orderNowDimensions?.height
      ? `${orderNowDimensions.height} ${orderNowDimensions.unit || "in"}`
      : "—"
    : estimateHeight ? `${estimateHeight} ${selectedUnitLabel}` : "—";
  const confirmPrice = deliveryConfirmMode === "orderNow" ? orderNowSubtotal : estimateTotalCost;
  const confirmSubtotal = deliveryConfirmMode === "orderNow" ? orderNowSubtotal : estimateSubtotal;
  const confirmAdditionalCharges = deliveryConfirmMode === "orderNow" ? orderNowAdditionalCharges : estimateCustomizationFee;
  const confirmInstallationFee = deliveryConfirmMode === "orderNow" ? orderNowInstallationFee : estimateInstallationFee;
  const confirmGrandTotal = deliveryConfirmMode === "orderNow" ? orderNowGrandTotal : estimateGrandTotal;
  const isConfirmAreaProduct = ["sqft", "per_sqft"].includes(String(confirmProduct?.pricing_method || confirmProduct?.unit || "").toLowerCase());
  const isConfirmPieceProduct = ["per_piece", "piece", "per_set", "set"].includes(String(confirmProduct?.pricing_method || confirmProduct?.unit || "").toLowerCase());
  const confirmAreaOptionName = deliveryConfirmMode === "orderNow" ? orderNowProduct?.area_option : estimateForm.area_option;
  const confirmAreaOptions = Array.isArray(confirmProduct?.area_options) ? confirmProduct.area_options : [];
  const confirmAreaOption = confirmAreaOptions.find((option) => option.name === confirmAreaOptionName) || null;
  const confirmPieceOptionName = deliveryConfirmMode === "orderNow" ? orderNowProduct?.piece_option : estimateForm.piece_option;
  const confirmPieceOptions = Array.isArray(confirmProduct?.piece_options) ? confirmProduct.piece_options : [];
  const confirmPieceOption = confirmPieceOptions.find((option) => option.name === confirmPieceOptionName) || null;
  const confirmAreaPricingItem = {
    width: deliveryConfirmMode === "orderNow" ? Number(orderNowDimensions?.width) || 0 : estimateWidth,
    height: deliveryConfirmMode === "orderNow" ? Number(orderNowDimensions?.height) || 0 : estimateHeight,
    measurement_unit: deliveryConfirmMode === "orderNow" ? orderNowDimensions?.unit || "in" : estimateForm.unit,
    quantity: confirmQuantity,
    customized: false,
    area_option: confirmAreaOptionName || "",
    area_options: confirmAreaOptions,
    piece_option: confirmPieceOptionName || "",
    piece_options: confirmPieceOptions,
    extra_charges: deliveryConfirmMode === "orderNow" ? orderNowExtraCharges : estimateForm.extra_charges,
  };
  const confirmAreaPriceBreakdown = (isConfirmAreaProduct || isConfirmPieceProduct) && confirmProduct
    ? getProductLineBreakdown(confirmProduct, confirmAreaPricingItem)
    : null;
  const confirmAreaOptionAmount = (Number(confirmAreaOption?.price_per_sqft) || 0) * confirmQuantity;
  const confirmPieceOptionAmount = (Number(confirmPieceOption?.price_per_piece) || 0) * confirmQuantity;
  const confirmSelectedOptionAmount = isConfirmAreaProduct ? confirmAreaOptionAmount : isConfirmPieceProduct ? confirmPieceOptionAmount : 0;
  const confirmBaseProductAmount = confirmAreaPriceBreakdown
    ? Math.max(0, confirmAreaPriceBreakdown.baseTotal - confirmSelectedOptionAmount)
    : 0;
  const confirmAreaAdditionalChargeRows = confirmAreaPriceBreakdown?.extraCharges.filter((charge) => !charge.name.startsWith("Variant") && !charge.name.startsWith("Option")) || [];
  const confirmUnitPrice = (isConfirmAreaProduct || isConfirmPieceProduct) && confirmAreaPriceBreakdown
    ? confirmAreaPriceBreakdown.baseTotal / confirmQuantity
    : deliveryConfirmMode === "orderNow"
      ? Number(orderNowProduct?.unit_price || orderNowProduct?.price_per_sqft || 0)
      : estimateUnitRate;
  const isConfirmBladeProduct = ["blade", "per_blade"].includes(String(confirmProduct?.pricing_method || "").toLowerCase());
  const confirmBladeSelections = deliveryConfirmMode === "orderNow"
    ? { ...getDefaultBladeSelections(confirmProduct || {}), extra_charges: orderNowExtraCharges }
    : estimateForm;
  const confirmGlassType = (confirmProduct?.blade_glass_types || []).find((glass) => glass.name === confirmBladeSelections.blade_glass_type);
  const confirmBladeRate = Number(confirmGlassType?.price_per_blade ?? confirmProduct?.price_per_blade) || 0;
  const confirmFrameType = (confirmProduct?.blade_frame_types || []).find((frame) => frame.name === confirmBladeSelections.frame_type);
  const confirmBladeCount = Math.max(0, Number(confirmBladeSelections.blade_count) || Number(confirmFrameType?.blade_count) || Number(confirmProduct?.minimum_blades) || 0);
  const confirmFramePrice = confirmBladeSelections.sale_mode === "frame"
    ? Number(confirmBladeSelections.custom_frame_size ? confirmProduct?.custom_frame_price : confirmFrameType?.price) || 0
    : 0;
  const confirmBladePricingItem = {
    width: deliveryConfirmMode === "orderNow" ? Number(orderNowDimensions?.width) || 0 : estimateWidth,
    height: deliveryConfirmMode === "orderNow" ? Number(orderNowDimensions?.height) || 0 : estimateHeight,
    measurement_unit: deliveryConfirmMode === "orderNow" ? orderNowDimensions?.unit || "in" : estimateForm.unit,
    quantity: confirmQuantity,
    blade_glass_type: confirmBladeSelections.blade_glass_type,
    sale_mode: confirmBladeSelections.sale_mode,
    frame_type: confirmBladeSelections.frame_type,
    custom_frame_size: Boolean(confirmBladeSelections.custom_frame_size),
    blade_count: confirmBladeCount,
  };
  const confirmBladeBaseTotal = isConfirmBladeProduct
    ? getProductLineTotal({ ...confirmProduct, extra_charges: [] }, confirmBladePricingItem)
    : 0;
  const confirmExtraChargeRows = isConfirmBladeProduct
    ? (confirmProduct?.extra_charges || []).flatMap((charge, index) => {
        if (charge.is_active === false) return [];
        const selection = confirmBladeSelections.extra_charges?.[index];
        if (charge.is_optional && (selection?.is_selected ?? false) === false) return [];
        const amount = getProductLineTotal(
          { ...confirmProduct, extra_charges: [charge] },
          { ...confirmBladePricingItem, extra_charges: [{ is_selected: true }] },
        ) - confirmBladeBaseTotal;
        return [{ name: charge.name, amount: Math.max(0, amount) }];
      })
    : [];
  const isDeliveryConfirmValid = Boolean(
    deliveryConfirmForm.phone.trim() &&
    deliveryConfirmForm.street_address.trim() &&
    isValidStreetAddress(deliveryConfirmForm.shipping_address || buildDeliveryAddress(deliveryConfirmForm))
  );
  const batchOrderAddress = normalizeFullAddress(batchOrderForm.shipping_address || buildFullAddress(user));
  const isBatchOrderAddressValid = Boolean(batchOrderAddress) && isValidStreetAddress(batchOrderAddress);

  const cartQuantity = cartItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const sectionTextClass = darkMode ? "text-slate-100" : "text-slate-900";
  const sectionMutedTextClass = darkMode ? "text-slate-300" : "text-slate-600";
  const panelClass = darkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200";
  const selectedProductImages = getProductImages(selectedProduct);
  const activeProductImage = selectedProductImages[Math.min(selectedProductImageIndex, selectedProductImages.length - 1)];
  const selectedProductDimensions = selectedProduct
    ? getProductDimensionsLabel(selectedProduct) || "N/A"
    : "N/A";
  const profileDisplayName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim() || "Customer";
  const profileEmail = user?.email || "";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-12 w-12 rounded-full border-4 border-red-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className={`admin-theme-shell customer-dashboard-shell relative flex min-h-screen flex-col overflow-x-clip pb-[calc(10rem+env(safe-area-inset-bottom))] lg:pb-0 ${darkMode
      ? "admin-theme-dark"
      : "admin-theme-light"
    }`}>
      <div className="admin-shell-drawing" aria-hidden="true">
        <div className="admin-shell-circle admin-shell-circle-top" />
        <div className="admin-shell-circle admin-shell-circle-top-small" />
        <div className="admin-shell-circle admin-shell-circle-middle" />
        <div className="admin-shell-circle admin-shell-circle-middle-small" />
        <div className="admin-shell-circle admin-shell-circle-bottom" />
        <div className="admin-shell-circle admin-shell-circle-bottom-small" />
      </div>
      <AppToaster darkMode={darkMode} />
      <UsernameChangeFlow
        open={usernameChangeOpen}
        onClose={() => setUsernameChangeOpen(false)}
        currentUsername={profileForm.username || user?.username || ""}
        email={profileForm.email || user?.email || ""}
        darkMode={darkMode}
        onVerified={async (username, response) => {
          try { await refreshUser(); } catch (refreshError) { console.warn("Profile refresh after username verification failed", refreshError); }
          profileFormBaselineRef.current = { ...profileFormBaselineRef.current, username };
          setProfileForm((current) => ({ ...current, username }));
          setProfileMessage(response.message || "Your username has been updated successfully.");
          toast.success("Your username has been updated successfully.");
        }}
      />
      {permissionNotice && (
        <div className="customer-modal-overlay fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]">
          <div
            className={`w-full max-w-md rounded-3xl border p-6 text-center shadow-2xl transition-all duration-300 ${darkMode ? "border-amber-800 bg-slate-800 text-slate-100" : "border-amber-200 bg-white text-slate-900"} ${
              permissionNotice.closing ? "translate-y-2 scale-95 opacity-0" : "translate-y-0 scale-100 opacity-100"
            }`}
            role="alertdialog"
            aria-live="assertive"
            aria-label="Permission notice"
          >
            <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${darkMode ? "bg-amber-950 text-amber-300" : "bg-amber-100 text-amber-700"}`}>
              <Info size={24} />
            </div>
            <h2 className={`mt-4 text-lg font-black ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{permissionNotice.maintenance ? "System Under Maintenance" : "Access Restricted"}</h2>
            <p className={`mt-2 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{permissionNotice.message}</p>
            {permissionNotice.maintenance ? (
              <button type="button" onClick={handleLogoutConfirm} className="mt-5 rounded-xl bg-red-700 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-red-800">Logout ({maintenanceCountdown})</button>
            ) : (
              <button type="button" onClick={() => setPermissionNotice(null)} className="mt-5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800">Close</button>
            )}
          </div>
        </div>
      )}
      <div className={`${activeTab === "home"
        ? darkMode
          ? "border-b border-white/10 bg-[rgba(27,39,57,0.84)] shadow-lg shadow-black/10 backdrop-blur-2xl"
          : "border-b border-white/40 bg-[rgba(255,255,255,0.55)] shadow-sm backdrop-blur-2xl"
        : darkMode ? "bg-slate-900/90 border-b border-slate-700 shadow-lg shadow-slate-950/20" : "bg-white/90 border-b border-slate-200 shadow-sm"
      } sticky top-0 z-50`}>
        <div className="flex w-full items-center justify-between gap-2 px-3 py-2.5 sm:px-4 lg:gap-4">
          <button
            type="button"
            onClick={() => setActiveTab("home")}
            className="flex min-w-0 items-center gap-2 px-1 py-0.5 text-left sm:gap-3 sm:px-1.5"
            aria-label="Go to ACGC Services home"
          >
            <img src={logo} alt="ACGC Aluminum Services" className={`h-8 w-8 shrink-0 object-contain sm:h-12 sm:w-12 lg:h-14 lg:w-14 ${darkMode ? "drop-shadow-[0_0_4px_rgba(255,255,255,0.7)]" : ""}`} />
            <div className="min-w-0">
              <h1 className={`whitespace-nowrap text-[15px] font-semibold ${darkMode ? "text-red-400" : "text-red-500"} sm:text-lg lg:text-xl`}>
                ACGC Services
              </h1>
              <p className={`whitespace-nowrap text-[10px] font-semibold sm:text-xs lg:text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                Aluminum & Glass Services
              </p>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1 lg:gap-2">
            <button
              onClick={() => setActiveTab("products")}
              aria-current={activeTab === "products" ? "page" : undefined}
              className={`order-3 hidden rounded-full border px-4 py-2 text-base font-semibold transition lg:order-4 lg:inline-flex ${
                activeTab === "products"
                  ? darkMode ? "border border-slate-700 bg-slate-800 text-white shadow-sm" : "border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                  : darkMode ? "border-transparent text-slate-200 hover:bg-slate-800" : "border-transparent text-slate-700 hover:bg-slate-100"
              }`}
            >
              Browse Products
            </button>
            <button
              onClick={() => setActiveTab("orders")}
              aria-current={activeTab === "orders" ? "page" : undefined}
              className={`order-4 hidden rounded-full border px-4 py-2 text-base font-semibold transition lg:order-5 lg:inline-flex ${
                activeTab === "orders"
                  ? darkMode ? "border border-slate-700 bg-slate-800 text-white shadow-sm" : "border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                  : darkMode ? "border-transparent text-slate-200 hover:bg-slate-800" : "border-transparent text-slate-700 hover:bg-slate-100"
              }`}
            >
              Your Orders
            </button>
            <button
              onClick={() => setActiveTab("about")}
              aria-current={activeTab === "about" ? "page" : undefined}
              className={`order-5 hidden rounded-full border px-4 py-2 text-base font-semibold transition lg:order-6 lg:inline-flex ${
                activeTab === "about"
                  ? darkMode ? "border border-slate-700 bg-slate-800 text-white shadow-sm" : "border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                  : darkMode ? "border-transparent text-slate-200 hover:bg-slate-800" : "border-transparent text-slate-700 hover:bg-slate-100"
              }`}
            >
              About Us
            </button>
            <button
              type="button"
              onClick={toggleDarkMode}
              className={`order-7 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition focus:outline-none sm:h-10 sm:w-10 lg:order-9 ${
                darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"
              }`}
              aria-label={darkMode ? "Switch to day mode" : "Switch to night mode"}
              aria-pressed={darkMode}
              title={darkMode ? "Switch to day mode" : "Switch to night mode"}
            >
              {darkMode
                ? <Moon size={22} strokeWidth={1.8} className="text-sky-300" />
                : <Sun size={22} strokeWidth={1.8} className="text-amber-500" />}
            </button>
            <div className="relative order-6 lg:order-8">
              <button
                onClick={() => setNotificationsOpen((s) => !s)}
                className={`relative p-2.5 text-sm font-semibold transition ${
                  darkMode ? "text-slate-200" : "text-slate-700"
                }`}
                aria-haspopup="menu"
                aria-expanded={notificationsOpen}
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell size={22} strokeWidth={2.2} />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-md shadow-red-500/40">
                    {unreadNotificationCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className={`fixed left-auto right-3 top-[calc(4.0625rem+env(safe-area-inset-top))] z-20 mt-1 flex max-h-[calc(100dvh-5.5rem)] w-[min(24rem,calc(100vw-1.5rem))] max-w-md flex-col overflow-hidden rounded-2xl border shadow-xl lg:right-4 lg:top-[calc(4.5rem+env(safe-area-inset-top))] lg:mt-0 lg:max-h-[min(36rem,calc(100vh-6rem))] lg:w-96 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                  <div className={`flex shrink-0 items-center justify-between border-b px-3 py-2.5 sm:px-4 sm:py-3 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                    <div>
                      <p className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-950"}`}>Project updates</p>
                      <p className="mt-0.5 text-[11px] text-slate-400 sm:text-xs">Your latest order activity</p>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {unreadNotificationCount > 0 && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-600 sm:px-2 sm:py-1 sm:text-[10px]">{unreadNotificationCount} new</span>}
                      <button
                        type="button"
                        onClick={markAllCustomerNotificationsRead}
                        disabled={unreadNotificationCount === 0}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold transition sm:text-xs ${unreadNotificationCount === 0 ? "cursor-not-allowed text-slate-400" : darkMode ? "text-red-300 hover:text-white" : "text-red-600 hover:text-red-700"}`}
                      >
                        <CheckCheck size={12} className="sm:h-[14px] sm:w-[14px]" />
                        Mark all as read
                      </button>
                    </div>
                  </div>

                  <div className={`flex shrink-0 gap-1 border-b px-2 py-1.5 sm:px-3 sm:py-2 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                    {[
                      ["all", "All", orders.length],
                      ["unread", "Unread", unreadNotificationCount],
                      ["read", "Read", readNotificationCount],
                    ].map(([filter, label, count]) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setNotificationFilter(filter)}
                        className={`flex-1 rounded-lg px-1.5 py-1 text-[10px] font-semibold transition sm:px-2 sm:py-1.5 sm:text-xs ${
                          notificationFilter === filter
                            ? darkMode
                              ? "bg-slate-950 text-white"
                              : "bg-slate-100 text-slate-950"
                            : darkMode
                              ? "text-slate-300 hover:bg-slate-700"
                              : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {label} ({count})
                      </button>
                    ))}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {ordersLoading ? (
                      <div className={`px-3 py-6 text-center text-sm sm:px-4 sm:py-8 ${darkMode ? "text-slate-300" : "text-slate-500"}`}>Loading your updates...</div>
                    ) : filteredNotifications.length === 0 ? (
                      <div className={`px-3 py-5 text-center sm:px-4 sm:py-6 ${darkMode ? "text-slate-300" : "text-gray-600"}`}>
                        <Bell size={18} className="mx-auto mb-2 text-slate-400 sm:h-[22px] sm:w-[22px]" />
                        <p>{notificationFilter === "all" ? "No project updates yet" : `No ${notificationFilter} notifications`}</p>
                      </div>
                    ) : (
                      <div className={darkMode ? "min-h-0 flex-1 divide-y divide-slate-700 overflow-y-auto overscroll-contain" : "min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto overscroll-contain"}>
                        {[...filteredNotifications]
                          .sort(sortCustomerNotificationsNewestFirst)
                          .slice(0, 5)
                          .map((order) => {
                            const product = order.items?.[0] || {};
                            const isRead = readNotificationIds.has(order.notificationId);
                            const status = normalizeOrderStatusKey(order?.status);
                            const contractStatus = normalizeOrderStatusKey(order?.contract_status);
                            const isReviewReadyNotification = order.notificationType === "product_ready_for_review";
                            const isPaymentNotification = ["payment", "payment_confirmed", "payment_amount_updated", "payment_rejected", "admin_payment_recorded", "downpayment_exception_approved", "downpayment_exception_pending", "payment_discrepancy", "payment_discrepancy_resolved", "overdue_payment", "installation_payment_reminder"].includes(order.notificationType);
                            const notificationStatusLabel = isReviewReadyNotification ? "Ready to Review" : order.notificationType === "overdue_payment" ? "Payment Due" : order.notificationType === "project_delay" ? order.delayStatus : null;
                            const isPaymentConfirmationNotification = ["payment_confirmed", "payment_amount_updated", "admin_payment_recorded", "downpayment_exception_approved"].includes(order.notificationType);
                            const isDelayNotification = ["delay", "project_delay"].includes(order.notificationType);
                            const isInstallationNotification = ["installation_up_next", "installation_completed"].includes(order.notificationType);
                            const isSiteInspectionNotification = order.notificationType === "site_inspection_today";
                            const isCancellationCooldownNotification = order.notificationType === "order_cancellation_cooldown";
                            const isCancellationWarningNotification = order.notificationType === "order_cancellation_warning";
                            const isCancellationPolicyNotification = isCancellationCooldownNotification || isCancellationWarningNotification;
                            const isContractReady =
                              status === "contract_sent" ||
                              (status === "site_inspection" && contractStatus === "sent") ||
                              contractStatus === "sent";
                            const notificationDetails = () => {
                              if (isReviewReadyNotification) {
                                return {
                                  title: "Product Ready for Review",
                                  message: `${order.reviewProductName || product.name || "Your product"} is complete. Share your feedback about this product.`,
                                  color: "text-amber-600",
                                };
                              }
                              if (["extra_charge_receipt_sent", "project_payment_receipt_sent"].includes(order.notificationType)) {
                                return {
                                  title: "Your Order Receipt",
                                  message: "Your order receipt has been sent successfully. Your project balance is fully paid. You can now view and download your receipt.",
                                  color: "text-emerald-600",
                                };
                              }
                              if (order.notificationType === "feedback_response") {
                                return { title: order.title || "ACGC SERVICES", message: order.message, color: "text-emerald-600" };
                              }
                              if (order.notificationType === "repair_request") {
                                return {
                                  title: order.title,
                                  message: order.message,
                                  color: "text-amber-600",
                                };
                              }
                              if (isSiteInspectionNotification) {
                                return {
                                  title: order.title || "Site Inspection Scheduled for Today",
                                  message: order.message || `Your site inspection for order ${order.tracking} is scheduled for ${formatDateToMMMDDYYYY(order.inspection_date)}.`,
                                  color: "text-blue-600",
                                };
                              }
                              if (isCancellationPolicyNotification) {
                                return {
                                  title: order.title || (isCancellationCooldownNotification ? "7-Day Online Ordering Restriction" : "Cancellation Policy Reminder"),
                                  message: withAdminContactPhone(order.message || "Reaching 3 cancellations will restrict online ordering for 7 days. Please visit our shop or contact us by phone during any restriction."),
                                  color: isCancellationCooldownNotification ? "text-red-600" : "text-amber-600",
                                };
                              }
                              if (["overdue_payment", "installation_payment_reminder"].includes(order.notificationType)) {
                                return {
                                  title: order.notificationType === "overdue_payment" ? "Remaining Balance" : order.title,
                                  message: order.message,
                                  color: order.notificationType === "overdue_payment" ? "text-red-600" : "text-amber-600",
                                };
                              }
                              if (order.notificationType === "installation_up_next") {
                                return {
                                  title: order.title || "Installation Coming Up",
                                  message: order.message || "Your ACGC order is up next for installation. Our team will begin the installation stage soon. Please stay tuned for updates.",
                                  color: "text-blue-600",
                                };
                              }
                              if (order.notificationType === "installation_completed") {
                                return {
                                  title: order.title || "Installation Completed",
                                  message: order.message || "The installation for your ACGC order has been completed. Thank you for choosing ACGC Aluminum Services!",
                                  color: "text-emerald-600",
                                };
                              }
                              if (order.notificationType === "transaction_approved") {
                                return {
                                  title: "Transaction approved",
                                  message: `Your accepted contract for ${order.tracking} was approved. Your project is now eligible for progress monitoring.`,
                                  color: "text-emerald-600",
                                };
                              }
                              if (isDelayNotification) {
                                return {
                                  title: order.title || (order.delayResolved ? "Project delay resolved" : "Project delay reported"),
                                  message: getDelayNotificationMessage(order),
                                  color: "text-amber-600",
                                };
                              }
                              if (isPaymentNotification) {
                                if (["payment_discrepancy", "payment_discrepancy_resolved"].includes(order.notificationType)) {
                                  const discrepancy = order.paymentDiscrepancy || {};
                                  const resolved = order.notificationType === "payment_discrepancy_resolved";
                                  return {
                                    title: resolved ? "Payment Discrepancy Resolved" : "Payment Amount Discrepancy",
                                    message: `Customer-reported ${formatCurrency(discrepancy.customer_reported_amount)}; admin-recorded ${formatCurrency(discrepancy.admin_recorded_amount)}; difference ${formatCurrency(discrepancy.difference)}. Status: ${resolved ? "resolved" : String(discrepancy.status || "pending review").replaceAll("_", " ")}.`,
                                    color: resolved ? "text-emerald-600" : "text-amber-600",
                                  };
                                }
                                if (order.notificationType === "admin_payment_recorded") {
                                  return {
                                    title: "Payment Recorded by Admin",
                                    message: `${formatCurrency(order.paymentRecord?.verified_amount)} was recorded for order ${order.tracking}. Payment status: ${getPaymentSummary(order).status.label}. Remaining project balance: ${formatCurrency(getPaymentSummary(order).remainingAmount)}.`,
                                    color: "text-emerald-600",
                                  };
                                }
                                if (["downpayment_exception_approved", "downpayment_exception_pending"].includes(order.notificationType)) {
                                  const exception = order.paymentRecord?.downpayment_exception || {};
                                  const approved = order.notificationType === "downpayment_exception_approved";
                                  return {
                                    title: approved ? "Downpayment Exception Approved" : "Awaiting Admin Approval",
                                    message: approved
                                      ? `The admin approved accepting ${formatCurrency(exception.accepted_amount)} below the required downpayment. Payment status: ${getPaymentSummary(order).status.label}. Remaining balance: ${formatCurrency(getPaymentSummary(order).remainingAmount)}. ${exception.reason || ""}`
                                      : `An exception was requested for ${formatCurrency(exception.accepted_amount)} against the required downpayment of ${formatCurrency(exception.required_amount)}. Shortfall if accepted: ${formatCurrency(exception.shortfall)}. Remaining project balance: ${formatCurrency(getPaymentSummary(order).remainingAmount)}. This payment is not verified yet.`,
                                    color: approved ? "text-amber-600" : "text-sky-600",
                                  };
                                }
                                if (order.notificationType === "payment_amount_updated") {
                                  const adjustment = order.paymentAdjustment || {};
                                  const difference = (Number(adjustment.new_amount) || 0) - (Number(adjustment.previous_amount) || 0);
                                  return {
                                    title: "Payment Amount Updated",
                                    message: `Submitted ${formatCurrency(adjustment.previous_amount)}; verified ${formatCurrency(adjustment.new_amount)} (${difference < 0 ? "lower" : "higher"} by ${formatCurrency(Math.abs(difference))}). ${adjustment.reason || ""}`,
                                    color: "text-amber-600",
                                  };
                                }
                                if (order.notificationType === "payment_rejected") {
                                  return {
                                    title: "Payment Proof Rejected",
                                    message: order.paymentRecord?.admin_reason || "Review the payment details and submit a new proof when ready.",
                                    color: "text-red-600",
                                  };
                                }
                                if (isPaymentConfirmationNotification) {
                                  return {
                                    title: "Payment confirmed",
                                    message: `Your payment of ${formatCurrency(order.paymentRecord?.verified_amount ?? order.payment_proof_amount)} has been confirmed by our team.`,
                                    color: "text-emerald-600",
                                  };
                                }
                                return {
                                  title: "Payment proof submitted",
                                  message: `Your payment proof for ${formatCurrency(order.paymentRecord?.submitted_amount ?? order.payment_proof_amount)} has been sent for confirmation.`,
                                  color: "text-emerald-600",
                                };
                              }
                              if (contractStatus === "accepted" || status === "contract_accepted") {
                                return { title: "Contract accepted", message: "Your contract has been accepted. Work can now move forward.", color: "text-emerald-600" };
                              }
                              if (contractStatus === "declined" || status === "contract_declined" || status === "cancelled") {
                                return { title: "Order update", message: "Your contract or order was declined or cancelled.", color: "text-red-600" };
                              }
                              if (isContractReady) {
                                return { title: "Contract ready", message: "A contract has been sent for your review and acceptance.", color: "text-blue-600" };
                              }

                              switch (status) {
                                case "order_submitted":
                                  return { title: "Order submitted", message: "Your order has been submitted and is awaiting admin review.", color: "text-blue-600" };
                                case "admin_review":
                                  return { title: "Order under review", message: "Our team is reviewing your project request.", color: "text-amber-600" };
                                case "site_inspection":
                                  return { title: "Site inspection", message: getSiteInspectionNotificationMessage(order), color: "text-amber-600" };
                                case "fabrication":
                                  return { title: "Fabrication started", message: "Your project is currently in fabrication.", color: "text-indigo-600" };
                                case "installation":
                                  return { title: "Installation in progress", message: "Your project installation is in progress.", color: "text-violet-600" };
                                case "completed":
                                  return { title: "Project completed", message: "Your project has been completed successfully!", color: "text-emerald-600" };
                                default:
                                  return { title: "Project update", message: getCustomerOrderNotificationMessage(order), color: "text-amber-600" };
                              }
                            };
                            const details = notificationDetails();
                            const hasContractBeenSent =
                              status === "contract_sent" ||
                              contractStatus === "sent" ||
                              (status === "site_inspection" && contractStatus === "sent");
                            const isContractNotification = !isPaymentNotification && !isDelayNotification && !isInstallationNotification && !isSiteInspectionNotification && (
                              order.notificationType === "contract" ||
                              hasContractBeenSent ||
                              ["contract_accepted"].includes(status) ||
                              ["accepted"].includes(contractStatus)
                            );
                            const NotificationIcon = isReviewReadyNotification
                              ? Star
                              : isPaymentConfirmationNotification
                              ? CheckCircle
                              : isPaymentNotification
                                ? CreditCard
                                : isDelayNotification
                                  ? AlertTriangle
                                  : isCancellationPolicyNotification
                                    ? AlertTriangle
                                  : isSiteInspectionNotification
                                    ? CalendarDays
                                    : isContractNotification
                                    ? FileText
                                    : Bell;

                            return (
                              <button
                                key={order.notificationId}
                                onClick={() => {
                                  openOrderDetailsFromNotification(order, order);
                                  setNotificationsOpen(false);
                                }}
                                className={`group w-full border-l-2 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 sm:px-4 sm:py-3 ${
                                  isRead
                                    ? darkMode ? "border-transparent bg-slate-800/60 hover:bg-slate-800" : "border-transparent bg-white hover:bg-slate-50"
                                    : darkMode ? "border-red-400/70 bg-slate-800/90 hover:bg-slate-800" : "border-red-400/70 bg-red-50/40 hover:bg-red-50/70"
                                }`}
                              >
                                <div className="flex gap-2.5 sm:gap-3">
                                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 sm:h-9 sm:w-9 ${darkMode ? "bg-slate-700 ring-white/5" : "bg-slate-100 ring-slate-200/70"}`}>
                                    <NotificationIcon size={15} className={details.color} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2 sm:gap-3">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <p className={`truncate text-xs sm:text-sm ${isRead ? "font-medium" : "font-bold"} ${darkMode ? isRead ? "text-slate-300" : "text-white" : isRead ? "text-slate-600" : "text-slate-950"}`}>{details.title}</p>
                                        {!isRead && <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[8px] font-bold uppercase text-red-700 sm:text-[9px]">New</span>}
                                      </div>
                                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase sm:px-2 sm:text-[10px] ${getOrderStatusClasses(notificationStatusLabel || (isDelayNotification ? "Delayed" : order.status))}`}>{notificationStatusLabel || (isDelayNotification ? "Delayed" : getOrderStatusLabel(order.status))}</span>
                                    </div>
                                    <p className={`mt-0.5 text-[11px] leading-4 sm:text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                      {renderAdminContactMessage(details.message)}
                                    </p>
                                    <p className={`mt-1 text-[10px] sm:text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                      {order.reviewProductName || product.name || "Project"} · {order.tracking || "Order update"} · <span title={formatDateTimeToMMMDDYYYY(order.notificationDate) || undefined}>{formatTimeAgo(order.notificationDate)}</span>
                                    </p>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setActiveTab("notifications");
                      setNotificationsOpen(false);
                    }}
                    className={`sticky bottom-0 z-10 w-full shrink-0 border-t px-3 py-2.5 text-center text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 sm:px-4 sm:py-2 ${darkMode ? "border-slate-700 bg-slate-800 text-red-300 hover:bg-slate-700" : "border-slate-100 bg-white text-red-600 hover:bg-gray-50"}`}
                  >
                    View all Notifications
                  </button>
                </div>
              )}
            </div>
            <div className="relative order-8 hidden items-center gap-1 lg:order-7 lg:flex">
              <button
                onClick={() => setActiveTab("profile")}
                className={`flex h-9 w-9 items-center justify-center rounded-full p-2 text-base font-semibold transition sm:h-10 sm:w-auto sm:gap-2 sm:px-4 sm:py-2 ${
                  activeTab === "profile"
                    ? darkMode
                      ? "border border-slate-700 bg-slate-800 text-white shadow-sm"
                      : "border border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                    : darkMode
                      ? "text-slate-200 hover:bg-slate-800"
                      : "text-slate-700 hover:bg-slate-100"
                }`}
                aria-current={activeTab === "profile" ? "page" : undefined}
                aria-label="Profile"
                title="Profile"
              >
                <span className="text-base font-semibold">Profile</span>
              </button>
              {canRequestOrders && (
                <button
                  onClick={() => setActiveTab("cart")}
                  className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full p-2 transition sm:h-10 sm:w-10 ${
                    activeTab === "cart"
                      ? darkMode ? "border border-slate-700 bg-slate-800 text-white shadow-sm" : "border border-slate-200 bg-slate-100 text-red-600 shadow-sm"
                      : darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"
                  }`}
                  aria-current={activeTab === "cart" ? "page" : undefined}
                  aria-label="Cart"
                  title="Cart"
                >
                  <ShoppingCart className="h-5 w-5" strokeWidth={2.2} />
                  {cartQuantity > 0 && (
                    <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-md shadow-red-500/40">
                      {cartQuantity}
                    </span>
                  )}
                </button>
              )}

              {confirmOpen && createPortal(
                <div className="customer-modal-overlay fixed inset-0 z-[100] flex min-h-screen items-center justify-center p-4">
                  <div className="customer-modal-backdrop logout-modal-backdrop-in absolute inset-0 bg-black/45 backdrop-blur-md" />
                  <div className={`logout-modal-in relative z-40 w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl ${darkMode ? "bg-slate-800 text-white" : "bg-white text-slate-900"}`}>
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                      <LogOut size={22} />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold">Confirm Logout</h3>
                    <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-gray-600"}`}>Are you sure you want to log out?</p>
                    <div className="mt-5 flex justify-center gap-2">
                      <button
                        onClick={() => setConfirmOpen(false)}
                        className={`rounded-lg px-3 py-1 ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-gray-100 hover:bg-gray-200"}`}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleLogoutConfirm}
                        className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700"
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(true);
              }}
              className={`order-9 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition lg:order-10 ${darkMode ? "border-red-500/40 text-red-300 hover:bg-red-500/10" : "border-red-200 text-red-700 hover:bg-red-50"}`}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <nav
        aria-label="Customer navigation"
        className={`customer-mobile-navigation fixed inset-x-0 bottom-0 z-[60] flex w-full items-center justify-around gap-0 border-t px-1 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-2xl lg:hidden ${activeTab === "home"
          ? darkMode
            ? "border-white/15 bg-[rgba(27,39,57,0.88)]"
            : "border-white/55 bg-[rgba(255,255,255,0.58)]"
          : darkMode ? "border-slate-800 bg-slate-950/95" : "border-slate-200 bg-white/95"
        }`}
      >
        {[
          { label: "Home", tab: "home", Icon: Home },
          { label: "Products", tab: "products", Icon: Package },
          { label: "Orders", tab: "orders", Icon: ClipboardList },
          ...(canRequestOrders ? [{ label: "Cart", tab: "cart", Icon: ShoppingCart }] : []),
          { label: "Profile", tab: "profile", Icon: User },
        ].map(({ label, tab, Icon }) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setNotificationsOpen(false);
                setActiveTab(tab);
              }}
              aria-label={tab === "cart" && cartQuantity > 0 ? `Cart, ${cartQuantity} ${cartQuantity === 1 ? "item" : "items"}` : label}
              aria-current={isActive ? "page" : undefined}
              title={label}
              className={`group flex h-[58px] min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-1 text-center transition-[transform,background-color,color] duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transform-none motion-reduce:transition-none ${isActive ? darkMode ? "text-white" : "text-slate-900" : darkMode ? "text-slate-400 hover:bg-slate-800 hover:text-slate-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}
            >
              <span className="relative inline-flex">
                <span
                  className={[
                    "relative z-10 flex items-center justify-center transition-[transform,width,height,border-radius,background-color,border-color,color,box-shadow] duration-[220ms] ease-out group-hover:scale-105 group-active:scale-90 motion-reduce:transition-none",
                    isActive ? "-translate-y-6 size-10 rounded-full border-2 ring-4 shadow-lg" : "size-7 rounded-lg",
                    isActive
                      ? darkMode
                        ? "border-slate-900 bg-gradient-to-br from-brand-dark-fill via-brand to-red-700 text-white ring-red-300/30 shadow-black/50"
                        : "border-white bg-gradient-to-br from-brand via-red-800 to-red-600 text-white ring-red-400/35 shadow-red-900/35"
                      : darkMode
                        ? "text-slate-300 group-hover:bg-white/[0.06]"
                        : "text-slate-600 group-hover:bg-black/[0.04]",
                  ].join(" ")}
                >
                  <Icon size={21} strokeWidth={isActive ? 2.3 : 1.8} aria-hidden="true" />
                </span>
                {tab === "cart" && cartQuantity > 0 && (
                  <span
                    aria-hidden="true"
                    className={`absolute -right-2 -top-1 z-20 inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-1 text-[9px] font-bold leading-none ${darkMode ? "border-slate-900 bg-red-500 text-white" : "border-white bg-red-600 text-white"}`}
                  >
                    {cartQuantity > 99 ? "99+" : cartQuantity}
                  </span>
                )}
              </span>
              <span className={`mt-0.5 max-w-full truncate leading-[12px] transition-opacity duration-150 motion-reduce:transition-none ${isActive ? "text-[11px] font-bold opacity-100" : "text-[10px] font-medium opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`} aria-hidden="true">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className={`mx-auto flex w-full flex-1 flex-col p-3 sm:p-4 md:p-6 ${activeTab === "home" ? "customer-dashboard-home-container" : activeTab === "about" ? "max-w-[1560px]" : "max-w-7xl"}`}>
        {onlineOrderCooldownActive && activeTab !== "cart" && (
          <div role="alert" className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${darkMode ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            {renderAdminContactMessage(onlineOrderCooldownMessage)}
          </div>
        )}
        {activeTab === "home" && (
          <div className="customer-dashboard-home-grid">
            <div className="customer-dashboard-home-main">
            <section className={`customer-dashboard-welcome-hero flex flex-col gap-4 rounded-2xl border p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between sm:p-7 ${panelClass}`}>
              <div>
                <p className={`customer-dashboard-eyebrow text-xs font-bold uppercase tracking-[0.16em] ${darkMode ? "text-red-300" : "text-red-700"}`}>Customer Dashboard</p>
                <h1 className={`customer-dashboard-welcome-title mt-2 text-3xl font-black tracking-tight sm:text-4xl ${sectionTextClass}`}>
                  Welcome back, {user?.first_name || profileDisplayName.split(" ")[0] || "Customer"}!
                </h1>
                <p className={`customer-dashboard-welcome-subtitle mt-2 text-sm sm:text-base ${sectionMutedTextClass}`}>Here’s an overview of your orders and project activities.</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("products")}
                className="customer-dashboard-products-button inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                <ShoppingCart size={17} aria-hidden="true" />
                Browse Products
              </button>
            </section>

            <section aria-label="Order summary" className="customer-dashboard-order-counts grid gap-4 md:grid-cols-3">
              {[
                { label: "Active Orders", value: activeOrdersCount, description: "Projects in progress", filter: "order", icon: Package, accent: "#2563eb" },
                { label: "Pending Orders", value: pendingOrdersCount, description: "Waiting for review or action", filter: "pending", icon: Clock3, accent: "#d97706" },
                { label: "Completed Orders", value: completedProjectsCount, description: "Successfully completed projects", filter: "completed", icon: CheckCircle, accent: "#16875a" },
              ].map(({ label, value, description, filter, icon: Icon, accent }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => showOrdersFilter(filter)}
                  aria-label={`${label}: ${ordersLoading ? "loading" : ordersLoadError ? "unavailable" : value}. View ${label.toLowerCase()}.`}
                  style={{ "--summary-accent": accent }}
                  className={`customer-dashboard-count-card admin-dashboard-summary-card ${darkMode ? "is-dark" : ""}`}
                >
                  <span className="admin-dashboard-summary-top">
                    <span>
                      <span className="admin-dashboard-summary-label">{label}</span>
                      <span className={`mt-1 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{description}</span>
                    </span>
                    <span className="admin-dashboard-summary-icon"><Icon size={21} strokeWidth={2} aria-hidden="true" /></span>
                  </span>
                  <span className="admin-dashboard-summary-count">{ordersLoading || ordersLoadError ? "—" : value}</span>
                  <span className="admin-dashboard-summary-link">View orders <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" /></span>
                </button>
              ))}
            </section>

              <section className={`customer-dashboard-orders-card min-w-0 overflow-hidden rounded-2xl border shadow-sm ${panelClass}`} aria-labelledby="customer-dashboard-recent-orders-title">
                <div className={`customer-dashboard-orders-header flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div>
                    <h2 id="customer-dashboard-recent-orders-title" className={`customer-dashboard-section-title text-lg font-bold ${sectionTextClass}`}>Recent Orders</h2>
                    <p className={`customer-dashboard-section-subtitle mt-0.5 text-sm ${sectionMutedTextClass}`}>Your five most recently submitted orders</p>
                  </div>
                  <button type="button" onClick={() => showOrdersFilter("all")} className={`customer-dashboard-view-all inline-flex items-center gap-1 text-sm font-semibold ${darkMode ? "text-red-300 hover:text-white" : "text-red-700 hover:text-red-900"}`}>
                    View all <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>

                {ordersLoadError ? (
                  <div role="alert" className={`m-4 rounded-xl border p-4 text-sm ${darkMode ? "border-red-900 bg-red-950/40 text-red-200" : "border-red-200 bg-red-50 text-red-700"}`}>{ordersLoadError}</div>
                ) : ordersLoading ? (
                  <div className="space-y-3 p-4" aria-label="Loading recent orders">
                    {[...Array(3)].map((_, index) => <div key={index} className={`h-14 animate-pulse rounded-xl ${darkMode ? "bg-slate-700" : "bg-slate-100"}`} />)}
                  </div>
                ) : dashboardRecentOrders.length === 0 ? (
                  <div className={`m-4 rounded-xl border border-dashed px-5 py-9 text-center ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-300 bg-slate-50"}`}>
                    <ClipboardList className={`mx-auto size-8 ${darkMode ? "text-slate-500" : "text-slate-400"}`} aria-hidden="true" />
                    <p className={`mt-3 font-semibold ${sectionTextClass}`}>No orders yet</p>
                    <p className={`mt-1 text-sm ${sectionMutedTextClass}`}>Your orders will appear here after you submit a request.</p>
                  </div>
                ) : (
                  <>
                  <div className="customer-dashboard-orders-scroll hidden overflow-x-auto md:block">
                    <table className="customer-dashboard-orders-table w-full min-w-[720px] text-left text-sm">
                      <thead className={darkMode ? "bg-slate-900/50 text-slate-300" : "bg-slate-50 text-slate-600"}>
                        <tr>
                          {["No.", "Order / Project", "Order Date", "Total Amount", "Payment", "Order Status", "Action"].map((heading) => <th key={heading} scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wide">{heading}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardRecentOrders.map((order, index) => {
                          const items = Array.isArray(order.items) ? order.items : [];
                          const name = items.length > 1 ? "Batch Order" : items[0]?.name || items[0]?.product_name || "Project";
                          const paymentSummary = getPaymentSummary(order);
                          const paymentTone = ["paid", "downpayment"].includes(paymentSummary.status?.key) ? "is-paid" : "is-pending";
                          const normalizedStatus = normalizeOrderStatusKey(order.status);
                          const statusTone = normalizedStatus === "processing"
                            ? "is-processing"
                            : normalizedStatus === "site_inspection"
                              ? "is-site-inspection"
                              : normalizedStatus === "completed"
                                ? "is-completed"
                                : ["cancelled", "contract_declined", "declined", "rejected"].includes(normalizedStatus)
                                  ? "is-error"
                                  : "is-progress";
                          const orderId = getOrderIdentifier(order, `dashboard-order-${index}`);
                          return (
                            <tr key={orderId} className={darkMode ? "text-slate-200" : "text-slate-700"}>
                              <td className="customer-dashboard-row-number px-4 py-3.5 tabular-nums">{index + 1}</td>
                              <td className={`customer-dashboard-project-name px-4 py-3.5 font-semibold ${sectionTextClass}`} title={name}>{name}</td>
                              <td className="px-4 py-3.5">{formatDateToMMMDDYYYY(order.createdAt || order.updatedAt) || "—"}</td>
                              <td className="customer-dashboard-total-amount px-4 py-3.5 font-semibold">{formatCurrency(getOrderTotalValue(order))}</td>
                              <td className="px-4 py-3.5"><span className="customer-dashboard-payment-status"><span className={`customer-dashboard-payment-dot ${paymentTone}`} aria-hidden="true" />{paymentSummary.status?.label || "Unpaid"}</span></td>
                              <td className="px-4 py-3.5"><span className={`customer-dashboard-order-status ${statusTone} inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getOrderStatusClasses(order.status)}`}>{getOrderStatusLabel(order.status)}</span></td>
                              <td className="px-4 py-3.5">
                                <button type="button" onClick={() => setSelectedOrderForModal(order)} className={`inline-flex size-11 items-center justify-center rounded-xl transition-colors ${darkMode ? "bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`} aria-label={`View details for ${name}`} title={`View details for ${name}`}><Eye size={18} strokeWidth={2.25} aria-hidden="true" /></button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-2.5 p-3 md:hidden">
                    {dashboardRecentOrders.map((order, index) => {
                      const items = Array.isArray(order.items) ? order.items : [];
                      const name = items.length > 1 ? "Batch Order" : items[0]?.name || items[0]?.product_name || "Project";
                      const paymentSummary = getPaymentSummary(order);
                      const paymentTone = ["paid", "downpayment"].includes(paymentSummary.status?.key) ? "is-paid" : "is-pending";
                      const normalizedStatus = normalizeOrderStatusKey(order.status);
                      const statusTone = normalizedStatus === "processing"
                        ? "is-processing"
                        : normalizedStatus === "site_inspection"
                          ? "is-site-inspection"
                          : normalizedStatus === "completed"
                            ? "is-completed"
                            : ["cancelled", "contract_declined", "declined", "rejected"].includes(normalizedStatus)
                              ? "is-error"
                              : "is-progress";
                      const orderId = getOrderIdentifier(order, `dashboard-order-mobile-${index}`);

                      return (
                        <article key={orderId} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900/35" : "border-slate-200 bg-white"}`}>
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={`text-[10px] font-bold uppercase tracking-wide ${sectionMutedTextClass}`}>Order {index + 1}</p>
                              <h3 className={`mt-0.5 truncate text-sm font-bold ${sectionTextClass}`} title={name}>{name}</h3>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className={`text-[10px] font-semibold uppercase tracking-wide ${sectionMutedTextClass}`}>Total Amount</p>
                              <p className={`text-sm font-extrabold ${darkMode ? "text-emerald-400" : "text-emerald-700"}`}>{formatCurrency(getOrderTotalValue(order))}</p>
                            </div>
                          </div>

                          <div className={`mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-2.5 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                            <div className="min-w-0">
                              <p className={`text-[10px] font-semibold uppercase tracking-wide ${sectionMutedTextClass}`}>Order Date</p>
                              <p className={`mt-0.5 truncate text-xs font-medium ${sectionTextClass}`}>{formatDateToMMMDDYYYY(order.createdAt || order.updatedAt) || "—"}</p>
                            </div>
                            <div className="min-w-0">
                              <p className={`text-[10px] font-semibold uppercase tracking-wide ${sectionMutedTextClass}`}>Payment</p>
                              <span className="customer-dashboard-payment-status mt-0.5">
                                <span className={`customer-dashboard-payment-dot ${paymentTone}`} aria-hidden="true" />
                                {paymentSummary.status?.label || "Unpaid"}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className={`text-[10px] font-semibold uppercase tracking-wide ${sectionMutedTextClass}`}>Order Status</p>
                              <span className={`customer-dashboard-order-status ${statusTone} mt-0.5 inline-flex max-w-full rounded-full px-2 py-1 text-[10px] font-semibold ${getOrderStatusClasses(order.status)}`}>{getOrderStatusLabel(order.status)}</span>
                            </div>
                            <div className="flex items-end justify-end">
                              <button type="button" onClick={() => setSelectedOrderForModal(order)} className={`inline-flex size-9 items-center justify-center rounded-lg transition-colors ${darkMode ? "bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`} aria-label={`View details for ${name}`} title={`View details for ${name}`}><Eye size={17} strokeWidth={2.25} aria-hidden="true" /></button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  </>
                )}
              </section>
            </div>

              <section className={`customer-dashboard-updates-card min-w-0 overflow-hidden rounded-2xl border shadow-sm ${panelClass}`} aria-labelledby="customer-dashboard-recent-updates-title">
                <div className={`customer-dashboard-updates-header flex items-center justify-between gap-3 border-b px-4 py-4 sm:px-5 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div>
                    <h2 id="customer-dashboard-recent-updates-title" className={`customer-dashboard-section-title text-lg font-bold ${sectionTextClass}`}>Recent Updates</h2>
                    <p className={`customer-dashboard-section-subtitle mt-0.5 text-sm ${sectionMutedTextClass}`}>Latest order and project activity</p>
                  </div>
                  <button type="button" onClick={() => setActiveTab("notifications")} className={`customer-dashboard-view-all inline-flex shrink-0 items-center gap-1 text-sm font-semibold ${darkMode ? "text-red-300 hover:text-white" : "text-red-700 hover:text-red-900"}`}>
                    View all <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>

                {ordersLoading && dashboardRecentNotifications.length === 0 ? (
                  <div className="customer-dashboard-updates-feed-state space-y-3 p-4" aria-label="Loading recent updates">
                  {[...Array(6)].map((_, index) => <div key={index} className={`h-16 animate-pulse rounded-xl ${darkMode ? "bg-slate-700" : "bg-slate-100"}`} />)}
                  </div>
                ) : ordersLoadError && dashboardRecentNotifications.length === 0 ? (
                  <div role="alert" className={`customer-dashboard-updates-feed-state m-4 rounded-xl border p-4 text-sm ${darkMode ? "border-red-900 bg-red-950/40 text-red-200" : "border-red-200 bg-red-50 text-red-700"}`}>{ordersLoadError}</div>
                ) : dashboardRecentNotifications.length === 0 ? (
                  <div className={`customer-dashboard-updates-feed-state m-4 rounded-xl border border-dashed px-5 py-9 text-center ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-300 bg-slate-50"}`}>
                    <Bell className={`mx-auto size-8 ${darkMode ? "text-slate-500" : "text-slate-400"}`} aria-hidden="true" />
                    <p className={`mt-3 font-semibold ${sectionTextClass}`}>No updates yet</p>
                    <p className={`mt-1 text-sm ${sectionMutedTextClass}`}>Updates about your orders and projects will appear here.</p>
                  </div>
                ) : (
                  <ul className={`customer-dashboard-updates-feed divide-y ${darkMode ? "divide-slate-700" : "divide-slate-100"}`}>
                    {dashboardRecentNotifications.map((notification) => {
                      const updateTitles = {
                        contract: "Contract available",
                        transaction_approved: "Payment approved",
                        payment_confirmed: "Payment verified",
                        admin_payment_recorded: "Payment recorded",
                        payment_rejected: "Payment needs attention",
                        installation_up_next: "Installation scheduled",
                        installation_completed: "Installation completed",
                        product_ready_for_review: "Product ready for review",
                        project_delay: notification.title || "Project progress update",
                        delay: notification.title || "Project progress update",
                        repair_request: notification.title || "Repair request update",
                      };
                      const title = notification.title || updateTitles[notification.notificationType] || "Order status updated";
                      const message = notification.message || getCustomerOrderNotificationMessage(notification);
                      const isRead = readNotificationIds.has(notification.notificationId);
                      return (
                        <li key={notification.notificationId}>
                          <button type="button" onClick={() => openOrderDetailsFromNotification(notification, notification)} className={`customer-dashboard-update-row flex w-full gap-3 px-5 py-4 text-left transition-colors ${darkMode ? "hover:bg-slate-700/50" : "hover:bg-slate-50"}`}>
                            <span className={`customer-dashboard-update-icon mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${isRead ? darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500" : darkMode ? "bg-red-950 text-red-300" : "bg-red-50 text-red-700"}`}><Bell size={17} aria-hidden="true" /></span>
                            <span className="min-w-0 flex-1">
                              <span className={`customer-dashboard-update-title block text-sm font-bold ${sectionTextClass}`}>{title}</span>
                              <span className={`customer-dashboard-update-message mt-1 block text-xs leading-5 ${sectionMutedTextClass}`}>{message}</span>
                              <span className={`customer-dashboard-update-time mt-1.5 block text-[11px] ${darkMode ? "text-slate-500" : "text-slate-400"}`}>{formatTimeAgo(notification.notificationDate || notification.updatedAt || notification.createdAt)}</span>
                            </span>
                            <ArrowUpRight size={15} className={`mt-1 shrink-0 ${darkMode ? "text-slate-500" : "text-slate-400"}`} aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
          </div>
        )}
        {activeTab === "products" && (
          <>
            <div>
              <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(17rem,0.8fr)_minmax(0,2.2fr)] lg:items-center">
                <div className="min-w-0">
                  <h2 className={`text-3xl font-bold leading-tight ${darkMode ? "text-white" : "text-slate-900"}`}>Products</h2>
                  <p className={`mt-1 text-sm leading-5 ${darkMode ? "text-slate-300" : "text-gray-500"}`}>Browse available aluminum &amp; glass products</p>
                </div>
                <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)_minmax(9rem,12rem)]">
                  <div className="relative min-w-0">
                    <Search size={18} className="absolute left-3 top-3 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search products..."
                      className={`w-full pl-10 pr-4 py-3 border rounded-2xl ${darkMode ? "border-slate-700 bg-slate-800 text-white placeholder:text-slate-400" : "border-slate-200 bg-white text-slate-900"}`}
                    />
                  </div>
                  <FilterDropdown
                    label="All types"
                    value={productTypeFilter}
                    onChange={setProductTypeFilter}
                    darkMode={darkMode}
                    options={[["All", "All types"], ...productTypeOptions.map((type) => [type, type])]}
                  />
                  <FilterDropdown
                    label="All categories"
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                    darkMode={darkMode}
                    options={[["All", "All categories"], ...productCategoryOptions.map((category) => [category, category.charAt(0).toUpperCase() + category.slice(1)])]}
                  />
                </div>
              </div>

              {productError && <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">{productError}</div>}

              {isLoadingProducts ? (
                <div className="mx-auto grid w-full min-w-0 max-w-[1200px] grid-cols-1 gap-3 min-[768px]:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] min-[768px]:gap-5">{[...Array(6)].map((_, i) => <div key={i} className={`min-h-[196px] animate-pulse rounded-[18px] border min-[768px]:min-h-[410px] ${darkMode ? "border-[#3d4862] bg-[#2a3246]" : "border-slate-200 bg-white"}`} />)}</div>
              ) : visibleProducts.length === 0 ? (
                <div className={`rounded-3xl p-10 text-center shadow ${darkMode ? "bg-slate-800 text-slate-200" : "bg-white text-gray-600"}`}><p className={darkMode ? "text-slate-300" : "text-gray-600"}>No products matched your search.</p></div>
              ) : (
                <>
                  <div className="mx-auto grid w-full min-w-0 max-w-[1200px] grid-cols-1 gap-3 min-[768px]:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] min-[768px]:gap-5">
                    {displayedProducts.map((product, index) => (
                      <div
                        key={product._id || product.name}
                        className="customer-product-card group relative flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-[18px] border border-[var(--product-border)] bg-[var(--product-card)] shadow-[0_4px_14px_rgba(30,24,16,0.08)] transition-[transform,box-shadow,border-color] duration-[180ms] ease-out hover:-translate-y-1 hover:border-red-300 hover:shadow-[0_16px_36px_rgba(30,24,16,0.16)] motion-reduce:transition-none"
                        onClick={() => handleViewProduct(product)}
                      >
                        <div className="product-card-image group/image relative aspect-[4/3] overflow-hidden bg-slate-100">
                          <div data-product-image-skeleton className="absolute inset-0 animate-pulse bg-slate-200 motion-reduce:animate-none" />
                          <img
                            src={getProductImage(product, 480) || PRODUCT_IMAGE_PLACEHOLDER}
                            srcSet={getProductImageSrcSet(getProductImage(product, 480), [240, 480, 720])}
                            sizes={isMobile ? "30vw" : "(max-width: 1280px) 33vw, 25vw"}
                            alt={product.name}
                            width="480"
                            height="360"
                            loading={index < (isMobile ? 2 : 4) ? "eager" : "lazy"}
                            fetchPriority={index === 0 ? "high" : "auto"}
                            decoding="async"
                            onLoad={handleProductImageLoad}
                            onError={handleProductImageError}
                            className="h-full w-full object-cover transition-transform duration-[350ms] ease-out group-hover/image:scale-105 motion-reduce:transition-none"
                          />
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-black/30 to-transparent" />

                          <div className="product-card-badges absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
                            {product.is_featured ? (
                              <>
                                <span aria-label="Top Product" title="Top Product" className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--product-gold)] px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[0.07em] text-[var(--product-gold-text)]">
                                  <Star className="size-[11px] shrink-0" fill="currentColor" aria-hidden="true" />
                                  Top Product
                                </span>
                                <span title={product.category || "General"} className="inline-flex min-w-0 max-w-[55%] truncate whitespace-nowrap rounded-full bg-[rgba(30,26,22,0.72)] px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[0.07em] text-white backdrop-blur-sm">
                                  {product.category || "General"}
                                </span>
                              </>
                            ) : (
                              <span className="inline-flex max-w-[70%] truncate whitespace-nowrap rounded-full bg-[rgba(30,26,22,0.72)] px-[11px] py-[5px] text-[10.5px] font-bold uppercase tracking-[0.07em] text-white backdrop-blur-sm">
                                {product.category ? product.category.charAt(0).toUpperCase() + product.category.slice(1) : "General"}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="product-card-details flex min-w-0 flex-1 flex-col p-4">
                          <div>
                            <h3 className="line-clamp-2 text-[16.5px] font-extrabold leading-tight text-[var(--product-text)]" title={product.name}>{product.name}</h3>
                            <p className="mt-1 truncate text-[12.5px] font-medium text-[var(--product-muted)]">{product.product_type || product.category || "General"}</p>
                          </div>

                          {canAccessCustomerRatings && (
                            <div className="customer-product-rating mt-[10px] flex min-w-0 items-center gap-1.5">
                              <span className="flex shrink-0 items-center gap-[1px] tracking-[1px]">{renderRatingStars(productReviewStats[product._id || product.id]?.averageRating || 0, 14, darkMode)}</span>
                              <span className="truncate text-xs font-semibold text-[var(--product-muted)]">
                                {productReviewStats[product._id || product.id]?.averageRating > 0
                                  ? `${productReviewStats[product._id || product.id].averageRating.toFixed(1)} / ${productReviewStats[product._id || product.id].ratingsCount} reviews`
                                  : "No ratings yet"}
                              </span>
                            </div>
                          )}

                          {String(product.pricing_method || product.unit).toLowerCase() === "blade" && product.sell_with_frame && product.blade_frame_types?.length > 0 && (
                            <p className="product-card-metrics mt-2 flex min-h-[62px] flex-wrap content-center items-baseline gap-x-1 text-sm leading-5 text-[var(--product-text)]" title={`With frame: ${product.blade_frame_types.map((frame) => frame.name).join(" / ")}`}>
                              <span className="font-semibold text-[var(--product-muted)]">With frame:</span>
                              <span className="font-bold">{product.blade_frame_types.map((frame) => frame.name).join(" / ")}</span>
                            </p>
                          )}

                          {String(product.pricing_method || product.unit).toLowerCase() !== "blade" && (
                          <div className="product-card-metrics mt-2 flex min-h-[62px] flex-col justify-center divide-y divide-dashed divide-[var(--product-border)] text-sm">
                            {!isBladePricingProduct(product) && (getProductDefaultDimensions(product).width > 0 || getProductDefaultDimensions(product).height > 0) && <>
                              <p className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                                <span className="shrink-0 font-medium text-[var(--product-muted)]">Width × Height</span>
                                <span className="truncate text-right font-bold text-[var(--product-text)]">
                                  {getProductDefaultDimensions(product).width || "N/A"} × {getProductDefaultDimensions(product).height || "N/A"}
                                </span>
                              </p>
                            </>}
                            <p className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                              <span className="font-medium text-[var(--product-muted)]">Unit rate</span>
                              <span className="font-bold text-[var(--product-text)]">{getProductUnitRate(product)}</span>
                            </p>
                          </div>
                          )}

                          <div className="product-card-footer mt-auto flex items-end justify-between gap-3 border-t border-[var(--product-border)] pt-3">
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-[0.1em] text-[var(--product-muted)]">Starting from</p>
                              <p className="mt-1 truncate text-[22px] font-extrabold leading-tight text-[var(--product-price)]">{getProductPrice(product)}</p>
                            </div>
                            {canRequestOrders && (
                              <div className="flex shrink-0 items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openOrderNowModal(product);
                                  }}
                                  className="inline-flex size-[38px] items-center justify-center rounded-full border border-[var(--product-border)] bg-[var(--product-card)] text-[var(--product-text)] transition-colors duration-150 hover:border-red-600 hover:bg-red-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                  aria-label="Place order"
                                  title="Place order"
                                >
                                  <Package size={17} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleAddToCart(product);
                                  }}
                                  className="inline-flex size-[38px] items-center justify-center rounded-full border border-red-600 bg-red-600 text-white transition-colors duration-150 hover:border-red-700 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                  aria-label="Add to cart"
                                  title="Add to cart"
                                >
                                  <ShoppingCart size={17} aria-hidden="true" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {visibleProducts.length > 0 && !isMobile && (
                    <div className={`mt-8 grid gap-4 rounded-[20px] border p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)] md:grid-cols-[1fr_auto_1fr] md:items-center ${
                      darkMode ? "border-slate-700 bg-slate-800" : "border-red-100 bg-white"
                    }`}>
                      <div className={`flex min-w-0 items-center gap-3 text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                        <span className="shrink-0 whitespace-nowrap">Items per page</span>
                        <CustomerDropdown
                          ariaLabel="Items per page"
                          darkMode={darkMode}
                          value={productsPerPage === 0 ? "all" : productsPerPage}
                          onChange={(event) => {
                            setProductsPerPage(event.target.value === "all" ? 0 : Number(event.target.value));
                            setProductPage(1);
                          }}
                          className="h-11 !w-36 min-w-0 shrink-0 rounded-xl px-3"
                        >
                          <option value={4}>4</option>
                          <option value={8}>8</option>
                          <option value={12}>12</option>
                          <option value={16}>16</option>
                          <option value="all">All products</option>
                        </CustomerDropdown>
                      </div>

                      {visibleProducts.length > 0 && (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                            disabled={paginatedProducts.currentPage === 1}
                            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                              darkMode
                                ? "border-slate-600 bg-slate-700 text-slate-100 hover:border-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                                : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            }`}
                          >
                            Previous
                          </button>

                          <div className="flex items-center gap-1">
                            {Array.from({ length: Math.max(1, paginatedProducts.totalPages) }, (_, index) => index + 1).map((pageNumber) => (
                              <button
                                key={pageNumber}
                                type="button"
                                onClick={() => setProductPage(pageNumber)}
                                className={`h-9 min-w-9 rounded-xl px-2 text-sm font-bold transition ${
                                  pageNumber === paginatedProducts.currentPage
                                    ? "bg-red-600 text-white shadow-sm"
                                    : darkMode
                                      ? "border border-slate-600 bg-slate-700 text-slate-100 hover:border-red-400 hover:text-red-300"
                                      : "border border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:text-red-600"
                                }`}
                              >
                                {pageNumber}
                              </button>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => setProductPage((page) => Math.min(Math.max(1, paginatedProducts.totalPages), page + 1))}
                            disabled={paginatedProducts.currentPage >= paginatedProducts.totalPages}
                            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                              darkMode
                                ? "border-slate-600 bg-slate-700 text-slate-100 hover:border-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                                : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                            }`}
                          >
                            Next
                          </button>
                        </div>
                      )}

                      <div className={`text-right text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                        Showing {paginatedProducts.items.length ? (paginatedProducts.currentPage - 1) * effectiveProductsPerPage + 1 : 0}
                        {paginatedProducts.items.length ? `-${Math.min(paginatedProducts.currentPage * effectiveProductsPerPage, visibleProducts.length)}` : ""} of {visibleProducts.length} products
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {selectedProduct && (
              <div className={`customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 ${!isProductModalReadOnly && isBladePricingProduct(selectedProduct) ? "max-[759px]:!items-stretch max-[759px]:!justify-start max-[759px]:!p-0" : ""}`}>
                <div className={`mobile-fullscreen-dialog order-flow-modal relative flex w-full flex-col overflow-hidden ${!isProductModalReadOnly && isBladePricingProduct(selectedProduct) ? "max-h-[92vh] max-w-[1000px] rounded-[18px] max-[759px]:!h-dvh max-[759px]:!max-h-dvh max-[759px]:!max-w-none max-[759px]:!rounded-none" : "max-h-[88vh] max-w-5xl rounded-2xl"} bg-white shadow-2xl ${darkMode ? `order-flow-modal-dark ${!isProductModalReadOnly && isBladePricingProduct(selectedProduct) ? "blade-product-modal-dark" : ""}` : ""}`}>
                  {/* Header with cleaner elevated styling */}
                  {!isProductModalReadOnly && (
                    <div className={`flex-shrink-0 border-b border-red-500/30 shadow-[0_8px_18px_rgba(220,38,38,0.16)] ${isBladePricingProduct(selectedProduct) ? "bg-[linear-gradient(135deg,#dc2626,#991b1b)] px-5 py-3.5" : "bg-gradient-to-r from-red-700 via-red-600 to-red-600 px-4 py-2.5 sm:px-5 sm:py-3"}`}>
                      <div className="flex min-w-0 items-center justify-between gap-4">
                        <div className={`flex min-w-0 items-center gap-2.5 ${darkMode && isBladePricingProduct(selectedProduct) ? "text-[#e8ebf2]" : "text-white"}`}>
                          <div className={`flex shrink-0 items-center justify-center rounded-xl ring-1 ring-white/20 ${isBladePricingProduct(selectedProduct) ? "h-10 w-10 bg-white/18" : "h-9 w-9 bg-white/12"}`}>
                            <Package size={18} aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-red-100">Product details</p>
                            <h3 className={`truncate text-base font-bold leading-tight sm:text-lg ${darkMode && isBladePricingProduct(selectedProduct) ? "text-[#e8ebf2]" : ""}`}>{selectedProduct.name}</h3>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={requestCloseProductModal}
                          aria-label="Close product details"
                          className={`flex flex-shrink-0 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-white/60 ${darkMode && isBladePricingProduct(selectedProduct) ? "text-[#e8ebf2]" : "text-white"} ${isBladePricingProduct(selectedProduct) ? "h-[34px] w-[34px] bg-white/18 hover:bg-white/25" : "h-8 w-8 bg-white/10 hover:bg-white/15 sm:h-9 sm:w-9"}`}
                        >
                          <X size={20} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border border-white/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${isBladePricingProduct(selectedProduct) ? "bg-white/20" : "bg-white/10"} ${darkMode && isBladePricingProduct(selectedProduct) ? "text-[#e8ebf2]" : "text-white"}`}>
                          {selectedProduct.category || selectedProduct.product_type || "General"}
                        </span>
                        <span className={`flex items-center gap-1.5 text-xs font-medium ${darkMode && isBladePricingProduct(selectedProduct) ? "text-[#e8ebf2]" : "text-red-50"}`}><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />Ready for inquiry</span>
                      </div>
                    </div>
                  )}
                  {isProductModalReadOnly && (
                    <button
                      type="button"
                      onClick={requestCloseProductModal}
                      aria-label="Close product details"
                      className={`absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full shadow-md transition ${darkMode ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-white text-slate-700 hover:bg-slate-100"}`}
                    >
                      <X size={18} aria-hidden="true" />
                    </button>
                  )}

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto">
                    {onlineOrderCooldownActive && (
                      <div role="alert" className={`mx-4 mt-4 rounded-xl border p-4 sm:mx-5 ${darkMode ? "border-rose-500/50 bg-rose-950/35 text-rose-100" : "border-rose-300 bg-rose-50 text-rose-900"}`}>
                        <p className="text-sm font-black">Online ordering is restricted for 7 days</p>
                        <p className="mt-1 text-sm leading-5">{renderAdminContactMessage(onlineOrderCooldownMessage)}</p>
                      </div>
                    )}
                    <div className={`grid items-start gap-4 p-[18px] sm:p-5 ${isProductModalReadOnly ? "md:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:gap-8 lg:p-7" : isBladePricingProduct(selectedProduct) ? "min-[560px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.9fr)] lg:gap-7 lg:p-6"}`}>
                      {/* Left: Product Image & Description */}
                      <div className={`min-w-0 space-y-4 ${isProductModalReadOnly ? darkMode ? "rounded-xl bg-slate-800 p-2" : "rounded-xl bg-slate-50 p-2" : ""}`}>
                        <div className="space-y-2">
                          <div
                            style={!isProductModalReadOnly && isBladePricingProduct(selectedProduct) ? { height: "clamp(200px, 32vh, 360px)", maxHeight: "360px" } : undefined}
                            className={`relative w-full overflow-hidden rounded-2xl border bg-white shadow-sm ${!isProductModalReadOnly && isBladePricingProduct(selectedProduct) ? `min-h-[200px] rounded-[14px] ${darkMode ? "border-[#3d4862]" : "border-slate-200"}` : "aspect-[3/2] border-transparent"}`}
                          >
                            <div data-product-image-skeleton className="absolute inset-0 animate-pulse bg-slate-200 motion-reduce:animate-none" />
                            <img
                                                            onLoad={handleProductImageLoad}
                              src={activeProductImage.url}
                              srcSet={getProductImageSrcSet(activeProductImage.url, [480, 960, 1200])}
                              sizes="(max-width: 768px) 100vw, 50vw"
                              alt={`${selectedProduct.name} - ${activeProductImage.label}`}
                              width="1200"
                              height="900"
                              loading="eager"
                              decoding="async"
                              className={`h-full w-full ${!isProductModalReadOnly && isBladePricingProduct(selectedProduct) ? "object-cover" : "object-fill"}`}
                              onError={(event) => {
                                event.currentTarget.onerror = null;
                                event.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                              }}
                            />
                          </div>
                          {selectedProductImages.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Product photo angles">
                              {selectedProductImages.map((image, index) => (
                                <button
                                  key={`${image.url}-${index}`}
                                  type="button"
                                  onClick={() => setSelectedProductImageIndex(index)}
                                  aria-label={`View ${image.label}`}
                                  aria-pressed={selectedProductImageIndex === index}
                                  className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition ${selectedProductImageIndex === index ? "border-red-600" : "border-transparent hover:border-red-300"}`}
                                >
                                  <img src={image.url || PRODUCT_IMAGE_PLACEHOLDER} alt="" width="120" height="120" loading="lazy" decoding="async" onError={handleProductImageError} className="h-full w-full object-cover" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {!isProductModalReadOnly && !isBladePricingProduct(selectedProduct) && <>
                          <div className={`rounded-2xl border p-5 ${darkMode ? "border-slate-600 bg-slate-800" : "border-slate-300 bg-slate-100"}`}>
                            <h4 className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Product Details</h4>
                            <p className={`mt-2 text-base leading-7 ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                              {selectedProduct.description || "No description available."}
                            </p>
                          </div>

                        </>}
                        {(!isBladePricingProduct(selectedProduct) || isProductModalReadOnly) && <ProductSpecifications product={selectedProduct} darkMode={darkMode} />}

                      </div>

                      {/* Right: Action Buttons & Info */}
                      <div className={`${!isProductModalReadOnly && isBladePricingProduct(selectedProduct) ? "contents" : `min-w-0 space-y-3 ${isProductModalReadOnly ? darkMode ? "rounded-xl bg-slate-900 p-4 sm:p-5" : "rounded-xl bg-white p-4 sm:p-5" : ""}`}`}>
                        {!isProductModalReadOnly && <>
                        {isBladePricingProduct(selectedProduct) ? (
                          <div className="grid grid-cols-1 content-start gap-3">
                            <div className={`min-w-0 rounded-xl border px-5 py-4 ${darkMode ? "border-[#3d4862] bg-red-950/20" : "border-red-200 bg-red-50"}`}>
                              <p className={`text-[10.5px] font-bold uppercase tracking-[0.08em] ${darkMode ? "text-[#ff9f96]" : "text-red-700"}`}>Starting from</p>
                              <p className={`mt-0.5 text-[28px] font-extrabold leading-tight ${darkMode ? "text-[#ff9f96]" : "text-red-700"}`}>{getProductPrice(selectedProduct)}</p>
                              <p className={`mt-0.5 text-xs ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>Price may vary based on specifications</p>
                            </div>
                            <ProductSpecifications product={selectedProduct} darkMode={darkMode} compact />
                          </div>
                        ) : null}
                        </>}
                        {!isProductModalReadOnly && isBladePricingProduct(selectedProduct) && (
                          <div className={`min-w-0 rounded-xl border px-4 py-3 min-[560px]:col-span-full ${darkMode ? "border-[#3d4862] bg-[#2a3246]" : "border-slate-200 bg-white"}`}>
                            <p className={`text-[10.5px] font-bold uppercase tracking-[0.08em] ${darkMode ? "text-[#a9b3c7]" : "text-slate-500"}`}>Product Details</p>
                            <p className={`mt-1 text-sm ${darkMode ? "text-[#a9b3c7]" : "text-slate-600"}`}>
                              {selectedProduct.description || "No description available."}
                            </p>
                          </div>
                        )}
                        {!isProductModalReadOnly && !isBladePricingProduct(selectedProduct) && (
                          <div className={`rounded-2xl border p-4 ${darkMode ? "border-red-900 bg-red-950/40" : "border-red-200 bg-red-50"}`}>
                            <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${darkMode ? "text-red-200" : "text-slate-500"}`}>Starting from</p>
                            <p className={`mt-1 text-3xl font-black ${darkMode ? "text-white" : "text-red-700"}`}>{getProductPrice(selectedProduct)}</p>
                            <p className={`mt-1 text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Price may vary based on specifications</p>
                          </div>
                        )}
                        {isProductModalReadOnly && (
                          <>
                            <div className="flex flex-wrap items-center gap-2 pr-10">
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${darkMode ? "bg-red-950/60 text-red-300" : "bg-red-50 text-red-800"}`}>
                                {selectedProduct.product_type || selectedProduct.type || "Glass & Aluminum"}
                              </span>
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                                {selectedProduct.category || "General"}
                              </span>
                            </div>
                            <h3 className={`text-2xl font-black leading-tight ${darkMode ? "text-white" : "text-slate-900"}`}>
                              {selectedProduct.name}
                            </h3>
                            <p className={`text-xl font-black ${darkMode ? "text-white" : "text-slate-900"}`}>
                              {getProductUnitRate(selectedProduct)}
                            </p>
                            <div className={`border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                              <p className={`text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                {selectedProductDimensions}
                              </p>
                              <p className={`mt-4 whitespace-pre-line text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                {selectedProduct.description || "No description available."}
                              </p>
                            </div>
                            {!canRequestOrders && (
                              <div className={`flex items-center justify-center gap-2 border-y py-4 text-xs ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-100 text-slate-400"}`}>
                                <Phone size={14} aria-hidden="true" />
                                <span>Call for inquiries: <strong className={darkMode ? "text-slate-300" : "text-slate-600"}>09123456789</strong></span>
                              </div>
                            )}
                          </>
                        )}
                        {false && <section className={`overflow-hidden rounded-xl border border-t-2 p-3.5 ${darkMode ? "border-slate-700 border-t-red-500 bg-slate-900" : "border-slate-200 border-t-red-600 bg-white"}`} aria-labelledby="product-estimator-title">
                          <div className="flex items-center gap-2">
                            <Ruler size={16} className="text-red-600" aria-hidden="true" />
                            <h4 id="product-estimator-title" className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Price Estimator</h4>
                          </div>
                          {productEstimatorNeedsDimensions && <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(88px,0.8fr)]">
                            <label className="min-w-0">
                              <span className={`mb-1 block text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Width</span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={productEstimatorForm.width}
                                onChange={(event) => setProductEstimatorForm((current) => ({ ...current, width: event.target.value }))}
                                className={`h-9 w-full rounded-lg border px-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 ${darkMode ? "border-slate-600 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                              />
                            </label>
                            <span className={`mt-6 text-sm ${darkMode ? "text-slate-500" : "text-slate-400"}`} aria-hidden="true">×</span>
                            <label className="min-w-0">
                              <span className={`mb-1 block text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Height</span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={productEstimatorForm.height}
                                onChange={(event) => setProductEstimatorForm((current) => ({ ...current, height: event.target.value }))}
                                className={`h-9 w-full rounded-lg border px-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 ${darkMode ? "border-slate-600 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                              />
                            </label>
                            <label className="col-span-3 min-w-0 sm:col-span-1">
                              <span className={`mb-1 block text-[9px] font-bold uppercase tracking-wider ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Unit</span>
                              <CustomerDropdown
                                ariaLabel="Unit"
                                darkMode={darkMode}
                                value={productEstimatorForm.unit}
                                onChange={(event) => setProductEstimatorForm((current) => ({ ...current, unit: event.target.value }))}
                                className="h-9 rounded-lg px-2"
                              >
                                <option value="in">in</option>
                                <option value="ft">ft</option>
                                <option value="cm">cm</option>
                                <option value="m">m</option>
                              </CustomerDropdown>
                            </label>
                          </div>}
                          {isPieceEstimator && productPieceOptions.length > 0 && (
                            <label className="mt-4 block">
                              <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Option</span>
                              <CustomerDropdown ariaLabel="Per piece option" darkMode={darkMode} value={productEstimatorForm.piece_option || ""} onChange={(event) => setProductEstimatorForm((current) => ({ ...current, piece_option: event.target.value }))} className="h-10 rounded-lg px-3">
                                <option value="">Choose an option</option>
                                {productPieceOptions.map((option) => <option key={option.name} value={option.name}>{option.name} · +{formatCurrency(option.price_per_piece)} / piece</option>)}
                              </CustomerDropdown>
                            </label>
                          )}
                          {productAreaOptions.length > 0 && (
                            <label className="mt-4 block">
                              <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Variant</span>
                              <CustomerDropdown ariaLabel="Variant option" darkMode={darkMode} value={productEstimatorForm.area_option || selectedAreaOption?.name || ""} onChange={(event) => setProductEstimatorForm((current) => ({ ...current, area_option: event.target.value }))} className="h-10 rounded-lg px-3">
                                <option value="">Choose an option</option>
                                {productAreaOptions.map((option) => <option key={option.name} value={option.name}>{option.name} · {formatCurrency(Number(option.price_per_sqft) || 0)}</option>)}
                              </CustomerDropdown>
                            </label>
                          )}
                          {isBladeEstimator && (
                            <div className={`mt-4 space-y-3 rounded-lg border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                              <label className="block">
                                <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Glass type</span>
                                <CustomerDropdown ariaLabel="Glass type" darkMode={darkMode} value={productEstimatorForm.blade_glass_type} onChange={(event) => setProductEstimatorForm((current) => ({ ...current, blade_glass_type: event.target.value }))} className="h-10 rounded-lg px-3">
                                  <option value="">Choose glass type</option>
                                  {productBladeGlassTypes.map((glass) => <option key={glass.name} value={glass.name}>{glass.name} · <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(glass.price_per_blade)}</span> / blade</option>)}
                                </CustomerDropdown>
                              </label>
                              <div>
                                <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Purchase option</span>
                                <div className="grid grid-cols-2 gap-2">
                                  {selectedProduct.sell_blades_only !== false && <button type="button" aria-pressed={productEstimatorForm.sale_mode === "blades_only"} onClick={() => setProductEstimatorForm((current) => ({ ...current, sale_mode: "blades_only", custom_frame_size: false, blade_count: Math.max(1, Number(selectedProduct.minimum_blades) || 1) }))} className={`min-h-10 rounded-lg border px-2 text-xs font-semibold ${productEstimatorForm.sale_mode === "blades_only" ? "border-red-600 bg-red-50 text-red-800" : darkMode ? "border-slate-600 text-slate-300" : "border-slate-200 text-slate-600"}`}>Blades only</button>}
                                  {selectedProduct.sell_with_frame && <button type="button" aria-pressed={productEstimatorForm.sale_mode === "frame"} onClick={() => setProductEstimatorForm((current) => ({ ...current, sale_mode: "frame", frame_type: current.frame_type || productBladeFrameTypes[0]?.name || "", blade_count: Number(productBladeFrameTypes.find((frame) => frame.name === (current.frame_type || productBladeFrameTypes[0]?.name))?.blade_count) || Number(selectedProduct.minimum_blades) || 1 }))} className={`min-h-10 rounded-lg border px-2 text-xs font-semibold ${productEstimatorForm.sale_mode === "frame" ? "border-red-600 bg-red-50 text-red-800" : darkMode ? "border-slate-600 text-slate-300" : "border-slate-200 text-slate-600"}`}>Blades with frame</button>}
                                </div>
                              </div>
                              {productEstimatorForm.sale_mode === "frame" && productBladeFrameTypes.length > 0 && (
                                <label className="block">
                                  <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Frame type</span>
                                  <CustomerDropdown ariaLabel="Frame type" darkMode={darkMode} value={productEstimatorForm.frame_type} onChange={(event) => {
                                    const frame = productBladeFrameTypes.find((item) => item.name === event.target.value);
                                    setProductEstimatorForm((current) => ({ ...current, frame_type: event.target.value, blade_count: Number(frame?.blade_count) || current.blade_count }));
                                  }} className="h-10 rounded-lg px-3">
                                    {productBladeFrameTypes.map((frame) => <option key={frame.name} value={frame.name}>{frame.name} · {frame.blade_count} blades · <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(frame.price)}</span></option>)}
                                  </CustomerDropdown>
                                </label>
                              )}
                              {productEstimatorForm.sale_mode === "frame" && selectedProduct.allow_custom_frame_size && (
                                <label className={`flex items-center gap-2 text-xs ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                                  <input type="checkbox" checked={Boolean(productEstimatorForm.custom_frame_size)} onChange={(event) => setProductEstimatorForm((current) => ({ ...current, custom_frame_size: event.target.checked, unit: selectedProduct.custom_frame_size_unit || current.unit }))} className="accent-red-700" />
                                  Enter custom frame size ({selectedProduct.custom_frame_size_unit || "in"})
                                </label>
                              )}
                              {productEstimatorForm.sale_mode === "blades_only" && selectedProduct.customer_can_choose_blade_count && (
                                <label className="block">
                                  <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Blade count</span>
                                  <input type="number" min={Math.max(1, Number(selectedProduct.minimum_blades) || 1)} max={Number(selectedProduct.maximum_blades) || undefined} step="1" value={productEstimatorForm.blade_count} onChange={(event) => setProductEstimatorForm((current) => ({ ...current, blade_count: event.target.value }))} className={`h-10 w-full rounded-lg border px-3 text-sm ${darkMode ? "border-slate-600 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"}`} />
                                  <span className={`mt-1 block text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Minimum {Math.max(1, Number(selectedProduct.minimum_blades) || 1)}{Number(selectedProduct.maximum_blades) > 0 ? ` · Maximum ${selectedProduct.maximum_blades}` : ""}</span>
                                </label>
                              )}
                              {selectedProduct.show_price_per_blade !== false && selectedBladeGlass && <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Glass rate: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(selectedBladeGlass.price_per_blade)}</span> per blade</p>}
                            </div>
                          )}
                          {(selectedProduct.extra_charges || []).some((charge) => charge.is_optional) && (
                            <div className={`mt-3 space-y-2 rounded-lg border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                              <p className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Optional charges</p>
                              {(selectedProduct.extra_charges || []).map((charge, index) => {
                                if (!charge.is_optional) return null;
                                const selectedCharge = productEstimatorForm.extra_charges?.[index];
                                const checked = typeof selectedCharge?.is_selected === "boolean"
                                  ? selectedCharge.is_selected
                                  : false;
                                const chargeRateLabel = charge.type === "percentage"
                                  ? `${Number(charge.amount) || 0}% of subtotal`
                                  : `${formatCurrency(charge.amount)}${charge.type === "per_blade" ? " / blade" : charge.type === "per_sqft" ? " / sq ft" : " / item"}`;
                                return (
                                  <label key={`${index}-${charge.name}`} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(event) => setProductEstimatorForm((current) => ({
                                        ...current,
                                        extra_charges: (current.extra_charges || getDefaultExtraChargeSelections(selectedProduct)).map((item, itemIndex) => (
                                          itemIndex === index ? { ...item, is_selected: event.target.checked } : item
                                        )),
                                      }))}
                                      className="mt-0.5 accent-red-700"
                                    />
                                    <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
                                      <span className="font-semibold">{charge.name}</span>
                                      <span className={darkMode ? "shrink-0 text-slate-400" : "shrink-0 text-slate-500"}>{chargeRateLabel}</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {hasProductEstimatorEstimate ? (
                            <div className={`mt-4 space-y-3 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`} aria-live="polite">
                              <div className="flex items-center justify-between gap-3">
                                <span className="inline-flex items-center gap-2"><Ruler size={13} aria-hidden="true" />{isBladeEstimator ? "Blades" : isMeterEstimator ? "Length" : isPieceEstimator ? "Quantity" : "Area"}</span>
                                <span className={`font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                  {isBladeEstimator
                                    ? `${estimatorBladeCount} blade(s)`
                                    : isMeterEstimator
                                    ? productEstimatorResult?.areaDisplay || "—"
                                    : isPieceEstimator
                                    ? productEstimatorResult?.areaDisplay || "1 piece"
                                    : Number(productEstimatorResult?.estimated_area) > 0
                                    ? `${Number(productEstimatorResult.estimated_area).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq ft`
                                    : productEstimatorResult?.areaDisplay || "—"}
                                </span>
                              </div>
                              {(!isBladeEstimator || selectedProduct.show_price_per_blade !== false) && <div className="flex items-center justify-between gap-3">
                                <span>Base Rate</span>
                                <span className={`font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                  {Number(productEstimatorResult?.rate) > 0
                                    ? `${formatCurrency(productEstimatorResult.rate)} / ${isBladeEstimator || productEstimatorResult?.areaDisplay?.includes("blade") ? "blade" : isMeterEstimator ? "meter" : isPieceEstimator ? "piece" : Number(productEstimatorResult?.estimated_area) > 0 ? "sq ft" : "unit"}`
                                    : "Contact us"}
                                </span>
                              </div>}
                              {isAreaEstimator && Number(selectedAreaOption?.price_per_sqft) > 0 && (
                                <div className="flex items-center justify-between gap-3">
                                  <span>Variant · {selectedAreaOption.name}</span>
                                  <span className={`font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{formatCurrency(selectedAreaOption.price_per_sqft)}</span>
                                </div>
                              )}
                              {isPieceEstimator && Number(selectedPieceOption?.price_per_piece) > 0 && (
                                <div className="flex items-center justify-between gap-3">
                                  <span>Option · {selectedPieceOption.name}</span>
                                  <span className={`font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{formatCurrency(Number(selectedPieceOption.price_per_piece) * Math.max(1, Number(productEstimatorForm.quantity) || 1))}</span>
                                </div>
                              )}
                              <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 ${darkMode ? "border-red-900 bg-slate-800 text-red-300" : "border-red-100 bg-white text-red-800"}`}>
                                <span className="font-bold">Estimated Total</span>
                                <span className="text-base font-black">
                                  {Number(productEstimatorResult?.estimated_price) > 0
                                    ? formatCurrency(productEstimatorResult.estimated_price)
                                    : "Contact us"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3 px-1">
                                <span>50% Downpayment</span>
                                <span className={`font-bold ${darkMode ? "text-red-300" : "text-red-800"}`}>
                                  {Number(productEstimatorResult?.estimated_price) > 0
                                    ? formatCurrency(productEstimatorResult.estimated_price * 0.5)
                                    : "Contact us"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className={`mt-3 flex min-h-12 items-center justify-center rounded-lg px-3 py-2.5 text-center text-xs ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-50 text-slate-500"}`}>
                              {isBladeEstimator ? "Choose a glass type and valid blade or frame option to estimate." : "Enter width &amp; height to calculate your estimate."}
                            </div>
                          )}
                          <p className={`mt-2 text-[11px] font-bold leading-4 ${darkMode ? "text-slate-500" : "text-slate-700"}`}>
                            Final pricing is subject to negotiation during shop discussion or on-site inspection.
                          </p>
                        </section>}

                        {cartActionError && (
                          <p role="alert" className={`rounded-lg border px-3 py-2 text-sm ${darkMode ? "border-red-800 bg-red-950/50 text-red-200" : "border-red-200 bg-red-50 text-red-700"}`}>
                            {cartActionError}
                          </p>
                        )}

                        {canAccessCustomerRatings && !canRequestOrders && (
                          <div className={`mt-2 flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold ${isBladePricingProduct(selectedProduct) ? "min-[560px]:col-span-full" : ""} ${darkMode ? "border-slate-700 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                            <Phone size={14} aria-hidden="true" />
                            <span>Call for inquiries: <strong className={darkMode ? "text-slate-100" : "text-slate-900"}>09123456789</strong></span>
                          </div>
                        )}
                        {!canAccessCustomerRatings && (
                          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${isBladePricingProduct(selectedProduct) ? "min-[560px]:col-span-full" : ""} ${darkMode ? "border-slate-700 bg-slate-800 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                            <Info size={14} aria-hidden="true" />
                            <span>Customer feedback and reviews will be available soon.</span>
                          </div>
                        )}
                      <div
                        className={`min-w-0 ${isBladePricingProduct(selectedProduct) ? "min-[560px]:col-span-full" : ""}`}
                      >
                        {!isProductModalReadOnly && canEstimatePricing && (
                          <ProductPriceEstimator
                            product={selectedProduct}
                            form={productEstimatorForm}
                            onFormChange={updateProductDetailsEstimatorForm}
                            darkMode={darkMode}
                            formatCurrency={formatCurrency}
                            bladeModalLayout={isBladePricingProduct(selectedProduct)}
                            defaultMeasurements={(() => {
                              const dimensions = getProductDefaultDimensions(selectedProduct, 1);
                              const usesLength = ["meter", "per_meter"].includes(String(selectedProduct?.pricing_method || selectedProduct?.unit || "").toLowerCase());
                              return dimensions.width > 0 && (usesLength || dimensions.height > 0) ? dimensions : null;
                            })()}
                            footer={canRequestOrders && (
                              <div className={`grid gap-2.5 ${isBladePricingProduct(selectedProduct) ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
                                <button
                          type="button"
                          onClick={() => {
                            if (productEstimatorInputsInvalid) return;
                            if (productEstimatorBladeCountError) {
                              toast.error(productEstimatorBladeCountError);
                              return;
                            }
                            if (hasProductEstimatorEstimate) {
                              openEstimatedProductOrder(selectedProduct);
                            } else {
                              openOrderNowModal(selectedProduct);
                            }
                            closeProductModal();
                          }}
                          disabled={onlineOrderCooldownActive || productEstimatorInputsInvalid}
                          className={`flex w-full items-center justify-center gap-2 text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${isBladePricingProduct(selectedProduct) ? "h-[46px] rounded-[10px] bg-red-600 text-white hover:bg-red-700" : "rounded-xl bg-red-600 py-3 text-white hover:bg-red-700"}`}
                        >
                          <Package size={20} />
                          Place Order
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            if (productEstimatorInputsInvalid) return;
                            if (productEstimatorBladeCountError) {
                              toast.error(productEstimatorBladeCountError);
                              return;
                            }
                            let addedToCart = false;
                            if (hasProductEstimatorEstimate) {
                              if (!canEstimatePricing) {
                                showPermissionNotice("Pricing estimates are disabled for your account.");
                                return;
                              }
                              addedToCart = await handleAddEstimateToCart({
                                product: selectedProduct,
                                width: productEstimatorForm.width,
                                height: productEstimatorForm.height,
                                quantity: 1,
                                notes: "",
                                blade_glass_type: productEstimatorForm.blade_glass_type,
                                piece_option: productEstimatorForm.piece_option,
                                area_option: productEstimatorForm.area_option,
                                sale_mode: productEstimatorForm.sale_mode,
                                frame_type: productEstimatorForm.frame_type,
                                custom_frame_size: productEstimatorForm.custom_frame_size,
                                blade_count: productEstimatorForm.blade_count,
                                extra_charges: productEstimatorForm.extra_charges,
                                measurementUnit: productEstimatorForm.unit,
                              });
                            } else {
                              if (!canRequestOrders) {
                                showPermissionNotice("Order requests are disabled for your account.");
                                return;
                              }
                              const hasCustomDimensions = Number(productEstimatorForm.width) > 0 || Number(productEstimatorForm.height) > 0;
                              addedToCart = await handleAddToCart(
                                selectedProduct,
                                productEstimatorForm.extra_charges || getDefaultExtraChargeSelections(selectedProduct),
                                {
                                  ...productEstimatorForm,
                                  useProductDefaults: !hasCustomDimensions,
                                  customized: hasCustomDimensions,
                                }
                              );
                            }
                            if (addedToCart) closeProductModal();
                          }}
                          disabled={onlineOrderCooldownActive || productEstimatorInputsInvalid}
                          className={`flex w-full items-center justify-center gap-2 text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${isBladePricingProduct(selectedProduct) ? `h-[46px] rounded-[10px] border ${darkMode ? "border-[#3d4862] bg-[#2a3246] text-[#e8ebf2] hover:bg-[#343e55]" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"}` : "rounded-xl bg-[#101114] py-3 text-white hover:bg-[#050608]"}`}
                        >
                          <ShoppingCart size={20} />
                          Add to Cart
                        </button>
                              </div>
                            )}
                          />
                        )}
                      </div>
                      </div>
                      {canAccessCustomerRatings && (
                        <section className={`md:col-span-full mt-2 overflow-hidden rounded-[14px] border ${darkMode ? "border-[#3d4862] bg-[#2a3246]" : "border-slate-200 bg-white"}`} aria-labelledby="product-ratings-heading">
                          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:px-6">
                            <h3 id="product-ratings-heading" className={`text-base font-extrabold ${darkMode ? "text-[#e8ebf2]" : "text-slate-900"}`}>Product Ratings</h3>
                          </div>
                          <div className={`grid gap-4 border-b p-4 sm:p-5 md:grid-cols-[190px_minmax(0,1fr)] ${darkMode ? "border-slate-700 bg-slate-800/60" : "border-slate-100 bg-rose-50/40"}`}>
                            <div className="flex flex-col items-center justify-center border-b pb-4 text-center md:border-b-0 md:border-r md:pb-0 md:pr-5">
                              {productReviewsLoading ? (
                                <p className={`text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`} role="status">Loading reviews...</p>
                              ) : totalRatedReviews > 0 ? (
                                <>
                                  <p className={`text-3xl font-bold ${darkMode ? "text-rose-300" : "text-red-600"}`}><span>{productReviewAverageRating}</span><span className="text-base font-medium"> / 5</span></p>
                                  <div className="mt-1 flex items-center gap-0.5 text-amber-500" aria-label={`${productReviewAverageRating} out of 5 stars`}>{renderRatingStars(averageProductReviewRating, 20, darkMode)}</div>
                                  <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{totalRatedReviews} rating{totalRatedReviews === 1 ? "" : "s"}</p>
                                </>
                              ) : (
                                <>
                                  <p className={`text-2xl font-bold ${darkMode ? "text-slate-300" : "text-slate-500"}`}>- <span className="text-sm font-medium">/ 5</span></p>
                                  <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>No ratings yet</p>
                                </>
                              )}
                            </div>
                            <div className="flex flex-wrap content-center gap-2" role="group" aria-label="Filter reviews by rating">
                              <button type="button" onClick={() => setSelectedReviewRatingTab(0)} aria-pressed={selectedReviewRatingTab === 0} className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${selectedReviewRatingTab === 0 ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-600 bg-slate-900 text-slate-200 hover:border-red-400" : "border-slate-200 bg-white text-slate-700 hover:border-red-300"}`}>All ({productReviews.length})</button>
                              {reviewRatingCounts.map(({ star, count }) => (
                                <button key={star} type="button" onClick={() => setSelectedReviewRatingTab(star)} aria-pressed={selectedReviewRatingTab === star} className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${selectedReviewRatingTab === star ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-600 bg-slate-900 text-slate-200 hover:border-red-400" : "border-slate-200 bg-white text-slate-700 hover:border-red-300"}`}>
                                  {star} Star ({count})
                                </button>
                              ))}
                            </div>
                          </div>
                          {productReviewsLoading ? (
                            <p className={`px-5 py-6 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`} role="status">Loading reviews...</p>
                          ) : filteredProductReviews.length === 0 ? (
                            <p className={`px-5 py-6 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              {productReviews.length === 0 ? "No reviews yet" : `No ${selectedReviewRatingTab}-star reviews`}
                            </p>
                          ) : (
                            <div className={`max-h-[55dvh] touch-pan-y overflow-y-auto overscroll-contain pb-[calc(5rem+env(safe-area-inset-bottom))] md:max-h-none md:overflow-visible md:pb-0 ${darkMode ? "divide-y divide-slate-700" : "divide-y divide-slate-100"}`} style={{ WebkitOverflowScrolling: "touch" }}>
                              {filteredProductReviews.map((review, index) => (
                                <article key={`${review.orderId || index}-${review.submittedAt || index}`} className="p-4 sm:p-5">
                                  <div className="flex items-start gap-3">
                                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${darkMode ? "bg-slate-700 text-slate-200" : "bg-slate-100 text-slate-600"}`} aria-hidden="true">{String(review.customerName || "A").trim().charAt(0).toUpperCase()}</div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className={`truncate text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{review.customerName || "Anonymous"}</p>
                                          <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{formatDateToMMMDDYYYY(review.submittedAt) || "Date unavailable"}</p>
                                        </div>
                                        <div className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                                          <span className="inline-flex items-center">{renderRatingStars(review.rating, 14, darkMode)}</span>
                                          <span>{Number(review.rating) > 0 ? `${Number(review.rating).toFixed(1)} / 5` : "No rating"}</span>
                                        </div>
                                      </div>
                                      {review.title && <h4 className={`mt-3 text-sm font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>{review.title}</h4>}
                                      <p className={`mt-2 whitespace-pre-line break-words text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{review.comment || "No review comment."}</p>
                                      {review.photos?.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {review.photos.map((photo, photoIndex) => <button key={`${photo}-${photoIndex}`} type="button" onClick={() => setReviewPhotoPreview({ url: ensureAbsoluteUrl(photo), index: photoIndex })} aria-label={`Open review photo ${photoIndex + 1}`} className="h-20 w-20 overflow-hidden rounded-lg border border-slate-200"><img src={ensureAbsoluteUrl(photo)} alt={`Review photo ${photoIndex + 1}`} className="h-full w-full object-cover" loading="lazy" /></button>)}
                                        </div>
                                      )}
                                      {review.adminResponse && (
                                        <div className={`mt-4 rounded-lg border p-3 ${darkMode ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                                          <p className={`text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>ACGC SERVICES</p>
                                          <p className={`mt-1 whitespace-pre-line break-words text-sm leading-5 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{review.adminResponse}</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                        </section>
                      )}

                    </div>
                  </div>
                </div>
              </div>
            )}

            {showCartDecisionModal && canRequestOrders && cartDecisionProduct && (
              <div className="customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4">
                <div className={`mobile-fullscreen-dialog order-flow-modal w-full max-h-[95vh] max-w-4xl rounded-3xl bg-white shadow-2xl overflow-hidden flex flex-col ${darkMode ? "order-flow-modal-dark" : ""}`}>
                  {/* Sticky Header with Gradient */}
                  <div className="flex-shrink-0 bg-gradient-to-r from-red-600 to-red-700 px-6 py-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-white">
                        <h3 className="text-2xl font-bold flex items-center gap-2">
                          <ShoppingCart size={28} />
                          {cartDecisionStep === "choice" ? "Choose Your Option" : "Get an Estimate"}
                        </h3>
                        <p className="text-red-100 mt-1">{cartDecisionStep === "choice" ? "Decide how to add this product to your cart" : "Enter measurements for a personalized estimate"}</p>
                      </div>
                      <button onClick={requestCloseCartDecisionModal} className="text-white hover:bg-red-800 p-2 rounded-full transition">
                        <X size={24} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto">
                    {cartDecisionStep === "choice" ? (
                      // CHOICE STEP
                      <div className="px-6 py-8 space-y-6">
                        {/* Product Preview Card */}
                        <div className="rounded-2xl border-2 border-white-200 bg-gray-100 p-6">
                          <div className="flex items-center gap-4">
                            <img src={getProductImage(cartDecisionProduct, 320) || PRODUCT_IMAGE_PLACEHOLDER} alt={cartDecisionProduct.name} width="112" height="112" loading="lazy" decoding="async" onError={handleProductImageError} className="w-28 h-28 rounded-2xl object-cover bg-white shadow-md flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm text-slate-600 font-medium">Selected Product</p>
                              <h4 className="text-2xl font-bold text-slate-900 mt-1">{cartDecisionProduct.name}</h4>
                              <p className="text-lg text-red-600 font-bold mt-2">{getProductPrice(cartDecisionProduct)}</p>
                            </div>
                          </div>
                        </div>

                        {/* Option Cards */}
                        <div className={`grid gap-4 ${canEstimatePricing ? "sm:grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
                          {/* Estimate Option */}
                          {canEstimatePricing && <button
                            onClick={handleCartDecisionEstimate}
                            className="group relative rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-xl"
                          >
                            <div className="absolute inset-0 bg-gray-600 transition" />
                            <div className="relative px-6 py-8 text-left text-white">
                              <div className="flex items-start justify-between mb-3">
                                <Ruler size={32} className="text-white" />
                                <ArrowRight size={24} className="text-white" />
                              </div>
                              <p className="text-xl font-bold mb-2">Estimate First</p>
                              <p className="text-sm text-red-50 leading-relaxed">Enter your measurements to get an accurate price before adding to cart</p>
                            </div>
                          </button>}

                          {/* Add to Cart Option */}
                          <button
                            onClick={handleCartDecisionNoAdd}
                            className="group relative rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-xl"
                          >
                            <div className="absolute inset-0 bg-[#101114] transition" />
                            <div className="relative px-6 py-8 text-left text-white">
                              <div className="flex items-start justify-between mb-3">
                                <CheckCircle size={32} className="text-white" />
                                <ArrowRight size={24} className="text-white" />
                              </div>
                              <p className="text-xl font-bold mb-2">Add to Cart Now</p>
                              <p className="text-sm text-slate-200 leading-relaxed">Skip the estimate and add this product at the standard price</p>
                            </div>
                          </button>
                        </div>

                        {/* Cancel */}
                        <button
                          onClick={requestCloseCartDecisionModal}
                          className="w-full rounded-2xl border-2 border-gray-200 bg-white text-gray-700 font-semibold py-3 hover:bg-gray-50 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      // ESTIMATE STEP
                      <div className="px-6 py-8 space-y-6">
                        {/* Product Compact Card */}
                        <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-4 border border-gray-200">
                          <img src={getProductImage(cartDecisionProduct, 160) || PRODUCT_IMAGE_PLACEHOLDER} alt={cartDecisionProduct.name} width="64" height="64" loading="lazy" decoding="async" onError={handleProductImageError} className="w-16 h-16 rounded-lg object-cover bg-white" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-600">Estimating for</p>
                            <p className="font-semibold text-gray-900 truncate">{cartDecisionProduct.name}</p>
                          </div>
                          <button
                            onClick={() => setCartDecisionStep("choice")}
                            className="text-red-600 hover:text-red-700 text-sm font-medium whitespace-nowrap ml-2"
                          >
                            Change
                          </button>
                        </div>

                        {/* Input Form - Card Based */}
                        <div className="grid gap-6 lg:grid-cols-2">
                          {/* Left: Input Fields */}
                          <div className="space-y-5">
                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Ruler size={39} className="text-red-600" />
                                  <span className="text-sm font-semibold text-gray-700">Measurement Unit</span>
                                </div>
                                <CustomerDropdown
                                  ariaLabel="Measurement Unit"
                                  darkMode={darkMode}
                                  name="unit"
                                  value={estimateForm.unit}
                                  onChange={handleEstimateFormChange}
                                  className="h-14 rounded-xl px-4 text-lg"
                                >
                                  <option value="in">Inches (in)</option>
                                  <option value="ft">Feet (ft)</option>
                                  <option value="cm">Centimeters (cm)</option>
                                  <option value="m">Meters (m)</option>
                                </CustomerDropdown>
                              </label>
                            </div>

                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Ruler size={39} className="text-red-600" />
                                  <span className="text-sm font-semibold text-gray-700">Width ({estimateForm.unit})</span>
                                </div>
                                <input
                                  type="number"
                                  name="width"
                                  min="0"
                                  value={estimateForm.width}
                                  onChange={handleEstimateFormChange}
                                  placeholder="0"
                                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition text-lg"
                                />
                                {estimateFormErrors.width && <p className="mt-2 text-sm text-red-600">{estimateFormErrors.width}</p>}
                              </label>
                            </div>

                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Ruler size={39} className="text-red-600 rotate-90" />
                                  <span className="text-sm font-semibold text-gray-700">Height ({estimateForm.unit})</span>
                                </div>
                                <input
                                  type="number"
                                  name="height"
                                  min="0"
                                  value={estimateForm.height}
                                  onChange={handleEstimateFormChange}
                                  placeholder="0"
                                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition text-lg"
                                />
                                {estimateFormErrors.height && <p className="mt-2 text-sm text-red-600">{estimateFormErrors.height}</p>}
                              </label>
                            </div>

                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Package size={39} className="text-red-600" />
                                  <span className="text-sm font-semibold text-gray-700">Quantity</span>
                                </div>
                                <input
                                  type="number"
                                  name="quantity"
                                  value={estimateForm.quantity}
                                  min="1"
                                  max={MAX_PRODUCT_ESTIMATOR_QUANTITY}
                                  step="1"
                                  aria-invalid={Boolean(estimateQuantityError)}
                                  aria-describedby={estimateQuantityError ? "customer-estimate-quantity-error" : undefined}
                                  onChange={handleEstimateFormChange}
                                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition text-lg"
                                />
                                {estimateQuantityError && <p id="customer-estimate-quantity-error" role="alert" className="mt-2 text-sm font-semibold text-red-600">{estimateQuantityError}</p>}
                              </label>
                            </div>

                            <div>
                              <label className="block">
                                <div className="flex items-center gap-2 mb-2">
                                  <Info size={39} className="text-yellow-600" />
                                  <span className="text-sm font-semibold text-gray-700 ">Notes (optional)</span>
                                </div>
                                <textarea
                                  name="notes"
                                  value={estimateForm.notes}
                                  onChange={handleEstimateFormChange}
                                  placeholder="Add any special instructions or details..."
                                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 min-h-[100px] focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition resize-none"
                                />
                              </label>
                            </div>
                          </div>

                          {/* Right: Calculation Display */}
                          <div className="space-y-4">
                            {/* Measurements Summary */}
                            <div className="rounded-2xl bg-white-100 border-2 border-gray-200 p-5">
                              <div className="flex items-center gap-2 mb-3">
                                <Ruler size={20} className="text-black-600" />
                                <h4 className="font-bold text-black-900">Measurements</h4>
                              </div>
                              <div className="space-y-3 text-sm">
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Selected Unit</span>
                                  <span className="font-bold text-black-900">{estimateForm.unit === 'in' ? 'Inches' : estimateForm.unit === 'ft' ? 'Feet' : estimateForm.unit === 'cm' ? 'Centimeters' : 'Meters'}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Width</span>
                                  <span className="font-bold text-black-900">{estimateForm.width ? `${estimateForm.width} ${estimateForm.unit}` : '—'}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Height</span>
                                  <span className="font-bold text-black-900">{estimateForm.height ? `${estimateForm.height} ${estimateForm.unit}` : '—'}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Area per unit</span>
                                  <span className="font-bold text-black-900">{estimateAreaSelectedUnit ? `${estimateAreaSelectedUnit.toFixed(2)} ${selectedAreaUnitLabel}` : '—'}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-white rounded-lg">
                                  <span className="text-black-600">Total Quantity</span>
                                  <span className="font-bold text-black-900">{estimateQuantity}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-gradient-to-r from-yellow-400 to-yellow-500 text-yellow-900 font-bold rounded-lg">
                                  <span className="text-black font-semibold">Total Area</span>
                                  <span className="font-bold text-black-900 text-lg">{estimateTotalAreaSelectedUnit ? `${estimateTotalAreaSelectedUnit.toFixed(2)} ${selectedAreaUnitLabel}` : '—'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Price Summary */}
                            <div className="rounded-2xl bg-white border-2 border-green-200 p-5">
                              <div className="flex items-center gap-3 mb-3">
                                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white-100 text-2xl font-bold text-green-600">₱</span>
                                <h4 className="font-bold text-black-900">Price Summary</h4>
                              </div>
                              <div className="space-y-3 text-sm">
                                <div className="p-3 bg-white rounded-lg">
                                  <p className="text-xs text-black-500 mb-1">Rate per Sq Ft</p>
                                  <p className="font-bold text-gray-900">{estimateUnitRate ? `₱${estimateUnitRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Contact us"}</p>
                                </div>
                                <div className="p-3 bg-white rounded-lg">
                                  <p className="text-xs text-black-500 mb-1">Calculation</p>
                                  <p className="text-sm font-semibold text-gray-900">
                                    {estimateWidth && estimateHeight
                                      ? `₱${estimateUnitRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${estimateTotalArea.toFixed(2)} sq ft`
                                      : "Fill measurements"}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Final Cost - Highlighted */}
                            <div className="rounded-2xl bg-gradient-to-br from-red-600 to-red-700 p-5 text-white">
                              <p className="text-sm text-red-100 mb-2">Total Estimated Cost</p>
                              <p className="text-4xl font-bold">
                                {estimateWidth && estimateHeight
                                  ? `₱${estimateTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : "—"}
                              </p>
                              <p className="text-xs text-red-100 mt-2">*Final price may vary based on final specifications</p>
                            </div>
                          </div>
                        </div>

                        {cartActionError && (
                          <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-3">
                            <Info size={18} className="flex-shrink-0 mt-0.5" />
                            <div>{cartActionError}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Sticky Footer */}
                  <div className="flex-shrink-0 px-6 py-4">
                    {cartDecisionStep === "choice" ? null : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                        <button
                          onClick={requestCloseCartDecisionModal}
                          className="rounded-xl border-2 border-gray-300 bg-white text-gray-700 font-semibold py-3 px-6 hover:bg-gray-50 transition"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleEstimateAfterEstimation}
                          disabled={
                            orderRequestLoading ||
                            !canRequestOrders ||
                            !estimateForm.width ||
                            !estimateForm.height ||
                            Number(estimateForm.width) <= 0 ||
                            Number(estimateForm.height) <= 0
                          }
                          className={`rounded-xl text-white font-semibold py-3 px-6 transition shadow-lg flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                            estimateFlowType === "add_to_cart_estimate"
                              ? "bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
                              : "bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                          }`}
                        >
                          <CheckCircle size={20} />
                          {estimateFlowType === "add_to_cart_estimate"
                            ? orderRequestLoading
                              ? "Adding..."
                              : canRequestOrders ? "Add to Cart" : "Orders Disabled"
                            : orderRequestLoading
                              ? "Requesting..."
                              : canRequestOrders ? "Request Order" : "Orders Disabled"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {showDeliveryConfirmModal && canRequestOrders && (
              <div className="place-order-request-overlay customer-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
                <div className={`place-order-request-dialog order-flow-modal flex max-h-[calc(100dvh-2rem)] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl border shadow-[0_24px_70px_rgba(15,23,42,0.24)] ${darkMode ? "order-flow-modal-dark border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <div className={`flex-shrink-0 border-b px-5 py-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={handleCancelDeliveryConfirm}
                        className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-xs font-semibold transition ${darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"}`}
                      >
                        <ArrowLeft size={15} />
                        Back to Product
                      </button>
                      <button
                        type="button"
                        onClick={closeDeliveryConfirm}
                        className={`rounded-full border p-1.5 transition ${darkMode ? "border-slate-600 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-500 hover:bg-slate-100"}`}
                        aria-label="Close place order request"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="mt-0.5">
                      <h3 className={`text-xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Place Order Request</h3>
                      <p className={`mt-0.5 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Review your details and submit your request.</p>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {resumeProductRefreshing && (
                      <p role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">
                        Verifying current product pricing...
                      </p>
                    )}
                    {resumeProductRefreshError && (
                      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800">
                        <span>{resumeProductRefreshError}</span>
                        <button
                          type="button"
                          onClick={() => resumeProductRefreshRef.current?.()}
                          className="font-semibold underline underline-offset-2"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    <div className={`grid min-h-0 grid-cols-1 gap-4 p-4 min-[760px]:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)] min-[760px]:p-5 ${darkMode ? "bg-slate-950" : "bg-slate-50"}`}>
                      <div className={`min-w-0 space-y-4 rounded-2xl border p-4 shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h4 className={`text-base font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Customer Information</h4>
                            <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Review your details before submitting your request.</p>
                          </div>
                          {!isDeliveryConfirmValid && (
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">Incomplete required fields</span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 gap-3 min-[760px]:grid-cols-2">
                          <div>
                            <label className={`text-[11px] font-bold uppercase tracking-[0.04em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Full Name</label>
                            <p className={`mt-1 flex h-10 min-w-0 items-center truncate rounded-[9px] border px-3 text-sm ${darkMode ? "border-slate-700 bg-slate-800 text-slate-200" : "border-slate-200 bg-slate-50 text-slate-800"}`}>{`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "N/A"}</p>
                          </div>
                          <div>
                            <label className={`text-[11px] font-bold uppercase tracking-[0.04em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Email Address</label>
                            <p className={`mt-1 flex h-10 min-w-0 items-center truncate rounded-[9px] border px-3 text-sm ${darkMode ? "border-slate-700 bg-slate-800 text-slate-200" : "border-slate-200 bg-slate-50 text-slate-800"}`} title={profileForm.email || user?.email || "N/A"}>{profileForm.email || user?.email || "N/A"}</p>
                          </div>
                        </div>

                        <div className={`border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                          <h4 className={`text-xs font-bold uppercase tracking-[0.06em] ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Contact &amp; Installation Details</h4>
                          <div className="mt-3 grid gap-3">
                            <div>
                              <label className={`text-[11px] font-bold uppercase tracking-[0.04em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Contact Number <span className="text-red-600">*</span></label>
                              <input
                                name="phone"
                                type="tel"
                                inputMode="tel"
                                maxLength={13}
                                value={deliveryConfirmForm.phone}
                                onChange={handleDeliveryConfirmChange}
                                placeholder="+639171234567 or 09171234567"
                                className={`mt-1.5 h-[42px] w-full rounded-[9px] border px-3 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-gray-300 bg-white text-gray-900"}`}
                              />
                            </div>
                            <div>
                              <FullAddressField
                                minimumLength={0}
                                label="Full Address *"
                                name="shipping_address"
                                value={deliveryConfirmForm.shipping_address || buildDeliveryAddress(deliveryConfirmForm)}
                                onChange={handleDeliveryConfirmChange}
                                validationValue={deliveryConfirmForm.shipping_address || buildDeliveryAddress(deliveryConfirmForm)}
                                labelClassName={`text-[11px] font-bold uppercase tracking-[0.04em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}
                                helperClassName={darkMode ? "text-slate-400" : "text-gray-500"}
                                className={`mt-1.5 h-[42px] w-full rounded-[9px] border px-3 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-gray-300 bg-white text-gray-900"}`}
                              />
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className={`text-[11px] font-bold uppercase tracking-[0.04em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Special Instructions / Engineering Notes <span className={`font-medium normal-case tracking-normal ${darkMode ? "text-slate-500" : "text-slate-400"}`}>(Optional)</span></label>
                          <textarea
                            value={deliveryConfirmNotes}
                            onChange={(event) => setDeliveryConfirmNotes(event.target.value)}
                            placeholder="Add notes about structure elevations, framing colors, glass thickness preferences, etc."
                            className={`mt-1.5 min-h-[96px] w-full resize-y rounded-[9px] border px-3 py-2.5 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 ${darkMode ? "border-slate-700 bg-slate-900 text-white placeholder:text-slate-500" : "border-gray-300 bg-white text-gray-900"}`}
                          />
                        </div>

                        {deliveryConfirmError && (
                          <div className={`rounded-2xl border p-4 text-sm ${darkMode ? "border-red-800 bg-red-950/40 text-red-200" : "border-red-300 bg-red-50 text-red-700"}`}>
                            {deliveryConfirmError}
                          </div>
                        )}
                      </div>

                        <div className={`place-order-summary min-w-0 rounded-2xl border p-4 shadow-sm ${darkMode ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
                        <div className="flex items-start gap-4">
                          <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
                            <img
                              src={getProductImage(confirmProduct, 160) || PRODUCT_IMAGE_PLACEHOLDER}
                              alt={confirmProduct?.name || "Product preview"}
                              width="76"
                              height="76"
                              loading="lazy"
                              decoding="async"
                              onError={handleProductImageError}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="flex-1">
                            <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Order Summary</p>
                            <h4 className={`mt-1 text-base font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmProduct?.name || "Product details"}</h4>
                            <p className={`mt-0.5 text-xs ${darkMode ? "text-slate-400" : "text-gray-600"}`}>{confirmProduct?.product_type || confirmProduct?.category || "Product"}</p>
                          </div>
                        </div>

                        <div className={`mt-4 space-y-4 border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                          <div>
                            <p className={`mb-3 text-xs font-bold uppercase tracking-[0.06em] ${darkMode ? "text-slate-200" : "text-gray-700"}`}>Product Details</p>
                            <div className={`grid gap-x-4 gap-y-3 text-sm min-[760px]:grid-cols-2 ${darkMode ? "text-slate-300" : "text-gray-700"}`}>
                              {isConfirmBladeProduct ? (
                                <>
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Quantity</p>
                                    <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmQuantity}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Glass</p>
                                    <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmGlassType?.name || confirmBladeSelections.blade_glass_type || "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Frame</p>
                                    <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>
                                      {confirmBladeSelections.sale_mode === "frame"
                                        ? confirmBladeSelections.custom_frame_size ? "Custom frame" : confirmFrameType?.name || "Frame"
                                        : "No frame"}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Blades</p>
                                    <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmBladeCount}</p>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Quantity</p>
                                    <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmQuantity}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Unit Price</p>
                                    <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmUnitPrice)}</span></p>
                                  </div>
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Width</p>
                                    <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmWidth}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Height</p>
                                    <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmHeight}</p>
                                  </div>
                                  <div className="sm:col-span-2">
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Color / Variant</p>
                                    <p className={`mt-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>{confirmProduct?.variant || confirmProduct?.color || "Standard"}</p>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          <div className={`border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                            <p className={`mb-3 text-xs font-bold uppercase tracking-[0.06em] ${darkMode ? "text-slate-200" : "text-gray-700"}`}>Pricing Breakdown</p>
                            <div className={`space-y-3 text-sm ${darkMode ? "text-slate-300" : "text-gray-700"}`}>
                              {isConfirmBladeProduct ? (
                                <>
                                  <div className="flex items-center justify-between gap-3">
                                    <span>Rate</span>
                                    <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmBladeRate)}</span> / blade</span>
                                  </div>
                                  {confirmBladeSelections.sale_mode === "frame" && (
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Frame ({confirmBladeSelections.custom_frame_size ? "Custom" : confirmFrameType?.name || "Frame"})</span>
                                      <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmFramePrice * confirmQuantity)}</span></span>
                                    </div>
                                  )}
                                  {confirmExtraChargeRows.map((charge, index) => (
                                    <div key={`${index}-${charge.name}`} className="flex items-center justify-between gap-3">
                                      <span>{charge.name}</span>
                                      <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(charge.amount)}</span></span>
                                    </div>
                                  ))}
                                  {confirmAdditionalCharges > 0 && (
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Customization</span>
                                      <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmAdditionalCharges)}</span></span>
                                    </div>
                                  )}
                                  {confirmInstallationFee > 0 && (
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Installation</span>
                                      <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmInstallationFee)}</span></span>
                                    </div>
                                  )}
                                </>
                              ) : (
                                (isConfirmAreaProduct || isConfirmPieceProduct) && confirmAreaPriceBreakdown ? (
                                  <>
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Product base price</span>
                                      <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmBaseProductAmount)}</span></span>
                                    </div>
                                    {confirmAreaOption && (
                                      <div className="flex items-center justify-between gap-3">
                                        <span>Variant · {confirmAreaOption.name}</span>
                                        <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmAreaOptionAmount)}</span></span>
                                      </div>
                                    )}
                                    {confirmPieceOption && (
                                      <div className="flex items-center justify-between gap-3">
                                        <span>Option · {confirmPieceOption.name}</span>
                                        <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmPieceOptionAmount)}</span></span>
                                      </div>
                                    )}
                                    {confirmAreaAdditionalChargeRows.map((charge, index) => (
                                      <div key={`${index}-${charge.name}`} className="flex items-center justify-between gap-3">
                                        <span>{charge.name}</span>
                                        <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(charge.total)}</span></span>
                                      </div>
                                    ))}
                                    <div className="flex items-center justify-between gap-3 border-t border-dashed pt-3">
                                      <span>Subtotal</span>
                                      <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmSubtotal)}</span></span>
                                    </div>
                                    {confirmAdditionalCharges > 0 && (
                                      <div className="flex items-center justify-between gap-3">
                                        <span>Customization</span>
                                        <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmAdditionalCharges)}</span></span>
                                      </div>
                                    )}
                                    {confirmInstallationFee > 0 && (
                                      <div className="flex items-center justify-between gap-3">
                                        <span>Installation</span>
                                        <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmInstallationFee)}</span></span>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="flex items-center justify-between">
                                    <span>Subtotal</span>
                                    <span className={`font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmSubtotal)}</span></span>
                                  </div>
                                )
                              )}
                              
                              <div className={`mt-3 flex items-center justify-between border-t border-dashed pt-3 text-lg font-bold ${darkMode ? "border-slate-700 text-white" : "border-gray-300 text-gray-900"}`}>
                                <span>Total</span>
                                <span className="text-red-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(confirmGrandTotal)}</span></span>
                              </div>
                            </div>
                          </div>

                          <div className={`mt-4 rounded-xl border p-3 text-sm leading-relaxed ${darkMode ? "border-blue-800 bg-blue-950/50 text-blue-100" : "border-blue-200 bg-blue-50 text-slate-800"}`}>
                            Final pricing will be confirmed during shop discussion or site inspection.
                            {customerPaymentContactPhone && (
                              <span className="ml-1 inline-flex flex-wrap items-center gap-1">
                                Contact: <a href={`tel:${customerPaymentContactPhone.replace(/[^\d+]/g, "")}`} className={`inline-flex items-center gap-1 font-bold underline underline-offset-2 ${darkMode ? "text-blue-200" : "text-blue-800"}`}><Phone size={13} aria-hidden="true" />{customerPaymentContactPhone}</a>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`sticky bottom-0 z-10 flex shrink-0 gap-3 border-t px-4 py-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
                    <button
                      type="button"
                      onClick={performCancelDeliveryConfirm}
                      className={`h-[42px] min-w-0 flex-1 rounded-[9px] border px-5 text-sm font-semibold transition min-[760px]:ml-auto min-[760px]:flex-none ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmAndContinue}
                      disabled={!isDeliveryConfirmValid || orderRequestLoading || resumeProductRefreshing || Boolean(resumeProductRefreshError)}
                      className="h-[42px] min-w-0 flex-1 rounded-[9px] bg-red-700 px-5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60 min-[760px]:flex-none"
                    >
                      Submit Order Request
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showOrderNowModal && canRequestOrders && orderNowProduct && (
              <div className="customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className={`mobile-fullscreen-dialog order-flow-modal flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ${darkMode ? "order-flow-modal-dark" : ""}`}>
                  <div className="border-b px-6 py-5 bg-red-600 text-white">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-xl font-bold">Place Order</h3>
                      <p className="text-sm text-red-100">Review product details, set quantity, and continue to the order summary.</p>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain grid gap-6 p-6 lg:grid-cols-[1.4fr_0.8fr]">
                    <div className="space-y-6 rounded-[32px] border border-gray-200 bg-gray-50 p-6 shadow-sm">
                      <div className="flex flex-col gap-4 rounded-3xl bg-white p-4 shadow-sm border border-gray-200">
                        <div className="flex items-center gap-4">
                          <div className="h-24 w-24 overflow-hidden rounded-3xl border border-gray-200 bg-gray-100">
                            <img
                              src={getProductImage(orderNowProduct, 160) || PRODUCT_IMAGE_PLACEHOLDER}
                              alt={orderNowProduct.name}
                              width="96"
                              height="96"
                              loading="lazy"
                              decoding="async"
                              onError={handleProductImageError}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Selected Product</p>
                            <p className="mt-2 text-2xl font-bold text-gray-900 truncate">{orderNowProduct.name}</p>
                            <p className="mt-1 text-sm text-gray-600">{orderNowProduct.product_type || orderNowProduct.category || "Product"}</p>
                          </div>
                        </div>
                        <p className="text-lg font-semibold text-red-600">{getProductPrice(orderNowProduct)}</p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-3xl bg-white p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Unit Rate</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900">{orderNowProduct ? getProductUnitRate(orderNowProduct) : "Contact us"}</p>
                        </div>
                        <div className="rounded-3xl bg-white p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Unit</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900">{orderNowProduct.unit || "piece"}</p>
                        </div>
                        <div className="rounded-3xl bg-white p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Variant</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900">{orderNowProduct.variant || "Standard"}</p>
                        </div>
                          <div className="rounded-3xl bg-white p-4 border border-gray-200">
                            <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Dimensions</p>
                            <p className="mt-2 text-lg font-semibold text-gray-900">
                              {orderNowProduct.width && orderNowProduct.height
                                ? `${orderNowProduct.width}" x ${orderNowProduct.height}"`
                                : orderNowProduct.dimensions || orderNowProduct.standard_size || orderNowProduct.size || "—"}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-3xl bg-white p-5 border border-gray-200">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-gray-700">Quantity</p>
                            <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-2">
                              <button
                                type="button"
                                onClick={() => handleOrderNowQuantityChange(-1)}
                                className="rounded-2xl bg-gray-100 p-3 text-gray-700 hover:bg-gray-200 transition"
                              >
                                <Minus size={18} />
                              </button>
                              <span className="text-2xl font-semibold text-gray-900">{orderNowQuantity}</span>
                              <button
                                type="button"
                                onClick={() => handleOrderNowQuantityChange(1)}
                                className="rounded-2xl bg-gray-100 p-3 text-gray-700 hover:bg-gray-200 transition"
                              >
                                <Plus size={18} />
                              </button>
                            </div>
                          </div>
                          <p className="mt-3 text-sm text-gray-500">Adjust the number of units before moving to the summary page.</p>
                        </div>
                        {(orderNowProduct.extra_charges || []).some((charge) => charge.is_optional) && (
                          <div className="space-y-2 rounded-3xl border border-gray-200 bg-white p-5">
                            <h4 className="text-sm font-semibold text-gray-700">Optional charges</h4>
                            {(orderNowProduct.extra_charges || []).map((charge, index) => {
                              if (!charge.is_optional) return null;
                              const checked = orderNowExtraCharges[index]?.is_selected ?? false;
                              const rateLabel = charge.type === "percentage"
                                ? `${Number(charge.amount) || 0}% of subtotal`
                                : `${formatCurrency(charge.amount)}${charge.type === "per_blade" ? " / blade" : charge.type === "per_sqft" ? " / sq ft" : " / item"}`;
                              return (
                                <label key={`${index}-${charge.name}`} className="flex cursor-pointer items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) => setOrderNowExtraCharges((current) => {
                                      const charges = current.length ? current : getDefaultExtraChargeSelections(orderNowProduct);
                                      return charges.map((item, itemIndex) => (
                                        itemIndex === index ? { ...item, is_selected: event.target.checked } : item
                                      ));
                                    })}
                                    className="mt-0.5 accent-red-700"
                                  />
                                  <span className="flex min-w-0 flex-1 justify-between gap-3">
                                    <span className="font-medium">{charge.name}</span>
                                    <span className="shrink-0 text-gray-500">{rateLabel}</span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        </div>

                    <div className="space-y-6 rounded-[32px] border border-gray-200 bg-white p-6 shadow-sm">
                      <div className="rounded-3xl bg-gradient-to-r from-red-600 to-red-700 p-5 text-white">
                        <p className="text-sm uppercase tracking-[0.24em] text-red-100">Order snapshot</p>
                        <p className="mt-3 text-3xl font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(orderNowSubtotal)}</span></p>
                      </div>

                      <div className="grid gap-3">
                        <div className="rounded-3xl bg-gray-50 p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Estimated total</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(orderNowSubtotal)}</span></p>
                        </div>
                        <div className="rounded-3xl bg-gray-50 p-4 border border-gray-200">
                          <p className="text-xs uppercase tracking-[0.24em] text-gray-500">Downpayment</p>
                          <p className="mt-2 text-lg font-semibold text-gray-900"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(orderNowSubtotal * 0.5)}</span></p>
                        </div>
                      </div>

                      <div className="rounded-3xl bg-red-50 p-4 border border-red-200">
                        <p className="text-sm font-semibold text-red-700">Need help?</p>
                        <p className="mt-2 text-sm text-slate-600">Use the estimate tool to calculate custom pricing based on your measurements.</p>
                      </div>

                      {cartActionError && (
                        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                          {cartActionError}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={requestCloseOrderNowModal}
                      className="rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={openOrderNowReviewModal}
                      disabled={orderRequestLoading}
                      className="rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-5 py-3 text-sm font-semibold text-white hover:from-red-700 hover:to-red-800 transition shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Continue to Summary
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showBatchOrderModal && canRequestOrders && (
              <div className="customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4">
                <div className={`mobile-fullscreen-dialog order-flow-modal flex max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/5 sm:max-h-[92vh] ${darkMode ? "order-flow-modal-dark bg-slate-900" : "bg-white"}`}>
                  <div className={`flex-shrink-0 border-b px-5 py-2 sm:px-8 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-[#faf9f7]"}`}>
                    <div className="flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={requestCloseBatchOrder}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold transition ${darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"}`}
                      >
                        <ArrowLeft size={16} />
                        Back to Cart
                      </button>
                      <button
                        type="button"
                        onClick={requestCloseBatchOrder}
                        aria-label="Close order request"
                        className={`rounded-full border p-1.5 transition ${darkMode ? "border-slate-600 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-500 hover:bg-slate-100"}`}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <h3 className={`mt-0.5 text-lg font-bold tracking-tight ${darkMode ? "text-white" : "text-slate-900"}`}>
                      {selectedItemCount === 1 ? "Place Order Request" : "Place Batch Order Request"}
                    </h3>
                    <p className={`mt-0.5 text-xs ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                      {selectedItemCount === 1
                        ? "Review your contact data and selected item before submitting your request."
                        : "Review your contact data and selected items to compile requests."}
                    </p>
                  </div>

                  <div className={`min-h-0 flex-1 overflow-y-auto p-6 sm:p-8 ${darkMode ? "bg-slate-950" : "bg-[#f2f3f1]"}`}>
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] xl:gap-7">
                      <div className="flex flex-col gap-5">
                        <div className={`space-y-4 rounded-2xl border p-6 shadow-sm sm:p-7 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-[#fcfbf9] shadow-slate-300/40"}`}>
                          <div>
                            <h4 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>Customer Information</h4>
                            <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-gray-500"}`}>Review your details before submitting your request.</p>
                          </div>

                          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                            <div>
                              <label className={`mb-2 block text-[11px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Full Name</label>
                              <input
                                value={`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || ""}
                                readOnly
                                className={`w-full cursor-not-allowed rounded-xl border px-3 py-3 text-sm outline-none ${darkMode ? "border-slate-700 bg-slate-800/80 text-slate-400" : "border-slate-200 bg-slate-100/80 text-slate-500"}`}
                              />
                            </div>
                            <div>
                              <label className={`mb-2 block text-[11px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Email Address</label>
                              <input
                                value={profileForm.email || user?.email || ""}
                                readOnly
                                className={`w-full cursor-not-allowed rounded-xl border px-3 py-3 text-sm outline-none ${darkMode ? "border-slate-700 bg-slate-800/80 text-slate-400" : "border-slate-200 bg-slate-100/80 text-slate-500"}`}
                              />
                            </div>
                            <div className="col-span-full mt-1 border-t border-slate-200 pt-4 dark:border-slate-700">
                              <h5 className={`mb-4 text-xs font-bold uppercase tracking-wide ${darkMode ? "text-slate-200" : "text-slate-800"}`}>Contact &amp; Installation Details</h5>
                              <label className={`mb-2 block text-[11px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Contact Number <span className="text-red-600">*</span></label>
                              <input
                                name="phone"
                                type="tel"
                                inputMode="tel"
                                maxLength={13}
                                value={batchOrderForm.phone}
                                onChange={(event) => setBatchOrderForm((current) => ({ ...current, phone: normalizePhoneInput(event.target.value) }))}
                                placeholder="+639171234567 or 09171234567"
                                className={`w-full rounded-lg border px-3 py-2.5 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-500/10 ${darkMode ? "border-slate-700 bg-slate-950 text-white" : "border-slate-300 bg-transparent text-slate-800"}`}
                              />
                            </div>
                            <div className="col-span-full">
                              <FullAddressField
                                label="Full Address *"
                                name="shipping_address"
                                value={batchOrderForm.shipping_address}
                                minimumLength={0}
                                showError={false}
                                showHelperMessage={false}
                                onChange={(event) => setBatchOrderForm((current) => ({ ...current, shipping_address: event.target.value }))}
                                labelClassName={`mb-2 text-[11px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}
                                helperClassName={darkMode ? "text-slate-400" : "text-slate-500"}
                                className={`w-full rounded-lg border px-3 py-2.5 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-500/10 ${darkMode ? "border-slate-700 bg-slate-950 text-white" : "border-slate-300 bg-transparent text-slate-800"}`}
                              />
                            </div>
                            <div className="col-span-full">
                              <label className={`mb-2 block text-[11px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Special Instructions / Engineering Notes <span className="font-medium normal-case tracking-normal text-slate-400">(Optional)</span></label>
                              <textarea
                                name="notes"
                                value={batchOrderForm.notes}
                                onChange={(event) => setBatchOrderForm((current) => ({ ...current, notes: event.target.value }))}
                                placeholder="Add notes about structure elevations, framing colors, glass thickness preferences, etc."
                                className={`min-h-[96px] w-full resize-y rounded-lg border px-3 py-2.5 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-500/10 ${darkMode ? "border-slate-700 bg-slate-950 text-white placeholder:text-slate-500" : "border-slate-300 bg-transparent text-slate-800 placeholder:text-slate-400"}`}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-5">
                        <div className={`space-y-4 rounded-2xl border p-6 shadow-sm sm:p-7 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-[#fcfbf9] shadow-slate-300/40"}`}>
                          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-red-600">
                            <ClipboardList size={17} />
                            {selectedItemCount === 1 ? "Order Review (1 item)" : `Batch Review (${selectedItemCount} items)`}
                          </div>

                          <div className={`max-h-[320px] space-y-3 overflow-y-auto pr-2`}>
                            {selectedCartItems.map((item) => (
                              <div key={item.cartId || item._id} className={`rounded-2xl border p-3.5 transition-colors ${darkMode ? "border-slate-700 bg-slate-950/60 hover:border-slate-600" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"}`}>
                                <div className="flex items-start gap-3">
                                  <div className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-100"}`}>
                                    <img
                                      src={getProductImage(item, 160) || PRODUCT_IMAGE_PLACEHOLDER}
                                      alt={item.name || "Product"}
                                      width="64"
                                      height="64"
                                      loading="lazy"
                                      decoding="async"
                                      onError={handleProductImageError}
                                      className="h-full w-full object-cover"
                                    />
                                  </div>
                                  <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className={`truncate text-base font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{item.name}</div>
                                      <div className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                        {(() => {
                                          const dimensions = getConfirmationItemDimensions(item);
                                          if (dimensions && !["blade", "per_blade"].includes(String(item.pricing_method || item.unit).toLowerCase())) {
                                            return <>Dimension: Width: <strong className={darkMode ? "text-slate-200" : "text-slate-700"}>{dimensions.width}</strong> x Height: <strong className={darkMode ? "text-slate-200" : "text-slate-700"}>{dimensions.height}</strong> ({dimensions.area} sq ft)</>;
                                          }
                                          return formatOrderItemMeasurements(item);
                                        })()}
                                      </div>
                                    </div>
                                    <div className="flex-shrink-0 text-right">
                                      <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-bold ${darkMode ? "border-blue-800 bg-blue-950/60 text-blue-200" : "border-blue-200 bg-blue-50 text-blue-800"}`}>Quantity: {item.quantity || 1}x</span>
                                      <div className="mt-1 text-base font-bold text-red-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(getItemPriceValue(item))}</span></div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className={`mt-5 rounded-2xl border p-4 sm:p-5 ${darkMode ? "border-red-900/80 bg-gradient-to-br from-red-950/60 to-slate-900" : "border-red-200 bg-gradient-to-br from-red-50 to-rose-50/40"}`}>
                            <div className={`flex items-center justify-between text-base font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                              <span>Grand Estimated Total</span>
                              <span className="text-red-600">₱{Number(selectedSubtotal || 0).toLocaleString()}</span>
                            </div>
                            <div className={`mt-3 flex items-center justify-between text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                              <span>50% Required Downpayment</span>
                              <span>₱{Number((selectedSubtotal || 0) * 0.5).toLocaleString()}</span>
                            </div>
                          </div>

                          <div className={`mt-5 rounded-2xl border p-4 text-sm leading-relaxed ${darkMode ? "border-blue-800 bg-blue-950/50 text-blue-100" : "border-blue-200 bg-blue-50 text-slate-800"}`}>
                            Final pricing will be confirmed during shop discussion or site inspection.{" "}
                            {customerPaymentContactPhone && (
                              <>Contact: <a href={`tel:${customerPaymentContactPhone.replace(/[^\d+]/g, "")}`} className={`inline-flex items-center gap-1 whitespace-nowrap font-bold underline underline-offset-2 ${darkMode ? "text-blue-200" : "text-blue-800"}`}><Phone size={13} aria-hidden="true" />{customerPaymentContactPhone}</a></>
                            )}
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>

                  <div className={`sticky bottom-0 z-10 flex flex-shrink-0 flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:px-10 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-[#faf9f7]"}`}>
                    <button
                      type="button"
                      onClick={requestCloseBatchOrder}
                      className={`w-full rounded-xl border px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 sm:w-auto ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={checkoutLoading || selectedItemCount === 0}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition hover:-translate-y-0.5 hover:from-red-700 hover:to-red-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      <CheckCircle size={18} />
                      {selectedItemCount === 1 ? "Submit Order Request" : "Submit Order Requests"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showBatchOrderConfirmModal && canRequestOrders && (
              <div className="customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 px-3 py-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4">
                <div className={`mobile-fullscreen-dialog flex max-h-[calc(100dvh-1rem)] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-2xl shadow-2xl ${darkMode ? "bg-slate-900" : "bg-white"}`}>
                  <div className={`flex items-center gap-3 border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <CheckCircle size={20} className="text-red-600" />
                    <h3 className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-800"}`}>
                      {selectedItemCount === 1 ? "Confirm Order Request" : "Confirm Batch Order Request"}
                    </h3>
                  </div>

                  <div className={`min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 text-sm sm:px-5 ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Customer Information</h4>
                      <div className="mt-3 space-y-3">
                        <p className="flex items-center gap-2"><User size={14} className="text-slate-400" />{`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "N/A"}</p>
                        <p className="flex items-center gap-2"><Mail size={14} className="text-slate-400" />{profileForm.email || user?.email || "N/A"}</p>
                        <p className="flex items-center gap-2"><Phone size={14} className="text-slate-400" />{batchOrderForm.phone || "N/A"}</p>
                        <p className="flex items-start gap-2"><MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />{normalizeAddress(batchOrderForm.shipping_address) || "N/A"}</p>
                      </div>
                    </section>

                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">
                        {selectedItemCount === 1 ? "Selected Product (1)" : `Selected Products (${selectedItemCount})`}
                      </h4>
                      <div className="mt-3 space-y-2">
                        {selectedCartItems.map((item) => (
                          <div key={item.cartId || item._id || item.name} className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200"}`}>
                            <div className="min-w-0">
                              <p className={`truncate font-semibold ${darkMode ? "text-white" : "text-slate-800"}`}>{item.name}</p>
                              {(() => {
                                const dimensions = getConfirmationItemDimensions(item);
                                return dimensions ? (
                                  <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                    Dimension: Width: <strong className={darkMode ? "text-slate-200" : "text-slate-700"}>{dimensions.width}</strong> x Height: <strong className={darkMode ? "text-slate-200" : "text-slate-700"}>{dimensions.height}</strong> ({dimensions.area} sq ft)
                                  </p>
                                ) : (
                                  <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                    {getConfirmationItemDimensionText(item)}
                                  </p>
                                );
                              })()}
                            </div>
                            <div className="shrink-0 text-right">
                              <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-bold ${darkMode ? "border-blue-800 bg-blue-950/60 text-blue-200" : "border-blue-200 bg-blue-50 text-blue-800"}`}>Quantity: {item.quantity || 1}x</span>
                              <p className="mt-1 font-bold text-red-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(getItemPriceValue(item))}</span></p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Pricing Compilation</h4>
                      <div className="mt-3 space-y-2">
                        <div className={`flex items-center justify-between rounded-sm px-3 py-2 font-bold ${darkMode ? "bg-red-950/50" : "bg-red-50"}`}>
                          <span>Est. Grand Total</span>
                          <span className="text-red-700"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(selectedSubtotal)}</span></span>
                        </div>
                        <div className={`flex items-center justify-between px-3 py-1 font-semibold ${darkMode ? "text-slate-200" : ""}`}>
                          <span>50% Downpayment</span>
                          <span className="text-red-700"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(selectedSubtotal * 0.5)}</span></span>
                        </div>
                      </div>
                    </section>

                    <label className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm ${darkMode ? "border-slate-700 bg-slate-800 text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}>
                      <input
                        type="checkbox"
                        checked={batchOrderAgreed}
                        onChange={(event) => setBatchOrderAgreed(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-red-600 focus:ring-red-500"
                      />
                      <span>I understand the 50% downpayment policy and agree to proceed.</span>
                    </label>

                    <div className={`rounded-md border px-3 py-2 text-xs ${darkMode ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-amber-300 bg-amber-50 text-slate-600"}`}>
                      <p>Final pricing will be confirmed during shop discussion or site inspection.</p>
                      {customerPaymentContactPhone && (
                        <p className="mt-1">Contact: <a href={`tel:${customerPaymentContactPhone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"><Phone size={13} aria-hidden="true" />{customerPaymentContactPhone}</a></p>
                      )}
                    </div>

                    {checkoutError && (
                      <div className="rounded-md border border-red-300 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                        {checkoutError}
                      </div>
                    )}
                  </div>

                  <div className={`flex shrink-0 flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end sm:px-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200"}`}>
                    <button
                      type="button"
                      onClick={handleCancelBatchOrderConfirm}
                      disabled={checkoutLoading}
                      className={`w-full rounded-lg border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmBatchOrder}
                      disabled={checkoutLoading || !batchOrderAgreed || !isBatchOrderAddressValid}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      <CheckCircle size={16} />
                      {checkoutLoading ? "Submitting..." : "Proceed"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showBatchSuccessModal && (
              <div className="order-success-overlay fixed inset-0 z-[70] flex items-center justify-center p-4">
                <div
                  ref={orderSuccessDialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="order-success-batch-title"
                  tabIndex={-1}
                  onKeyDown={trapOrderSuccessDialogFocus}
                  className={`order-success-dialog ${darkMode ? "is-dark" : ""}`}
                >
                  <div className="order-success-icon" aria-hidden="true">
                    <CheckCircle className="order-success-check-icon" size={42} strokeWidth={2.6} />
                  </div>

                  <h3 id="order-success-batch-title" className="order-success-title">
                    {batchSuccessItemCount === 1 ? "Order Request Submitted!" : "Batch Order Requests Submitted!"}
                  </h3>

                  {renderOrderConfirmationProducts(batchSuccessItems)}

                  <p className="order-success-message">
                    Thank you! Your order requests have been received. Our team will contact you shortly to schedule your site inspection and finalize quotation.
                  </p>

                  <a className="order-success-contact" href={adminContactPhoneHref}>
                    <Phone size={16} strokeWidth={2} aria-hidden="true" />
                    Questions? Call us at {adminContactPhone}
                  </a>

                  <div className="order-success-actions">
                    <button
                      type="button"
                      ref={orderSuccessPrimaryButtonRef}
                      onClick={() => {
                        setShowBatchSuccessModal(false);
                        setBatchSuccessItems([]);
                        setActiveTab("orders");
                      }}
                      className="order-success-button order-success-button-primary"
                    >
                      View Your Orders
                    </button>
                    <button
                      type="button"
                      data-close-modal
                      onClick={() => {
                        setShowBatchSuccessModal(false);
                        setBatchSuccessItems([]);
                        setActiveTab("products");
                      }}
                      className="order-success-button order-success-button-secondary"
                    >
                      Continue Browsing
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showOrderReviewModal && canRequestOrders && (cartDecisionProduct || orderNowProduct) && (
              <div className="customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 px-3 py-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4">
                <div className={`mobile-fullscreen-dialog flex max-h-[calc(100dvh-1rem)] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-2xl shadow-2xl ${darkMode ? "bg-slate-900" : "bg-white"}`}>
                  <div className={`flex items-center gap-3 border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <CheckCircle size={20} className="text-red-600" />
                    <h3 className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-800"}`}>
                      Order Summary & Policy
                    </h3>
                  </div>

                  <div className={`min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 text-sm sm:px-5 ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Customer Information</h4>
                      <div className="mt-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-slate-400" />
                          <span>{`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "N/A"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Mail size={14} className="text-slate-400" />
                          <span>{profileForm.email || user?.email || "N/A"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone size={14} className="text-slate-400" />
                          <span>{deliveryConfirmForm.phone || profileForm.phone || user?.phone || "N/A"}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                          <span>{deliveryConfirmForm.shipping_address || buildDeliveryAddress(deliveryConfirmForm) || "N/A"}</span>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Selected Product (1)</h4>
                      <div className={`mt-3 rounded-xl border px-3 py-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`truncate font-semibold ${darkMode ? "text-white" : "text-slate-800"}`}>
                              {(reviewOrderMode === "orderNow" ? orderNowProduct : cartDecisionProduct)?.name || "Selected product"}
                            </p>
                            {(() => {
                              const selectedProduct = reviewOrderMode === "orderNow" ? orderNowProduct : cartDecisionProduct;
                              const quantity = reviewOrderMode === "orderNow" ? orderNowQuantity : estimateQuantity;
                              const measurement = reviewOrderMode === "orderNow"
                                ? getProductDefaultDimensions(selectedProduct, Math.max(1, Number(quantity) || 1))
                                : { width: estimateWidth, height: estimateHeight, measurementUnit: estimateForm.unit };
                              const dimensions = isBladePricingProduct(selectedProduct) ? null : getConfirmationItemDimensions(measurement);
                              return dimensions ? (
                                <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                  Dimension: Width: <strong className={darkMode ? "text-slate-200" : "text-slate-700"}>{dimensions.width}</strong> x Height: <strong className={darkMode ? "text-slate-200" : "text-slate-700"}>{dimensions.height}</strong> ({dimensions.area} sq ft)
                                </p>
                              ) : (
                                <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                  {!orderReviewMeasurementText.startsWith("Quantity:") && orderReviewMeasurementText}
                                </p>
                              );
                            })()}
                          </div>
                          <div className="shrink-0 text-right">
                            <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-bold ${darkMode ? "border-blue-800 bg-blue-950/60 text-blue-200" : "border-blue-200 bg-blue-50 text-blue-800"}`}>Quantity: {Math.max(1, Number(reviewOrderMode === "orderNow" ? orderNowQuantity : estimateQuantity) || 1)}x</span>
                            <p className="mt-1 text-base font-bold text-red-600">
                              {reviewOrderMode === "orderNow"
                                ? orderNowProduct
                                  ? formatCurrency(orderNowSubtotal)
                                  : "\u20B10.00"
                                : estimateTotalCost
                                  ? `\u20B1${estimateTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : "\u20B10.00"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h4 className="border-b border-red-100 pb-2 text-xs font-bold uppercase tracking-wide text-red-700">Pricing Compilation</h4>
                      <div className="mt-3 space-y-2">
                        <div className={`flex items-center justify-between rounded-md px-3 py-2 font-bold ${darkMode ? "bg-red-950/50 text-white" : "bg-red-50 text-slate-800"}`}>
                          <span>Est. Grand Total</span>
                          <span className="text-red-600">
                            {reviewOrderMode === "orderNow"
                              ? orderNowProduct
                                ? formatCurrency(orderNowSubtotal)
                                : "₱0.00"
                              : estimateTotalCost
                                ? `₱${estimateTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "₱0.00"}
                          </span>
                        </div>
                        <div className={`flex items-center justify-between px-3 py-1 font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                          <span>50% Downpayment</span>
                          <span className="text-red-600">
                            {reviewOrderMode === "orderNow"
                              ? orderNowProduct
                                ? formatCurrency(orderNowSubtotal * 0.5)
                                : "₱0.00"
                              : estimateTotalCost
                                ? `₱${(estimateTotalCost * 0.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "₱0.00"}
                          </span>
                        </div>
                      </div>
                    </section>

                    <div className={`rounded-md border px-3 py-3 text-xs ${darkMode ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-amber-300 bg-amber-50 text-slate-600"}`}>
                      <p>Final pricing will be confirmed during shop discussion or site inspection.</p>
                      {customerPaymentContactPhone && (
                        <p className="mt-1">Contact: <a href={`tel:${customerPaymentContactPhone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"><Phone size={13} aria-hidden="true" />{customerPaymentContactPhone}</a></p>
                      )}
                    </div>

                    <div className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                      <p className={`text-sm font-semibold ${darkMode ? "text-red-400" : "text-red-700"}`}>Payment Policy</p>
                      <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                        A 50% downpayment of the total order amount is required before proceeding with the order.
                      </p>
                    </div>

                    <label className={`flex items-start gap-3 rounded-lg border p-3 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                      <input
                        type="checkbox"
                        checked={orderReviewAgreed}
                        onChange={(e) => setOrderReviewAgreed(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      <span className={darkMode ? "text-slate-200" : "text-slate-700"}>
                        I understand the 50% downpayment policy and agree to proceed.
                      </span>
                    </label>

                    {cartActionError && (
                      <div className="rounded-md border border-red-300 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                        {cartActionError}
                      </div>
                    )}
                  </div>

                  <div className={`flex shrink-0 flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end sm:px-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowOrderReviewModal(false);
                        setCartActionError("");
                      }}
                      className={`w-full rounded-lg border px-4 py-2.5 text-sm font-semibold transition sm:w-auto ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitOrderRequest}
                      disabled={!orderReviewAgreed || orderRequestLoading || !isValidStreetAddress(deliveryConfirmForm.shipping_address || buildDeliveryAddress(deliveryConfirmForm))}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      <CheckCircle size={16} />
                      {orderRequestLoading ? "Submitting..." : "Proceed"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showOrderSuccessModal && orderSuccessData && (
              <div className="order-success-overlay fixed inset-0 z-[70] flex items-center justify-center p-4">
                <div
                  ref={orderSuccessDialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="order-success-single-title"
                  tabIndex={-1}
                  onKeyDown={trapOrderSuccessDialogFocus}
                  className={`order-success-dialog ${darkMode ? "is-dark" : ""}`}
                >
                  <div className="order-success-icon" aria-hidden="true">
                    <CheckCircle className="order-success-check-icon" size={42} strokeWidth={2.6} />
                  </div>

                  <h3 id="order-success-single-title" className="order-success-title">Order Request Submitted!</h3>

                  {renderOrderConfirmationProducts(orderSuccessData.items)}

                  <p className="order-success-message">
                    Thank you! Your order requests have been received. Our team will contact you shortly to schedule your site inspection and finalize quotation.
                  </p>

                  <a className="order-success-contact" href={adminContactPhoneHref}>
                    <Phone size={16} strokeWidth={2} aria-hidden="true" />
                    Questions? Call us at {adminContactPhone}
                  </a>

                  <div className="order-success-actions">
                    <button
                      type="button"
                      ref={orderSuccessPrimaryButtonRef}
                      onClick={() => {
                        setShowOrderSuccessModal(false);
                        setOrderSuccessData(null);
                        setActiveTab("orders");
                      }}
                      className="order-success-button order-success-button-primary"
                    >
                      View Your Orders
                    </button>
                    <button
                      type="button"
                      data-close-modal
                      onClick={() => {
                        setShowOrderSuccessModal(false);
                        setOrderSuccessData(null);
                        setActiveTab("products");
                      }}
                      className="order-success-button order-success-button-secondary"
                    >
                      Continue Browsing
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "orders" && (
          <>
            <div className="mb-5 flex flex-col gap-4 border-b pb-4">
              <div>
                <h2 className={`text-2xl font-black tracking-[-0.03em] ${darkMode ? "text-white" : "text-slate-900"}`}>My Orders</h2>
                <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Track progress, payments, and completed projects.</p>
              </div>
              <div className="w-full sm:w-auto lg:hidden">
                <CustomerDropdown
                  ariaLabel="Filter orders"
                  darkMode={darkMode}
                  value={orderFilter}
                  onChange={(event) => {
                    setOrderFilter(event.target.value);
                    setOrderPage(1);
                  }}
                  className="w-full"
                >
                  {orderFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label} ({option.count})</option>
                  ))}
                </CustomerDropdown>
              </div>
              <div className="hidden w-full lg:block">
                <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter orders">
                {orderFilterOptions.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={orderFilter === tab.value}
                    onClick={() => {
                      setOrderFilter(tab.value);
                      setOrderPage(1);
                    }}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${orderFilter === tab.value ? (darkMode ? "border-red-700 bg-red-950/60 text-red-100 shadow-sm shadow-black/10" : "border-red-200 bg-red-50 text-red-950 shadow-sm") : (darkMode ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900")}`}
                  >
                    {tab.label}
                    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${orderFilter === tab.value ? (darkMode ? "bg-red-800 text-red-50" : "bg-red-200 text-red-900") : (darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-700")}`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
                </div>
              </div>
            </div>


            {orderRequestMessage && (
              <div className={`mb-6 rounded-3xl border px-6 py-4 text-sm ${darkMode ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
                {orderRequestMessage}
              </div>
            )}

            {orderFilter === "repair" ? (
              <CustomerRepairRequests darkMode={darkMode} projects={orders.filter((order) => String(order.status || "").toLowerCase() === "completed")} />
            ) : ordersLoading ? (
              <div className="space-y-4">
                {[...Array(2)].map((_, index) => (
                  <div key={index} className={`h-20 animate-pulse rounded-xl border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`} />
                ))}
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className={`rounded-xl border border-dashed px-6 py-12 text-center ${darkMode ? "border-slate-700 bg-slate-800/60" : "border-slate-300 bg-white"}`}>
                <p className={`font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>No orders found</p>
                <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Try another filter to see your orders.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {displayedOrders.map((order, index) => {
                  const orderId = getOrderIdentifier(order, `order-${index}`);
                  const paymentHistoryKey = `${orderOwnerId}:${orderId}`;
                  const isPaymentHistoryExpanded = Boolean(paymentHistoryExpandedByOrder[paymentHistoryKey]);
                  const product = order.items?.[0] || {};
                  const orderItems = Array.isArray(order.items) ? order.items : [];
                  const unresolvedPaymentRecords = new Set(getUnresolvedPaymentProofRecords(order));
                  const isOrderExpanded = expandedOrderId === orderId;
                  const orderInstallationBilling = installationBillingByOrder[String(orderId)];
                  const orderTotal = getOrderTotalValue(order);
                  const paymentSummary = getPaymentSummary(order);
                  const downpaymentAmount = paymentSummary.paidAmount;
                  const requiredPaymentAmount = paymentSummary.requiredAmount;
                  const balanceAmount = paymentSummary.remainingAmount;
                  const isFullyPaid = Math.round(balanceAmount * 100) <= 0;
                  const downpaymentBalance = Math.max(requiredPaymentAmount - downpaymentAmount, 0);
                  const isDownpaymentCovered = Math.round(downpaymentBalance * 100) <= 0;
                  const isFullPaymentTerms = String(order.payment_terms || "").trim().toLowerCase() === "full_payment";
                  const enteredPaymentAmount = Number(String(paymentProofForm.amount).replace(/,/g, "")) || 0;
                  const isPaymentBelowRequired = paymentProofOpenOrderId === orderId
                    && enteredPaymentAmount > 0
                    && Math.round(enteredPaymentAmount * 100) < Math.round(downpaymentBalance * 100);
                  const paymentSupportContact = getPaymentSupportPhone(customerPaymentContactPhone);
                  const paymentBalanceMessage = isDownpaymentCovered
                    ? `${isFullPaymentTerms ? "Full payment complete" : "Downpayment covered"}. Remaining balance: ${formatCurrency(balanceAmount)}.`
                    : `${isFullPaymentTerms ? "Full payment still due" : "Downpayment still due"}: ${formatCurrency(downpaymentBalance)}.`;
                  const paymentStatus = {
                    label: isFullyPaid ? "Fully Paid" : getPaymentStatusLabel(paymentSummary.status),
                    className: darkMode
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : "border-amber-200 bg-amber-50 text-amber-800",
                  };
                  const isBatchOrder = orderItems.length > 1;
                  const orderDisplayName = isBatchOrder ? "Batch Order" : product.name || product.product_name || "Project item";
                  const orderDisplayQuantity = isBatchOrder ? `${orderItems.length} items` : `Quantity: ${product.quantity || 1}x`;
                  const orderPreviewItem = isBatchOrder
                    ? orderItems.find((item) => getOrderItemImage(item) !== PRODUCT_IMAGE_PLACEHOLDER) || product
                    : product;
                  const orderDate = formatDateToMMMDDYYYY(order.updatedAt || order.createdAt) || "—";
                  const awaitingContractSignoff = isAwaitingContractSignoff(order);
                  const orderStatusLabel = awaitingContractSignoff ? "Awaiting Contract Sign-off" : getOrderStatusLabel(order.status);
                  const hasContractBeenSent =
                    normalizeOrderStatusKey(order?.status) === "contract_sent" ||
                    normalizeOrderStatusKey(order?.contract_status) === "sent" ||
                    (normalizeOrderStatusKey(order?.status) === "site_inspection" && normalizeOrderStatusKey(order?.contract_status) === "sent");
                  const isContractWaitingForCustomer =
                    hasContractBeenSent &&
                    order.order_type !== "walk_in_customer";
                  const isCustomerAcceptedContract = isCustomerContractAccepted(order);
                  const isOnlineContractAccepted = order.acceptedByCustomer === true && order.acceptance_method === "online";
                  const isProjectFinished = isOrderCompletedAndReviewable(order);
                  const isOrderCancelled = String(order.status || "").toLowerCase() === "cancelled";
                    const paymentProofSubmission = paymentProofSuccessByOrder[orderId];
                    const latestPaymentProof = getCustomerPaymentProof(order);
                    const lastPaymentProofUrl = paymentProofSubmission?.fileUrl || latestPaymentProof.fileUrl || "";
                    const showContractSignoffControls = !isCustomerAcceptedContract
                      && !isFullyPaid
                      && paymentProofOpenOrderId !== orderId
                      && latestPaymentProof.status !== "pending"
                      && latestPaymentProof.status !== "rejected";
                    const panelMetricCardClassName = `min-w-0 rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800/80" : "border-slate-200 bg-white"}`;
                    const panelMetricLabelClassName = `text-xs font-bold uppercase tracking-wide ${darkMode ? "text-slate-300" : "text-slate-600"}`;
                    const panelMetricNoteClassName = `text-xs font-medium leading-relaxed ${darkMode ? "text-slate-200" : "text-slate-700"}`;
                    const panelNeutralButtonClassName = `inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`;
                    const receiptActionButtonClassName = `inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${darkMode ? "border-emerald-800 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/60" : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"}`;
                    const contractViewButtonClassName = `inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${darkMode ? "border-violet-800 bg-violet-950/50 text-violet-200 hover:bg-violet-900/60" : "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"}`;
                    const timelineViewButtonClassName = `inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${darkMode ? "border-sky-800 bg-sky-950/50 text-sky-200 hover:bg-sky-900/60" : "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"}`;
                    const contractActionButtonClassName = `inline-flex h-[34px] shrink-0 items-center justify-center rounded-lg border px-4 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700" : "border-[#d8d2c6] bg-white text-slate-900 hover:bg-[#f8f6f1]"}`;
                    const declineContractButtonClassName = `inline-flex h-[34px] shrink-0 items-center justify-center rounded-lg border border-slate-300 px-4 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 ${darkMode ? "bg-slate-800 text-red-300 hover:bg-red-500/10" : "bg-white text-red-700 hover:bg-red-50"}`;
                    const acceptContractButtonClassName = "inline-flex h-[34px] shrink-0 items-center justify-center rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white transition-colors duration-150 hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2";

                  return (
                    <div
                      key={orderId}
                      data-notification-record-id={orderId}
                      className={`overflow-hidden rounded-xl border shadow-sm transition hover:shadow-md ${highlightedOrderId === orderId ? "notification-target-highlight" : darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}
                    >
                      <div className="grid gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4">
                        <div className="flex min-w-0 items-center gap-3">
                          {isBatchOrder ? (
                            <div className={`relative h-12 w-14 shrink-0 overflow-hidden rounded-[10px] border shadow-sm ${darkMode ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-slate-100"}`}>
                              <img
                                src={getOrderItemImage(orderPreviewItem)}
                                alt={orderPreviewItem.name || orderPreviewItem.product_name || "Batch order preview"}
                                className="h-full w-full object-cover"
                                onError={(event) => {
                                  event.currentTarget.onerror = null;
                                  event.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                                }}
                              />
                              <span
                                aria-label={`${orderItems.length} items in this batch order`}
                                className="absolute bottom-0.5 right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-white bg-slate-700 px-1 text-[10px] font-bold leading-none text-white shadow-sm"
                              >
                                {orderItems.length}
                              </span>
                            </div>
                          ) : (
                            <div className={`h-11 w-11 shrink-0 overflow-hidden rounded-[12px] border shadow-sm sm:h-12 sm:w-12 ${darkMode ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-slate-100"}`}>
                              <img
                                src={getOrderItemImage(product)}
                                alt={product.name || product.product_name || "Product image"}
                                className="h-full w-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.onerror = null;
                                  e.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                                }}
                              />
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                {orderDisplayName}
                              </span>
                              <span className={`text-xs font-semibold ${awaitingContractSignoff ? darkMode ? "text-sky-300" : "text-sky-700" : darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                {orderStatusLabel}
                              </span>
                            </div>
                            <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              <span>{order.tracking || order._id || "—"}</span>
                              <span aria-hidden="true">·</span>
                              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-bold ${darkMode ? "border-blue-800 bg-blue-950/50 text-blue-200" : "border-blue-200 bg-blue-50 text-blue-800"}`}>{orderDisplayQuantity}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 sm:gap-5">
                          <div className="text-right sm:min-w-[110px]">
                            <p className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Total</p>
                            <p className="mt-0.5 text-base font-bold text-red-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(orderTotal)}</span></p>
                          </div>
                          <div className="text-right sm:min-w-[90px]">
                            <p className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Updated</p>
                            <p className={`mt-0.5 text-xs font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{orderDate}</p>
                          </div>
                          <div className="flex min-w-0 flex-wrap justify-end">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {["review", "completed"].includes(orderFilter) && isProjectFinished && isOrderCompletedAndReviewable(order) && !isBatchOrder && !hasOrderReview(order) && (
                                <button
                                  type="button"
                                  disabled={!canUploadFeedback}
                                  onClick={() => openCustomerReviewModal(order)}
                                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[10px] font-black leading-none tracking-[0.02em] shadow-sm transition-all duration-200 ${!canUploadFeedback
                                    ? darkMode ? "cursor-not-allowed border-slate-600 bg-slate-800 text-slate-400 shadow-none" : "cursor-not-allowed border-slate-300 bg-slate-100 text-slate-500 shadow-none"
                                    : darkMode ? "border-amber-500/70 bg-amber-500/15 text-amber-200 shadow-amber-500/10 hover:bg-amber-500/20 hover:text-amber-100" : "border-amber-500 bg-amber-400 text-slate-950 hover:bg-amber-300 hover:shadow-amber-500/30"}`}
                                  title={!canUploadFeedback ? "Feedback is restricted for this account." : undefined}
                                >
                                  <Star size={12} fill="currentColor" className="drop-shadow-[0_0_2px_rgba(0,0,0,0.12)]" aria-hidden="true" />
                                  <span className="whitespace-nowrap">Leave Feedback</span>
                                </button>
                              )}
                              {["review", "completed"].includes(orderFilter) && isProjectFinished && isOrderCompletedAndReviewable(order) && isBatchOrder && !hasOrderReview(order) && (
                                <button
                                  type="button"
                                  disabled={!canUploadFeedback}
                                  onClick={() => openBatchOrderReviewModal(order)}
                                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[10px] font-black leading-none shadow-sm ${!canUploadFeedback
                                    ? darkMode ? "cursor-not-allowed border-slate-600 bg-slate-800 text-slate-400 shadow-none" : "cursor-not-allowed border-slate-300 bg-slate-100 text-slate-500 shadow-none"
                                    : darkMode ? "border-amber-500/70 bg-amber-500/15 text-amber-200 hover:bg-amber-500/20" : "border-amber-500 bg-amber-400 text-slate-950 hover:bg-amber-300"}`}
                                  title={!canUploadFeedback ? "Feedback is restricted for this account." : undefined}
                                >
                                  <Star size={12} fill="currentColor" aria-hidden="true" />
                                  <span>{canUploadFeedback ? "Review products" : "Leave Feedback"}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setExpandedOrderId((prev) => (prev === orderId ? null : orderId))}
                                aria-expanded={isOrderExpanded}
                                className={panelNeutralButtonClassName}
                              >
                                {isOrderExpanded ? "Hide details" : "View details"}
                                {isOrderExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {isOrderExpanded && (
                          <div className={`border-t p-3 sm:p-4 ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-slate-50"}`}>
                          {isContractWaitingForCustomer && (
                            <section className={`mt-4 rounded-xl border p-4 ${darkMode ? "border-amber-500/30 bg-amber-500/10" : "border-amber-200 bg-amber-50"}`}>
                              <h4 className={`text-base font-black ${darkMode ? "text-amber-100" : "text-amber-900"}`}>Contract Acceptance</h4>
                              <p className={`mt-1 text-sm font-bold ${darkMode ? "text-amber-200" : "text-amber-800"}`}>Contract Sent to You</p>
                              <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Please review the contract details before accepting.</p>
                              <div className="mt-4 flex flex-wrap gap-2">
                                <button type="button" onClick={() => openContractModal(order)} className={contractActionButtonClassName}>View Contract</button>
                                <button type="button" onClick={() => openContractConfirmModal("decline", orderId)} className={declineContractButtonClassName}>Decline</button>
                                <button type="button" onClick={() => openContractConfirmModal("accept", orderId)} className={acceptContractButtonClassName}>Accept &amp; Sign Contract</button>
                              </div>
                            </section>
                          )}
                          {order.contract_status === "declined" && (
                              <div className={`mt-4 rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800/80" : "border-slate-200 bg-white"}`}>
                              <p className={`text-sm font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Contract Declined</p>
                            </div>
                          )}

                          <div className="mt-4 space-y-3">
                              {orderItems.map((item, itemIndex) => (
                                <div key={`${orderId}-item-${itemIndex}`} className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                                  <div className="flex min-w-0 flex-1 items-center gap-3">
                                    <div className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border ${darkMode ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-slate-100"}`}>
                                      <img
                                        src={getOrderItemImage(item)}
                                        alt={item.name || item.product_name || `Product ${itemIndex + 1}`}
                                        className="h-full w-full object-cover"
                                        onError={(e) => {
                                          e.currentTarget.onerror = null;
                                          e.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                                        }}
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <p className={`truncate text-base font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>
                                        {item.name || item.product_name || `Product ${itemIndex + 1}`}
                                      </p>
                                      <p className={`mt-1 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                                        {(() => {
                                          const dimensions = getConfirmationItemDimensions(item);
                                          if (!dimensions) return getConfirmationItemDimensionText(item).replace(/^Size:\s*/i, "Dimensions: ");
                                          return <><span className="font-bold">Dimensions:</span> <span className="font-medium">Width:</span> <strong className={darkMode ? "text-slate-100" : "text-slate-900"}>{dimensions.width}</strong> × <span className="font-medium">Height:</span> <strong className={darkMode ? "text-slate-100" : "text-slate-900"}>{dimensions.height}</strong> <span className={`ml-1 inline-flex rounded-md px-1.5 py-0.5 text-xs font-semibold ${darkMode ? "bg-slate-700 text-slate-200" : "bg-slate-100 text-slate-700"}`}>{dimensions.area} sq ft</span></>;
                                        })()}
                                      </p>
                                      {(() => {
                                        const priceBreakdown = getProductLineBreakdown(item, item);
                                        return (priceBreakdown.baseTotal > 0 || priceBreakdown.extraCharges.length > 0) ? (
                                          <div className={`mt-2 space-y-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                                            <p><span className="font-semibold">Base price:</span> <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(priceBreakdown.baseTotal)}</span></p>
                                            {priceBreakdown.extraCharges.map((charge, chargeIndex) => (
                                              <p key={`${orderId}-item-${itemIndex}-charge-${chargeIndex}`}>
                                                <span className="font-semibold">+ {charge.name}:</span> <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(charge.total)}</span>
                                              </p>
                                            ))}
                                          </div>
                                        ) : null;
                                      })()}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                                    {itemIndex === 0 && (
                                      <div className="flex max-w-full flex-wrap items-center justify-start gap-2 sm:justify-end">
                                        {(orderInstallationBilling?.receipts?.length > 0 || orderInstallationBilling?.project_receipts?.length > 0) && (
                                          <button
                                            type="button"
                                            onClick={() => openLatestExtraChargeReceipt(orderInstallationBilling, order)}
                                            className={receiptActionButtonClassName}
                                          >
                                            View receipt
                                          </button>
                                        )}
                                        {isOnlineContractAccepted && (
                                          <button
                                            type="button"
                                            onClick={() => openContractModal(order)}
                                            className={contractViewButtonClassName}
                                          >
                                            View Contract
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => setSelectedOrderForModal(order)}
                                          className={timelineViewButtonClassName}
                                        >
                                          View Order Timeline
                                        </button>
                                      </div>
                                    )}
                                    {canAccessCustomerRatings && isProjectFinished && isOrderCompletedAndReviewable(order) && (
                                      ["reviewed", "completed"].includes(orderFilter)
                                        ? getOrderItemReview(order, itemIndex)?.submittedAt && (
                                          <div className="mt-1 flex justify-end gap-1.5 sm:gap-3">
                                            <button
                                              type="button"
                                              onClick={() => openOrderReviewDetails(order, itemIndex)}
                                              aria-label={`View review for ${item.name || item.product_name || `Product ${itemIndex + 1}`}`}
                                              title="View review"
                                              className={`inline-flex size-8 items-center justify-center rounded-lg text-xs font-semibold sm:h-auto sm:w-auto sm:justify-start sm:rounded-none sm:p-0 sm:underline sm:underline-offset-2 ${darkMode ? "text-sky-300 hover:bg-slate-700 sm:hover:bg-transparent" : "text-sky-700 hover:bg-sky-50 sm:hover:bg-transparent"}`}
                                            >
                                              <Eye size={13} aria-hidden="true" />
                                              <span className="hidden sm:inline">View review</span>
                                            </button>
                                            {isOrderReviewEditable(order, itemIndex) && (
                                              <button
                                                type="button"
                                                onClick={() => openCustomerReviewModal(order, itemIndex)}
                                                aria-label={`Edit review for ${item.name || item.product_name || `Product ${itemIndex + 1}`}`}
                                                title="Edit review"
                                                className={`inline-flex size-8 items-center justify-center rounded-lg text-xs font-semibold sm:h-auto sm:w-auto sm:justify-start sm:rounded-none sm:p-0 sm:underline sm:underline-offset-2 ${darkMode ? "text-amber-300 hover:bg-slate-700 sm:hover:bg-transparent" : "text-amber-700 hover:bg-amber-50 sm:hover:bg-transparent"}`}
                                              >
                                                <Pencil size={12} aria-hidden="true" />
                                                <span className="hidden sm:inline">Edit review</span>
                                              </button>
                                            )}
                                          </div>
                                        )
                                        : isBatchOrder && (
                                          getOrderItemReview(order, itemIndex)?.submittedAt
                                            ? isOrderReviewEditable(order, itemIndex)
                                              ? (
                                                <button
                                                  type="button"
                                                  onClick={() => openCustomerReviewModal(order, itemIndex)}
                                                  className={`mt-1 text-xs font-semibold underline underline-offset-2 ${darkMode ? "text-amber-300" : "text-amber-700"}`}
                                                >
                                                  Edit review
                                                </button>
                                              )
                                              : <span className={`mt-1 block text-xs font-semibold ${darkMode ? "text-emerald-300" : "text-emerald-700"}`}>Reviewed</span>
                                            : (
                                              <button
                                                type="button"
                                                onClick={() => openCustomerReviewModal(order, itemIndex)}
                                                className={`mt-1 text-xs font-semibold underline underline-offset-2 ${darkMode ? "text-amber-300" : "text-amber-700"}`}
                                              >
                                                Review product
                                              </button>
                                            )
                                        )
                                    )}
                                  </div>
                                </div>
                              ))}
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <div className={panelMetricCardClassName}>
                              <span className={panelMetricLabelClassName}>Total project cost</span>
                              <span className="mt-1 block text-xl font-bold text-red-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(orderTotal)}</span></span>
                              <span className={`${panelMetricNoteClassName} mt-1 block`}>Confirmed order total</span>
                            </div>
                            <div className={`${panelMetricCardClassName} border-l-4 ${darkMode ? "border-l-amber-400" : "border-l-amber-500"}`}>
                              <span className={panelMetricLabelClassName}>{order.payment_terms === "full_payment" ? "Required full payment" : "Required downpayment"}</span>
                              <span className={`mt-1 block text-xl font-bold ${darkMode ? "text-amber-300" : "text-amber-700"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(requiredPaymentAmount)}</span></span>
                              <span className={`${panelMetricNoteClassName} mt-1 block`}>Site Inspection terms: {getSavedPaymentTermsLabel(order.payment_terms)}</span>
                            </div>
                            <div className={panelMetricCardClassName}>
                              <span className={panelMetricLabelClassName}>Amount already paid</span>
                              <span className="mt-1 block text-xl font-bold text-emerald-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(downpaymentAmount)}</span></span>
                              <span className={`${panelMetricNoteClassName} mt-1 block`}>Verified payments only</span>
                            </div>
                            <div className={panelMetricCardClassName}>
                              <span className={panelMetricLabelClassName}>Downpayment remaining</span>
                              <span className={`mt-1 block text-xl font-bold ${darkMode ? "text-amber-300" : "text-amber-700"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(downpaymentBalance)}</span></span>
                            </div>
                            <div className={panelMetricCardClassName}>
                              <span className={panelMetricLabelClassName}>Remaining project balance</span>
                              <span className="mt-1 block text-xl font-bold text-red-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(balanceAmount)}</span></span>
                            </div>
                            <div className={panelMetricCardClassName}>
                              <span className={`${panelMetricLabelClassName} block`}>Payment status</span>
                              <span className={`${statusBadgeBaseClassName} mt-2 w-fit text-xs ${paymentStatus.className}`}>
                                {paymentStatus.label}
                              </span>
                            </div>
                          </div>

                          <InstallationBillingPanel
                            order={order}
                            darkMode={darkMode}
                            readOnly
                            issuesOnly
                            onDataChange={handleInstallationBillingLoaded}
                          />

                          {(() => {
                            const discrepancyContact = getPaymentSupportPhone(customerPaymentContactPhone);
                            const discrepancies = (order.payment_records || []).flatMap((record) => {
                              const allDiscrepancies = record.discrepancies || [];
                              const activeDiscrepancies = allDiscrepancies.filter((discrepancy) => discrepancy.status !== "resolved");
                              if (allDiscrepancies.length) return activeDiscrepancies.map((discrepancy) => ({ record, discrepancy }));
                              const submitted = Number(record.submitted_amount);
                              const verified = Number(record.verified_amount);
                              const legacyMismatch = record.status === "verified" && record.submitted_amount != null && record.verified_amount != null
                                && Math.round(submitted * 100) !== Math.round(verified * 100);
                              return legacyMismatch ? [{
                                record,
                                discrepancy: {
                                  customer_reported_amount: submitted,
                                  admin_recorded_amount: verified,
                                  difference: Math.abs(verified - submitted),
                                  status: "pending_review",
                                },
                              }] : [];
                            });
                            return discrepancies.map(({ record, discrepancy }) => (
                              <div key={`${record._id}-${discrepancy._id || discrepancy.detected_at || "legacy"}`} role="alert" className={`mt-3 rounded-xl border px-3.5 py-3 text-xs leading-5 ${darkMode ? "border-amber-700/70 bg-amber-950/45 text-amber-100" : "border-amber-300 bg-[#fff5dc] text-amber-950"}`}>
                                <div className="flex items-start gap-2.5">
                                  <Info size={18} className={`mt-0.5 shrink-0 ${darkMode ? "text-amber-300" : "text-amber-900"}`} aria-hidden="true" />
                                  <div className="min-w-0 flex-1">
                                    <p className={`font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Payment Amount Discrepancy <span className={`font-medium ${darkMode ? "text-amber-300" : "text-amber-700"}`}>· {String(discrepancy.status || "pending_review").replaceAll("_", " ")}</span></p>
                                    <p className={`mt-1.5 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 ${darkMode ? "text-slate-300" : "text-slate-500"}`}>
                                      <span>Customer-reported: <strong className={`font-extrabold ${darkMode ? "text-slate-100" : "text-slate-950"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(discrepancy.customer_reported_amount))}</span></strong></span>
                                      <span aria-hidden="true" className="hidden text-slate-400 sm:inline">·</span>
                                      <span>Admin-recorded: <strong className={`font-extrabold ${darkMode ? "text-slate-100" : "text-slate-950"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(discrepancy.admin_recorded_amount))}</span></strong></span>
                                      <span aria-hidden="true" className="hidden text-slate-400 sm:inline">·</span>
                                      <span>Difference: <strong className={`font-extrabold ${darkMode ? "text-slate-100" : "text-slate-950"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(discrepancy.difference))}</span></strong></span>
                                    </p>
                                    <p className={`mt-2 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>The recorded amount differs from the amount you submitted. If you believe it is incorrect, contact us for clarification{discrepancyContact ? <> at <a className={`ml-1 inline-flex items-center whitespace-nowrap rounded-md border px-2 py-1 font-bold no-underline align-middle transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${darkMode ? "border-amber-600/70 bg-amber-900/50 text-amber-200 hover:bg-amber-900" : "border-amber-300 bg-white/70 text-amber-800 hover:bg-white"}`} href={discrepancyContact.href}><Phone size={14} className="mr-1.5 shrink-0" aria-hidden="true" />{discrepancyContact.display}</a>.</> : ". Please contact the system administrator for assistance."}</p>
                                  </div>
                                </div>
                              </div>
                            ));
                          })()}

                          {Array.isArray(order.payment_records) && order.payment_records.length > 0 && (
                            <section className={`mt-4 rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-white"}`}>
                              <button
                                type="button"
                                aria-expanded={isPaymentHistoryExpanded}
                                aria-controls={`payment-history-content-${orderId}`}
                                onClick={() => setPaymentHistoryExpandedByOrder((current) => ({
                                  ...current,
                                  [paymentHistoryKey]: !current[paymentHistoryKey],
                                }))}
                                className={`flex w-full items-center justify-between gap-3 rounded-md text-left text-xs font-black uppercase tracking-wide outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${darkMode ? "text-slate-200 focus-visible:ring-offset-slate-800" : "text-slate-700 focus-visible:ring-offset-white"}`}
                              >
                                <span>Payment history</span>
                                {isPaymentHistoryExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                              </button>
                              {isPaymentHistoryExpanded && (
                                <div
                                id={`payment-history-content-${orderId}`}
                                className={`mt-2 max-h-56 space-y-2 overflow-y-scroll overscroll-contain pr-2 sm:max-h-64 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:rounded-full ${darkMode ? "[&::-webkit-scrollbar-track]:bg-slate-800 [&::-webkit-scrollbar-thumb]:bg-slate-500" : "[&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-400"}`}
                                style={{ scrollbarWidth: "thin", scrollbarColor: darkMode ? "#64748b #1e293b" : "#94a3b8 #f1f5f9" }}
                              >
                                {[...order.payment_records].filter((record) => record.status !== "pending" || unresolvedPaymentRecords.has(record)).sort((first, second) => new Date(second.verified_at || second.recorded_at || second.rejected_at || second.submitted_at || 0) - new Date(first.verified_at || first.recorded_at || first.rejected_at || first.submitted_at || 0)).map((record) => {
                                  const changed = record.submitted_amount != null && record.verified_amount != null
                                    && Math.round(Number(record.submitted_amount) * 100) !== Math.round(Number(record.verified_amount) * 100);
                                  const hasPaymentDiscrepancy = (record.discrepancies || []).some((discrepancy) => discrepancy.status !== "resolved")
                                    || (changed && record.status === "verified");
                                  return (
                                      <div key={record._id || record.submitted_at} className={`rounded-xl border p-3 text-xs ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-[#e9e1d4] bg-white"}`}>
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                          {hasPaymentDiscrepancy ? (
                                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${darkMode ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-800"}`}>
                                              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                              Needs Review
                                            </span>
                                          ) : record.status === "verified" && record.record_source !== "admin_recorded" ? (
                                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${darkMode ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}>
                                              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                              Verified
                                            </span>
                                          ) : record.status === "rejected" ? (
                                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700"}`}>
                                              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                              Rejected
                                            </span>
                                          ) : (
                                            <span className={`font-bold ${record.status === "verified" ? "text-emerald-600" : record.status === "rejected" ? "text-red-600" : "text-amber-600"}`}>
                                              {record.record_source === "admin_recorded" ? "Admin-Recorded Payment" : record.status === "rejected" ? "Rejected" : "Awaiting verification"}
                                            </span>
                                          )}
                                        <span className={darkMode ? "text-slate-400" : "text-slate-500"}>{formatDateTimeToMMMDDYYYY(record.payment_date || record.recorded_at || record.verified_at || record.rejected_at || record.submitted_at)}</span>
                                      </div>
                                        <p className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                          {record.submitted_amount != null && <>Submitted: <strong className={changed ? "line-through decoration-2 decoration-slate-600" : ""}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(record.submitted_amount)}</span></strong></>}
                                        {record.verified_amount != null && <> · Verified: <strong><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(record.verified_amount)}</span></strong></>}
                                      </p>
                                      {changed && record.status === "verified" && !(record.discrepancies || []).some((discrepancy) => discrepancy.status !== "resolved") && <p className={`mt-2 rounded-lg border px-3 py-2.5 leading-5 ${darkMode ? "border-amber-700/60 bg-amber-950/40 text-amber-200" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                                        <span className="font-bold">Payment discrepancy · </span>Amount changed by <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Math.abs(Number(record.verified_amount) - Number(record.submitted_amount)))}</span> {Number(record.verified_amount) < Number(record.submitted_amount) ? "lower" : "higher"}.
                                        <span className="mt-1 block text-[11px]">Customer-reported <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(record.submitted_amount))}</span> · Admin-recorded <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(record.verified_amount))}</span> · Difference <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Math.abs(Number(record.verified_amount) - Number(record.submitted_amount)))}</span></span>
                                      </p>}
                                      {(record.discrepancies || []).map((discrepancy) => (
                                        <div key={discrepancy._id || discrepancy.detected_at} className={`mt-2 rounded-lg border px-3 py-2.5 leading-5 ${discrepancy.status === "resolved" ? darkMode ? "border-emerald-700/50 bg-emerald-950/30 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-800" : darkMode ? "border-amber-700/60 bg-amber-950/40 text-amber-200" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                                          <strong>Payment discrepancy · {String(discrepancy.status || "pending_review").replaceAll("_", " ")}</strong>
                                          <p className="mt-1">Customer-reported <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(discrepancy.customer_reported_amount)}</span> · Admin-recorded <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(discrepancy.admin_recorded_amount)}</span> · Difference <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(discrepancy.difference)}</span></p>
                                          {discrepancy.resolution_note && <p className="mt-1">Resolution note: {discrepancy.resolution_note}</p>}
                                        </div>
                                      ))}
                                      {record.downpayment_exception?.status === "approved" && (
                                        <div className={`mt-2 rounded-md border px-2 py-1.5 ${darkMode ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                                          <strong>Downpayment Exception Approved</strong>: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(record.downpayment_exception.accepted_amount)}</span> accepted; original requirement <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(record.downpayment_exception.required_amount)}</span>; shortfall at approval <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(record.downpayment_exception.shortfall)}</span>.
                                          {record.downpayment_exception.reason && <span className="block mt-1">Reason: {record.downpayment_exception.reason}</span>}
                                        </div>
                                      )}
                                      {record.downpayment_exception?.status === "pending" && (
                                        <p className="mt-1 font-bold text-sky-600">
                                          Awaiting Admin Approval. Proposed amount: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(record.downpayment_exception.accepted_amount)}</span>; original requirement: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(record.downpayment_exception.required_amount)}</span>; shortfall if accepted: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(record.downpayment_exception.shortfall)}</span>. Payment remains unverified.
                                        </p>
                                      )}
                                      {record.proof_file_url && (
                                        <div className={`mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${darkMode ? "border-slate-700 bg-slate-800/80" : "border-[#e2e7f0] bg-[#eef3ff]"}`}>
                                          <div className="flex min-w-0 items-start gap-2.5">
                                            {(/\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(record.proof_file_name || record.proof_file_url))
                                              ? <ImagePlus size={15} className={`mt-0.5 shrink-0 ${darkMode ? "text-sky-300" : "text-sky-700"}`} aria-hidden="true" />
                                              : <FileText size={15} className={`mt-0.5 shrink-0 ${darkMode ? "text-sky-300" : "text-sky-700"}`} aria-hidden="true" />}
                                            <div className="min-w-0">
                                              <p className={`break-all font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{record.proof_file_name || "Payment proof"}</p>
                                              {record.submitted_at && <p className={`mt-0.5 text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{formatDateTimeToMMMDDYYYY(record.submitted_at)}</p>}
                                            </div>
                                          </div>
                                          <button type="button" onClick={() => openCustomerPaymentProofPreview(record.proof_file_url, record.proof_file_name || "Payment proof")} className={`shrink-0 font-semibold underline underline-offset-2 ${darkMode ? "text-sky-300" : "text-blue-700"}`}>
                                            View proof
                                          </button>
                                        </div>
                                      )}
                                      {(record.supporting_documents || []).map((document) => (
                                        <div key={document._id} className={`mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${darkMode ? "border-slate-700 bg-slate-800/80" : "border-[#e2e7f0] bg-[#eef3ff]"}`}>
                                          <div className="flex min-w-0 items-start gap-2.5">
                                            {String(document.format || document.original_name || "").toLowerCase() === "pdf" || String(document.original_name || "").toLowerCase().endsWith(".pdf")
                                              ? <FileText size={15} className={`mt-0.5 shrink-0 ${darkMode ? "text-sky-300" : "text-sky-700"}`} aria-hidden="true" />
                                              : <ImagePlus size={15} className={`mt-0.5 shrink-0 ${darkMode ? "text-sky-300" : "text-sky-700"}`} aria-hidden="true" />}
                                            <div className="min-w-0">
                                            <p className={`break-all font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`} title={document.original_name}>
                                              Admin supporting document: {document.original_name}
                                            </p>
                                            {(document.uploaded_by_name || document.uploaded_by_role || document.uploaded_at) && <p className={`mt-0.5 text-[11px] ${darkMode ? "text-slate-400" : "text-slate-600"}`}>
                                              {document.uploaded_by_name || document.uploaded_by_role ? <>Uploaded by {[document.uploaded_by_name, document.uploaded_by_role ? `(${document.uploaded_by_role})` : ""].filter(Boolean).join(" ")}</> : null}{document.uploaded_at && <>{document.uploaded_by_name || document.uploaded_by_role ? " · " : ""}{formatDateTimeToMMMDDYYYY(document.uploaded_at)}</>}
                                            </p>}
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            disabled={Boolean(adminPaymentDocumentLoadingId)}
                                            onClick={() => viewAdminPaymentSupportingDocument(orderId, record._id, document)}
                                            className={`shrink-0 font-semibold underline underline-offset-2 disabled:cursor-wait disabled:opacity-60 ${darkMode ? "text-sky-300" : "text-blue-700"}`}
                                          >
                                            {adminPaymentDocumentLoadingId === String(document._id) ? "Loading..." : "View document"}
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                                </div>
                              )}
                            </section>
                          )}

                          {isOrderCancelled ? (
                            <div className={`mt-6 rounded-xl border px-4 py-3 text-sm font-semibold ${darkMode ? "border-red-900/60 bg-red-950/30 text-red-200" : "border-red-200 bg-red-50 text-red-700"}`}>
                              This order was cancelled. Payment and cancellation actions are unavailable.
                            </div>
                            ) : <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {isFullyPaid ? (
                              <div className={`rounded-xl border px-4 py-3 text-sm font-bold sm:col-span-2 ${darkMode ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                                <p>Payment is fully paid. No additional payment submission is needed.</p>
                                {lastPaymentProofUrl && (
                                  <button
                                    type="button"
                                    onClick={() => openCustomerPaymentProofPreview(lastPaymentProofUrl, paymentProofSubmission?.fileName || latestPaymentProof.fileName || "Payment proof")}
                                    className={`mt-2 inline-flex items-center gap-1.5 font-bold underline underline-offset-2 ${darkMode ? "text-emerald-200 hover:text-white" : "text-emerald-800 hover:text-emerald-950"}`}
                                  >
                                    <Paperclip size={14} aria-hidden="true" />
                                    View payment proof
                                  </button>
                                )}
                              </div>
                            ) : latestPaymentProof.status === "pending" ? (
                              <div className={`rounded-xl border px-4 py-3 text-sm font-medium sm:col-span-2 ${darkMode ? "border-sky-800 bg-sky-950/50 text-sky-200" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
                                <p>
                                  We've notified admin that you paid <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(paymentProofSubmission?.amount ?? latestPaymentProof.submittedAmount ?? order.payment_proof_amount ?? 0)}</span>. This is pending confirmation — we'll notify you here once it's verified.
                                </p>
                                <p className="mt-2 text-xs">
                                  Current remaining balance: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(balanceAmount)}</span>. You can submit another payment after this proof is confirmed.
                                </p>
                                {lastPaymentProofUrl && (
                                  <button
                                    type="button"
                                    onClick={() => openCustomerPaymentProofPreview(lastPaymentProofUrl, paymentProofSubmission?.fileName || latestPaymentProof.fileName || "Payment proof")}
                                    className={`mt-2 inline-flex items-center gap-1.5 font-bold underline underline-offset-2 ${darkMode ? "text-sky-200 hover:text-white" : "text-sky-800 hover:text-sky-950"}`}
                                  >
                                    <Paperclip size={14} aria-hidden="true" />
                                    View your last uploaded proof
                                  </button>
                                )}
                              </div>
                            ) : latestPaymentProof.status === "rejected" && paymentProofOpenOrderId !== orderId ? (
                              <div className={`rounded-xl border px-4 py-3 text-sm sm:col-span-2 ${darkMode ? "border-red-800 bg-red-950/40 text-red-200" : "border-red-200 bg-red-50 text-red-800"}`}>
                                <p className="font-bold">Payment proof rejected</p>
                                <p className="mt-1">{latestPaymentProof.adminReason || "Please review your payment details and submit a new proof."}</p>
                                {lastPaymentProofUrl && <button type="button" onClick={() => openCustomerPaymentProofPreview(lastPaymentProofUrl, paymentProofSubmission?.fileName || latestPaymentProof.fileName || "Payment proof")} className="mt-2 inline-flex items-center gap-1 font-bold underline underline-offset-2"><Paperclip size={14} />View rejected proof</button>}
                                <button
                                  type="button"
                                  onClick={() => handleOpenPaymentProofForm(orderId)}
                                  className={`mt-3 block w-full rounded-lg px-4 py-2.5 text-sm font-bold text-white transition sm:w-auto ${darkMode ? "bg-emerald-600 hover:bg-emerald-500" : "bg-emerald-700 hover:bg-emerald-800"}`}
                                >
                                  Submit new proof
                                </button>
                              </div>
                            ) : paymentProofOpenOrderId === orderId ? (
                              <div className={`sm:col-span-2 rounded-xl border p-4 sm:p-5 ${darkMode ? "border-slate-700 bg-slate-800/80" : "border-[#e9e1d4] bg-white"}`}>
                                <div className="grid w-full gap-3">
                                  <div className="w-full max-w-2xl">
                                    <label htmlFor={`payment-amount-${orderId}`} className={`mb-1.5 flex items-center gap-2 text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                                      Amount paid <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${darkMode ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-700"}`}>(required)</span>
                                    </label>
                                    <p className={`mb-2 text-xs leading-5 ${darkMode ? "text-sky-300" : "text-blue-700"}`}>
                                      {isDownpaymentCovered
                                        ? `${isFullPaymentTerms ? "Full payment complete" : "Downpayment covered"}. Remaining balance: ${formatRequiredPaymentAmount(balanceAmount)}. Enter any amount up to ${formatRequiredPaymentAmount(balanceAmount)}.`
                                        : `${isFullPaymentTerms ? "Full payment still due" : "Downpayment still due"}: ${formatRequiredPaymentAmount(downpaymentBalance)}. Submit at least this amount and no more than ${formatRequiredPaymentAmount(balanceAmount)}.`}
                                    </p>
                                    <input
                                      id={`payment-amount-${orderId}`}
                                      type="text"
                                      inputMode="decimal"
                                      value={paymentProofForm.amount}
                                      onChange={(event) => setPaymentProofForm((prev) => ({ ...prev, amount: formatCustomerPaymentAmountInput(event.target.value) }))}
                                      placeholder="₱0.00"
                                      className={`h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 ${darkMode ? "border-slate-600 bg-slate-900 text-white placeholder:text-slate-400" : "border-[#e9e1d4] bg-white text-slate-900 placeholder:text-slate-400"}`}
                                    />
                                    {isPaymentBelowRequired && (
                                      <div role="alert" className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5 ${darkMode ? "border-red-700/70 bg-red-950/35 text-red-200" : "border-red-200 bg-red-50 text-red-900"}`}>
                                        <AlertTriangle size={15} className={`mt-0.5 shrink-0 ${darkMode ? "text-red-400" : "text-red-600"}`} aria-hidden="true" />
                                        <p className="min-w-0 flex-1">
                                          This amount is below the required payment of <strong className={`font-extrabold ${darkMode ? "text-red-300" : "text-red-800"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(downpaymentBalance)}</span></strong> and cannot be submitted. Please contact us{paymentSupportContact ? <span className="mt-1 block sm:ml-1 sm:mt-0 sm:inline"> at <a href={paymentSupportContact.href} className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 font-bold no-underline align-middle transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-red-700 bg-red-900/50 text-red-200 hover:bg-red-900" : "border-red-200 bg-white/80 text-red-700 hover:bg-white"}`}><Phone size={14} className="mr-1.5 shrink-0" aria-hidden="true" />{paymentSupportContact.display}</a></span> : " to discuss payment options"}.
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                  <div className="w-full pt-1">
                                    <div className={`mb-2 flex items-center gap-2 text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                                      Payment proof <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${darkMode ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-700"}`}>(required)</span>
                                    </div>
                                    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
                                      <label
                                        htmlFor={`payment-proof-${orderId}`}
                                        className={`flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2 transition focus-within:ring-2 focus-within:ring-amber-500 ${darkMode ? "border-slate-600 bg-slate-900 hover:border-slate-500" : "border-[#e9e1d4] bg-[#faf8f4] hover:border-amber-400"}`}
                                      >
                                        <FileText size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
                                        <span className={`min-w-0 flex-1 truncate text-[11px] font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                                          {paymentProofForm.fileName || "Choose an image or PDF"}
                                        </span>
                                        <input
                                          id={`payment-proof-${orderId}`}
                                          type="file"
                                          accept="image/*,.pdf"
                                          onChange={handlePaymentProofFileChange}
                                          required
                                          className="sr-only"
                                        />
                                      </label>
                                      <div className="flex shrink-0 justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={requestClosePaymentProofForm}
                                          className={`inline-flex h-9 w-fit items-center justify-center rounded-lg border px-4 text-xs font-bold transition duration-150 hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500 hover:bg-slate-700 focus-visible:ring-offset-slate-800" : "border-[#e9e1d4] bg-white text-slate-800 hover:border-slate-300 hover:bg-[#faf8f4] focus-visible:ring-offset-white"}`}
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => submitPaymentProof(order)}
                                          disabled={paymentProofLoading || isPaymentBelowRequired}
                                          className="inline-flex h-9 w-fit items-center justify-center rounded-lg bg-emerald-700 px-4 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
                                        >
                                          {paymentProofLoading ? "Submitting..." : "Submit Payment Info"}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {paymentProofError && (
                                  <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{paymentProofError}</p>
                                )}

                              </div>
                            ) : (
                              isCustomerAcceptedContract ? (
                                <div className="col-span-full flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <p className={`text-xs font-medium leading-5 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                                    If you have already paid, submit your proof of payment here. ACGC will review and verify it.
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenPaymentProofForm(orderId)}
                                    className="inline-flex h-9 w-fit shrink-0 items-center justify-center rounded-lg bg-emerald-700 px-4 text-xs font-bold text-white transition hover:bg-emerald-800"
                                  >
                                    Submit Payment Proof
                                  </button>
                                </div>
                              ) : (
                                <div className="col-span-full flex flex-wrap items-center justify-end gap-3">
                                  <span className={`inline-flex items-center gap-2 text-xs font-semibold ${darkMode ? "text-sky-300" : "text-sky-700"}`}>
                                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${darkMode ? "bg-sky-400" : "bg-sky-600"}`} />
                                    Awaiting Contract Sign-off
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCancelRequest(order)}
                                    className={`inline-flex h-9 w-fit items-center justify-center rounded-lg border px-4 text-xs font-bold transition ${darkMode ? "border-red-500/60 bg-transparent text-red-400 hover:bg-red-500/10" : "border-red-500 bg-transparent text-red-600 hover:bg-red-50"}`}
                                  >
                                    Cancel request
                                  </button>
                                </div>
                              )
                            )}

                            {!isCustomerAcceptedContract && !showContractSignoffControls && (
                              <button
                                type="button"
                                onClick={() => handleCancelRequest(order)}
                                className={`inline-flex h-9 w-fit items-center justify-center rounded-lg border px-4 text-xs font-bold transition ${darkMode ? "border-red-500/60 bg-transparent text-red-400 hover:bg-red-500/10" : "border-red-500 bg-transparent text-red-600 hover:bg-red-50"}`}
                              >
                                Cancel request
                              </button>
                            )}
                          </div>}

                        </div>
                      )}
                    </div>
                  );
                })}

              </div>
            )}

            {!ordersLoading && !isMobile && (
              <div className={`mt-auto flex flex-wrap items-center justify-center gap-3 rounded-xl border px-3 py-2.5 ${darkMode ? "border-slate-700 bg-slate-800/90" : "border-slate-200 bg-white"}`}>
                <p className={`text-xs font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  Showing {filteredOrders.length ? pageStart + 1 : 0}-{Math.min(pageStart + ORDER_PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length} orders
                </p>
                <div className="flex items-center justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOrderPage((page) => Math.max(1, page - 1))}
                    disabled={safeOrderPage === 1 || filteredOrders.length === 0}
                    className={`h-8 rounded-lg px-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    Prev
                  </button>

                  {Array.from({ length: orderPageCount }, (_, index) => index + 1).map((pageNum) => (
                    <button
                      key={pageNum}
                      type="button"
                      onClick={() => setOrderPage(pageNum)}
                      aria-current={safeOrderPage === pageNum ? "page" : undefined}
                      className={`h-8 min-w-8 rounded-lg px-2 text-xs font-black transition ${safeOrderPage === pageNum
                        ? "bg-red-600 text-white shadow-sm shadow-red-200"
                        : darkMode
                          ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                    >
                      {pageNum}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setOrderPage((page) => Math.min(orderPageCount, page + 1))}
                    disabled={safeOrderPage === orderPageCount || filteredOrders.length === 0}
                    className={`h-8 rounded-lg px-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {cancelRequestModal.open && (
              <div className="customer-modal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
                <div className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <AlertTriangle size={22} />
                  </div>
                  <h3 className="mt-4 text-center text-xl font-black">Cancel request?</h3>
                  <p className={`mt-2 text-center text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                    This will mark the current order request as cancelled. You can still review it afterwards in your order list.
                  </p>
                  {willTriggerCancellationCooldown && (
                    <div role="alert" className={`mt-4 rounded-xl border p-3 text-left text-sm ${darkMode ? "border-red-500/40 bg-red-950/40 text-red-100" : "border-red-200 bg-red-50 text-red-800"}`}>
                      <p className="font-black">Security policy warning</p>
                      <p className="mt-1 leading-5">Proceeding will trigger a 7-day online ordering restriction under our security policy. During those 7 days, please visit our shop or contact us by phone to place an order.</p>
                    </div>
                  )}

                  <div className="mt-5">
                    <label htmlFor="customer-cancellation-reason" className="mb-2 block text-left text-sm font-bold">
                      Reason for cancellation <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      id="customer-cancellation-reason"
                      value={cancelRequestReason}
                      onChange={(event) => {
                        setCancelRequestReason(event.target.value);
                        if (cancelRequestReasonError) setCancelRequestReasonError("");
                      }}
                      rows={3}
                      maxLength={500}
                      placeholder="Tell us why you want to cancel this request..."
                      aria-invalid={Boolean(cancelRequestReasonError)}
                      aria-describedby={cancelRequestReasonError ? "customer-cancellation-reason-error" : undefined}
                      className={`w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-red-500/20 ${cancelRequestReasonError ? "border-red-500 focus:border-red-500" : darkMode ? "border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500 focus:border-red-400" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-red-500"}`}
                    />
                    {cancelRequestReasonError ? (
                      <p id="customer-cancellation-reason-error" className="mt-1.5 text-left text-xs font-medium text-red-600">{cancelRequestReasonError}</p>
                    ) : (
                      <p className={`mt-1.5 text-left text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Required · Up to 500 characters</p>
                    )}
                  </div>

                  <div className="mt-6 flex gap-3">
                    <button
                      type="button"
                      data-close-modal
                      onClick={requestCloseCancelRequest}
                      disabled={cancelRequestSubmitting}
                      className={`flex-1 rounded-xl px-4 py-3 text-sm font-black transition ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-slate-200 text-slate-700 hover:bg-slate-300"}`}
                    >
                      Keep request
                    </button>
                    <button
                      type="button"
                      onClick={confirmCancelRequest}
                      disabled={cancelRequestSubmitting}
                      className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {cancelRequestSubmitting ? "Cancelling..." : willTriggerCancellationCooldown ? "I understand, cancel" : "Confirm cancel"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {selectedOrderForModal && (
          <OrderTimelineModal
            key={selectedOrderForModal._id || selectedOrderForModal.id}
            order={selectedOrderForModal}
            darkMode={darkMode}
            onClose={() => {
              setSelectedOrderForModal(null);
              setTimelineNotificationTarget(null);
            }}
            getItemImage={getOrderItemImage}
            getItemDimension={getConfirmationItemDimensionText}
            fallbackImage={PRODUCT_IMAGE_PLACEHOLDER}
            notificationTarget={timelineNotificationTarget}
          />
        )}

        <ExtraChargeReceiptModal
          receipt={selectedExtraChargeReceipt}
          darkMode={darkMode}
          onClose={() => setSelectedExtraChargeReceipt(null)}
        />

        {reviewDetailsOrder && (
          <div className="customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="customer-review-details-title"
              className={`mobile-fullscreen-dialog flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
            >
              <header className={`flex items-start justify-between gap-4 border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                <div className="min-w-0">
                  <h2 id="customer-review-details-title" className="text-lg font-bold">Your product review</h2>
                  <p className={`mt-1 truncate text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    {reviewDetailsOrder.reviewProductName} · {reviewDetailsOrder.tracking || reviewDetailsOrder._id || reviewDetailsOrder.id || "Order"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewDetailsOrder(null)}
                  aria-label="Close review details"
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </header>

              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1" aria-label={`${Number(reviewDetailsOrder.review?.rating || 0)} out of 5 stars`}>
                    {renderRatingStars(reviewDetailsOrder.review?.rating, 20, darkMode)}
                    <span className={`ml-1 text-sm font-semibold ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                      {Number(reviewDetailsOrder.review?.rating || 0)}/5
                    </span>
                  </div>
                  <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    {reviewDetailsOrder.review?.submittedAt ? formatDateToMMMDDYYYY(reviewDetailsOrder.review.submittedAt) : "—"}
                  </span>
                </div>
                {reviewDetailsOrder.review?.title && <h3 className="text-base font-semibold">{reviewDetailsOrder.review.title}</h3>}
                <p className={`whitespace-pre-line break-words text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                  {reviewDetailsOrder.review?.comment || "No written feedback."}
                </p>
                {reviewDetailsOrder.review?.adminResponse && (
                  <section className={`rounded-xl border p-3.5 ${darkMode ? "border-slate-600 bg-slate-800" : "border-emerald-200 bg-emerald-50"}`}>
                    <h3 className={`text-sm font-bold ${darkMode ? "text-emerald-300" : "text-emerald-900"}`}>ACGC SERVICES</h3>
                    <p className={`mt-1.5 whitespace-pre-line break-words text-sm leading-6 ${darkMode ? "text-slate-100" : "text-slate-800"}`}>{reviewDetailsOrder.review.adminResponse}</p>
                  </section>
                )}
                <section>
                  <h3 className={`mb-2 text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>Photos</h3>
                  {(reviewDetailsOrder.review?.photos || []).length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {reviewDetailsOrder.review.photos.map((photo, index) => (
                        <button
                          key={`${photo}-${index}`}
                          type="button"
                          onClick={() => setReviewPhotoPreview({ url: ensureAbsoluteUrl(photo), index })}
                          aria-label={`Open review photo ${index + 1}`}
                          className={`aspect-square overflow-hidden rounded-lg border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}
                        >
                          <img src={ensureAbsoluteUrl(photo)} alt={`Review photo ${index + 1}`} className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className={`text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>No photos submitted.</p>
                  )}
                </section>
              </div>

              <footer className={`flex justify-end gap-2 border-t px-5 py-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
                <button
                  type="button"
                  onClick={() => setReviewDetailsOrder(null)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                >
                  Close
                </button>
                {canAccessCustomerRatings && isOrderReviewEditable(reviewDetailsOrder, reviewDetailsOrder.reviewItemIndex) && (
                  <button
                    type="button"
                    onClick={() => {
                      const order = reviewDetailsOrder;
                      setReviewDetailsOrder(null);
                      openCustomerReviewModal(order, order.reviewItemIndex);
                    }}
                    className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
                  >
                    Edit Review
                  </button>
                )}
              </footer>
            </section>
          </div>
        )}

        {reviewPhotoPreview && (
          <div role="dialog" aria-modal="true" aria-label={`Review photo ${reviewPhotoPreview.index + 1} preview`} className="fixed inset-0 z-[160] flex items-center justify-center bg-black/90 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewPhotoPreview(null); }}>
            <button type="button" onClick={() => setReviewPhotoPreview(null)} aria-label="Close image preview" className="absolute right-4 top-4 z-10 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"><X size={22} /></button>
            <img src={reviewPhotoPreview.url} alt={`Customer review photo ${reviewPhotoPreview.index + 1}`} className="max-h-[90dvh] max-w-[96vw] rounded-lg object-contain" />
          </div>
        )}

        {showCustomerReviewModal && canAccessCustomerRatings && selectedReviewOrder && (
          <div className="customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm">
            <div
              key={`${selectedReviewOrder._id || selectedReviewOrder.id}-${selectedReviewOrder.reviewItemIndex ?? "order"}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="customer-review-title"
              className={`mobile-fullscreen-dialog flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl shadow-2xl ${darkMode ? "bg-slate-900" : "bg-white"}`}
            >
              <div className={`flex items-center justify-between border-b px-5 py-3.5 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                <div>
                  <h2 id="customer-review-title" className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-950"}`}>
                    {batchReviewSession
                      ? `Product ${batchReviewSession.currentPosition + 1} of ${batchReviewSession.itemIndexes.length}`
                      : hasOrderReview(selectedReviewOrder) ? "Edit Review" : "Write a Review"}
                  </h2>
                  <p className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                    {batchReviewSession ? "Review each product in your batch order." : "Share your experience after your completed order."}
                  </p>
                  {selectedReviewOrder.reviewProductName && Array.isArray(selectedReviewOrder.items) && selectedReviewOrder.items.length > 1 && (
                    <p className={`mt-1 text-xs font-semibold ${darkMode ? "text-amber-300" : "text-amber-700"}`}>
                      Product: {selectedReviewOrder.reviewProductName}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={requestCloseCustomerReviewModal}
                  aria-label="Close review form"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-lg transition ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                <div className="space-y-2">
                  <p className={`text-sm font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>Overall Rating</p>
                  <div className="flex gap-2" role="group" aria-label="Overall rating">
                    {Array.from({ length: 5 }).map((_, index) => {
                      const value = index + 1;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => handleOrderReviewChange("rating", value)}
                          aria-label={`${value} star${value === 1 ? "" : "s"}`}
                          aria-pressed={orderReviewForm.rating === value}
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${orderReviewForm.rating >= value ? "text-amber-400" : darkMode ? "text-slate-500 hover:text-amber-400" : "text-slate-400 hover:text-amber-400"}`}
                        >
                          <Star size={18} fill="currentColor" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                  <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Choose 1 to 5 stars.</p>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-900"}`}>Quick topics</p>
                    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Quick review topics">
                      {ORDER_REVIEW_TOPICS.map((topic) => (
                        <button
                          key={topic.value}
                          type="button"
                          aria-pressed={selectedReviewTopics.includes(topic.value)}
                          onClick={() => handleReviewTopicToggle(topic)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                            selectedReviewTopics.includes(topic.value)
                              ? "border-red-600 bg-red-600 text-white"
                              : darkMode
                                ? "border-red-500/60 bg-slate-800 text-red-300 hover:bg-red-950/50"
                                : "border-red-300 bg-white text-red-700 hover:bg-red-50"
                          }`}
                        >
                          {topic.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="review-comment" className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-900"}`}>Review Comment</label>
                    <textarea
                      id="review-comment"
                      value={orderReviewForm.comment}
                      onChange={(e) => handleOrderReviewChange("comment", e.target.value)}
                      placeholder="Choose a topic or write about your experience..."
                      rows={5}
                      maxLength={500}
                      className={`mt-1.5 min-h-[160px] w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-red-500 ${darkMode ? "border-slate-700 bg-slate-800 text-white placeholder:text-slate-500" : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"}`}
                    />
                    <p className={`mt-1 flex justify-between text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      <span>Required. 10“500 characters.</span>
                      <span>{orderReviewForm.comment.length}/500</span>
                    </p>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <p className={`text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-900"}`}>Upload Photos <span className={`font-normal ${darkMode ? "text-slate-400" : "text-slate-500"}`}>(optional)</span></p>
                      <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{orderReviewForm.photos.length}/5</span>
                    </div>
                    <label
                      htmlFor="review-photos"
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3 transition focus-within:ring-2 focus-within:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-800 hover:border-slate-500" : "border-slate-300 bg-slate-50 hover:border-red-300 hover:bg-red-50/50"}`}
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${darkMode ? "bg-slate-700 text-red-300" : "bg-white text-red-600 shadow-sm"}`}>
                        <ImagePlus size={19} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-sm font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>Choose project photos</span>
                        <span className={`mt-0.5 block text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Select up to 5 images from your device</span>
                      </span>
                      <input
                        id="review-photos"
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={reviewPhotoUploading || reviewFormLoading || orderReviewForm.photos.length >= 5}
                        onChange={handleOrderReviewPhotoChange}
                        className="sr-only"
                      />
                    </label>
                    {reviewPhotoUploading && <p role="status" className="mt-2 text-xs font-semibold text-emerald-600">Uploading photos...</p>}
                    {orderReviewForm.photoPreviews.length > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {orderReviewForm.photoPreviews.map((src, index) => (
                          <div key={index} className="relative overflow-hidden rounded-lg border border-slate-200">
                            <img src={ensureAbsoluteUrl(src)} alt={`Preview ${index + 1}`} className="h-20 w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => handleRemoveReviewPhoto(index)}
                              aria-label={`Remove photo ${index + 1}`}
                              className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-700 shadow"
                            >
                              <X size={16} aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {reviewFormError && (
                  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{reviewFormError}</div>
                )}
              </div>
              <div className={`flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:justify-end ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-50"}`}>
                <button
                  type="button"
                  onClick={requestCloseCustomerReviewModal}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitCustomerReview}
                  disabled={reviewFormLoading || reviewPhotoUploading}
                  className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reviewFormLoading
                    ? "Submitting..."
                    : batchReviewSession
                      ? batchReviewSession.currentPosition < batchReviewSession.itemIndexes.length - 1
                        ? "Save & Next Product"
                        : "Save & Finish"
                      : hasOrderReview(selectedReviewOrder) ? "Update Review" : "Submit Review"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "cart" && canRequestOrders && (
          <div className={`flex min-h-0 flex-1 flex-col rounded-2xl border p-4 shadow-sm sm:p-6 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
            <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className={`text-xs font-bold uppercase tracking-[0.16em] ${darkMode ? "text-red-300" : "text-red-700"}`}>Your order</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h2 className={`text-2xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Shopping Cart</h2>
                  {onlineOrderCooldownActive && (
                    <div role="alert" className={`inline-flex max-w-full items-start gap-2 rounded-xl border px-3 py-2 text-xs font-medium leading-5 ${darkMode ? "border-rose-500/50 bg-rose-950/35 text-rose-100" : "border-rose-300 bg-rose-50 text-rose-900"}`}>
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{renderAdminContactMessage(onlineOrderCooldownMessage)}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className={`inline-flex w-fit shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold ${darkMode ? "bg-slate-800 text-slate-200" : "bg-slate-100 text-slate-700"}`}>
                <ShoppingCart size={16} aria-hidden="true" />
                <span>{cartQuantity} item{cartQuantity === 1 ? "" : "s"}</span>
              </div>
            </div>
            {cartActionError && (
              <div role="alert" className={`mt-4 rounded-xl border px-3 py-2.5 text-sm ${darkMode ? "border-amber-700 bg-amber-950/40 text-amber-200" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                {cartActionError}
              </div>
            )}
            {!cartLoaded ? (
              <div className="mt-5 grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px] xl:gap-6" aria-live="polite" aria-busy="true">
                <section className="flex min-h-0 min-w-0 flex-col">
                  <div className={`flex min-h-[53px] items-center border-b pb-4 text-sm font-semibold ${darkMode ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}>
                    Loading your cart...
                  </div>
                  <div className={`mt-1 flex h-[min(560px,60dvh)] flex-none items-center justify-center rounded-lg ${darkMode ? "bg-slate-800/50 text-slate-400" : "bg-slate-50 text-slate-500"}`}>
                    <span className="animate-pulse text-sm">Retrieving saved items</span>
                  </div>
                </section>
                <aside className={`min-h-[220px] rounded-2xl border p-5 ${darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50"}`} aria-hidden="true">
                  <div className={`h-5 w-32 animate-pulse rounded ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                  <div className={`mt-6 h-4 animate-pulse rounded ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                  <div className={`mt-4 h-10 animate-pulse rounded ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                  <div className={`mt-5 h-11 animate-pulse rounded ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                </aside>
              </div>
            ) : cartItems.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center py-12 text-center">
                <span className={`flex h-14 w-14 items-center justify-center rounded-full ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                  <ShoppingCart size={24} aria-hidden="true" />
                </span>
                <h3 className={`mt-4 text-lg font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Your cart is empty</h3>
                <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Browse products and add something to get started.</p>
                <button
                  type="button"
                  onClick={() => setActiveTab("products")}
                  className="mt-5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  Browse Products
                </button>
              </div>
            ) : (<>
              <div className="mt-5 grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_280px] xl:gap-6">
                <section className="flex min-w-0 flex-col lg:min-h-0">
                  <div className={`flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <label className={`inline-flex items-center gap-3 text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => handleSelectAllCartItems(e.target.checked)}
                        className="h-5 w-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      Select All ({cartItems.length} Item{cartItems.length === 1 ? "" : "s"})
                    </label>
                    <div className={`text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      {selectedItemCount} of {cartItems.length} selected
                    </div>
                  </div>

                  <div
                    className={`mt-1 divide-y overflow-x-hidden ${darkMode ? "divide-slate-700" : "divide-slate-200"} lg:h-[min(560px,60dvh)] lg:flex-none lg:overflow-y-auto lg:pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400 hover:[&::-webkit-scrollbar-thumb]:bg-slate-500 dark:[&::-webkit-scrollbar-track]:bg-slate-700 dark:[&::-webkit-scrollbar-thumb]:bg-slate-500 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-400`}
                    style={{ scrollbarWidth: "thin", scrollbarColor: darkMode ? "#64748b #334155" : "#94a3b8 #e2e8f0" }}
                  >
                    {cartItems.map((item) => (
                      <article key={item.cartId || item._id || item.name} className="grid grid-cols-[auto_64px_minmax(0,1fr)] items-center gap-3 py-4 sm:grid-cols-[auto_72px_minmax(0,1fr)_auto] sm:gap-4">
                        <input
                          type="checkbox"
                          checked={Boolean(item.selected)}
                          onChange={() => handleToggleCartItem(item.cartId)}
                          aria-label={`Select ${item.name || "item"}`}
                          className="h-5 w-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        <div className={`h-16 w-16 overflow-hidden rounded-xl border sm:h-[72px] sm:w-[72px] ${darkMode ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-slate-100"}`}>
                          <img src={getProductImage(item, 240) || PRODUCT_IMAGE_PLACEHOLDER} alt={item.name} width="240" height="240" loading="lazy" decoding="async" onError={handleProductImageError} className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                            <p className={`min-w-0 truncate font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>{item.name}</p>
                            <p className="text-sm font-bold text-red-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(getItemPriceValue(item))}</span></p>
                          </div>
                          {(() => {
                            const measurementDetails = getCartItemMeasurementDetails(item);
                            if (measurementDetails) {
                              return (
                                <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                  <span>{measurementDetails.dimensions} · {measurementDetails.area}</span>
                                  {!item.is_estimate && <span>{measurementDetails.unitRate}</span>}
                                </div>
                              );
                            }

                            return (
                              <div className={`mt-1 flex flex-wrap items-center gap-3 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                {item.is_estimate && item.width && item.height && (
                                  <span>{item.width} {item.measurementUnit || item.unit || ""} x {item.height} {item.measurementUnit || item.unit || ""}</span>
                                )}
                              </div>
                            );
                          })()}
                          {getCartBladePriceBreakdown(item).map((line, index) => (
                            <p key={`${item.cartId || item._id || item.name}-price-${index}`} className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-600"}`}>
                              {line}
                            </p>
                          ))}
                          {item.is_estimate && (
                            <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${darkMode ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-700"}`}>
                              Estimated price
                            </span>
                          )}
                        </div>
                        <div className="col-span-3 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
                          <span className={`inline-flex shrink-0 items-center rounded-lg border px-2 py-1 text-xs font-bold ${darkMode ? "border-blue-800 bg-blue-950/60 text-blue-200" : "border-blue-200 bg-blue-50 text-blue-800"}`}>Quantity: {item.quantity || 1}x</span>
                          <div className={`inline-flex items-center overflow-hidden rounded-lg border ${darkMode ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-white"}`}>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQuantity(item.cartId, -1)}
                              aria-label={`Decrease ${item.name || "item"} quantity`}
                              className={`inline-flex h-9 w-9 items-center justify-center transition ${darkMode ? "text-slate-200 hover:bg-slate-700" : "text-slate-700 hover:bg-slate-100"}`}
                            >
                              <Minus size={15} />
                            </button>
                            <div className={`min-w-9 text-center text-sm font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                              {item.quantity}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQuantity(item.cartId, 1)}
                              aria-label={`Increase ${item.name || "item"} quantity`}
                              className={`inline-flex h-9 w-9 items-center justify-center transition ${darkMode ? "text-slate-200 hover:bg-slate-700" : "text-slate-700 hover:bg-slate-100"}`}
                            >
                              <Plus size={15} />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromCart(item.cartId)}
                            aria-label={`Remove ${item.name || "item"} from cart`}
                            title="Remove item"
                            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${darkMode ? "border-red-900/70 text-red-300 hover:bg-red-950/50" : "border-red-200 text-red-600 hover:bg-red-50"}`}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <aside className={`self-start rounded-2xl border p-4 shadow-lg sm:p-5 lg:sticky lg:top-24 lg:shadow-none ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                  <h3 className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Order Summary</h3>

                  <div className={`mt-4 flex items-center justify-between gap-4 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                    <span>{selectedItemCount} selected · {selectedQuantityTotal} total</span>
                    <span><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(selectedSubtotal)}</span></span>
                  </div>
                  <div className={`mt-3 border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                    <div className={`flex items-center justify-between gap-4 font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                      <span>Estimated total</span>
                      <span className="text-lg font-bold text-red-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(selectedSubtotal)}</span></span>
                    </div>
                    <div className={`mt-2 flex items-center justify-between gap-4 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      <span>50% downpayment</span>
                      <span><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(selectedSubtotal * 0.5)}</span></span>
                    </div>
                  </div>

                  <div className="mt-5 space-y-2.5">
                    <button
                      type="button"
                      onClick={openBatchOrderModal}
                      disabled={onlineOrderCooldownActive || checkoutLoading || selectedItemCount === 0}
                      className="w-full rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Checkout Selected ({selectedItemCount})
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelectedItems}
                      disabled={selectedItemCount === 0}
                      className={`w-full rounded-lg border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-red-900 text-red-300 hover:bg-red-950/40" : "border-red-200 text-red-700 hover:bg-red-50"}`}
                    >
                      Delete Selected ({selectedItemCount})
                    </button>
                  </div>
                </aside>
              </div>

              {checkoutError && <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">{checkoutError}</div>}
              {checkoutMessage && <div role="status" aria-live="polite" className={`mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 transition-opacity duration-500 ease-out motion-reduce:transition-none ${checkoutMessageFading ? "opacity-0" : "opacity-100"}`}>{checkoutMessage}</div>}
            </>) }
          </div>
        )}

        {activeTab === "about" && (
          <AboutBusinessContent darkMode={darkMode} />
        )}
        {activeTab === "notifications" && (
          <>
            <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className={`text-2xl font-black ${darkMode ? "text-white" : "text-slate-950"}`}>Notifications</h2>
                <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Stay updated on your orders and project status.</p>
              </div>
              <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${unreadNotificationCount ? darkMode ? "bg-red-950/60 text-red-300" : "bg-red-50 text-red-700" : darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
                {unreadNotificationCount} unread
              </span>
            </div>

            <div className={`mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border p-1 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-100"}`} role="group" aria-label="Filter notifications">
              {[
                ["all", "All", customerNotificationItems.length],
                ["unread", "Unread", unreadNotificationCount],
                ["read", "Read", readNotificationCount],
              ].map(([filter, label, count]) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => { setNotificationFilter(filter); setNotificationPage(1); }}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:px-4 sm:text-sm ${
                    notificationFilter === filter
                      ? darkMode
                        ? "bg-slate-950 text-white shadow-sm"
                        : "bg-white text-slate-950 shadow-sm"
                      : darkMode
                        ? "text-slate-300 hover:bg-slate-700"
                        : "text-slate-600 hover:bg-white/70"
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>

            {ordersLoading ? (
              <div className="space-y-2.5 sm:space-y-3" aria-label="Loading notifications">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className={`h-24 animate-pulse rounded-2xl border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`} />
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className={`flex flex-col items-center rounded-2xl border border-dashed px-5 py-12 text-center ${darkMode ? "border-slate-700 bg-slate-800/50 text-slate-200" : "border-slate-200 bg-white text-slate-600"}`}>
                <span className={`flex h-11 w-11 items-center justify-center rounded-full ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"}`}><Bell size={19} /></span>
                <p className="mt-3 text-sm font-semibold">{notificationFilter === "all" ? "No notifications yet" : `No ${notificationFilter} notifications`}</p>
                <p className={`mt-1 text-xs ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Updates about your orders will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {paginatedCustomerNotifications.map((order) => {
                    const product = order.items?.[0] || {};
                    const isRead = readNotificationIds.has(order.notificationId);
                    const status = normalizeOrderStatusKey(order?.status);
                    const contractStatus = normalizeOrderStatusKey(order?.contract_status);
                    const isReviewReadyNotification = order.notificationType === "product_ready_for_review";
                    const isPaymentNotification = ["payment", "payment_confirmed", "payment_amount_updated", "payment_rejected", "admin_payment_recorded", "downpayment_exception_approved", "downpayment_exception_pending", "payment_discrepancy", "payment_discrepancy_resolved", "overdue_payment", "installation_payment_reminder"].includes(order.notificationType);
                    const notificationStatusLabel = isReviewReadyNotification ? "Ready to Review" : order.notificationType === "overdue_payment" ? "Payment Due" : order.notificationType === "project_delay" ? order.delayStatus : null;
                      const isPaymentConfirmationNotification = ["payment_confirmed", "payment_amount_updated", "admin_payment_recorded", "downpayment_exception_approved"].includes(order.notificationType);
                    const isDelayNotification = ["delay", "project_delay"].includes(order.notificationType);
                      const isInstallationNotification = ["installation_up_next", "installation_completed"].includes(order.notificationType);
                    const isSiteInspectionNotification = order.notificationType === "site_inspection_today";
                    const isCancellationCooldownNotification = order.notificationType === "order_cancellation_cooldown";
                    const isCancellationWarningNotification = order.notificationType === "order_cancellation_warning";
                    const isCancellationPolicyNotification = isCancellationCooldownNotification || isCancellationWarningNotification;
                    const isContractReady =
                      status === "contract_sent" ||
                      (status === "site_inspection" && contractStatus === "sent") ||
                      contractStatus === "sent";
                    const isContractNotification = !isPaymentNotification && !isDelayNotification && !isInstallationNotification && !isSiteInspectionNotification && (
                      order.notificationType === "contract" ||
                      isContractReady ||
                      status === "contract_accepted" ||
                      contractStatus === "accepted"
                    );
                    const notificationMessage = () => {
                      if (isReviewReadyNotification) return `${order.reviewProductName || product.name || "Your product"} is complete. Share your feedback about this product.`;
                              if (["extra_charge_receipt_sent", "project_payment_receipt_sent"].includes(order.notificationType)) {
                                return "Your order receipt has been sent successfully. Your project balance is fully paid. You can now view and download your receipt.";
                              }
                      if (order.notificationType === "feedback_response") return order.message;
                      if (order.notificationType === "repair_request") return order.message;
                      if (isSiteInspectionNotification) {
                        return order.message || `Your site inspection for order ${order.tracking} is scheduled for ${formatDateToMMMDDYYYY(order.inspection_date)}.`;
                      }
                      if (isCancellationPolicyNotification) return withAdminContactPhone(order.message || "Reaching 3 cancellations will restrict online ordering for 7 days. Please visit our shop or contact us by phone during any restriction.");
                      if (["overdue_payment", "installation_payment_reminder"].includes(order.notificationType)) return order.message;
                      if (order.notificationType === "installation_up_next") {
                        return order.message || "Your ACGC order is up next for installation. Our team will begin the installation stage soon. Please stay tuned for updates.";
                      }
                      if (order.notificationType === "installation_completed") {
                        return order.message || "The installation for your ACGC order has been completed. Thank you for choosing ACGC Aluminum Services!";
                      }
                      if (order.notificationType === "transaction_approved") {
                        return `Your accepted contract for ${order.tracking} was approved. Your project is now eligible for progress monitoring.`;
                      }
                      if (isDelayNotification) return getDelayNotificationMessage(order);
                      if (isPaymentNotification) {
                        if (["payment_discrepancy", "payment_discrepancy_resolved"].includes(order.notificationType)) {
                          const discrepancy = order.paymentDiscrepancy || {};
                          const resolved = order.notificationType === "payment_discrepancy_resolved";
                          return `Customer-reported ${formatCurrency(discrepancy.customer_reported_amount)}; admin-recorded ${formatCurrency(discrepancy.admin_recorded_amount)}; difference ${formatCurrency(discrepancy.difference)}. Status: ${resolved ? "resolved" : String(discrepancy.status || "pending review").replaceAll("_", " ")}.`;
                        }
                        if (order.notificationType === "admin_payment_recorded") {
                          return `Our team recorded ${formatCurrency(order.paymentRecord?.verified_amount)} for order ${order.tracking}. Payment status: ${getPaymentSummary(order).status.label}. Remaining project balance: ${formatCurrency(getPaymentSummary(order).remainingAmount)}.`;
                        }
                        if (["downpayment_exception_approved", "downpayment_exception_pending"].includes(order.notificationType)) {
                          const exception = order.paymentRecord?.downpayment_exception || {};
                          return order.notificationType === "downpayment_exception_approved"
                            ? `The admin approved accepting ${formatCurrency(exception.accepted_amount)} below the required downpayment. Payment status: ${getPaymentSummary(order).status.label}. Remaining balance: ${formatCurrency(getPaymentSummary(order).remainingAmount)}. ${exception.reason || ""}`
                            : `An exception was requested for ${formatCurrency(exception.accepted_amount)} against the required downpayment of ${formatCurrency(exception.required_amount)}. Shortfall if accepted: ${formatCurrency(exception.shortfall)}. Remaining project balance: ${formatCurrency(getPaymentSummary(order).remainingAmount)}. This payment is not verified yet.`;
                        }
                        if (order.notificationType === "payment_amount_updated") {
                          const adjustment = order.paymentAdjustment || {};
                          const difference = (Number(adjustment.new_amount) || 0) - (Number(adjustment.previous_amount) || 0);
                          return `Submitted ${formatCurrency(adjustment.previous_amount)}; verified ${formatCurrency(adjustment.new_amount)} (${difference < 0 ? "lower" : "higher"} by ${formatCurrency(Math.abs(difference))}). ${adjustment.reason || ""}`;
                        }
                        if (order.notificationType === "payment_rejected") {
                          return order.paymentRecord?.admin_reason || "Your payment proof was rejected. Review the payment details and submit a new proof when ready.";
                        }
                        if (isPaymentConfirmationNotification) {
                          return `Your payment of ${formatCurrency(order.paymentRecord?.verified_amount ?? order.payment_proof_amount)} has been confirmed by our team.`;
                        }
                        return `Your payment proof for ${formatCurrency(order.paymentRecord?.submitted_amount ?? order.payment_proof_amount)} has been sent for confirmation.`;
                      }
                      if (isContractReady) {
                        return "A contract has been sent for your review and acceptance.";
                      }

                      return getCustomerOrderNotificationMessage(order);
                    };
                    const paymentNotificationTitle = {
                      payment: "Payment proof submitted",
                      payment_confirmed: "Payment confirmed",
                      payment_amount_updated: "Payment Amount Updated",
                      payment_discrepancy: "Payment Amount Discrepancy",
                      payment_discrepancy_resolved: "Payment Discrepancy Resolved",
                      payment_rejected: "Payment Proof Rejected",
                      admin_payment_recorded: "Payment Recorded by Admin",
                      downpayment_exception_approved: "Downpayment Exception Approved",
                      downpayment_exception_pending: "Awaiting Admin Approval",
                      transaction_approved: "Transaction approved",
                      installation_up_next: "Installation Coming Up",
                      installation_completed: "Installation Completed",
                      site_inspection_today: "Site Inspection Scheduled for Today",
                      overdue_payment: "Remaining Balance",
                      installation_payment_reminder: "Upcoming Payment Reminder",
                      order_cancellation_warning: "Cancellation Policy Reminder",
                      order_cancellation_cooldown: "7-Day Online Ordering Restriction",
                    }[order.notificationType];

                    const notificationIcon = () => {
                      if (isReviewReadyNotification) return "text-amber-600";
                      if (order.notificationType === "payment_rejected" || isCancellationCooldownNotification) return "text-red-600";
                      if (order.notificationType === "overdue_payment") return "text-red-600";
                      if (order.notificationType === "installation_payment_reminder") return "text-amber-600";
                      if (isCancellationWarningNotification) return "text-amber-600";
                      if (order.notificationType === "payment_amount_updated") return "text-amber-600";
                      if (order.notificationType === "payment_discrepancy") return "text-amber-600";
                      if (order.notificationType === "payment_discrepancy_resolved") return "text-emerald-600";
                      if (["downpayment_exception_approved", "downpayment_exception_pending"].includes(order.notificationType)) return "text-amber-600";
                      if (order.notificationType === "installation_up_next") return "text-blue-600";
                      if (isSiteInspectionNotification) return "text-blue-600";
                      if (order.notificationType === "installation_completed") return "text-emerald-600";
                      if (isPaymentNotification) return "text-emerald-600";
                      if (normalizeOrderStatusKey(order?.status) === "completed") return "text-emerald-600";
                      if (normalizeOrderStatusKey(order?.status) === "cancelled") return "text-red-600";
                      if (isContractReady || ["contract_sent", "contract_accepted"].includes(status) || ["sent", "accepted"].includes(contractStatus)) return "text-blue-600";
                      return "text-amber-600";
                    };

                    return (
                      <article
                        key={order.notificationId}
                        className={`rounded-2xl border p-3 shadow-sm transition-colors sm:p-4 ${
                          isRead
                            ? darkMode ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-white"
                            : darkMode ? "border-red-400/50 bg-slate-800/90" : "border-red-300/80 bg-red-50/40"
                        }`}
                      >
                        <div className="flex gap-2.5 sm:gap-3">
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${darkMode ? "bg-slate-700" : "bg-slate-100"} ${notificationIcon()}`}>
                              {isReviewReadyNotification ? <Star size={16} /> : isPaymentNotification ? <CreditCard size={16} /> : isDelayNotification || isCancellationPolicyNotification ? <AlertTriangle size={16} /> : isSiteInspectionNotification || isInstallationNotification ? <CalendarDays size={16} /> : isContractNotification ? <FileText size={16} /> : status === "completed" ? <CheckCircle size={16} /> : <Bell size={16} />}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className={`text-sm font-bold break-words ${darkMode ? "text-white" : "text-slate-950"}`}>{["extra_charge_receipt_sent", "project_payment_receipt_sent"].includes(order.notificationType) ? "Your Order Receipt" : order.notificationType === "overdue_payment" ? "Remaining Balance" : order.title || paymentNotificationTitle || (isInstallationNotification ? ({ installation_up_next: "Installation Coming Up", installation_completed: "Installation Completed" }[order.notificationType]) : null) || product.name || "Project Update"}</h3>
                                  {!isRead && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase text-red-700">New</span>}
                                </div>
                                <p className={`mt-1 text-xs leading-4 ${isRead ? darkMode ? "text-slate-400" : "text-slate-500" : darkMode ? "text-slate-200" : "text-slate-700"}`}>{renderAdminContactMessage(notificationMessage())}</p>
                                <p className={`mt-1.5 text-[10px] font-medium uppercase tracking-wide ${darkMode ? "text-slate-500" : "text-slate-400"}`}>{order.tracking}</p>
                              </div>
                      <span className={`inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-semibold sm:text-xs ${getOrderStatusClasses(notificationStatusLabel || (order.notificationType === "repair_request" ? order.repairProgressStatus : isDelayNotification ? "Delayed" : order.status))}`}>
                                {notificationStatusLabel || (order.notificationType === "repair_request" ? order.repairProgressStatus : isDelayNotification ? "Delayed" : getOrderStatusLabel(order.status))}
                              </span>
                            </div>

                            <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-100 text-slate-500"}`}>
                              <span className={isRead ? "text-slate-400" : darkMode ? "font-medium text-slate-300" : "font-medium text-slate-600"} title={formatDateTimeToMMMDDYYYY(order.notificationDate) || undefined}>
                                {formatTimeAgo(order.notificationDate)}
                              </span>
                              <button
                                onClick={() => {
                                  openOrderDetailsFromNotification(order, order);
                                  setNotificationsOpen(false);
                                }}
                                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "text-red-300 hover:bg-red-950/40" : "text-red-700 hover:bg-red-50"}`}
                              >
                                {isReviewReadyNotification ? "Review Product" : order.notificationType === "repair_request" ? "View Repair" : "View Order"}
                                <ArrowUpRight size={14} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                {notificationTotalPages > 1 && <div className={`flex flex-col items-center justify-between gap-3 border-t pt-4 sm:flex-row ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Showing {(currentNotificationPage - 1) * notificationPageSize + 1}“{Math.min(currentNotificationPage * notificationPageSize, sortedFilteredNotifications.length)} of {sortedFilteredNotifications.length}</span>
                  <nav className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Notification pages">
                    <button type="button" onClick={() => setNotificationPage((page) => Math.max(1, page - 1))} disabled={currentNotificationPage === 1} aria-label="Previous notifications page" className={`inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}><ChevronLeft size={14} />Previous</button>
                    {Array.from({ length: notificationTotalPages }, (_, index) => index + 1).map((page) => <button key={page} type="button" onClick={() => setNotificationPage(page)} aria-current={currentNotificationPage === page ? "page" : undefined} aria-label={`Notification page ${page}`} className={`h-9 min-w-9 rounded-lg border px-2.5 text-xs font-semibold ${currentNotificationPage === page ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{page}</button>)}
                    <button type="button" onClick={() => setNotificationPage((page) => Math.min(notificationTotalPages, page + 1))} disabled={currentNotificationPage === notificationTotalPages} aria-label="Next notifications page" className={`inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>Next<ChevronRight size={14} /></button>
                  </nav>
                </div>}
              </div>
            )}
          </>
        )}

        {activeTab === "profile" && (
          <>
          <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
            <section className={`overflow-hidden rounded-[18px] border ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-950"}`}>
              <div
                aria-hidden="true"
                className={`h-[84px] border-b ${darkMode ? "border-slate-700 bg-brand-dark-fill/10" : "border-slate-200 bg-brand/[0.07]"}`}
              />
              <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-5 sm:gap-4 sm:px-6 sm:pb-6">
                <div className="flex min-w-0 flex-1 items-end gap-4">
                  <ProfileAvatar
                    name={profileDisplayName}
                    avatarOnly
                    size="profile"
                    className={`-mt-[42px] border-4 ${darkMode ? "border-slate-800" : "border-white"}`}
                  />
                  <div className="min-w-0 pb-1">
                    <h1 className="truncate text-2xl font-medium">{profileDisplayName}</h1>
                    <p className={`truncate text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{profileEmail || "Email not set"}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => setProfileEditing(true)}
                  variant="outline"
                  size="lg"
                  className={`h-10 w-full shrink-0 gap-2 rounded-[10px] border px-4 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:w-auto ${darkMode ? "border-slate-600 bg-slate-900 text-slate-200 hover:border-brand-dark-text hover:bg-slate-700 hover:text-brand-dark-text" : "border-slate-300 bg-white text-slate-700 hover:border-brand hover:text-brand"}`}
                >
                  <User size={16} aria-hidden="true" />
                  Edit profile
                </Button>
              </div>
            </section>

            <div className="mt-4 grid grid-cols-1 gap-4 min-[640px]:grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
            <button
              type="button"
              onClick={() => {
                setTrackingNumber("");
                setOrderFilter("all");
                setOrderPage(1);
                setActiveTab("orders");
              }}
              className={`group flex w-full min-w-0 items-center gap-4 rounded-2xl border px-5 py-4.5 text-left transition-all motion-reduce:transition-none hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 ${darkMode ? "border-sky-500/25 bg-slate-800 text-slate-100 hover:border-sky-400/50" : "border-sky-100 bg-white text-slate-900 hover:border-sky-300"}`}
            >
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-sky-500/15 text-sky-300" : "bg-sky-50 text-sky-700"}`}>
                <ClipboardList size={23} strokeWidth={2.2} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-medium">My Orders</span>
                <span className={`mt-0.5 block text-sm ${darkMode ? "text-sky-200/80" : "text-slate-500"}`}>{activeOrdersCount} active</span>
              </span>
              <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-full border transition-colors motion-reduce:transition-none group-hover:bg-sky-600 group-hover:text-white ${darkMode ? "border-sky-500/30 text-sky-300 group-hover:border-sky-600" : "border-sky-200 text-sky-700 group-hover:border-sky-600"}`}>
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setContractHistoryTab("accepted");
                setWarrantyHistoryTab(null);
                setActiveTab("contracts");
              }}
              className={`group flex w-full min-w-0 items-center gap-4 rounded-2xl border px-5 py-4.5 text-left transition-all motion-reduce:transition-none hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 ${darkMode ? "border-emerald-500/25 bg-slate-800 text-slate-100 hover:border-emerald-400/50" : "border-emerald-100 bg-white text-slate-900 hover:border-emerald-300"}`}
            >
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}>
                <FileText size={23} strokeWidth={2.2} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-medium">Contracts</span>
                <span className={`mt-0.5 block text-sm ${darkMode ? "text-emerald-200/80" : "text-slate-500"}`}>{customerContracts.length} active</span>
              </span>
              <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-full border transition-colors motion-reduce:transition-none group-hover:bg-emerald-600 group-hover:text-white ${darkMode ? "border-emerald-500/30 text-emerald-300 group-hover:border-emerald-600" : "border-emerald-200 text-emerald-700 group-hover:border-emerald-600"}`}>
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("about")}
              className={`group flex w-full min-w-0 items-center gap-4 rounded-2xl border px-5 py-4.5 text-left transition-all motion-reduce:transition-none hover:-translate-y-0.5 hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 lg:hidden ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
            >
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-brand-dark-fill/15 text-brand-dark-text" : "bg-brand/[0.08] text-brand"}`}>
                <Info size={22} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-medium">About Us</span>
                <span className={`mt-0.5 block text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>About ACGC Glass &amp; Aluminum Services</span>
              </span>
              <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-full border transition-colors motion-reduce:transition-none group-hover:border-brand group-hover:bg-brand group-hover:text-white ${darkMode ? "border-slate-600 text-slate-400" : "border-slate-200 text-slate-500"}`}>
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </button>
            </div>

            <section className={`mt-6 overflow-hidden rounded-2xl border ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`} aria-labelledby="customer-recent-orders-title">
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                <div>
                  <h2 id="customer-recent-orders-title" className={`text-lg font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Recent Orders</h2>
                  <p className={`mt-0.5 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Your latest order activity</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTrackingNumber("");
                    setOrderFilter("all");
                    setOrderPage(1);
                    setActiveTab("orders");
                  }}
                  className={`inline-flex items-center gap-1 text-sm font-semibold transition-colors ${darkMode ? "text-red-300 hover:text-white" : "text-brand hover:text-red-900"}`}
                >
                  View all <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-3 p-3 sm:p-4">
                {ordersLoading ? (
                  [...Array(3)].map((_, index) => (
                    <div key={index} className={`h-[72px] animate-pulse rounded-xl border ${darkMode ? "border-slate-700 bg-slate-700/50" : "border-slate-200 bg-slate-100"}`} />
                  ))
                ) : recentOrders.length === 0 ? (
                  <div className={`rounded-xl border border-dashed px-5 py-8 text-center ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-300 bg-slate-50"}`}>
                    <p className={`font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>No orders yet</p>
                    <p className={`mt-1 text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Your recent orders will appear here.</p>
                  </div>
                ) : (
                  recentOrders.map((order, index) => {
                    const orderId = getOrderIdentifier(order, `recent-order-${index}`);
                    const orderItems = Array.isArray(order.items) ? order.items : [];
                    const product = orderItems[0] || {};
                    const isBatchOrder = orderItems.length > 1;
                    const orderDisplayName = isBatchOrder ? "Batch Order" : product.name || product.product_name || "Project item";
                    const orderDisplayQuantity = isBatchOrder ? `${orderItems.length} items` : `Quantity: ${product.quantity || 1}x`;
                    const orderPreviewItem = isBatchOrder
                      ? orderItems.find((item) => getOrderItemImage(item) !== PRODUCT_IMAGE_PLACEHOLDER) || product
                      : product;
                    const orderDate = formatDateToMMMDDYYYY(order.updatedAt || order.createdAt) || "—";

                    return (
                      <div
                        key={orderId}
                        data-notification-record-id={orderId}
                        className={`overflow-hidden rounded-xl border shadow-sm transition hover:shadow-md ${highlightedOrderId === orderId ? "notification-target-highlight" : darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}
                      >
                        <div className="grid gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className={`h-11 w-11 shrink-0 overflow-hidden rounded-[12px] border shadow-sm sm:h-12 sm:w-12 ${darkMode ? "border-slate-600 bg-slate-700" : "border-red-100 bg-red-50"}`}>
                              <img
                                src={getOrderItemImage(orderPreviewItem)}
                                alt={orderPreviewItem.name || orderPreviewItem.product_name || "Product image"}
                                className="h-full w-full object-cover"
                                onError={(event) => {
                                  event.currentTarget.onerror = null;
                                  event.currentTarget.src = PRODUCT_IMAGE_PLACEHOLDER;
                                }}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{orderDisplayName}</span>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${getOrderStatusClasses(order.status)}`}>
                                  {getOrderStatusLabel(order.status)}
                                </span>
                              </div>
                              <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                                <span>{order.tracking || order._id || "—"}</span>
                                <span aria-hidden="true">·</span>
                                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-bold ${darkMode ? "border-blue-800 bg-blue-950/50 text-blue-200" : "border-blue-200 bg-blue-50 text-blue-800"}`}>{orderDisplayQuantity}</span>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 sm:flex sm:justify-end sm:gap-5">
                            <div className="text-right sm:min-w-[100px]">
                              <p className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Total</p>
                              <p className="mt-0.5 text-sm font-bold text-red-600"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(getOrderTotalValue(order))}</span></p>
                            </div>
                            <div className="text-right sm:min-w-[90px]">
                              <p className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Updated</p>
                              <p className={`mt-0.5 text-xs font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{orderDate}</p>
                            </div>
                            <div className="col-span-2 flex justify-end sm:col-span-1">
                              <button
                                type="button"
                                onClick={() => openOrderDetailsFromNotification(order)}
                                aria-label={`View details for ${orderDisplayName}`}
                                className={`inline-flex w-[7.25rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${darkMode ? "bg-red-600 text-white hover:bg-red-500" : "bg-red-700 text-white hover:bg-red-800"}`}
                              >
                                View details <Eye size={14} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          {profileEditing && (
          createPortal(
          <div className="customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-[90] overflow-y-auto bg-slate-950/55 px-0 py-0 backdrop-blur-sm sm:px-6 sm:py-8">
          <div role="dialog" aria-modal="true" aria-labelledby="customer-profile-settings-title" className="mobile-fullscreen-dialog mx-auto w-full max-w-5xl overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-4rem)] sm:rounded-2xl lg:h-[min(90dvh,56rem)] lg:max-h-[calc(100dvh-4rem)] lg:overflow-hidden">
          <div className="grid grid-cols-1 gap-3 p-3 sm:gap-4 sm:p-4 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(230px,0.78fr)_minmax(0,1.65fr)]">
            <div className={`relative hidden min-w-0 rounded-2xl border p-4 shadow-sm sm:p-5 lg:block ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
              <button
                type="button"
                onClick={closeProfileEditor}
                className={`absolute right-4 top-4 rounded-lg border px-3 py-2 text-xs font-semibold lg:hidden ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
              >
                Back to profile
              </button>
              <div className="flex flex-col items-center">
                <ProfileAvatar
                  name={`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "Customer"}
                  avatarOnly
                  size="lg"
                  className="border-4 border-red-100"
                />

                <h2 className={`mt-4 text-xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{`${profileForm.first_name || user?.first_name || ""} ${profileForm.last_name || user?.last_name || ""}`.trim() || "Customer"}</h2>

                <div className="mt-5 w-full space-y-3">
                  <div className={`rounded-xl p-3.5 flex items-center gap-3 ${darkMode ? "bg-slate-900" : "bg-gray-50"}`}>
                    <Mail className="text-red-600" size={18} />
                    <div className="min-w-0 flex-1">
                      <p className={darkMode ? "text-xs text-slate-400" : "text-xs text-gray-500"}>Email</p>
                      <p className={`break-all text-sm font-medium ${darkMode ? "text-white" : "text-slate-900"}`}>{profileForm.email}</p>
                    </div>
                  </div>

                  <div className={`rounded-xl p-3.5 flex items-center gap-3 ${darkMode ? "bg-slate-900" : "bg-gray-50"}`}>
                    <Phone className="text-red-600" size={18} />
                    <div className="min-w-0 flex-1">
                      <p className={darkMode ? "text-xs text-slate-400" : "text-xs text-gray-500"}>Phone</p>
                      <p className={`text-sm font-medium ${darkMode ? "text-white" : "text-slate-900"}`}>{profileForm.phone || "Not set"}</p>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            <div className={`flex min-h-0 min-w-0 flex-col rounded-2xl border p-4 shadow-sm sm:p-5 lg:overflow-hidden ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <User size={24} className="text-red-600" />
                <div>
                  <h2 id="customer-profile-settings-title" className={`text-xl font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Profile Settings</h2>
                  <p className={darkMode ? "text-sm text-slate-300" : "text-sm text-gray-500"}>Update your account and password settings.</p>
                </div>
                <button
                  type="button"
                  onClick={closeProfileEditor}
                  className={`ml-auto inline-flex rounded-lg border px-3 py-2 text-xs font-semibold ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  Back to profile
                </button>
              </div>

              {profileError && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                  {profileError}
                </div>
              )}

              {profileMessage && (
                <div role="status" aria-live="polite" className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
                  {profileMessage}
                </div>
              )}

              {profileHasChanges() && (
                <div role="status" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${darkMode ? "border-amber-700 bg-amber-950/40 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                  Unsaved changes. Your profile will not update until you save.
                </div>
              )}

              <div className="mt-3 flex min-h-0 flex-1 flex-col">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className={`rounded-2xl border p-1.5 flex overflow-hidden ${darkMode ? "bg-slate-900 border-slate-700" : "bg-gray-100 border-gray-200"}`}>
                    <button
                      type="button"
                      onClick={() => setProfileTab("profile")}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        profileTab === "profile"
                          ? darkMode ? "bg-slate-700 text-red-400 shadow-sm" : "bg-white text-red-600 shadow-sm"
                          : darkMode ? "text-slate-300 hover:text-red-300" : "text-gray-600 hover:text-red-600"
                      }`}
                    >
                      Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfileTab("security")}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        profileTab === "security"
                          ? darkMode ? "bg-slate-700 text-red-400 shadow-sm" : "bg-white text-red-600 shadow-sm"
                          : darkMode ? "text-slate-300 hover:text-red-300" : "text-gray-600 hover:text-red-600"
                      }`}
                    >
                      Security
                    </button>
                  </div>
                </div>

                <div className="mt-3 min-h-0 overflow-visible lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
                  {profileTab === "profile" ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <ProfileTextField
                        label="First Name"
                        icon={User}
                        darkMode={darkMode}
                        type="text"
                        name="first_name"
                        maxLength={50}
                        value={profileForm.first_name}
                        onChange={handleProfileChange}
                        placeholder="First Name"
                      />
                      <ProfileTextField
                        label="Last Name"
                        icon={User}
                        darkMode={darkMode}
                        type="text"
                        name="last_name"
                        maxLength={50}
                        value={profileForm.last_name}
                        onChange={handleProfileChange}
                        placeholder="Last Name"
                      />
                      <div>
                        <ProfileTextField
                          label="Username"
                          icon={User}
                          darkMode={darkMode}
                          type="text"
                          name="username"
                          value={profileForm.username}
                          disabled
                          action={(
                            <button type="button" onClick={() => setUsernameChangeOpen(true)} className={`inline-flex items-center gap-1.5 text-xs font-semibold ${darkMode ? "text-red-300 hover:text-red-200" : "text-red-700 hover:text-red-800"}`}>
                              <Pencil size={13} aria-hidden="true" /> Change username
                            </button>
                          )}
                        />
                      </div>
                      <ProfileTextField
                        label="Phone Number"
                        icon={Phone}
                        darkMode={darkMode}
                        type="tel"
                        inputMode="tel"
                        maxLength={13}
                        name="phone"
                        value={profileForm.phone}
                        onChange={handleProfileChange}
                        placeholder="+639171234567 or 09171234567"
                      />
                      <ProfileTextField
                        label="Email Address"
                        icon={Mail}
                        darkMode={darkMode}
                        type="email"
                        name="email"
                        id="profile-email-address"
                        value={profileForm.email}
                        disabled
                        action={(
                          <button
                            type="button"
                            onClick={openEmailChange}
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold ${darkMode ? "text-red-300 hover:text-red-200" : "text-red-700 hover:text-red-800"}`}
                          >
                            <Pencil size={13} aria-hidden="true" /> Edit Email
                          </button>
                        )}
                      />
                      <div className="md:col-span-2 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <FullAddressField
                          minimumLength={0}
                          label="Street Address"
                          icon={MapPin}
                          name="street_address"
                          value={profileForm.street_address}
                          onChange={handleProfileChange}
                          placeholder="Enter your street address"
                          showError={normalizeFullAddress(profileForm.street_address) !== normalizeFullAddress(user?.street_address)}
                          labelClassName={darkMode ? "text-slate-300" : "text-slate-700"}
                          className={`w-full rounded-xl border py-2.5 pr-4 text-xs font-semibold outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-500/10 disabled:cursor-not-allowed ${darkMode ? "border-slate-700 bg-slate-900 text-white placeholder:text-slate-400" : "border-gray-300 bg-white text-slate-900 placeholder:text-gray-400"}`}
                        />
                      <ProfileTextField
                        label="City"
                        icon={Building2}
                        darkMode={darkMode}
                        type="text"
                        name="city"
                        maxLength={40}
                        value={profileForm.city}
                        onChange={handleProfileChange}
                        placeholder="City"
                      />
                      <ProfileTextField
                        label="Province"
                        icon={MapPin}
                        darkMode={darkMode}
                        type="text"
                        name="province"
                        maxLength={40}
                        value={profileForm.province}
                        onChange={handleProfileChange}
                        placeholder="Province"
                      />
                      <ProfileTextField
                        label="Zip Code"
                        icon={Hash}
                        darkMode={darkMode}
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        name="zip_code"
                        value={profileForm.zip_code}
                        onChange={handleProfileChange}
                        placeholder="Zip Code"
                      />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <ProfileTextField
                          label="Current Password"
                          icon={LockKeyhole}
                          darkMode={darkMode}
                          type="password"
                          name="current_password"
                          value={profileForm.current_password}
                          onChange={handleProfileChange}
                          placeholder="Enter current password"
                          autoComplete="current-password"
                        />
                      </div>
                      <div>
                        <ProfileTextField
                          label="New Password"
                          icon={LockKeyhole}
                          darkMode={darkMode}
                          type="password"
                          name="new_password"
                          value={profileForm.new_password}
                          onChange={handleProfileChange}
                          minLength={8}
                          maxLength={128}
                          placeholder="Enter new password"
                          autoComplete="new-password"
                        />
                        <PasswordStrengthMeter password={profileForm.new_password} darkMode={darkMode} />
                        <p className="mt-1 text-xs text-slate-500">{PASSWORD_POLICY_HINT}</p>
                      </div>
                      <ProfileTextField
                        label="Confirm Password"
                        icon={LockKeyhole}
                        darkMode={darkMode}
                        type="password"
                        name="confirm_password"
                        value={profileForm.confirm_password}
                        onChange={handleProfileChange}
                        minLength={8}
                        maxLength={128}
                        placeholder="Confirm new password"
                        autoComplete="new-password"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className={`relative -mx-4 -mb-4 mt-3 flex shrink-0 flex-col-reverse justify-end gap-2 border-t px-4 py-3 sm:-mx-5 sm:-mb-5 sm:px-5 sm:flex-row ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                {profileHasChanges() && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowDiscardProfileChanges(true);
                    }}
                    disabled={profileSaving}
                    className={`mr-auto rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                  >
                    Discard changes
                  </button>
                )}
                <button
                  onClick={handleProfileSave}
                  disabled={profileSaving || !profileHasChanges()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  <Save size={16} />
                  {profileSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>

              {showDiscardProfileChanges && (
                <div className="customer-modal-overlay fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/55 p-4" role="presentation">
                  <section role="alertdialog" aria-modal="true" aria-labelledby="discard-customer-profile-title" className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                    <h3 id="discard-customer-profile-title" className="text-lg font-bold">Discard unsaved changes?</h3>
                    <p className={`mt-2 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Your saved profile is unchanged. The edits in this form will be cleared.</p>
                    <div className="mt-5 flex justify-end gap-2">
                      <button type="button" onClick={keepCustomerProfileEditing} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
                        Keep editing
                      </button>
                      <button type="button" onClick={confirmCustomerProfileDiscard} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800">
                        Discard changes
                      </button>
                    </div>
                  </section>
                </div>
              )}

              {emailChangeOpen && (
                <div className="customer-modal-overlay fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6">
                  <form
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="email-change-title"
                    onSubmit={handleEmailChangeSubmit}
                    className={`my-auto w-full max-w-lg rounded-2xl border p-5 shadow-2xl sm:p-6 ${darkMode ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                  >
                    <h3 id="email-change-title" className="text-lg font-bold">Edit Email Address</h3>
                    <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                      We will send a verification code to your new address. Your current email stays active until it is verified.
                    </p>
                    {emailChangeError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{emailChangeError}</p>}
                    <div className="mt-5 space-y-4">
                      <label className="block text-sm font-medium">
                        Current Email Address
                        <input
                          type="email"
                          value={user?.email || profileForm.email || ""}
                          readOnly
                          className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 ${darkMode ? "border-slate-700 bg-slate-900 text-slate-300" : "border-slate-200 bg-slate-100 text-slate-600"}`}
                        />
                      </label>
                      <label className="block text-sm font-medium">
                        New Email Address
                        <input
                          type="email"
                          autoComplete="email"
                          required
                          value={emailChangeForm.new_email}
                          onChange={(event) => setEmailChangeForm((current) => ({ ...current, new_email: event.target.value }))}
                          className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                        />
                      </label>
                      <label className="block text-sm font-medium">
                        Confirm New Email Address
                        <input
                          type="email"
                          autoComplete="email"
                          required
                          value={emailChangeForm.confirm_new_email}
                          onChange={(event) => setEmailChangeForm((current) => ({ ...current, confirm_new_email: event.target.value }))}
                          className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                        />
                      </label>
                      <label className="block text-sm font-medium">
                        Current Password
                        <span className="relative mt-1.5 block">
                          <input
                            type={showEmailChangePassword ? "text" : "password"}
                            autoComplete="current-password"
                            required
                            value={emailChangeForm.current_password}
                            onChange={(event) => setEmailChangeForm((current) => ({ ...current, current_password: event.target.value }))}
                            className={`w-full rounded-xl border px-3 py-2.5 pr-11 outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                          />
                          <button type="button" onClick={() => setShowEmailChangePassword((visible) => !visible)} aria-label={showEmailChangePassword ? "Hide current password" : "Show current password"} aria-pressed={showEmailChangePassword} className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 ${darkMode ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-800"}`}>
                            {showEmailChangePassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                          </button>
                        </span>
                      </label>
                    </div>
                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        onClick={closeEmailChange}
                        disabled={emailChangeSaving}
                        className={`rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={emailChangeSaving}
                        className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-60"
                      >
                        {emailChangeSaving ? "Sending..." : "Save Changes"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {emailVerifyOpen && (
                <div className="customer-modal-overlay fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6">
                  <form
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="email-verify-title"
                    onSubmit={handleEmailCodeVerify}
                    className={`my-auto w-full max-w-lg rounded-2xl border p-5 shadow-2xl sm:p-6 ${darkMode ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-900"}`}
                  >
                    <h3 id="email-verify-title" className="text-lg font-bold">Verify Email Address</h3>
                    <p className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                      A verification code was sent to the new email address below. Enter it to verify and update your email.
                    </p>
                    <p className={`mt-4 break-all rounded-xl border px-3 py-2.5 text-sm font-semibold ${darkMode ? "border-slate-700 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
                      {pendingEmail}
                    </p>
                    {emailVerifyMessage && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{emailVerifyMessage}</p>}
                    {emailVerifyError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{emailVerifyError}</p>}
                    <label htmlFor="email-verification-code" className="mb-2 mt-5 block text-sm font-medium">Verification Code</label>
                    <OtpCodeInput
                      id="email-verification-code"
                      value={emailVerificationCode}
                      onChange={setEmailVerificationCode}
                      disabled={emailVerifyLoading || emailResending}
                      darkMode={darkMode}
                      autoFocus
                    />
                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        onClick={handleEmailCodeResend}
                        disabled={emailResending || emailVerifyLoading || emailResendCooldown > 0}
                        className={`rounded-xl px-2 py-2.5 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "text-red-300 hover:text-red-200" : "text-red-700 hover:text-red-800"}`}
                      >
                        {emailResending ? "Sending code..." : emailResendCooldown > 0 ? `Resend code in ${emailResendCooldown}s` : "Resend Code"}
                      </button>
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={closeEmailVerification}
                          disabled={emailVerifyLoading || emailResending}
                          className={`rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={emailVerifyLoading || emailResending}
                          className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-60"
                        >
                          {emailVerifyLoading ? "Verifying..." : "Verify Code"}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}

              {showPasswordModal && (
                <div className="customer-modal-overlay fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
                  <form
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="customer-profile-confirm-title"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      setPasswordModalError("");
                      if (!profileForm.current_password) {
                        setPasswordModalError("Please enter your current password.");
                        return;
                      }
                      const saved = await performProfileSave({ showErrorInModal: true });
                      if (saved) setShowPasswordModal(false);
                    }}
                    className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
                  >
                    <h3 id="customer-profile-confirm-title" className="mb-3 text-xl font-semibold">Confirm Profile Changes</h3>
                    <p className="text-gray-600 mb-4">
                      Enter your current password to confirm saving profile changes.
                    </p>
                    {passwordModalError && (
                      <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                        {passwordModalError}
                      </div>
                    )}
                    <label htmlFor="customer-profile-current-password" className="mb-1.5 block text-sm font-medium text-gray-700">Current password</label>
                    <input
                      id="customer-profile-current-password"
                      type="password"
                      name="current_password"
                      value={profileForm.current_password}
                      onChange={handleProfileChange}
                      placeholder="Current password"
                      autoComplete="current-password"
                      className="w-full border rounded-2xl px-4 py-3 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        disabled={profileSaving}
                        onClick={() => {
                          setShowPasswordModal(false);
                          setPasswordModalError("");
                        }}
                        className="px-4 py-3 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={profileSaving}
                        aria-busy={profileSaving}
                        className="px-4 py-3 rounded-2xl bg-red-600 text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                      >
                        {profileSaving ? "Saving..." : "Confirm"}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
          </div>
          </div>,
          document.body
          )
          )}
          </>
        )}

        {activeTab === "contracts" && (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
              <div>
                <h2 className={`text-2xl font-black tracking-[-0.03em] ${darkMode ? "text-white" : "text-slate-950"}`}>My Contracts & Warranties</h2>
                <p className={darkMode ? "text-slate-400" : "text-slate-500"}>Review your contracts and warranty coverage.</p>
              </div>
              <div className={`flex flex-wrap gap-1.5 rounded-2xl border p-1.5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-slate-100"}`} role="tablist" aria-label="Filter contracts">
                <button
                  type="button"
                  role="tab"
                  aria-selected={contractHistoryTab === "accepted" && !warrantyHistoryTab}
                  onClick={() => { setContractHistoryTab("accepted"); setWarrantyHistoryTab(null); setContractPage(1); }}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${contractHistoryTab === "accepted" && !warrantyHistoryTab ? (darkMode ? "border-red-700 bg-red-950/60 text-red-100 shadow-sm shadow-black/10" : "border-red-200 bg-red-50 text-red-950 shadow-sm") : (darkMode ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900")}`}
                >
                  Contracts
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${contractHistoryTab === "accepted" && !warrantyHistoryTab ? (darkMode ? "bg-red-800 text-red-50" : "bg-red-200 text-red-900") : (darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-700")}`}>{customerContracts.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={contractHistoryTab === "rejected" && !warrantyHistoryTab}
                  onClick={() => { setContractHistoryTab("rejected"); setWarrantyHistoryTab(null); setContractPage(1); }}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${contractHistoryTab === "rejected" && !warrantyHistoryTab ? (darkMode ? "border-red-700 bg-red-950/60 text-red-100 shadow-sm shadow-black/10" : "border-red-200 bg-red-50 text-red-950 shadow-sm") : (darkMode ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900")}`}
                >
                  Declined Contracts
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${contractHistoryTab === "rejected" && !warrantyHistoryTab ? (darkMode ? "bg-red-800 text-red-50" : "bg-red-200 text-red-900") : (darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-700")}`}>{rejectedContracts.length}</span>
                </button>
              </div>
            </div>

            {ordersLoading ? (
              <div className="space-y-4">
                {[...Array(2)].map((_, index) => (
                  <div key={index} className={`animate-pulse rounded-[28px] p-8 shadow ${darkMode ? "bg-slate-800" : "bg-white"}`} />
                ))}
              </div>
            ) : warrantyHistoryTab ? (
              warrantiesInTab.length === 0 ? (
                <div className={`rounded-[28px] border p-10 text-center shadow-sm ${darkMode ? "border-slate-700 bg-slate-800" : "border-red-200 bg-white"}`}>
                  <p className={darkMode ? "text-slate-300" : "text-gray-600"}>No {warrantyHistoryTab === "active" ? "active" : "expired"} warranties found.</p>
                </div>
              ) : (
                <>
                <div className={`hidden overflow-hidden rounded-[28px] border shadow-[0_18px_45px_rgba(127,29,29,0.08)] md:block ${darkMode ? "border-slate-700 bg-slate-800" : "border-red-200 bg-white"}`}>
                  <table className="min-w-full table-fixed border-separate border-spacing-0 text-left">
                    <thead className="bg-gradient-to-r from-red-700 via-red-600 to-red-500">
                      <tr>
                        <th className="w-[14%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Tracking No.</th>
                        <th className="w-[16%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white">Product</th>
                        <th className="w-[16%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Warranty Period</th>
                        <th className="w-[14%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Start Date</th>
                        <th className="w-[14%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Expiry Date</th>
                        <th className="w-[14%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Status</th>
                        <th className="w-[12%] px-6 py-4 text-xs font-black uppercase tracking-[0.24em] text-white text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warrantiesInTab.map((order) => {
                        const product = order.items?.[0] || {};
                        const warrantyStartDate = formatDateToMMMDDYYYY(order.warranty_start_date) || "—";
                        const warrantyExpiryDate = formatDateToMMMDDYYYY(order.warranty_expiry_date) || "—";
                        const isActive = warrantyHistoryTab === "active";
                        const statusClass = isActive
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-orange-100 text-orange-700";
                        const statusLabel = isActive ? "Active" : "Expired";

                        return (
                          <tr key={order.warranty_record_id || order._id || order.tracking} className={`border-t transition ${darkMode ? "border-slate-700 hover:bg-slate-700/60" : "border-red-100 hover:bg-red-50/70"}`}>
                            <td className="px-6 py-5 align-middle text-sm font-black text-red-700 text-center">{order.tracking || order._id || "—"}</td>
                            <td className={`px-6 py-5 align-middle text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                              <span className={`font-black ${darkMode ? "text-white" : "text-slate-900"}`}>{product.name || product.product_name || "Product"}</span>
                            </td>
                            <td className={`px-6 py-5 align-middle text-sm font-medium text-center ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{order.warranty_period || "—"}</td>
                            <td className={`px-6 py-5 align-middle text-sm font-medium text-center ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{warrantyStartDate}</td>
                            <td className={`px-6 py-5 align-middle text-sm font-medium text-center ${darkMode ? "text-slate-400" : "text-slate-600"}`}>{warrantyExpiryDate}</td>
                            <td className="px-6 py-5 align-middle text-center">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-black leading-tight ${statusClass}`}>{statusLabel}</span>
                            </td>
                            <td className="px-6 py-5 align-middle text-center">
                              <div className="flex flex-wrap justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedOrderForModal(order)}
                                  className="rounded-2xl bg-[#101114] px-3 py-2 text-xs font-black text-white transition hover:bg-black shadow-sm"
                                >
                                  View Details
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-3 md:hidden">
                  {warrantiesInTab.map((order) => {
                    const product = order.items?.[0] || {};
                    const warrantyStartDate = formatDateToMMMDDYYYY(order.warranty_start_date) || "—";
                    const warrantyExpiryDate = formatDateToMMMDDYYYY(order.warranty_expiry_date) || "—";
                    const isActive = warrantyHistoryTab === "active";
                    const statusClass = isActive
                      ? darkMode ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-700"
                      : darkMode ? "bg-orange-500/15 text-orange-300" : "bg-orange-100 text-orange-700";

                    return (
                      <article key={order.warranty_record_id || order._id || order.tracking} className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className={`break-words text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{product.name || product.product_name || "Product"}</h3>
                            <p className="mt-1 break-all font-mono text-xs text-slate-500">{order.tracking || order._id || "—"}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass}`}>{isActive ? "Active" : "Expired"}</span>
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
                          <div className="min-w-0">
                            <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Warranty</dt>
                            <dd className={`mt-1 text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{order.warranty_period || "—"}</dd>
                          </div>
                          <div className="min-w-0">
                            <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Start date</dt>
                            <dd className={`mt-1 text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{warrantyStartDate}</dd>
                          </div>
                          <div className="col-span-2 min-w-0">
                            <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Expiry date</dt>
                            <dd className={`mt-1 text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{warrantyExpiryDate}</dd>
                          </div>
                        </dl>
                        <button
                          type="button"
                          onClick={() => setSelectedOrderForModal(order)}
                          className={`mt-4 w-full rounded-xl px-3 py-2.5 text-sm font-semibold ${darkMode ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-slate-900 text-white hover:bg-slate-800"}`}
                        >
                          View Details
                        </button>
                      </article>
                    );
                  })}
                </div>
                </>
              )
            ) : contractsInTab.length === 0 ? (
              <div className={`rounded-[28px] border p-10 text-center shadow-sm ${darkMode ? "border-slate-700 bg-slate-800" : "border-red-200 bg-white"}`}>
                <p className={darkMode ? "text-slate-300" : "text-gray-600"}>No {contractHistoryTab === "accepted" ? "accepted" : "rejected"} contracts found yet.</p>
              </div>
            ) : (
              <>
                <div className={`space-y-3 rounded-[28px] border p-3 shadow-[0_18px_45px_rgba(127,29,29,0.08)] sm:p-4 ${darkMode ? "border-slate-700 bg-slate-900" : "border-red-200 bg-slate-50"}`}>
                {displayedContracts.map((order) => {
                  const product = order.items?.[0] || {};
                  const statusLabel = getContractStatusLabel(order);
                  const statusClass = statusLabel === "Accepted"
                    ? darkMode
                      ? "border border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
                      : "bg-emerald-100 text-emerald-700"
                    : statusLabel === "Awaiting Contract Sign-off"
                      ? getContractSignoffBadgeClassName(darkMode)
                    : darkMode
                      ? "border border-red-400/30 bg-red-500/15 text-red-300"
                      : "bg-red-100 text-red-700";
                  const orderDate = formatDateToMMMDDYYYY(order.updatedAt || order.createdAt) || "—";

                  return (
                    <article key={order._id || order.tracking} className={`overflow-hidden rounded-[20px] border shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
                      <div className="grid min-w-0 items-center gap-4 p-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(150px,0.8fr)_minmax(150px,0.8fr)_minmax(140px,0.75fr)_auto]">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border text-lg font-black ${darkMode ? "border-red-900 bg-red-950/50 text-red-300" : "border-red-100 bg-red-50 text-red-700"}`}>
                            <FileText size={21} />
                          </div>
                          <div className="min-w-0">
                            <p className={`truncate text-base font-black ${darkMode ? "text-white" : "text-slate-900"}`}>{product.name || product.product_name || "Project"}</p>
                            <p className={`mt-1 text-xs font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{order.tracking || order._id || "—"}</p>
                          </div>
                        </div>

                        <div className="min-w-0 text-center xl:text-left">
                          <p className={`text-[9px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Amount</p>
                          <p className="mt-1 text-base font-black text-red-600 sm:text-lg"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(getFinalProjectCost(order))}</span></p>
                        </div>

                        <div className="min-w-0 text-center xl:text-left">
                          <p className={`text-[9px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Status</p>
                          <span className={`mt-1 ${statusBadgeBaseClassName} ${statusClass}`}>{statusLabel}</span>
                        </div>

                        <div className="min-w-0 text-center xl:text-left">
                          <p className={`text-[9px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Date</p>
                          <p className={`mt-1 text-xs font-semibold ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{orderDate}</p>
                        </div>

                        <div className="flex min-w-0 flex-wrap justify-center gap-2 xl:justify-end">
                          <button type="button" onClick={() => openContractModal(order)} className="rounded-[10px] bg-red-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-red-700">
                            View Contract
                          </button>
                          <button type="button" onClick={() => setSelectedOrderForModal(order)} className="rounded-[10px] bg-[#101114] px-3.5 py-2 text-xs font-black text-white transition hover:bg-black">
                            Order Details
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                </div>

                {contractPageCount > 1 && !isMobile && (
                  <div className={`mt-4 flex flex-wrap items-center justify-center gap-2 rounded-2xl border p-3 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                    <button
                      type="button"
                      onClick={() => setContractPage((page) => Math.max(1, page - 1))}
                      disabled={safeContractPage === 1}
                      className={`rounded-xl border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Previous
                    </button>
                    {Array.from({ length: contractPageCount }, (_, index) => index + 1).map((pageNumber) => (
                      <button
                        key={pageNumber}
                        type="button"
                        onClick={() => setContractPage(pageNumber)}
                        className={`h-9 min-w-9 rounded-xl px-2 text-sm font-black transition ${safeContractPage === pageNumber ? "bg-red-600 text-white" : darkMode ? "border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                      >
                        {pageNumber}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setContractPage((page) => Math.min(contractPageCount, page + 1))}
                      disabled={safeContractPage === contractPageCount}
                      className={`rounded-xl border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {!isMobile && (
          <footer className={`relative left-1/2 ${activeTab === "contracts" ? "mt-auto -mb-6" : activeTab === "orders" ? "mt-0 -mb-6" : "mt-8 -mb-6"} w-screen -translate-x-1/2 overflow-hidden bg-[#232b3d] text-white`}>
          <div className="mx-auto max-w-7xl px-8 pt-8 pb-5">
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <img src={logo} alt="logo" className="size-12 shrink-0 object-contain" />
                  <div>
                    <h3 className="text-[17px] font-medium text-white">ACGC Aluminum Services</h3>
                    <p className="text-sm text-slate-300">Premium Glass &amp; Aluminum Solutions</p>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <h4 className="mb-3 text-[15px] font-medium text-white">Quick Links</h4>
                <nav aria-label="Footer quick links" className="flex flex-col items-start gap-2.5 text-sm text-slate-300">
                  {[["Home", "home"], ["Browse Products", "products"], ["Track Order", "orders"], ["About Us", "about"]].map(([label, tab]) => (
                    <button key={tab} type="button" onClick={() => { setActiveTab(tab); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="w-fit rounded-sm text-left transition-colors motion-reduce:transition-none hover:text-white hover:underline hover:underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                      {label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="min-w-0">
                <h4 className="mb-3 text-[15px] font-medium text-white">Contact</h4>
                <div className="flex flex-col gap-2.5 text-sm text-slate-300">
                  <a href={adminContactEmailHref} className="flex min-w-0 items-start gap-3 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Mail size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span className="break-words">Email: {adminContactEmail}</span></a>
                  <a href={adminContactPhoneHref} className="flex min-w-0 items-start gap-3 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Phone size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span>Phone: {adminContactPhone}</span></a>
                  <a href={adminContactAddressHref} target="_blank" rel="noreferrer" className="flex min-w-0 items-start gap-3 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><MapPin size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span>{adminContactAddress}</span></a>
                  <a href="https://www.google.com/maps/search/?api=1&amp;query=Philippines" target="_blank" rel="noreferrer" className="flex min-w-0 items-start gap-3 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><MapPin size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span>Philippines</span></a>
                </div>
              </div>
            </div>

            <div className="mt-7 border-t border-white/15 pt-4.5 text-center text-[13px] text-slate-300">
              © 2026 ACGC Aluminum Services — All Rights Reserved.
            </div>
          </div>
          </footer>
        )}

        {customerPaymentProofPreview && (
          <div
            className="customer-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/75 p-0 backdrop-blur-sm sm:p-4"
            role="presentation"
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="customer-payment-proof-title"
              className={`mobile-fullscreen-dialog flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden sm:h-[min(90vh,54rem)] sm:max-h-[90vh] sm:max-w-4xl sm:rounded-xl sm:border ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
            >
              <header className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-5 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                <div className="min-w-0">
                  <h2 id="customer-payment-proof-title" className="text-sm font-bold">{customerPaymentProofPreview.isPrivateDocument ? "Admin supporting document" : "Customer payment proof"}</h2>
                  <p className={`truncate text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`} title={customerPaymentProofPreview.fileName}>{customerPaymentProofPreview.fileName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomerPaymentProofPreview(null)}
                  aria-label="Close payment proof preview"
                  title="Close preview"
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <div className={`flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-5 ${darkMode ? "bg-slate-950" : "bg-slate-100"}`}>
                {customerPaymentProofPreview.isPdf ? (
                  <iframe
                    src={customerPaymentProofPreview.url}
                    title={`Payment document: ${customerPaymentProofPreview.fileName}`}
                    className="h-full min-h-0 w-full rounded-lg border border-slate-500/20 bg-white"
                  />
                ) : (
                  <img
                    src={customerPaymentProofPreview.url}
                    alt={`Payment document: ${customerPaymentProofPreview.fileName}`}
                    className="max-h-full max-w-full rounded-lg object-contain"
                  />
                )}
              </div>
              {customerPaymentProofPreview.isPrivateDocument && (
                <footer className={`flex shrink-0 justify-end border-t px-4 py-3 sm:px-5 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <a
                    href={customerPaymentProofPreview.url}
                    download={customerPaymentProofPreview.fileName}
                    className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${darkMode ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                  >
                    Download admin proof
                  </a>
                </footer>
              )}
            </section>
          </div>
        )}

        <UnsavedChangesDialog
          open={showCustomerExitConfirm}
          darkMode={darkMode}
          onStay={() => {
            pendingCustomerExitRef.current = null;
            setShowCustomerExitConfirm(false);
          }}
          onDiscard={discardCustomerChanges}
        />

        <ContractModal
          isOpen={showContractModal}
          transparentBackdrop
          onClose={closeContractModal}
          inspection={contractPreviewOrder}
          contractData={contractPreviewData}
          onDownloadPNG={isContractAccepted ? downloadAcceptedContractPNG : undefined}
          onPrint={isContractAccepted ? printAcceptedContract : undefined}
          onAccept={() => contractPreviewOrder && openContractConfirmModal("accept", contractPreviewOrder._id || contractPreviewOrder.id)}
          onDecline={() => contractPreviewOrder && openContractConfirmModal("decline", contractPreviewOrder._id || contractPreviewOrder.id)}
          isLoading={contractActionLoading}
          actionError={contractActionError}
          notificationRecordId={contractNotificationRecordId}
          acceptedOverride={isContractAccepted}
          awaitingResponseOverride={isContractAwaitingCustomerResponse}
        />

        {/* CONTRACT CONFIRMATION MODAL */}
        {contractConfirmModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="customer-modal-backdrop absolute inset-0 bg-black/40" />
            <div className="relative bg-white rounded-3xl shadow-lg p-6 w-full max-w-md">
              <h2 className="text-2xl font-bold mb-4">
                {contractConfirmModal.action === "accept"
                  ? "Confirm Contract Acceptance"
                  : "Confirm Contract Decline"}
              </h2>
              <p className="text-sm text-slate-600 mb-6">
                {contractConfirmModal.action === "accept"
                  ? "By accepting, you confirm that you reviewed and electronically signed this contract. The completed inspection will move to Transactions for admin approval."
                  : "Your order will remain in the Site Inspection workflow."}
              </p>
              {contractActionError && <p className="mb-3 text-sm font-semibold text-red-600">{contractActionError}</p>}
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeContractConfirmModal}
                  className="px-4 py-2 rounded-lg bg-gray-100 text-slate-700 hover:bg-gray-200 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmContractAction}
                    disabled={contractActionLoading}
                  className={`px-4 py-2 rounded-lg text-white transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    contractConfirmModal.action === "accept"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {contractActionLoading
                    ? contractConfirmModal.action === "accept"
                      ? "Signing..."
                      : "Declining..."
                    : contractConfirmModal.action === "accept" ? "Accept & Sign Contract" : "Confirm Decline"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CustomerDashboard;
