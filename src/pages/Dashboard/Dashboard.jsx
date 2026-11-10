import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  ClipboardCheck,
  FolderOpen,
  ShieldCheck,
  Package,
  UserCog,
  Settings,
  Wrench,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { getAdminOrders, getAdminOrder, updateOrderStatus } from "@/api/orders";
import { subscribeToRealtime } from "@/lib/realtimeEvents";
import { getFinalProjectCost } from "@/lib/orderPricing";
import { recordActivity } from "@/lib/activityLog";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import { getPendingRepairCount, isUntransferredSiteInspection } from "./dashboardOrderUtils";
import ProfileAvatar from "../../components/ui/ProfileAvatar";
import TransactionDetailsModal from "../../components/TransactionDetailsModal";
import { getRepairRequests } from "@/api/repairs";

const formatCurrency = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `₱${amount.toLocaleString(undefined, {
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
};

const titleCase = (value) => {
  if (!value) return "—";
  return String(value)
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

import Sidebar from "../../components/layout/Sidebar";
import Navbar from "../../components/layout/Navbar";
import AdminPageHeader from "../../components/layout/AdminPageHeader";
import ProgressViewModal from "../../components/ProgressViewModal";
import useNotificationHighlight from "@/hooks/useNotificationHighlight";

const toProgressProject = (order) => ({
  id: order?._id || order?.id,
  client:
    order?.customer_name ||
    `${order?.customer?.first_name || ""} ${order?.customer?.last_name || ""}`.trim() ||
    order?.customer?.email ||
    "Unknown",
  product:
    order?.items?.[0]?.name ||
    order?.items?.[0]?.category ||
    order?.items?.[0]?.product_id?.name ||
    "Project",
  rawOrder: order,
});

const parseWarrantyDurationDays = (value) => {
  const match = String(value ?? "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(days?|months?|years?)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] || "days";
  if (unit.startsWith("year")) return Math.round(amount * 365);
  if (unit.startsWith("month")) return Math.round(amount * 30);
  return Math.round(amount);
};

const formatWarrantyDate = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date);
};

const getCompletedInstallationDate = (order, item) => {
  const itemStages = Array.isArray(item?.progress_stages) ? item.progress_stages : [];
  const stages = itemStages.length ? itemStages : Array.isArray(order?.progress_stages) ? order.progress_stages : [];
  const installationStage = stages.find((stage) => {
    const key = String(stage?.key || "").toLowerCase();
    const name = String(stage?.name || "").toLowerCase();
    const isInstallation = (key.includes("installation") || name.includes("installation"))
      && !key.includes("schedul")
      && !name.includes("schedul");
    const isComplete = stage?.completed === true
      || ["done", "completed"].includes(String(stage?.status || "").toLowerCase());
    return isInstallation && isComplete;
  });
  const date = installationStage?.date || installationStage?.completedAt || installationStage?.completed_at;
  if (!date) return null;
  const parsedDate = new Date(date);
  return Number.isNaN(parsedDate.getTime()) || parsedDate > new Date() ? null : parsedDate;
};

const getOrderWarrantyRecords = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const perProduct = order?.warranty_assignment_mode === "per_product";
  const sourceItems = items.length ? items : [{}];

  return sourceItems.flatMap((item, index) => {
    const status = String(item?.warranty_status || (perProduct ? "" : order?.warranty_status) || "").toLowerCase();
    const period = item?.warranty_period || (perProduct ? "" : order?.warranty_period) || "";
    if (status === "no_warranty" || String(period).trim().toLowerCase() === "no warranty") return [];

    const isPending = status === "pending";
    const storedStart = isPending ? null : item?.warranty_start_date || (perProduct ? null : order?.warranty_start_date);
    const storedExpiry = isPending ? null : item?.warranty_expiry_date || (perProduct ? null : order?.warranty_expiry_date);
    const installationStart = getCompletedInstallationDate(order, item);
    const startValue = storedStart || installationStart;
    const start = startValue ? new Date(startValue) : null;
    const durationDays = parseWarrantyDurationDays(period);
    const derivedExpiry = start && durationDays
      ? new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000)
      : null;
    const expiryValue = storedExpiry || derivedExpiry;
    const expiry = expiryValue ? new Date(expiryValue) : null;
    const hasDerivedCoverage = Boolean(installationStart && durationDays);
    const now = new Date();
    const coverageHasStarted = Boolean(start && start <= now);
    const coverageHasExpired = Boolean(expiry && expiry <= now);
    const recordStatus = hasDerivedCoverage && (!status || isPending)
      ? coverageHasExpired ? "expired" : coverageHasStarted && expiry > now ? "active" : "pending"
      : status;
    const hasWarrantyRecord = Boolean(period || status || storedStart || storedExpiry || hasDerivedCoverage);

    if (!hasWarrantyRecord || (start && Number.isNaN(start.getTime())) || (expiry && Number.isNaN(expiry.getTime()))) {
      return [];
    }

    return [{
      key: `${order._id || order.id}-warranty-${index}`,
      order,
      item,
      period,
      status: recordStatus,
      start,
      expiry,
    }];
  });
};

function Dashboard() {
  const { user } = useAuth();
  const canViewRepairManagement = user?.role !== "skilled_worker" || (
    user?.staff_access?.modules?.repair_management?.enabled === true
    && user?.staff_access?.modules?.repair_management?.actions?.view === true
  );
  const hidePaymentAmounts = user?.role === "skilled_worker" && user?.staff_access?.hide_payment_amounts === true;
  const { darkMode } = useAdminTheme();
  const location = useLocation();
  const highlightedNotificationRecordId = useNotificationHighlight(location);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("sidebarOpen");
    return stored !== null ? JSON.parse(stored) : true;
  });
  const [orders, setOrders] = useState([]);
  const [pendingRepairCount, setPendingRepairCount] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [scrollToWarrantyOnOpen, setScrollToWarrantyOnOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedOrderLoading, setSelectedOrderLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState({
    open: false,
    message: "",
    type: "success",
  });
  const [confirmModal, setConfirmModal] = useState({
    open: false,
    action: "",
    order: null,
  });

  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const [recentTransactionsPage, setRecentTransactionsPage] = useState(1);
  const [activeProjectsPage, setActiveProjectsPage] = useState(1);
  const [activeWarrantiesPage, setActiveWarrantiesPage] = useState(1);
  const [contractNotifications, setContractNotifications] = useState([]);
  const [contractNotificationsLoading, setContractNotificationsLoading] = useState(false);
  const [contractPage, setContractPage] = useState(1);
  const contractsPerPage = 5;
  const [chartProgress, setChartProgress] = useState(0);
  const showToast = (message, type = "success") => {
    setToast({ open: true, message, type });
    setTimeout(() => {
      setToast((current) =>
        current.message === message ? { ...current, open: false } : current
      );
    }, 3000);
  };

  const navigate = useNavigate();
  const handleOpenInspectionDetails = (orderId) => {
    if (!orderId) return;
    navigate(`/site-inspection?view=${encodeURIComponent(orderId)}`, {
      state: { notificationHighlight: { recordId: orderId, recordType: "contract" } },
    });
  };

  const openConfirmModal = (order, action) => {
    setConfirmModal({
      open: true,
      action,
      order,
    });
  };

  

  const handleViewOrder = async (orderId, { scrollToWarranty = false } = {}) => {
    if (!orderId) return;
    setScrollToWarrantyOnOpen(scrollToWarranty);
    try {
      setSelectedOrderLoading(true);
      const resp = await getAdminOrder(orderId, "dashboard");
      setSelectedOrder(resp.order || resp);
    } catch (error) {
      console.error("Failed to fetch admin order:", error);
      showToast(error.data?.message || error.message || "Unable to load order details", "error");
    } finally {
      setSelectedOrderLoading(false);
    }
  };

  const handleViewProject = (order) => {
    setSelectedProject(toProgressProject(order));
  };

  const handleTimelineOrderChange = (savedOrder) => {
    if (!savedOrder) return;

    setOrders((currentOrders) =>
      currentOrders.map((order) =>
        (order._id || order.id) === (savedOrder._id || savedOrder.id)
          ? savedOrder
          : order
      )
    );
    setSelectedProject(toProgressProject(savedOrder));
  };

  const closeConfirmModal = () => {
    setConfirmModal({ open: false, action: "", order: null });
  };

  const handleConfirmAction = async () => {
    if (!confirmModal.order) return;

    const order = confirmModal.order;
    const action = confirmModal.action;

    closeConfirmModal();

    if (action === "approve") {
      await handleApproveOrder(order);
    } else if (action === "reject") {
      await handleRejectOrder(order);
    }
  };

  useEffect(() => {
    localStorage.setItem("sidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!canViewRepairManagement) {
      setPendingRepairCount(0);
      return undefined;
    }
    let active = true;
    const loadPendingRepairs = async () => {
      try {
        const response = await getRepairRequests();
        if (active) setPendingRepairCount(getPendingRepairCount(response.repairs || []));
      } catch (error) {
        console.error("Failed to load pending repair requests:", error);
      }
    };
    void loadPendingRepairs();
    const unsubscribe = subscribeToRealtime(["repairs"], loadPendingRepairs);
    return () => { active = false; unsubscribe(); };
  }, [canViewRepairManagement]);

  useEffect(() => {
    let animationFrame;
    const animationStart = performance.now();
    const animationDuration = 1400;

    const animateChart = (timestamp) => {
      const elapsed = Math.min((timestamp - animationStart) / animationDuration, 1);
      const easedProgress = 1 - Math.pow(1 - elapsed, 4);
      setChartProgress(easedProgress);

      if (elapsed < 1) {
        animationFrame = requestAnimationFrame(animateChart);
      }
    };

    setChartProgress(0);
    animationFrame = requestAnimationFrame(animateChart);

    return () => cancelAnimationFrame(animationFrame);
  }, [orders.length]);

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    const fetchOrders = async (showLoading = true) => {
      if (requestInFlight) return;
      requestInFlight = true;
      if (showLoading) setOrdersLoading(true);
      try {
        const allOrders = [];
        let page = 1;
        let totalPages = 1;
        do {
          const response = await getAdminOrders({ module: "dashboard", limit: 100, ...(page > 1 ? { page } : {}) });
          allOrders.push(...(response.orders || []));
          totalPages = response.pagination?.totalPages || 1;
          page += 1;
        } while (active && page <= totalPages);
        if (active) {
          setOrders(allOrders);
        }
      } catch (error) {
        console.error("Failed to load orders:", error);
      } finally {
        if (active && showLoading) setOrdersLoading(false);
        requestInFlight = false;
      }
    };

    fetchOrders();
    fetchContractNotifications();

    const refreshOrders = () => {
      if (document.visibilityState === "visible") {
        fetchOrders(false);
        fetchContractNotifications();
      }
    };
    const unsubscribeRealtime = subscribeToRealtime("orders", refreshOrders);
    window.addEventListener("focus", refreshOrders);
    document.addEventListener("visibilitychange", refreshOrders);

    return () => {
      active = false;
      window.removeEventListener("focus", refreshOrders);
      document.removeEventListener("visibilitychange", refreshOrders);
      unsubscribeRealtime();
    };
  }, []);

  async function fetchContractNotifications() {
    setContractNotificationsLoading(true);
    try {
      const response = await getAdminOrders({
        contract_status: "accepted,declined",
        module: "dashboard",
        limit: 100,
      });

      const notifications = (response.orders || []).map((order) => ({
        ...order,
        notificationType: String(order.contract_status || "").toLowerCase() === "declined" ? "declined" : "accepted",
        read: false,
      })).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      setContractNotifications(notifications);
    } catch (error) {
      console.error("Failed to load contract notifications:", error);
      setContractNotifications([]);
    } finally {
      setContractNotificationsLoading(false);
    }
  };

  const handleApproveOrder = async (order) => {
    setActionLoading(true);

    try {
      await updateOrderStatus(order._id, { status: "site_inspection" });
      const orderName = order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
        : "Customer";
      recordActivity(user, `Approved order for ${orderName} and moved it to site inspection.`, "Dashboard");

      setOrders((prev) =>
        prev.map((item) =>
          item._id === order._id ? { ...item, status: "site_inspection" } : item
        )
      );

      const successMessage = "Order approved and moved to Site Inspection.";
      showToast(successMessage, "success");
      setTimeout(() => {
        setSelectedOrder(null);
      }, 2000);
    } catch (error) {
      console.error("Failed to approve order:", error);
      const errorMessage = "Failed to approve order. Please try again.";
      showToast(errorMessage, "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectOrder = async (order) => {
    setActionLoading(true);

    try {
      await updateOrderStatus(order._id, { status: "cancelled" });
      const orderName = order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
        : "Customer";
      recordActivity(user, `Rejected order for ${orderName}.`, "Dashboard");

      setOrders((prev) =>
        prev.map((item) =>
          item._id === order._id ? { ...item, status: "cancelled" } : item
        )
      );

      const successMessage = "Order rejected and cancelled.";
      showToast(successMessage, "success");
      setTimeout(() => {
        setSelectedOrder(null);
      }, 2000);
    } catch (error) {
      console.error("Failed to reject order:", error);
      const errorMessage = "Failed to reject order. Please try again.";
      showToast(errorMessage, "error");
    } finally {
      setActionLoading(false);
    }
  };

  const activeProjectStatuses = new Set([
    "approved",
    "site_inspection",
    "contract_sent",
    "contract_accepted",
    "in_transaction",
    "processing",
    "cutting",
    "fabrication",
    "installation_scheduling",
    "installation",
  ]);
  const isActiveProject = (order) => {
    const status = String(order.status || "").toLowerCase();
    const progress = Number(order.progress);
    const stages = order.progress_stages || order.stages || [];
    const finalStage = Array.isArray(stages) ? stages[stages.length - 1] : null;
    const isCompleted =
      status === "completed" ||
      status === "cancelled" ||
      progress >= 100 ||
      finalStage?.completed === true;

    return activeProjectStatuses.has(status) && !isCompleted;
  };
  const dashboardPanelPageSize = 5;
  const activeProjectsPerPage = 8;
  const allActiveProjects = orders.filter(isActiveProject);
  const activeProjectsCount = allActiveProjects.length;
  const activeProjectsPageCount = Math.max(1, Math.ceil(activeProjectsCount / activeProjectsPerPage));
  const safeActiveProjectsPage = Math.min(activeProjectsPage, activeProjectsPageCount);
  const activeProjects = allActiveProjects.slice(
    (safeActiveProjectsPage - 1) * activeProjectsPerPage,
    safeActiveProjectsPage * activeProjectsPerPage,
  );
  const isWarrantyCurrentlyActive = ({ status, start, expiry }) => {
    const now = new Date();
    return (!start || start <= now) && (
      (status === "active" || (!status && expiry)) && (!expiry || expiry > now)
    );
  };
  const warrantyRecords = orders.flatMap(getOrderWarrantyRecords);
  const activeWarranties = warrantyRecords.filter(isWarrantyCurrentlyActive);
  const warrantyGroups = new Map();
  activeWarranties.forEach((record) => {
    const orderId = String(record.order._id || record.order.id);
    const group = warrantyGroups.get(orderId) || {
      key: `${orderId}-warranty-order`,
      order: record.order,
      item: record.item,
      period: record.period,
      records: [],
    };
    group.records.push(record);
    warrantyGroups.set(orderId, group);
  });
  const allWarrantiesToDisplay = [...warrantyGroups.values()];
  const activeWarrantiesPageCount = Math.max(1, Math.ceil(allWarrantiesToDisplay.length / dashboardPanelPageSize));
  const safeActiveWarrantiesPage = Math.min(activeWarrantiesPage, activeWarrantiesPageCount);
  const warrantiesToDisplay = allWarrantiesToDisplay.slice(
    (safeActiveWarrantiesPage - 1) * dashboardPanelPageSize,
    safeActiveWarrantiesPage * dashboardPanelPageSize,
  );
  const activeWarrantiesCount = activeWarranties.length;
  const pendingInspectionCount = orders.filter(isUntransferredSiteInspection).length;
  const orderStatusGroups = [
    {
      label: "In progress",
      value: orders.filter(isActiveProject).length,
      color: "#2563eb",
      softColor: "bg-blue-500",
    },
    {
      label: "Pending inspection",
      value: pendingInspectionCount,
      color: "#f59e0b",
      softColor: "bg-amber-500",
    },
    {
      label: "Completed",
      value: orders.filter((order) => String(order.status || "").toLowerCase() === "completed").length,
      color: "#10b981",
      softColor: "bg-emerald-500",
    },
    {
      label: "Cancelled",
      value: orders.filter((order) => String(order.status || "").toLowerCase() === "cancelled").length,
      color: "#ef4444",
      softColor: "bg-red-500",
    },
    {
      label: "Other",
      value: Math.max(
        0,
        orders.length - activeProjectsCount - pendingInspectionCount -
          orders.filter((order) => String(order.status || "").toLowerCase() === "completed").length -
          orders.filter((order) => String(order.status || "").toLowerCase() === "cancelled").length,
      ),
      color: "#64748b",
      softColor: "bg-slate-500",
    },
  ];
  const orderStatusTotal = orderStatusGroups.reduce((total, group) => total + group.value, 0);
  const chartRadius = 78;
  const chartCircumference = 2 * Math.PI * chartRadius;
  let chartOffset = 0;
  const recentTransactionsPerPage = 5;
  const recentTransactions = orders.filter(isUntransferredSiteInspection).sort((a, b) => {
    const dateA = new Date(a.created_at || a.createdAt || a.updatedAt || 0).getTime();
    const dateB = new Date(b.created_at || b.createdAt || b.updatedAt || 0).getTime();
    return dateB - dateA;
  });
  const totalRecentTransactionPages = Math.max(1, Math.ceil(recentTransactions.length / recentTransactionsPerPage));
  const currentRecentTransactionsPage = Math.min(recentTransactionsPage, totalRecentTransactionPages);
  const recentTransactionStart = recentTransactions.length === 0
    ? 0
    : (currentRecentTransactionsPage - 1) * recentTransactionsPerPage + 1;
  const recentTransactionEnd = Math.min(currentRecentTransactionsPage * recentTransactionsPerPage, recentTransactions.length);

  useEffect(() => {
    if (!highlightedNotificationRecordId) return;
    const targetIndex = recentTransactions.findIndex((order) => String(order._id || order.id) === highlightedNotificationRecordId);
    if (targetIndex >= 0) setRecentTransactionsPage(Math.floor(targetIndex / recentTransactionsPerPage) + 1);
  }, [highlightedNotificationRecordId, orders]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen((open) => !open)} />

      <div className="min-w-0 flex-1 min-h-0 flex flex-col">
        <Navbar />

        <main className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto p-4 !pb-[calc(8rem+env(safe-area-inset-bottom))] sm:p-6 sm:!pb-[calc(10rem+env(safe-area-inset-bottom))] lg:!pb-24">
          {toast.open && (
            <div className="fixed right-6 top-6 z-50 w-full max-w-sm rounded-2xl border px-4 py-3 shadow-xl transition duration-200 ease-out bg-white"
              role="status"
            >
              <div className="flex items-center gap-3">
                <div className={`h-2.5 w-2.5 rounded-full ${toast.type === "error" ? "bg-red-600" : "bg-emerald-600"}`} />
                <span className={`font-semibold ${toast.type === "error" ? "text-red-700" : "text-emerald-700"}`}>
                  {toast.type === "error" ? "Error" : "Success"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{toast.message}</p>
            </div>
          )}

          <div className="mt-4 grid min-w-0 grid-cols-1 items-stretch gap-4 sm:mt-6 sm:gap-6 xl:grid-cols-2">
            <AdminPageHeader
              title="Dashboard"
              description="Manage inspections, projects, warranties and products from one administrative workspace."
              mobileCompact
              className="h-full min-w-0"
            />

            <div className={`admin-quick-actions-panel min-w-0 self-start ${darkMode ? "is-dark" : ""}`}>
              <h2 className="admin-quick-actions-title">Quick Actions</h2>
              <p className="admin-quick-actions-subtitle">Shortcuts</p>

              <div className="admin-quick-actions-grid">
                <Link to="/site-inspection" style={{ "--quick-accent": darkMode ? "#ff8fa3" : "#e11d48" }} className={`admin-quick-action-tile ${darkMode ? "is-dark" : ""}`}>
                  <span className="admin-quick-action-icon"><ClipboardCheck size={21} strokeWidth={2} aria-hidden="true" /></span>
                  <span className="admin-quick-action-copy"><span className="admin-quick-action-title">View Inspection</span><span className="admin-quick-action-description">Site Inspection</span></span>
                  <span className="admin-quick-action-arrow" aria-hidden="true"><ArrowUpRight size={15} /></span>
                </Link>

                <Link to="/product" style={{ "--quick-accent": darkMode ? "#c99bff" : "#9333ea" }} className={`admin-quick-action-tile ${darkMode ? "is-dark" : ""}`}>
                  <span className="admin-quick-action-icon"><Package size={21} strokeWidth={2} aria-hidden="true" /></span>
                  <span className="admin-quick-action-copy"><span className="admin-quick-action-title">View Product</span><span className="admin-quick-action-description">Product Management</span></span>
                  <span className="admin-quick-action-arrow" aria-hidden="true"><ArrowUpRight size={15} /></span>
                </Link>

                <Link to="/profile" style={{ "--quick-accent": darkMode ? "#a5b4ff" : "#4f46e5" }} className={`admin-quick-action-tile ${darkMode ? "is-dark" : ""}`}>
                  <span className="admin-quick-action-icon"><UserCog size={21} strokeWidth={2} aria-hidden="true" /></span>
                  <span className="admin-quick-action-copy"><span className="admin-quick-action-title">Profile</span><span className="admin-quick-action-description">Manage Your Profile</span></span>
                  <span className="admin-quick-action-arrow" aria-hidden="true"><ArrowUpRight size={15} /></span>
                </Link>

                <Link to="/settings" style={{ "--quick-accent": darkMode ? "#b6c0d3" : "#475569" }} className={`admin-quick-action-tile ${darkMode ? "is-dark" : ""}`}>
                  <span className="admin-quick-action-icon"><Settings size={21} strokeWidth={2} aria-hidden="true" /></span>
                  <span className="admin-quick-action-copy"><span className="admin-quick-action-title">Settings</span><span className="admin-quick-action-description">Manage Preferences</span></span>
                  <span className="admin-quick-action-arrow" aria-hidden="true"><ArrowUpRight size={15} /></span>
                </Link>
              </div>
            </div>
          </div>

          {/* Statistics */}
          <div className="mt-4 grid gap-[18px] sm:mt-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            <button type="button" onClick={() => navigate("/progress-monitor")} style={{ "--summary-accent": darkMode ? "#8fb0ff" : "#2563eb" }} className={`admin-dashboard-summary-card ${darkMode ? "is-dark" : ""}`}>
              <div className="admin-dashboard-summary-top"><p className="admin-dashboard-summary-label">Active Projects</p><span className="admin-dashboard-summary-icon"><FolderOpen size={21} strokeWidth={2} aria-hidden="true" /></span></div>
              <h2 className="admin-dashboard-summary-count">{activeProjectsCount}</h2>
              <span className="admin-dashboard-summary-link">View projects <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" /></span>
            </button>
            <button type="button" onClick={() => navigate("/transactions", { state: { activeTable: "receipts" } })} style={{ "--summary-accent": darkMode ? "#6fe0b0" : "#16875a" }} className={`admin-dashboard-summary-card ${darkMode ? "is-dark" : ""}`}>
              <div className="admin-dashboard-summary-top"><p className="admin-dashboard-summary-label">Active Warranties</p><span className="admin-dashboard-summary-icon"><ShieldCheck size={21} strokeWidth={2} aria-hidden="true" /></span></div>
              <h2 className="admin-dashboard-summary-count">{activeWarrantiesCount}</h2>
              <span className="admin-dashboard-summary-link">View warranties <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" /></span>
            </button>
            <button type="button" onClick={() => navigate("/site-inspection")} style={{ "--summary-accent": darkMode ? "#ff8fa3" : "#e11d48" }} className={`admin-dashboard-summary-card ${darkMode ? "is-dark" : ""}`}>
              <div className="admin-dashboard-summary-top"><p className="admin-dashboard-summary-label">Pending Inspection</p><span className="admin-dashboard-summary-icon"><ClipboardCheck size={21} strokeWidth={2} aria-hidden="true" /></span></div>
              <h2 className="admin-dashboard-summary-count">{pendingInspectionCount}</h2>
              <span className="admin-dashboard-summary-link">View inspections <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" /></span>
            </button>
            {canViewRepairManagement && <button type="button" onClick={() => navigate("/repair-requests")} style={{ "--summary-accent": darkMode ? "#f2b25e" : "#d9730d" }} className={`admin-dashboard-summary-card ${darkMode ? "is-dark" : ""}`}>
              <div className="admin-dashboard-summary-top"><p className="admin-dashboard-summary-label">Pending Repair</p><span className="admin-dashboard-summary-icon"><Wrench size={21} strokeWidth={2} aria-hidden="true" /></span></div>
              <h2 className="admin-dashboard-summary-count">{pendingRepairCount}</h2>
              <span className="admin-dashboard-summary-link">View repairs <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" /></span>
            </button>}
          </div>

          <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-bold text-gray-900">Recent Transactions</h2>
                </div>
                <p className="mt-1 text-sm text-gray-500">Recent activity in the Customer Website</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/site-inspection")}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                View All
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-gray-200">
              <div className="hidden md:block">
                <table className="min-w-full border-collapse">
                  <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-4">Client</th>
                      <th className="px-5 py-4">Project</th>
                      <th className="px-5 py-4">Date</th>
                      <th className="px-5 py-4">Amount</th>
                      <th className="px-5 py-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white text-sm text-gray-700">
                    {recentTransactions.length > 0 ? recentTransactions
                      .slice(
                        (currentRecentTransactionsPage - 1) * recentTransactionsPerPage,
                        currentRecentTransactionsPage * recentTransactionsPerPage,
                      )
                      .map((order) => {
                        const customerName = order.customer
                          ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
                          : order.customer_name || "Customer";
                        const orderItems = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
                        const productName = orderItems.length > 1
                          ? "Batch Order"
                          : orderItems[0]?.name || orderItems[0]?.product_id?.name || order.product_name || order.project_name || "Project";
                        const date = order.created_at || order.createdAt || order.date || "";
                        const formattedDate = date ? new Date(date).toISOString().split("T")[0] : "—";
                        const statusValue = String(order.status || "pending");
                        const statusText = titleCase(statusValue);
                        const badgeClasses =
                          statusValue.toLowerCase() === "cancelled"
                            ? "bg-red-100 text-red-700"
                            : statusValue.toLowerCase() === "completed"
                              ? "bg-emerald-100 text-emerald-700"
                              : statusValue.toLowerCase() === "site_inspection" || statusValue.toLowerCase() === "pending"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-rose-100 text-rose-700";

                        const orderId = String(order._id || order.id || "");
                        const isNotificationTarget = highlightedNotificationRecordId === orderId;
                        return (
                          <tr
                            key={orderId}
                            data-notification-record-id={orderId}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleOpenInspectionDetails(orderId)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleOpenInspectionDetails(orderId);
                              }
                            }}
                            data-notification-target="order"
                            className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 ${isNotificationTarget ? "notification-target-highlight" : "hover:bg-gray-50"}`}
                          >
                            <td className="px-5 py-4"><ProfileAvatar name={customerName} email={order.customer?.email || order.customer_email || ""} compact /></td>
                            <td className="px-5 py-4 font-bold text-gray-900">{productName}</td>
                            <td className="px-5 py-4 text-gray-700">{formattedDate}</td>
                            <td className="px-5 py-4 font-semibold text-emerald-700 dark:text-emerald-400">{hidePaymentAmounts ? "••••••" : formatCurrency(getFinalProjectCost(order))}</td>
                            <td className="px-5 py-4 text-right">
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                {order.is_rush_order && <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-800">Rush Order</span>}
                                <span className={`inline-flex w-[140px] items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold ${badgeClasses}`}>
                                  {statusText}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      }) : (
                      <tr>
                        <td colSpan="5" className="px-5 py-8 text-center text-sm text-gray-400">
                          No recent transactions.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-3 md:hidden">
                {recentTransactions.length > 0 ? recentTransactions
                  .slice(
                    (currentRecentTransactionsPage - 1) * recentTransactionsPerPage,
                    currentRecentTransactionsPage * recentTransactionsPerPage,
                  )
                  .map((order) => {
                    const customerName = order.customer
                      ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
                      : order.customer_name || "Customer";
                    const orderItems = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
                    const productName = orderItems.length > 1
                      ? "Batch Order"
                      : orderItems[0]?.name || orderItems[0]?.product_id?.name || order.product_name || order.project_name || "Project";
                    const date = order.created_at || order.createdAt || order.date || "";
                    const formattedDate = date ? new Date(date).toISOString().split("T")[0] : "—";
                    const statusValue = String(order.status || "pending");
                    const statusText = titleCase(statusValue);
                    const badgeClasses =
                      statusValue.toLowerCase() === "cancelled"
                        ? "bg-red-100 text-red-700"
                        : statusValue.toLowerCase() === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : statusValue.toLowerCase() === "site_inspection" || statusValue.toLowerCase() === "pending"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700";

                    const orderId = String(order._id || order.id || "");
                    const isNotificationTarget = highlightedNotificationRecordId === orderId;
                    return (
                      <div
                        key={orderId}
                        data-notification-record-id={orderId}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpenInspectionDetails(orderId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleOpenInspectionDetails(orderId);
                          }
                        }}
                        data-notification-target="order"
                        className={`cursor-pointer rounded-2xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${isNotificationTarget ? "notification-target-highlight" : "border-gray-200 bg-gray-50"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-gray-900">{productName}</p>
                            <p className="mt-1 text-xs text-gray-500">{customerName}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {order.is_rush_order && <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-800">Rush Order</span>}
                            <span className={`inline-flex w-[140px] items-center justify-center whitespace-nowrap rounded-lg px-2.5 py-1 text-[10px] font-semibold ${badgeClasses}`}>
                              {statusText}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-gray-400">Date</p>
                            <p className="mt-1 font-medium text-gray-700">{formattedDate}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-gray-400">Amount</p>
                            <p className="mt-1 font-semibold text-emerald-700 dark:text-emerald-400">{hidePaymentAmounts ? "••••••" : formatCurrency(getFinalProjectCost(order))}</p>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                      No recent transactions.
                    </div>
                )}
              </div>

              <div className="flex flex-col items-center justify-center gap-3 border-t border-gray-200 bg-gray-50 p-4 sm:flex-row">
                <div className="flex flex-wrap items-center justify-center gap-2" role="navigation" aria-label="Recent transactions pagination">
                  <button
                    type="button"
                    onClick={() => setRecentTransactionsPage(Math.max(currentRecentTransactionsPage - 1, 1))}
                    disabled={currentRecentTransactionsPage === 1}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  {Array.from({ length: Math.min(5, totalRecentTransactionPages) }, (_, index) => {
                    const firstPage = Math.max(1, Math.min(currentRecentTransactionsPage - 2, totalRecentTransactionPages - 4));
                    const pageNumber = firstPage + index;
                    return (
                      <button
                        key={pageNumber}
                        type="button"
                        onClick={() => setRecentTransactionsPage(pageNumber)}
                        aria-current={pageNumber === currentRecentTransactionsPage ? "page" : undefined}
                        className={`h-10 w-10 rounded-lg ${pageNumber === currentRecentTransactionsPage ? "bg-red-600 text-white" : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"}`}
                      >
                        {pageNumber}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setRecentTransactionsPage(Math.min(currentRecentTransactionsPage + 1, totalRecentTransactionPages))}
                    disabled={currentRecentTransactionsPage === totalRecentTransactionPages}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <section className="flex flex-col rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Active Projects</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    {activeProjectsCount} projects currently in progress
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 content-start gap-3 sm:grid-cols-2">
                {activeProjects.length > 0 ? activeProjects.map((order) => {
                  const customerName = order.customer
                    ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
                    : "Customer";
                  const orderItems = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
                  const productName = orderItems.length > 1
                    ? "Batch Order"
                    : orderItems[0]?.name || orderItems[0]?.product_id?.name || "Project";
                  const status = titleCase(order.status);
                  return (
                    <button
                      type="button"
                      key={order._id || order.id}
                      onClick={() => handleViewProject(order)}
                      className={`group relative flex min-h-[76px] w-full items-start rounded-xl border px-4 py-3 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${darkMode ? "border-[#3d4862] bg-gradient-to-br from-[#2a3246] to-[#343e55] hover:border-blue-400/70" : "border-slate-200 bg-gradient-to-br from-white to-slate-50 hover:border-blue-200"}`}
                    >
                      <div className="min-w-0 pr-[150px]">
                        <p className={`truncate text-[15px] font-bold leading-5 ${darkMode ? "text-[#e8ebf2]" : "text-slate-900"}`}>{productName}</p>
                        <p className={`mt-1 truncate text-[13px] leading-4 ${darkMode ? "text-[#a9b3c7]" : "text-slate-600"}`}>{customerName}</p>
                      </div>
                      <span className={`absolute right-4 top-3 w-[138px] text-right text-[13px] font-bold leading-5 transition-colors ${darkMode ? "text-[#a9c2ff] group-hover:text-[#c1d2ff]" : "text-blue-700 group-hover:text-blue-800"}`}>
                        {status}
                      </span>
                    </button>
                  );
                }) : (
                  <p className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No active projects.
                  </p>
                )}
              </div>
              {activeProjectsCount > 0 && (
                <div className="mt-4 flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row">
                  <div className="flex flex-wrap items-center justify-center gap-2" role="navigation" aria-label="Active projects pagination">
                    <button
                      type="button"
                      onClick={() => setActiveProjectsPage(Math.max(1, safeActiveProjectsPage - 1))}
                      disabled={safeActiveProjectsPage === 1}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    {Array.from({ length: Math.min(5, activeProjectsPageCount) }, (_, index) => {
                      const firstPage = Math.max(1, Math.min(safeActiveProjectsPage - 2, activeProjectsPageCount - 4));
                      const pageNumber = firstPage + index;
                      return (
                        <button
                          key={pageNumber}
                          type="button"
                          onClick={() => setActiveProjectsPage(pageNumber)}
                          aria-current={pageNumber === safeActiveProjectsPage ? "page" : undefined}
                          className={`h-10 w-10 rounded-lg ${pageNumber === safeActiveProjectsPage ? "bg-red-600 text-white" : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"}`}
                        >
                          {pageNumber}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setActiveProjectsPage(Math.min(activeProjectsPageCount, safeActiveProjectsPage + 1))}
                      disabled={safeActiveProjectsPage === activeProjectsPageCount}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="flex flex-col rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Active Warranties</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    {activeWarrantiesCount} warranties currently active
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 content-start gap-3 sm:grid-cols-2">
                {warrantiesToDisplay.length > 0 ? warrantiesToDisplay.map(({ key, order, item, period, records }) => {
                  const customerName = order.customer
                    ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || order.customer.email || "Customer"
                    : "Customer";
                  const isBatchOrder = Array.isArray(order.items) && order.items.length > 1;
                  const productName = isBatchOrder ? "Batch Order" : item.name || item.product_id?.name || "Warranty";
                  const warrantyDetails = (records || []).map((record) => ({
                    product: record.item?.name || record.item?.product_id?.name || productName,
                    period: record.period
                      ? /^\d+(?:\.\d+)?$/.test(String(record.period).trim()) ? `${record.period} days` : String(record.period)
                      : "Not specified",
                    start: formatWarrantyDate(record.start),
                    expiry: formatWarrantyDate(record.expiry),
                  }));
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => handleViewOrder(order._id || order.id, { scrollToWarranty: true })}
                      className={`w-full min-h-[124px] rounded-xl border p-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${darkMode ? "border-[#3d4862] bg-[#2a3246] hover:border-emerald-400/60 hover:bg-[#343e55]" : "border-gray-200 bg-white hover:border-green-300 hover:bg-green-50/40"}`}
                    >
                      <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <p className={`break-words text-[13px] font-bold leading-4 ${darkMode ? "text-[#e8ebf2]" : "text-gray-900"}`}>{productName}</p>
                          <p className={`break-words text-[13px] font-medium leading-4 ${darkMode ? "text-[#c6cddd]" : "text-gray-700"}`}>{customerName}</p>
                        </div>
                        <span className="mt-0.5 shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold leading-4 text-green-800">Active</span>
                      </div>
                      <dl className={`mt-1.5 grid grid-cols-[0.85fr_1.15fr] items-start gap-x-2 gap-y-1 border-t pt-1.5 text-left ${darkMode ? "border-[#3d4862]" : "border-gray-100"}`}>
                        <div className="min-w-0 space-y-0.5">
                          <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-[#a9b3c7]" : "text-gray-600"}`}>Warranty period</dt>
                          <dd className={`mt-0.5 text-[11px] font-semibold leading-4 ${darkMode ? "text-[#e8ebf2]" : "text-gray-900"}`}>{isBatchOrder ? `${order.items.length} products` : warrantyDetails[0]?.period || (period ? `${period} days` : "Not specified")}</dd>
                        </div>
                        {warrantyDetails.some((detail) => detail.start || detail.expiry) && <div className="min-w-0">
                          <dt className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? "text-[#a9b3c7]" : "text-gray-600"}`}>Coverage dates</dt>
                          <dd className={`mt-0.5 space-y-0.5 text-[11px] font-semibold leading-4 ${darkMode ? "text-[#e8ebf2]" : "text-gray-900"}`}>
                            {warrantyDetails.map((detail, index) => <p key={`${key}-coverage-${index}`} className="break-words">
                              {isBatchOrder ? `${detail.product}: ` : ""}{detail.start || "Start date unavailable"}{detail.expiry ? <> &ndash; {detail.expiry}</> : ""}
                            </p>)}
                          </dd>
                        </div>}
                      </dl>
                    </button>
                  );
                }) : (
                  <p className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                    No active warranties.
                  </p>
                )}
              </div>
              {allWarrantiesToDisplay.length > 0 && (
                <div className="mt-4 flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row">
                  <div className="flex flex-wrap items-center justify-center gap-2" role="navigation" aria-label="Active warranties pagination">
                    <button
                      type="button"
                      onClick={() => setActiveWarrantiesPage(Math.max(1, safeActiveWarrantiesPage - 1))}
                      disabled={safeActiveWarrantiesPage === 1}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    {Array.from({ length: Math.min(5, activeWarrantiesPageCount) }, (_, index) => {
                      const firstPage = Math.max(1, Math.min(safeActiveWarrantiesPage - 2, activeWarrantiesPageCount - 4));
                      const pageNumber = firstPage + index;
                      return (
                        <button
                          key={pageNumber}
                          type="button"
                          onClick={() => setActiveWarrantiesPage(pageNumber)}
                          aria-current={pageNumber === safeActiveWarrantiesPage ? "page" : undefined}
                          className={`h-10 w-10 rounded-lg ${pageNumber === safeActiveWarrantiesPage ? "bg-red-600 text-white" : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"}`}
                        >
                          {pageNumber}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setActiveWarrantiesPage(Math.min(activeWarrantiesPageCount, safeActiveWarrantiesPage + 1))}
                      disabled={safeActiveWarrantiesPage === activeWarrantiesPageCount}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>

        </main>
      </div>

      <TransactionDetailsModal
        order={selectedOrder}
        scrollToWarranty={scrollToWarrantyOnOpen}
        darkMode={darkMode}
        hidePaymentAmounts={hidePaymentAmounts}
        onClose={() => {
          setSelectedOrder(null);
          setScrollToWarrantyOnOpen(false);
        }}
      />

      {selectedProject && (
        <ProgressViewModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onOrderChange={handleTimelineOrderChange}
        />
      )}

      {confirmModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-3xl shadow-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4">
              {confirmModal.action === "approve"
                ? "Confirm Approval"
                : "Confirm Rejection"}
            </h2>
            <p className="text-sm text-slate-600 mb-6">
              {confirmModal.action === "approve"
                ? "Are you sure you want to approve this order request and move it to Site Inspection?"
                : "Are you sure you want to reject this order request?"}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={closeConfirmModal}
                className="px-4 py-2 rounded-lg bg-gray-100 text-slate-700 hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {actionLoading ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
