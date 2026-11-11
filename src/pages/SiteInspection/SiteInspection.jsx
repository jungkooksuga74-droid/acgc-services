import CustomerDropdown from "@/components/CustomerDropdown";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Search,
  Plus,
  Pencil,
  FileText,
  Send,
  ChevronLeft,
  ChevronRight,
  Eye,
  ShieldCheck,
  Ban,
  RotateCcw,
  CalendarDays,
  Clock3,
  ClipboardList,
  Phone,
  Minus,
  X,
  Trash2,
  AlertTriangle,
  Lock,
  Unlock,
} from "lucide-react";
import toast from 'react-hot-toast';
import AppToaster from "@/components/AppToaster";

import { getAdminOrders, getAdminOrder, generateContract, updateOrderInspection, updateOrderStatus, cancelAdminOrder, createInspection, sendWalkInApprovalEmail } from "@/api/orders";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { buildContractSnapshot, hasContractSnapshotChanged, hasExistingContract } from "./contractState";
import { getCustomerPaymentProof, getPaymentSummary } from "@/pages/Transactions/paymentProofUtils";
import { getProducts } from "@/api/products";
import { toSquareFeet } from "@/lib/estimator";
import { getBladePriceOverrideRate, getFinishedDoorMeasurementBreakdown, getMeasuredProductLineTotal, getProductLineBreakdown, isFinishedDoorPricingEnabled } from "@/lib/productPricing";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";
import FullAddressField from "@/components/FullAddressField";
import { getStreetAddressError, isValidStreetAddress, normalizeFullAddress } from "@/lib/fullAddressValidation";
import { createUnsavedSnapshot } from "@/lib/unsavedSnapshot";
import { printContractElement } from "@/lib/printContract";
import { createContractPdfDataUrl as exportContractElementToPdfDataUrl } from "@/lib/contractPdf";
import { getSystemSettings, searchCustomers } from "@/api/users";
import { uploadFiles } from "@/api/uploads";
import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import FilterDropdown from "@/components/FilterDropdown";
import ContractModal from "../../components/ContractModal";
import BlankContractGeneratorModal from "@/components/BlankContractGeneratorModal";
import { formatDateToMMDDYYYY, formatDateToMMMDDYYYY } from "@/lib/dateUtils";
import { getContractSignoffBadgeClassName, getPaymentStatusBadgeClassName, isAwaitingContractSignoff, statusBadgeBaseClassName } from "@/lib/statusBadgeStyles";
import { getInstallationDateError, getMinimumInstallationDate } from "@/lib/installationSchedule";
import { calculateRequiredDownpayment, getFinalProjectCost } from "@/lib/orderPricing";
import { getPhilippinePhoneError, isValidPhilippinePhone, normalizePhoneInput } from "@/lib/phoneValidation";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { recordActivity } from "@/lib/activityLog";
import { useIsMobile } from "@/hooks/useIsMobile";
import useNotificationHighlight from "@/hooks/useNotificationHighlight";

const ORDER_TYPE_TOKENS = {
  standard: {
    label: "Standard Order",
    dot: "bg-slate-600",
    halo: "ring-slate-600/25",
    chip: "border-slate-600 bg-slate-50 text-slate-800",
    bar: "border-l-slate-600",
    gradientLight: "linear-gradient(90deg, rgba(71,85,105,.11), rgba(71,85,105,0) 140px)",
  },
  rush: {
    label: "Rush Order",
    dot: "bg-red-700",
    halo: "ring-red-700/25",
    chip: "border-red-700 bg-red-50 text-red-800",
    bar: "border-l-red-700",
    gradientLight: "linear-gradient(90deg, rgba(185,28,28,.10), rgba(185,28,28,0) 140px)",
  },
  restricted: {
    label: "Restricted Account",
    dot: "bg-orange-700",
    halo: "ring-orange-700/25",
    chip: "border-orange-700 bg-orange-50 text-orange-900",
    bar: "border-l-orange-700",
    gradientLight: "linear-gradient(90deg, rgba(194,65,12,.11), rgba(194,65,12,0) 140px)",
  },
};
const ORDER_TYPE_LEGEND = [ORDER_TYPE_TOKENS.standard, ORDER_TYPE_TOKENS.rush, ORDER_TYPE_TOKENS.restricted];

const getDefaultInspection = () => ({
  customerId: null,
  customerName: "",
  customerEmail: "",
  phone: "",
  productName: "",
  order_type: "online_order",
  siteAddress: "",
  inspection_date: "",
  inspection_time: "",
  inspection_duration_minutes: 30,
  inspection_travel_minutes: 0,
  is_rush_order: false,
  estimated_installation_date: "",
  estimated_installation_time: "",
  installation_duration_minutes: 60,
  project_additional_charges: [],
  notes: "",
  site_notes: "",
  warranty_period: 90,
  custom_warranty_days: 90,
  warranty_assignment_mode: "same",
  has_account_on_website: false,
  downpayment_received: false,
  required_downpayment_amount: "",
  manual_override: "",
  items: [
    { id: Date.now() + Math.random(), product_id: "", name: "", width: 1, height: 1, qty: 1, measurement_unit: "in", unit_price: 0, area: 0, unit: "sqft", estimation_mode: "auto" },
  ],
  payment_terms: "50%_down_payment",
  agreed_payment_date: "",
  estimation_mode: "auto",
  customerType: "walk-in",
});

const generateTrackingId = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `ACGC-TRK-${year}-${random}`;
};

const SITE_INSPECTION_STATUS = "site_inspection";
const SITE_INSPECTION_CONTRACT_STATUSES = new Set(["", "pending", "sent", "declined"]);
const CONTRACT_STAGE_STATUSES = new Set([
  "contract_created",
  "contract_sent",
  "contract_accepted",
  "contract_declined",
  "in_transaction",
  "processing",
  "cutting",
  "fabrication",
  "installation_scheduling",
  "installation",
  "completed",
  "cancelled",
]);

const normalizeWorkflowValue = (value) =>
  (value || "").toString().trim().toLowerCase();

const hasWebsiteCustomerAccount = (inspection = {}) => {
  const orderType = normalizeWorkflowValue(
    inspection.customerType || inspection.customer_type || inspection.order_type,
  ).replace(/[\s-]+/g, "_");
  if (["walk_in", "walk_in_customer", "walkin"].includes(orderType)) return false;

  const hasRegisteredCustomer = Boolean(
    inspection.customerId
    || inspection.customer_id
    || inspection.customer?._id
    || inspection.customer?.id
    || (typeof inspection.customer === "string" && inspection.customer.trim()),
  );
  return hasRegisteredCustomer || inspection.has_account_on_website === true;
};

const isWalkInInspection = (inspection = {}) => !hasWebsiteCustomerAccount(inspection);
const isOnlineInspection = (inspection = {}) => hasWebsiteCustomerAccount(inspection);
const isOnlineOrderingCooldownActive = (customer = {}, now = Date.now()) => {
  const cooldownUntil = new Date(customer.online_order_cooldown_until || "").getTime();
  return Number.isFinite(cooldownUntil) && cooldownUntil > now;
};
const isRestrictedCustomerOrder = (order = {}, now = Date.now()) => {
  const customer = order.customer && typeof order.customer === "object" ? order.customer : {};
  const cancellationCount = Number(
    customer.customer_cancellation_count
    ?? order.customer_cancellation_count
    ?? order.cancellation_count
    ?? 0,
  );
  return cancellationCount >= 3 && isOnlineOrderingCooldownActive({
    online_order_cooldown_until: customer.online_order_cooldown_until ?? order.online_order_cooldown_until,
  }, now);
};
const formatCancellationCooldownDate = (value) => {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
};

/* eslint-disable react-refresh/only-export-components -- Pure helpers are exported for inspection validation tests. */
export const formatInspectionDateForDisplay = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}-${match[1]}` : "";
};

export const parseInspectionDateFromDisplay = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return "";

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "";

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const formatScheduleTime = (value) => {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
};

const getScheduleOverlap = (records, dateValue, timeValue, excludeRecordId = "", durationMinutes = 30) => {
  if (!dateValue || !timeValue) return null;
  const timeToMinutes = (value) => {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const candidateStart = timeToMinutes(timeValue);
  if (candidateStart === null) return null;
  const candidateDay = String(dateValue).slice(0, 10);
  const candidateStartAbsolute = Date.parse(`${candidateDay}T00:00:00Z`) / 60000 + candidateStart;
  const candidateEnd = candidateStartAbsolute + Math.max(1, Number(durationMinutes) || 30);
  for (const record of records || []) {
    if (String(record?._id || record?.id || "") === String(excludeRecordId || "")) continue;
    if (String(record?.status || "").toLowerCase() === "cancelled") continue;
    const schedules = [
      { date: record?.inspection_date, time: record?.inspection_time, label: "Inspection", duration: Number(record?.inspection_duration_minutes || 30) + Number(record?.inspection_travel_minutes || 0) },
      { date: record?.estimated_installation_date, time: record?.estimated_installation_time, label: "Installation", duration: Number(record?.installation_duration_minutes || 60) },
    ];
    for (const schedule of schedules) {
      if (!schedule.date) continue;
      const bookedStart = timeToMinutes(schedule.time);
      if (bookedStart === null) continue;
      const bookedDuration = schedule.duration > 0 ? schedule.duration : 30;
      const bookedStartAbsolute = Date.parse(`${String(schedule.date).slice(0, 10)}T00:00:00Z`) / 60000 + bookedStart;
      if (candidateStartAbsolute < bookedStartAbsolute + bookedDuration && candidateEnd > bookedStartAbsolute) {
        return { label: schedule.label, time: schedule.time };
      }
    }
  }
  return null;
};

const getAvailableScheduleTimes = (records, dateValue, excludeRecordId = "", durationMinutes = 30, businessHours = { open: "08:00", close: "18:00" }, allowMultiDay = false) => {
  const availableTimes = [];
  const toMinutes = (value, fallback) => { const match = String(value || "").match(/^(\d{2}):(\d{2})$/); return match ? Number(match[1]) * 60 + Number(match[2]) : fallback; };
  const opening = toMinutes(businessHours?.open, 8 * 60);
  const latestStart = toMinutes(businessHours?.close, 18 * 60) - (allowMultiDay ? 1 : Math.max(1, Number(durationMinutes) || 30));
  const now = new Date();
  const manilaDateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const manilaToday = `${manilaDateParts.find((part) => part.type === "year")?.value}-${manilaDateParts.find((part) => part.type === "month")?.value}-${manilaDateParts.find((part) => part.type === "day")?.value}`;
  const manilaClockParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const currentManilaMinutes = Number(manilaClockParts.find((part) => part.type === "hour")?.value || 0) * 60 + Number(manilaClockParts.find((part) => part.type === "minute")?.value || 0);
  for (let minute = opening; minute <= latestStart && availableTimes.length < 3; minute += 30) {
    if (dateValue === manilaToday) {
      if (minute <= currentManilaMinutes) continue;
    }
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    if (!getScheduleOverlap(records, dateValue, time, excludeRecordId, durationMinutes)) availableTimes.push(time);
  }
  return availableTimes;
};

function MonthDayYearDateInput({ label, value, timeValue, min, onChange, onTimeChange, className, darkMode = false, scheduledRecords = [], excludeRecordId = "", durationMinutes = 30, businessHours = { open: "08:00", close: "18:00" }, disabled = false }) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isTimeModalOpen, setIsTimeModalOpen] = useState(false);
  const [viewSchedulesDate, setViewSchedulesDate] = useState("");
  const [draftTime, setDraftTime] = useState({ hour: 9, minute: 0, period: "AM" });
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initialDate = value ? new Date(`${value}T12:00:00`) : min ? new Date(`${min}T12:00:00`) : new Date();
    return new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
  });

  useEffect(() => {
    if (!isCalendarOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      if (isTimeModalOpen) setIsTimeModalOpen(false);
      else setIsCalendarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isCalendarOpen, isTimeModalOpen]);

  const openCalendar = () => {
    if (disabled) return;
    const initialDate = value ? new Date(`${value}T12:00:00`) : min ? new Date(`${min}T12:00:00`) : new Date();
    setVisibleMonth(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
    setIsTimeModalOpen(false);
    setIsCalendarOpen(true);
  };
  const monthLabel = visibleMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const monthOffset = (new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay() + 6) % 7;
  const calendarDays = Array.from({ length: 42 }, (_, index) => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index - monthOffset + 1));
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const scheduledDateKeys = (field) => new Set(scheduledRecords.filter((record) => !["cancelled", "canceled"].includes(String(record?.status || "").toLowerCase())).map((record) => {
    const raw = record?.[field];
    if (!raw) return "";
    const match = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : dateKey(parsed);
  }).filter(Boolean));
  const inspectionDates = scheduledDateKeys("inspection_date");
  const installationDates = scheduledDateKeys("estimated_installation_date");
  const getRecordDateKey = (raw) => {
    if (!raw) return "";
    const match = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? "" : dateKey(parsed);
  };
  const scheduleDetails = (scheduledRecords || []).flatMap((record) => {
    if (["cancelled", "canceled"].includes(String(record?.status || "").toLowerCase())) return [];
    const customer = record?.customer_name || [record?.customer?.first_name, record?.customer?.last_name].filter(Boolean).join(" ") || record?.customer?.email || record?.customer_email || "Customer";
    const project = (record?.items || []).map((item) => item?.name || item?.product_id?.name).filter(Boolean).join(", ") || "Project";
    const identity = String(record?._id || record?.id || record?.tracking || `${customer}-${project}`);
    return [
      ...(record?.inspection_date ? [{ id: `${identity}-inspection`, date: getRecordDateKey(record.inspection_date), kind: "Inspection", time: record.inspection_time, duration: Number(record.inspection_duration_minutes) || 30, customer, project, address: record?.shipping_address || "" }] : []),
      ...(record?.estimated_installation_date ? [{ id: `${identity}-installation`, date: getRecordDateKey(record.estimated_installation_date), kind: "Installation", time: record.estimated_installation_time, duration: Number(record.installation_duration_minutes) || 60, customer, project, address: record?.shipping_address || "" }] : []),
    ];
  });
  const selectedDateSchedules = scheduleDetails.filter((entry) => entry.date === viewSchedulesDate);
  const now = new Date();
  const manilaDateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const todayKey = `${manilaDateParts.find((part) => part.type === "year")?.value}-${manilaDateParts.find((part) => part.type === "month")?.value}-${manilaDateParts.find((part) => part.type === "day")?.value}`;
  const todayDate = new Date(`${todayKey}T12:00:00`);
  const manilaClockParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const currentManilaMinutes = Number(manilaClockParts.find((part) => part.type === "hour")?.value || 0) * 60 + Number(manilaClockParts.find((part) => part.type === "minute")?.value || 0);
  const minimumDateKey = min && min > todayKey ? min : todayKey;
  const minimumDate = new Date(`${minimumDateKey}T00:00:00`);
  const calendarSurface = darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900";
  const calendarMuted = darkMode ? "text-slate-400" : "text-slate-500";
  const combinedValue = [formatInspectionDateForDisplay(value), formatScheduleTime(timeValue)].filter(Boolean).join(" at ");
  const selectedDateSummary = value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "Choose a date";
  const draftTimeValue = `${String(draftTime.period === "PM" ? (draftTime.hour % 12) + 12 : draftTime.hour % 12).padStart(2, "0")}:${String(draftTime.minute).padStart(2, "0")}`;
  const openingMinutes = Number(String(businessHours?.open || "08:00").slice(0, 2)) * 60 + Number(String(businessHours?.open || "08:00").slice(3, 5));
  const closingMinutes = Number(String(businessHours?.close || "18:00").slice(0, 2)) * 60 + Number(String(businessHours?.close || "18:00").slice(3, 5));
  const isMultiDayInstallation = label.toLowerCase().includes("installation") && Number(durationMinutes) > closingMinutes - openingMinutes;
  const draftMinutes = Number(draftTimeValue.slice(0, 2)) * 60 + Number(draftTimeValue.slice(3, 5));
  const selectedTimeIsPast = value === todayKey && draftMinutes <= currentManilaMinutes;
  const timeConflict = draftTimeValue && selectedTimeIsPast
    ? { label: "Past time", time: draftTimeValue }
    : draftTimeValue && (draftMinutes < openingMinutes || (!isMultiDayInstallation && draftMinutes + Number(durationMinutes || 30) > closingMinutes))
    ? { label: "Business hours", time: `${businessHours?.open || "08:00"}–${businessHours?.close || "18:00"}` }
    : getScheduleOverlap(scheduledRecords, value, draftTimeValue, excludeRecordId, durationMinutes);
  const availableTimes = timeConflict ? getAvailableScheduleTimes(scheduledRecords, value, excludeRecordId, durationMinutes, businessHours, isMultiDayInstallation) : [];
  const openTimeModal = (resetToOpening = false) => {
    if (disabled) return;
    const match = resetToOpening ? null : String(timeValue || "").match(/^(\d{2}):(\d{2})$/);
    if (match) {
      const hour = Number(match[1]);
      setDraftTime({ hour: hour % 12 || 12, minute: Number(match[2]), period: hour >= 12 ? "PM" : "AM" });
    } else {
      const opening = businessHours?.open || "08:00";
      const [hourText, minuteText] = opening.split(":");
      const hour = Number(hourText);
      setDraftTime({ hour: hour % 12 || 12, minute: Number(minuteText), period: hour >= 12 ? "PM" : "AM" });
    }
    setIsTimeModalOpen(true);
  };
  const saveDraftTime = () => {
    const hour24 = draftTime.period === "PM" ? (draftTime.hour % 12) + 12 : draftTime.hour % 12;
    onTimeChange(`${String(hour24).padStart(2, "0")}:${String(draftTime.minute).padStart(2, "0")}`);
    setIsTimeModalOpen(false);
  };

  return (
    <div className="relative">
      <input
        type="text"
        readOnly
        placeholder="Select date and time"
        value={combinedValue}
        onClick={() => !disabled && openCalendar()}
        disabled={disabled}
        aria-label={label}
        className={`${className} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} pr-11`}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          openCalendar();
        }}
        aria-label={`Choose ${label.toLowerCase()}`}
        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <CalendarDays size={17} aria-hidden="true" />
      </button>
      {isCalendarOpen && !disabled && createPortal(
        <div className="mobile-fullscreen-overlay fixed inset-0 z-[180] flex h-[100dvh] min-h-0 items-stretch justify-center overflow-hidden overscroll-contain bg-slate-950/60 p-0 backdrop-blur-sm sm:h-auto sm:min-h-screen sm:items-center sm:overflow-y-auto sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsCalendarOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-label={`Choose ${label.toLowerCase()}`} className={`mobile-fullscreen-dialog flex h-full max-h-full min-h-0 w-full max-w-none flex-col overflow-hidden rounded-none border shadow-2xl sm:h-auto sm:max-h-[88dvh] sm:max-w-[min(96vw,1440px)] sm:rounded-3xl ${calendarSurface}`}>
            <header className={`flex shrink-0 flex-col gap-2 border-b px-4 py-3 sm:px-6 sm:py-3.5 ${darkMode ? "border-slate-700 bg-[#0b2338]" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600"}`}><CalendarDays size={17} aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <p className={`text-[9px] font-bold uppercase tracking-[0.16em] ${darkMode ? "text-red-300" : "text-red-600"}`}>{label}</p>
                    <h2 className={`mt-0.5 text-lg font-bold leading-tight sm:text-xl ${darkMode ? "text-white" : "text-slate-900"}`}>Select date and time</h2>
                    <p className={`mt-0.5 text-xs leading-4 sm:text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Choose a date, review existing appointments, and set a time.</p>
                  </div>
                </div>
                <button type="button" onClick={() => setIsCalendarOpen(false)} aria-label="Close date picker" className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}><X size={18} aria-hidden="true" /></button>
              </div>
            </header>
            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.75fr)]">
              <div className="mx-auto w-full max-w-[820px]">
              <div className="mb-4 grid grid-cols-[36px_1fr_auto_36px] items-center gap-2">
                <button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} aria-label="Previous month" className={`flex size-9 items-center justify-center rounded-lg border ${darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"}`}><ChevronLeft size={17} /></button>
                <p className="text-center text-sm font-bold">{monthLabel}</p>
                <button type="button" onClick={() => { setVisibleMonth(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1)); onChange(todayKey); }} className={`rounded-md px-2 py-1 text-xs font-bold transition ${darkMode ? "text-red-300 hover:bg-slate-800" : "text-red-700 hover:bg-red-50"}`}>Today</button>
                <button type="button" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} aria-label="Next month" className={`flex size-9 items-center justify-center rounded-lg border ${darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"}`}><ChevronRight size={17} /></button>
              </div>
              <div className={`mb-2 grid grid-cols-7 text-center text-[10px] font-bold uppercase ${calendarMuted}`}>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
              <div className={`mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] ${calendarMuted}`} aria-label="Calendar schedule legend">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />Inspection date</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-blue-600" aria-hidden="true" />Installation date</span>
              </div>
              <div className="grid grid-cols-7 gap-x-2 gap-y-1">
                {calendarDays.map((date) => {
                  const key = dateKey(date);
                  const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
                  const isSelected = value === key;
                  const isToday = key === dateKey(new Date());
                  const isDisabled = Boolean(minimumDate && date < minimumDate);
                  const hasInspection = inspectionDates.has(key);
                  const hasInstallation = installationDates.has(key);
                  return <div key={key} className="relative">
                    <button type="button" disabled={isDisabled} onClick={() => { onChange(key); openTimeModal(value !== key); }} aria-current={isToday ? "date" : undefined} aria-label={`${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}${isToday ? ", today" : ""}${hasInspection ? ", inspection scheduled" : ""}${hasInstallation ? ", installation scheduled" : ""}`} className={`relative flex h-12 w-full items-center justify-center rounded-lg border text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-25 ${isSelected ? "border-red-700 bg-red-700 font-bold text-white shadow-sm" : isToday ? darkMode ? "border-slate-500 bg-slate-800 font-bold text-white" : "border-slate-300 bg-slate-50 font-bold text-slate-900" : "border-transparent"} ${!isSelected && isCurrentMonth ? darkMode ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-red-50" : ""} ${!isCurrentMonth ? `${calendarMuted} opacity-50 hover:bg-slate-500/10` : ""}`}>
                      {date.getDate()}
                      {isToday && <span className="absolute left-1 top-1 inline-block -scale-x-100 text-xs leading-none" aria-hidden="true">&#128204;</span>}
                      {(hasInspection || hasInstallation) && <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-1" aria-hidden="true">
                        {hasInspection && <span className={`rounded-full bg-amber-500 ${isSelected ? "size-2 ring-1 ring-white shadow-[0_0_0_1px_rgba(15,23,42,0.55)]" : "size-1.5"}`} />}
                        {hasInstallation && <span className={`rounded-full bg-blue-600 ${isSelected ? "size-2 ring-1 ring-white shadow-[0_0_0_1px_rgba(15,23,42,0.55)]" : "size-1.5"}`} />}
                      </span>}
                    </button>
                    {(hasInspection || hasInstallation) && <button type="button" onClick={(event) => { event.stopPropagation(); setViewSchedulesDate(key); }} aria-label={`View schedules for ${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`} title="View schedules" className={`absolute right-0.5 top-0.5 z-10 flex size-6 items-center justify-center rounded-full border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}><Eye size={14} aria-hidden="true" /></button>}
                  </div>;
                })}
              </div>
              </div>
              <aside className={`flex flex-col justify-between rounded-xl border p-5 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-slate-50"}`}>
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${calendarMuted}`}>Selected appointment</p>
                  <p className={`mt-2 text-lg font-bold ${value ? darkMode ? "text-slate-100" : "text-slate-900" : calendarMuted}`} aria-live="polite">{selectedDateSummary}</p>
                  <div className={`mt-5 rounded-lg border p-4 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
                    <p className={`text-xs font-semibold ${calendarMuted}`}>Time</p>
                    <button type="button" disabled={!value} onClick={openTimeModal} className={`mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-700 bg-slate-950 hover:bg-slate-800" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                      <Clock3 size={15} aria-hidden="true" />{timeValue ? formatScheduleTime(timeValue) : "Choose time"}
                    </button>
                    <p className={`mt-2 text-xs ${calendarMuted}`}>{timeValue ? `Selected: ${formatScheduleTime(timeValue)}` : "Choose a start time for this appointment."}</p>
                  </div>
                </div>
              </aside>
            </div>
            <footer className={`flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-7 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-[#f1f2f0]"}`}>
              <p className={`min-w-0 text-sm ${calendarMuted}`} aria-live="polite">{selectedDateSummary}{timeValue ? ` · ${formatScheduleTime(timeValue)}` : ""}</p>
              <div className="flex shrink-0 items-center justify-end gap-2">
                {value && <button type="button" onClick={() => { onChange(""); onTimeChange(""); setIsCalendarOpen(false); }} className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-300 bg-white hover:bg-slate-50"}`}>Clear</button>}
                <button type="button" onClick={() => setIsCalendarOpen(false)} className="rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-800">Done</button>
              </div>
            </footer>
          </section>
        </div>,
        document.body
      )}
      {viewSchedulesDate && createPortal(
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewSchedulesDate(""); }}>
          <section role="dialog" aria-modal="true" aria-label="Schedules for selected date" className={`w-full max-w-[560px] overflow-hidden rounded-2xl border shadow-2xl ${calendarSurface}`}>
            <header className={`flex items-center justify-between border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
              <div>
                <p className={`text-[10px] font-bold uppercase tracking-[0.15em] ${darkMode ? "text-red-300" : "text-red-700"}`}>Scheduled appointments</p>
                <h2 className="mt-1 text-lg font-bold">{new Date(`${viewSchedulesDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h2>
              </div>
              <button type="button" onClick={() => setViewSchedulesDate("")} aria-label="Close schedule details" className={`flex size-9 items-center justify-center rounded-lg ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}><X size={18} /></button>
            </header>
            <div className="max-h-[65vh] space-y-3 overflow-y-auto p-5">
              {selectedDateSchedules.map((entry) => (
                <article key={entry.id} className={`rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-slate-50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold">{entry.kind}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.kind === "Inspection" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>{entry.time ? formatScheduleTime(entry.time) : "Time not set"}</span>
                  </div>
                  <p className={`mt-2 text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{entry.customer}</p>
                  <p className={`mt-1 text-sm ${calendarMuted}`}>{entry.project}</p>
                  <p className={`mt-1 text-xs ${calendarMuted}`}>Estimated duration: {entry.duration >= 60 ? `${Math.floor(entry.duration / 60)} hr${Math.floor(entry.duration / 60) === 1 ? "" : "s"}${entry.duration % 60 ? ` ${entry.duration % 60} min` : ""}` : `${entry.duration} min`}</p>
                  {entry.address && <p className={`mt-2 text-xs ${calendarMuted}`}>{entry.address}</p>}
                </article>
              ))}
              {!selectedDateSchedules.length && <p className={`py-8 text-center text-sm ${calendarMuted}`}>No appointments are scheduled for this date.</p>}
            </div>
            <footer className={`flex justify-end border-t p-4 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
              <button type="button" onClick={() => setViewSchedulesDate("")} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800">Close</button>
            </footer>
          </section>
        </div>,
        document.body
      )}
      {isTimeModalOpen && !disabled && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsTimeModalOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="schedule-time-title" className={`w-full max-w-[420px] overflow-hidden rounded-2xl border shadow-2xl ${calendarSurface}`}>
            <header className={`flex items-center justify-between border-b px-5 py-4 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
              <div className="flex items-center gap-3">
                <span className={`flex size-10 items-center justify-center rounded-xl ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700"}`}><Clock3 size={18} aria-hidden="true" /></span>
                <div><p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${darkMode ? "text-red-300" : "text-red-700"}`}>{label}</p><h2 id="schedule-time-title" className="mt-1 text-lg font-bold">Select time</h2></div>
              </div>
              <button type="button" onClick={() => setIsTimeModalOpen(false)} aria-label="Close time picker" className={`flex size-9 items-center justify-center rounded-lg ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}><X size={18} /></button>
            </header>
            <div className="p-4 sm:p-5">
              <div className={`mb-4 rounded-xl border p-3 text-center ${darkMode ? "border-slate-700 bg-slate-950/60" : "border-slate-200 bg-slate-50"}`}>
                <p className={`text-[10px] font-bold uppercase tracking-wide ${calendarMuted}`}>Selected time</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{draftTime.hour}:{String(draftTime.minute).padStart(2, "0")} {draftTime.period}</p>
              </div>
              <label className={`block text-xs font-semibold ${calendarMuted}`}>Choose a time
                <input type="time" step="60" value={draftTimeValue} onChange={(event) => {
                  const [hourText, minuteText] = event.target.value.split(":");
                  if (!hourText || !minuteText) return;
                  const hour24 = Number(hourText);
                  setDraftTime({ hour: hour24 % 12 || 12, minute: Number(minuteText), period: hour24 >= 12 ? "PM" : "AM" });
                }} aria-label="Choose time" className={`mt-1.5 h-12 w-full rounded-lg border px-3 text-base font-semibold ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`} />
              </label>
              {timeConflict && <div role="alert" className={`mt-3 rounded-lg border p-3 text-xs ${darkMode ? "border-amber-500/40 bg-amber-500/10 text-amber-100" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                <p className="font-semibold">{timeConflict.label === "Business hours" ? `The full appointment must fit between ${timeConflict.time} (Asia/Manila).` : timeConflict.label === "Past time" ? "Select a future appointment time." : `This time overlaps a scheduled ${timeConflict.label.toLowerCase()} at ${formatScheduleTime(timeConflict.time)}.`}</p>
                <p className="mt-1">Choose another time to avoid a schedule conflict.</p>
                {availableTimes.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{availableTimes.map((time) => <button key={time} type="button" onClick={() => {
                  const [hourText, minuteText] = time.split(":");
                  const hour24 = Number(hourText);
                  setDraftTime({ hour: hour24 % 12 || 12, minute: Number(minuteText), period: hour24 >= 12 ? "PM" : "AM" });
                }} className={`rounded-md border px-2.5 py-1.5 font-semibold ${darkMode ? "border-amber-400/50 bg-slate-900 hover:bg-slate-800" : "border-amber-400 bg-white hover:bg-amber-100"}`}>{formatScheduleTime(time)}</button>)}</div>}
              </div>}
              <footer className={`mt-5 flex justify-end gap-2 border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-100"}`}>
                <button type="button" onClick={() => setIsTimeModalOpen(false)} className={`rounded-lg border px-4 py-2.5 text-xs font-semibold ${darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"}`}>Cancel</button>
                <button type="button" disabled={Boolean(timeConflict)} onClick={saveDraftTime} className="rounded-lg bg-red-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">Set time</button>
              </footer>
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}

export const normalizeWarrantyPeriodValue = (value, fallback = 90) => {
  if (value === "Custom" || value === "No Warranty") return value;

  const periodText = String(value).trim().toLowerCase();
  const durationMatch = periodText.match(/^(\d+)\s*(?:days?)?$/);
  const numericValue = durationMatch ? Number(durationMatch[1]) : Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    if (numericValue === 30 || numericValue === 90) {
      return numericValue;
    }

    return "Custom";
  }

  return fallback;
};

export const buildWarrantyPayload = (warrantyPeriod, customWarrantyDays) => {
  if (warrantyPeriod === "No Warranty") {
    return { warranty_period: "No Warranty", custom_warranty_days: null };
  }

  const warrantyDays = warrantyPeriod === "Custom"
    ? Number(customWarrantyDays) || 90
    : Number(warrantyPeriod) || 90;

  return {
    warranty_period: warrantyDays,
    custom_warranty_days: warrantyPeriod === "Custom"
      ? warrantyDays
      : Number(customWarrantyDays) || Number(warrantyPeriod) || 90,
  };
};

const normalizeProductId = (productId) => {
  if (typeof productId === "object" && productId !== null) {
    return String(productId._id || productId.id || productId);
  }
  return productId ? String(productId) : "";
};

export const getEstimatedInstallationDate = (inspection) => (
  inspection?.estimated_installation_date ||
  inspection?.estimated_install_date ||
  inspection?.estimatedInstallationDate ||
  inspection?.installation_date ||
  inspection?.installationDate ||
  inspection?.estimatedInstallDate ||
  inspection?.est_install_date ||
  inspection?.estInstallDate ||
  ""
);

export const hasValidEstimatedInstallationDate = (inspection) => {
  const value = getEstimatedInstallationDate(inspection);
  return Boolean(value && !getInstallationDateError(inspection?.inspection_date, value));
};

const toApiDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date
    ? new Date(value)
    : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const getWarrantyPeriodDays = (period) => {
  const numericPeriod = Number(period);
  if (Number.isFinite(numericPeriod) && numericPeriod > 0) return numericPeriod;

  const match = String(period ?? "").trim().toLowerCase().match(/^(\d+)\s*(days?|months?|years?)$/);
  if (!match) return null;
  const count = Number(match[1]);
  if (match[2].startsWith("year")) return count * 365;
  if (match[2].startsWith("month")) return count * 30;
  return count;
};

export const calculateWarrantyExpiry = (startDate, period, customDays) => {
  if (!startDate || period === "No Warranty") return null;
  const days = period === "Custom"
    ? Number(customDays)
    : getWarrantyPeriodDays(period) || Number(customDays);
  if (!Number.isFinite(days) || days <= 0) return null;
  const expiry = startDate instanceof Date
    ? new Date(startDate)
    : new Date(`${String(startDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(expiry.getTime())) return null;
  expiry.setUTCDate(expiry.getUTCDate() + days);
  return expiry.toISOString();
};

export const calculateMeasurementArea = (width, height, quantity = 1, unit = "in") => {
  const area = toSquareFeet(Number(width) || 0, Number(height) || 0, unit) * (Number(quantity) || 1);
  return Math.round(area * 100) / 100;
};

export const getInspectionItemPricingMethod = (item = {}) => {
  const method = String(item.pricing_method || "").toLowerCase();
  if (method) return method;
  const unit = String(item.unit || "").toLowerCase();
  if (unit === "per_blade") return "blade";
  if (unit === "per_sqft") return "sqft";
  return unit;
};

export const isInspectionMeterItem = (item = {}) => ["per_meter", "meter"].includes(getInspectionItemPricingMethod(item));

const isInspectionPieceItem = (item = {}) => ["per_piece", "piece", "per_set", "set"].includes(getInspectionItemPricingMethod(item));

export const isInspectionBladeItem = (item = {}) => {
  const method = getInspectionItemPricingMethod(item);
  return method === "blade" || method === "per_blade";
};

export const getInspectionMeasurementFields = (item = {}) => {
  if (isInspectionBladeItem(item)) {
    return item.sale_mode === "frame" && Boolean(item.custom_frame_size)
      ? [{ key: "width", label: "Width" }, { key: "height", label: "Height" }]
      : [];
  }
  if (isInspectionMeterItem(item)) return [{ key: "width", label: item.length_label || "Length" }];
  if (isInspectionPieceItem(item)) return [];
  return [{ key: "width", label: item.width_label || "Width" }, { key: "height", label: item.height_label || "Height" }];
};

export const requiresInspectionItemDimensions = (item = {}) => {
  const fields = getInspectionMeasurementFields(item);
  return fields.some((field) => field.key === "width") && fields.some((field) => field.key === "height");
};

const isValidInspectionDate = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const validateInspectionMeasurementRows = (items = []) => {
  const itemErrors = (Array.isArray(items) ? items : []).map((item) => {
    const rowErrors = {};
    if (!normalizeProductId(item.product_id)) rowErrors.product_id = "Select a product.";
    if (!String(item.name || "").trim()) rowErrors.name = "Description is required.";

    const doorConfig = item.finished_door_pricing;
    if (doorConfig?.enabled === true) {
      const mode = item.door_measurement?.mode === "custom" ? "custom" : "standard";
      const value = mode === "custom" ? Number(item.door_measurement?.actual_measurement_cm) : Number(doorConfig.standard_size_cm);
      if (!Number.isFinite(value) || value <= 0) rowErrors.door_measurement = "Door measurement must be greater than zero.";
    }

    for (const field of getInspectionMeasurementFields(item)) {
      const value = item[field.key];
      if (value === "" || value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) {
        rowErrors[field.key] = `${field.label} must be greater than zero.`;
      }
    }

    const quantityValue = item.qty ?? item.quantity;
    if (quantityValue === "" || quantityValue === null || quantityValue === undefined || !Number.isFinite(Number(quantityValue)) || Number(quantityValue) <= 0) {
      rowErrors.qty = "Quantity must be at least 1.";
    }

    if (isInspectionBladeItem(item)) {
      if (!String(item.blade_glass_type || "").trim()) rowErrors.blade_glass_type = "Select a glass type.";
      const minimumBlades = Math.max(1, Number(item.minimum_blades) || 1);
      const maximumBlades = Number(item.maximum_blades) || 0;
      if (item.sale_mode === "frame" && !item.frame_type && !item.custom_frame_size) {
        rowErrors.frame_type = "Select a frame type or enter a custom frame size.";
      }
      if (item.sale_mode === "blades_only" || item.custom_frame_size) {
        const bladeCount = Number(item.blade_count) || 0;
        if (bladeCount < minimumBlades || (maximumBlades > 0 && bladeCount > maximumBlades)) {
          rowErrors.blade_count = `Blade count must be between ${minimumBlades}${maximumBlades > 0 ? ` and ${maximumBlades}` : " or more"}.`;
        }
      }
    }
    const pieceOptions = Array.isArray(item.piece_options) ? item.piece_options : [];
    const selectedPieceOption = String(item.piece_option || "").trim();
    if (["per_piece", "piece", "per_set", "set"].includes(String(item.pricing_method || "").toLowerCase())
      && selectedPieceOption && pieceOptions.length
      && !pieceOptions.some((option) => option.name === selectedPieceOption && Number(option.price_per_piece) > 0)) {
      rowErrors.piece_option = "Select an option.";
    }
    const areaOptions = Array.isArray(item.area_options) ? item.area_options : [];
    const selectedAreaOption = String(item.area_option || "").trim();
    if (["sqft", "per_sqft"].includes(String(item.pricing_method || "").toLowerCase()) && areaOptions.length
      && selectedAreaOption
      && !areaOptions.some((option) => option.name === selectedAreaOption
        && (Number(option.price_per_sqft) > 0 || Number(item.price_per_sqft) > 0 || Number(item.estimated_price_override) > 0))) {
      rowErrors.area_option = "Select an area option.";
    }
    return rowErrors;
  });
  const firstIncompleteRow = itemErrors.findIndex((row) => Object.keys(row).length > 0);
  return {
    itemErrors,
    firstIncompleteRow,
    valid: firstIncompleteRow === -1,
  };
};

export const calculateMeasurementSubtotal = (item, product = null) => {
  const quantity = Number(item.qty ?? item.quantity ?? 1) || 1;
  const measurementUnit = item.measurement_unit || item.measurementUnit || item.dimensions?.unit || "in";
  const inferredMethod = item.pricing_method || (
    Number(item.base_price) > 0 ? "fixed" :
      Number(item.price_per_blade) > 0 ? "blade" :
        "sqft"
  );
  const pricingProduct = product || {
    ...item,
    pricing_method: inferredMethod,
    price_per_sqft: Number(item.price_per_sqft) || (inferredMethod === "sqft" ? Number(item.unit_price || item.price) || 0 : 0),
  };

  return getMeasuredProductLineTotal(pricingProduct, {
    ...item,
    quantity,
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    measurement_unit: measurementUnit,
    customized: Boolean(item.customized ?? item.is_estimate ?? true),
  });
};

export const validateInspectionPayload = (payload = {}, { requireScheduleTimes = false, validateSiteAddress = true } = {}) => {
  const nextErrors = {};

  if (!payload.customerName?.trim()) nextErrors.customerName = "Client name is required.";
  if (!payload.phone?.trim()) nextErrors.phone = "Phone number is required.";
  else if (!isValidPhilippinePhone(payload.phone)) nextErrors.phone = getPhilippinePhoneError(payload.phone);
  if (validateSiteAddress) {
    if (!payload.siteAddress?.trim()) nextErrors.siteAddress = "Site address is required.";
    else if (!isValidStreetAddress(payload.siteAddress)) nextErrors.siteAddress = getStreetAddressError(payload.siteAddress);
  }
  if (!payload.inspection_date) nextErrors.inspection_date = "Inspection date is required.";
  if (!Number.isFinite(Number(payload.inspection_duration_minutes)) || Number(payload.inspection_duration_minutes) < 30) nextErrors.inspection_duration_minutes = "Inspection duration must be at least 30 minutes.";
  if (!Number.isFinite(Number(payload.installation_duration_minutes)) || Number(payload.installation_duration_minutes) < 1) nextErrors.installation_duration_minutes = "Installation duration must be at least 1 minute.";
  if (requireScheduleTimes && payload.inspection_date && !payload.inspection_time) nextErrors.inspection_time = "Choose an inspection start time.";
  if (requireScheduleTimes && payload.estimated_installation_date && !payload.estimated_installation_time) nextErrors.estimated_installation_time = "Choose an installation start time.";
  if (payload.project_additional_charges?.some((charge) => (String(charge.name || "").trim() || String(charge.amount ?? "").trim()) && (!String(charge.name || "").trim() || String(charge.amount ?? "").trim() === "" || !Number.isFinite(Number(charge.amount)) || Number(charge.amount) < 0))) {
    nextErrors.project_additional_charges = "Each additional charge needs a description and a non-negative amount.";
  }
  if (payload.items?.some((item) => (item.additional_project_charges || []).some((charge) => (String(charge.name || "").trim() || String(charge.amount ?? "").trim()) && (!String(charge.name || "").trim() || String(charge.amount ?? "").trim() === "" || !Number.isFinite(Number(charge.amount)) || Number(charge.amount) < 0)))) {
    nextErrors.additional_project_charges = "Each product charge needs a description and a non-negative amount.";
  }
  const installationDateError = getInstallationDateError(payload.inspection_date, payload.estimated_installation_date);
  if (installationDateError) nextErrors.estimated_installation_date = installationDateError;
  if (!payload.items || payload.items.length === 0) nextErrors.items = "Add at least one measurement row.";
  if (
    payload.order_type === "walk_in_customer" &&
    payload.has_account_on_website === true &&
    !getRegisteredCustomerId(payload)
  ) {
    nextErrors.customerId = "Select the matching registered customer account before creating this inspection.";
  }

  const { itemErrors } = validateInspectionMeasurementRows(payload.items || []);

  if (itemErrors.some((row) => Object.keys(row).length > 0)) {
    nextErrors.itemErrors = itemErrors;
  }

  return nextErrors;
};

export const normalizeWalkInWebsiteAccountState = (payload = {}) => {
  const rawOrderType = String(payload.order_type || payload.customerType || payload.customer_type || "").trim().toLowerCase();
  const isWalkInCustomer = [
    "walk_in_customer",
    "walk-in_customer",
    "walk_in",
    "walk-in",
    "walkin",
    "walk in customer",
    "walk-in customer",
  ].includes(rawOrderType);

  if (isWalkInCustomer) {
    return false;
  }

  return Boolean(payload.has_account_on_website);
};

export const resolveInspectionProductPrice = (product = null, fallbackItem = {}) => {
  const pricingMethod = String(product?.pricing_method || fallbackItem?.pricing_method || "").toLowerCase();
  const basePrice = Number(product?.base_price ?? fallbackItem?.base_price ?? 0) || 0;
  const pricePerSqft = Number(product?.price_per_sqft ?? fallbackItem?.price_per_sqft ?? 0) || 0;
  const pricePerBlade = Number(product?.price_per_blade ?? fallbackItem?.price_per_blade ?? 0) || 0;
  const unitPrice = Number(product?.unit_price ?? fallbackItem?.unit_price ?? 0) || 0;
  const estimatedPrice = Number(product?.estimated_price ?? fallbackItem?.estimated_price ?? 0) || 0;
  const customizationFee = Number(product?.customization_fee ?? fallbackItem?.customization_fee ?? 0) || 0;
  const widthValue = Number(product?.width ?? fallbackItem?.width ?? 0) || 0;
  const heightValue = Number(product?.height ?? fallbackItem?.height ?? 0) || 0;
  const width = widthValue || Number(fallbackItem?.width ?? 0) || 1;
  const height = heightValue || Number(fallbackItem?.height ?? 0) || 1;
  const fallbackUnitPrice = unitPrice || basePrice || estimatedPrice || pricePerSqft || pricePerBlade || 0;
  const bladeGlassTypes = product?.blade_glass_types ?? fallbackItem?.blade_glass_types ?? [];
  const pieceOptions = product?.piece_options ?? fallbackItem?.piece_options ?? [];
  const productAreaOptions = Array.isArray(product?.area_options) ? product.area_options : [];
  const areaOptions = productAreaOptions.length ? productAreaOptions : fallbackItem?.area_options ?? [];
  const bladeFrameTypes = product?.blade_frame_types ?? fallbackItem?.blade_frame_types ?? [];
  const hasSameSelectedProduct = Boolean(product && normalizeProductId(fallbackItem.product_id) === normalizeProductId(product._id || product.id));
  const sellBladesOnly = product ? product.sell_blades_only !== false : fallbackItem.sell_blades_only !== false;
  const sellWithFrame = Boolean(product?.sell_with_frame ?? fallbackItem.sell_with_frame);
  const defaultSaleMode = product?.default_sale_mode || fallbackItem.default_sale_mode || (sellBladesOnly ? "blades_only" : "frame");
  const defaultFrame = bladeFrameTypes.find((frame) => frame.name === (product?.default_frame_type || fallbackItem.default_frame_type)) || bladeFrameTypes[0];
  const saleMode = hasSameSelectedProduct ? fallbackItem.sale_mode || defaultSaleMode : defaultSaleMode;
  const pieceOption = hasSameSelectedProduct ? fallbackItem.piece_option || "" : "";
  const areaOption = hasSameSelectedProduct ? fallbackItem.area_option || "" : "";
  const selectedAreaRate = pricePerSqft;
  const selectedFrame = bladeFrameTypes.find((frame) => frame.name === (hasSameSelectedProduct ? fallbackItem.frame_type : defaultFrame?.name)) || defaultFrame;
  const bladeSelectionDefaults = {
    blade_glass_types: bladeGlassTypes,
    piece_options: pieceOptions,
    area_options: areaOptions,
    piece_option: pieceOption,
    area_option: areaOption,
    sell_blades_only: sellBladesOnly,
    sell_with_frame: sellWithFrame,
    blade_frame_types: bladeFrameTypes,
    allow_custom_frame_size: Boolean(product?.allow_custom_frame_size ?? fallbackItem.allow_custom_frame_size),
    custom_frame_size_unit: product?.custom_frame_size_unit || fallbackItem.custom_frame_size_unit || "in",
    custom_frame_price: Number(product?.custom_frame_price ?? fallbackItem.custom_frame_price) || 0,
    minimum_blades: Math.max(1, Number(product?.minimum_blades ?? fallbackItem.minimum_blades) || 1),
    maximum_blades: Number(product?.maximum_blades ?? fallbackItem.maximum_blades) || 0,
    customer_can_choose_blade_count: Boolean(product?.customer_can_choose_blade_count ?? fallbackItem.customer_can_choose_blade_count),
    default_blade_glass_type: product?.default_blade_glass_type || fallbackItem.default_blade_glass_type || bladeGlassTypes[0]?.name || "",
    default_sale_mode: defaultSaleMode,
    default_frame_type: product?.default_frame_type || fallbackItem.default_frame_type || defaultFrame?.name || "",
    show_price_per_blade: product?.show_price_per_blade !== false,
    blade_glass_type: hasSameSelectedProduct
      ? fallbackItem.blade_glass_type || product?.default_blade_glass_type || bladeGlassTypes[0]?.name || ""
      : product?.default_blade_glass_type || bladeGlassTypes[0]?.name || "",
    sale_mode: saleMode,
    frame_type: selectedFrame?.name || "",
    custom_frame_size: hasSameSelectedProduct ? Boolean(fallbackItem.custom_frame_size) : false,
    blade_count: hasSameSelectedProduct
      ? Number(fallbackItem.blade_count) || Number(selectedFrame?.blade_count) || Number(product?.minimum_blades) || 1
      : saleMode === "frame"
        ? Number(selectedFrame?.blade_count) || Number(product?.minimum_blades) || 1
        : Number(product?.minimum_blades) || 1,
    frame_price: saleMode === "frame"
      ? hasSameSelectedProduct && fallbackItem.custom_frame_size
        ? Number(product?.custom_frame_price) || Number(fallbackItem.frame_price) || 0
        : Number(selectedFrame?.price) || 0
      : 0,
  };
  const pricingDetails = {
    ...bladeSelectionDefaults,
    measurement_unit: product?.measurement_unit || fallbackItem?.measurement_unit || fallbackItem?.measurementUnit || "in",
    customization: Boolean(product?.customization ?? fallbackItem?.customization),
    customization_fee: customizationFee,
    estimated_price_override: Number(product?.estimated_price_override ?? fallbackItem?.estimated_price_override ?? 0) || 0,
    extra_charges: product?.extra_charges ?? fallbackItem?.extra_charges ?? [],
    size_limits: product?.size_limits ?? fallbackItem?.size_limits ?? {},
    finished_door_pricing: product?.finished_door_pricing ?? fallbackItem?.finished_door_pricing ?? { enabled: false },
  };

  switch (pricingMethod) {
    case "sqft":
      return {
        ...pricingDetails,
        pricing_method: "sqft",
        unit_price: selectedAreaRate || fallbackUnitPrice,
        price_per_sqft: selectedAreaRate,
        price_per_blade: 0,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
    case "blade":
      return {
        ...pricingDetails,
        pricing_method: "blade",
        unit_price: pricePerBlade || fallbackUnitPrice,
        price_per_sqft: 0,
        price_per_blade: pricePerBlade,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
    case "fixed":
      return {
        ...pricingDetails,
        pricing_method: "fixed",
        unit_price: basePrice || estimatedPrice || fallbackUnitPrice,
        price_per_sqft: pricePerSqft,
        price_per_blade: pricePerBlade,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
    case "per_piece":
      return {
        ...pricingDetails,
        pricing_method: "per_piece",
        unit_price: Number(product?.estimated_price_override ?? fallbackItem?.estimated_price_override) || basePrice || unitPrice || estimatedPrice || fallbackUnitPrice,
        price_per_sqft: pricePerSqft,
        price_per_blade: pricePerBlade,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
    default:
      if (pricePerSqft > 0) {
        return {
          ...pricingDetails,
          pricing_method: "sqft",
          unit_price: pricePerSqft,
          price_per_sqft: pricePerSqft,
          price_per_blade: 0,
          base_price: basePrice,
          customization_fee: customizationFee,
          width,
          height,
        };
      }
      if (pricePerBlade > 0) {
        return {
          ...pricingDetails,
          pricing_method: "blade",
          unit_price: pricePerBlade,
          price_per_sqft: 0,
          price_per_blade: pricePerBlade,
          base_price: basePrice,
          customization_fee: customizationFee,
          width,
          height,
        };
      }
      return {
        ...pricingDetails,
        pricing_method: pricingMethod || "fixed",
        unit_price: basePrice || estimatedPrice || fallbackUnitPrice,
        price_per_sqft: pricePerSqft,
        price_per_blade: pricePerBlade,
        base_price: basePrice,
        customization_fee: customizationFee,
        width,
        height,
      };
  }
};

const getRegisteredCustomerId = (inspection = {}) => {
  const candidateIds = [
    inspection.customer,
    inspection.customer_id,
    inspection.customerId,
    inspection.userId,
    inspection.accountId,
  ].map((value) => (
    value && typeof value === "object" ? value._id || value.id : value
  ));
  const customerId = candidateIds.find(Boolean);
  return customerId ? String(customerId).trim() : "";
};

export const isOnlineCustomerInspection = (inspection = {}) => {
  if (getRegisteredCustomerId(inspection)) return true;

  const customerType = String(inspection.customerType || inspection.customer_type || "").trim().toLowerCase();
  return ["online", "online_customer", "online customer"].includes(customerType);
};

export const getInspectionDisplayTotal = (inspection = {}, itemTotal = 0) => {
  const savedTotal = getFinalProjectCost(inspection);
  return savedTotal > 0 ? savedTotal : Number(itemTotal) || 0;
};

export const isSiteInspectionVisible = (order) => {
  if (!order) return false;

  const status = normalizeWorkflowValue(order.status);
  const contractStatus = normalizeWorkflowValue(order.contract_status);

  // Keep older customer submissions visible after restoring direct Site Inspection intake.
  if (status === "order_submitted") return !contractStatus || contractStatus === "pending";
  if (status !== SITE_INSPECTION_STATUS) return false;
  if (CONTRACT_STAGE_STATUSES.has(status)) return false;
  if (!SITE_INSPECTION_CONTRACT_STATUSES.has(contractStatus)) return false;

  return true;
};
/* eslint-enable react-refresh/only-export-components */

function SiteInspection() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const canGenerateBlankContract = ["admin", "super_admin"].includes(user?.role);
  const hidePaymentAmounts = user?.role === "skilled_worker" && user?.staff_access?.hide_payment_amounts === true;
  const { darkMode } = useAdminTheme();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRecordId = searchParams.get("view");
  const highlightedNotificationRecordId = useNotificationHighlight(location);
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("sidebarOpen");
    return stored !== null ? JSON.parse(stored) : true;
  });
  const [showModal, setShowModal] = useState(false);
  const [exitConfirmation, setExitConfirmation] = useState(null);
  const newInspectionBaselineRef = useRef("");
  const editInspectionBaselineRef = useRef("");
  const editInspectionAddressBaselineRef = useRef("");
  const [newInspectionStep, setNewInspectionStep] = useState(1);
  const newInspectionBodyRef = useRef(null);
  const [inspections, setInspections] = useState([]);
  const [rushOrderRecords, setRushOrderRecords] = useState([]);
  const [restrictionClock, setRestrictionClock] = useState(() => Date.now());
  const [showInspectionActions, setShowInspectionActions] = useState(true);
  const [inspectionsLoading, setInspectionsLoading] = useState(false);
  const [inspectionLoadError, setInspectionLoadError] = useState("");
  const inspectionFetchStateRef = useRef({ inFlight: false, refreshQueued: false });
  const [generatingId, setGeneratingId] = useState(null);
  const [cancelledInspections, setCancelledInspections] = useState([]);
  const [cancellationReasonInspection, setCancellationReasonInspection] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [viewInspection, setViewInspection] = useState(null);
  const [requestedModalRecordId, setRequestedModalRecordId] = useState("");
  const [requestedModalLocationKey, setRequestedModalLocationKey] = useState("");
  const [requestedRecordError, setRequestedRecordError] = useState(null);
  const [editInspection, setEditInspection] = useState(null);
  const [manualOverrideLocked, setManualOverrideLocked] = useState(false);
  const [editInspectionStep, setEditInspectionStep] = useState(1);
  const [highCancellationConfirmation, setHighCancellationConfirmation] = useState(false);
  const [editMeasurementsEnabled, setEditMeasurementsEnabled] = useState(false);
  const [measurementDeleteConfirmation, setMeasurementDeleteConfirmation] = useState(null);
  const [measurementValidationAttempted, setMeasurementValidationAttempted] = useState({ new: false, edit: false });
  const editInspectionBodyRef = useRef(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [activeTab, setActiveTab] = useState("site");
  useEffect(() => {
    const timer = window.setInterval(() => setRestrictionClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (location.state?.activeTab === "cancelled") setActiveTab("cancelled");
  }, [location.key, location.state?.activeTab]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [customerTypeFilter, setCustomerTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [newInspection, setNewInspection] = useState(getDefaultInspection());
  const [businessHours, setBusinessHours] = useState({ open: "08:00", close: "18:00", timezone: "Asia/Manila" });
  const [newManualOverrideLocked, setNewManualOverrideLocked] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState([]);
  const [, setProductsLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showContractModal, setShowContractModal] = useState(false);
  const [showBlankContractModal, setShowBlankContractModal] = useState(false);
  const [showContractGenerationProgress, setShowContractGenerationProgress] = useState(false);
  const [contractData, setContractData] = useState(null);
  const [contractInspection, setContractInspection] = useState(null);
  const openContractButtonHandlerRef = useRef(null);
  const fetchSiteInspectionsRef = useRef(null);
  const [, setContractNeedsRegeneration] = useState(false);
  const [sendingCustomerEmail, setSendingCustomerEmail] = useState(false);
  const contractModalLoadRequestRef = useRef(0);
  const [manualApprovalModal, setManualApprovalModal] = useState({
    open: false,
    orderId: null,
    tracking: "",
    uploadedUrl: "",
    fileName: "",
    uploading: false,
    error: "",
  });
  const manualApprovalFileInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    getSystemSettings().then((response) => {
      if (active && response?.business_hours?.open && response?.business_hours?.close) {
        setBusinessHours(response.business_hours);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const changeInspectionStep = (step, setStep, bodyRef) => {
    setStep(step);
    requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const advanceInspectionForm = (payload, setStep, bodyRef) => {
    const validationErrors = validateInspectionPayload(payload);
    const firstStepFields = ["customerName", "phone", "siteAddress", "inspection_date", "estimated_installation_date", "customerId"];
    const firstStepErrors = Object.fromEntries(
      Object.entries(validationErrors).filter(([field]) => firstStepFields.includes(field)),
    );
    setErrors((current) => {
      const nextErrors = { ...current };
      firstStepFields.forEach((field) => delete nextErrors[field]);
      return { ...nextErrors, ...firstStepErrors };
    });
    const firstError = Object.values(firstStepErrors)[0];
    if (firstError) {
      toast.error(Array.isArray(firstError) ? "Please complete the required customer and schedule details." : firstError);
      return false;
    }
    changeInspectionStep(2, setStep, bodyRef);
    return true;
  };

  const selectInspectionTab = (targetStep, currentStep, payload, setStep, bodyRef) => {
    if (targetStep === 1) {
      changeInspectionStep(1, setStep, bodyRef);
      return true;
    } else if (currentStep === 1) {
      return advanceInspectionForm(payload, setStep, bodyRef);
    } else {
      changeInspectionStep(2, setStep, bodyRef);
      return true;
    }
  };

  const today = new Date().toISOString().split("T")[0];
  const getPhilippineDateKey = (value) => {
    const rawValue = String(value || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return rawValue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  };
  const getRushOrderCountForDate = (date, excludeOrderId = "") => {
    const dateKey = getPhilippineDateKey(date);
    if (!dateKey) return 0;
    return rushOrderRecords
      .filter((inspection) => (
        getPhilippineDateKey(inspection.inspection_date) === dateKey
        && String(inspection._id || inspection.id || "") !== String(excludeOrderId || "")
        && String(inspection.status || "").toLowerCase() !== "cancelled"
      ))
      .reduce((total, inspection) => total + getRushSlotsForInspection(inspection), 0);
  };
  const hasSelectedRushCharge = (item = {}) => {
    const product = products.find((entry) => normalizeProductId(entry?._id || entry?.id) === normalizeProductId(item?.product_id));
    const charges = Array.isArray(item.extra_charges) && item.extra_charges.length
      ? item.extra_charges
      : product?.extra_charges || [];
    return charges.some((charge) => (
      charge?.is_active !== false
      && charge?.is_selected === true
      && /rush/i.test(String(charge?.name || charge?.label || ""))
    ));
  };
  const getSelectedRushChargeCount = (items = []) => (items || []).filter(hasSelectedRushCharge).length;
  const getRushSlotsForInspection = (inspection = {}) => (
    getSelectedRushChargeCount(inspection.items || []) > 0 ? 1 : 0
  );
  const disableUnavailableRushCharges = (charges = []) => (charges || []).map((charge) => (
    /rush/i.test(String(charge?.name || charge?.label || ""))
      ? { ...charge, is_selected: false }
      : charge
  ));
  const pageSize = 10;
  const formatCurrency = (value) => hidePaymentAmounts
    ? "••••••"
    : new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  const getDimensionInputValue = (value) => value === 0 ? "" : value ?? "";
  const clearDefaultDimensionZero = (id, field, value, onChange) => {
    if (value !== "" && value !== null && value !== undefined && Number(value) === 0) {
      onChange(id, field, "");
    }
  };
  const getItemWarrantySelectValue = (item) => {
    if (item.warranty_period === "No Warranty") return "No Warranty";
    if (item.warranty_period === "Custom") return "Custom";
    const days = getWarrantyPeriodDays(item.warranty_period ?? 90);
    return [30, 60, 90].includes(days) ? String(days) : "Custom";
  };
  const getItemWarrantyCustomDays = (item) => (
    Number(item.custom_warranty_days) || getWarrantyPeriodDays(item.warranty_period) || ""
  );

  const modalShellClass = darkMode
    ? "border border-slate-700/80 bg-[#071d2d] text-slate-100 shadow-[0_28px_100px_rgba(0,0,0,0.55)] ring-1 ring-white/5"
    : "border border-slate-200 bg-white text-slate-900 shadow-[0_28px_80px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/5";
  const modalHeaderClass = darkMode ? "border-b border-slate-700 bg-[#0b2338]" : "border-b border-slate-200 bg-slate-50";
  const modalSectionClass = darkMode ? "border border-slate-700 bg-[#0f2438] shadow-sm shadow-black/10" : "border border-slate-200 bg-white shadow-sm";
  const modalSectionTitleClass = `mb-4 border-b pb-3 text-xs font-bold uppercase tracking-[0.14em] ${darkMode ? "border-slate-700 text-red-300" : "border-slate-200 text-red-700"}`;
  const fieldClass = darkMode
    ? "min-h-11 w-full rounded-lg border border-slate-600 bg-[#122d42] px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-500/20"
    : "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-red-500 focus:ring-2 focus:ring-red-100";
  const lockedFieldClass = darkMode
    ? "w-full cursor-not-allowed rounded-xl border border-gray-600 bg-gray-700 px-3 py-3 text-sm text-gray-200 shadow-inner outline-none placeholder:text-gray-400"
    : "w-full cursor-not-allowed rounded-xl border border-gray-300 bg-gray-200 px-3 py-3 text-sm text-gray-600 shadow-inner outline-none placeholder:text-gray-500";
  const labelClass = darkMode ? "text-slate-200" : "text-slate-700";
  const mutedTextClass = darkMode ? "text-slate-400" : "text-slate-500";
  const statusBadgeClass = darkMode
    ? "flex h-[48px] items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 text-sm font-bold text-amber-200"
    : "flex h-[48px] items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-700";
  const inspectionStatus = newInspection.inspection_date ? {
    label: "Scheduled",
    icon: "✓",
    className: darkMode
      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : "border border-emerald-200 bg-emerald-50 text-emerald-700",
  } : {
    label: "Need to be Called",
    icon: <Phone size={16} aria-hidden="true" />,
    className: statusBadgeClass,
  };
  const footerClass = darkMode ? "border-t border-slate-700 bg-[#0b2338]" : "border-t border-slate-200 bg-slate-50";
  const secondaryButtonClass = darkMode
    ? "rounded-xl border border-slate-600 bg-slate-800 px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-slate-700"
    : "rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100";
  const primaryButtonClass = darkMode
    ? "rounded-xl bg-red-600 px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-70"
    : "rounded-xl bg-red-600 px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-70";
  const paymentTermsWithAgreedDate = new Set(["full_payment", "installment_3_months", "installment_6_months", "custom_arrangement"]);
  const shouldShowAgreedPaymentDate = (value = "") => paymentTermsWithAgreedDate.has(String(value).trim());
  const isFullPaymentPlan = (value = "") => String(value).trim() === "full_payment";
  const resolveRequiredPaymentAmount = (terms, total, configuredAmount) => {
    return calculateRequiredDownpayment(total, terms, configuredAmount);
  };
  const getPaymentTermsLabel = (value = "") => {
    switch (String(value).trim()) {
      case "50%_down_payment":
        return "50% downpayment, 50% upon completion";
      case "full_payment":
        return "Full Payment";
      case "installment_3_months":
        return "Installment (3 months)";
      case "installment_6_months":
        return "Installment (6 months)";
      case "custom_arrangement":
        return "Custom Arrangement";
      default:
        return "50% downpayment, 50% upon completion";
    }
  };
  const getPaymentReceivedQuestion = (value = "") => (isFullPaymentPlan(value) ? "Payment Received?" : "Downpayment Received?");
  const getPaymentStatusLabel = (value = "") => (isFullPaymentPlan(value) ? "Payment Status" : "Downpayment Status");
  const isPastDateValue = (value) => {
    if (!value) return false;
    const inputDate = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Number.isNaN(inputDate.getTime()) ? false : inputDate < today;
  };
  const actionButtonClass = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/5 shadow-sm transition hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:border-white/10";

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, statusFilter, customerTypeFilter, priorityFilter, cancelledInspections.length, inspections.length]);

  const fetchSiteInspections = useCallback(async (showLoading = true) => {
    const fetchState = inspectionFetchStateRef.current;
    if (fetchState.inFlight) {
      fetchState.refreshQueued = true;
      return;
    }
    fetchState.inFlight = true;
    if (showLoading) setInspectionsLoading(true);
    try {
      const fetchAllPages = async (status) => {
        const orders = [];
        let page = 1;
        let totalPages;
        do {
          const response = await getAdminOrders({
            ...(status ? { status } : {}),
            module: "site_inspection",
            limit: 100,
            ...(page > 1 ? { page } : {}),
          });
          orders.push(...(response.orders || []));
          totalPages = response.pagination?.totalPages || 1;
          page += 1;
        } while (page <= totalPages);
        return orders;
      };
      const allModuleOrders = await fetchAllPages();
      setRushOrderRecords(allModuleOrders);
      setInspections(allModuleOrders.filter(isSiteInspectionVisible));
      setCancelledInspections(allModuleOrders.filter((order) => String(order.status || "").toLowerCase() === "cancelled"));
      setInspectionLoadError("");
    } catch (error) {
      console.error("Failed to load site inspection records:", error);
      if (showLoading) {
        setInspectionLoadError(error?.data?.message || error?.message || "Unable to load Site Inspection records. Please try again.");
      }
    } finally {
      if (showLoading) setInspectionsLoading(false);
      fetchState.inFlight = false;
      if (fetchState.refreshQueued) {
        fetchState.refreshQueued = false;
        window.setTimeout(() => fetchSiteInspectionsRef.current?.(false), 0);
      }
    }
  }, []);
  fetchSiteInspectionsRef.current = fetchSiteInspections;


  const resetNewInspectionForm = () => {
    const initialInspection = getDefaultInspection();
    setNewInspection(initialInspection);
    setNewManualOverrideLocked(true);
    setErrors({});
    setCustomerSearch("");
    setCustomerSuggestions([]);
    setCustomerSearchError("");
    setSelectedCustomer(null);
    return initialInspection;
  };

  const closeNewInspectionModal = () => {
    setShowModal(false);
    resetNewInspectionForm();
  };

  const requestCloseNewInspection = () => {
    const current = createUnsavedSnapshot({ inspection: newInspection, customerSearch, selectedCustomer });
    if (current !== newInspectionBaselineRef.current) setExitConfirmation("new-inspection");
    else closeNewInspectionModal();
  };
  const requestCloseEditInspection = () => {
    if (createUnsavedSnapshot(editInspection) !== editInspectionBaselineRef.current) setExitConfirmation("edit-inspection");
    else setEditInspection(null);
  };
  const discardInspectionChanges = () => {
    const pending = exitConfirmation;
    setExitConfirmation(null);
    if (pending === "new-inspection") closeNewInspectionModal();
    if (pending === "edit-inspection") setEditInspection(null);
  };

  const requestCloseNewInspectionRef = useRef(requestCloseNewInspection);
  const requestCloseEditInspectionRef = useRef(requestCloseEditInspection);
  requestCloseNewInspectionRef.current = requestCloseNewInspection;
  requestCloseEditInspectionRef.current = requestCloseEditInspection;
  const isEditInspectionOpen = Boolean(editInspection);

  useEffect(() => {
    if (!showModal && !isEditInspectionOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key !== "Escape" || exitConfirmation) return;
      event.preventDefault();
      if (showModal) requestCloseNewInspectionRef.current();
      else requestCloseEditInspectionRef.current();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showModal, isEditInspectionOpen, exitConfirmation]);

  const formatCustomerAddress = (customer) => {
    if (!customer) return "";
    return [customer.street_address, customer.city, customer.province, customer.zip_code]
      .filter(Boolean)
      .join(", ");
  };

  const handleClientNameInput = (value) => {
    setCustomerSearch(value);
    setSelectedCustomer(null);
    setCustomerSearchError("");
    setCustomerSuggestions([]);
    setNewInspection((prev) => {
      const isClearingSelectedCustomer = Boolean(prev.customerId);
      const isClientNameEmpty = !value.trim();

      return {
        ...prev,
        customerName: value,
        customerEmail: "",
        phone: isClearingSelectedCustomer || isClientNameEmpty ? "" : prev.phone,
        siteAddress: isClearingSelectedCustomer || isClientNameEmpty ? "" : prev.siteAddress,
        order_type: value.trim() ? "walk_in_customer" : "online_order",
        customerId: null,
        customerType: "walk-in",
        has_account_on_website: isClearingSelectedCustomer || isClientNameEmpty ? false : prev.has_account_on_website,
      };
    });
  };

  const handleCustomerSelect = (customer) => {
    const fullName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || customer.email || "";
    setSelectedCustomer(customer);
    setCustomerSearch(fullName);
    setCustomerSuggestions([]);
    setCustomerSearchError("");
    setNewInspection((prev) => {
      const isWalkInAccountLink = prev.order_type === "walk_in_customer" && prev.has_account_on_website;
      return {
        ...prev,
        customerId: customer._id,
        customerName: fullName,
        customerEmail: customer.email || "",
        phone: customer.phone || "",
        siteAddress: formatCustomerAddress(customer),
        order_type: isWalkInAccountLink ? "walk_in_customer" : "online_order",
        customerType: isWalkInAccountLink ? "walk-in" : "online",
        has_account_on_website: true,
      };
    });
  };

  const filterInspections = (list) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return list;
    return (list || []).filter((inspection) => {
      const clientName = `${inspection.customer?.first_name || ""} ${inspection.customer?.last_name || ""}`.trim()
        || inspection.customer_name
        || inspection.customer?.email
        || inspection.customer_email
        || "";
      const trackingId = inspection.tracking
        || inspection.order_number
        || inspection.orderId
        || `SI-${String(inspection._id || inspection.id || "").slice(-8).toUpperCase()}`;
      const itemNames = (inspection.items || []).flatMap((item) => [
        item.name,
        item.product_name,
        item.product_id?.name,
      ]);
      const displayStatus = activeTab === "cancelled"
        ? "Cancelled"
        : hasValidInspectionDate(inspection)
          ? "Scheduled"
          : "Need to be Called";
      const searchableValues = [
        clientName,
        inspection.customer?.email,
        inspection.customer_email,
        inspection.customer?.phone,
        inspection.customer_phone,
        trackingId,
        ...itemNames,
        inspection.shipping_address,
        inspection.siteAddress,
        inspection.customer?.street_address,
        inspection.status,
        inspection.inspection_status,
        displayStatus,
        inspection.order_type,
        inspection.customerType,
        inspection.createdAt,
        formatDateToMMMDDYYYY(inspection.createdAt),
        inspection.inspection_date,
        formatDateToMMMDDYYYY(inspection.inspection_date),
        getEstimatedInstallationDate(inspection),
        formatDateToMMMDDYYYY(getEstimatedInstallationDate(inspection)),
      ];
      return searchableValues
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
  };


  const normalizeProductId = (productId) => {
    if (typeof productId === "object" && productId !== null) {
      return String(productId._id || productId.id || productId);
    }
    return productId ? String(productId) : "";
  };

  const getEditItemFromOrderItem = (item) => {
    const normalizedProductId = normalizeProductId(item.product_id || item._id);
    const selectedProduct = products.find((p) => String(p._id || p.id) === normalizedProductId) || null;
    const quantity = item.quantity !== undefined && item.quantity !== null
      ? Number(item.quantity)
      : item.qty !== undefined && item.qty !== null
        ? Number(item.qty)
        : 1;
    const providedWidth = item.width !== undefined && item.width !== null ? Number(item.width) : 0;
    const providedHeight = item.height !== undefined && item.height !== null ? Number(item.height) : 0;
    const widthValue = providedWidth > 0 ? providedWidth : Number(selectedProduct?.width || 0);
    const heightValue = providedHeight > 0 ? providedHeight : Number(selectedProduct?.height || 0);
    const measurementUnit = item.measurement_unit || item.measurementUnit || item.dimensions?.unit || selectedProduct?.measurement_unit || "in";
    const areaValue = item.area !== undefined && item.area !== null && Number(item.area) > 0
      ? Number(item.area)
      : calculateMeasurementArea(widthValue, heightValue, quantity, measurementUnit);
    const productUnitPrice = deriveUnitPriceForPayload({
      ...item,
      product_id: normalizedProductId,
      unit_price: item.unit_price,
    });
    const unitPriceValue = selectedProduct
      ? productUnitPrice
      : item.unit_price !== undefined && item.unit_price !== null && Number(item.unit_price) > 0
        ? Number(item.unit_price)
        : productUnitPrice;
    const estimationMode = item.is_estimate ? (item.estimation_mode || "auto") : "auto";
    const savedExtraCharges = Array.isArray(item.extra_charges) ? item.extra_charges : [];
    const configuredExtraCharges = Array.isArray(selectedProduct?.extra_charges) ? selectedProduct.extra_charges : [];
    const orderExtraCharges = savedExtraCharges.length ? savedExtraCharges : configuredExtraCharges;

    return {
      ...item,
      id: item.id || item._id || `${Date.now()}-${Math.random()}`,
      product_id: normalizedProductId,
      name: item.name || selectedProduct?.name || "",
      pricing_method: selectedProduct?.pricing_method || item.pricing_method || "",
      qty: quantity,
      quantity,
      measurement_unit: measurementUnit,
      width: widthValue ? String(widthValue) : "",
      height: heightValue ? String(heightValue) : "",
      area: areaValue,
      unit_price: unitPriceValue,
      unit: item.unit || selectedProduct?.unit || "sqft",
      estimation_mode: estimationMode,
      manual_estimated_total: item.manual_estimated_total ?? (estimationMode === "manual" ? String(item.estimated_price || "") : ""),
      category: selectedProduct?.category || item.category || item.product_type || "",
      product_type: selectedProduct?.product_type || item.product_type || "",
      finished_door_pricing: selectedProduct?.finished_door_pricing || item.finished_door_pricing || { enabled: false },
      door_measurement: selectedProduct?.finished_door_pricing?.enabled
        ? item.door_measurement || { mode: "standard", actual_measurement_cm: Number(selectedProduct.finished_door_pricing.standard_size_cm) || 190 }
        : item.door_measurement || null,
      base_price: selectedProduct ? Number(selectedProduct.base_price) || 0 : Number(item.base_price) || 0,
      price_per_sqft: selectedProduct ? Number(selectedProduct.price_per_sqft) || 0 : Number(item.price_per_sqft) || 0,
      price_per_blade: selectedProduct ? Number(selectedProduct.price_per_blade) || 0 : Number(item.price_per_blade) || 0,
      blade_glass_types: selectedProduct?.blade_glass_types || item.blade_glass_types || [],
      piece_options: selectedProduct?.piece_options || item.piece_options || [],
      piece_option: item.piece_option || "",
      area_options: selectedProduct?.area_options || item.area_options || [],
      area_option: item.area_option || "",
      sell_blades_only: selectedProduct ? selectedProduct.sell_blades_only !== false : item.sell_blades_only !== false,
      sell_with_frame: selectedProduct ? Boolean(selectedProduct.sell_with_frame) : Boolean(item.sell_with_frame),
      blade_frame_types: selectedProduct?.blade_frame_types || item.blade_frame_types || [],
      allow_custom_frame_size: selectedProduct ? Boolean(selectedProduct.allow_custom_frame_size) : Boolean(item.allow_custom_frame_size),
      custom_frame_size_unit: selectedProduct?.custom_frame_size_unit || item.custom_frame_size_unit || "in",
      custom_frame_price: selectedProduct ? Number(selectedProduct.custom_frame_price) || 0 : Number(item.custom_frame_price) || 0,
      minimum_blades: selectedProduct ? Math.max(1, Number(selectedProduct.minimum_blades) || 1) : Math.max(1, Number(item.minimum_blades) || 1),
      maximum_blades: selectedProduct ? Number(selectedProduct.maximum_blades) || 0 : Number(item.maximum_blades) || 0,
      customer_can_choose_blade_count: selectedProduct ? Boolean(selectedProduct.customer_can_choose_blade_count) : Boolean(item.customer_can_choose_blade_count),
      default_blade_glass_type: selectedProduct?.default_blade_glass_type || item.default_blade_glass_type || "",
      default_sale_mode: selectedProduct?.default_sale_mode || item.default_sale_mode || "blades_only",
      default_frame_type: selectedProduct?.default_frame_type || item.default_frame_type || "",
      show_price_per_blade: selectedProduct ? selectedProduct.show_price_per_blade !== false : item.show_price_per_blade !== false,
      blade_glass_type: item.blade_glass_type || selectedProduct?.default_blade_glass_type || selectedProduct?.blade_glass_types?.[0]?.name || "",
      sale_mode: item.sale_mode || selectedProduct?.default_sale_mode || (selectedProduct?.sell_blades_only === false ? "frame" : "blades_only"),
      frame_type: item.frame_type || selectedProduct?.default_frame_type || selectedProduct?.blade_frame_types?.[0]?.name || "",
      custom_frame_size: Boolean(item.custom_frame_size),
      frame_price: Number(item.frame_price) || 0,
      saved_line_total: Number(item.line_total) > 0 ? Number(item.line_total) : Number(item.estimated_price) || 0,
      blade_count: Number(item.blade_count) || Number(selectedProduct?.blade_count) || Number(selectedProduct?.minimum_blades) || 1,
      customization_fee: selectedProduct ? Number(selectedProduct.customization_fee) || 0 : Number(item.customization_fee) || 0,
      customization: selectedProduct ? Boolean(selectedProduct.customization) : Boolean(item.customization),
      estimated_price_override: selectedProduct ? Number(selectedProduct.estimated_price_override) || 0 : Number(item.estimated_price_override) || 0,
      // Keep the customer's saved optional-charge selections when loading the order for admin editing.
      extra_charges: orderExtraCharges,
      size_limits: selectedProduct?.size_limits || item.size_limits || {},
      variant: selectedProduct?.variant || item.variant || "",
    };
  };

  const calculateItemArea = (item) => {
    return calculateMeasurementArea(
      item.width,
      item.height,
      item.qty ?? item.quantity ?? 1,
      item.measurement_unit || item.measurementUnit || item.dimensions?.unit || "in",
    );
  };

  const getInspectionItemTotal = (item) => {
    const product = getInspectionProductForItem(item) || item;
    if (isFinishedDoorPricingEnabled(product)) {
      const breakdown = getFinishedDoorMeasurementBreakdown(product, { ...item, quantity: item.qty ?? item.quantity });
      if (!breakdown || !Number.isFinite(Number(breakdown.actual_measurement_cm)) || breakdown.actual_measurement_cm <= 0) return 0;
      return breakdown.final_item_price + getItemAdditionalChargesTotal(item);
    }
    const manualTotal = Number(item.manual_estimated_total ?? 0);
    if (item.estimation_mode === "manual" && Number.isFinite(manualTotal) && manualTotal > 0) {
      const quantity = Number(item.qty ?? item.quantity ?? 1) || 1;
      const selectedCharges = (Array.isArray(item.extra_charges) ? item.extra_charges : [])
        .filter((charge) => charge?.is_active !== false && (charge?.is_optional !== true || charge?.is_selected === true));
      const chargeTotal = selectedCharges.reduce((total, charge) => {
        const amount = Number(charge.amount) || 0;
        if (charge.type === "percentage") return total + manualTotal * amount / 100;
        if (charge.type === "per_sqft") return total + calculateItemArea(item) * amount;
        if (charge.type === "per_blade") return total + (Number(item.blade_count) || 0) * amount * quantity;
        return total + amount * quantity;
      }, 0);
      return Math.round((manualTotal + chargeTotal) * 100) / 100;
    }

    const subtotal = calculateRowSubtotal(item);
    if (subtotal > 0) return subtotal;

    const savedEstimate = Number(item.estimated_price ?? item.total_price ?? item.amount ?? item.line_total ?? 0);
    if (Number.isFinite(savedEstimate) && savedEstimate > 0) return savedEstimate;

    const qty = Number(item.qty ?? item.quantity ?? 1) || 1;
    const unitPrice = Number(item.unit_price ?? item.price ?? 0) || 0;
    return qty * unitPrice;
  };

  const calculateRowSubtotal = (item) => {
    const normalizedProductId = normalizeProductId(item.product_id);
    const product = products.find((p) => String(p._id || p.id) === normalizedProductId) || null;
    if (isFinishedDoorPricingEnabled(product || item)) {
      return getFinishedDoorMeasurementBreakdown(product || item, { ...item, quantity: item.qty ?? item.quantity })?.final_item_price || 0;
    }
    return calculateMeasurementSubtotal(item, product);
  };

  const isFinishedDoorInspectionItem = (item) => {
    const product = getInspectionProductForItem(item) || item;
    return isFinishedDoorPricingEnabled(product);
  };

  const changeDoorMeasurementMode = (handler, item, mode) => {
    const config = item.finished_door_pricing || getInspectionProductForItem(item)?.finished_door_pricing || {};
    handler(item.id, "door_measurement", {
      mode,
      actual_measurement_cm: mode === "custom" ? item.door_measurement?.actual_measurement_cm ?? "" : Number(config.standard_size_cm) || 190,
    });
  };

  const renderDoorMeasurementControls = (item, handler) => {
    if (!isFinishedDoorInspectionItem(item)) return null;
    const config = item.finished_door_pricing || {};
    const mode = item.door_measurement?.mode || "standard";
    const standard = Number(config.standard_size_cm) || 190;
    const actual = mode === "custom" ? item.door_measurement?.actual_measurement_cm ?? "" : standard;
    const breakdown = getFinishedDoorMeasurementBreakdown(getInspectionProductForItem(item) || item, { ...item, quantity: item.qty ?? item.quantity });
    const classes = darkMode ? "rounded-lg border border-slate-700 bg-[#122d42] px-3 py-2 text-sm text-slate-100" : "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";
    const priceBehavior = [
      [`Below ${standard} cm`, "Same standard price"],
      [`Exactly ${standard} cm`, "Same standard price"],
      [`Above ${standard} cm`, "Add excess-size charge"],
    ];
    return <div className={`col-span-full rounded-xl border p-3 ${darkMode ? "border-blue-400/30 bg-blue-400/5" : "border-blue-200 bg-blue-50/60"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>Finished Door - Measurement</p>
        <p className={`text-xs font-semibold ${darkMode ? "text-blue-200" : "text-blue-800"}`}>Standard Price: {formatCurrency(breakdown?.standard_price_per_piece ?? (Number(config.standard_price_per_piece) || 0))} / piece</p>
      </div>
      <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-blue-200 bg-white/80"}`}>
        <div>
          <p className={`text-[11px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Standard Size (Default)</p>
          <p className={`text-2xl font-extrabold leading-tight ${darkMode ? "text-slate-100" : "text-slate-900"}`}># {standard} cm</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${mode === "standard" ? darkMode ? "bg-emerald-400/15 text-emerald-200" : "bg-emerald-100 text-emerald-800" : darkMode ? "bg-slate-700 text-slate-200" : "bg-slate-100 text-slate-700"}`}>
          {mode === "standard" ? "Standard Size Selected" : "Custom Measurement Selected"}
        </span>
      </div>
      <div className="mt-3">
        <p className={`mb-2 text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>If adjustment is needed</p>
        <div className="grid gap-2 sm:grid-cols-[minmax(180px,0.7fr)_minmax(180px,1fr)]">
          <label className="text-xs font-semibold">Measurement Setting
            <CustomerDropdown darkMode value={mode} onChange={(event) => changeDoorMeasurementMode(handler, item, event.target.value)} className={`${classes} mt-1 w-full`}>
              <option value="standard">Standard Size (Default)</option><option value="custom">Custom Measurement (Optional)</option>
            </CustomerDropdown>
          </label>
          <label className="text-xs font-semibold">Measurement
            {mode === "standard"
              ? <span className={`${classes} mt-1 block`}>{standard} cm (Default)</span>
              : <input type="number" min="0.01" step="0.01" value={actual} onChange={(event) => handler(item.id, "door_measurement", { mode: "custom", actual_measurement_cm: event.target.value })} className={`${classes} mt-1 w-full`} placeholder="Example exact measurement: 200 cm" />}
          </label>
        </div>
      </div>
      <div className="mt-3">
        <p className={`mb-2 text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>Price behavior</p>
        <div className={`overflow-hidden rounded-lg border text-xs ${darkMode ? "border-slate-700" : "border-slate-200"}`} role="table" aria-label="Finished Door measurement price behavior">
          {priceBehavior.map(([measurement, behavior], index) => (
            <div key={measurement} role="row" className={`grid grid-cols-2 gap-3 px-3 py-2 ${index > 0 ? darkMode ? "border-t border-slate-700" : "border-t border-slate-200" : ""}`}>
              <span role="cell" className={darkMode ? "text-slate-300" : "text-slate-600"}>{measurement}</span>
              <span role="cell" className={`font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{behavior}</span>
            </div>
          ))}
        </div>
      </div>
      {mode === "custom" && breakdown && <p className={`mt-2 text-xs ${darkMode ? "text-slate-300" : "text-slate-700"}`}>Actual: {actual || "-"} cm | Excess: {Number.isFinite(breakdown.excess_measurement_cm) ? breakdown.excess_measurement_cm : 0} cm | Additional charge: {formatCurrency(breakdown.additional_charge)} | Final per piece: {formatCurrency(breakdown.final_price_per_piece)}</p>}
      <p className={`mt-3 text-xs leading-relaxed ${darkMode ? "text-slate-400" : "text-slate-600"}`}>
        Ang 190 cm ay default standard size lang para sa applicable Finished Door products. Ang custom measurement ay para lang sa order o inspection na ito at hindi binabago ang master product configuration.
      </p>
    </div>;
  };

  const getItemAdditionalCharges = (item) => Array.isArray(item?.additional_project_charges) ? item.additional_project_charges : [];
  const getItemAdditionalChargesTotal = (item) => getItemAdditionalCharges(item).reduce((sum, charge) => {
    return String(charge.name || "").trim() && String(charge.amount ?? "").trim() !== ""
      ? sum + Math.max(0, Number(charge.amount) || 0)
      : sum;
  }, 0);
  const getItemSelectedOptionalChargesTotal = (item) => {
    if (item?.estimation_mode === "manual" && Number(item.manual_estimated_total) > 0 && !isFinishedDoorInspectionItem(item)) {
      return Math.max(0, Math.round((getInspectionItemTotal(item) - Number(item.manual_estimated_total)) * 100) / 100);
    }
    const product = getInspectionProductForItem(item) || item;
    // Order items keep the charge rates that were saved with the order. Use
    // those rates when showing the edit delta so a catalog price change does
    // not alter the amount being removed from this customer's total.
    const configuredCharges = Array.isArray(item?.extra_charges) && item.extra_charges.length
      ? item.extra_charges
      : Array.isArray(product?.extra_charges) ? product.extra_charges : [];
    if (!configuredCharges.length) return 0;

    const selections = Array.isArray(item?.extra_charges) ? item.extra_charges : [];
    const selectedNames = new Map();
    configuredCharges.forEach((charge, index) => {
      if (charge?.is_optional !== true || charge?.is_active === false) return;
      const selection = selections[index] || {};
      const isSelected = typeof selection.is_selected === "boolean"
        ? selection.is_selected
        : charge?.is_default_selected === true;
      if (!isSelected) return;
      const name = String(charge.name || charge.label || `Extra charge ${index + 1}`).trim();
      selectedNames.set(name, (selectedNames.get(name) || 0) + 1);
    });
    if (!selectedNames.size) return 0;

    return getProductLineBreakdown({ ...product, ...item, extra_charges: configuredCharges }, item).extraCharges.reduce((sum, charge) => {
      const name = String(charge.name || "").trim();
      const matches = selectedNames.get(name) || 0;
      if (!matches) return sum;
      selectedNames.set(name, matches - 1);
      return sum + Math.max(0, Number(charge.total) || 0);
    }, 0);
  };
  const renderItemAdditionalCharges = (item, index, onFieldChange) => {
    const charges = getItemAdditionalCharges(item);
    const chargesTotal = getItemAdditionalChargesTotal(item);
    const updateCharges = (nextCharges) => onFieldChange(item.id, "additional_project_charges", nextCharges);
    return <div className={`col-span-full overflow-hidden rounded-xl border ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white"}`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5 sm:px-4 ${darkMode ? "border-slate-700 bg-slate-800/70" : "border-slate-200 bg-slate-50"}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${darkMode ? "bg-amber-400/10 text-amber-300" : "bg-amber-50 text-amber-700"}`}><FileText size={15} aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className={`truncate text-xs font-bold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>Product charges <span className="font-medium text-slate-500">· {item.name || `Product ${index + 1}`}</span></p>
            <p className={`mt-0.5 text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Optional fees for this product only</p>
          </div>
        </div>
        <button type="button" disabled={!normalizeProductId(item.product_id)} onClick={() => updateCharges([...charges, { name: "", amount: "", note: "" }])} className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15" : "border-amber-200 bg-white text-amber-800 hover:bg-amber-50"}`}><Plus size={14} aria-hidden="true" />Add charge</button>
      </div>
      <div className="space-y-2.5 p-3 sm:p-4">
        {!charges.length && <p className={`rounded-lg border border-dashed px-3 py-3 text-center text-xs ${darkMode ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>No extra charges for this product. Use <span className="font-semibold">Add charge</span> to include a confirmed fee.</p>}
        {charges.map((charge, chargeIndex) => <div key={`${item.id}-product-charge-${chargeIndex}`} className={`grid items-center gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_180px_40px] ${darkMode ? "border-slate-700 bg-slate-950/40" : "border-slate-200 bg-slate-50/70"}`}>
          <label className="min-w-0">
            <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Charge description</span>
            <input aria-label={`Charge name for ${item.name || `product ${index + 1}`}`} placeholder="e.g. Special installation" value={charge.name || ""} onChange={(event) => updateCharges(charges.map((entry, i) => i === chargeIndex ? { ...entry, name: event.target.value } : entry))} className={`${fieldClass} min-h-10`} />
          </label>
          <label className="min-w-0">
            <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Amount</span>
            <div className="relative">
              <span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>₱</span>
              <input aria-label={`Charge amount for ${item.name || `product ${index + 1}`}`} type="number" min="0" step="0.01" placeholder="0.00" value={charge.amount ?? ""} onChange={(event) => updateCharges(charges.map((entry, i) => i === chargeIndex ? { ...entry, amount: event.target.value } : entry))} className={`${fieldClass} min-h-10 pl-7`} />
            </div>
          </label>
          <button type="button" aria-label={`Remove charge for ${item.name || `product ${index + 1}`}`} title="Remove charge" onClick={() => updateCharges(charges.filter((_, i) => i !== chargeIndex))} className={`inline-flex size-10 items-center justify-center self-end rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-red-400/30 bg-red-400/5 text-red-300 hover:bg-red-400/10" : "border-red-200 bg-white text-red-600 hover:bg-red-50"}`}><Trash2 size={15} aria-hidden="true" /></button>
        </div>)}
        {chargesTotal > 0 && <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${darkMode ? "bg-emerald-400/10 text-emerald-200" : "bg-emerald-50 text-emerald-800"}`}>
          <span className="text-xs font-semibold">Total product charges</span>
          <span className="text-sm font-extrabold tabular-nums"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(chargesTotal)}</span></span>
        </div>}
      </div>
    </div>;
  };
  const getInspectionProductForItem = (item) => {
    const productId = normalizeProductId(item.product_id);
    return products.find((candidate) => String(candidate._id || candidate.id) === productId) || null;
  };

  const getBladeMeasurementDetails = (item) => {
    const product = getInspectionProductForItem(item) || item;
    if (String(product?.pricing_method || item.pricing_method).toLowerCase() !== "blade") return null;

    const glassTypes = Array.isArray(product?.blade_glass_types) && product.blade_glass_types.length
      ? product.blade_glass_types
      : Array.isArray(item.blade_glass_types) && item.blade_glass_types.length
        ? item.blade_glass_types
        : Number(product?.price_per_blade || item.price_per_blade) > 0
          ? [{ name: "Standard", price_per_blade: Number(product?.price_per_blade || item.price_per_blade) }]
          : [];
    const frameTypes = Array.isArray(product?.blade_frame_types) ? product.blade_frame_types : item.blade_frame_types || [];
    const sellBladesOnly = product?.sell_blades_only !== false;
    const sellWithFrame = Boolean(product?.sell_with_frame);
    const minimumBlades = Math.max(1, Number(product?.minimum_blades ?? item.minimum_blades) || 1);
    const maximumBlades = Number(product?.maximum_blades ?? item.maximum_blades) || 0;
    const saleMode = item.sale_mode || product?.default_sale_mode || (sellBladesOnly ? "blades_only" : "frame");
    const selectedFrame = frameTypes.find((frame) => frame.name === (item.frame_type || product?.default_frame_type)) || frameTypes[0];
    const selectedGlass = glassTypes.find((glass) => glass.name === (item.blade_glass_type || product?.default_blade_glass_type)) || glassTypes[0];
    const bladeCount = Number(item.blade_count) || Number(selectedFrame?.blade_count) || minimumBlades;
    const bladeRate = Number(product?.estimated_price_override ?? item.estimated_price_override) > 0
      ? getBladePriceOverrideRate(product, item)
      : Number(selectedGlass?.price_per_blade ?? product?.price_per_blade ?? item.price_per_blade) || 0;
    const framePrice = saleMode === "frame"
      ? Number(item.custom_frame_size ? product?.custom_frame_price : item.frame_price || selectedFrame?.price) || 0
      : 0;
    const quantity = Number(item.qty ?? item.quantity ?? 1) || 1;
    const configuredCharges = Array.isArray(product?.extra_charges) && product.extra_charges.length
      ? product.extra_charges
      : Array.isArray(item.extra_charges)
        ? item.extra_charges
        : [];
    const itemCharges = Array.isArray(item.extra_charges) ? item.extra_charges : [];
    const extraCharges = configuredCharges.map((charge, chargeIndex) => ({
      ...charge,
      ...(itemCharges[chargeIndex] || {}),
      is_optional: charge?.is_optional,
      is_active: charge?.is_active,
      type: itemCharges[chargeIndex]?.type || charge?.type || "fixed",
      label: itemCharges[chargeIndex]?.label || charge?.label || charge?.name || `Extra charge ${chargeIndex + 1}`,
      name: itemCharges[chargeIndex]?.name || charge?.name || charge?.label || `Extra charge ${chargeIndex + 1}`,
      amount: itemCharges[chargeIndex]?.amount ?? charge?.amount ?? 0,
      is_selected: typeof itemCharges[chargeIndex]?.is_selected === "boolean"
        ? itemCharges[chargeIndex].is_selected
        : charge?.is_optional === true
          ? false
          : true,
    })).filter((charge) => charge?.is_active !== false);

    return {
      product,
      glassTypes,
      frameTypes,
      sellBladesOnly,
      sellWithFrame,
      minimumBlades,
      maximumBlades,
      saleMode,
      selectedFrame,
      selectedGlass,
      bladeCount,
      bladeRate,
      framePrice,
      quantity,
      extraCharges,
    };
  };

  const renderOptionalChargeOptions = (item, onFieldChange) => {
    if (isInspectionBladeItem(item)) return null;
    const product = getInspectionProductForItem(item);
    const charges = Array.isArray(item.extra_charges) && item.extra_charges.length
      ? item.extra_charges
      : Array.isArray(product?.extra_charges) ? product.extra_charges : [];
    const optionalCharges = charges.filter((charge) => charge?.is_optional === true && charge?.is_active !== false);
    if (!optionalCharges.length) return null;
    const isEditing = onFieldChange === handleEditItemFieldChange;
    const inspection = isEditing ? editInspection : newInspection;
    const rushCount = getRushOrderCountForDate(inspection?.inspection_date, isEditing ? inspection?.id : "");
    const selectedRushCount = getSelectedRushChargeCount(inspection?.items || []);
    const dateRushCount = rushCount + (getRushSlotsForInspection(inspection) > 0 ? 1 : 0);

    return (
      <div className={`mt-2 space-y-2 rounded-lg border p-2.5 ${darkMode ? "border-slate-700 bg-slate-900/70" : "border-slate-200 bg-slate-50"}`}>
        <p className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Optional charges</p>
        {charges.map((charge, chargeIndex) => {
          if (charge?.is_optional !== true || charge?.is_active === false) return null;
          const selected = charge.is_selected === true;
          const isRushCharge = /rush/i.test(String(charge.name || charge.label || ""));
          const projectedRushCount = rushCount + 1;
          const exceedsRushLimit = projectedRushCount > 2;
          const rushLimitReached = isRushCharge && !selected && (selectedRushCount >= 2 || dateRushCount >= 2);
          const handleChargeSelectionChange = (checked) => {
            if (isRushCharge && checked && !selected) {
              if (!inspection?.inspection_date) {
                toast.error("Set an inspection date before selecting the Rush charge.");
                return;
              }
              if (selectedRushCount >= 2) {
                toast.error("Maximum 2 Rush charges per order. Remove a Rush charge before adding another.");
                return;
              }
              if (dateRushCount >= 2) {
                toast.error("Maximum 2 Rush Orders per inspection date. Remove a Rush charge or choose another date.");
                return;
              }
            }
            const updatedCharges = charges.map((entry, index) => (
              index === chargeIndex ? { ...entry, is_selected: checked } : entry
            ));
            onFieldChange(item.id, "extra_charges", updatedCharges);
            if (isRushCharge) {
              const hasRushAfterChange = (inspection?.items || []).some((candidate) => (
                candidate.id === item.id
                  ? updatedCharges.some((entry) => entry?.is_active !== false && entry?.is_selected === true && /rush/i.test(String(entry?.name || entry?.label || "")))
                  : hasSelectedRushCharge(candidate)
              ));
              if (isEditing) handleEditChange("is_rush_order", hasRushAfterChange);
              else handleInspectionFieldChange("is_rush_order", hasRushAfterChange);
            }
          };
          const chargeControl = (
            <div className={`flex flex-wrap items-center justify-start gap-x-3 gap-y-2 text-xs ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
              <label className="flex cursor-pointer items-center gap-2">
              <span className="flex min-w-0 items-center gap-2">
                {isRushCharge ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={selected}
                    aria-label={`Rush extra charge for ${item.name || "product"}`}
                    disabled={rushLimitReached}
                    onClick={() => handleChargeSelectionChange(!selected)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "bg-blue-600" : darkMode ? "bg-slate-600" : "bg-slate-300"}`}
                  >
                    <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${selected ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                  </button>
                ) : (
                  <input type="checkbox" checked={selected} onChange={(event) => handleChargeSelectionChange(event.target.checked)} className="accent-blue-600" />
                )}
                <span className="truncate">{isRushCharge ? "Rush fee (optional)" : charge.name || charge.label}</span>
              </span>
              </label>
              {isRushCharge ? (
                <label className="flex items-center gap-1.5 font-semibold">
                  <span className="sr-only">Rush fee amount</span>
                  <span>₱</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    aria-label={`Rush fee amount for ${item.name || "product"}`}
                    value={charge.amount ?? 0}
                    onChange={(event) => {
                      const updatedCharges = charges.map((entry, index) => (
                        index === chargeIndex ? { ...entry, amount: event.target.value } : entry
                      ));
                      onFieldChange(item.id, "extra_charges", updatedCharges);
                    }}
                    className={`w-24 rounded-md border px-2 py-1 text-right font-semibold outline-none focus:border-blue-500 ${darkMode ? "border-slate-600 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-800"}`}
                  />
                  <span>optional</span>
                </label>
              ) : (
                <span className="shrink-0 font-semibold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(charge.amount) || 0)}</span>{charge.type === "per_blade" ? " / blade" : charge.type === "per_sqft" ? " / sq ft" : charge.type === "percentage" ? "%" : ""}</span>
              )}
            </div>
          );
          return (
            <Fragment key={`${charge.name || charge.label}-${chargeIndex}`}>
              {isRushCharge ? (
                <div className="grid grid-cols-1 items-center gap-x-2 gap-y-2 sm:grid-cols-[max-content_minmax(0,1fr)]">
                  {chargeControl}
                  {rushLimitReached && (
                    <p role="alert" className={`text-[10px] font-semibold sm:col-span-2 ${darkMode ? "text-red-300" : "text-red-600"}`}>
                      {dateRushCount >= 2
                        ? "Maximum 2 Rush Orders per inspection date. This option is disabled."
                        : "Maximum 2 Rush charges per order. This option is disabled."}
                    </p>
                  )}
                  <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 pl-2.5 ${darkMode ? "border-amber-500/50" : "border-amber-300"}`}>
                    <p className={`text-[10px] leading-4 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Admin-only priority · Maximum 2 Rush charges per order</p>
                    {!inspection?.inspection_date
                      ? <p className={`text-[10px] leading-4 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Select an inspection date to check availability.</p>
                      : <p role={exceedsRushLimit ? "alert" : undefined} className={`text-[10px] font-semibold leading-4 ${exceedsRushLimit ? "text-red-600" : darkMode ? "text-amber-200" : "text-amber-800"}`}>
                          {exceedsRushLimit
                            ? "Maximum 2 Rush Orders per inspection date. This Rush charge cannot be added."
                            : `${dateRushCount} of 2 Rush Order slots are used for this date.`}
                        </p>}
                  </div>
                </div>
              ) : chargeControl}
            </Fragment>
          );
        })}
      </div>
    );
  };

  const getBladeExtraChargeTotal = (charge, details) => {
    if (!charge || charge.is_selected === false) return 0;
    const amount = Number(charge.amount) || 0;
    if (charge.type === "percentage") {
      return ((details.bladeRate * details.bladeCount + details.framePrice) * details.quantity * amount) / 100;
    }
    if (charge.type === "per_blade") return details.bladeCount * amount * details.quantity;
    return amount * details.quantity;
  };

  const renderPieceMeasurementOptions = (item, onFieldChange, rowIndex) => {
    const product = getInspectionProductForItem(item) || item;
    const method = String(product?.pricing_method || item.pricing_method || "").toLowerCase();
    const pieceOptions = Array.isArray(product?.piece_options) && product.piece_options.length
      ? product.piece_options
      : Array.isArray(item.piece_options) ? item.piece_options : [];
    if (!["per_piece", "piece", "per_set", "set"].includes(method) || !pieceOptions.length) return null;
    const fieldClass = darkMode
      ? "min-w-0 w-full rounded-lg border border-slate-600 bg-[#122d42] px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-red-500"
      : "min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-red-500";
    const labelClass = `mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`;
    return (
      <div className={`w-full rounded-lg border p-2 ${darkMode ? "border-slate-700 bg-slate-900/70" : "border-slate-200 bg-slate-50"}`}>
        <label className="block">
          <span className={labelClass}>Per piece option</span>
          <CustomerDropdown darkMode={darkMode} aria-label={`Per piece option for measurement ${rowIndex + 1}`} value={item.piece_option || ""} onChange={(event) => onFieldChange(item.id, "piece_option", event.target.value)} className={fieldClass}>
            <option value="">Select an option</option>
            {pieceOptions.map((option) => <option key={option.name} value={option.name}>{option.name} · +{hidePaymentAmounts ? "••••••" : `₱${Number(option.price_per_piece || 0).toLocaleString()}`}/piece</option>)}
          </CustomerDropdown>
        </label>
      </div>
    );
  };

  const renderAreaMeasurementOptions = (item, onFieldChange, rowIndex) => {
    const product = getInspectionProductForItem(item) || item;
    const method = String(product?.pricing_method || item.pricing_method || "").toLowerCase();
    const areaOptions = Array.isArray(product?.area_options) && product.area_options.length
      ? product.area_options
      : Array.isArray(item.area_options) ? item.area_options : [];
    const selectedAreaOption = String(item.area_option || "").trim();
    const areaOptionIsOptional = Number(product?.price_per_sqft) > 0
      || Number(item.price_per_sqft) > 0
      || Number(product?.estimated_price_override) > 0
      || Number(item.estimated_price_override) > 0;
    if (!["sqft", "per_sqft"].includes(method) || !areaOptions.length) return null;
    const fieldClass = darkMode
      ? "min-w-0 w-full rounded-lg border border-slate-600 bg-[#122d42] px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-red-500"
      : "min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-red-500";
    const labelClass = `mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`;
    return (
      <div className={`w-full rounded-lg border p-2 ${darkMode ? "border-slate-700 bg-slate-900/70" : "border-slate-200 bg-slate-50"}`}>
        <label className="block">
          <span className={labelClass}>Variant{areaOptionIsOptional ? " (optional)" : ""}</span>
          <CustomerDropdown darkMode={darkMode} aria-label={`Variant for measurement ${rowIndex + 1}`} value={selectedAreaOption} onChange={(event) => onFieldChange(item.id, "area_option", event.target.value)} className={fieldClass}>
            <option value="">Select an option</option>
            {areaOptions.map((option) => <option key={option.name} value={option.name}>{option.name} · {hidePaymentAmounts ? "••••••" : `₱${(Number(option.price_per_sqft) || 0).toLocaleString()}`}</option>)}
          </CustomerDropdown>
        </label>
      </div>
    );
  };

  const renderBladeMeasurementOptions = (item, onFieldChange, rowIndex) => {
    const details = getBladeMeasurementDetails(item);
    if (!details) return null;
    const {
      product,
      glassTypes,
      frameTypes,
      sellBladesOnly,
      sellWithFrame,
      minimumBlades,
      maximumBlades,
      saleMode,
      selectedFrame,
    } = details;
    const fieldClass = darkMode
      ? "min-w-0 w-full rounded-lg border border-slate-600 bg-[#122d42] px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-red-500"
      : "min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-red-500";
    const labelClass = `mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`;

    return (
      <div className={`w-full space-y-2 rounded-lg border p-2 ${darkMode ? "border-slate-700 bg-slate-900/70" : "border-slate-200 bg-slate-50"}`}>
        <label className="block">
          <span className={labelClass}>Glass type</span>
          <CustomerDropdown darkMode={darkMode} aria-label={`Glass type for measurement ${rowIndex + 1}`} value={item.blade_glass_type || product?.default_blade_glass_type || glassTypes[0]?.name || ""} onChange={(event) => onFieldChange(item.id, "blade_glass_type", event.target.value)} className={fieldClass}>
            <option value="">Select glass</option>
            {glassTypes.map((glass) => <option key={glass.name} value={glass.name}>{glass.name} · {hidePaymentAmounts ? "••••••" : `₱${Number(glass.price_per_blade || 0).toLocaleString()}`}/blade</option>)}
          </CustomerDropdown>
        </label>

        {(sellBladesOnly || sellWithFrame) && (
          <div>
            <span className={labelClass}>Sale option</span>
            <div className="grid grid-cols-2 gap-1">
              {sellBladesOnly && <button type="button" aria-pressed={saleMode === "blades_only"} onClick={() => {
                onFieldChange(item.id, "sale_mode", "blades_only");
                onFieldChange(item.id, "custom_frame_size", false);
                onFieldChange(item.id, "frame_price", 0);
              }} className={`min-h-8 rounded-md border px-1.5 text-[10px] font-semibold ${saleMode === "blades_only" ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-600 text-slate-300" : "border-slate-200 text-slate-600"}`}>Blades only</button>}
              {sellWithFrame && <button type="button" aria-pressed={saleMode === "frame"} onClick={() => {
                onFieldChange(item.id, "sale_mode", "frame");
                onFieldChange(item.id, "frame_price", Number(item.custom_frame_size ? product?.custom_frame_price : selectedFrame?.price) || 0);
              }} className={`min-h-8 rounded-md border px-1.5 text-[10px] font-semibold ${saleMode === "frame" ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-600 text-slate-300" : "border-slate-200 text-slate-600"}`}>With frame</button>}
            </div>
          </div>
        )}

        {saleMode === "frame" && frameTypes.length > 0 && (
          <label className="block">
            <span className={labelClass}>Frame type</span>
            <CustomerDropdown darkMode={darkMode} aria-label={`Frame type for measurement ${rowIndex + 1}`} value={item.frame_type || product?.default_frame_type || frameTypes[0]?.name || ""} onChange={(event) => {
              const frame = frameTypes.find((candidate) => candidate.name === event.target.value);
              onFieldChange(item.id, "frame_type", event.target.value);
              onFieldChange(item.id, "blade_count", Number(frame?.blade_count) || minimumBlades);
              onFieldChange(item.id, "frame_price", Number(frame?.price) || 0);
            }} className={fieldClass}>
              {frameTypes.map((frame) => <option key={frame.name} value={frame.name}>{frame.name} · {frame.blade_count} blades · {hidePaymentAmounts ? "••••••" : `₱${Number(frame.price || 0).toLocaleString()}`}</option>)}
            </CustomerDropdown>
          </label>
        )}

        {saleMode === "frame" && product?.allow_custom_frame_size && (
          <label className={`flex items-center gap-2 text-[10px] font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
            <input type="checkbox" checked={Boolean(item.custom_frame_size)} onChange={(event) => {
              onFieldChange(item.id, "custom_frame_size", event.target.checked);
              onFieldChange(item.id, "frame_price", Number(event.target.checked ? product?.custom_frame_price : selectedFrame?.price) || 0);
            }} className="accent-red-700" />
            Custom frame size ({product.custom_frame_size_unit || "in"})
          </label>
        )}

        {saleMode === "frame" && item.custom_frame_size && (
          <div className="grid grid-cols-2 gap-2">
            {[{ key: "width", label: "Width" }, { key: "height", label: "Height" }].map((field) => (
              <label key={field.key} className="block">
                <span className={labelClass}>{field.label}</span>
                <input type="number" min="0" inputMode="decimal" aria-label={`${field.label} for measurement ${rowIndex + 1}`} value={getDimensionInputValue(item[field.key])} onFocus={() => clearDefaultDimensionZero(item.id, field.key, item[field.key], onFieldChange)} onChange={(event) => onFieldChange(item.id, field.key, event.target.value)} className={fieldClass} />
              </label>
            ))}
          </div>
        )}

        {saleMode === "blades_only" || item.custom_frame_size ? (
          <label className="block">
            <span className={labelClass}>Blade count</span>
            <input type="number" min={minimumBlades} max={maximumBlades || undefined} step="1" aria-label={`Blade count for measurement ${rowIndex + 1}`} value={item.blade_count || minimumBlades} onChange={(event) => onFieldChange(item.id, "blade_count", event.target.value)} className={fieldClass} />
            {maximumBlades > 0 && <span className={`mt-1 block text-[10px] ${darkMode ? "text-slate-500" : "text-slate-500"}`}>{minimumBlades}–{maximumBlades} blades</span>}
          </label>
        ) : saleMode === "frame" && selectedFrame ? (
          <p className={`text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{selectedFrame.blade_count} blades included in this frame</p>
        ) : null}
      </div>
    );
  };

  const renderBladeMeasurementRow = (item, index, onFieldChange, onProductChange, onRemove, totals, mode = "new") => {
    const details = getBladeMeasurementDetails(item);
    if (!details) return null;
    const {
      product,
      glassTypes,
      frameTypes,
      minimumBlades,
      maximumBlades,
      saleMode,
      selectedFrame,
      bladeCount,
      bladeRate,
      framePrice,
      extraCharges,
    } = details;
    const inputClasses = darkMode
      ? "blade-measurement-control min-w-0 w-full rounded-lg border border-[#263040] bg-[#161c26] px-3 py-2.5 text-sm text-[#eef1f6] outline-none transition focus:border-[#6ea8fe] focus:ring-2 focus:ring-[#6ea8fe]/20"
      : "blade-measurement-control min-w-0 w-full rounded-lg border border-[#dde3ec] bg-white px-3 py-2.5 text-sm text-[#1a2230] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15";
    const labelClasses = `mb-1.5 block text-[10px] font-bold ${darkMode ? "text-slate-400" : "text-slate-600"}`;
    const mutedClass = darkMode ? "text-slate-400" : "text-slate-500";
    const rowTotal = mode.startsWith("edit") ? getEditItemSubtotalForTotals(item) : calculateRowSubtotal(item);
    const inspectionState = mode.startsWith("edit") ? editInspection : newInspection;
    const otherRushCount = getRushOrderCountForDate(
      inspectionState?.inspection_date,
      mode.startsWith("edit") ? inspectionState?.id : "",
    );
    const dateRushCount = otherRushCount + (getRushSlotsForInspection(inspectionState) > 0 ? 1 : 0);
    const hasPerProductWarranty = inspectionState.items.length > 1 && inspectionState.warranty_assignment_mode === "per_product";
    const productSelectId = `${mode}-blade-product-${index}`;
    const glassSelectId = `${mode}-blade-glass-${index}`;
    const frameSelectId = `${mode}-blade-frame-${index}`;
    const quantityId = `${mode}-blade-qty-${index}`;
    const bladeCountId = `${mode}-blade-count-${index}`;
    const framePriceId = `${mode}-blade-frame-price-${index}`;
    const isMobileMode = mode.endsWith("mobile");
    const showValidationError = measurementValidationAttempted[mode.startsWith("edit") ? "edit" : "new"] && Object.keys(validateInspectionMeasurementRows([item]).itemErrors[0] || {}).length > 0;
    const deleteButtonClasses = `inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition ${darkMode ? "border-[#5c2a24] bg-[#3a1c18] text-[#ff8080] hover:border-[#ff8080] hover:bg-[#4a211c]" : "border-[#f3c2bc] bg-[#fdecea] text-[#d64545] hover:border-[#d64545] hover:bg-[#fbded9]"}`;

    const updateExtraCharge = (chargeIndex, patch) => {
      const charge = extraCharges[chargeIndex];
      if (
        /rush/i.test(String(charge?.name || charge?.label || ""))
        && patch.is_selected === true
        && charge?.is_selected === false
        && dateRushCount >= 2
      ) {
        toast.error("Maximum 2 Rush Orders per inspection date. Remove a Rush charge or choose another date.");
        return;
      }
      const nextCharges = extraCharges.map((charge, currentIndex) => (
        currentIndex === chargeIndex ? { ...charge, ...patch } : charge
      ));
      onFieldChange(item.id, "extra_charges", nextCharges);
    };

    return (
      <article key={item.id || `${mode}-blade-${index}`} className={`mt-4 overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${showValidationError ? "border-2 border-red-500" : hasSelectedRushCharge(item) ? darkMode ? "border-red-400 bg-red-500/20" : "border-red-500 bg-red-100" : darkMode ? "border-[#263040] bg-[#161c26]" : "border-[#dde3ec] bg-white"}`}>
        {isMobileMode && (
          <div className={`flex items-center justify-between gap-2 border-b px-4 py-2.5 ${darkMode ? "border-[#263040]" : "border-[#dde3ec]"}`}>
            <p className={`text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Measurement {index + 1}</p>
            <button type="button" onClick={() => requestMeasurementDelete(mode.startsWith("edit") ? "edit" : "new", item, index)} className={deleteButtonClasses} aria-label={`Remove measurement ${index + 1}`} title="Remove measurement">
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 items-end gap-4 p-4 min-[620px]:grid-cols-[minmax(0,1.6fr)_76px_minmax(110px,0.8fr)_minmax(90px,auto)_36px]">
          <label className="min-w-0">
            <span className={labelClasses}>Product / Description</span>
            <CustomerDropdown darkMode={darkMode} id={productSelectId} value={item.product_id || ""} onChange={(event) => onProductChange(item.id, event.target.value)} className={`${inputClasses} ${item.product_id ? `font-semibold ${darkMode ? "!text-red-300" : "!text-red-600"}` : ""}`}>
              <option value="">-- Select Active Product --</option>
              {products.map((product) => (
                <option key={String(product._id || product.id)} value={String(product._id || product.id)}>{product.name}</option>
              ))}
            </CustomerDropdown>
          </label>

          <label className="min-w-0">
            <span className={labelClasses}>Qty</span>
            <input id={quantityId} type="number" min="1" step="1" inputMode="numeric" value={item.qty ?? item.quantity ?? 1} onChange={(event) => onFieldChange(item.id, "qty", event.target.value)} className={`${inputClasses} text-right`} />
          </label>

          <div className={`blade-readonly-control flex h-[42px] items-center justify-between gap-2 rounded-lg border px-3 text-xs font-semibold ${darkMode ? "border-[#263040] bg-[#1b2230] text-[#eef1f6]" : "border-[#dde3ec] bg-[#f6f8fb] text-[#1a2230]"}`}>
            <span className={mutedClass}>Price / blade</span>
            <span className="whitespace-nowrap font-bold"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(bladeRate)}</span></span>
          </div>

          <div className={`blade-readonly-control flex h-[42px] flex-col justify-center rounded-lg border px-3 min-[620px]:text-right ${darkMode ? "border-[#263040] bg-[#1b2230] text-[#eef1f6]" : "border-[#dde3ec] bg-[#f6f8fb] text-[#1a2230]"}`}>
            <span className={`text-[10px] font-bold uppercase tracking-wider ${mutedClass}`}>Total</span>
            <span className={`text-sm font-black ${darkMode ? "text-[#93a0b4]" : "text-[#6f7a8c]"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(rowTotal)}</span></span>
          </div>

          {!isMobileMode && (
            <button type="button" onClick={() => requestMeasurementDelete(mode.startsWith("edit") ? "edit" : "new", item, index)} className={`${deleteButtonClasses} justify-self-end`} aria-label={`Remove measurement ${index + 1}`} title="Remove measurement">
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className={`grid grid-cols-1 gap-4 px-4 pb-4 ${saleMode === "frame" ? "min-[620px]:grid-cols-3" : "min-[620px]:grid-cols-2"}`}>
          <label className="min-w-0">
            <span className={labelClasses}>Glass type</span>
            <CustomerDropdown darkMode={darkMode} id={glassSelectId} aria-label={`Glass type for measurement ${index + 1}`} value={item.blade_glass_type || glassTypes[0]?.name || ""} onChange={(event) => onFieldChange(item.id, "blade_glass_type", event.target.value)} className={inputClasses}>
              <option value="">Select glass</option>
              {glassTypes.map((glass) => <option key={glass.name} value={glass.name}>{glass.name} - <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(glass.price_per_blade || 0))}</span>/blade</option>)}
            </CustomerDropdown>
          </label>

          <label className="min-w-0">
            <span className={labelClasses}>Frame</span>
            <CustomerDropdown darkMode={darkMode} id={frameSelectId} aria-label={`Frame type for measurement ${index + 1}`} value={item.frame_type || selectedFrame?.name || ""} onChange={(event) => {
              const frame = frameTypes.find((candidate) => candidate.name === event.target.value);
              onFieldChange(item.id, "sale_mode", "frame");
              onFieldChange(item.id, "frame_type", event.target.value);
              onFieldChange(item.id, "blade_count", Number(frame?.blade_count) || minimumBlades);
              onFieldChange(item.id, "frame_price", Number(frame?.price) || 0);
            }} className={inputClasses}>
              {frameTypes.length === 0 && <option value="">No frame configured</option>}
              {frameTypes.map((frame) => <option key={frame.name} value={frame.name}>{frame.name} - {Number(frame.blade_count) || 0} blades - <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(frame.price || 0))}</span></option>)}
            </CustomerDropdown>
          </label>

          {saleMode === "frame" && product?.allow_custom_frame_size && (
            <label className={`flex items-center gap-2 text-xs font-medium ${mutedClass}`}>
              <input type="checkbox" checked={Boolean(item.custom_frame_size)} onChange={(event) => {
                onFieldChange(item.id, "custom_frame_size", event.target.checked);
                onFieldChange(item.id, "frame_price", Number(event.target.checked ? product?.custom_frame_price : selectedFrame?.price) || 0);
              }} className="accent-red-700" />
              Custom frame size ({product.custom_frame_size_unit || item.measurement_unit || "in"})
            </label>
          )}

          {saleMode === "frame" && item.custom_frame_size && (
            <div className="grid grid-cols-2 gap-2">
              {[{ key: "width", label: "Width" }, { key: "height", label: "Height" }].map((field) => (
                <label key={field.key} className="min-w-0">
                  <span className={labelClasses}>{field.label}</span>
                  <input type="number" min="0" inputMode="decimal" value={getDimensionInputValue(item[field.key])} onFocus={() => clearDefaultDimensionZero(item.id, field.key, item[field.key], onFieldChange)} onChange={(event) => onFieldChange(item.id, field.key, event.target.value)} className={inputClasses} aria-label={`${field.label} for measurement ${index + 1}`} />
                </label>
              ))}
            </div>
          )}

          <label className="min-w-0">
            <span className={labelClasses}>Number of blades</span>
            <div className={`blade-count-stepper grid h-[38px] grid-cols-[38px_minmax(0,1fr)_38px] items-center overflow-hidden rounded-lg border ${darkMode ? "border-[#263040] bg-[#161c26]" : "border-[#dde3ec] bg-white"}`}>
              <button type="button" onClick={() => onFieldChange(item.id, "blade_count", Math.max(minimumBlades, Number(bladeCount) - 1))} disabled={Number(bladeCount) <= minimumBlades} className={`inline-flex h-full items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "text-[#93a0b4] hover:bg-[#1b2230]" : "text-[#6f7a8c] hover:bg-[#f6f8fb]"}`} aria-label="Decrease number of blades">
                <Minus size={14} aria-hidden="true" />
              </button>
              <input id={bladeCountId} type="number" min={minimumBlades} max={maximumBlades || undefined} step="1" inputMode="numeric" value={bladeCount} onChange={(event) => onFieldChange(item.id, "blade_count", event.target.value)} className={`h-full min-w-0 appearance-none border-0 bg-transparent px-1 text-center text-sm outline-none focus:ring-0 ${darkMode ? "text-[#eef1f6]" : "text-[#1a2230]"}`} />
              <button type="button" onClick={() => onFieldChange(item.id, "blade_count", maximumBlades > 0 ? Math.min(maximumBlades, Number(bladeCount) + 1) : Number(bladeCount) + 1)} disabled={maximumBlades > 0 && Number(bladeCount) >= maximumBlades} className={`inline-flex h-full items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-40 ${darkMode ? "text-[#93a0b4] hover:bg-[#1b2230]" : "text-[#6f7a8c] hover:bg-[#f6f8fb]"}`} aria-label="Increase number of blades">
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
            <span className={`mt-1 block text-[11px] ${mutedClass}`}>
              {maximumBlades > 0 ? `Minimum: ${minimumBlades}, maximum: ${maximumBlades}` : `Minimum: ${minimumBlades}`}
            </span>
          </label>

        {saleMode === "frame" && (
          <div className={`rounded-xl border p-3 ${darkMode ? "border-[#263040] bg-[#1b2230]" : "border-[#dde3ec] bg-[#f6f8fb]"}`}>
            <label className="block">
              <span className={labelClasses}>Frame price (PHP)</span>
              <input id={framePriceId} type={hidePaymentAmounts ? "password" : "number"} min="0" step="0.01" inputMode="decimal" value={framePrice} onChange={(event) => onFieldChange(item.id, "frame_price", event.target.value)} className={`${inputClasses} text-right`} />
            </label>
            {selectedFrame?.price !== undefined && <span className={`mt-1 block text-[11px] ${mutedClass}`}>Standard: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(selectedFrame.price) || 0)}</span></span>}
          </div>
        )}

        {extraCharges.length > 0 && (
          <div className={`blade-extra-charges min-w-0 overflow-hidden rounded-xl border min-[620px]:col-span-2 ${darkMode ? "border-[#263040] bg-[#161c26]" : "border-[#dde3ec] bg-white"}`}>
            <p className={`blade-extra-charges-header border-b px-4 py-3 text-xs font-bold ${darkMode ? "border-[#263040] bg-[#1b2230] text-slate-200" : "border-[#dde3ec] bg-[#f6f8fb] text-slate-800"}`}>
              Extra charges <span className={`font-normal ${mutedClass}`}>(this order only · set amount to 0 to remove)</span>
            </p>
            <div className="space-y-0 px-3">
              {extraCharges.map((charge, chargeIndex) => {
                const chargeTotal = getBladeExtraChargeTotal(charge, details);
                const isRushCharge = /rush/i.test(String(charge.name || charge.label || ""));
                const rushToggleDisabled = isRushCharge && charge.is_selected === false && dateRushCount >= 2;
                return (
                  <div key={`${charge.name || charge.label}-${chargeIndex}`} className={`grid grid-cols-1 items-center gap-4 border-b py-3 last:border-b-0 min-[620px]:grid-cols-[minmax(0,1fr)_90px_minmax(100px,120px)_100px] ${darkMode ? "border-[#263040]" : "border-[#dde3ec]"}`}>
                    <div className={`flex min-w-0 items-center gap-2.5 text-sm ${darkMode ? "text-slate-200" : "text-slate-800"}`}>
                      <button type="button" role="switch" aria-checked={charge.is_selected !== false} aria-label={charge.label || charge.name} disabled={rushToggleDisabled} onClick={() => updateExtraCharge(chargeIndex, { is_selected: charge.is_selected === false })} className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${charge.is_selected !== false ? (darkMode ? "bg-[#6ea8fe] focus-visible:ring-[#6ea8fe]/30" : "bg-[#2563eb] focus-visible:ring-[#2563eb]/25") : (darkMode ? "bg-[#344156] focus-visible:ring-[#6ea8fe]/30" : "bg-[#c6ced9] focus-visible:ring-[#2563eb]/25")}`}>
                        <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${charge.is_selected !== false ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                      </button>
                      <span className="min-w-0 truncate">{charge.label || charge.name}</span>
                      {charge.is_optional === true && <span className={`rounded-full px-2 py-0.5 text-[10px] ${darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500"}`}>optional</span>}
                      {rushToggleDisabled && <span className={`text-[10px] font-semibold ${darkMode ? "text-amber-300" : "text-amber-700"}`}>Daily Rush limit reached</span>}
                    </div>
                    <span className={`text-xs min-[620px]:text-right ${mutedClass}`}>
                      {charge.type === "percentage" ? "% rate" : charge.type === "per_blade" ? "per blade" : "PHP fixed"}
                    </span>
                    <input type={hidePaymentAmounts ? "password" : "number"} min="0" step="0.01" inputMode="decimal" value={charge.amount ?? 0} onChange={(event) => updateExtraCharge(chargeIndex, { amount: event.target.value })} className={`${inputClasses} h-[38px] py-2 text-right`} aria-label={`${charge.label || charge.name} amount`} />
                    <div className={`blade-extra-charge-total text-right text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(chargeTotal)}</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>

        {hasPerProductWarranty && (
          <div className={`mx-4 mb-4 rounded-xl border p-3 sm:p-4 ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-slate-50/70"}`}>
            <p className={`mb-3 text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Warranty for {item.name || `product ${index + 1}`}</p>
            <div className={`grid items-end gap-3 ${getItemWarrantySelectValue(item) === "Custom" ? "sm:grid-cols-[minmax(0,1.2fr)_minmax(180px,0.8fr)]" : "sm:grid-cols-1"}`}>
              <label className="min-w-0">
                <span className={labelClasses}>Warranty period</span>
                <CustomerDropdown darkMode={darkMode}
                  id={`${mode}-blade-warranty-${index}`}
                  value={getItemWarrantySelectValue(item)}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "Custom") {
                      onFieldChange(item.id, "warranty_period", "Custom");
                      if (!Number(item.custom_warranty_days)) onFieldChange(item.id, "custom_warranty_days", 90);
                    } else {
                      onFieldChange(item.id, "warranty_period", value === "No Warranty" ? value : Number(value));
                    }
                  }}
                  className={inputClasses}
                >
                  <option value="No Warranty">No Warranty</option>
                  <option value="30">30 Days</option>
                  <option value="60">60 Days</option>
                  <option value="90">90 Days</option>
                  <option value="Custom">Custom</option>
                </CustomerDropdown>
              </label>
              {getItemWarrantySelectValue(item) === "Custom" && (
                <label className="min-w-0">
                  <span className={labelClasses}>Custom warranty days</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    aria-label={`Custom warranty days for ${item.name || `product ${index + 1}`}`}
                    value={getItemWarrantyCustomDays(item)}
                    onChange={(event) => onFieldChange(item.id, "custom_warranty_days", event.target.value)}
                    className={inputClasses}
                    placeholder="e.g. 90"
                  />
                </label>
              )}
            </div>
          </div>
        )}

      </article>
    );
  };

  const deriveUnitPriceForPayload = (item) => {
    const normalizedProductId = normalizeProductId(item.product_id);
    const product = products.find((p) => String(p._id || p.id) === normalizedProductId) || null;
    return resolveInspectionProductPrice(product, item).unit_price;
  };

  const formatRateLabel = (item) => {
    if (hidePaymentAmounts) return "••••••";
    const normalizedProductId = normalizeProductId(item.product_id);
    const product = products.find((p) => String(p._id || p.id) === normalizedProductId) || null;
    if (!product) return `₱${(Number(item.unit_price) || 0).toLocaleString()}`;
    const pricingMethod = product.pricing_method || "";
    const estimatedOverride = Number(product.estimated_price_override ?? item.estimated_price_override) || 0;
    if (pricingMethod === "blade") {
      const glassTypes = Array.isArray(product.blade_glass_types) ? product.blade_glass_types : item.blade_glass_types || [];
      const glass = glassTypes.find((entry) => entry.name === item.blade_glass_type) || glassTypes[0];
      const bladeRate = estimatedOverride > 0
        ? getBladePriceOverrideRate(product, item)
        : Number(glass?.price_per_blade ?? product.price_per_blade ?? item.price_per_blade) || 0;
      const frameTypes = Array.isArray(product.blade_frame_types) ? product.blade_frame_types : item.blade_frame_types || [];
      const frame = frameTypes.find((entry) => entry.name === item.frame_type);
      const framePrice = item.sale_mode === "frame"
        ? Number(item.custom_frame_size ? product.custom_frame_price : frame?.price) || 0
        : 0;
      return `${glass?.name || "Glass"}: ₱${bladeRate.toLocaleString()} / blade${framePrice > 0 ? ` + ₱${framePrice.toLocaleString()} frame` : ""}`;
    }
    const perSqft = Number(product.price_per_sqft) || 0;
    const perBlade = Number(product.price_per_blade) || 0;
    const base = Number(product.base_price) || 0;
    const unitPrice = Number(product.unit_price) || 0;
    const standardArea = Number(product.width) > 0 && Number(product.height) > 0
      ? toSquareFeet(Number(product.width), Number(product.height), product.measurement_unit || "in")
      : 0;
    switch (pricingMethod) {
      case "sqft":
        {
          const areaOptions = Array.isArray(product.area_options) ? product.area_options : item.area_options || [];
          const option = areaOptions.find((entry) => entry.name === item.area_option);
          const baseRate = estimatedOverride > 0 && standardArea > 0 ? estimatedOverride / standardArea : estimatedOverride || perSqft;
          const baseLabel = baseRate > 0 ? `₱${baseRate.toLocaleString(undefined, { maximumFractionDigits: 2 })} / sq.ft` : "";
          const optionPrice = Number(option?.price_per_sqft) || 0;
          const optionLabel = optionPrice > 0 ? `${option?.name ? `${option.name}: ` : ""}₱${optionPrice.toLocaleString()} / item` : "";
          return [baseLabel, optionLabel].filter(Boolean).join(" + ") || "Contact us";
        }
      case "blade":
        return `₱${perBlade.toLocaleString()} / blade`;
      case "fixed":
        if ((estimatedOverride || base) > 0 && standardArea > 0) {
          return `₱${((estimatedOverride || base) / standardArea).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / sq.ft`;
        }
        return `Base ₱${base.toLocaleString()}`;
      case "per_piece":
        {
          const pieceOptions = Array.isArray(product.piece_options) ? product.piece_options : item.piece_options || [];
          const option = pieceOptions.find((entry) => entry.name === item.piece_option) || null;
          const baseRate = estimatedOverride || base || unitPrice || 0;
          const optionRate = Number(option?.price_per_piece) || 0;
          if (option && optionRate > 0) return `Base ₱${baseRate.toLocaleString()} + ${option.name} ₱${optionRate.toLocaleString()} / pc`;
          if (!option && baseRate > 0) return `Base ₱${baseRate.toLocaleString()} / pc`;
          const pieceRate = estimatedOverride || Number(option?.price_per_piece) || unitPrice;
          return option ? `${option.name}: ₱${pieceRate.toLocaleString()} / pc` : `₱${pieceRate.toLocaleString()} / pc`;
        }
      case "per_meter":
        {
          const length = Number(product.width ?? product.length) || 0;
          const unit = product.measurement_unit || product.unit || "m";
          const meters = length * ({ in: 0.0254, ft: 0.3048, cm: 0.01, m: 1 }[unit] || 1);
          const meterRate = estimatedOverride > 0 && meters > 0 ? estimatedOverride / meters : estimatedOverride || unitPrice;
          return `₱${meterRate.toLocaleString(undefined, { maximumFractionDigits: 2 })} / meter`;
        }
      default:
        return `₱${unitPrice.toLocaleString()}`;
    }
  };

  const buildInspectionPayload = async (payload) => {
    const computedTotal = Number(payload.manual_override) || computeTotals().totalEstimate;
    const requiredDownpaymentAmount = resolveRequiredPaymentAmount(
      payload.payment_terms,
      computedTotal,
      payload.required_downpayment_amount,
    );
    const basePayload = {
      customer_id: payload.customerId || null,
      customer_email: payload.customerEmail || "",
      items: (payload.items || []).map((item) => {
        const hasMultipleItems = (payload.items || []).length > 1;
        const itemWarrantyPeriod = hasMultipleItems && payload.warranty_assignment_mode === "per_product"
          ? item.warranty_period ?? 90
          : payload.warranty_period;
        const itemCustomWarrantyDays = hasMultipleItems && payload.warranty_assignment_mode === "per_product"
          ? item.custom_warranty_days ?? 90
          : payload.custom_warranty_days;
        const warrantyPeriod = itemWarrantyPeriod === "Custom"
          ? Number(itemCustomWarrantyDays) || 90
          : itemWarrantyPeriod;
        const warrantyStartDate = null;

        return {
          _id: null,
          product_id: item.product_id || null,
          name: item.name || payload.productName || "Inspection Item",
          quantity: Number(item.qty) || 1,
          unit_price: deriveUnitPriceForPayload(item),
          pricing_method: item.pricing_method || "",
          price_per_sqft: Number(item.price_per_sqft) || 0,
          price_per_blade: Number(item.price_per_blade) || 0,
          blade_glass_types: Array.isArray(item.blade_glass_types) ? item.blade_glass_types : [],
          piece_options: Array.isArray(item.piece_options) ? item.piece_options : [],
          area_options: Array.isArray(item.area_options) ? item.area_options : [],
          blade_frame_types: Array.isArray(item.blade_frame_types) ? item.blade_frame_types : [],
          base_price: Number(item.base_price) || 0,
          blade_glass_type: item.blade_glass_type || "",
          piece_option: item.piece_option || "",
          area_option: item.area_option || "",
          sale_mode: item.sale_mode || "",
          frame_type: item.frame_type || "",
          frame_price: Number(item.frame_price) || 0,
          custom_frame_size: Boolean(item.custom_frame_size),
          blade_count: Number(item.blade_count) || 0,
          estimated_price_override: Number(item.estimated_price_override) || 0,
          customization_fee: Number(item.customization_fee) || 0,
          customization: Boolean(item.customization),
          extra_charges: item.extra_charges || [],
          additional_project_charges: getItemAdditionalCharges(item).filter((charge) => String(charge.name || "").trim() || String(charge.amount ?? "").trim()).map((charge) => ({ name: String(charge.name || "").trim(), amount: Number(charge.amount), note: String(charge.note || "").trim() })),
          size_limits: item.size_limits || {},
          finished_door_pricing: item.finished_door_pricing || { enabled: false },
          door_measurement: item.door_measurement || null,
          measurement_unit: item.measurement_unit || item.measurementUnit || item.dimensions?.unit || "in",
          width: Number(item.width) || 0,
          height: Number(item.height) || 0,
          area: requiresInspectionItemDimensions(item) ? Number(item.area) || 0 : 0,
          estimation_mode: item.estimation_mode || 'auto',
          is_estimate: true,
          estimated_price: getInspectionItemTotal(item),
          ...(hasMultipleItems ? {
            warranty_period: String(warrantyPeriod),
            custom_warranty_days: itemWarrantyPeriod === "Custom" ? Number(itemCustomWarrantyDays) || 90 : null,
            warranty_start_date: toApiDate(warrantyStartDate),
            warranty_expiry_date: calculateWarrantyExpiry(warrantyStartDate, itemWarrantyPeriod, itemCustomWarrantyDays),
            warranty_status: "pending",
          } : {}),
        };
      }),
      shipping_address: payload.siteAddress,
      order_type: payload.order_type === "walk_in_customer" ? "walk_in_customer" : "online_order",
      inspection_notes: payload.notes || payload.site_notes || "",
      site_notes: payload.site_notes || payload.notes || "",
      payment_terms: payload.payment_terms,
      agreed_payment_date: toApiDate(payload.agreed_payment_date),
      customer_name: payload.customerName,
      customer_phone: payload.phone,
      estimation_mode: "auto",
      inspection_date: toApiDate(payload.inspection_date),
      inspection_time: payload.inspection_time || "",
      inspection_duration_minutes: Number(payload.inspection_duration_minutes) || 30,
      inspection_travel_minutes: Number(payload.inspection_travel_minutes) || 0,
      is_rush_order: payload.is_rush_order === true,
      estimated_installation_date: toApiDate(payload.estimated_installation_date),
      estimated_installation_time: payload.estimated_installation_time || "",
      installation_duration_minutes: Number(payload.installation_duration_minutes) || 60,
      project_additional_charges: (payload.project_additional_charges || []).filter((charge) => String(charge.name || "").trim() || String(charge.amount ?? "").trim()).map((charge) => ({ name: String(charge.name || "").trim(), amount: Number(charge.amount), note: String(charge.note || "").trim() })),
      ...buildWarrantyPayload(payload.warranty_period, payload.custom_warranty_days),
      warranty_assignment_mode: (payload.items || []).length > 1 && payload.warranty_assignment_mode === "per_product"
        ? "per_product"
        : "same",
      has_account_on_website: Boolean(payload.has_account_on_website),
      manual_override: payload.manual_override || "",
      total_amount: computedTotal,
      contract_amount: computedTotal,
      estimated_cost: computeTotals().totalEstimate,
      final_project_cost: computedTotal,
      required_downpayment_amount: requiredDownpaymentAmount,
      downpayment_received: Boolean(payload.downpayment_received),
    };

    return basePayload;
  };

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const productResp = await getProducts({ adminOnly: true });
      setProducts((productResp.products || []).filter((product) => product.is_active !== false));
    } catch (error) {
      console.error("Failed to load admin products:", error);
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const handleInspectionFieldChange = (field, value) => {
    if (field === "is_rush_order" && value === true && getRushSlotsForInspection(newInspection) === 0) {
      const rushCount = getRushOrderCountForDate(newInspection.inspection_date);
      if (rushCount >= 2) {
        toast.error(`This date already has ${rushCount} Rush Orders. The daily maximum is 2; choose another date.`);
        return;
      }
    }
    setNewInspection((prev) => {
      if (field === "order_type") {
        if (value === "walk_in_customer") {
          return {
            ...prev,
            order_type: value,
            has_account_on_website: false,
            contract_number: prev.contract_number || generateTrackingId(),
          };
        }

        return {
          ...prev,
          order_type: value,
          has_account_on_website: true,
          contract_number: "",
        };
      }

      return { ...prev, [field]: field === "phone" ? normalizePhoneInput(value) : value };
    });
  };

  const handleItemFieldChange = (id, field, value) => {
    setNewInspection((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === "door_measurement" && value?.mode === "standard") {
          updated.door_measurement = { ...value, actual_measurement_cm: Number(item.finished_door_pricing?.standard_size_cm) || 190 };
        }
        if (field === "sale_mode" && value === "blades_only") {
          updated.custom_frame_size = false;
          updated.frame_price = 0;
        }
        if (field === "custom_frame_size" && !value) {
          updated.width = isInspectionBladeItem(updated) ? 0 : updated.width;
          updated.height = isInspectionBladeItem(updated) ? 0 : updated.height;
        }
        return {
          ...updated,
          area: requiresInspectionItemDimensions(updated)
            ? calculateMeasurementArea(updated.width, updated.height, updated.qty, updated.measurement_unit || updated.measurementUnit || "in")
            : 0,
        };
      }),
    }));
  };

  const handleItemProductChange = (id, productId) => {
    const normalizedProductId = normalizeProductId(productId);
    const selectedProduct = products.find((product) => String(product._id || product.id) === normalizedProductId);
    setNewInspection((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== id) return item;
        const productSnapshot = resolveInspectionProductPrice(selectedProduct, item);
        const rushSlotsFull = getRushOrderCountForDate(prev.inspection_date) + getRushSlotsForInspection(prev) >= 2;
        const rushCharges = rushSlotsFull && !hasSelectedRushCharge(item)
          ? disableUnavailableRushCharges(productSnapshot.extra_charges || [])
          : productSnapshot.extra_charges;
        const updated = {
          ...item,
          ...productSnapshot,
          product_id: normalizedProductId,
          name: selectedProduct?.name || item.name || "",
          pricing_method: productSnapshot.pricing_method,
          unit_price: productSnapshot.unit_price,
          base_price: productSnapshot.base_price,
          price_per_sqft: productSnapshot.price_per_sqft,
          price_per_blade: productSnapshot.price_per_blade,
          customization_fee: productSnapshot.customization_fee,
          estimated_price_override: productSnapshot.estimated_price_override,
          extra_charges: rushCharges,
          size_limits: productSnapshot.size_limits,
          measurement_unit: productSnapshot.measurement_unit || item.measurement_unit || item.measurementUnit || "in",
          width: requiresInspectionItemDimensions(productSnapshot) ? productSnapshot.width || item.width || 1 : 0,
          height: requiresInspectionItemDimensions(productSnapshot) ? productSnapshot.height || item.height || 1 : 0,
          unit: selectedProduct?.unit || item.unit || "sqft",
        };
        return {
          ...updated,
          area: requiresInspectionItemDimensions(updated)
            ? calculateMeasurementArea(updated.width, updated.height, updated.qty, updated.measurement_unit)
            : 0,
          estimation_mode: item.estimation_mode || "auto",
        };
      }),
    }));
  };

  const handleEditItemFieldChange = (id, field, value) => {
    const basePricingFields = new Set([
      "width", "height", "qty", "quantity", "measurement_unit", "unit_price", "price_per_sqft", "price_per_blade",
      "base_price", "area_option", "piece_option", "blade_glass_type", "sale_mode", "frame_type", "frame_price",
      "custom_frame_size", "blade_count", "estimated_price_override", "customization_fee", "customization",
      "door_measurement", "manual_estimated_total", "estimation_mode",
    ]);
    const projectPriceFields = new Set([...basePricingFields, "extra_charges", "additional_project_charges"]);
    setEditInspection((prev) => ({
      ...prev,
      pricing_changed: prev.pricing_changed || projectPriceFields.has(field),
      items: (prev.items || []).map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === "door_measurement" && value?.mode === "standard") {
          updated.door_measurement = { ...value, actual_measurement_cm: Number(item.finished_door_pricing?.standard_size_cm) || 190 };
        }
        if (field === "sale_mode" && value === "blades_only") {
          updated.custom_frame_size = false;
          updated.frame_price = 0;
        }
        if (field === "custom_frame_size" && !value) {
          updated.width = isInspectionBladeItem(updated) ? 0 : updated.width;
          updated.height = isInspectionBladeItem(updated) ? 0 : updated.height;
        }
        return {
          ...updated,
          _base_pricing_changed: item._base_pricing_changed || basePricingFields.has(field),
          _catalog_charge_changed: item._catalog_charge_changed || field === "extra_charges",
          area: requiresInspectionItemDimensions(updated)
            ? calculateMeasurementArea(updated.width, updated.height, updated.qty ?? updated.quantity, updated.measurement_unit || updated.measurementUnit || updated.dimensions?.unit || "in")
            : 0,
        };
      }),
    }));
  };

  const handleEditItemProductChange = (id, productId) => {
    const normalizedProductId = normalizeProductId(productId);
    const selectedProduct = products.find((product) => String(product._id || product.id) === normalizedProductId);
    setEditInspection((prev) => ({
      ...prev,
      pricing_changed: true,
      items: (prev.items || []).map((item) => {
        if (item.id !== id) return item;
        const productSnapshot = resolveInspectionProductPrice(selectedProduct, item);
        const rushSlotsFull = getRushOrderCountForDate(prev.inspection_date, prev.id) + getRushSlotsForInspection(prev) >= 2;
        const rushCharges = rushSlotsFull && !hasSelectedRushCharge(item)
          ? disableUnavailableRushCharges(productSnapshot.extra_charges || [])
          : productSnapshot.extra_charges;
        const updated = {
          ...item,
          ...productSnapshot,
          product_id: normalizedProductId,
          name: selectedProduct?.name || item.name || "",
          pricing_method: productSnapshot.pricing_method,
          unit_price: productSnapshot.unit_price,
          base_price: productSnapshot.base_price,
          price_per_sqft: productSnapshot.price_per_sqft,
          price_per_blade: productSnapshot.price_per_blade,
          customization_fee: productSnapshot.customization_fee,
          estimated_price_override: productSnapshot.estimated_price_override,
          extra_charges: rushCharges,
          size_limits: productSnapshot.size_limits,
          measurement_unit: productSnapshot.measurement_unit || item.measurement_unit || item.measurementUnit || item.dimensions?.unit || "in",
          width: requiresInspectionItemDimensions(productSnapshot) ? productSnapshot.width || item.width || 1 : 0,
          height: requiresInspectionItemDimensions(productSnapshot) ? productSnapshot.height || item.height || 1 : 0,
          unit: selectedProduct?.unit || item.unit || "sqft",
        };
        return {
          ...updated,
          _base_pricing_changed: true,
          area: requiresInspectionItemDimensions(updated)
            ? calculateMeasurementArea(updated.width, updated.height, updated.qty ?? updated.quantity, updated.measurement_unit)
            : 0,
          estimation_mode: item.estimation_mode || "auto",
        };
      }),
    }));
  };

  const addItemRow = () => {
    const validation = validateInspectionMeasurementRows(newInspection.items || []);
    if (!validation.valid) {
      setMeasurementValidationAttempted((current) => ({ ...current, new: true }));
      toast.error("Please complete the current measurement before adding another measurement.");
      return;
    }
    setMeasurementValidationAttempted((current) => ({ ...current, new: false }));
    setNewInspection((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { id: Date.now() + Math.random(), product_id: "", name: "", width: 1, height: 1, qty: 1, measurement_unit: "in", area: 0, unit: "sqft", unit_price: 0, estimation_mode: "auto" },
      ],
    }));
  };

  const addEditItemRow = () => {
    const validation = validateInspectionMeasurementRows(editInspection?.items || []);
    if (!validation.valid) {
      setMeasurementValidationAttempted((current) => ({ ...current, edit: true }));
      toast.error("Please complete the current measurement before adding another measurement.");
      return;
    }
    setMeasurementValidationAttempted((current) => ({ ...current, edit: false }));
    setEditInspection((prev) => ({
      ...prev,
      pricing_changed: true,
      items: [
        ...(prev.items || []),
        { id: Date.now() + Math.random(), product_id: "", name: "", width: 1, height: 1, qty: 1, measurement_unit: "in", area: 0, unit: "sqft", unit_price: 0, estimation_mode: "auto", manual_estimated_total: "" },
      ],
    }));
  };

  const removeItemRow = (id) => {
    setNewInspection((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }));
  };

  const removeEditItemRow = (id) => {
    setEditInspection((prev) => ({ ...prev, pricing_changed: true, items: (prev.items || []).filter((it) => it.id !== id) }));
  };

  const requestMeasurementDelete = (mode, item, index) => {
    setMeasurementDeleteConfirmation({
      mode,
      id: item.id,
      label: item.name || `Measurement ${index + 1}`,
    });
  };

  const confirmMeasurementDelete = () => {
    if (!measurementDeleteConfirmation) return;
    if (measurementDeleteConfirmation.mode === "edit") {
      removeEditItemRow(measurementDeleteConfirmation.id);
    } else {
      removeItemRow(measurementDeleteConfirmation.id);
    }
    setMeasurementDeleteConfirmation(null);
  };

  const computeTotals = () => {
    const completeItems = (newInspection.items || []).filter((item) => Object.keys(validateInspectionMeasurementRows([item]).itemErrors[0] || {}).length === 0);
    const totalArea = completeItems.reduce((sum, item) => sum + (Number(item.area) || 0), 0);
    const productEstimate = Math.round(
      completeItems.reduce((sum, item) => {
        if (item.estimation_mode === "manual") return sum + (Number(item.manual_estimated_total) || calculateRowSubtotal(item));
        return sum + calculateRowSubtotal(item);
      }, 0) * 100
    ) / 100;
    const productCharges = completeItems.reduce((sum, item) => sum + getItemAdditionalChargesTotal(item), 0);
    const totalEstimate = productEstimate + productCharges + (newInspection.project_additional_charges || []).reduce((sum, charge) => String(charge.name || "").trim() && String(charge.amount ?? "").trim() !== "" ? sum + Math.max(0, Number(charge.amount) || 0) : sum, 0);
    return { totalArea, totalEstimate };
  };

  const getEditItemSubtotalForTotals = (item) => {
    if (item._catalog_charge_changed) {
      return item.estimation_mode === "manual" && !isFinishedDoorInspectionItem(item)
        ? getInspectionItemTotal(item)
        : calculateRowSubtotal(item);
    }
    if (!item._base_pricing_changed && Number(item.saved_line_total) > 0) {
      return Number(item.saved_line_total);
    }
    return item.estimation_mode === "manual" && !isFinishedDoorInspectionItem(item)
      ? getInspectionItemTotal(item)
      : calculateRowSubtotal(item);
  };

  const getEditProjectTotal = () => {
    if (!editInspection?.pricing_changed && Number(editInspection?.saved_project_total) > 0) {
      return Number(editInspection.saved_project_total);
    }
    const savedProjectTotal = Number(editInspection?.saved_project_total) || 0;
    const onlyChargesChanged = savedProjectTotal > 0
      && !editInspection?.manual_override_changed
      && (editInspection?.items || []).length === Number(editInspection?.saved_item_count)
      && (editInspection?.items || []).every((item) => !item._base_pricing_changed);
    if (onlyChargesChanged) {
      const currentChargesTotal = (editInspection?.items || []).reduce((sum, item) => (
        sum + getItemAdditionalChargesTotal(item) + getItemSelectedOptionalChargesTotal(item)
      ), 0) + (editInspection?.project_additional_charges || []).reduce((sum, charge) => (
        sum + Math.max(0, Number(charge.amount) || 0)
      ), 0);
      const savedChargesTotal = (Number(editInspection?.saved_product_charges_total) || 0)
        + (Number(editInspection?.saved_optional_charges_total) || 0)
        + (Number(editInspection?.saved_project_charges_total) || 0);
      return Math.round(Math.max(0, savedProjectTotal + currentChargesTotal - savedChargesTotal) * 100) / 100;
    }
    const manualOverride = Number(editInspection?.manual_override) || 0;
    if (manualOverride > 0) return manualOverride;
    if (savedProjectTotal > 0) {
      const savedItemsTotal = Number(editInspection?.saved_items_total) || 0;
      const savedProjectChargesTotal = Number(editInspection?.saved_project_charges_total) || 0;
      return Math.round(Math.max(0, savedProjectTotal + computeEditTotals().totalEstimate - savedItemsTotal - savedProjectChargesTotal) * 100) / 100;
    }
    return computeEditTotals().totalEstimate;
  };

  const computeEditTotals = () => {
    if (!editInspection?.items) {
      return { totalArea: 0, totalEstimate: 0 };
    }
    const completeItems = (editInspection.items || []).filter((item) => Object.keys(validateInspectionMeasurementRows([item]).itemErrors[0] || {}).length === 0);
    const totalArea = completeItems.reduce((sum, item) => sum + (Number(item.area) || 0), 0);
    const productEstimate = Math.round(
      completeItems.reduce((sum, item) => sum + getEditItemSubtotalForTotals(item), 0) * 100
    ) / 100;
    const productCharges = completeItems.reduce((sum, item) => sum + getItemAdditionalChargesTotal(item), 0);
    const totalEstimate = productEstimate + productCharges + (editInspection.project_additional_charges || []).reduce((sum, charge) => String(charge.name || "").trim() && String(charge.amount ?? "").trim() !== "" ? sum + Math.max(0, Number(charge.amount) || 0) : sum, 0);
    return { totalArea, totalEstimate };
  };

  useEffect(() => {
    fetchSiteInspections();
    fetchProducts();
    const refreshVisibleTable = () => {
      if (document.visibilityState === "visible") fetchSiteInspections(false);
    };
    const unsubscribeRealtime = subscribeToRealtime(["orders", "site_inspection"], refreshVisibleTable);
    window.addEventListener("focus", refreshVisibleTable);
    document.addEventListener("visibilitychange", refreshVisibleTable);
    return () => {
      unsubscribeRealtime();
      window.removeEventListener("focus", refreshVisibleTable);
      document.removeEventListener("visibilitychange", refreshVisibleTable);
    };
  }, [fetchSiteInspections, fetchProducts]);

  useEffect(() => {
    if (!requestedRecordId) return undefined;

    let active = true;
    getAdminOrder(requestedRecordId, "site_inspection")
      .then((response) => {
        const latestOrder = response?.order || response;
        const latestId = String(latestOrder?._id || latestOrder?.id || "");
        if (
          latestId.toLowerCase() !== requestedRecordId.toLowerCase() ||
          !isSiteInspectionVisible(latestOrder) ||
          latestOrder.transactionCreated === true
        ) {
          throw new Error("This record is no longer in Site Inspection. It may have been transferred or removed.");
        }

        if (!active) return;
        setRequestedRecordError(null);
        setRequestedModalRecordId(requestedRecordId);
        setRequestedModalLocationKey(location.key);
        if (location.state?.openContract) {
          setViewInspection(null);
          const nextSearchParams = new URLSearchParams(searchParams);
          nextSearchParams.delete("view");
          const nextLocationState = { ...location.state };
          delete nextLocationState.openContract;
          navigate(
            {
              pathname: location.pathname,
              search: nextSearchParams.toString() ? `?${nextSearchParams.toString()}` : "",
              hash: location.hash,
            },
            { replace: true, state: nextLocationState },
          );
          openContractButtonHandlerRef.current?.(latestOrder);
        } else {
          setViewInspection(latestOrder);
        }
      })
      .catch((error) => {
        if (!active) return;
        setRequestedModalRecordId("");
        setViewInspection(null);
        setRequestedRecordError({
          id: requestedRecordId,
          message: error?.response?.status === 404
            ? "This Site Inspection record no longer exists or has been removed."
            : error?.message || "Unable to load this Site Inspection record.",
        });
      });

    return () => {
      active = false;
    };
  }, [
    requestedRecordId,
    location.key,
    location.state,
    location.pathname,
    location.search,
    location.hash,
    navigate,
    searchParams,
  ]);

  useEffect(() => {
    if (selectedCustomer) {
      setCustomerSuggestions([]);
      return;
    }

    const query = customerSearch.trim();
    if (!query) {
      setCustomerSuggestions([]);
      return;
    }

    setCustomerSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await searchCustomers(query);
        setCustomerSuggestions(result.customers || []);
      } catch (error) {
        console.error("Customer search failed", error);
        setCustomerSearchError(error?.message || "Unable to search customers");
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [customerSearch, selectedCustomer]);

  // Ensure form is reset whenever the New Inspection modal opens
  useEffect(() => {
    if (showModal) {
      resetNewInspectionForm();
      setNewInspectionStep(1);
    }
    // only run when showModal changes
  }, [showModal]);

  const submitNewInspection = async () => {
    const requestedRushSlots = getRushSlotsForInspection(newInspection);
    if (getSelectedRushChargeCount(newInspection.items || []) > 2) {
      toast.error("An order can include a maximum of 2 Rush charges.");
      return;
    }
    if (requestedRushSlots > 0) {
      if (!newInspection.inspection_date) {
        toast.error("Set an inspection date before marking this as a Rush Order.");
        changeInspectionStep(1, setNewInspectionStep, newInspectionBodyRef);
        return;
      }
      const rushCount = getRushOrderCountForDate(newInspection.inspection_date);
      if (rushCount + requestedRushSlots > 2) {
        toast.error(`This order would use ${rushCount + requestedRushSlots} of 2 Rush Order slots for the selected date. Remove a Rush charge or choose another date.`);
        return;
      }
    }
    const validationErrors = validateInspectionPayload(newInspection, { requireScheduleTimes: true });
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      if (["customerName", "phone", "siteAddress", "inspection_date", "estimated_installation_date", "customerId"].some((field) => validationErrors[field])) {
        changeInspectionStep(1, setNewInspectionStep, newInspectionBodyRef);
      }
      const firstKey = Object.keys(validationErrors)[0];
      const firstError = validationErrors[firstKey];
      if (Array.isArray(firstError)) {
        const rowError = firstError.find((err) => err && Object.values(err).length > 0);
        toast.error(rowError ? Object.values(rowError)[0] : "Please fix the form errors.");
      } else {
        toast.error(firstError);
      }
      return;
    }

    setSubmitting(true);
    try {
      const payload = await buildInspectionPayload(newInspection);
      await createInspection(payload);
      recordActivity(user, `Created site inspection for ${newInspection.customerName || "customer"}.`, "Site Inspection");
      toast.success("Site inspection created successfully.");

      closeNewInspectionModal();
      await fetchSiteInspections();
    } catch (err) {
      console.error("Create inspection failed", err);
      if (err?.data?.code === "RUSH_ORDER_DAILY_LIMIT") await fetchSiteInspections(false);
      const errorDetail = err?.data?.error || err?.data?.message || err?.message;
      toast.error(errorDetail ? `Unable to create order: ${errorDetail}` : "Unable to create order.");
    } finally {
      setSubmitting(false);
    }
  };

  // Action handlers for inspection table
  const handleView = (inspection) => {
    // Open view modal with inspection details
    setRequestedModalRecordId("");
    setRequestedModalLocationKey("");
    setViewInspection(inspection);
  };

  const closeInspectionDetails = () => {
    setViewInspection(null);
    setRequestedModalRecordId("");
    setRequestedModalLocationKey("");
    setRequestedRecordError(null);
    if (searchParams.has("view")) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("view");
      setSearchParams(nextSearchParams, { replace: true });
    }
  };

  const validateContractOrder = (order) => {
    const errors = [];
    const customerName = order.customer_name || `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim();
    const isWalkInCustomer = String(order.order_type || order.customerType || "").toLowerCase() === "walk_in_customer"
      || String(order.order_type || order.customerType || "").toLowerCase() === "walk-in"
      || String(order.order_type || order.customerType || "").toLowerCase() === "walkin";

    if (!customerName) errors.push("Customer name is required.");
    if (!isWalkInCustomer && !order.customer_email && !order.customer?.email) {
      errors.push("Customer email is required.");
    }
    if (!order.customer_phone && !order.customer?.phone) errors.push("Customer contact number is required.");
    if (!order.shipping_address) errors.push("Order shipping address is required.");
    if (!hasValidEstimatedInstallationDate(order)) errors.push("An estimated installation date is required before generating a contract.");
    if (!Array.isArray(order.items) || order.items.length === 0) errors.push("Order must contain at least one product.");

    if (Array.isArray(order.items)) {
      order.items.forEach((item, index) => {
        if (!item.name && !item.product_id?.name) {
          errors.push(`Product at row ${index + 1} must have a name.`);
        }
        if (!item.unit_price && item.unit_price !== 0) {
          errors.push(`Product at row ${index + 1} must have a unit price.`);
        }
        if (!item.quantity || item.quantity < 1) {
          errors.push(`Product at row ${index + 1} must have a quantity of at least 1.`);
        }
      });
    }

    const calculatedTotal = (order.items || []).reduce((sum, item) => {
      const unitPrice = Number(item.unit_price) || 0;
      const quantity = Number(item.quantity) || 1;
      return sum + unitPrice * quantity;
    }, 0);

    if (calculatedTotal <= 0) {
      errors.push("Calculated product total must be greater than zero.");
    }

    return errors;
  };

  const hasValidInspectionDate = (order) => {
    if (!order?.inspection_date) return false;
    const inspectionDate = new Date(order.inspection_date);
    return !Number.isNaN(inspectionDate.getTime());
  };

  const getCustomerTypeLabel = (inspection = {}) => {
    return isOnlineInspection(inspection) ? "Website" : "Walk-in";
  };

  const generateContractData = (order) => {
    if (!order) return null;

    const customerName = order.customer_name || `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() || "Customer";
    const customerEmail = order.customer_email || order.customer?.email || "N/A";
    const customerPhone = order.customer_phone || order.customer?.phone || "N/A";
    const customerType = order.order_type === "walk_in_customer" ? "Walk-in Customer" : "Online Customer";
    const orderNumber = order.tracking || `ORD-${String(order._id || "").slice(-8).toUpperCase()}`;
    const orderDate = order.createdAt ? formatDateToMMDDYYYY(order.createdAt) : "N/A";
    const siteInspectionDate = order.inspection_date ? formatDateToMMDDYYYY(order.inspection_date) : "TBD";
    const projectLocation = order.shipping_address || "N/A";
    const paymentTermsKey = String(order.payment_terms || "").trim();
    const agreedPaymentDate = order.agreed_payment_date ? formatDateToMMDDYYYY(order.agreed_payment_date) : null;
    const contractTerms = order.contract_terms || "The terms and conditions outlined by ACGC Glass & Aluminum Services apply to this agreement.";
    const totalProjectCost = getFinalProjectCost(order);
    const downPayment = getPaymentSummary(order).requiredAmount;
    const paymentTerms = isFullPaymentPlan(paymentTermsKey)
      ? "Full payment is required before project commences."
      : !paymentTermsKey || paymentTermsKey === "50%_down_payment"
        ? `${formatCurrency(downPayment)} downpayment, balance upon completion`
        : getPaymentTermsLabel(paymentTermsKey);
    const contractNumber = `ACGC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    const trackingNumber = `TRK-${order.tracking || (order._id?.slice(-4).toUpperCase() || Math.random().toString(36).substring(2, 8).toUpperCase())}`;
    const contractDate = formatDateToMMDDYYYY(new Date());

    const items = (order.items || []).map((item, index) => {
      const itemName = item.name || item.product_id?.name || `Item ${index + 1}`;
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unit_price) || 0;
      const width = Number(item.width) || 0;
      const height = Number(item.height) || 0;
      const area = Number(item.area) || Math.round(((width * height) / 144) * 100) / 100;
      const amount = (Number(item.line_total) || (item.is_estimate && Number(item.estimated_price) ? Number(item.estimated_price) : quantity * unitPrice)) + getItemAdditionalChargesTotal(item);
      return {
        name: itemName,
        quantity,
        width,
        height,
        unit: item.measurement_unit || item.measurementUnit || item.dimensions?.unit || "in",
        area,
        unitPrice,
        amount,
        additionalProjectCharges: getItemAdditionalCharges(item).map((charge) => ({ name: charge.name || "Additional charge", amount: Number(charge.amount) || 0, note: charge.note || "" })),
        pricing_method: item.pricing_method || "",
        price_per_blade: Number(item.price_per_blade) || 0,
        blade_glass_type: item.blade_glass_type || "",
        piece_option: item.piece_option || "",
        piece_options: Array.isArray(item.piece_options) ? item.piece_options : [],
        area_option: item.area_option || "",
        area_options: Array.isArray(item.area_options) ? item.area_options : [],
        blade_glass_types: Array.isArray(item.blade_glass_types) ? item.blade_glass_types : [],
        sale_mode: item.sale_mode || "",
        frame_type: item.frame_type || "",
        frame_price: Number(item.frame_price) || 0,
        blade_frame_types: Array.isArray(item.blade_frame_types) ? item.blade_frame_types : [],
        blade_count: Number(item.blade_count) || 0,
        category: item.product_id?.category || item.product_type || "N/A",
        warrantyPeriod: item.warranty_period,
        warrantyCustomDays: item.custom_warranty_days,
        warrantyStartDate: item.warranty_start_date,
        warrantyExpiryDate: item.warranty_expiry_date,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);

    return {
      customerName,
      customerType,
      customerEmail,
      customerPhone,
      orderNumber,
      orderDate,
      siteInspectionDate,
      projectLocation,
      totalProjectCost,
      downPayment,
      paymentTerms,
      agreedPaymentDate,
      contractTerms,
      contractNumber,
      trackingNumber,
      contractDate,
      status: (order.contract_status || "pending").toUpperCase(),
      subtotal,
      items,
      orderStatus: order.status,
    };
  };

  const handleGenerateContract = async (orderId) => {
    if (!orderId) return;
    try {
      setGeneratingId(orderId);

      const { order } = await getAdminOrder(orderId, "site_inspection");
      if (!order) {
        toast.error("Order not found");
        return;
      }

      if (!hasValidInspectionDate(order)) {
        toast.error("A Site Inspection Date must be scheduled before a contract can be generated.");
        return;
      }

      const validationErrors = validateContractOrder(order);
      if (validationErrors.length > 0) {
        toast.error(validationErrors.join(" "));
        return;
      }

      const snapshot = buildContractSnapshot(order);
      const alreadyGenerated = hasExistingContract(order);
      const shouldRegenerate = alreadyGenerated && hasContractSnapshotChanged(order);

      if (alreadyGenerated && !shouldRegenerate) {
        setContractInspection(order);
        setContractData(generateContractData(order));
        setContractNeedsRegeneration(false);
        setShowContractModal(true);
        toast("Existing contract loaded. No duplicate contract was created.", { icon: "\u{1F4C4}" });
        return;
      }

      if (alreadyGenerated && shouldRegenerate) {
        setContractInspection(order);
        setContractData({ ...generateContractData(order), contractNeedsRegeneration: true, contractSnapshot: snapshot });
        setContractNeedsRegeneration(true);
        setShowContractModal(true);
        toast("Contract details changed since the previous version. Regenerate to create a new contract version.", { icon: "⚠️" });
        return;
      }

      const contract = generateContractData(order);
      if (!contract) {
        toast.error("Unable to build contract data.");
        return;
      }

      const contractResponse = await generateContract(orderId, {
        contract_terms: order.contract_terms || contract.contractTerms,
        contract_amount: order.contract_amount || contract.totalProjectCost,
        snapshot,
        regenerate: false,
      });
      recordActivity(user, `Generated contract for order ${orderId}.`, "Site Inspection");

      const savedOrder = contractResponse?.order || {};
      const generatedOrder = {
        ...order,
        ...savedOrder,
        customer: typeof savedOrder.customer === "object" ? savedOrder.customer : order.customer,
        status: savedOrder.status || order.status || "site_inspection",
        contract_status: savedOrder.contract_status || "pending",
        contract_terms: savedOrder.contract_terms || order.contract_terms || contract.contractTerms,
        contract_amount: savedOrder.contract_amount || order.contract_amount || contract.totalProjectCost,
        contractGenerated: true,
        contractNeedsRegeneration: false,
        contractSnapshot: snapshot,
      };
      const generatedContract = generateContractData(generatedOrder) || contract;

      const contractEmail = generatedOrder.customer_email || generatedOrder.customer?.email || order.customer_email || order.customer?.email || "";
      if (!contractEmail.trim()) {
        toast("Contract generated, but no customer email was provided. You can still send it manually later.", { icon: "⚠️" });
      }

      setInspections((prev) => {
        const existingIndex = prev.findIndex((inspection) => (inspection._id || inspection.id) === orderId);
        if (existingIndex >= 0) {
          return prev.map((inspection) => ((inspection._id || inspection.id) === orderId ? { ...inspection, ...generatedOrder } : inspection));
        }
        return [generatedOrder, ...prev];
      });

      if (requestedModalRecordId === String(orderId)) {
        closeInspectionDetails();
      } else {
        setViewInspection((prev) => ((prev?._id || prev?.id) === orderId ? null : prev));
      }
      setEditInspection((prev) => (prev?.id === orderId ? null : prev));
      setContractInspection(generatedOrder);
      setContractData({ ...generatedContract, contractNeedsRegeneration: false });
      setContractNeedsRegeneration(false);
      setShowContractModal(true);
      setShowContractGenerationProgress(false);
      toast.success("Contract generated successfully. Use Send to customer when ready.");
    } catch (err) {
      console.error("Generate contract failed", err);
      toast.error(err?.data?.message || err?.message || "Failed to generate contract.");
    } finally {
      setGeneratingId(null);
      setShowContractGenerationProgress(false);
    }
  };

  const handleRegenerateContract = async () => {
    const orderId = contractInspection?._id || contractInspection?.id;
    if (!orderId) return;

    try {
      setGeneratingId(orderId);
      const { order } = await getAdminOrder(orderId, "site_inspection");
      if (!order) {
        toast.error("Order not found");
        return;
      }

      const snapshot = buildContractSnapshot(order);
      const contractResponse = await generateContract(orderId, {
        contract_terms: order.contract_terms || "",
        contract_amount: order.contract_amount || order.total_amount || 0,
        snapshot,
        regenerate: true,
      });

      const savedOrder = contractResponse?.order || {};
      const regeneratedOrder = { ...order, ...savedOrder, contractGenerated: true, contractNeedsRegeneration: false, contractSnapshot: snapshot };
      setContractInspection(regeneratedOrder);
      setContractData({ ...generateContractData(regeneratedOrder), contractNeedsRegeneration: false, contractSnapshot: snapshot });
      setContractNeedsRegeneration(false);
      setInspections((prev) => prev.map((inspection) => ((inspection._id || inspection.id) === orderId ? { ...inspection, ...regeneratedOrder } : inspection)));
      recordActivity(user, `Regenerated contract version for order ${orderId}.`, "Site Inspection");
      toast.success("New contract version generated successfully.");
    } catch (err) {
      console.error("Regenerate contract failed", err);
      toast.error(err?.data?.message || err?.message || "Failed to regenerate contract.");
    } finally {
      setGeneratingId(null);
    }
  };

  const handleDownloadContract = async () => {
    try {
      const contractElement = document.getElementById("contract-content");
      const contractPdf = await exportContractElementToPdfDataUrl(contractElement);
      const link = document.createElement("a");
      link.href = contractPdf;
      link.download = `ACGC-Contract-${contractInspection?.tracking || contractInspection?._id || "download"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("Contract PDF downloaded.");
    } catch (error) {
      console.error("Download contract failed:", error);
      toast.error("Unable to download the contract PDF.");
    }
  };

  const handlePrintContract = () => {
    const contractElement = document.getElementById("contract-content");
    if (!contractElement) {
      toast.error("Unable to locate contract content for printing.");
      return;
    }

    try {
      printContractElement(contractElement);
    } catch (error) {
      console.error("Print contract failed:", error);
      toast.error("Unable to print the contract.");
    }
  };

  const handleSendToCustomer = async () => {
    const orderId = contractInspection?._id || contractInspection?.id;
    if (!orderId) return;

    const customerName = contractInspection?.customer_name || contractInspection?.customer?.first_name
      ? `${contractInspection?.customer?.first_name || ""} ${contractInspection?.customer?.last_name || ""}`.trim() || contractInspection?.customer_name || "Customer"
      : contractInspection?.customer_name || "Customer";
    const customerEmail = (contractInspection?.customer_email || contractInspection?.customer?.email || contractData?.customerEmail || "").trim();

    if (!customerEmail) {
      toast.error("No customer email is available for this order.");
      return;
    }

    try {
      setSendingCustomerEmail(true);
      const contractElement = document.getElementById("contract-content");
      const contractAttachment = await exportContractElementToPdfDataUrl(contractElement);

      const emailResponse = await sendWalkInApprovalEmail(orderId, {
        customerName,
        customerEmail,
        contractUrl: contractInspection?.signed_contract_url || "",
        contractAttachment,
      });

      const updatedOrder = {
        ...contractInspection,
        status: "site_inspection",
        contract_status: "sent",
        contractStatus: "Sent",
        contract_email_status: emailResponse.email_status || "queued",
      };

      setContractInspection(updatedOrder);
      setContractData((prev) => ({ ...(prev || {}), orderStatus: "site_inspection", status: "sent", rawContractStatus: "sent" }));
      setInspections((prev) => prev.map((inspection) => ((inspection._id || inspection.id) === orderId ? { ...inspection, status: "site_inspection", contract_status: "sent", contractStatus: "Sent" } : inspection)));

      recordActivity(user, `Sent contract to customer for order ${orderId}.`, "Site Inspection");
      toast.success(emailResponse.message || "Contract saved to the customer account; email queued.");
    } catch (emailError) {
      console.error("Contract send failed:", emailError);
      toast.error(emailError?.data?.message || "The contract could not be sent to the customer.");
    } finally {
      setSendingCustomerEmail(false);
    }
  };

  const normalizeDateInputValue = (value) => {
    if (!value) return "";
    if (value instanceof Date) {
      return value.toISOString().split("T")[0];
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      const date = new Date(trimmed);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().split("T")[0];
      }
      return trimmed.split("T")[0];
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
  };

  const handleEdit = (orderId) => {
    setEditMeasurementsEnabled(false);
    const inspection = inspections.find((i) => (i._id || i.id) === orderId);
    if (inspection) {
      setEditInspectionStep(1);
      setErrors({});
      const registeredCustomerId = getRegisteredCustomerId(inspection);
      const isOnlineCustomer = isOnlineCustomerInspection(inspection);
      // Try to extract customer name from multiple sources
      let customerName = "";
      if (inspection.customer?.first_name || inspection.customer?.last_name) {
        customerName = `${inspection.customer.first_name || ""} ${inspection.customer.last_name || ""}`.trim();
      } else if (inspection.customer_name) {
        customerName = inspection.customer_name;
      } else if (inspection.customer?.email) {
        // Fallback: use email if no name available
        customerName = inspection.customer.email;
      } else if (inspection.customer_email) {
        customerName = inspection.customer_email;
      }
      
      const phone = inspection.customer?.phone || inspection.customer_phone || "";
      const customerEmail = inspection.customer?.email || inspection.customer_email || "";
      const siteAddress = inspection.shipping_address || inspection.customer?.street_address || formatCustomerAddress(inspection.customer) || "";
      const orderType = inspection.order_type || "online_order";
      const warrantyPeriodValue = inspection.warranty_period ?? 90;
      const normalizedWarrantyPeriod = normalizeWarrantyPeriodValue(warrantyPeriodValue);
      const paymentProof = getCustomerPaymentProof(inspection);
      const editItems = (inspection.items || []).map((item) => getEditItemFromOrderItem(item));
      const customerSelectedRush = editItems.some((item) => hasSelectedRushCharge(item));
      const savedItemsTotal = editItems.reduce((sum, item) => sum + (Number(item.saved_line_total) || 0) + getItemAdditionalChargesTotal(item), 0);
      const savedProductChargesTotal = editItems.reduce((sum, item) => sum + getItemAdditionalChargesTotal(item), 0);
      const savedOptionalChargesTotal = editItems.reduce((sum, item) => sum + getItemSelectedOptionalChargesTotal(item), 0);
      const savedProjectChargesTotal = (inspection.project_additional_charges || []).reduce((sum, charge) => sum + Math.max(0, Number(charge.amount) || 0), 0);
      const reportedProjectTotal = getFinalProjectCost(inspection);
      const calculatedSavedProjectTotal = savedItemsTotal + savedProjectChargesTotal;
      const savedProjectTotal = Number(inspection.manual_override) > 0
        ? reportedProjectTotal
        : Math.max(reportedProjectTotal, calculatedSavedProjectTotal);

      const nextEditInspection = {
        id: orderId,
        customerName,
        customerEmail,
        phone,
        siteAddress,
        order_type: orderType,
        payment_terms: inspection.payment_terms || "",
        agreed_payment_date: normalizeDateInputValue(inspection.agreed_payment_date),
        inspection_date: normalizeDateInputValue(inspection.inspection_date),
        inspection_time: inspection.inspection_time || "",
        inspection_duration_minutes: Number(inspection.inspection_duration_minutes) || 30,
        inspection_travel_minutes: Number(inspection.inspection_travel_minutes) || 0,
        is_rush_order: customerSelectedRush,
        estimated_installation_date: normalizeDateInputValue(getEstimatedInstallationDate(inspection)),
        estimated_installation_time: inspection.estimated_installation_time || "",
        installation_duration_minutes: Number(inspection.installation_duration_minutes) || 60,
        project_additional_charges: Array.isArray(inspection.project_additional_charges) ? inspection.project_additional_charges.map((charge) => ({ ...charge })) : [],
        saved_project_total: savedProjectTotal,
        saved_items_total: savedItemsTotal,
        saved_product_charges_total: savedProductChargesTotal,
        saved_optional_charges_total: savedOptionalChargesTotal,
        saved_project_charges_total: savedProjectChargesTotal,
        saved_item_count: editItems.length,
        pricing_changed: false,
        manual_override_changed: false,
        warranty_period: normalizedWarrantyPeriod,
        warranty_assignment_mode: inspection.warranty_assignment_mode === "per_product" ? "per_product" : "same",
        warranty_status: inspection.warranty_status || "",
        warranty_start_date: inspection.warranty_start_date || null,
        warranty_expiry_date: inspection.warranty_expiry_date || null,
        custom_warranty_days:
          normalizedWarrantyPeriod === "Custom"
            ? Number(inspection.custom_warranty_days || inspection.warranty_period) > 0
              ? Number(inspection.custom_warranty_days || inspection.warranty_period)
              : 90
            : 90,
        has_account_on_website: normalizeWalkInWebsiteAccountState({
          order_type: orderType,
          customerType: inspection.customerType,
          customer_type: inspection.customer_type,
          has_account_on_website: inspection.has_account_on_website,
        }) || isOnlineCustomer,
        isOnlineCustomer,
        downpayment_received: Boolean(inspection.downpayment_received),
        required_downpayment_amount: inspection.required_downpayment_amount ?? inspection.downpayment_amount ?? "",
        manual_override: inspection.manual_override || "",
        inspection_notes: inspection.inspection_notes || "",
        issues_found: inspection.issues_found || "",
        inspection_status: inspection.inspection_status || "pending",
        items: editItems,
        customerId: registeredCustomerId || null,
        customer_cancellation_count: Number(
          inspection.customer?.customer_cancellation_count
          ?? inspection.customer_cancellation_count
          ?? inspection.cancellation_count,
        ) || 0,
        online_order_cooldown_until: inspection.customer?.online_order_cooldown_until || null,
        payment_proof_amount: paymentProof.amount,
        payment_proof_file_name: inspection.payment_proof_file_name || inspection.payment_proof_file_url || "",
        payment_method: paymentProof.paymentMethod,
        transaction_number: paymentProof.transactionNumber,
      };
      editInspectionAddressBaselineRef.current = nextEditInspection.siteAddress || "";
      editInspectionBaselineRef.current = createUnsavedSnapshot(nextEditInspection);
      setManualOverrideLocked(true);
      setEditInspection(nextEditInspection);
    } else {
      // fallback: open an empty editor
      const nextEditInspection = { id: orderId, inspection_date: "", inspection_time: "", is_rush_order: false, inspection_notes: "", issues_found: "", inspection_status: "pending", estimated_installation_date: "", estimated_installation_time: "" };
      editInspectionAddressBaselineRef.current = "";
      editInspectionBaselineRef.current = createUnsavedSnapshot(nextEditInspection);
      setManualOverrideLocked(true);
      setEditInspection(nextEditInspection);
    }
  };

  const handleManualApprovalFileUpload = async (files) => {
    if (!files || files.length === 0) {
      setManualApprovalModal((prev) => ({ ...prev, error: "Please select a signed contract or receipt file." }));
      return;
    }

    const file = files[0];
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png"];
    const fileExtension = "." + file.name.split(".").pop().toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      setManualApprovalModal((prev) => ({ ...prev, error: "Only PDF, JPG, and PNG files are allowed." }));
      return;
    }

    const maxFileSize = 50 * 1024 * 1024;
    if (file.size > maxFileSize) {
      setManualApprovalModal((prev) => ({ ...prev, error: "File size must be less than 50 MB." }));
      return;
    }

    setManualApprovalModal((prev) => ({ ...prev, uploading: true, error: "" }));

    try {
      const uploadResp = await uploadFiles([file], undefined, { purpose: "contracts" });
      const uploadedFileUrl = uploadResp?.success && uploadResp?.files?.length
        ? (typeof uploadResp.files[0] === "string" ? uploadResp.files[0] : uploadResp.files[0]?.url || "")
        : "";

      if (!uploadedFileUrl) {
        throw new Error("Upload failed");
      }

      setManualApprovalModal((prev) => ({
        ...prev,
        uploadedUrl: uploadedFileUrl,
        fileName: file.name,
        uploading: false,
        error: "",
      }));
      toast.success("Signed contract uploaded successfully.");
    } catch (error) {
      console.error("Manual approval upload error:", error);
      setManualApprovalModal((prev) => ({
        ...prev,
        uploadedUrl: "",
        uploading: false,
        error: error?.message || "Failed to upload the signed contract.",
      }));
    }
  };

  const openManualApprovalModal = (inspection) => {
    const orderId = inspection?._id || inspection?.id;
    const orderTracking = inspection?.tracking || inspection?.order_number || inspection?.orderId || `SI-${String((inspection?._id || inspection?.id || "")).slice(-8).toUpperCase()}`;
    if (!orderId) return;

    setManualApprovalModal({
      open: true,
      orderId,
      tracking: orderTracking,
      uploadedUrl: "",
      fileName: "",
      uploading: false,
      error: "",
    });
  };

  const closeManualApprovalModal = () => {
    setManualApprovalModal({
      open: false,
      orderId: null,
      tracking: "",
      uploadedUrl: "",
      fileName: "",
      uploading: false,
      error: "",
    });
  };

  const handleCompleteManualApproval = async () => {
    if (!manualApprovalModal.orderId) return;
    if (!manualApprovalModal.uploadedUrl) {
      setManualApprovalModal((prev) => ({ ...prev, error: "Please upload the signed contract or receipt before completing approval." }));
      return;
    }

    try {
      await updateOrderStatus(manualApprovalModal.orderId, {
        status: "contract_accepted",
        contract_status: "accepted",
        contractStatus: "Accepted",
        acceptance_method: "walk_in_signed_contract",
        acceptanceMethod: "Walk-in Signed Contract",
        acceptedByCustomer: false,
        signed_contract_url: manualApprovalModal.uploadedUrl,
        contract_signed_date: new Date().toISOString(),
        inspection_status: "completed",
        inspection_completed_at: new Date().toISOString(),
        transactionCreated: true,
        transactionCreatedAt: new Date().toISOString(),
      });

      recordActivity(user, `Approved walk-in contract for ${manualApprovalModal.tracking}.`, "Site Inspection");
      toast.success("Signed contract verified. Order moved to Transactions for admin approval.");
      closeManualApprovalModal();
      navigate("/transactions");
    } catch (error) {
      console.error("Complete manual approval failed:", error);
      setManualApprovalModal((prev) => ({
        ...prev,
        error: error?.data?.message || error?.message || "Unable to complete manual approval.",
      }));
    }
  };

  const openContractButtonHandler = async (inspection) => {
    const orderId = inspection?._id || inspection?.id;
    if (!orderId) return;

    // New contracts need confirmation first. Use the already loaded inspection
    // row so the confirmation appears immediately instead of waiting on a
    // detail request that is repeated again after the user confirms.
    if (!hasExistingContract(inspection)) {
      requestGenerateContract(orderId);
      return;
    }

    const loadRequestId = ++contractModalLoadRequestRef.current;
    const initialContractData = generateContractData(inspection);
    const initialNeedsRegeneration = hasContractSnapshotChanged(inspection);
    setContractInspection(inspection);
    setContractData({ ...initialContractData, contractNeedsRegeneration: initialNeedsRegeneration });
    setContractNeedsRegeneration(initialNeedsRegeneration);
    setShowContractModal(true);

    try {
      const { order } = await getAdminOrder(orderId, "site_inspection");
      if (loadRequestId !== contractModalLoadRequestRef.current) return;
      if (!order) {
        toast.error("Order not found");
        return;
      }

      if (!hasExistingContract(order)) {
        setShowContractModal(false);
        requestGenerateContract(orderId);
        return;
      }

      const shouldRegenerate = hasContractSnapshotChanged(order);
      const contractDataForModal = { ...generateContractData(order), contractNeedsRegeneration: shouldRegenerate };
      setContractInspection(order);
      setContractData(contractDataForModal);
      setContractNeedsRegeneration(shouldRegenerate);
      setShowContractModal(true);
    } catch (error) {
      if (loadRequestId !== contractModalLoadRequestRef.current) return;
      console.error("Failed to open contract", error);
      toast.error("Showing the saved contract summary. Unable to refresh its latest details.");
    }
  };
  openContractButtonHandlerRef.current = openContractButtonHandler;

  const handleCancel = async (orderId, reason) => {
    if (!orderId) return;
    try {
      setCancellingId(orderId);
      const res = await cancelAdminOrder(orderId, { reason });
      recordActivity(user, `Cancelled site inspection ${orderId}. Reason: ${reason}`, "Site Inspection");
      if (res && res.order) {
        setInspections((prev) => prev.filter((i) => (i._id || i.id) !== orderId));
        setCancelledInspections((prev) => [res.order, ...prev]);
        setRushOrderRecords((prev) => prev.map((i) => ((i._id || i.id) === orderId ? res.order : i)));
        toast.success("Inspection cancelled.");
      } else {
        setInspections((prev) => prev.filter((i) => (i._id || i.id) !== orderId));
        setRushOrderRecords((prev) => prev.filter((i) => (i._id || i.id) !== orderId));
      }
      return true;
    } catch (err) {
      console.error("Failed to cancel inspection", err);
      toast.error(err?.data?.message || err?.message || "Failed to cancel inspection.");
      return false;
    } finally {
      setCancellingId(null);
    }
  };

  const [cancelConfirm, setCancelConfirm] = useState({ open: false, id: null });
  const [cancelReason, setCancelReason] = useState("");

  const requestCancel = (orderId) => {
    setCancelReason("");
    setCancelConfirm({ open: true, id: orderId });
  };

  const handleConfirmCancel = async () => {
    const reason = cancelReason.trim();
    if (!reason) {
      toast.error("Enter a cancellation reason to continue.");
      return;
    }
    const orderId = cancelConfirm.id;
    const cancelled = await handleCancel(orderId, reason);
    if (cancelled) {
      setCancelConfirm({ open: false, id: null });
      setCancelReason("");
    }
  };

  const closeCancelModal = () => {
    if (cancellingId === cancelConfirm.id) return;
    setCancelConfirm({ open: false, id: null });
    setCancelReason("");
  };

  const [restoreConfirm, setRestoreConfirm] = useState({ open: false, id: null });
  const [contractConfirm, setContractConfirm] = useState({ open: false, id: null });

  const requestRestore = (orderId) => {
    setRestoreConfirm({ open: true, id: orderId });
  };

  const requestGenerateContract = (orderId) => {
    setContractConfirm({ open: true, id: orderId });
  };

  const closeRestoreModal = () => setRestoreConfirm({ open: false, id: null });
  const closeContractModal = () => setContractConfirm({ open: false, id: null });

  const handleConfirmRestore = async () => {
    const orderId = restoreConfirm.id;
    setRestoreConfirm({ open: false, id: null });
    await handleRestore(orderId);
  };

  const handleConfirmGenerateContract = async () => {
    const orderId = contractConfirm.id;
    setContractConfirm({ open: false, id: null });
    setShowContractGenerationProgress(true);
    await handleGenerateContract(orderId);
  };

  const handleRestore = async (orderId) => {
    if (!orderId) return;
    try {
      setRestoringId(orderId);
      const res = await updateOrderStatus(orderId, { status: "site_inspection" });
      recordActivity(user, `Restored site inspection ${orderId}.`, "Site Inspection");
      if (res && res.order) {
        setCancelledInspections((prev) => prev.filter((i) => (i._id || i.id) !== orderId));
        setRushOrderRecords((prev) => {
          const exists = prev.some((i) => (i._id || i.id) === orderId);
          return exists ? prev.map((i) => ((i._id || i.id) === orderId ? res.order : i)) : [res.order, ...prev];
        });
        if (isSiteInspectionVisible(res.order)) {
          setInspections((prev) => [res.order, ...prev]);
        }
        toast.success("Inspection restored");
      }
    } catch (err) {
      console.error("Restore failed", err);
      toast.error(err?.data?.message || err?.message || "Failed to restore inspection.");
    } finally {
      setRestoringId(null);
    }
  };

  const handleEditChange = (name, value) => {
    if (name === "is_rush_order" && value === true && getRushSlotsForInspection(editInspection || {}) === 0) {
      const rushCount = getRushOrderCountForDate(editInspection?.inspection_date, editInspection?.id);
      if (rushCount >= 2) {
        toast.error(`This date already has ${rushCount} other Rush Orders. The daily maximum is 2; choose another date.`);
        return;
      }
    }
    setEditInspection((prev) => {
      if (prev.isOnlineCustomer && ["customerName", "phone", "customerEmail", "has_account_on_website", "order_type"].includes(name)) {
        return prev;
      }

      if (name === "order_type") {
        return {
          ...prev,
          order_type: value,
          has_account_on_website: value === "walk_in_customer" ? false : true,
        };
      }

      return {
        ...prev,
        pricing_changed: prev.pricing_changed || name === "manual_override" || name === "project_additional_charges",
        manual_override_changed: prev.manual_override_changed || name === "manual_override",
        [name]: name === "phone" ? normalizePhoneInput(value) : value,
      };
    });
  };

  const requestSaveEdit = async () => {
    if (!editInspection?.id) return;
    const sourceOrder = inspections.find((order) => (order._id || order.id) === editInspection.id);
    let cancellationCount = Number(
      editInspection.customer_cancellation_count
      ?? editInspection.customer?.customer_cancellation_count
      ?? editInspection.cancellation_count
      ?? sourceOrder?.customer?.customer_cancellation_count
      ?? sourceOrder?.customer_cancellation_count
      ?? sourceOrder?.cancellation_count,
    );
    let cooldownUntil = editInspection.customer?.online_order_cooldown_until
      ?? editInspection.online_order_cooldown_until
      ?? sourceOrder?.customer?.online_order_cooldown_until
      ?? sourceOrder?.online_order_cooldown_until;

    // The list response may omit the populated customer. Check the order detail
    // before saving so the warning also works when the count is only available there.
    try {
      const response = await getAdminOrder(editInspection.id, "site_inspection");
      const detailedOrder = response?.order;
      cancellationCount = Number(
        detailedOrder?.customer?.customer_cancellation_count
        ?? detailedOrder?.customer_cancellation_count
        ?? detailedOrder?.cancellation_count
        ?? cancellationCount,
      );
      if (detailedOrder) {
        cooldownUntil = detailedOrder.customer?.online_order_cooldown_until
          ?? detailedOrder.online_order_cooldown_until
          ?? null;
        setEditInspection((current) => current?.id === editInspection.id ? {
          ...current,
          customer: detailedOrder.customer,
          customer_cancellation_count: cancellationCount,
          online_order_cooldown_until: detailedOrder.customer?.online_order_cooldown_until
            ?? detailedOrder.online_order_cooldown_until
            ?? null,
        } : current);
      }
    } catch (error) {
      console.warn("Unable to refresh customer cancellation count before saving inspection:", error);
    }

    if (isRestrictedCustomerOrder({
      customer_cancellation_count: cancellationCount,
      online_order_cooldown_until: cooldownUntil,
    }, Date.now())) {
      setHighCancellationConfirmation(true);
      return;
    }

    await saveEdit();
  };

  const saveEdit = async () => {
    if (!editInspection || !editInspection.id) return;

    const requestedRushSlots = getRushSlotsForInspection(editInspection);
    if (getSelectedRushChargeCount(editInspection.items || []) > 2) {
      toast.error("An order can include a maximum of 2 Rush charges.");
      return;
    }
    if (requestedRushSlots > 0) {
      if (!editInspection.inspection_date) {
        toast.error("Set an inspection date before marking this as a Rush Order.");
        changeInspectionStep(1, setEditInspectionStep, editInspectionBodyRef);
        return;
      }
      const rushCount = getRushOrderCountForDate(editInspection.inspection_date, editInspection.id);
      if (rushCount + requestedRushSlots > 2) {
        toast.error(`This order would use ${rushCount + requestedRushSlots} of 2 Rush Order slots for the selected date. Remove a Rush charge or choose another date.`);
        return;
      }
    }
    const validationErrors = validateInspectionPayload(editInspection, {
      validateSiteAddress: normalizeFullAddress(editInspection.siteAddress) !== normalizeFullAddress(editInspectionAddressBaselineRef.current),
    });
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      if (["customerName", "phone", "siteAddress", "inspection_date", "estimated_installation_date", "customerId"].some((field) => validationErrors[field])) {
        changeInspectionStep(1, setEditInspectionStep, editInspectionBodyRef);
      }
      const firstKey = Object.keys(validationErrors)[0];
      const firstError = validationErrors[firstKey];
      if (Array.isArray(firstError)) {
        const rowError = firstError.find((err) => err && Object.values(err).length > 0);
        toast.error(rowError ? Object.values(rowError)[0] : "Please fix the form errors.");
      } else {
        toast.error(firstError);
      }
      return;
    }

    setSavingEdit(true);
    try {
      const payload = {
        ...(!editInspection.isOnlineCustomer ? {
          customer_name: editInspection.customerName || undefined,
          customer_email: editInspection.customerEmail || undefined,
          customer_phone: editInspection.phone || undefined,
          has_account_on_website: Boolean(editInspection.has_account_on_website),
        } : {
          has_account_on_website: true,
        }),
        ...(normalizeFullAddress(editInspection.siteAddress) !== normalizeFullAddress(editInspectionAddressBaselineRef.current)
          ? { shipping_address: normalizeFullAddress(editInspection.siteAddress) }
          : {}),
        manual_override: editInspection.manual_override || "",
        inspection_date: toApiDate(editInspection.inspection_date),
        inspection_time: editInspection.inspection_time || "",
        inspection_duration_minutes: Number(editInspection.inspection_duration_minutes) || 30,
        inspection_travel_minutes: Number(editInspection.inspection_travel_minutes) || 0,
        is_rush_order: editInspection.is_rush_order === true,
        inspection_notes: editInspection.inspection_notes || undefined,
        issues_found: editInspection.issues_found || undefined,
        inspection_status: editInspection.inspection_date ? "scheduled" : editInspection.inspection_status || undefined,
        estimated_installation_date: toApiDate(editInspection.estimated_installation_date),
        estimated_installation_time: editInspection.estimated_installation_time || "",
        installation_duration_minutes: Number(editInspection.installation_duration_minutes) || 60,
        project_additional_charges: (editInspection.project_additional_charges || []).filter((charge) => String(charge.name || "").trim() || String(charge.amount ?? "").trim()).map((charge) => ({ name: String(charge.name || "").trim(), amount: Number(charge.amount), note: String(charge.note || "").trim() })),
        payment_terms: editInspection.payment_terms || undefined,
        required_downpayment_amount: resolveRequiredPaymentAmount(
          editInspection.payment_terms,
          getEditProjectTotal(),
          editInspection.required_downpayment_amount,
        ),
        agreed_payment_date: toApiDate(editInspection.agreed_payment_date),
        ...buildWarrantyPayload(editInspection.warranty_period, editInspection.custom_warranty_days),
        warranty_assignment_mode: (editInspection.items || []).length > 1 && editInspection.warranty_assignment_mode === "per_product"
          ? "per_product"
          : "same",
        downpayment_received: Boolean(editInspection.downpayment_received),
        items: (editInspection.items || []).map((item) => {
          const normalizedProductId = normalizeProductId(item.product_id);
          // Preserve original product_id if normalization fails; only use null as last resort
          const finalProductId = normalizedProductId || item.product_id || item._id || null;
          const hasMultipleItems = (editInspection.items || []).length > 1;
          const usesItemWarranty = hasMultipleItems && editInspection.warranty_assignment_mode === "per_product";
          const hasStoredItemWarranty = Boolean(
            item.warranty_period || item.warranty_start_date || item.warranty_expiry_date || item.warranty_status
          );
          const isCustomItemWarranty = usesItemWarranty && getItemWarrantySelectValue(item) === "Custom";
          const itemWarrantyPeriod = usesItemWarranty
            ? isCustomItemWarranty ? "Custom" : item.warranty_period || 90
            : editInspection.warranty_period;
          const itemCustomWarrantyDays = usesItemWarranty
            ? Number(item.custom_warranty_days) || getWarrantyPeriodDays(item.warranty_period) || 90
            : Number(editInspection.custom_warranty_days) || 90;
          const warrantyPeriod = itemWarrantyPeriod === "Custom"
            ? itemCustomWarrantyDays
            : itemWarrantyPeriod;
          const warrantyStartDate = item.warranty_start_date || editInspection.warranty_start_date || null;
          return {
            product_id: finalProductId,
            name: item.name || "",
            quantity: Number(item.qty) || Number(item.quantity) || 1,
            unit_price: deriveUnitPriceForPayload(item),
            pricing_method: item.pricing_method || "",
            price_per_sqft: Number(item.price_per_sqft) || 0,
            area_option: item.area_option || "",
            area_options: Array.isArray(item.area_options) ? item.area_options : [],
            piece_option: item.piece_option || "",
            piece_options: Array.isArray(item.piece_options) ? item.piece_options : [],
            price_per_blade: Number(item.price_per_blade) || 0,
            base_price: Number(item.base_price) || 0,
            blade_glass_type: item.blade_glass_type || "",
            sale_mode: item.sale_mode || "",
            frame_type: item.frame_type || "",
            frame_price: Number(item.frame_price) || 0,
            custom_frame_size: Boolean(item.custom_frame_size),
            blade_count: Number(item.blade_count) || 0,
            estimated_price_override: Number(item.estimated_price_override) || 0,
            customization_fee: Number(item.customization_fee) || 0,
            customization: Boolean(item.customization),
            extra_charges: item.extra_charges || [],
            additional_project_charges: getItemAdditionalCharges(item).filter((charge) => String(charge.name || "").trim() || String(charge.amount ?? "").trim()).map((charge) => ({ name: String(charge.name || "").trim(), amount: Number(charge.amount), note: String(charge.note || "").trim() })),
            source_item_id: item._id || item.id || "",
            size_limits: item.size_limits || {},
            finished_door_pricing: item.finished_door_pricing || { enabled: false },
            door_measurement: item.door_measurement || null,
            measurement_unit: item.measurement_unit || item.measurementUnit || item.dimensions?.unit || "in",
            width: Number(item.width) || 0,
            height: Number(item.height) || 0,
            area: requiresInspectionItemDimensions(item) ? Number(item.area) || 0 : 0,
            estimated_price: item.estimation_mode === "manual"
              ? Number(item.manual_estimated_total) || calculateRowSubtotal(item)
              : calculateRowSubtotal(item),
            estimation_mode: item.estimation_mode === "manual" ? "manual" : "auto",
            manual_estimated_total: item.estimation_mode === "manual" ? Number(item.manual_estimated_total) || 0 : 0,
            is_estimate: true,
            unit: item.unit || "sqft",
            ...(hasMultipleItems || hasStoredItemWarranty ? {
              warranty_period: String(warrantyPeriod),
              custom_warranty_days: itemWarrantyPeriod === "Custom" || isCustomItemWarranty ? itemCustomWarrantyDays : null,
              warranty_start_date: toApiDate(warrantyStartDate),
              warranty_expiry_date: calculateWarrantyExpiry(warrantyStartDate, itemWarrantyPeriod, itemCustomWarrantyDays),
              warranty_status: item.warranty_status || (editInspection.warranty_start_date ? editInspection.warranty_status : "pending") || "pending",
            } : {}),
          };
        }),
        estimated_cost: computeEditTotals().totalEstimate,
        final_project_cost: getEditProjectTotal(),
        total_amount: getEditProjectTotal(),
      };

      // Validate that all items have product_id before sending
      const itemsWithoutProductId = payload.items.filter((item) => !item.product_id || !item.name);
      if (itemsWithoutProductId.length > 0) {
        const errorMsg = itemsWithoutProductId
          .map((item, idx) => `Row ${idx + 1}: ${!item.product_id ? "Missing product" : "Missing name"}`)
          .join("; ");
        toast.error(`Cannot save inspection: ${errorMsg}`);
        setSavingEdit(false);
        return;
      }

      const res = await updateOrderInspection(editInspection.id, payload);
      recordActivity(user, `Updated site inspection ${editInspection.id}.`, "Site Inspection");
      toast.success("Inspection saved");

      // update local inspections list with returned order
      if (res && res.order) {
        const savedOrder = res.order;
        const savedOrderId = savedOrder._id || savedOrder.id || editInspection.id;
        setInspections((prev) => {
          const next = prev.map((i) => ((i._id || i.id) === savedOrderId ? savedOrder : i));
          return next.filter(isSiteInspectionVisible);
        });
        setRushOrderRecords((prev) => prev.map((order) => (
          (order._id || order.id) === savedOrderId ? savedOrder : order
        )));
        // The details preview keeps its own object separate from the table data.
        // Refresh it too so edits are visible immediately when that preview is open.
        setViewInspection((prev) => (
          prev && (prev._id || prev.id) === savedOrderId ? savedOrder : prev
        ));
      }
      await fetchSiteInspections();
      setEditInspection(null);
      setHighCancellationConfirmation(false);
    } catch (err) {
      console.error("Failed to save inspection edit", err, err?.data);
      if (err?.data?.code === "RUSH_ORDER_DAILY_LIMIT") await fetchSiteInspections(false);
      // Extract detailed error message from backend response
      const details = err?.data?.details;
      const detailMessage = Array.isArray(details)
        ? details.filter(Boolean).join("; ")
        : typeof details === "string"
        ? details
        : null;
      const errorMessage = detailMessage || err?.data?.message || err?.message || "Failed to save inspection.";
      window.alert(errorMessage);
    } finally {
      setSavingEdit(false);
    }
  };

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  const sourceList = activeTab === "cancelled" ? cancelledInspections : inspections.filter(isSiteInspectionVisible);
  const searchedList = filterInspections(sourceList);
  const customerTypeFilteredList = customerTypeFilter !== "all"
    ? searchedList.filter((inspection) => (
        customerTypeFilter === "online" ? isOnlineInspection(inspection) : isWalkInInspection(inspection)
      ))
    : searchedList;
  const filteredList = activeTab === "site" && statusFilter !== "all"
    ? customerTypeFilteredList.filter((inspection) => (
        statusFilter === "scheduled"
          ? hasValidInspectionDate(inspection)
          : !hasValidInspectionDate(inspection)
      ))
    : customerTypeFilteredList;
  const priorityFilteredList = priorityFilter !== "all"
    ? filteredList.filter((inspection) => {
        const isRushOrder = getRushSlotsForInspection(inspection) > 0;
        const isRestrictedCustomer = isRestrictedCustomerOrder(inspection, restrictionClock);
        if (priorityFilter === "rush") return isRushOrder;
        if (priorityFilter === "restricted") return isRestrictedCustomer;
        return !isRushOrder && !isRestrictedCustomer;
      })
    : filteredList;
  const prioritizedList = [...priorityFilteredList].sort((left, right) => {
        const leftIsRush = getRushSlotsForInspection(left) > 0;
        const rightIsRush = getRushSlotsForInspection(right) > 0;
        if (leftIsRush !== rightIsRush) return leftIsRush ? -1 : 1;
        if (!leftIsRush) return 0;

        const leftCreatedAt = Date.parse(left.createdAt || left.created_at || left.order_date || "") || Number.POSITIVE_INFINITY;
        const rightCreatedAt = Date.parse(right.createdAt || right.created_at || right.order_date || "") || Number.POSITIVE_INFINITY;
        return leftCreatedAt - rightCreatedAt;
      });
  const totalPages = Math.max(1, Math.ceil(prioritizedList.length / pageSize));
  const currentPageIndex = Math.min(Math.max(currentPage, 1), totalPages);
  const paginatedList = prioritizedList.slice((currentPageIndex - 1) * pageSize, currentPageIndex * pageSize);
  const visibleInspections = isMobile ? prioritizedList : paginatedList;
  const visibleRecordStart = prioritizedList.length === 0 ? 0 : (currentPageIndex - 1) * pageSize + 1;
  const visibleRecordEnd = Math.min(currentPageIndex * pageSize, prioritizedList.length);
  const highlightedNotificationIndex = highlightedNotificationRecordId
    ? prioritizedList.findIndex((inspection) => String(inspection._id || inspection.id) === highlightedNotificationRecordId)
    : -1;
  const highlightedNotificationPage = highlightedNotificationIndex >= 0
    ? Math.floor(highlightedNotificationIndex / pageSize) + 1
    : null;
  useEffect(() => {
    if (highlightedNotificationPage !== null) setCurrentPage(highlightedNotificationPage);
  }, [highlightedNotificationPage]);

  const getInspectionStatusDisplay = (inspection) => {
    if (activeTab === "cancelled") return "Cancelled";
    return hasValidInspectionDate(inspection) ? "Scheduled" : "Need to be Called";
  };

  const getInspectionStatusTone = (status) => {
    if (status === "Cancelled") {
      return darkMode
        ? "border border-rose-300/40 bg-rose-500/20 text-rose-100"
        : "border border-rose-200 bg-rose-50 text-rose-700";
    }
    if (status === "Scheduled") {
      return darkMode
        ? "border border-emerald-300/40 bg-emerald-500/20 text-emerald-100"
        : "border border-emerald-200 bg-emerald-50 text-emerald-700";
    }
    return darkMode
      ? "border border-amber-300/40 bg-amber-500/20 text-amber-100"
      : "border border-amber-200 bg-amber-50 text-amber-700";
  };

  const getInspectionActionButtons = (inspection) => {
    const inspectionId = inspection._id || inspection.id;
    const isCancelledTab = activeTab === "cancelled";
    const contractExists = hasExistingContract(inspection);
    const contractWasSent = [inspection.contract_status, inspection.contractStatus, inspection.status]
      .some((status) => ["sent", "contract_sent"].includes(normalizeWorkflowValue(status)))
      || Boolean(inspection.contractSentAt || inspection.contract_sent_at);
    const hasEstimatedInstallDate = hasValidEstimatedInstallationDate(inspection);
    const generationDisabled = !contractExists && !hasEstimatedInstallDate;
    const contractButtonTitle = generationDisabled
      ? "Set the Est. Install Date first before generating the contract."
      : contractWasSent ? "Contract sent to customer" : contractExists ? "View contract" : "Generate or view contract";
    const isWalkIn = inspection.order_type === "walk_in_customer"
      || ["walk-in", "Walk-in Customer", "walk_in_customer"].includes(inspection.customerType);

    return (
      <>
        <button
          type="button"
          className={`${actionButtonClass} ${darkMode ? "bg-sky-500/25 text-sky-200 hover:bg-sky-500/40" : "bg-blue-100 text-blue-600 hover:bg-blue-200"}`}
          onClick={() => handleView(inspection)}
          title="View inspection"
          aria-label="View inspection"
        >
          <Eye size={20} strokeWidth={2.6} />
        </button>
        {!isCancelledTab && (
          <>
            <button
              type="button"
              className={`${actionButtonClass} ${darkMode ? "bg-violet-500/25 text-violet-200 hover:bg-violet-500/40" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
              onClick={() => handleEdit(inspectionId)}
              title="Edit inspection"
              aria-label="Edit inspection"
            >
              <Pencil size={16} strokeWidth={2.2} />
            </button>
            {hasValidInspectionDate(inspection) && (
              <span
                className="inline-flex"
                title={contractButtonTitle}
                aria-label={generationDisabled ? contractButtonTitle : undefined}
                tabIndex={generationDisabled ? 0 : undefined}
              >
                <button
                  type="button"
                  title={contractButtonTitle}
                  aria-label={contractButtonTitle}
                  className={`${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-40 ${contractWasSent ? (darkMode ? "bg-sky-500/25 text-sky-200 hover:bg-sky-500/40" : "bg-sky-100 text-sky-700 hover:bg-sky-200") : (darkMode ? "bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/40" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200")}`}
                  onClick={() => openContractButtonHandler(inspection)}
                  disabled={generatingId === inspectionId || generationDisabled}
                >
                {generatingId === inspectionId ? <span className="text-[10px] font-bold">…</span> : contractWasSent ? <span className="relative inline-flex h-[18px] w-[18px] items-center justify-center" aria-hidden="true"><FileText size={16} strokeWidth={2.2} /><Send size={10} strokeWidth={2.4} className="absolute -right-1.5 -top-1.5 rounded-full bg-sky-100 p-[1px] text-sky-800 dark:bg-sky-950 dark:text-sky-200" /></span> : <FileText size={16} strokeWidth={2.2} />}
                </button>
              </span>
            )}
            {isWalkIn && (
              <button
                type="button"
                title="Manual approval"
                aria-label="Manual approval"
                className={`${actionButtonClass} ${darkMode ? "bg-cyan-500/25 text-cyan-200 hover:bg-cyan-500/40" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
                onClick={() => openManualApprovalModal(inspection)}
              >
                <ShieldCheck size={16} strokeWidth={2.2} />
              </button>
            )}
            <button
              type="button"
              className={`${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "bg-rose-500/25 text-rose-200 hover:bg-rose-500/40" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
              onClick={() => requestCancel(inspectionId)}
              title="Cancel inspection"
              aria-label="Cancel inspection"
              disabled={cancellingId === inspectionId}
            >
              {cancellingId === inspectionId ? <span className="text-[10px] font-bold">…</span> : <Ban size={16} strokeWidth={2.2} />}
            </button>
          </>
        )}
        {isCancelledTab && (
          <>
            <button
              type="button"
              title="View cancellation reason"
              aria-label="View cancellation reason"
              className={`${actionButtonClass} ${darkMode ? "bg-amber-500/25 text-amber-200 hover:bg-amber-500/40" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
              onClick={() => setCancellationReasonInspection(inspection)}
            >
              <ClipboardList size={16} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              title="Restore inspection"
              aria-label="Restore inspection"
              className={`${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-60 ${darkMode ? "bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/40" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
              onClick={() => requestRestore(inspectionId)}
              disabled={restoringId === inspectionId}
            >
              {restoringId === inspectionId ? <span className="text-[10px] font-bold">…</span> : <RotateCcw size={16} strokeWidth={2.2} />}
            </button>
          </>
        )}
      </>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />

      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        <Navbar />

        <main className="flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-6">

          <AdminPageHeader
            title="Site Inspection"
            description="Manage all site inspections and estimations."
            statsClassName="grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-3"
            stats={[
              { label: "Inspections", value: inspections.length, color: "text-blue-200" },
              { label: "Scheduled", value: inspections.filter(hasValidInspectionDate).length, color: "text-emerald-300" },
              { label: "Cancelled", value: cancelledInspections.length, color: "text-red-300" },
            ]}
          />

          {requestedRecordId && (requestedModalRecordId !== requestedRecordId || requestedModalLocationKey !== location.key) && requestedRecordError?.id !== requestedRecordId && (
            <p role="status" className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              Loading the latest Site Inspection record...
            </p>
          )}
          {requestedRecordId && requestedRecordError?.id === requestedRecordId && (
            <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {requestedRecordError.message}
            </p>
          )}


          {cancellationReasonInspection && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCancellationReasonInspection(null); }}>
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="cancellation-reason-title"
                className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-700"}`}>
                    <ClipboardList size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 id="cancellation-reason-title" className="text-lg font-bold">Cancellation reason</h2>
                    <p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      Order {cancellationReasonInspection.tracking || cancellationReasonInspection.order_number || "—"}
                    </p>
                  </div>
                </div>
                <p className={`mt-5 whitespace-pre-wrap break-words rounded-xl border p-4 text-sm leading-relaxed ${darkMode ? "border-slate-700 bg-slate-900/70 text-slate-200" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                  {cancellationReasonInspection.cancellation_reason || cancellationReasonInspection.cancellationReason || cancellationReasonInspection.cancel_reason || cancellationReasonInspection.cancelled_reason || cancellationReasonInspection.reason || "No cancellation reason was provided."}
                </p>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCancellationReasonInspection(null)}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    Close
                  </button>
                </div>
              </section>
            </div>
          )}


          {/* CANCEL CONFIRMATION MODAL */}
          {cancelConfirm.open && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="cancel-inspection-title"
                className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-800 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
              >
                <h3 id="cancel-inspection-title" className="mb-2 text-xl font-bold">Cancel Inspection</h3>
                <p className={`mb-5 text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                  Enter the reason for cancelling this project. This reason will be recorded and shared with the customer.
                </p>
                <label htmlFor="inspection-cancellation-reason" className="mb-2 block text-sm font-semibold">
                  Cancellation reason <span className="text-red-500">(required)</span>
                </label>
                <textarea
                  id="inspection-cancellation-reason"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  maxLength={1000}
                  rows={4}
                  autoFocus
                  placeholder="Describe why this project is being cancelled."
                  className={`w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
                />
                <p className={`mt-1 text-right text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{cancelReason.length}/1000</p>

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeCancelModal}
                    disabled={cancellingId === cancelConfirm.id}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-gray-200 text-gray-800 hover:bg-gray-300"}`}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmCancel}
                    className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={cancellingId === cancelConfirm.id || !cancelReason.trim()}
                  >
                    {cancellingId === cancelConfirm.id ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* RESTORE CONFIRMATION MODAL */}
          {restoreConfirm.open && (
            <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
              <div className="bg-white w-full max-w-md rounded-3xl p-6">
                <h3 className="text-xl font-bold mb-4">Confirm Restore Inspection</h3>
                <p className="text-gray-600 mb-6">Are you sure you want to restore this inspection to Site Inspections?</p>

                <div className="flex justify-end gap-3">
                  <button onClick={closeRestoreModal} className="px-4 py-2 bg-gray-200 rounded-xl">Close</button>
                  <button
                    onClick={handleConfirmRestore}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl"
                    disabled={restoringId === restoreConfirm.id}
                  >
                    {restoringId === restoreConfirm.id ? 'Restoring...' : 'Confirm Restore'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {contractConfirm.open && (
            <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
              <div className="bg-white w-full max-w-md rounded-3xl p-6">
                <h3 className="text-xl font-bold mb-4">Generate Contract</h3>
                <p className="text-gray-600 mb-6">A contract will be generated for this order. Do you want to continue?</p>

                <div className="flex justify-end gap-3">
                  <button onClick={closeContractModal} className="px-4 py-2 bg-gray-200 rounded-xl">Cancel</button>
                  <button
                    onClick={handleConfirmGenerateContract}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl"
                    disabled={generatingId === contractConfirm.id}
                  >
                    {generatingId === contractConfirm.id ? 'Generating...' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showContractGenerationProgress && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 p-4" role="status" aria-live="polite">
              <div className="flex w-full max-w-sm items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
                <span className="h-8 w-8 shrink-0 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-slate-900">Generating contract</p>
                  <p className="mt-1 text-sm text-slate-600">Saving contract details. This may take a moment.</p>
                </div>
              </div>
            </div>
          )}

          {manualApprovalModal.open && (
            <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4">
              <div className="w-full max-w-md rounded-[26px] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
                <div className="mb-4 flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 shadow-sm">
                    <ShieldCheck size={24} />
                  </div>
                </div>

                <h3 className="text-center text-[28px] font-black tracking-[-0.04em] text-slate-900">Confirm Manual Approval</h3>
                <p className="mt-3 text-center text-sm leading-6 text-slate-600">
                  You are manually approving the contract for <span className="font-semibold text-slate-800">Order {manualApprovalModal.tracking}</span>. Please upload the signed contract or receipt before proceeding.
                </p>

                <label
                  className="mt-6 flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-red-300 hover:bg-red-50"
                  onClick={() => manualApprovalFileInputRef.current?.click()}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleManualApprovalFileUpload(event.dataTransfer.files);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                >
                  <input
                    ref={manualApprovalFileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={(event) => {
                      const files = event.target.files;
                      handleManualApprovalFileUpload(files);
                      event.target.value = "";
                    }}
                  />

                  {manualApprovalModal.uploadedUrl ? (
                    <div className="space-y-2 text-center">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                        <ShieldCheck size={20} />
                      </div>
                      <p className="text-sm font-semibold text-emerald-700">Signed contract uploaded</p>
                      <p className="text-xs font-medium text-slate-600 break-all">{manualApprovalModal.fileName || "Selected file"}</p>
                      <p className="text-xs text-slate-500">Ready for approval</p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-center">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 text-slate-500">
                        <FileText size={20} />
                      </div>
                      <p className="text-sm font-semibold text-slate-700">Drag &amp; drop signed contract/receipt here, or browse</p>
                      <p className="text-xs text-slate-500">Supports PDF, PNG, JPG up to 50MB</p>
                    </div>
                  )}
                </label>

                {manualApprovalModal.error && (
                  <p className="mt-3 text-sm font-medium text-red-600">{manualApprovalModal.error}</p>
                )}

                <div className="mt-8 flex justify-end gap-3">
                  <button onClick={closeManualApprovalModal} className="px-4 py-2.5 rounded-xl bg-slate-200 text-slate-700 font-semibold">Cancel</button>
                  <button
                    onClick={handleCompleteManualApproval}
                    className="px-5 py-2.5 rounded-xl bg-red-600 text-white font-bold disabled:cursor-not-allowed disabled:opacity-70"
                    disabled={manualApprovalModal.uploading || !manualApprovalModal.uploadedUrl}
                  >
                    {manualApprovalModal.uploading ? "Uploading..." : "Complete Approval"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <AppToaster />

          {/* SEARCH */}
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between 2xl:flex-nowrap">
              <div className="relative min-w-0 flex-1 lg:min-w-[10rem] lg:flex-[1_1_20rem] xl:min-w-[12rem] xl:flex-[1_1_28rem]">
                <Search
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search customer, phone, tracking ID, product, status, or address"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-12 pr-4 text-sm text-slate-700 outline-none transition focus:border-red-400 focus:bg-white"
                />
              </div>

              <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:justify-end 2xl:flex-nowrap">
                {activeTab === "site" && (
                  <FilterDropdown
                    label="All Status"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    darkMode={darkMode}
                    className="w-full sm:w-44"
                    options={[
                      ["all", "All Status"],
                      ["scheduled", "Scheduled"],
                      ["needs-call", "Need to be Called"],
                    ]}
                  />
                )}
                {activeTab === "site" || activeTab === "cancelled" ? (
                  <FilterDropdown
                    label="All Customers"
                    value={customerTypeFilter}
                    onChange={setCustomerTypeFilter}
                    darkMode={darkMode}
                    className="w-full sm:w-52"
                    options={[
                      ["all", "All Customers"],
                      ["online", "Online Customers"],
                      ["walk-in", "Walk-in Customers"],
                    ]}
                  />
                ) : null}
                {activeTab === "site" || activeTab === "cancelled" ? (
                  <FilterDropdown
                    label="All Priorities"
                    value={priorityFilter}
                    onChange={setPriorityFilter}
                    darkMode={darkMode}
                    className="w-full sm:w-52"
                    options={[
                      ["all", "All Priorities"],
                      ["standard", "Standard Order"],
                      ["rush", "Rush Order"],
                      ["restricted", "Restricted Account"],
                    ]}
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2 2xl:flex-nowrap">
                  {canGenerateBlankContract && (
                    <button
                      type="button"
                      onClick={() => setShowBlankContractModal(true)}
                      className={`inline-flex whitespace-nowrap items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-sm transition ${darkMode ? "border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}
                    >
                      <FileText size={18} className="mr-2" aria-hidden="true" />
                      Generate Blank Contract
                    </button>
                  )}
                  <button
                    onClick={() => { const initialInspection = resetNewInspectionForm(); setNewInspectionStep(1); newInspectionBaselineRef.current = createUnsavedSnapshot({ inspection: initialInspection, customerSearch: "", selectedCustomer: null }); setShowModal(true); }}
                    className="inline-flex whitespace-nowrap items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
                  >
                    <Plus size={18} className="mr-2" />
                    New Site Inspection
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* TABLE */}

          <div className={`mt-6 overflow-hidden rounded-3xl border shadow-sm ${darkMode ? "border-slate-700 bg-[#071f2f] shadow-[0_18px_48px_rgba(15,23,42,0.42)]" : "border-slate-200 bg-white"}`}>
            <div className={`border-b px-6 py-4 ${darkMode ? "border-slate-700 bg-[#0b2338]" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
                <div role="tablist" aria-label="Filter site inspection records" className="hidden items-center gap-2 md:flex">
                {[
                  { key: "site", label: "Site Inspections", count: inspections.length },
                  { key: "cancelled", label: "Cancelled", count: cancelledInspections.length },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${activeTab === tab.key ? (darkMode ? "border-red-700 bg-red-950/60 text-red-100 shadow-sm shadow-black/10" : "border-red-200 bg-red-50 text-red-950 shadow-sm") : (darkMode ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900")}`}
                  >
                    {tab.label}
                    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums ${activeTab === tab.key ? (darkMode ? "bg-red-800 text-red-50" : "bg-red-200 text-red-900") : (darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-700")}`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
                </div>
                <div className="w-full md:hidden">
                  <FilterDropdown
                    label="Site inspection view"
                    value={activeTab}
                    onChange={setActiveTab}
                    darkMode={darkMode}
                    options={[
                      ["site", `Site Inspections (${inspections.length})`],
                      ["cancelled", `Cancelled (${cancelledInspections.length})`],
                    ]}
                  />
                </div>
                <div aria-label="Order priority legend" className="site-inspection-order-legend flex w-full flex-wrap items-center justify-start gap-x-2 gap-y-2 md:ml-auto md:w-auto md:justify-end">
                  <span className={`shrink-0 text-[10.5px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>LEGEND</span>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {ORDER_TYPE_LEGEND.map((orderType, index) => (
                      <span
                        key={orderType.label}
                        title={index === 2 ? "Customer is under an online ordering cancellation cooldown" : undefined}
                        className={`order-type-chip order-type-chip--${["standard", "rush", "restricted"][index]} inline-flex h-8 shrink-0 items-center gap-2 rounded-full border-[1.5px] px-3 text-[13px] font-bold whitespace-nowrap ${orderType.chip}`}
                      >
                        <span className={`order-type-chip-dot order-type-chip-dot--${["standard", "rush", "restricted"][index]} size-3 shrink-0 rounded-full ring-[3px] ${orderType.dot} ${orderType.halo}`} aria-hidden="true" />
                        {orderType.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1405px] table-fixed border-separate border-spacing-0">
                  <colgroup>
                    <col style={{ width: "170px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "190px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "145px" }} />
                    <col style={{ width: "160px" }} />
                    <col
                      style={{
                        width: showInspectionActions ? "220px" : "56px",
                        transition: "width 500ms cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    />
                  </colgroup>
                  <thead className={darkMode ? "bg-[#0d2033] shadow-inner" : "bg-gradient-to-r from-slate-100 via-slate-50 to-white shadow-inner"}>
                    <tr>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Client</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Customer Type</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Site Address</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Order Date</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Inspection Date</th>
                      <th className={`px-2 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Est. Install Date</th>
                      <th className={`px-1 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Status</th>
                      <th className={`px-1 py-3 text-left text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>Est. Total</th>
                      <th style={{ width: showInspectionActions ? "220px" : "56px", minWidth: showInspectionActions ? "220px" : "56px" }} className={`${showInspectionActions ? "px-3" : "px-1"} py-3 text-center text-[10px] font-black uppercase leading-tight tracking-[0.1em] ${darkMode ? "text-slate-300" : "text-black"}`}>
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${showInspectionActions ? "max-w-16 translate-x-0 opacity-100" : "max-w-0 -translate-x-1 opacity-0"}`}>Actions</span>
                          <button
                            type="button"
                            onClick={() => setShowInspectionActions((visible) => !visible)}
                            className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border shadow-[0_2px_8px_rgba(15,23,42,0.18)] ring-1 ring-black/5 transition-[transform,background-color,border-color,box-shadow,color] duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 motion-reduce:transition-none ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 ring-white/10 hover:border-red-800 hover:bg-slate-700 hover:text-red-300" : "border-slate-200 bg-white text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"}`}
                            title={showInspectionActions ? "Hide all actions" : "Show all actions"}
                            aria-label={showInspectionActions ? "Hide all action buttons" : "Show all action buttons"}
                            aria-expanded={showInspectionActions}
                          >
                            <ChevronLeft className={`transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${showInspectionActions ? "rotate-0" : "rotate-180"}`} size={18} aria-hidden="true" />
                          </button>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspectionsLoading ? (
                      <tr><td colSpan={9} className={`p-8 text-center ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Loading inspections...</td></tr>
                    ) : !prioritizedList.length ? (
                      <tr><td colSpan={9} className={`p-8 text-center ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{inspectionLoadError || "No records in this tab."}</td></tr>
                    ) : (
                      visibleInspections.map((inspection, index) => {
                        const clientName = inspection.customer ? `${inspection.customer.first_name || ""} ${inspection.customer.last_name || ""}`.trim() || inspection.customer.email || inspection.customer_name || "Customer" : inspection.customer_name || inspection.customer_email || "Customer";
                        const phone = inspection.customer?.phone || inspection.customer_phone || "—";
                        const customerTypeLabel = getCustomerTypeLabel(inspection);
                        const siteAddress = inspection.shipping_address || inspection.siteAddress || inspection.customer?.street_address || "—";
                        const createdDate = formatDateToMMMDDYYYY(inspection.createdAt) || "—";
                        const createdTime = inspection.createdAt ? new Date(inspection.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
                        const inspectionDate = formatDateToMMMDDYYYY(inspection.inspection_date) || "—";
                        const inspectionTime = formatScheduleTime(inspection.inspection_time);
                        const installDateValue = getEstimatedInstallationDate(inspection);
                        const installDate = formatDateToMMMDDYYYY(installDateValue) || "—";
                        const installationTime = formatScheduleTime(inspection.estimated_installation_time);
                        const total = getFinalProjectCost(inspection) || (Array.isArray(inspection.items)
                          ? inspection.items.reduce((sum, item) => sum + getInspectionItemTotal(item), 0)
                          : 0);
                        const statusDisplay = getInspectionStatusDisplay(inspection);
                        const progressColor = getInspectionStatusTone(statusDisplay);
                        const rowActions = getInspectionActionButtons(inspection);
                        const isRestrictedCustomer = isRestrictedCustomerOrder(inspection, restrictionClock);
                        const isRushOrder = getRushSlotsForInspection(inspection) > 0;
                        const orderTypeToken = isRushOrder ? ORDER_TYPE_TOKENS.rush : isRestrictedCustomer ? ORDER_TYPE_TOKENS.restricted : ORDER_TYPE_TOKENS.standard;
                        const orderTypeKey = isRushOrder ? "rush" : isRestrictedCustomer ? "restricted" : "standard";
                        const clientPriorityCellClass = `order-type-row-cell order-type-row-cell--${orderTypeKey} rounded-l-xl border-l-[6px] ${orderTypeToken.bar}`;
                        const priorityGradient = orderTypeToken.gradientLight;
                        return (
                          <tr
                            key={inspection._id || inspection.id || index}
                            data-notification-record-id={String(inspection._id || inspection.id || "")}
                            data-notification-target="inspection"
                            className={`group border-t ${highlightedNotificationRecordId === String(inspection._id || inspection.id || "") ? "notification-target-highlight" : ""} ${darkMode ? "border-slate-700 bg-slate-900/20 hover:bg-slate-800/50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                          >
                            <td className={`px-2 py-3 ${clientPriorityCellClass}`} style={{ backgroundImage: priorityGradient }}>
                              <div className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-1 leading-snug">
                                <span role="img" title={orderTypeToken.label} aria-label={orderTypeToken.label} className={`order-type-row-dot order-type-row-dot--${orderTypeKey} mt-1 size-[11px] shrink-0 rounded-full ring-[3px] ${orderTypeToken.dot} ${orderTypeToken.halo}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="break-words text-[12px] font-bold text-slate-800 dark:text-slate-100">{clientName}</div>
                                  <div className="mt-1 break-words text-[12px] font-semibold text-slate-700 dark:text-slate-300">{phone}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-3 text-[13px] font-semibold text-slate-800 dark:text-slate-200">{customerTypeLabel}</td>
                            <td className="px-2 py-3 text-[13px] font-medium text-slate-800 dark:text-slate-200"><span className="line-clamp-2 break-words">{siteAddress}</span></td>
                            <td className="px-2 py-3 text-[13px] font-medium text-slate-800 dark:text-slate-200">{createdDate}<div className="mt-1 text-[12px] font-medium text-slate-700 dark:text-slate-300">{createdTime}</div></td>
                            <td className="px-2 py-3 text-[13px] font-medium text-slate-800 dark:text-slate-200">{inspectionDate}{inspectionTime && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{inspectionTime}</div>}</td>
                            <td className="px-2 py-3 text-[13px] font-medium text-slate-800 dark:text-slate-200">{installDate}{installationTime && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{installationTime}</div>}</td>
                            <td className="px-1 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${progressColor}`}>{statusDisplay === "Need to be Called" && <Phone size={12} aria-hidden="true" />}{statusDisplay}</span></td>
                            <td className="px-1 py-3 rounded-r-xl text-left text-[12px] font-bold text-slate-900 dark:text-slate-100"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(total)}</span></td>
                            <td style={{ width: showInspectionActions ? "220px" : "56px", minWidth: showInspectionActions ? "220px" : "56px" }} className="py-3 pl-1 pr-2 text-left">
                              <div className={`mr-auto flex w-full min-w-0 flex-nowrap items-center justify-start gap-1 overflow-hidden transition-[max-width,max-height,opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${showInspectionActions ? "max-h-10 min-w-[200px] max-w-[200px] translate-x-0 opacity-100" : "max-h-0 max-w-0 translate-x-2 opacity-0 pointer-events-none"}`}>
                                {rowActions}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 p-3 md:hidden">
              {inspectionsLoading ? (
                <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">Loading inspections...</div>
              ) : !prioritizedList.length ? (
                <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">{inspectionLoadError || "No records in this tab."}</div>
              ) : visibleInspections.map((inspection, index) => {
                const clientName = inspection.customer ? `${inspection.customer.first_name || ""} ${inspection.customer.last_name || ""}`.trim() || inspection.customer.email || inspection.customer_name || "Customer" : inspection.customer_name || inspection.customer_email || "Customer";
                const phone = inspection.customer?.phone || inspection.customer_phone || "—";
                const inspectionDate = formatDateToMMMDDYYYY(inspection.inspection_date) || "—";
                const installDateValue = getEstimatedInstallationDate(inspection);
                const installDate = formatDateToMMMDDYYYY(installDateValue) || "—";
                const inspectionTime = formatScheduleTime(inspection.inspection_time);
                const installationTime = formatScheduleTime(inspection.estimated_installation_time);
                const statusDisplay = getInspectionStatusDisplay(inspection);
                const total = getFinalProjectCost(inspection) || (Array.isArray(inspection.items) ? inspection.items.reduce((sum, item) => sum + getInspectionItemTotal(item), 0) : 0);
                const isRestrictedCustomer = isRestrictedCustomerOrder(inspection, restrictionClock);
                const isRushOrder = getRushSlotsForInspection(inspection) > 0;
                const mobilePriorityBorderClass = isRushOrder
                  ? darkMode ? "border-l-red-500" : "border-l-red-700"
                  : isRestrictedCustomer
                    ? darkMode ? "border-l-amber-500" : "border-l-amber-700"
                    : darkMode ? "border-l-slate-400" : "border-l-slate-600";
                return (
                  <div
                    key={inspection._id || inspection.id || index}
                    data-notification-record-id={String(inspection._id || inspection.id || "")}
                    data-notification-target="inspection"
                    className={`relative rounded-2xl border border-l-[4px] p-3 transition-colors ${darkMode ? "border-y-slate-700 border-r-slate-700 bg-slate-900/20" : "border-y-gray-200 border-r-gray-200 bg-gray-50"} ${mobilePriorityBorderClass} ${highlightedNotificationRecordId === String(inspection._id || inspection.id || "") ? "notification-target-highlight" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className={`break-words text-sm font-bold ${darkMode ? "text-slate-100" : "text-gray-900"}`}>{clientName}</p>
                        <p className={`mt-1 break-words text-xs font-medium ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{phone}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${getInspectionStatusTone(statusDisplay)}`}>{statusDisplay === "Need to be Called" && <Phone size={12} aria-hidden="true" />}{statusDisplay}</span></div>
                    </div>
                    <div className={`mt-3 grid grid-cols-2 gap-2 text-xs ${darkMode ? "text-slate-300" : "text-gray-600"}`}>
                      <div>
                        <p className={`text-[10px] uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-gray-400"}`}>Inspection</p>
                        <p className={`mt-1 font-medium ${darkMode ? "text-slate-200" : "text-gray-700"}`}>{inspectionDate}{inspectionTime && <span className={`ml-1 text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{inspectionTime}</span>}</p>
                      </div>
                      <div>
                        <p className={`text-[10px] uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-gray-400"}`}>Install</p>
                        <p className={`mt-1 font-medium ${darkMode ? "text-slate-200" : "text-gray-700"}`}>{installDate}{installationTime && <span className={`ml-1 text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{installationTime}</span>}</p>
                      </div>
                      <div className="col-span-2">
                        <p className={`text-[10px] uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-gray-400"}`}>Estimated Total</p>
                        <p className={`mt-1 font-semibold ${darkMode ? "text-slate-100" : "text-gray-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(total)}</span></p>
                      </div>
                    </div>
                    <div className={`mt-3 flex flex-wrap justify-end gap-1.5 rounded-xl p-1.5 ${darkMode ? "bg-[#0b2338]" : "bg-white"}`}>
                      {getInspectionActionButtons(inspection)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={`hidden flex-col gap-3 justify-center items-center border-t p-4 md:flex md:flex-row ${darkMode ? "border-slate-700 bg-[#0b2338]" : "border-slate-200 bg-gray-50"}`}>
              <div className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                Showing {visibleRecordStart} - {visibleRecordEnd} of {prioritizedList.length} records
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage <= 1}
                  className={`px-4 py-2 rounded-lg border disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border bg-white text-slate-700 hover:bg-gray-100"}`}
                >
                  Previous
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                  const startPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                  const pageNumber = startPage + idx;
                  return (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => setCurrentPage(pageNumber)}
                      className={`w-10 h-10 rounded-lg ${pageNumber === currentPage ? 'bg-red-600 text-white' : darkMode ? 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700' : 'border bg-white text-slate-700 hover:bg-gray-100'}`}
                    >
                      {pageNumber}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  disabled={currentPage >= totalPages}
                  className={`px-4 py-2 rounded-lg border disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border bg-white text-slate-700 hover:bg-gray-100"}`}
                >
                  Next
                </button>
              </div>
            </div>

          </div>

          {/* MODAL */}

          {showModal && (
            <div className="mobile-fullscreen-overlay fixed inset-0 z-50 flex h-[100dvh] min-h-0 items-stretch justify-center overflow-hidden overscroll-contain bg-slate-950/60 p-0 backdrop-blur-sm sm:h-auto sm:min-h-screen sm:items-center sm:overflow-y-auto sm:p-5">
              <div className={`mobile-fullscreen-dialog flex h-full max-h-full min-h-0 w-full max-w-none flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[88dvh] sm:max-w-[min(96vw,1440px)] sm:rounded-3xl ${modalShellClass}`}>
                <div className={`flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-7 sm:py-5 ${modalHeaderClass}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600"}`}>
                      <ClipboardList size={20} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${darkMode ? "text-red-300" : "text-red-600"}`}>Site inspection</p>
                      <h2 className={`mt-1 text-xl font-bold leading-tight sm:text-2xl ${darkMode ? "text-white" : "text-slate-900"}`}>New Site Inspection</h2>
                      <p className={`mt-1 text-sm leading-5 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Create a customer record and schedule an inspection.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={requestCloseNewInspection}
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                    aria-label="Close new site inspection modal"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>

                <div role="tablist" className={`grid grid-cols-2 gap-2 border-b px-4 py-3 sm:gap-3 sm:px-6 ${darkMode ? "border-slate-700 bg-[#0d1b2a]" : "border-slate-100 bg-slate-50/80"}`} aria-label="New site inspection sections">
                  {[
                    { number: 1, title: "Client & Schedule", detail: "Customer details and inspection date" },
                    { number: 2, title: "Project & Payment Terms", detail: "Scope, measurements, and pricing" },
                  ].map((step) => (
                    <button key={step.number} id={`new-inspection-tab-${step.number}`} type="button" role="tab" aria-selected={newInspectionStep === step.number} aria-controls="new-inspection-panel" tabIndex={newInspectionStep === step.number ? 0 : -1} onClick={() => selectInspectionTab(step.number, newInspectionStep, newInspection, setNewInspectionStep, newInspectionBodyRef)} onKeyDown={(event) => {
                      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                      event.preventDefault();
                      const targetStep = event.key === "ArrowRight" ? Math.min(2, step.number + 1) : Math.max(1, step.number - 1);
                      const changed = selectInspectionTab(targetStep, newInspectionStep, newInspection, setNewInspectionStep, newInspectionBodyRef);
                      if (changed) requestAnimationFrame(() => document.getElementById(`new-inspection-tab-${targetStep}`)?.focus());
                    }} className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${newInspectionStep === step.number ? (darkMode ? "border-red-400/50 bg-red-500/10" : "border-red-200 bg-white shadow-sm") : darkMode ? "border-slate-700 bg-slate-900/50 hover:bg-slate-800" : "border-transparent bg-transparent hover:bg-white/70"}`}>
                      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${newInspectionStep === step.number ? "bg-red-600 text-white" : newInspectionStep > step.number ? "bg-emerald-600 text-white" : darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`} aria-hidden="true">{newInspectionStep > step.number ? "✓" : step.number}</span>
                      <span className="min-w-0"><span className={`block truncate text-xs font-bold sm:text-sm ${darkMode ? "text-slate-100" : "text-slate-800"}`}>{step.title}</span><span className={`hidden truncate text-[11px] sm:block ${mutedTextClass}`}>{step.detail}</span></span>
                    </button>
                  ))}
                </div>

                <div ref={newInspectionBodyRef} role="tabpanel" id="new-inspection-panel" aria-labelledby={`new-inspection-tab-${newInspectionStep}`} className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-24 scroll-pb-24 sm:space-y-5 sm:px-6 sm:pb-5 sm:scroll-pb-5 ${newInspectionStep === 2 ? "pt-0 sm:pt-0" : "pt-4 sm:pt-5"}`}>
                  {newInspectionStep === 1 && <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Client Information</h3>

                    <div className="grid gap-5 md:grid-cols-3">
                      <div className="md:col-span-1">
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Client Name <span className="text-red-400">*</span></label>
                        <input
                          type="text"
                          placeholder="e.g. Maria Santos"
                          className={`${fieldClass} ${selectedCustomer ? "border-slate-300 bg-slate-200 text-slate-600 shadow-inner dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200" : ""}`}
                          value={customerSearch || newInspection.customerName}
                          onChange={(e) => handleClientNameInput(e.target.value)}
                        />
                        {customerSearchLoading && !selectedCustomer && <p className={`mt-2 text-xs ${mutedTextClass}`}>Searching customers...</p>}
                        {customerSearchError && <p className="mt-2 text-xs text-red-400">{customerSearchError}</p>}
                        {errors.customerName && <p className="mt-2 text-xs text-red-400">{errors.customerName}</p>}
                        {customerSuggestions.length > 0 && !selectedCustomer && (
                          <div className={`absolute z-30 mt-2 w-full max-w-[22rem] rounded-2xl border shadow-lg max-h-72 overflow-y-auto ${darkMode ? "border-slate-700 bg-[#122d42]" : "border-slate-200 bg-white"}`}>
                            {customerSuggestions.map((customer) => {
                              const label = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || customer.email || customer.phone || "Unnamed";
                              return (
                                <button
                                  key={customer._id}
                                  type="button"
                                  onClick={() => handleCustomerSelect(customer)}
                                  className={`w-full text-left px-4 py-3 ${darkMode ? "hover:bg-slate-700" : "hover:bg-slate-100"}`}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className={`font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{label}</div>
                                    {isRestrictedCustomerOrder(customer, restrictionClock) && (
                                      <span
                                        title="This customer is under an online ordering cancellation cooldown"
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${darkMode ? "bg-red-500/25 text-red-200" : "bg-red-100 text-red-700"}`}
                                      >
                                        3+ cancellations
                                      </span>
                                    )}
                                  </div>
                                  <div className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{customer.email || customer.phone || formatCustomerAddress(customer)}</div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {errors.customerId && <p className="mt-2 text-xs text-red-500">{errors.customerId}</p>}
                      </div>

                      <div className="md:col-span-1">
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Client Number <span className="text-red-400">*</span></label>
                        <input
                          type="tel"
                          inputMode="tel"
                          maxLength={13}
                          placeholder="+639171234567 or 09171234567"
                          className={selectedCustomer ? lockedFieldClass : fieldClass}
                          value={normalizePhoneInput(newInspection.phone)}
                          onChange={(e) => handleInspectionFieldChange("phone", e.target.value)}
                          readOnly={!!selectedCustomer}
                        />
                        {errors.phone && <p className="mt-2 text-xs text-red-400">{errors.phone}</p>}
                      </div>

                      <div className="md:col-span-1">
                        <FullAddressField
                          as="input"
                          type="text"
                          name="new-site-address"
                          label="Site Address *"
                          minimumLength={0}
                          showHelperMessage={false}
                          placeholder="e.g. 45 Magsaysay Dr."
                          className={fieldClass}
                          labelClassName={`mb-2 text-[14px] font-bold ${labelClass}`}
                          helperClassName={darkMode ? "text-slate-400" : "text-slate-500"}
                          value={newInspection.siteAddress}
                          onChange={(e) => handleInspectionFieldChange("siteAddress", e.target.value)}
                        />
                      </div>
                    </div>

                    {Number(selectedCustomer?.customer_cancellation_count) >= 3 && isOnlineOrderingCooldownActive(selectedCustomer, restrictionClock) && (
                      <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                        This customer has canceled orders 3 times already. Do you want to continue?
                      </div>
                    )}

                    <div className="mt-5 grid gap-5 md:grid-cols-3">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Inspection Date <span className="text-red-400">*</span></label>
                        <MonthDayYearDateInput
                          label="Inspection date"
                          value={newInspection.inspection_date}
                          timeValue={newInspection.inspection_time}
                          durationMinutes={(Number(newInspection.inspection_duration_minutes) || 30) + (Number(newInspection.inspection_travel_minutes) || 0)}
                          businessHours={businessHours}
                          min={today}
                          onTimeChange={(value) => handleInspectionFieldChange("inspection_time", value)}
                          onChange={(value) => {
                            handleInspectionFieldChange("inspection_date", value);
                            if (!value) handleInspectionFieldChange("inspection_time", "");
                            if (getInstallationDateError(value, newInspection.estimated_installation_date)) {
                              handleInspectionFieldChange("estimated_installation_date", "");
                              handleInspectionFieldChange("estimated_installation_time", "");
                            }
                          }}
                          className={fieldClass}
                          darkMode={darkMode}
                          scheduledRecords={rushOrderRecords}
                        />
                        <label className="mt-3 block text-xs font-semibold">Inspection duration (min)<input type="text" inputMode="numeric" pattern="[0-9]*" value={newInspection.inspection_duration_minutes} onChange={(event) => { if (/^\d*$/.test(event.target.value)) handleInspectionFieldChange("inspection_duration_minutes", event.target.value); }} className={`${fieldClass} mt-1`} /></label>
                        {errors.inspection_date && <p className="mt-2 text-xs text-red-400">{errors.inspection_date}</p>}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Est. Installation Date</label>
                        <MonthDayYearDateInput
                          label="Estimated installation date"
                          value={newInspection.estimated_installation_date || ""}
                          disabled={!isValidInspectionDate(newInspection.inspection_date)}
                          timeValue={newInspection.estimated_installation_time}
                          durationMinutes={Number(newInspection.installation_duration_minutes) || 60}
                          businessHours={businessHours}
                          min={getMinimumInstallationDate(newInspection.inspection_date)}
                          onTimeChange={(value) => handleInspectionFieldChange("estimated_installation_time", value)}
                          onChange={(value) => {
                            handleInspectionFieldChange("estimated_installation_date", value);
                            if (!value) handleInspectionFieldChange("estimated_installation_time", "");
                          }}
                          className={fieldClass}
                          darkMode={darkMode}
                          scheduledRecords={rushOrderRecords}
                        />
                        {!isValidInspectionDate(newInspection.inspection_date) && <p className={`mt-2 text-xs ${darkMode ? "text-amber-300" : "text-amber-700"}`}>Please set the Site Inspection Date first before scheduling the Estimated Installation Date.</p>}
                        <label className="mt-3 block text-xs font-semibold">Installation duration (min)<input type="text" inputMode="numeric" pattern="[0-9]*" value={newInspection.installation_duration_minutes} onChange={(event) => { if (/^\d*$/.test(event.target.value)) handleInspectionFieldChange("installation_duration_minutes", event.target.value); }} className={`${fieldClass} mt-1`} /></label>
                        {errors.estimated_installation_date && <p className="mt-2 text-xs text-red-400">{errors.estimated_installation_date}</p>}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Status</label>
                        <div className={`flex h-[48px] items-center justify-center rounded-xl px-3 text-sm font-bold ${inspectionStatus.className}`}>
                          <span className="mr-2 text-base">{inspectionStatus.icon}</span>
                          {inspectionStatus.label}
                        </div>
                      </div>
                    </div>


                    <section className={`mt-5 rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-slate-50"}`}>
                      <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className={`text-sm font-bold ${labelClass}`}>Additional project charges</h3><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Optional; add only charges confirmed for this project.</p></div><button type="button" onClick={() => handleInspectionFieldChange("project_additional_charges", [...(newInspection.project_additional_charges || []), { name: "", amount: "", note: "" }])} className="rounded-lg border px-3 py-2 text-xs font-semibold">Add charge</button></div>
                      {(newInspection.project_additional_charges || []).map((charge, index) => <div key={`new-charge-${index}`} className="mb-2 grid gap-2 sm:grid-cols-[1fr_150px_36px]"><input aria-label="Charge description" placeholder="e.g. Transportation" value={charge.name} onChange={(event) => handleInspectionFieldChange("project_additional_charges", newInspection.project_additional_charges.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))} className={fieldClass} /><input aria-label="Charge amount" type="number" min="0" step="0.01" placeholder="Amount (PHP)" value={charge.amount} onChange={(event) => handleInspectionFieldChange("project_additional_charges", newInspection.project_additional_charges.map((entry, i) => i === index ? { ...entry, amount: event.target.value } : entry))} className={fieldClass} /><button type="button" aria-label="Remove charge" onClick={() => handleInspectionFieldChange("project_additional_charges", newInspection.project_additional_charges.filter((_, i) => i !== index))} className="inline-flex size-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition hover:bg-red-50"><Trash2 size={15} aria-hidden="true" /></button></div>)}
                    </section>

                    {newInspection.items.length > 1 && (
                      <div className="mt-6">
                        <p className={`mb-3 text-sm font-semibold ${labelClass}`}>Warranty Assignment</p>
                        <div className="grid max-w-2xl gap-2 sm:grid-cols-2">
                          {[
                            { value: "same", label: "Same Warranty for All Products" },
                            { value: "per_product", label: "Different Warranty per Product" },
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={(newInspection.warranty_assignment_mode || "same") === option.value}
                              onClick={() => setNewInspection((prev) => ({ ...prev, warranty_assignment_mode: option.value }))}
                              className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${(newInspection.warranty_assignment_mode || "same") === option.value ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-600 bg-[#122d42] text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!(newInspection.items.length > 1 && newInspection.warranty_assignment_mode === "per_product") && <div className="mt-6">
                      <p className={`mb-3 text-sm font-semibold ${labelClass}`}>Warranty Period</p>
                      <div className="grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
                        {["No Warranty", 30, 90, "Custom"].map((option) => {
                          const isSelected = option === "Custom"
                            ? newInspection.warranty_period === "Custom" || normalizeWarrantyPeriodValue(newInspection.warranty_period) === "Custom"
                            : option === "No Warranty"
                              ? newInspection.warranty_period === "No Warranty"
                              : Number(newInspection.warranty_period) === Number(option);
                          return (
                            <button
                              key={String(option)}
                              type="button"
                              onClick={() => {
                                if (option === "Custom") {
                                  handleInspectionFieldChange("warranty_period", "Custom");
                                  setNewInspection((prev) => ({
                                    ...prev,
                                    custom_warranty_days: Number(prev.custom_warranty_days) || 90,
                                  }));
                                  return;
                                }

                                handleInspectionFieldChange("warranty_period", option === "No Warranty" ? option : Number(option));
                              }}
                              className={`min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                                isSelected
                                  ? "border-red-600 bg-red-600 text-white shadow-sm"
                                  : darkMode
                                    ? "border-slate-600 bg-[#122d42] text-slate-200 hover:border-slate-500 hover:bg-slate-700"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:bg-red-50"
                              }`}
                            >
                              {option === "Custom" || option === "No Warranty" ? option : `${option} Days`}
                            </button>
                          );
                        })}
                      </div>

                      {newInspection.warranty_period === "Custom" && (
                        <div className="mt-4 max-w-xs">
                          <label className={`mb-2 block text-[13px] font-bold ${labelClass}`}>
                            Custom Warranty Days
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={newInspection.custom_warranty_days || ""}
                            onChange={(e) => {
                              const nextValue = Number(e.target.value);
                              handleInspectionFieldChange("custom_warranty_days", Number.isFinite(nextValue) ? nextValue : 0);
                            }}
                            className={fieldClass}
                            placeholder="e.g. 365"
                          />
                        </div>
                      )}

                      <p className={`mt-3 text-xs ${mutedTextClass}`}>Coverage starts on the installation date. Used for testing warranty expiry.</p>
                    </div>}
                  </section>}

                  {newInspectionStep === 1 && <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Customer Account</h3>

                    <div className="grid gap-5 md:grid-cols-[1.1fr_1.7fr]">
                      <div>
                        <p className={`mb-2 text-[14px] font-bold ${labelClass}`}>Has Account on Website?</p>
                        <div className={`grid grid-cols-2 overflow-hidden rounded-xl border shadow-sm ${darkMode ? "border-slate-600 bg-[#122d42]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            type="button"
                            onClick={() => handleInspectionFieldChange("has_account_on_website", true)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${
                              newInspection.has_account_on_website
                                ? darkMode ? "bg-green-500/15 text-green-300" : "bg-green-50 text-green-700"
                                : darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500"
                            }`}
                          >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-white ${newInspection.has_account_on_website ? "border-green-400 bg-green-600" : "border-slate-400 bg-slate-500"}`}>✓</span>
                            Yes
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(selectedCustomer || newInspection.customerId)}
                            onClick={() => handleInspectionFieldChange("has_account_on_website", false)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              !newInspection.has_account_on_website
                                ? darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700"
                                : darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500"
                            }`}
                          >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-white ${!newInspection.has_account_on_website ? "border-red-500 bg-red-600" : "border-slate-500 bg-slate-600"}`}>×</span>
                            No
                          </button>
                        </div>
                        {newInspection.order_type === "walk_in_customer" && newInspection.has_account_on_website && (
                          <p className={`mt-2 text-xs ${mutedTextClass}`}>Select the matching registered customer from the Client Name search results to link this walk-in record to My Orders.</p>
                        )}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Customer Email (optional)</label>
                        <input
                          type="email"
                          placeholder="e.g. maria@email.com"
                          className={fieldClass}
                          value={newInspection.customerEmail}
                          onChange={(e) => handleInspectionFieldChange("customerEmail", e.target.value)}
                          readOnly={Boolean(selectedCustomer)}
                        />
                        <p className={`mt-2 text-xs ${mutedTextClass}`}>Optional — only needed if you plan to email the contract; you can still print it without one.</p>
                      </div>
                    </div>

                  </section>}

                  {newInspectionStep === 2 && <section className={`rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Additional Info</h3>
                    <textarea
                      rows={4}
                      placeholder="Describe the project scope, access notes, special requirements..."
                      className={fieldClass}
                      value={newInspection.site_notes || newInspection.notes || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewInspection((prev) => ({ ...prev, site_notes: value, notes: value }));
                      }}
                    />
                  </section>}

                  {newInspectionStep === 2 && <section className={`rounded-2xl p-3 sm:p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Measurements</h3>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Add or edit measurement rows. Totals update in real time.</p>
                    </div>

                    <div className={`mt-4 hidden overflow-x-auto rounded-xl border shadow-sm xl:block ${darkMode ? "border-[#263040] bg-[#161c26]" : "border-[#dde3ec] bg-white"}`}>

                      {(newInspection.items || []).map((item, index) => {
                        const hasSelectedProduct = Boolean(normalizeProductId(item.product_id));
                        const rowIncomplete = measurementValidationAttempted.new && Object.keys(validateInspectionMeasurementRows([item]).itemErrors[0] || {}).length > 0;
                        const hasActiveProduct = products.some((product) => String(product._id || product.id) === normalizeProductId(item.product_id));
                        const rowSubtotal = hasSelectedProduct ? calculateRowSubtotal(item) + getItemAdditionalChargesTotal(item) : 0;
                        const bladeRow = hasSelectedProduct ? renderBladeMeasurementRow(item, index, handleItemFieldChange, handleItemProductChange, removeItemRow, computeTotals(), "new") : null;
                        if (bladeRow) return <Fragment key={`new-blade-charge-${item.id}`}>{bladeRow}{renderItemAdditionalCharges(item, index, handleItemFieldChange)}</Fragment>;
                        return (
                          <div key={item.id} className={`m-0 grid min-w-[980px] grid-cols-[minmax(220px,1.65fr)_repeat(2,minmax(100px,0.85fr))_minmax(88px,0.72fr)_minmax(72px,0.58fr)_minmax(135px,1fr)_minmax(125px,0.92fr)_40px] items-end gap-3 border-b p-4 transition-colors last:border-b-0 ${rowIncomplete ? "ring-2 ring-inset ring-red-500" : ""} ${hasSelectedRushCharge(item) ? darkMode ? "border-red-400/80 bg-red-500/20 hover:bg-red-500/30" : "border-red-500 bg-red-100 hover:bg-red-200" : darkMode ? "border-[#263040] bg-[#161c26] hover:bg-[#1b2230]" : "border-[#dde3ec] bg-white hover:bg-[#f6f8fb]"}`}>
                            <div className="flex min-w-0 flex-col items-start gap-1.5">
                              <span className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Product</span>
                              <CustomerDropdown darkMode={darkMode}
                                value={normalizeProductId(item.product_id)}
                                onChange={(e) => handleItemProductChange(item.id, e.target.value)}
                                className={`product-measurement-select min-h-11 w-full rounded-lg border ${!item.product_id ? "border-dashed" : ""} px-2 py-2 text-sm outline-none transition focus:border-[#2563eb] ${darkMode ? `border-[#263040] bg-[#161c26] ${hasSelectedProduct ? "font-semibold text-red-300" : "text-[#eef1f6]"} placeholder:text-[#93a0b4] focus:ring-2 focus:ring-[#6ea8fe]/20` : `border-[#dde3ec] bg-white ${hasSelectedProduct ? "font-semibold text-red-600" : "text-[#1a2230]"} placeholder:text-[#6f7a8c] focus:ring-2 focus:ring-[#2563eb]/15`}`}
                              >
                                <option value="">-- Select Active Product --</option>
                                {hasSelectedProduct && !hasActiveProduct && <option value={normalizeProductId(item.product_id)}>{item.name || "Unavailable Product"}</option>}
                                {products.map((product) => (
                                  <option key={String(product._id || product.id)} value={String(product._id || product.id)}>{product.name}</option>
                                ))}
                              </CustomerDropdown>
                              {renderPieceMeasurementOptions(item, handleItemFieldChange, index)}
                              {renderAreaMeasurementOptions(item, handleItemFieldChange, index)}
                              {renderBladeMeasurementOptions(item, handleItemFieldChange, index)}
                            </div>
                            {renderDoorMeasurementControls(item, handleItemFieldChange)}
                            <div className="col-span-2 grid grid-cols-2 gap-3">
                              {getInspectionMeasurementFields(item).map((field) => (
                                <label key={field.key} className="min-w-0">
                                  <span className={`mb-1 block text-[10px] font-bold uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{field.label}</span>
                                  <input type="number" min="0" value={hasSelectedProduct ? getDimensionInputValue(item[field.key]) : ""} disabled={!hasSelectedProduct} onFocus={() => clearDefaultDimensionZero(item.id, field.key, item[field.key], handleItemFieldChange)} onChange={(event) => handleItemFieldChange(item.id, field.key, event.target.value)} className={`min-h-11 w-full rounded-lg border px-2 py-2 text-sm outline-none focus:ring-2 ${darkMode ? "border-[#263040] bg-[#161c26] text-[#eef1f6] focus:border-[#6ea8fe] focus:ring-[#6ea8fe]/20" : "border-[#dde3ec] bg-white text-[#1a2230] focus:border-[#2563eb] focus:ring-[#2563eb]/15"}`} />
                                </label>
                              ))}
                            </div>
                            <label className="min-w-0">
                              <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Unit</span>
                              <CustomerDropdown darkMode={darkMode}
                              aria-label={`Measurement unit for product ${index + 1}`}
                              value={hasSelectedProduct ? item.measurement_unit || item.measurementUnit || "in" : ""}
                              disabled={!hasSelectedProduct}
                              onChange={(event) => handleItemFieldChange(item.id, "measurement_unit", event.target.value)}
                              className={`min-h-11 w-full rounded-lg border px-2 py-2 text-sm outline-none focus:ring-2 ${darkMode ? "border-[#263040] bg-[#161c26] text-[#eef1f6] focus:border-[#6ea8fe] focus:ring-[#6ea8fe]/20" : "border-[#dde3ec] bg-white text-[#1a2230] focus:border-[#2563eb] focus:ring-[#2563eb]/15"}`}
                            >
                              {!hasSelectedProduct && <option value="">—</option>}
                              <option value="in">in</option>
                              <option value="ft">ft</option>
                              <option value="cm">cm</option>
                              <option value="m">m</option>
                              </CustomerDropdown>
                            </label>
                            <label className="min-w-0">
                              <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Quantity</span>
                              <input
                              type="number"
                              min="1"
                              value={hasSelectedProduct ? item.qty ?? 1 : ""}
                              disabled={!hasSelectedProduct}
                              onChange={(e) => handleItemFieldChange(item.id, "qty", e.target.value)}
                              className={`w-full rounded-lg border px-2 py-2 text-sm outline-none focus:ring-2 ${darkMode ? "border-[#263040] bg-[#161c26] text-[#eef1f6] focus:border-[#6ea8fe] focus:ring-[#6ea8fe]/20" : "border-[#dde3ec] bg-white text-[#1a2230] focus:border-[#2563eb] focus:ring-[#2563eb]/15"}`}
                              />
                            </label>
                            <div className="min-w-0">
                              <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Rate / unit</span>
                              <div className={`measurement-rate-badge flex min-h-11 items-center justify-center rounded-lg border px-2 py-2 text-sm font-bold ${darkMode ? "border-[#263040] bg-[#1b2740] text-[#6ea8fe]" : "border-[#dde3ec] bg-[#eaf1fe] text-[#2563eb]"}`}>{hasSelectedProduct ? formatRateLabel(item) : "—"}</div>
                            </div>
                            <div className="contents">
                              <div className="min-w-0">
                                <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Total</span>
                                <span className={`measurement-row-total flex min-h-11 min-w-0 items-center whitespace-nowrap text-base font-black ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{hasSelectedProduct ? formatCurrency(rowSubtotal) : "—"}</span>
                              </div>
                              <button type="button" onClick={() => requestMeasurementDelete("new", item, index)} className={`measurement-remove-button mt-0.5 inline-flex size-9 items-center justify-center self-start rounded-lg border transition ${darkMode ? "border-[#5c2a24] bg-[#3a1c18] text-[#ff8080] hover:border-[#ff8080] hover:bg-[#4a211c]" : "border-[#f3c2bc] bg-[#fdecea] text-[#d64545] hover:border-[#d64545] hover:bg-[#fbded9]"}`} aria-label={`Remove measurement ${index + 1}`} title={`Remove measurement ${index + 1}`}>
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </div>
                            {(renderOptionalChargeOptions(item, handleItemFieldChange) || hasSelectedRushCharge(item)) && <div className={`col-span-full flex flex-wrap items-center gap-3 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                              <div className="min-w-0 flex-1">{renderOptionalChargeOptions(item, handleItemFieldChange)}</div>
                              {hasSelectedRushCharge(item) && <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${darkMode ? "border-red-300 bg-red-600 text-white" : "border-red-700 bg-red-600 text-white"}`}><span className="size-2 rounded-full bg-white" aria-hidden="true" />Rush</span>}
                            </div>}
                            {renderItemAdditionalCharges(item, index, handleItemFieldChange)}
                            {newInspection.items.length > 1 && newInspection.warranty_assignment_mode === "per_product" && (
                              <div className={`col-span-full grid gap-3 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)] ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                                <label className="min-w-0">
                                  <span className={`mb-1 block text-[10px] font-bold uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Warranty for {item.name || `product ${index + 1}`}</span>
                                  <CustomerDropdown darkMode={darkMode}
                                    aria-label={`Warranty for ${item.name || `product ${index + 1}`}`}
                                    value={getItemWarrantySelectValue(item)}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (value === "Custom") {
                                        handleItemFieldChange(item.id, "warranty_period", "Custom");
                                        if (!Number(item.custom_warranty_days)) handleItemFieldChange(item.id, "custom_warranty_days", 90);
                                      } else {
                                        handleItemFieldChange(item.id, "warranty_period", value === "No Warranty" ? value : Number(value));
                                      }
                                    }}
                                    className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"}
                                  >
                                    <option value="No Warranty">No Warranty</option>
                                    <option value="30">30 Days</option>
                                    <option value="60">60 Days</option>
                                    <option value="90">90 Days</option>
                                    <option value="Custom">Custom</option>
                                  </CustomerDropdown>
                                </label>
                                {getItemWarrantySelectValue(item) === "Custom" && (
                                  <label className="min-w-0">
                                    <span className={`mb-1 block text-[10px] font-bold uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Custom warranty days</span>
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      aria-label={`Custom warranty days for product ${index + 1}`}
                                      value={getItemWarrantyCustomDays(item)}
                                      onChange={(event) => handleItemFieldChange(item.id, "custom_warranty_days", event.target.value)}
                                      className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"}
                                      placeholder="Custom days"
                                    />
                                  </label>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 space-y-3 xl:hidden">
                      {(newInspection.items || []).map((item, index) => {
                        const hasSelectedProduct = Boolean(normalizeProductId(item.product_id));
                        const rowIncomplete = measurementValidationAttempted.new && Object.keys(validateInspectionMeasurementRows([item]).itemErrors[0] || {}).length > 0;
                        const hasActiveProduct = products.some((product) => String(product._id || product.id) === normalizeProductId(item.product_id));
                        const rowSubtotal = hasSelectedProduct ? calculateRowSubtotal(item) + getItemAdditionalChargesTotal(item) : 0;
                        const bladeRow = hasSelectedProduct ? renderBladeMeasurementRow(item, index, handleItemFieldChange, handleItemProductChange, removeItemRow, computeTotals(), "new-mobile") : null;
                        if (bladeRow) return <Fragment key={`new-mobile-blade-charge-${item.id}`}>{bladeRow}{renderItemAdditionalCharges(item, index, handleItemFieldChange)}</Fragment>;
                        const inputClasses = darkMode
                          ? "min-w-0 w-full rounded-lg border border-slate-600 bg-[#122d42] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-red-500"
                          : "min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-red-500";
                        const labelClasses = `mb-1.5 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`;

                        return (
                          <div key={item.id} className={`min-w-0 rounded-xl border p-3.5 shadow-sm transition-colors sm:p-4 ${rowIncomplete ? "border-red-500 bg-red-50/60" : darkMode ? "border-slate-700 bg-[#0d2033] hover:border-slate-600" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Measurement {index + 1}</p>
                              <button type="button" onClick={() => requestMeasurementDelete("new", item, index)} className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition ${darkMode ? "border-[#5c2a24] bg-[#3a1c18] text-[#ff8080] hover:border-[#ff8080] hover:bg-[#4a211c]" : "border-[#f3c2bc] bg-[#fdecea] text-[#d64545] hover:border-[#d64545] hover:bg-[#fbded9]"}`} aria-label={`Remove measurement ${index + 1}`} title="Remove measurement">
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </div>
                            <div className="mt-2">
                              <label className={labelClasses} htmlFor={`new-measurement-product-${index}`}>Product / Description</label>
                              <CustomerDropdown darkMode={darkMode}
                                id={`new-measurement-product-${index}`}
                                value={normalizeProductId(item.product_id)}
                                onChange={(event) => handleItemProductChange(item.id, event.target.value)}
                                className={`${inputClasses} ${hasSelectedProduct ? `font-semibold ${darkMode ? "!text-red-300" : "!text-red-600"}` : ""}`}
                              >
                                <option value="">-- Select Active Product --</option>
                                {hasSelectedProduct && !hasActiveProduct && <option value={normalizeProductId(item.product_id)}>{item.name || "Unavailable Product"}</option>}
                                {products.map((product) => (
                                  <option key={String(product._id || product.id)} value={String(product._id || product.id)}>{product.name}</option>
                                ))}
                              </CustomerDropdown>
                              {renderDoorMeasurementControls(item, handleItemFieldChange)}
                              {renderPieceMeasurementOptions(item, handleItemFieldChange, index)}
                              {renderAreaMeasurementOptions(item, handleItemFieldChange, index)}
                              {renderBladeMeasurementOptions(item, handleItemFieldChange, index)}
                              {renderOptionalChargeOptions(item, handleItemFieldChange)}
                              {renderItemAdditionalCharges(item, index, handleItemFieldChange)}
                                {newInspection.items.length > 1 && newInspection.warranty_assignment_mode === "per_product" && (
                                  <div className="mt-3">
                                    <label className={labelClasses} htmlFor={`new-measurement-warranty-${index}`}>Warranty</label>
                                    <CustomerDropdown darkMode={darkMode}
                                      id={`new-measurement-warranty-${index}`}
                                      value={getItemWarrantySelectValue(item)}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        if (value === "Custom") {
                                          handleItemFieldChange(item.id, "warranty_period", "Custom");
                                          if (!Number(item.custom_warranty_days)) handleItemFieldChange(item.id, "custom_warranty_days", 90);
                                        } else {
                                          handleItemFieldChange(item.id, "warranty_period", value === "No Warranty" ? value : Number(value));
                                        }
                                      }}
                                      className={inputClasses}
                                    >
                                      <option value="No Warranty">No Warranty</option>
                                      <option value="30">30 Days</option>
                                      <option value="60">60 Days</option>
                                      <option value="90">90 Days</option>
                                      <option value="Custom">Custom</option>
                                    </CustomerDropdown>
                                    {getItemWarrantySelectValue(item) === "Custom" && (
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        aria-label={`Custom warranty days for measurement ${index + 1}`}
                                        value={getItemWarrantyCustomDays(item)}
                                        onChange={(event) => handleItemFieldChange(item.id, "custom_warranty_days", event.target.value)}
                                        className={`${inputClasses} mt-2`}
                                        placeholder="Custom warranty days"
                                      />
                                    )}
                                  </div>
                                )}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                              {getInspectionMeasurementFields(item).map((field) => (
                                <label key={field.key} className="min-w-0">
                                  <span className={labelClasses}>{field.label}</span>
                                  <input type="number" min="0" inputMode="decimal" aria-label={`${field.label} for measurement ${index + 1}`} value={hasSelectedProduct ? getDimensionInputValue(item[field.key]) : ""} disabled={!hasSelectedProduct} onFocus={() => clearDefaultDimensionZero(item.id, field.key, item[field.key], handleItemFieldChange)} onChange={(event) => handleItemFieldChange(item.id, field.key, event.target.value)} className={inputClasses} />
                                </label>
                              ))}
                              <label className="min-w-0">
                                <span className={labelClasses}>Measurement Unit</span>
                                <CustomerDropdown darkMode={darkMode} aria-label={`Measurement unit for measurement ${index + 1}`} value={hasSelectedProduct ? item.measurement_unit || item.measurementUnit || "in" : ""} disabled={!hasSelectedProduct} onChange={(event) => handleItemFieldChange(item.id, "measurement_unit", event.target.value)} className={inputClasses}>
                                  {!hasSelectedProduct && <option value="">—</option>}
                                  <option value="in">in</option>
                                  <option value="ft">ft</option>
                                  <option value="cm">cm</option>
                                  <option value="m">m</option>
                                </CustomerDropdown>
                              </label>
                              <label className="min-w-0">
                                <span className={labelClasses}>Quantity</span>
                                <input type="number" min="1" inputMode="numeric" aria-label={`Quantity for measurement ${index + 1}`} value={hasSelectedProduct ? item.qty ?? 1 : ""} disabled={!hasSelectedProduct} onChange={(event) => handleItemFieldChange(item.id, "qty", event.target.value)} className={inputClasses} />
                              </label>
                            </div>
                            <div className={`mt-3 grid grid-cols-2 gap-3 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                              <div className="min-w-0">
                                <span className={labelClasses}>Rate / Unit</span>
                                <p className={`truncate text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{hasSelectedProduct ? formatRateLabel(item) : "—"}</p>
                              </div>
                              <div className="min-w-0 text-right">
                                <span className={labelClasses}>Row Total</span>
                                <p className={`truncate text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{hasSelectedProduct ? formatCurrency(rowSubtotal) : "—"}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button type="button" onClick={addItemRow} className={`mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}>
                      <Plus size={15} aria-hidden="true" /> Add measurement
                    </button>
                    {measurementValidationAttempted.new && !validateInspectionMeasurementRows(newInspection.items || []).valid && <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">Please complete the current measurement before adding another measurement.</p>}
                    {errors.additional_project_charges && <p role="alert" className="mt-2 text-xs font-medium text-red-600">{errors.additional_project_charges}</p>}

                    <div className={`mt-4 flex justify-end border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className={`text-right ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                        {((newInspection.project_additional_charges || []).some((charge) => String(charge.name || "").trim() && String(charge.amount ?? "").trim() !== "") || (newInspection.items || []).some((item) => getItemAdditionalChargesTotal(item) > 0)) && <p className="mb-1 text-xs font-medium text-slate-500">Products + <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency((newInspection.project_additional_charges || []).reduce((sum, charge) => String(charge.name || "").trim() && String(charge.amount ?? "").trim() !== "" ? sum + (Number(charge.amount) || 0) : sum, 0) + (newInspection.items || []).reduce((sum, item) => sum + getItemAdditionalChargesTotal(item), 0))}</span> additional charges</p>}
                        <div className="text-lg font-black">Project total <span className={`ml-2 text-xl ${darkMode ? "text-red-300" : "text-red-600"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(computeTotals().totalEstimate)}</span></span></div>
                      </div>
                    </div>
                  </section>}

                  {newInspectionStep === 2 && <section className={`rounded-2xl p-3 sm:p-5 ${modalSectionClass}`}>
                    <h3 className={modalSectionTitleClass}>Payment Information</h3>
                    <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-medium ${darkMode ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                      <span className="mr-2 text-base">Tip:</span>
                      Business Policy: {isFullPaymentPlan(newInspection.payment_terms) ? "Full payment is required before project commences." : `Downpayment to be paid: ${formatCurrency(resolveRequiredPaymentAmount(newInspection.payment_terms, Number(newInspection.manual_override) || computeTotals().totalEstimate, newInspection.required_downpayment_amount))}.`}
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Estimated Cost</label>
                        <div className={`rounded-xl border px-3 py-3 text-xl font-black ${darkMode ? "border-slate-600 bg-[#122d42] text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                          <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(computeTotals().totalEstimate)}</span>
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <label htmlFor="new-manual-price-override" className={`text-[14px] font-bold ${labelClass}`}>Manual Price Override (optional)</label>
                          <button
                            type="button"
                            onClick={() => {
                              if (newManualOverrideLocked) {
                                setNewManualOverrideLocked(false);
                                window.requestAnimationFrame(() => document.getElementById("new-manual-price-override")?.focus());
                              } else {
                                setNewManualOverrideLocked(true);
                              }
                            }}
                            role="switch"
                            aria-checked={!newManualOverrideLocked}
                            aria-label={`Manual price override is ${newManualOverrideLocked ? "locked" : "unlocked"}`}
                            className={`inline-flex min-h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                          >
                            {newManualOverrideLocked ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
                            <span>{newManualOverrideLocked ? "Locked" : "Unlocked"}</span>
                            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${newManualOverrideLocked ? "bg-amber-500" : "bg-emerald-600"}`} aria-hidden="true">
                              <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${newManualOverrideLocked ? "translate-x-0.5" : "translate-x-[18px]"}`} />
                            </span>
                          </button>
                        </div>
                        <input
                          id="new-manual-price-override"
                          type={hidePaymentAmounts ? "password" : "number"}
                          min="0"
                          placeholder="Enter adjusted total..."
                          className={`${newManualOverrideLocked ? lockedFieldClass : fieldClass} manual-price-override-field`}
                          value={newInspection.manual_override}
                          disabled={newManualOverrideLocked}
                          onBlur={() => setNewManualOverrideLocked(true)}
                          onChange={(e) => handleInspectionFieldChange("manual_override", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className={`mt-5 rounded-xl border border-dashed px-4 py-4 ${darkMode ? "border-slate-600 bg-[#102838] text-slate-200" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                      <div className="flex items-center justify-between gap-4 text-[14px] font-bold">
                        <span>Final Project Cost</span>
                        <span className={`text-[18px] font-black ${darkMode ? "text-white" : "text-slate-900"}`}>
                          <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(Number(newInspection.manual_override) || computeTotals().totalEstimate)}</span>
                        </span>
                      </div>
                      <div className={`mt-3 flex items-center justify-between gap-4 border-t pt-3 text-[14px] font-bold ${darkMode ? "border-slate-700 text-red-400" : "border-slate-200 text-red-600"}`}>
                        <label htmlFor="required-downpayment-amount" className="shrink-0">Downpayment to be Paid</label>
                        <input
                          id="required-downpayment-amount"
                          type={hidePaymentAmounts ? "password" : "number"}
                          min="0"
                          max={Number(newInspection.manual_override) || computeTotals().totalEstimate}
                          step="0.01"
                          inputMode="decimal"
                          value={resolveRequiredPaymentAmount(newInspection.payment_terms, Number(newInspection.manual_override) || computeTotals().totalEstimate, newInspection.required_downpayment_amount)}
                          onChange={(event) => handleInspectionFieldChange("required_downpayment_amount", event.target.value)}
                          disabled={isFullPaymentPlan(newInspection.payment_terms) || newInspection.payment_terms === "50%_down_payment"}
                          className={`w-full max-w-[220px] rounded-lg border px-3 py-2 text-right text-base font-black outline-none focus:border-red-500 disabled:opacity-70 ${darkMode ? "border-slate-600 bg-[#122d42] text-red-300" : "border-slate-200 bg-white text-red-600"}`}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Payment Terms</label>
                        <CustomerDropdown darkMode={darkMode}
                          className={fieldClass}
                          value={newInspection.payment_terms}
                          onChange={(e) => handleInspectionFieldChange("payment_terms", e.target.value)}
                        >
                          <option value="50%_down_payment">50% downpayment, 50% upon completion</option>
                          <option value="full_payment">Full Payment</option>
                        </CustomerDropdown>
                        {shouldShowAgreedPaymentDate(newInspection.payment_terms) && (
                          <div className="mt-3">
                            <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Agreed Payment Date (optional)</label>
                            <input
                              type="date"
                              className={fieldClass}
                              min={today}
                              value={newInspection.agreed_payment_date || ""}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                if (nextValue && isPastDateValue(nextValue)) {
                                  toast.error("Agreed payment date cannot be in the past.");
                                  return;
                                }
                                handleInspectionFieldChange("agreed_payment_date", nextValue);
                              }}
                            />
                            <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              Client agreed to pay downpayment on this date.
                            </p>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>{getPaymentReceivedQuestion(newInspection.payment_terms)}</label>
                        <div className={`grid grid-cols-2 overflow-hidden rounded-xl border shadow-sm ${darkMode ? "border-slate-600 bg-[#122d42]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            type="button"
                            onClick={() => handleInspectionFieldChange("downpayment_received", true)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${
                              newInspection.downpayment_received
                                ? darkMode ? "bg-green-500/15 text-green-300" : "bg-green-50 text-green-700"
                                : darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500"
                            }`}
                          >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-white ${newInspection.downpayment_received ? "border-green-400 bg-green-600" : "border-slate-400 bg-slate-500"}`}>✓</span>
                            {isFullPaymentPlan(newInspection.payment_terms) ? "Yes, Received" : "Yes, Paid"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInspectionFieldChange("downpayment_received", false)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${
                              !newInspection.downpayment_received
                                ? darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700"
                                : darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500"
                            }`}
                          >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-white ${!newInspection.downpayment_received ? "border-red-500 bg-red-600" : "border-slate-500 bg-slate-600"}`}>×</span>
                            Not Yet
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>}
                </div>

                <div className={`sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-7 sm:py-4 ${footerClass}`}>
                  <button
                    type="button"
                    onClick={requestCloseNewInspection}
                    className={`${secondaryButtonClass} w-full sm:w-auto`}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  {newInspectionStep === 2 && <button type="button" onClick={() => changeInspectionStep(1, setNewInspectionStep, newInspectionBodyRef)} className={`${secondaryButtonClass} w-full sm:w-auto`} disabled={submitting}>Back</button>}
                  {newInspectionStep === 1 ? (
                    <button type="button" onClick={() => advanceInspectionForm(newInspection, setNewInspectionStep, newInspectionBodyRef)} className={`${primaryButtonClass} w-full sm:w-auto`} disabled={submitting}>Continue to project details</button>
                  ) : (
                    <button type="button" onClick={submitNewInspection} className={`${primaryButtonClass} w-full sm:w-auto`} disabled={submitting}>
                      {submitting ? "Creating..." : "Create Inspection"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* VIEW DETAILS MODAL */}
          {viewInspection && (
            requestedRecordId
              ? requestedModalRecordId === requestedRecordId && requestedModalLocationKey === location.key
              : !requestedModalRecordId
          ) && (() => {
            const orderId = viewInspection._id || viewInspection.id;
            const customerName = viewInspection.customer
              ? `${viewInspection.customer.first_name || ""} ${viewInspection.customer.last_name || ""}`.trim() || viewInspection.customer.email || viewInspection.customer_name || "Customer"
              : viewInspection.customer_name || viewInspection.customer_email || "Customer";
            const customerPhone = viewInspection.customer?.phone || viewInspection.customer_phone || "—";
            const siteAddress = viewInspection.shipping_address || viewInspection.siteAddress || viewInspection.customer?.street_address || "—";
            const inspectionDate = viewInspection.inspection_date ? formatDateToMMDDYYYY(viewInspection.inspection_date) : "—";
            const installDateValue = getEstimatedInstallationDate(viewInspection);
            const installDate = installDateValue ? formatDateToMMDDYYYY(installDateValue) : "—";
            const inspectionTime = formatScheduleTime(viewInspection.inspection_time);
            const installationTime = formatScheduleTime(viewInspection.estimated_installation_time);
            const orderReference = viewInspection.order_number || viewInspection.tracking || viewInspection.contract_number || `SI-ORD-${String(orderId || "NEW").slice(-10).toUpperCase()}`;
            const contractExists = hasExistingContract(viewInspection);
            const awaitingContractSignoff = isAwaitingContractSignoff(viewInspection);
            const readinessIssues = [];
            if (!contractExists && !viewInspection.inspection_date) readinessIssues.push("Inspection Date");
            if (!contractExists && !hasValidEstimatedInstallationDate(viewInspection)) readinessIssues.push("Estimated Installation Date");
            const generationDisabled = !contractExists && !hasValidEstimatedInstallationDate(viewInspection);
            const contractButtonTitle = generationDisabled
              ? "Set the Est. Install Date first before generating the contract."
              : contractExists ? "View existing contract" : "Generate contract";
            const inspectionItems = Array.isArray(viewInspection.items) ? viewInspection.items : [];
            const estimatedTotal = getInspectionDisplayTotal(
              viewInspection,
              inspectionItems.reduce((sum, item) => sum + getInspectionItemTotal(item), 0)
            );
            const isFullPaymentMethod = isFullPaymentPlan(viewInspection.payment_terms);
            const paymentSummary = getPaymentSummary(viewInspection);
            const paymentRequiredAmount = paymentSummary.requiredAmount;
            const balance = paymentSummary.remainingAmount;
            const downPayment = paymentRequiredAmount;
            const paymentStatusLabel = getPaymentStatusLabel(viewInspection.payment_terms);
            const paymentTermsText = getPaymentTermsLabel(viewInspection.payment_terms);
            const isPerProductWarranty = inspectionItems.length > 1 && viewInspection.warranty_assignment_mode === "per_product";
            const itemWarrantyLabels = inspectionItems.map((item) => {
              const period = item.warranty_period ?? viewInspection.warranty_period ?? 90;
              if (period === "No Warranty") return "No Warranty";
              const days = period === "Custom"
                ? Number(item.custom_warranty_days ?? viewInspection.custom_warranty_days) || 90
                : getWarrantyPeriodDays(period) || 90;
              return `${days} days`;
            });
            const hasDifferentItemWarranties = new Set(itemWarrantyLabels).size > 1;
            const warrantyPeriod = hasDifferentItemWarranties
              ? "Varies by product"
              : isPerProductWarranty
                ? "Per product"
              : viewInspection.warranty_period === "No Warranty"
              ? "No Warranty"
              : `${viewInspection.warranty_period === "Custom"
                ? Number(viewInspection.custom_warranty_days) || 90
                : Number(viewInspection.warranty_period) || 90} days`;
            const agreedPaymentDateValue = viewInspection.agreed_payment_date ? formatDateToMMDDYYYY(viewInspection.agreed_payment_date) : null;
            const statusBadge = !viewInspection.inspection_date
              ? {
                  label: "Need to be Called",
                  className: darkMode
                    ? "border-violet-500/30 bg-violet-500/10 text-violet-200"
                    : "border-violet-200 bg-violet-50 text-violet-700",
                }
              : {
                  label: "Scheduled",
                  className: darkMode
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700",
                };
            const downpaymentStatus = {
              label: getPaymentStatusLabel(paymentSummary.status),
              className: getPaymentStatusBadgeClassName(paymentSummary.status.key, darkMode),
            };
            const measurementRows = inspectionItems.map((item, index) => {
              const itemName = item.name || item.product_id?.name || `Item ${index + 1}`;
              const qty = Number(item.qty ?? item.quantity ?? 1) || 1;
              const bladeDetails = isInspectionBladeItem(item) ? getBladeMeasurementDetails(item) : null;
              const priceBreakdown = getProductLineBreakdown(item, item);
              const chargeOptions = (Array.isArray(item.extra_charges) ? item.extra_charges : [])
                .filter((charge) => charge?.is_active !== false)
                .map((charge) => {
                  const selected = charge?.is_optional === true ? charge.is_selected === true : true;
                  const calculatedCharge = priceBreakdown.extraCharges.find((entry) => entry.name === (charge.name || charge.label));
                  return {
                    name: charge.name || charge.label || "Extra charge",
                    optional: charge?.is_optional === true,
                    selected,
                    amount: selected ? Number(calculatedCharge?.total ?? charge.amount) || 0 : Number(charge.amount) || 0,
                  };
                });
              const bladeExtraCharges = bladeDetails
                ? bladeDetails.extraCharges
                  .map((charge) => ({
                    name: charge.name || charge.label || "Extra charge",
                    total: getBladeExtraChargeTotal(charge, bladeDetails),
                  }))
                  .filter((charge) => charge.total > 0)
                : [];
              const rowTotal = getInspectionItemTotal(item);
              const itemWarrantyPeriod = item.warranty_period ?? viewInspection.warranty_period ?? 90;
              const isNoItemWarranty = itemWarrantyPeriod === "No Warranty";
              const itemWarrantyDays = itemWarrantyPeriod === "Custom"
                ? Number(item.custom_warranty_days ?? viewInspection.custom_warranty_days) || 90
                : getWarrantyPeriodDays(itemWarrantyPeriod) || 90;
              const warrantyStartDate = isNoItemWarranty
                ? null
                : item.warranty_start_date || viewInspection.warranty_start_date || null;
              const warrantyExpiryDate = isNoItemWarranty
                ? null
                : item.warranty_expiry_date || calculateWarrantyExpiry(warrantyStartDate, itemWarrantyPeriod, item.custom_warranty_days ?? viewInspection.custom_warranty_days);

              return {
                key: `${itemName}-${index}`,
                itemName,
                isBlade: Boolean(bladeDetails),
                baseTotal: priceBreakdown.baseTotal,
                chargeOptions,
                bladeDetails: bladeDetails ? {
                  glassName: bladeDetails.selectedGlass?.name || item.blade_glass_type || "Glass",
                  bladeCount: bladeDetails.bladeCount,
                  bladeRate: bladeDetails.bladeRate,
                  saleMode: bladeDetails.saleMode,
                  frameName: item.custom_frame_size ? "Custom frame" : bladeDetails.selectedFrame?.name || "Frame",
                  framePrice: bladeDetails.framePrice,
                  extraCharges: bladeExtraCharges,
                } : null,
                width: Number(item.width || 0),
                height: Number(item.height || 0),
                unit: bladeDetails ? "per blade" : item.measurement_unit || item.unit || "in",
                qty,
                unitPrice: bladeDetails ? bladeDetails.bladeRate : Number(item.unit_price ?? item.price ?? 0) || 0,
                lineTotal: rowTotal,
                warrantyPeriod: isNoItemWarranty ? "No Warranty" : `${itemWarrantyDays} days`,
                warrantyStartDate: isNoItemWarranty
                  ? "—"
                  : warrantyStartDate ? formatDateToMMDDYYYY(warrantyStartDate) || "Pending installation" : "Pending installation",
                warrantyExpiryDate: isNoItemWarranty
                  ? "—"
                  : warrantyExpiryDate ? formatDateToMMDDYYYY(warrantyExpiryDate) || "Pending installation" : "Pending installation",
              };
            });
            return (
              <div className="mobile-fullscreen-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/45 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-5">
                <div
                  data-notification-record-id={String(orderId || "")}
                  data-notification-target="contract"
                  role="dialog"
                  aria-modal="true"
                  className={`mobile-fullscreen-dialog flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-[18px] border transition-shadow ${modalShellClass} ${highlightedNotificationRecordId === String(orderId || "") ? "notification-target-highlight" : ""}`}
                >
                  <div className={`flex shrink-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4 ${darkMode ? "border-b border-slate-700 bg-[#0b2338]" : "border-b border-slate-200 bg-white"}`}>
                    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                      <h2 className={`text-xl font-black leading-tight sm:text-[28px] ${darkMode ? "text-white" : "text-slate-900"}`}>Inspection Details</h2>
                      <span className={`break-all text-[10px] font-semibold uppercase tracking-[0.12em] sm:text-xs sm:tracking-[0.18em] ${darkMode ? "text-slate-300" : "text-slate-500"}`}>
                        {orderReference}
                      </span>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
                      <span
                        className="inline-flex min-w-0 flex-1 sm:flex-none"
                        title={contractButtonTitle}
                        aria-label={generationDisabled ? contractButtonTitle : undefined}
                        tabIndex={generationDisabled ? 0 : undefined}
                      >
                        <button
                          type="button"
                          onClick={() => contractExists
                            ? openContractButtonHandler(viewInspection)
                            : handleGenerateContract(orderId)}
                          disabled={!orderId || generatingId === orderId || (!contractExists && readinessIssues.length > 0)}
                          title={contractButtonTitle}
                          className="inline-flex min-h-10 min-w-0 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/90 px-3 py-2 text-center text-xs font-bold uppercase tracking-[0.12em] leading-tight text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-4"
                        >
                          <span>✓</span>
                          {generatingId === orderId ? "Loading..." : contractExists ? "View Contract" : "Generate Contract"}
                        </button>
                      </span>

                      <button
                        type="button"
                        onClick={closeInspectionDetails}
                        aria-label="Close inspection details"
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-lg font-semibold transition ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {readinessIssues.length > 0 && (
                    <div className={`flex items-center gap-3 border-b px-5 py-3 text-sm font-medium ${darkMode ? "border-amber-500/20 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-[#fdf3d5] text-amber-900"}`}>
                      <span className="text-base">⚠</span>
                      <span>
                        This order isn't ready for contract generation yet. Missing: {readinessIssues.join(", ")}. 
                      </span>
                    </div>
                  )}

                  <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain touch-pan-y px-3 pt-3 pb-20 sm:space-y-5 sm:px-5 sm:pt-5 sm:pb-10 ${darkMode ? "bg-[#0d1b2a]" : "bg-[#f4f3f1]"}`} style={{ WebkitOverflowScrolling: "touch" }}>
                    <div className="rounded-[10px] border border-border bg-card p-4">
                      <div className={`mb-3 text-[10.5px] font-bold uppercase tracking-[0.1em] ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Client Information</div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                        <div className="min-w-0">
                          <div className={`text-[9.5px] font-semibold uppercase tracking-[0.06em] ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Client Name</div>
                          <div className="mt-1 break-words text-[12.5px] font-semibold text-foreground">{customerName}</div>
                        </div>

                        <div className="min-w-0">
                          <div className={`text-[9.5px] font-semibold uppercase tracking-[0.06em] ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Client Number</div>
                          <div className="mt-1 break-words text-[12.5px] font-semibold text-foreground">{customerPhone}</div>
                        </div>

                        <div className="min-w-0">
                          <div className={`text-[9.5px] font-semibold uppercase tracking-[0.06em] ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Site Address</div>
                          <div className="mt-1 break-words text-[12px] leading-5 text-foreground">{siteAddress}</div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-3 sm:gap-4">
                        <div className="min-w-0">
                          <div className={`text-[9.5px] font-semibold uppercase tracking-[0.06em] ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Inspection Date</div>
                          <div className={`mt-1 text-[12px] ${darkMode ? "text-slate-100" : "text-slate-900"}`}><span className="font-semibold">{inspectionDate}</span>{inspectionTime && <span className={`ml-1 font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>at {inspectionTime}</span>}</div>
                        </div>

                        <div className="min-w-0">
                          <div className={`text-[9.5px] font-semibold uppercase tracking-[0.06em] ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Est. Installation Date</div>
                          <div className={`mt-1 text-[12px] ${darkMode ? "text-slate-100" : "text-slate-900"}`}><span className="font-semibold">{installDate}</span>{installationTime && <span className={`ml-1 font-medium ${darkMode ? "text-slate-300" : "text-slate-600"}`}>at {installationTime}</span>}</div>
                        </div>

                        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-start">
                          <span className={`inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${statusBadge.className}`}>
                            {!viewInspection.inspection_date && <Phone size={12} className="mr-1" aria-hidden="true" />}{statusBadge.label}
                          </span>
                          {awaitingContractSignoff && <span className={`${statusBadgeBaseClassName} ${getContractSignoffBadgeClassName(darkMode)}`}>Awaiting Contract Sign-off</span>}
                        </div>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-[16px] border border-border bg-card">
                      <div className="bg-muted px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                        Measurements
                      </div>

                      <div className="space-y-3 p-3">
                        {measurementRows.length ? measurementRows.map((measurement, index) => (
                          <article key={measurement.key} className="overflow-hidden rounded-[10px] border border-border bg-card">
                            <header className="flex flex-col gap-3 border-b border-border bg-muted px-3.5 py-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <h4 className="break-words text-base font-bold text-foreground">
                                  {measurement.itemName || `Item ${index + 1}`}
                                </h4>
                                {(measurement.baseTotal > 0 || measurement.chargeOptions.length > 0) && (
                                  <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                                    {measurement.baseTotal > 0 && (
                                      <span className={`max-w-full rounded-full border px-2.5 py-1 text-[11.5px] font-medium leading-tight ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200" : "border-slate-300 bg-slate-50 text-slate-700"}`}>
                                        Base price: <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(measurement.baseTotal)}</span>
                                      </span>
                                    )}
                                    {measurement.chargeOptions.map((charge, chargeIndex) => (
                                      <span key={`${charge.name}-${chargeIndex}`} className={`max-w-full whitespace-normal rounded-full border px-2.5 py-1 text-[11.5px] font-medium leading-tight ${charge.selected
                                        ? darkMode ? "border-sky-700 bg-sky-950/40 text-sky-200" : "border-sky-200 bg-sky-50 text-sky-800"
                                        : darkMode ? "border-slate-700 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                                        {charge.optional ? charge.selected ? "Selected" : "Not selected" : "Required"} · {charge.name}: {charge.selected ? formatCurrency(charge.amount) : `Excluded (${formatCurrency(charge.amount)})`}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="shrink-0 text-right sm:pl-4">
                                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Est. Total</p>
                                <p className="mt-0.5 text-xl font-bold leading-tight text-foreground"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(measurement.lineTotal)}</span></p>
                              </div>
                            </header>

                            <dl className="grid grid-cols-[repeat(auto-fit,minmax(125px,1fr))] gap-x-4 gap-y-3.5 p-3.5">
                              {measurement.isBlade ? (
                                <>
                                  <div className="min-w-0">
                                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Blades</dt>
                                    <dd className="mt-1 whitespace-nowrap text-[13.5px] font-semibold text-foreground">{measurement.bladeDetails.bladeCount} blades</dd>
                                  </div>
                                  <div className="min-w-0">
                                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Glass</dt>
                                    <dd className="mt-1 whitespace-nowrap text-[13.5px] font-semibold text-foreground">{measurement.bladeDetails.glassName}</dd>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="min-w-0">
                                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Width</dt>
                                    <dd className="mt-1 whitespace-nowrap text-[13.5px] font-semibold text-foreground">{measurement.width || "—"}</dd>
                                  </div>
                                  <div className="min-w-0">
                                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Height</dt>
                                    <dd className="mt-1 whitespace-nowrap text-[13.5px] font-semibold text-foreground">{measurement.height || "—"}</dd>
                                  </div>
                                </>
                              )}
                              <div className="min-w-0">
                                <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Size / Sale Mode</dt>
                                <dd className="mt-1 whitespace-nowrap text-[13.5px] font-semibold text-foreground">{measurement.isBlade ? measurement.bladeDetails.saleMode === "frame" ? `${measurement.bladeDetails.frameName} frame` : "Blades only" : measurement.unit}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Quantity</dt>
                                <dd className="mt-1 whitespace-nowrap text-[13.5px] font-semibold text-foreground">{measurement.qty}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Rate / Unit</dt>
                                <dd className="mt-1 whitespace-nowrap text-[13.5px] font-semibold text-foreground">{measurement.unitPrice ? `${formatCurrency(measurement.unitPrice)}${measurement.isBlade ? " / blade" : ""}` : "—"}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Warranty</dt>
                                <dd className="mt-1 whitespace-nowrap text-[13.5px] font-bold text-foreground">{measurement.warrantyPeriod}</dd>
                                {measurement.warrantyPeriod !== "No Warranty" && (
                                  <div className="mt-1 space-y-0.5 text-[11.5px] leading-snug text-muted-foreground">
                                    <p>Start: {measurement.warrantyStartDate}</p>
                                    <p>End: {measurement.warrantyExpiryDate}</p>
                                  </div>
                                )}
                              </div>
                            </dl>
                          </article>
                        )) : (
                          <p className="p-4 text-center text-sm text-muted-foreground">No measurement rows available.</p>
                        )}
                      </div>

                      <div className="mt-3.5 flex justify-end gap-2 border-t border-border px-4 py-3.5 text-foreground">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Total:</span>
                        <span className="text-xl font-bold leading-none"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(estimatedTotal)}</span></span>
                      </div>
                    </div>
                    <div className={`rounded-[16px] border p-3 sm:p-5 ${darkMode ? "border-slate-700 bg-[#122d42]" : "border-slate-200 bg-white"}`}>
                      <div className={`mb-3 text-[11px] font-black uppercase tracking-[0.18em] sm:mb-4 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Payment Summary</div>

                      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 md:gap-5">
                        <div className="space-y-2 sm:space-y-3">
                          <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                            <span className={darkMode ? "text-slate-300" : "text-slate-600"}>Final Project Cost</span>
                            <span className={`shrink-0 font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(estimatedTotal)}</span></span>
                          </div>

                          <div className={`flex min-h-9 items-center justify-between gap-3 rounded-lg border border-l-[3px] px-2.5 text-xs font-semibold sm:min-h-10 sm:px-3 sm:text-sm ${darkMode ? "border-amber-700/60 border-l-amber-400 bg-amber-950/30 text-amber-200" : "border-amber-200 border-l-amber-700 bg-amber-50 text-amber-950"}`}>
                            <span>{isFullPaymentMethod ? "Full Payment Required" : "Downpayment to be Paid"}</span>
                            <span className="shrink-0"><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(downPayment)}</span></span>
                          </div>

                          <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                            <span className={darkMode ? "text-slate-300" : "text-slate-600"}>Balance</span>
                            <span className={`shrink-0 font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{isFullPaymentMethod ? "Paid in Full" : formatCurrency(balance)}</span>
                          </div>
                        </div>

                        <div className={`space-y-2 border-t pt-2 text-xs sm:space-y-3 sm:pt-3 sm:text-sm md:border-l md:border-t-0 md:pl-5 md:pt-0 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                          <div className="grid grid-cols-[minmax(90px,0.7fr)_minmax(0,1.3fr)] items-start gap-3">
                            <span className={darkMode ? "text-slate-400" : "text-slate-500"}>Payment Terms</span>
                            <span className={`text-right font-semibold ${darkMode ? "text-slate-200" : "text-slate-900"}`}>{paymentTermsText}</span>
                          </div>

                          <div className="grid grid-cols-[minmax(90px,0.7fr)_minmax(0,1.3fr)] items-start gap-3">
                            <span className={darkMode ? "text-slate-400" : "text-slate-500"}>Warranty Period</span>
                            <span className={`text-right font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>{warrantyPeriod}</span>
                          </div>

                          {agreedPaymentDateValue && (
                            <div className="grid grid-cols-[minmax(90px,0.7fr)_minmax(0,1.3fr)] items-start gap-3">
                              <span className={darkMode ? "text-slate-400" : "text-slate-500"}>Agreed Payment Date (optional)</span>
                              <span className={`text-right ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{agreedPaymentDateValue}</span>
                            </div>
                          )}

                          <div className="grid grid-cols-[minmax(90px,0.7fr)_minmax(0,1.3fr)] items-center gap-3">
                            <span className={darkMode ? "text-slate-400" : "text-slate-500"}>{paymentStatusLabel}</span>
                            <span className="justify-self-end">
                              <span className={`${statusBadgeBaseClassName} ${downpaymentStatus.className}`}>
                                {downpaymentStatus.label}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* EDIT INSPECTION MODAL */}
          {editInspection && (
            <div className="mobile-fullscreen-overlay fixed inset-0 z-50 flex h-[100dvh] min-h-0 items-stretch justify-center overflow-hidden overscroll-contain bg-slate-950/60 p-0 backdrop-blur-sm sm:h-auto sm:min-h-screen sm:items-center sm:overflow-y-auto sm:p-5">
              <div className={`mobile-fullscreen-dialog flex h-full max-h-full min-h-0 w-full max-w-none flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[88dvh] sm:max-w-[min(96vw,1440px)] sm:rounded-3xl ${modalShellClass}`}>
                <div className={`flex shrink-0 flex-col gap-3 px-4 py-4 sm:px-7 sm:py-5 ${modalHeaderClass}`}>
                  <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600"}`}>
                      <Pencil size={19} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${darkMode ? "text-red-300" : "text-red-600"}`}>Site inspection</p>
                      <h2 className={`mt-1 text-xl font-bold leading-tight sm:text-2xl ${darkMode ? "text-white" : "text-slate-900"}`}>
                        Edit Site Inspection
                      </h2>
                      <p className={`mt-1 text-sm leading-5 ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
                        Update customer, schedule, and project details.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={requestCloseEditInspection}
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                    aria-label="Close edit site inspection modal"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                  </div>
                  {isRestrictedCustomerOrder(editInspection, restrictionClock) && (
                    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                      <div className="space-y-1">
                        <p>
                          This customer has cancelled <strong>{editInspection.customer_cancellation_count}</strong> orders
                          {isOnlineOrderingCooldownActive(editInspection, restrictionClock) && formatCancellationCooldownDate(editInspection.online_order_cooldown_until)
                            ? <> and is currently on a <strong>cancellation cooldown until {formatCancellationCooldownDate(editInspection.online_order_cooldown_until)}</strong>.</>
                            : "."}
                        </p>
                        <p>You&apos;ll be asked to confirm before this order can be created.</p>
                      </div>
                    </div>
                  )}
                </div>

                <div role="tablist" className={`grid grid-cols-2 gap-2 border-b px-4 py-3 sm:gap-3 sm:px-6 ${darkMode ? "border-slate-700 bg-[#0d1b2a]" : "border-slate-100 bg-slate-50/80"}`} aria-label="Edit site inspection sections">
                  {[
                    { number: 1, title: "Client & Schedule", detail: "Customer details and inspection date" },
                    { number: 2, title: "Project & Payment", detail: "Scope, measurements, and pricing" },
                  ].map((step) => (
                    <button key={step.number} id={`edit-inspection-tab-${step.number}`} type="button" role="tab" aria-selected={editInspectionStep === step.number} aria-controls="edit-inspection-panel" tabIndex={editInspectionStep === step.number ? 0 : -1} onClick={() => selectInspectionTab(step.number, editInspectionStep, editInspection, setEditInspectionStep, editInspectionBodyRef)} onKeyDown={(event) => {
                      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                      event.preventDefault();
                      const targetStep = event.key === "ArrowRight" ? Math.min(2, step.number + 1) : Math.max(1, step.number - 1);
                      const changed = selectInspectionTab(targetStep, editInspectionStep, editInspection, setEditInspectionStep, editInspectionBodyRef);
                      if (changed) requestAnimationFrame(() => document.getElementById(`edit-inspection-tab-${targetStep}`)?.focus());
                    }} className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${editInspectionStep === step.number ? (darkMode ? "border-red-400/50 bg-red-500/10" : "border-red-200 bg-white shadow-sm") : darkMode ? "border-slate-700 bg-slate-900/50 hover:bg-slate-800" : "border-transparent bg-transparent hover:bg-white/70"}`}>
                      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${editInspectionStep === step.number ? "bg-red-600 text-white" : editInspectionStep > step.number ? "bg-emerald-600 text-white" : darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"}`} aria-hidden="true">{editInspectionStep > step.number ? "✓" : step.number}</span>
                      <span className="min-w-0"><span className={`block truncate text-xs font-bold sm:text-sm ${darkMode ? "text-slate-100" : "text-slate-800"}`}>{step.title}</span><span className={`hidden truncate text-[11px] sm:block ${mutedTextClass}`}>{step.detail}</span></span>
                    </button>
                  ))}
                </div>

                <div ref={editInspectionBodyRef} role="tabpanel" id="edit-inspection-panel" aria-labelledby={`edit-inspection-tab-${editInspectionStep}`} className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-24 scroll-pb-24 sm:space-y-5 sm:px-6 sm:pb-5 sm:scroll-pb-5 ${editInspectionStep === 2 ? "pt-0 sm:pt-0" : "pt-4 sm:pt-5"}`}>
                  <section className={`${editInspectionStep === 1 ? "" : "hidden"} rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={`mb-5 text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>
                      Client Information
                    </h3>

                    <div className="grid gap-5 md:grid-cols-3">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Client Name</label>
                        <input
                          type="text"
                          className={editInspection.isOnlineCustomer ? lockedFieldClass : fieldClass}
                          value={editInspection.customerName || ""}
                          onChange={(e) => handleEditChange("customerName", e.target.value)}
                          readOnly={Boolean(editInspection.isOnlineCustomer)}
                          aria-readonly={Boolean(editInspection.isOnlineCustomer)}
                        />
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Client Number</label>
                        <input
                          type="tel"
                          inputMode="tel"
                          maxLength={13}
                          className={editInspection.isOnlineCustomer ? lockedFieldClass : fieldClass}
                          value={normalizePhoneInput(editInspection.phone)}
                          onChange={(e) => handleEditChange("phone", e.target.value)}
                          readOnly={Boolean(editInspection.isOnlineCustomer)}
                          aria-readonly={Boolean(editInspection.isOnlineCustomer)}
                        />
                      </div>

                      <div>
                        <FullAddressField
                          as="input"
                          type="text"
                          name="edit-site-address"
                          label="Site Address"
                          minimumLength={0}
                          showHelperMessage={false}
                          className={fieldClass}
                          labelClassName={`mb-2 text-[14px] font-bold ${labelClass}`}
                          helperClassName={darkMode ? "text-slate-400" : "text-slate-500"}
                          value={editInspection.siteAddress || ""}
                          onChange={(e) => handleEditChange("siteAddress", e.target.value)}
                          showError={normalizeFullAddress(editInspection.siteAddress) !== normalizeFullAddress(editInspectionAddressBaselineRef.current)}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 md:grid-cols-3">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Inspection Date <span className="text-red-400">*</span></label>
                        <MonthDayYearDateInput
                          label="Inspection date"
                          value={editInspection.inspection_date || ""}
                          timeValue={editInspection.inspection_time}
                          durationMinutes={(Number(editInspection.inspection_duration_minutes) || 30) + (Number(editInspection.inspection_travel_minutes) || 0)}
                          businessHours={businessHours}
                          min={today}
                          onTimeChange={(value) => handleEditChange("inspection_time", value)}
                          onChange={(value) => {
                            handleEditChange("inspection_date", value);
                            if (!value) handleEditChange("inspection_time", "");
                            if (getInstallationDateError(value, editInspection.estimated_installation_date)) {
                              handleEditChange("estimated_installation_date", "");
                              handleEditChange("estimated_installation_time", "");
                            }
                          }}
                          className={fieldClass}
                          darkMode={darkMode}
                          scheduledRecords={rushOrderRecords}
                          excludeRecordId={editInspection.id}
                        />
                        <label className="mt-3 block text-xs font-semibold">Inspection duration (min)<input type="text" inputMode="numeric" pattern="[0-9]*" value={editInspection.inspection_duration_minutes ?? 30} onChange={(event) => { if (/^\d*$/.test(event.target.value)) handleEditChange("inspection_duration_minutes", event.target.value); }} className={`${fieldClass} mt-1`} /></label>
                        {errors.inspection_date && <p className="mt-2 text-xs text-red-400">{errors.inspection_date}</p>}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Est. Installation Date</label>
                        <MonthDayYearDateInput
                          label="Estimated installation date"
                          value={editInspection.estimated_installation_date || ""}
                          disabled={!isValidInspectionDate(editInspection.inspection_date)}
                          timeValue={editInspection.estimated_installation_time}
                          durationMinutes={Number(editInspection.installation_duration_minutes) || 60}
                          businessHours={businessHours}
                          min={getMinimumInstallationDate(editInspection.inspection_date)}
                          onTimeChange={(value) => handleEditChange("estimated_installation_time", value)}
                          onChange={(value) => {
                            handleEditChange("estimated_installation_date", value);
                            if (!value) handleEditChange("estimated_installation_time", "");
                          }}
                          className={fieldClass}
                          darkMode={darkMode}
                          scheduledRecords={rushOrderRecords}
                          excludeRecordId={editInspection.id}
                        />
                        {!isValidInspectionDate(editInspection.inspection_date) && <p className={`mt-2 text-xs ${darkMode ? "text-amber-300" : "text-amber-700"}`}>Please set the Site Inspection Date first before scheduling the Estimated Installation Date.</p>}
                        <label className="mt-3 block text-xs font-semibold">Installation duration (min)<input type="text" inputMode="numeric" pattern="[0-9]*" value={editInspection.installation_duration_minutes ?? 60} onChange={(event) => { if (/^\d*$/.test(event.target.value)) handleEditChange("installation_duration_minutes", event.target.value); }} className={`${fieldClass} mt-1`} /></label>
                        {errors.estimated_installation_date && <p className="mt-2 text-xs text-red-400">{errors.estimated_installation_date}</p>}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Status</label>
                        <div className={`flex h-[48px] items-center justify-center rounded-xl px-3 text-sm font-bold ${editInspection.inspection_date ? (darkMode ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border border-emerald-200 bg-emerald-50 text-emerald-700") : statusBadgeClass}`}>
                          {editInspection.inspection_date ? <span className="mr-2 text-base">✓</span> : <Phone size={16} className="mr-2" aria-hidden="true" />}
                          {editInspection.inspection_date ? "Scheduled" : "Need to be Called"}
                        </div>
                      </div>
                    </div>


                    <section className={`mt-5 rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-900/40" : "border-slate-200 bg-slate-50"}`}>
                      <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className={`text-sm font-bold ${labelClass}`}>Additional project charges</h3><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Optional; add only charges confirmed for this project.</p></div><button type="button" onClick={() => handleEditChange("project_additional_charges", [...(editInspection.project_additional_charges || []), { name: "", amount: "", note: "" }])} className="rounded-lg border px-3 py-2 text-xs font-semibold">Add charge</button></div>
                      {(editInspection.project_additional_charges || []).map((charge, index) => <div key={`edit-charge-${index}`} className="mb-2 grid gap-2 sm:grid-cols-[1fr_150px_36px]"><input aria-label="Charge description" placeholder="e.g. Transportation" value={charge.name} onChange={(event) => handleEditChange("project_additional_charges", editInspection.project_additional_charges.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))} className={fieldClass} /><input aria-label="Charge amount" type="number" min="0" step="0.01" placeholder="Amount (PHP)" value={charge.amount} onChange={(event) => handleEditChange("project_additional_charges", editInspection.project_additional_charges.map((entry, i) => i === index ? { ...entry, amount: event.target.value } : entry))} className={fieldClass} /><button type="button" aria-label="Remove charge" onClick={() => handleEditChange("project_additional_charges", editInspection.project_additional_charges.filter((_, i) => i !== index))} className="inline-flex size-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition hover:bg-red-50"><Trash2 size={15} aria-hidden="true" /></button></div>)}
                    </section>

                    {editInspection.items.length > 1 && (
                      <div className="mt-6">
                        <p className={`mb-3 text-sm font-semibold ${labelClass}`}>Warranty Assignment</p>
                        <div className="grid max-w-2xl gap-2 sm:grid-cols-2">
                          {[
                            { value: "same", label: "Same Warranty for All Products" },
                            { value: "per_product", label: "Different Warranty per Product" },
                          ].map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={(editInspection.warranty_assignment_mode || "same") === option.value}
                              onClick={() => setEditInspection((prev) => ({ ...prev, warranty_assignment_mode: option.value }))}
                              className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${(editInspection.warranty_assignment_mode || "same") === option.value ? "border-red-600 bg-red-600 text-white" : darkMode ? "border-slate-600 bg-[#122d42] text-slate-200" : "border-slate-200 bg-white text-slate-700"}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!(editInspection.items.length > 1 && editInspection.warranty_assignment_mode === "per_product") && <div className="mt-6">
                      <p className={`mb-3 text-sm font-semibold ${labelClass}`}>Warranty Period</p>
                      <div className="grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
                        {["No Warranty", 30, 90, "Custom"].map((option) => {
                          const isSelected = option === "Custom"
                            ? editInspection.warranty_period === "Custom" || normalizeWarrantyPeriodValue(editInspection.warranty_period) === "Custom"
                            : option === "No Warranty"
                              ? editInspection.warranty_period === "No Warranty"
                              : Number(editInspection.warranty_period) === Number(option);
                          return (
                            <button
                              key={String(option)}
                              type="button"
                              onClick={() => {
                                if (option === "Custom") {
                                  handleEditChange("warranty_period", "Custom");
                                  setEditInspection((prev) => ({
                                    ...prev,
                                    custom_warranty_days: Number(prev.custom_warranty_days) || 90,
                                  }));
                                  return;
                                }

                                handleEditChange("warranty_period", option === "No Warranty" ? option : Number(option));
                              }}
                              className={`min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                                isSelected
                                  ? "border-red-600 bg-red-600 text-white shadow-sm"
                                  : darkMode
                                    ? "border-slate-600 bg-[#122d42] text-slate-200 hover:border-slate-500 hover:bg-slate-700"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:bg-red-50"
                              }`}
                            >
                              {option === "Custom" || option === "No Warranty" ? option : `${option} Days`}
                            </button>
                          );
                        })}
                      </div>

                      {editInspection.warranty_period === "Custom" && (
                        <div className="mt-4 max-w-xs">
                          <label className={`mb-2 block text-[13px] font-bold ${labelClass}`}>
                            Custom Warranty Days
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={editInspection.custom_warranty_days || ""}
                            onChange={(e) => {
                              const nextValue = Number(e.target.value);
                              handleEditChange("custom_warranty_days", Number.isFinite(nextValue) ? nextValue : 0);
                            }}
                            className={fieldClass}
                            placeholder="e.g. 365"
                          />
                        </div>
                      )}

                      <p className={`mt-3 text-xs ${mutedTextClass}`}>Coverage starts on the installation date. Used for testing warranty expiry.</p>
                    </div>}

                  </section>

                  <section className={`${editInspectionStep === 1 ? "" : "hidden"} rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={`mb-5 text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>Customer Account</h3>

                    <div className="grid gap-5 md:grid-cols-[1.1fr_1.7fr]">
                      <div>
                        <p className={`mb-2 text-[14px] font-bold ${labelClass}`}>Has Account on Website?</p>
                        <div className={`grid grid-cols-2 overflow-hidden rounded-xl border shadow-sm ${darkMode ? "border-slate-600 bg-[#122d42]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            type="button"
                            disabled={editInspection.isOnlineCustomer}
                            onClick={() => handleEditChange("has_account_on_website", true)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-100 ${editInspection.has_account_on_website ? (darkMode ? "bg-green-500/15 text-green-300" : "bg-green-50 text-green-700") : (darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500")}`}
                          >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-white ${editInspection.has_account_on_website ? "border-green-400 bg-green-600" : "border-slate-400 bg-slate-500"}`}>✓</span>
                            Yes
                          </button>
                          <button
                            type="button"
                            disabled={editInspection.isOnlineCustomer}
                            onClick={() => handleEditChange("has_account_on_website", false)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${!editInspection.has_account_on_website ? (darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700") : (darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500")}`}
                          >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-white ${!editInspection.has_account_on_website ? "border-red-500 bg-red-600" : "border-slate-500 bg-slate-600"}`}>×</span>
                            No
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Customer Email (optional)</label>
                        <input
                          type="email"
                          className={editInspection.isOnlineCustomer ? lockedFieldClass : fieldClass}
                          value={editInspection.customerEmail || ""}
                          onChange={(e) => handleEditChange("customerEmail", e.target.value)}
                          readOnly={Boolean(editInspection.isOnlineCustomer)}
                          aria-readonly={Boolean(editInspection.isOnlineCustomer)}
                        />
                        <p className={`mt-2 text-xs ${mutedTextClass}`}>Optional — only needed if you plan to email the contract; you can still print it without one.</p>
                      </div>
                    </div>
                  </section>

                  <section className={`${editInspectionStep === 2 ? "" : "hidden"} rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={`mb-4 text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>
                      Additional Info
                    </h3>
                    <textarea
                      rows={4}
                      placeholder="Describe the project scope, access notes, special requirements..."
                      className={fieldClass}
                      value={editInspection.inspection_notes || ""}
                      onChange={(e) => handleEditChange("inspection_notes", e.target.value)}
                    />
                  </section>

                  <section className={`${editInspectionStep === 2 ? "" : "hidden"} rounded-2xl p-5 ${modalSectionClass}`}>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className={`text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>
                        Measurements
                      </h3>
                      <button
                        type="button"
                        onClick={() => setEditMeasurementsEnabled((enabled) => !enabled)}
                        aria-pressed={editMeasurementsEnabled}
                        className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 xl:hidden ${darkMode ? "border-[#263040] bg-[#1b2740] text-[#6ea8fe] hover:bg-[#22324f] focus-visible:ring-[#6ea8fe]/30" : "border-[#dde3ec] bg-[#eaf1fe] text-[#2563eb] hover:bg-[#dce8fc] focus-visible:ring-[#2563eb]/20"}`}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        {editMeasurementsEnabled ? "Done" : "Edit"}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Edit product measurements and review the live project total.</p>
                      <button
                        type="button"
                        onClick={() => setEditMeasurementsEnabled((enabled) => !enabled)}
                        aria-pressed={editMeasurementsEnabled}
                        className={`hidden min-h-9 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 xl:inline-flex ${darkMode ? "border-[#263040] bg-[#1b2740] text-[#6ea8fe] hover:bg-[#22324f] focus-visible:ring-[#6ea8fe]/30" : "border-[#dde3ec] bg-[#eaf1fe] text-[#2563eb] hover:bg-[#dce8fc] focus-visible:ring-[#2563eb]/20"}`}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        {editMeasurementsEnabled ? "Done" : "Edit"}
                      </button>
                    </div>

                    <div className={`mt-4 hidden overflow-x-auto rounded-xl border shadow-sm xl:block ${darkMode ? "border-[#263040] bg-[#161c26]" : "border-[#dde3ec] bg-white"}`}>

                      <fieldset disabled={!editMeasurementsEnabled} className={`m-0 min-w-0 w-full border-0 p-0 ${editMeasurementsEnabled ? "" : "edit-measurements-disabled"}`}>
                      {(editInspection.items || []).map((item, index) => {
                        const hasSelectedProduct = Boolean(normalizeProductId(item.product_id));
                        const rowIncomplete = measurementValidationAttempted.edit && Object.keys(validateInspectionMeasurementRows([item]).itemErrors[0] || {}).length > 0;
                        const hasActiveProduct = products.some((product) => String(product._id || product.id) === normalizeProductId(item.product_id));
                        const rowSubtotal = hasSelectedProduct ? getEditItemSubtotalForTotals(item) + getItemAdditionalChargesTotal(item) : 0;
                        const bladeRow = hasSelectedProduct ? renderBladeMeasurementRow(item, index, handleEditItemFieldChange, handleEditItemProductChange, removeEditItemRow, computeEditTotals(), "edit") : null;
                        if (bladeRow) return <Fragment key={`edit-blade-charge-${item.id || index}`}>{bladeRow}{renderItemAdditionalCharges(item, index, handleEditItemFieldChange)}</Fragment>;
                        return (
                          <div key={item.id || `${item.product_id || "row"}-${index}`} className={`m-0 grid min-w-[980px] grid-cols-[minmax(220px,1.65fr)_repeat(2,minmax(100px,0.85fr))_minmax(88px,0.72fr)_minmax(72px,0.58fr)_minmax(135px,1fr)_minmax(125px,0.92fr)_40px] items-end gap-3 border-b p-4 transition-colors last:border-b-0 ${rowIncomplete ? "ring-2 ring-inset ring-red-500" : ""} ${hasSelectedRushCharge(item) ? darkMode ? "border-red-400/80 bg-red-500/20 hover:bg-red-500/30" : "border-red-500 bg-red-100 hover:bg-red-200" : darkMode ? "border-[#263040] bg-[#161c26] hover:bg-[#1b2230]" : "border-[#dde3ec] bg-white hover:bg-[#f6f8fb]"}`}>
                            <div className="flex min-w-0 flex-col items-start gap-1.5">
                              <span className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Product</span>
                              <CustomerDropdown darkMode={darkMode}
                                value={normalizeProductId(item.product_id)}
                                onChange={(e) => handleEditItemProductChange(item.id, e.target.value)}
                                className={`product-measurement-select min-h-11 w-full rounded-lg border ${!item.product_id ? "border-dashed" : ""} px-2 py-2 text-sm outline-none transition focus:border-[#2563eb] ${darkMode ? `border-[#263040] bg-[#161c26] ${hasSelectedProduct ? "font-semibold text-red-300" : "text-[#eef1f6]"} focus:ring-2 focus:ring-[#6ea8fe]/20` : `border-[#dde3ec] bg-white ${hasSelectedProduct ? "font-semibold text-red-600" : "text-[#1a2230]"} focus:ring-2 focus:ring-[#2563eb]/15`}`}
                              >
                                <option value="">-- Select Active Product --</option>
                                {hasSelectedProduct && !hasActiveProduct && <option value={normalizeProductId(item.product_id)}>{item.name || "Unavailable Product"}</option>}
                                {products.map((product) => (
                                  <option key={String(product._id || product.id)} value={String(product._id || product.id)}>{product.name}</option>
                                ))}
                              </CustomerDropdown>
                              {renderPieceMeasurementOptions(item, handleEditItemFieldChange, index)}
                              {renderAreaMeasurementOptions(item, handleEditItemFieldChange, index)}
                              {renderBladeMeasurementOptions(item, handleEditItemFieldChange, index)}
                            </div>

                            {renderDoorMeasurementControls(item, handleEditItemFieldChange)}
                            <div className="col-span-2 grid grid-cols-2 gap-2">
                              {getInspectionMeasurementFields(item).map((field) => (
                                <label key={field.key} className="min-w-0">
                                  <span className={`mb-1 block text-[10px] font-bold uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{field.label}</span>
                                  <input type="number" min="0" value={hasSelectedProduct ? getDimensionInputValue(item[field.key]) : ""} disabled={!hasSelectedProduct} onFocus={() => clearDefaultDimensionZero(item.id, field.key, item[field.key], handleEditItemFieldChange)} onChange={(event) => handleEditItemFieldChange(item.id, field.key, event.target.value)} className={darkMode ? "min-h-11 w-full rounded-lg border border-[#263040] bg-[#161c26] px-2 py-2 text-sm text-[#eef1f6] outline-none focus:border-[#6ea8fe] focus:ring-2 focus:ring-[#6ea8fe]/20" : "min-h-11 w-full rounded-lg border border-[#dde3ec] bg-white px-2 py-2 text-sm text-[#1a2230] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15"} />
                                </label>
                              ))}
                            </div>

                            <label className="min-w-0">
                              <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Unit</span>
                              <CustomerDropdown darkMode={darkMode}
                              aria-label={`Measurement unit for ${item.name || "item"}`}
                              value={hasSelectedProduct ? item.measurement_unit || item.measurementUnit || "in" : ""}
                              disabled={!hasSelectedProduct}
                              onChange={(event) => handleEditItemFieldChange(item.id, "measurement_unit", event.target.value)}
                              className={darkMode ? "min-h-11 w-full rounded-lg border border-[#263040] bg-[#161c26] px-2 py-2 text-sm text-[#eef1f6] outline-none focus:border-[#6ea8fe] focus:ring-2 focus:ring-[#6ea8fe]/20" : "min-h-11 w-full rounded-lg border border-[#dde3ec] bg-white px-2 py-2 text-sm text-[#1a2230] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15"}
                            >
                              {!hasSelectedProduct && <option value="">—</option>}
                              <option value="in">in</option>
                              <option value="ft">ft</option>
                              <option value="cm">cm</option>
                              <option value="m">m</option>
                              </CustomerDropdown>
                            </label>

                            <label className="min-w-0">
                              <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Quantity</span>
                              <input
                              type="number"
                              min="1"
                              value={hasSelectedProduct ? item.qty ?? item.quantity ?? 1 : ""}
                              disabled={!hasSelectedProduct}
                              onChange={(e) => handleEditItemFieldChange(item.id, "qty", e.target.value)}
                              className={darkMode ? "w-full rounded-lg border border-[#263040] bg-[#161c26] px-2 py-2 text-sm text-[#eef1f6] outline-none focus:border-[#6ea8fe] focus:ring-2 focus:ring-[#6ea8fe]/20" : "w-full rounded-lg border border-[#dde3ec] bg-white px-2 py-2 text-sm text-[#1a2230] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15"}
                              />
                            </label>

                            <div className="min-w-0">
                              <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Rate / unit</span>
                              <div className={`measurement-rate-badge flex min-h-11 items-center justify-center rounded-lg border px-2 py-2 text-sm font-bold ${darkMode ? "border-[#263040] bg-[#1b2740] text-[#6ea8fe]" : "border-[#dde3ec] bg-[#eaf1fe] text-[#2563eb]"}`}>{hasSelectedProduct ? formatRateLabel(item) : "—"}</div>
                            </div>

                            <div className="contents">
                              <div className="min-w-0"><span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Total</span><span className={`measurement-row-total flex min-h-11 min-w-0 items-center whitespace-nowrap text-base font-black ${darkMode ? "text-slate-100" : "text-slate-900"}` }>
                                {hasSelectedProduct ? formatCurrency(rowSubtotal) : "—"}
                              </span>
                              </div>
                              <button type="button" onClick={() => requestMeasurementDelete("edit", item, index)} className={`measurement-remove-button mt-0.5 inline-flex size-9 items-center justify-center self-start rounded-lg border transition ${darkMode ? "border-[#5c2a24] bg-[#3a1c18] text-[#ff8080] hover:border-[#ff8080] hover:bg-[#4a211c]" : "border-[#f3c2bc] bg-[#fdecea] text-[#d64545] hover:border-[#d64545] hover:bg-[#fbded9]"}`} aria-label={`Remove measurement ${index + 1}`} title={`Remove measurement ${index + 1}`}>
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </div>
                            {(renderOptionalChargeOptions(item, handleEditItemFieldChange) || hasSelectedRushCharge(item)) && <div className={`col-span-full flex flex-wrap items-center gap-3 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                              <div className="min-w-0 flex-1">{renderOptionalChargeOptions(item, handleEditItemFieldChange)}</div>
                              {hasSelectedRushCharge(item) && <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${darkMode ? "border-red-300 bg-red-600 text-white" : "border-red-700 bg-red-600 text-white"}`}><span className="size-2 rounded-full bg-white" aria-hidden="true" />Rush</span>}
                            </div>}
                            {renderItemAdditionalCharges(item, index, handleEditItemFieldChange)}
                            {editInspection.items.length > 1 && editInspection.warranty_assignment_mode === "per_product" && (
                              <div className={`col-span-full grid gap-3 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)] ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                                <label className="min-w-0">
                                  <span className={`mb-1 block text-[10px] font-bold uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Warranty for {item.name || `product ${index + 1}`}</span>
                                  <CustomerDropdown darkMode={darkMode}
                                    aria-label={`Warranty for ${item.name || "product"}`}
                                    value={getItemWarrantySelectValue(item)}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (value === "Custom") {
                                        handleEditItemFieldChange(item.id, "warranty_period", "Custom");
                                        if (!Number(item.custom_warranty_days)) handleEditItemFieldChange(item.id, "custom_warranty_days", 90);
                                      } else {
                                        handleEditItemFieldChange(item.id, "warranty_period", value === "No Warranty" ? value : Number(value));
                                      }
                                    }}
                                    className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"}
                                  >
                                    <option value="No Warranty">No Warranty</option>
                                    <option value="30">30 Days</option>
                                    <option value="60">60 Days</option>
                                    <option value="90">90 Days</option>
                                    <option value="Custom">Custom</option>
                                  </CustomerDropdown>
                                </label>
                                {getItemWarrantySelectValue(item) === "Custom" && (
                                  <label className="min-w-0">
                                    <span className={`mb-1 block text-[10px] font-bold uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Custom warranty days</span>
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      aria-label={`Custom warranty days for ${item.name || `product ${index + 1}`}`}
                                      value={getItemWarrantyCustomDays(item)}
                                      onChange={(event) => handleEditItemFieldChange(item.id, "custom_warranty_days", event.target.value)}
                                      className={darkMode ? "w-full rounded-lg border border-slate-600 bg-[#122d42] px-2 py-2 text-sm text-slate-100" : "w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"}
                                      placeholder="Custom days"
                                    />
                                  </label>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      </fieldset>
                    </div>

                    <fieldset disabled={!editMeasurementsEnabled} className={`m-0 min-w-0 w-full border-0 p-0 ${editMeasurementsEnabled ? "" : "edit-measurements-disabled"}`}>
                    <div className="mt-4 space-y-3 xl:hidden">
                      {(editInspection.items || []).map((item, index) => {
                        const hasSelectedProduct = Boolean(normalizeProductId(item.product_id));
                        const rowIncomplete = measurementValidationAttempted.edit && Object.keys(validateInspectionMeasurementRows([item]).itemErrors[0] || {}).length > 0;
                        const hasActiveProduct = products.some((product) => String(product._id || product.id) === normalizeProductId(item.product_id));
                        const rowSubtotal = hasSelectedProduct ? getEditItemSubtotalForTotals(item) + getItemAdditionalChargesTotal(item) : 0;
                        const bladeRow = hasSelectedProduct ? renderBladeMeasurementRow(item, index, handleEditItemFieldChange, handleEditItemProductChange, removeEditItemRow, computeEditTotals(), "edit-mobile") : null;
                        if (bladeRow) return <Fragment key={`edit-mobile-blade-charge-${item.id || index}`}>{bladeRow}{renderItemAdditionalCharges(item, index, handleEditItemFieldChange)}</Fragment>;
                        const inputClasses = darkMode
                          ? "min-w-0 w-full rounded-lg border border-slate-600 bg-[#122d42] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-red-500"
                          : "min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-red-500";
                        const labelClasses = `mb-1.5 block text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`;

                        return (
                          <div key={item.id || `${item.product_id || "row"}-${index}`} className={`min-w-0 rounded-xl border p-3.5 shadow-sm transition-colors sm:p-4 ${rowIncomplete ? "border-red-500 bg-red-50/60" : darkMode ? "border-slate-700 bg-[#0d2033] hover:border-slate-600" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-xs font-bold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Measurement {index + 1}</p>
                              <button type="button" onClick={() => requestMeasurementDelete("edit", item, index)} className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition ${darkMode ? "border-[#5c2a24] bg-[#3a1c18] text-[#ff8080] hover:border-[#ff8080] hover:bg-[#4a211c]" : "border-[#f3c2bc] bg-[#fdecea] text-[#d64545] hover:border-[#d64545] hover:bg-[#fbded9]"}`} aria-label={`Remove measurement ${index + 1}`} title="Remove measurement">
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </div>
                            <div className="mt-2">
                              <label className={labelClasses} htmlFor={`edit-measurement-product-${index}`}>Product / Description</label>
                              <CustomerDropdown darkMode={darkMode}
                                id={`edit-measurement-product-${index}`}
                                value={normalizeProductId(item.product_id)}
                                onChange={(event) => handleEditItemProductChange(item.id, event.target.value)}
                                className={`${inputClasses} ${hasSelectedProduct ? `font-semibold ${darkMode ? "!text-red-300" : "!text-red-600"}` : ""}`}
                              >
                                <option value="">-- Select Active Product --</option>
                                {hasSelectedProduct && !hasActiveProduct && <option value={normalizeProductId(item.product_id)}>{item.name || "Unavailable Product"}</option>}
                                {products.map((product) => (
                                  <option key={String(product._id || product.id)} value={String(product._id || product.id)}>{product.name}</option>
                                ))}
                              </CustomerDropdown>
                              {renderDoorMeasurementControls(item, handleEditItemFieldChange)}
                              {renderPieceMeasurementOptions(item, handleEditItemFieldChange, index)}
                              {renderAreaMeasurementOptions(item, handleEditItemFieldChange, index)}
                              {renderBladeMeasurementOptions(item, handleEditItemFieldChange, index)}
                              {renderOptionalChargeOptions(item, handleEditItemFieldChange)}
                              {renderItemAdditionalCharges(item, index, handleEditItemFieldChange)}
                              {editInspection.items.length > 1 && editInspection.warranty_assignment_mode === "per_product" && (
                                <div className="mt-3">
                                  <label className={labelClasses} htmlFor={`edit-measurement-warranty-${index}`}>Warranty</label>
                                  <CustomerDropdown darkMode={darkMode}
                                    id={`edit-measurement-warranty-${index}`}
                                    value={getItemWarrantySelectValue(item)}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (value === "Custom") {
                                        handleEditItemFieldChange(item.id, "warranty_period", "Custom");
                                        if (!Number(item.custom_warranty_days)) handleEditItemFieldChange(item.id, "custom_warranty_days", 90);
                                      } else {
                                        handleEditItemFieldChange(item.id, "warranty_period", value === "No Warranty" ? value : Number(value));
                                      }
                                    }}
                                    className={inputClasses}
                                  >
                                    <option value="No Warranty">No Warranty</option>
                                    <option value="30">30 Days</option>
                                    <option value="60">60 Days</option>
                                    <option value="90">90 Days</option>
                                    <option value="Custom">Custom</option>
                                  </CustomerDropdown>
                                  {getItemWarrantySelectValue(item) === "Custom" && (
                                    <input type="number" min="1" step="1" aria-label={`Custom warranty days for item ${index + 1}`} value={getItemWarrantyCustomDays(item)} onChange={(event) => handleEditItemFieldChange(item.id, "custom_warranty_days", event.target.value)} className={`${inputClasses} mt-2`} placeholder="Custom warranty days" />
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                              {getInspectionMeasurementFields(item).map((field) => (
                                <label key={field.key} className="min-w-0">
                                  <span className={labelClasses}>{field.label}</span>
                                  <input type="number" min="0" inputMode="decimal" aria-label={`${field.label} for measurement ${index + 1}`} value={hasSelectedProduct ? getDimensionInputValue(item[field.key]) : ""} disabled={!hasSelectedProduct} onFocus={() => clearDefaultDimensionZero(item.id, field.key, item[field.key], handleEditItemFieldChange)} onChange={(event) => handleEditItemFieldChange(item.id, field.key, event.target.value)} className={inputClasses} />
                                </label>
                              ))}
                              <label className="min-w-0">
                                <span className={labelClasses}>Measurement Unit</span>
                                <CustomerDropdown darkMode={darkMode} aria-label={`Measurement unit for ${item.name || `measurement ${index + 1}`}`} value={hasSelectedProduct ? item.measurement_unit || item.measurementUnit || "in" : ""} disabled={!hasSelectedProduct} onChange={(event) => handleEditItemFieldChange(item.id, "measurement_unit", event.target.value)} className={inputClasses}>
                                  {!hasSelectedProduct && <option value="">—</option>}
                                  <option value="in">in</option>
                                  <option value="ft">ft</option>
                                  <option value="cm">cm</option>
                                  <option value="m">m</option>
                                </CustomerDropdown>
                              </label>
                              <label className="min-w-0">
                                <span className={labelClasses}>Quantity</span>
                                <input type="number" min="1" inputMode="numeric" aria-label={`Quantity for measurement ${index + 1}`} value={hasSelectedProduct ? item.qty ?? item.quantity ?? 1 : ""} disabled={!hasSelectedProduct} onChange={(event) => handleEditItemFieldChange(item.id, "qty", event.target.value)} className={inputClasses} />
                              </label>
                            </div>
                            <div className={`mt-3 grid grid-cols-2 gap-3 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                              <div className="min-w-0">
                                <span className={labelClasses}>Rate / Unit</span>
                                <p className={`truncate text-sm font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{hasSelectedProduct ? formatRateLabel(item) : "—"}</p>
                              </div>
                              <div className="min-w-0 text-right">
                                <span className={labelClasses}>Row Total</span>
                                <p className={`truncate text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{hasSelectedProduct ? formatCurrency(rowSubtotal) : "—"}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    </fieldset>

                    <button type="button" disabled={!editMeasurementsEnabled} onClick={addEditItemRow} className={`mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 ${darkMode ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}>
                      <Plus size={15} aria-hidden="true" /> Add measurement
                    </button>
                    {measurementValidationAttempted.edit && !validateInspectionMeasurementRows(editInspection.items || []).valid && <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">Please complete the current measurement before adding another measurement.</p>}
                    {errors.additional_project_charges && <p role="alert" className="mt-2 text-xs font-medium text-red-600">{errors.additional_project_charges}</p>}

                    <div className={`mt-4 flex justify-end border-t pt-4 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <div className={`text-right ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                        {((editInspection.project_additional_charges || []).some((charge) => String(charge.name || "").trim() && String(charge.amount ?? "").trim() !== "") || (editInspection.items || []).some((item) => getItemAdditionalChargesTotal(item) > 0)) && <p className="mb-1 text-xs font-medium text-slate-500">Products + <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency((editInspection.project_additional_charges || []).reduce((sum, charge) => String(charge.name || "").trim() && String(charge.amount ?? "").trim() !== "" ? sum + (Number(charge.amount) || 0) : sum, 0) + (editInspection.items || []).reduce((sum, item) => sum + getItemAdditionalChargesTotal(item), 0))}</span> additional charges</p>}
                        <div className="text-lg font-black">Project total <span className={`ml-2 text-xl ${darkMode ? "text-red-300" : "text-red-600"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(getEditProjectTotal())}</span></span></div>
                      </div>
                    </div>
                  </section>

                  <section className={`${editInspectionStep === 2 ? "" : "hidden"} rounded-2xl p-5 ${modalSectionClass}`}>
                    <h3 className={`mb-4 text-[13px] font-black uppercase tracking-[0.16em] ${darkMode ? "text-red-400" : "text-red-600"}`}>
                      Payment Information
                    </h3>

                    <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-medium ${darkMode ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                      <span className="mr-2 text-base">Tip:</span>
                      Business Policy: {isFullPaymentPlan(editInspection.payment_terms || "") ? "Full payment is required before project commences." : `Downpayment to be paid: ${formatCurrency(resolveRequiredPaymentAmount(editInspection.payment_terms, getEditProjectTotal(), editInspection.required_downpayment_amount))}.`}
                    </div>

                    {(() => {
                      const proof = getCustomerPaymentProof(editInspection);
                      const proofNoticeClass = darkMode
                        ? "rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100 shadow-sm"
                        : "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 shadow-sm";
                      const proofContainerClass = darkMode
                        ? "mt-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-3"
                        : "mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3";
                      const proofCardClass = darkMode
                        ? "mt-3 rounded-xl border border-slate-700 bg-slate-800 p-3 shadow-sm"
                        : "mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm";
                      const proofSecondaryTextClass = darkMode ? "text-slate-400" : "text-slate-500";
                      const proofBodyTextClass = darkMode ? "text-slate-300" : "text-slate-600";
                      if (proof.submitted) {
                        return (
                          <div className="mb-5 space-y-3">
                            <div className={proofNoticeClass}>
                              <p className="font-medium leading-6">
                                Customer says they paid <span className={`font-bold ${darkMode ? "text-white" : "text-slate-900"}`}><span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(proof.amount)}</span></span>. Confirm it matches what you received.
                              </p>
                              <p className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${darkMode ? "text-amber-300" : "text-amber-700"}`}>Use this amount</p>
                            </div>

                            <div>
                              <div className={`mb-2 text-[11px] font-bold uppercase tracking-[0.14em] ${darkMode ? "text-slate-300" : "text-slate-500"}`}>PROOF OF PAYMENT</div>
                              <button
                                type="button"
                                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition ${darkMode ? "border-slate-600 bg-slate-800/80 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}
                              >
                                <span className="font-medium">View Proof of Payment</span>
                                <span className={proofSecondaryTextClass}>↗</span>
                              </button>

                              <div className={proofContainerClass}>
                                <div className={`flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.12em] ${proofSecondaryTextClass}`}>
                                  <span>Customer Payment Submissions (1)</span>
                                  <span>{proof.paymentMethod || "Cash"}</span>
                                </div>

                                <div className={proofCardClass}>
                                  <div className={`mb-3 flex items-center justify-between gap-3 text-xs ${proofSecondaryTextClass}`}>
                                    <span className={`font-semibold ${darkMode ? "text-slate-200" : "text-slate-700"}`}>Payment #1</span>
                                    <span>{formatDateToMMMDDYYYY(new Date())}</span>
                                  </div>

                                  <div className={`rounded-lg border p-3 ${darkMode ? "border-slate-600 bg-slate-900/80" : "border-slate-200 bg-slate-50"}`}>
                                    <div className={`mb-2 text-[11px] font-bold uppercase tracking-[0.12em] ${proofSecondaryTextClass}`}>Customer declared</div>
                                    <div className={`text-xl font-bold tracking-tight ${darkMode ? "text-white" : "text-slate-900"}`}>
                                      <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(proof.amount)}</span>
                                    </div>
                                  </div>

                                  <div className={`mt-3 grid gap-2 text-sm ${proofBodyTextClass}`}>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-medium">Admin recorded</span>
                                      <span className={`font-semibold ${darkMode ? "text-red-400" : "text-red-600"}`}>
                                        <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(proof.amount)}</span>
                                      </span>
                                    </div>
                                    {proof.transactionNumber && (
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">Transaction</span>
                                        <span className={`font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`}>{proof.transactionNumber}</span>
                                      </div>
                                    )}
                                    {proof.fileName && (
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">Attachment</span>
                                        <span className={`max-w-[150px] truncate text-right font-semibold ${darkMode ? "text-slate-100" : "text-slate-800"}`} title={proof.fileName}>{proof.fileName}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className={`mb-5 rounded-xl border px-3 py-3 text-sm ${darkMode ? "border-slate-700 bg-slate-900/60 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                          <div className={`mb-2 text-[11px] font-bold uppercase tracking-[0.14em] ${darkMode ? "text-slate-300" : "text-slate-500"}`}>PROOF OF PAYMENT</div>
                          <p>Customer has not submitted proof of payment yet.</p>
                        </div>
                      );
                    })()}

                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Estimated Cost</label>
                        <div className={`rounded-xl border px-3 py-3 text-xl font-black ${darkMode ? "border-slate-600 bg-[#122d42] text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                          <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(getEditProjectTotal())}</span>
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <label htmlFor="edit-manual-price-override" className={`text-[14px] font-bold ${labelClass}`}>Manual Price Override (optional)</label>
                          <button
                            type="button"
                            data-manual-price-lock-toggle="true"
                            onClick={() => {
                              if (manualOverrideLocked) {
                                setManualOverrideLocked(false);
                                window.requestAnimationFrame(() => document.getElementById("edit-manual-price-override")?.focus());
                              } else {
                                setManualOverrideLocked(true);
                              }
                            }}
                            role="switch"
                            aria-checked={!manualOverrideLocked}
                            aria-label={`Manual price override is ${manualOverrideLocked ? "locked" : "unlocked"}`}
                            className={`inline-flex min-h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                          >
                            {manualOverrideLocked ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
                            <span>{manualOverrideLocked ? "Locked" : "Unlocked"}</span>
                            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${manualOverrideLocked ? "bg-amber-500" : "bg-emerald-600"}`} aria-hidden="true">
                              <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${manualOverrideLocked ? "translate-x-0.5" : "translate-x-[18px]"}`} />
                            </span>
                          </button>
                        </div>
                        <input
                          id="edit-manual-price-override"
                          type={hidePaymentAmounts ? "password" : "number"}
                          min="0"
                          placeholder="Enter adjusted total..."
                          className={`${manualOverrideLocked ? lockedFieldClass : fieldClass} manual-price-override-field`}
                          value={editInspection.manual_override || ""}
                          disabled={manualOverrideLocked}
                          onBlur={(event) => {
                            // Moving focus to the lock control is part of the toggle
                            // interaction. Don't let blur race with its click or keyboard action.
                            if (event.relatedTarget?.closest?.('[data-manual-price-lock-toggle="true"]')) return;
                            setManualOverrideLocked(true);
                          }}
                          onChange={(e) => handleEditChange("manual_override", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className={`mt-5 rounded-xl border border-dashed px-4 py-4 ${darkMode ? "border-slate-600 bg-[#102838] text-slate-200" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                      <div className="flex items-center justify-between gap-4 text-[14px] font-bold">
                        <span>Final Project Cost</span>
                        <span className={`text-[18px] font-black ${darkMode ? "text-white" : "text-slate-900"}`}>
                          <span className="font-[inherit] text-emerald-700 dark:text-emerald-400">{formatCurrency(getEditProjectTotal())}</span>
                        </span>
                      </div>
                      <div className={`mt-3 flex items-center justify-between gap-4 border-t pt-3 text-[14px] font-bold ${darkMode ? "border-slate-700 text-red-400" : "border-slate-200 text-red-600"}`}>
                        <label htmlFor="edit-required-downpayment-amount" className="shrink-0">Downpayment to be Paid</label>
                        <input
                          id="edit-required-downpayment-amount"
                          type={hidePaymentAmounts ? "password" : "number"}
                          min="0"
                          max={getEditProjectTotal()}
                          step="0.01"
                          inputMode="decimal"
                          value={resolveRequiredPaymentAmount(editInspection.payment_terms, getEditProjectTotal(), editInspection.required_downpayment_amount)}
                          onChange={(event) => handleEditChange("required_downpayment_amount", event.target.value)}
                          disabled={isFullPaymentPlan(editInspection.payment_terms || "") || editInspection.payment_terms === "50%_down_payment"}
                          className={`w-full max-w-[220px] rounded-lg border px-3 py-2 text-right text-base font-black outline-none focus:border-red-500 disabled:opacity-70 ${darkMode ? "border-slate-600 bg-[#122d42] text-red-300" : "border-slate-200 bg-white text-red-600"}`}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Payment Terms</label>
                        <CustomerDropdown darkMode={darkMode}
                          className={fieldClass}
                          value={editInspection.payment_terms || ""}
                          onChange={(e) => handleEditChange("payment_terms", e.target.value)}
                        >
                          <option value="50%_down_payment">50% downpayment, 50% upon completion</option>
                          <option value="full_payment">Full Payment</option>
                        </CustomerDropdown>
                        {shouldShowAgreedPaymentDate(editInspection.payment_terms || "") && (
                          <div className="mt-3">
                            <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>Agreed Payment Date (optional)</label>
                            <input
                              type="date"
                              className={fieldClass}
                              min={today}
                              value={editInspection.agreed_payment_date || ""}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                if (nextValue && isPastDateValue(nextValue)) {
                                  toast.error("Agreed payment date cannot be in the past.");
                                  return;
                                }
                                handleEditChange("agreed_payment_date", nextValue);
                              }}
                            />
                            <p className={`mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                              Client agreed to pay downpayment on this date.
                            </p>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className={`mb-2 block text-[14px] font-bold ${labelClass}`}>{getPaymentReceivedQuestion(editInspection.payment_terms || "")}</label>
                        <div className={`grid grid-cols-2 overflow-hidden rounded-xl border shadow-sm ${darkMode ? "border-slate-600 bg-[#122d42]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            type="button"
                            onClick={() => handleEditChange("downpayment_received", true)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${editInspection.downpayment_received ? (darkMode ? "bg-green-500/15 text-green-300" : "bg-green-50 text-green-700") : (darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500")}`}
                          >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-white ${editInspection.downpayment_received ? "border-green-400 bg-green-600" : "border-slate-400 bg-slate-500"}`}>✓</span>
                            {isFullPaymentPlan(editInspection.payment_terms || "") ? "Yes, Received" : "Yes, Paid"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditChange("downpayment_received", false)}
                            className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold transition ${!editInspection.downpayment_received ? (darkMode ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700") : (darkMode ? "bg-[#122d42] text-slate-400" : "bg-white text-slate-500")}`}
                          >
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] text-white ${!editInspection.downpayment_received ? "border-red-500 bg-red-600" : "border-slate-500 bg-slate-600"}`}>×</span>
                            Not Yet
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                <div className={`sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-2 px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-7 sm:py-4 ${footerClass}`}>
                  <button
                    type="button"
                    onClick={requestCloseEditInspection}
                    className={`${secondaryButtonClass} w-full sm:w-auto`}
                    disabled={savingEdit}
                  >
                    Cancel
                  </button>
                  {editInspectionStep === 2 && <button type="button" onClick={() => changeInspectionStep(1, setEditInspectionStep, editInspectionBodyRef)} className={`${secondaryButtonClass} w-full sm:w-auto`} disabled={savingEdit}>Back</button>}
                  {editInspectionStep === 1 ? (
                    <button type="button" onClick={() => advanceInspectionForm(editInspection, setEditInspectionStep, editInspectionBodyRef)} className={`${primaryButtonClass} w-full sm:w-auto`} disabled={savingEdit}>Continue to project details</button>
                  ) : (
                    <button type="button" onClick={requestSaveEdit} className={`${primaryButtonClass} w-full sm:w-auto`} disabled={savingEdit}>
                      {savingEdit ? "Saving..." : "Save Changes"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {highCancellationConfirmation && (
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4"
              onClick={() => setHighCancellationConfirmation(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setHighCancellationConfirmation(false);
              }}
            >
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="high-cancellation-title"
                aria-describedby="high-cancellation-description"
                className={`w-full max-w-xl rounded-2xl border px-6 py-6 shadow-2xl ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-violet-200 bg-white text-slate-900"}`}
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="high-cancellation-title" className="text-lg font-semibold">Confirm site inspection changes</h2>
                <p id="high-cancellation-description" className={`mt-3 text-sm leading-6 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                  This customer has canceled orders 3 times already. Do you want to continue?
                </p>
                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setHighCancellationConfirmation(false)}
                    className={`min-h-11 rounded-full px-5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${darkMode ? "bg-slate-700 text-slate-100 hover:bg-slate-600" : "bg-violet-100 text-violet-950 hover:bg-violet-200"}`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHighCancellationConfirmation(false);
                      saveEdit();
                    }}
                    disabled={savingEdit}
                    className="min-h-11 rounded-full bg-violet-900 px-6 text-sm font-semibold text-white transition hover:bg-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          )}

          {measurementDeleteConfirmation && (
            <div
              className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
              onClick={() => setMeasurementDeleteConfirmation(null)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setMeasurementDeleteConfirmation(null);
              }}
            >
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-measurement-title"
                aria-describedby="delete-measurement-description"
                className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${darkMode ? "border-[#263040] bg-[#161c26] text-[#eef1f6]" : "border-[#dde3ec] bg-white text-[#1a2230]"}`}
                onClick={(event) => event.stopPropagation()}
              >
                <div className={`mb-4 flex size-11 items-center justify-center rounded-xl ${darkMode ? "bg-red-500/15 text-[#ff8080]" : "bg-[#fdecea] text-[#d64545]"}`}>
                  <Trash2 size={20} aria-hidden="true" />
                </div>
                <h2 id="delete-measurement-title" className="text-lg font-bold">Delete measurement?</h2>
                <p id="delete-measurement-description" className={`mt-2 text-sm ${darkMode ? "text-[#93a0b4]" : "text-[#6f7a8c]"}`}>
                  Are you sure you want to delete <span className="font-semibold">{measurementDeleteConfirmation.label}</span>?
                </p>
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={() => setMeasurementDeleteConfirmation(null)} className={`${secondaryButtonClass} w-full sm:w-auto`}>
                    Cancel
                  </button>
                  <button type="button" onClick={confirmMeasurementDelete} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#d64545] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c73a3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d64545]/40 sm:w-auto">
                    <Trash2 size={15} aria-hidden="true" /> Delete
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>

        {/* Contract Modal */}
        <ContractModal
          isOpen={showContractModal}
          onClose={() => {
            contractModalLoadRequestRef.current += 1;
            setShowContractModal(false);
            setContractNeedsRegeneration(false);
          }}
          inspection={contractInspection}
          contractData={contractData}
          onDownload={handleDownloadContract}
          onPrint={handlePrintContract}
          onRegenerate={handleRegenerateContract}
          onSendToCustomer={handleSendToCustomer}
          isSendingToCustomer={sendingCustomerEmail}
          hidePaymentAmounts={hidePaymentAmounts}
        />
        <BlankContractGeneratorModal
          open={showBlankContractModal && canGenerateBlankContract}
          onClose={() => setShowBlankContractModal(false)}
          darkMode={darkMode}
        />
        <UnsavedChangesDialog
          open={Boolean(exitConfirmation)}
          darkMode={darkMode}
          onStay={() => setExitConfirmation(null)}
          onDiscard={discardInspectionChanges}
        />
      </div>
    </div>
  );
}

export default SiteInspection;
